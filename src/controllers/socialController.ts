// Backend Social Metadata Scraper - Updated Profile Logic
import { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { profileService } from '../services/profileService.js';
import { blogService } from '../services/blogService.js';
import axios from 'axios';
import { safeFetch, validateUserUrl, SsrfError } from '../utils/ssrfGuard.js';

export const socialController = {

    /**
     * Fetches metadata for YouTube channels (name, avatar, subscriber count).
     * This is separate from musicController which handles embeddable content (videos, tracks).
     */
    async getYoutubeChannelInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') {
                return res.status(400).json({ error: 'URL is required' });
            }

            const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
            if (!isYoutube) {
                return res.status(400).json({ error: 'URL must be a YouTube URL' });
            }

            const isVideo = url.includes('watch?v=') || url.includes('/shorts/') || url.includes('/live/') || url.includes('youtu.be/');
            if (isVideo) {
                return res.status(400).json({ error: 'URL is a video, not a channel' });
            }

            console.log(`[SocialController] Fetching YouTube channel info for: ${url}`);

            let name = '';
            let avatarUrl = '';
            let subscribers = '';

            // ─── Strategy 0: InnerTube API (YouTube's own internal API — no key required) ───
            // This is the most reliable method. YouTube uses this internally for every page load.
            console.log(`[SocialController] 🔄 Attempting Strategy 0 (InnerTube) for browseId...`);
            try {
                const handleMatch = url.match(/\/@([^/?#]+)/);
                const channelIdMatch = url.match(/\/channel\/([^/?#]+)/);
                const browseId = handleMatch ? `@${handleMatch[1]}` : channelIdMatch?.[1];

                console.log(`[SocialController] browseId resolved: "${browseId}"`);

                if (browseId) {
                    const innerTubeBody = JSON.stringify({
                        context: {
                            client: {
                                clientName: 'WEB',
                                clientVersion: '2.20240101.00.00',
                                hl: 'pt',
                                gl: 'BR',
                            }
                        },
                        browseId
                    });

                    const innerTubeRes = await safeFetch(
                        'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
                        {
                            method: 'POST',
                            timeout: 10000,
                            headers: {
                                'Content-Type': 'application/json',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                                'X-YouTube-Client-Name': '1',
                                'X-YouTube-Client-Version': '2.20240101.00.00',
                                'Origin': 'https://www.youtube.com',
                                'Referer': 'https://www.youtube.com/',
                            },
                            body: innerTubeBody,
                        }
                    );

                    console.log(`[SocialController] InnerTube HTTP status: ${innerTubeRes.status}`);

                    if (innerTubeRes.ok) {
                        const data: any = await innerTubeRes.json();
                        const headerKeys = Object.keys(data?.header ?? {});
                        console.log(`[SocialController] InnerTube header keys: [${headerKeys.join(', ')}]`);

                        if (data?.header?.c4TabbedHeaderRenderer) {
                            const hdr = data.header.c4TabbedHeaderRenderer;
                            if (hdr.title) name = hdr.title;

                            // Avatar: pick highest resolution thumbnail
                            const thumbs = hdr.avatar?.thumbnails ?? [];
                            if (thumbs.length) avatarUrl = thumbs[thumbs.length - 1].url;

                            // Subscribers
                            const subRaw = hdr.subscriberCountText?.simpleText
                                ?? hdr.subscriberCountText?.runs?.[0]?.text
                                ?? '';
                            subscribers = subRaw.replace(/\s*(de\s*)?(inscritos?|subscribers?)/gi, '').trim();
                            console.log(`[SocialController] ✅ Strategy 0 (c4TabbedHeaderRenderer): name="${name}", subs="${subscribers}", subRaw="${subRaw}"`);

                        } else if (data?.header?.pageHeaderRenderer) {
                            // Newer YouTube layout (pageHeaderRenderer)
                            const meta = data?.metadata?.channelMetadataRenderer;
                            if (meta?.title) name = meta.title;
                            if (meta?.avatar?.thumbnails?.length) {
                                const thumbs = meta.avatar.thumbnails;
                                avatarUrl = thumbs[thumbs.length - 1].url;
                            }
                            const headerVm = data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
                            const subText = headerVm?.metadata?.contentMetadataViewModel?.metadataRows
                                ?.flatMap((r: any) => r.metadataParts ?? [])
                                ?.find((p: any) => /inscritos|subscribers/i.test(p.text?.content ?? ''))
                                ?.text?.content ?? '';
                            if (subText) {
                                subscribers = subText.replace(/\s*(de\s*)?(inscritos?|subscribers?)/gi, '').trim();
                            }
                            console.log(`[SocialController] ✅ Strategy 0 (pageHeaderRenderer): name="${name}", subs="${subscribers}"`);
                        } else {
                            console.log(`[SocialController] ⚠️ Strategy 0: no known header. Keys: ${headerKeys.join(', ')}`);
                            // Log a snippet to see what structure YouTube returned
                            try { console.log(`[SocialController] InnerTube snippet: ${JSON.stringify(data).substring(0, 500)}`); } catch {}
                        }
                    } else {
                        const body = await innerTubeRes.text().catch(() => '');
                        console.log(`[SocialController] ⚠️ Strategy 0 (InnerTube) non-200: ${innerTubeRes.status} — ${body.substring(0, 200)}`);
                    }
                }
            } catch (e) {
                console.log('[SocialController] Strategy 0 (InnerTube) threw:', (e as any).message);
            }

            // ─── Strategies 1-8: HTML scraping fallbacks ───
            if (!name || !subscribers) {
                const fetchUrl = encodeURI(url);
                let pageRes: globalThis.Response | null = null;
                try {
                    pageRes = await safeFetch(fetchUrl, {
                        timeout: 8000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                            'Cache-Control': 'no-cache',
                        },
                    });
                } catch (e) {
                    if (e instanceof SsrfError) {
                        console.warn(`🔐 [SSRF] Blocked: ${url} — ${(e as any).message}`);
                    } else {
                        console.warn('[SocialController] HTML fetch error:', (e as any).message);
                    }
                }

                if (pageRes?.ok) {
                    const html = await pageRes.text();
                    const $ = cheerio.load(html);

                    // Strategy 1: og:title and og:image
                    if (!name) name = $('meta[property="og:title"]').attr('content') || $('title').text().replace(/ - YouTube$/, '').trim() || '';
                    if (!avatarUrl) avatarUrl = $('meta[property="og:image"]').attr('content') || '';

                    // Strategy 2: Meta description
                    if (!subscribers) {
                        const metaDesc = $('meta[name="description"]').attr('content') || '';
                        const descMatch = metaDesc.match(/([\d.,]+\s*(?:K|M|B|mil|mi|milhão|milhões|thousand|million|billion)?)\s*(inscritos|subscribers)/i);
                        if (descMatch) {
                            subscribers = descMatch[1].trim();
                            console.log(`[SocialController] ✅ Strategy 2 (meta desc): ${subscribers}`);
                        }
                    }

                    // Strategies 3-6: ytInitialData script parsing
                    if (!subscribers) {
                        let ytData = '';
                        $('script').each((_i: any, el: any) => {
                            const content = $(el).html() || '';
                            if (content.includes('subscriberCountText') || content.includes('ytInitialData')) {
                                ytData += content + '\n';
                            }
                        });

                        if (ytData) {
                            const s3 = ytData.match(/"subscriberCountText"\s*:\s*\{"simpleText"\s*:\s*"([^"]+)"\}/);
                            if (s3) { subscribers = s3[1].replace(/\s*(de\s*)?(inscritos?|subscribers?)/gi, '').trim(); console.log(`[SocialController] ✅ Strategy 3: ${subscribers}`); }

                            if (!subscribers) {
                                const s4 = ytData.match(/"subscriberCountText"\s*:\s*\{"runs"\s*:\s*\[\{"text"\s*:\s*"([^"]+)"/);
                                if (s4) { subscribers = s4[1].replace(/\s*(de\s*)?(inscritos?|subscribers?)/gi, '').trim(); console.log(`[SocialController] ✅ Strategy 4: ${subscribers}`); }
                            }
                            if (!subscribers) {
                                const s5 = ytData.match(/"subscriberCountText"[^}]{0,300}"label"\s*:\s*"([^"]+)"/);
                                if (s5) { subscribers = s5[1].replace(/\s*(de\s*)?(inscritos?|subscribers?).*/gi, '').trim(); console.log(`[SocialController] ✅ Strategy 5: ${subscribers}`); }
                            }
                            if (!subscribers) {
                                const s6 = ytData.match(/"subscriberCount"\s*:\s*"(\d+)"/);
                                if (s6) {
                                    const n = parseInt(s6[1]);
                                    if (n >= 1e9) subscribers = `${(n/1e9).toFixed(1).replace(/\.0$/,'')}B`;
                                    else if (n >= 1e6) subscribers = `${(n/1e6).toFixed(1).replace(/\.0$/,'')}M`;
                                    else if (n >= 1e3) subscribers = `${(n/1e3).toFixed(1).replace(/\.0$/,'')}K`;
                                    else if (n > 0) subscribers = String(n);
                                    if (subscribers) console.log(`[SocialController] ✅ Strategy 6 (raw): ${subscribers}`);
                                }
                            }
                        }
                    }
                }
            }

            // Strategy 7: oEmbed for name/avatar fallback
            if (!name || !avatarUrl) {
                try {
                    const oembedRes = await safeFetch(
                        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
                        { timeout: 4000 }
                    );
                    if (oembedRes.ok) {
                        const oembedData: any = await oembedRes.json();
                        if (!name && oembedData.author_name) name = oembedData.author_name;
                        if (!avatarUrl && oembedData.thumbnail_url) avatarUrl = oembedData.thumbnail_url;
                        console.log(`[SocialController] ✅ Strategy 7 (oembed): name="${oembedData.author_name}"`);
                    }
                } catch (e) {
                    console.log('[SocialController] Strategy 7 (oembed) failed:', (e as any).message);
                }
            }

            // Strategy 8: URL handle as last resort for name
            if (!name) {
                const handleMatch = url.match(/\/@([^/?#]+)/);
                if (handleMatch) name = handleMatch[1];
            }

            const subscribersText = subscribers ? `${subscribers} inscritos` : '';
            console.log(`[SocialController] Final result — name: "${name}", avatar: ${avatarUrl ? 'yes' : 'no'}, subscribers: "${subscribersText}"`);

            return res.json({
                name: name || '',
                avatarUrl,
                subscribers: subscribersText,
                platform: 'youtube',
                channelUrl: url
            });

        } catch (error: any) {
            console.error('[SocialController] Error fetching YouTube info:', error);
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    },


    /**
     * Fetches metadata for Discord invites (server name, member counts, icon).
     * Uses Discord's public API to avoid scraping.
     */
    async getDiscordInviteInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') {
                return res.status(400).json({ error: 'URL is required' });
            }

            // Extract invite code (handles discord.gg/, discord.com/invite/)
            const inviteCode = url.split('/').pop()?.split('?')[0]; // Remove query params if any
            if (!inviteCode) {
                return res.status(400).json({ error: 'Invalid Discord URL' });
            }

            console.log(`[SocialController] Fetching Discord info for code: ${inviteCode}`);

            const response = await axios.get(`https://discord.com/api/v9/invites/${inviteCode}?with_counts=true`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            const data = response.data;
            if (!data || !data.guild) {
                return res.status(404).json({ error: 'Community not found or invite expired' });
            }

            return res.json({
                name: data.guild.name,
                online: data.approximate_presence_count || 0,
                total: data.approximate_member_count || 0,
                icon: data.guild.icon ? `https://cdn.discordapp.com/icons/${data.guild.id}/${data.guild.icon}.webp?size=128` : null,
                platform: 'discord'
            });

        } catch (error: any) {
            console.error('[SocialController] Discord fetch error:', error.response?.status || error.message);
            if (error.response?.status === 404) {
                return res.status(404).json({ error: 'Discord invite not found' });
            }
            res.status(502).json({ error: 'Failed to connect to Discord' });
        }
    },

    /**
     * Unified social metadata scraper (YouTube, TikTok, Instagram). 
     * Pure scraping, NO API keys.
     */
    async getSocialMetadata(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') {
                return res.status(400).json({ error: 'URL for social profile is required' });
            }

            const lowerUrl = url.toLowerCase();
            const isInstagram = lowerUrl.includes('instagram.com');
            const isTiktok = lowerUrl.includes('tiktok.com');
            const isYoutube = lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be');

            if (!isInstagram && !isTiktok && !isYoutube) {
                return res.status(400).json({ error: 'Unsupported social platform for scraping' });
            }

            console.log(`[SocialMetadata] Scraping: ${url}`);
            
            // 🔐 SSRF: validate URL before fetching (resolves DNS, blocks private IP ranges)
            let html;
            let $;
            try {
                const safeRes = await safeFetch(url, {
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Cache-Control': 'no-cache',
                    },
                });
                html = await safeRes.text();
                $ = cheerio.load(html);
            } catch (e) {
                if (e instanceof SsrfError) {
                    console.warn(`🔐 [SSRF] Blocked social metadata scrape: ${url} — ${e.message}`);
                    return res.status(400).json({ error: e.message, code: e.code });
                }
                throw e;
            }

            let followers = '';
            let platform = '';
            let username = '';
            let avatarUrl = '';

            if (isInstagram) {
                platform = 'instagram';
                const urlParts = url.split('/').filter((p) => p && !p.includes('?') && !p.includes('#'));
                const lastPart = urlParts[urlParts.length - 1];
                if (lastPart && lastPart !== 'www.instagram.com' && lastPart !== 'instagram.com') {
                    username = lastPart.replace('@', '');
                }
                const metaDesc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
                const ogTitle = $('meta[property="og:title"]').attr('content') || '';
                const ogImage = $('meta[property="og:image"]').attr('content') || '';
                console.log(`[SocialScraper] IG Debug - URL: ${url}, ByteSize: ${html.length}, DescLength: ${metaDesc.length}`);
                if (ogTitle) {
                    const userMatch = ogTitle.match(/\(@([^)]+)\)/);
                    if (userMatch) username = userMatch[1];
                }
                const followersMatch = metaDesc.match(/([\d.,]+[KMB]?) (?:Followers|Seguidores)/i);
                if (followersMatch) {
                    followers = followersMatch[1].trim();
                } else {
                    const statsMatch = metaDesc.match(/([\d.,]+[KMB]?)\s+(?:Followers|Seguidores)/i);
                    if (statsMatch) followers = statsMatch[1];
                }
                if (!followers) {
                    const parts = metaDesc.split(' ');
                    if (parts.length > 0 && /^\d/.test(parts[0])) {
                        followers = parts[0].replace(',', '.');
                    }
                }
                avatarUrl = ogImage || '';
            } else if (isTiktok) {
                platform = 'tiktok';
                // 1. Extract username from URL safely as primary/fallback source
                const urlParts = url.split('/').filter((p) => p && !p.includes('?') && !p.includes('#'));
                const tiktokHandle = urlParts.find(p => p.startsWith('@'));
                if (tiktokHandle) {
                  username = tiktokHandle.replace('@', '');
                } else if (urlParts.length > 0) {
                  username = urlParts[urlParts.length - 1].replace('@', '');
                }

                // 2. Try to scrape followers and avatar
                const ogDescription = $('meta[property="og:description"]').attr('content') || '';
                const match = ogDescription.match(/([\d.,km\s]+)\s*(?:Followers|Seguidores)/i);
                if (match) followers = match[1].trim();
                
                // Multiple strategies for TikTok avatar
                avatarUrl = $('meta[property="og:image"]').attr('content') || 
                            $('meta[name="twitter:image"]').attr('content') || 
                            $('meta[property="twitter:image"]').attr('content') || '';
                
                // Backup strategy: Search for avatar in JSON state if meta tags fail
                if (!avatarUrl) {
                    $('script').each((_i, el) => {
                        const content = $(el).html() || '';
                        if (content.includes('avatarLarger') || content.includes('avatarMedium') || content.includes('avatarThumb')) {
                            const match = content.match(/"avatarLarger":"([^"]+)"/) || 
                                          content.match(/"avatarMedium":"([^"]+)"/) ||
                                          content.match(/"avatarThumb":"([^"]+)"/);
                            if (match) {
                                avatarUrl = match[1].replace(/\\u002F/g, '/');
                                return false;
                            }
                        }
                    });
                }
                
                if (!followers) {
                    $('strong').each((i, el) => {
                        const text = $(el).text();
                        if ($(el).attr('data-e2e') === 'followers-count') followers = text;
                    });
                }
            } else if (isYoutube) {
                platform = 'youtube';
                const metaDesc = $('meta[name="description"]').attr('content') || '';
                const descMatch = metaDesc.match(/([\d.,]+\s*(?:K|M|B|mil|mi|milhão|milhões)?) (inscritos|subscribers)/i);
                if (descMatch) followers = descMatch[1].trim();
                avatarUrl = $('meta[property="og:image"]').attr('content') || '';
            }

            return res.json({ followers: followers || null, platform, username: username || 'User', avatarUrl, url });

        } catch (error) {
            console.error('[SocialMetadata] Error:', (error as any).message);
            res.status(500).json({ error: 'Failed to scrape social metadata' });
        }
    },
    
    /**
     * Serves a dynamic HTML page with Open Graph and Twitter meta tags for a specific profile.
     * This is used by social media scrapers (Twitter, WhatsApp, etc.) to show a preview card with the image.
     */
    async shareProfile(req: Request, res: Response) {
        try {
            const { username } = req.params;
            if (!username) return res.status(400).send('Username required');

            const profile = await profileService.getProfileByUsername(username);
            if (!profile) return res.status(404).send('Profile not found');

            // Priority: 1. Manual field -> 2. Avatar fallback -> 3. Generated card path
            const ogImage = (profile as any).ogImageUrl || 
                            profile.avatarUrl || 
                            `https://gadqvlcijsmgtbwydvay.supabase.co/storage/v1/object/public/uploads/profile-cards/${username}.png` || 
                            'https://nodus.my/og-default.png';
            
            const profileUrl = `https://nodus.my/${username}`;
            const title = profile.seoTitle || `${profile.name} (@${username}) | Nodus`;
            const description = profile.seoDescription || profile.bio || 'Confira meus links e projetos no Nodus.';

            const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <meta property="og:type" content="website">
    <meta property="og:url" content="${profileUrl}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${ogImage}">
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:image" content="${ogImage}">
    <script>window.location.href = "${profileUrl}";</script>
</head>
<body style="background: #fdfdf6; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
    <div style="text-align: center;">
        <h2 style="font-weight: 900; text-transform: uppercase;">Carregando perfil...</h2>
    </div>
</body>
</html>
            `;

            res.send(html);
        } catch (error) {
            console.error('[SocialController] Error serving share page:', error);
            res.status(500).send('Server Error');
        }
    },
    
    /**
     * Serves a bot-friendly HTML for blog posts with OG tags.
     */
    async shareBlog(req: Request, res: Response) {
        try {
            const { slug } = req.params;
            if (!slug) return res.status(400).send('Slug required');

            const post = await blogService.getPostBySlug(slug);
            if (!post) return res.status(404).send('Post not found');

            // The image we expect to be there. 
            // We use a predictable URL that the frontend will upload to.
            // Note: Replace [PROJECT_REF] with the actual Supabase project ID if needed, 
            // but for Nodus it seems it's public via this proxy or direct URL.
            const ogImage = `https://gadqvlcijsmgtbwydvay.supabase.co/storage/v1/object/public/uploads/blog-cards/${slug}.png` || post.imageUrl || 'https://nodus.my/og-default.png';
            
            const blogUrl = `https://nodus.my/blog/${slug}`;
            const title = `${post.title} | Nodus Blog`;
            const description = post.excerpt || 'Leia este artigo completo no Nodus Blog.';

            const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="article">
    <meta property="og:url" content="${blogUrl}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${ogImage}">

    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${blogUrl}">
    <meta property="twitter:title" content="${title}">
    <meta property="twitter:description" content="${description}">
    <meta property="twitter:image" content="${ogImage}">

    <!-- Redirection for Humans -->
    <script>
        window.location.href = "${blogUrl}";
    </script>
</head>
<body style="background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
    <div style="text-align: center;">
        <h2>Lendo o artigo: ${post.title}...</h2>
        <p>Você será redirecionado em instantes.</p>
        <a href="${blogUrl}" style="color: #ffdf00; text-decoration: none;">Clique aqui se não for redirecionado automaticamente.</a>
    </div>
</body>
</html>
            `;

            res.send(html);
        } catch (error) {
            console.error('[SocialController] Error serving blog share page:', error);
            res.status(500).send('Server Error');
        }
    }
};
