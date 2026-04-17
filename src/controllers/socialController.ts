// Backend Social Metadata Scraper - Updated Profile Logic
import { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { profileService } from '../services/profileService.js';
import { blogService } from '../services/blogService.js';
import axios from 'axios';
import { safeFetch, validateUserUrl, SsrfError } from '../utils/ssrfGuard.js';

// In-memory cache for Instagram profiles (avoids hitting Instagram's rate limits)
const igCache = new Map<string, { data: any; expiresAt: number }>();
const IG_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

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

            // ─── Strategy 0: InnerTube API (YouTube's own internal API) ───
            console.log(`[SocialController] 🔄 Attempting Strategy 0 (InnerTube) for URL: ${url}`);
            try {
                const handleMatch = url.match(/\/(@[^/?#]+)/);
                const channelIdMatch = url.match(/\/channel\/([^/?#]+)/);
                let browseId = channelIdMatch?.[1];
                const handle = handleMatch?.[1];

                const innerTubeContext = {
                    client: {
                        clientName: 'WEB',
                        clientVersion: '2.20240410.01.00',
                        hl: 'pt',
                        gl: 'BR',
                        utcOffsetMinutes: -180,
                    }
                };

                // If it's a handle, we need to resolve it to a channelId (UC...) first
                if (!browseId && handle) {
                    console.log(`[SocialController] Resolving handle "${handle}"...`);
                    const resolveRes = await safeFetch('https://www.youtube.com/youtubei/v1/navigation/resolve_url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.youtube.com' },
                        body: JSON.stringify({
                            context: innerTubeContext,
                            url: `https://www.youtube.com/${handle}`
                        }),
                    });

                    if (resolveRes.ok) {
                        const resolveData: any = await resolveRes.json();
                        browseId = resolveData?.endpoint?.browseEndpoint?.browseId;
                        console.log(`[SocialController] Resolved handle to browseId: "${browseId}"`);
                    } else {
                        console.log(`[SocialController] Failed to resolve handle. Status: ${resolveRes.status}`);
                    }
                }

                if (browseId) {
                    const innerTubeRes = await safeFetch('https://www.youtube.com/youtubei/v1/browse', {
                        method: 'POST',
                        timeout: 10000,
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                            'X-Youtube-Client-Name': '1',
                            'X-Youtube-Client-Version': '2.20240410.01.00',
                            'Origin': 'https://www.youtube.com',
                            'Referer': 'https://www.youtube.com/',
                        },
                        body: JSON.stringify({
                            context: innerTubeContext,
                            browseId
                        }),
                    });

                    console.log(`[SocialController] InnerTube browse status: ${innerTubeRes.status}`);

                    if (innerTubeRes.ok) {
                        const data: any = await innerTubeRes.json();
                        
                        // Try various paths in the InnerTube JSON to find subscriber count
                        const header = data?.header?.c4TabbedHeaderRenderer 
                            || data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
                        
                        if (data?.header?.c4TabbedHeaderRenderer) {
                            const hdr = data.header.c4TabbedHeaderRenderer;
                            name = name || hdr.title || '';
                            const thumbs = hdr.avatar?.thumbnails ?? [];
                            if (thumbs.length) avatarUrl = thumbs[thumbs.length - 1].url;
                            
                            const subText = hdr.subscriberCountText?.simpleText || hdr.subscriberCountText?.runs?.[0]?.text || '';
                            if (subText) {
                                subscribers = subText.replace(/\s*(de\s*)?(inscritos?|subscribers?)/gi, '').trim();
                            }
                        } else if (data?.header?.pageHeaderRenderer) {
                            const hdrVm = data.header.pageHeaderRenderer.content.pageHeaderViewModel;
                            name = name || hdrVm?.title?.dynamicTextViewModel?.text?.content || '';
                            
                            // Avatar from metadata
                            const meta = data?.metadata?.channelMetadataRenderer;
                            if (meta?.avatar?.thumbnails?.length) {
                                avatarUrl = meta.avatar.thumbnails[meta.avatar.thumbnails.length - 1].url;
                            }

                            // Sub count from metadata rows
                            const rows = hdrVm?.metadata?.contentMetadataViewModel?.metadataRows || [];
                            for (const row of rows) {
                                const parts = row.metadataParts || [];
                                for (const part of parts) {
                                    const text = part.text?.content || '';
                                    if (/inscritos|subscribers/i.test(text)) {
                                        subscribers = text.replace(/\s*(de\s*)?(inscritos?|subscribers?)/gi, '').trim();
                                        break;
                                    }
                                }
                                if (subscribers) break;
                            }
                        }

                        if (name || subscribers) {
                            console.log(`[SocialController] ✅ Strategy 0 success: name="${name}", subs="${subscribers}"`);
                        }
                    } else {
                        const body = await innerTubeRes.text().catch(() => '');
                        console.log(`[SocialController] ⚠️ Strategy 0 browse error: ${innerTubeRes.status} — ${body.substring(0, 100)}`);
                    }
                }
            } catch (e) {
                console.log('[SocialController] Strategy 0 fatal error:', (e as any).message);
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
     * Fetches metadata for Instagram profiles (username, name, avatar, follower count).
     */
    async getInstagramProfileInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') {
                return res.status(400).json({ error: 'URL is required' });
            }

            const lowerUrl = url.toLowerCase();
            if (!lowerUrl.includes('instagram.com')) {
                return res.status(400).json({ error: 'URL must be an Instagram URL' });
            }

            // Cleanup URL and ensure it has www for better results
            let cleanUrl = url.split('?')[0].split('#')[0].replace(/\/$/, '');
            if (cleanUrl.includes('instagram.com') && !cleanUrl.includes('www.instagram.com')) {
                cleanUrl = cleanUrl.replace('instagram.com', 'www.instagram.com');
            }
            console.log(`[SocialController] Fetching Instagram info for: ${cleanUrl}`);

            let name = '';
            let username = '';
            let avatarUrl = '';
            let followers = '';

            // Extract username from URL as baseline
            const handleMatch = cleanUrl.match(/instagram\.com\/([^\/\?]+)/);
            if (handleMatch) username = handleMatch[1].replace('@', '');

            // Check server-side cache first
            const cacheKey = `ig:${username.toLowerCase()}`;
            const cached = igCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                console.log(`[SocialController] IG cache hit for: ${username}`);
                return res.json(cached.data);
            }

            // Strategy 0: Instagram's internal JSON API (web_profile_info)
            // This is Instagram's own internal API endpoint that returns profile data in JSON
            try {
                const apiRes = await safeFetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
                    timeout: 8000,
                    headers: {
                        'User-Agent': 'Instagram 123.0.0.23.114 (iPhone; CPU iPhone OS 16_0 like Mac OS X; en_US; en-US; scale=2.00; 750x1334) AppleWebKit/420+',
                        'x-ig-app-id': '936619743392459',
                        'Accept': '*/*',
                        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
                    },
                });

                if (apiRes.ok) {
                    const data: any = await apiRes.json();
                    const user = data?.data?.user;
                    if (user) {
                        name = user.full_name || '';
                        username = user.username || username;
                        avatarUrl = user.profile_pic_url_hd || user.profile_pic_url || '';
                        const followerCount = user.edge_followed_by?.count || user.follower_count;
                        if (followerCount !== undefined) {
                            const count = parseInt(followerCount);
                            if (count >= 1000000) followers = (count / 1000000).toFixed(1).replace('.0', '') + 'M';
                            else if (count >= 1000) followers = Math.round(count / 100) / 10 + 'K';
                            else followers = count.toString();
                        }
                        console.log(`[SocialController] IG Strategy 0 (API) success: name="${name}", followers="${followers}", avatar=${avatarUrl ? 'yes' : 'no'}`);
                    }
                } else {
                    console.log(`[SocialController] IG API returned ${apiRes.status}, trying HTML scraping`);
                }
            } catch (e) {
                console.log('[SocialController] IG API error:', (e as any).message);
            }

            // Fetch HTML (Fallback strategies)
            if (!name || !avatarUrl || !followers) {
            try {
                const pageRes = await safeFetch(cleanUrl, {
                    timeout: 8000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Cache-Control': 'no-cache',
                        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                        'Sec-Ch-Ua-Mobile': '?0',
                        'Sec-Ch-Ua-Platform': '"Windows"',
                    },
                });

                if (!pageRes.ok) {
                    console.log(`[SocialController] IG HTML fallback returned ${pageRes.status}, giving up`);
                } else if (pageRes.ok) {
                    const html = await pageRes.text();
                    const $ = cheerio.load(html);

                    const metaDesc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
                    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
                    const ogImg = $('meta[property="og:image"]').attr('content') || '';
                    console.log(`[SocialController] IG HTML: desc="${metaDesc.substring(0, 120)}", title="${ogTitle}"`);

                    // Strategy 1: og:description followers
                    if (!followers && metaDesc) {
                        const followersMatch = metaDesc.match(/([\d.,]+[KMB]?) (?:Followers|Seguidores)/i) ||
                                             metaDesc.match(/([\d.,]+[KMB]?)\s+seguidores/i) ||
                                             metaDesc.match(/^([\d.,]+)/); // First number in description
                        if (followersMatch) {
                            followers = followersMatch[1].trim();
                            console.log(`[SocialController] IG Strategy 1 (desc) success: followers="${followers}"`);
                        }
                    }

                    // Strategy 2: Deep script search for JSON data
                    const allScripts = $('script').map((_i, el) => $(el).html()).get().join('\n');
                    
                    if (!followers) {
                        const countMatch = allScripts.match(/"edge_followed_by":\s*\{\s*"count":\s*(\d+)/) ||
                                         allScripts.match(/"follower_count":\s*(\d+)/) ||
                                         allScripts.match(/"followers_count":\s*(\d+)/);
                        if (countMatch) {
                            const count = parseInt(countMatch[1]);
                            if (count >= 1000000) followers = (count / 1000000).toFixed(1).replace('.0', '') + 'M';
                            else if (count >= 1000) followers = Math.round(count / 100) / 10 + 'K';
                            else followers = count.toString();
                            console.log(`[SocialController] IG Strategy 2 (json) success: followers="${followers}"`);
                        }
                    }

                    if (!avatarUrl) {
                        const picMatch = allScripts.match(/"profile_pic_url_hd":"([^"]+)"/) ||
                                        allScripts.match(/"profile_pic_url":"([^"]+)"/);
                        if (picMatch) {
                            avatarUrl = picMatch[1].replace(/\\u[0-9a-fA-F]{4}/g, (m) =>
                                String.fromCharCode(parseInt(m.replace('\\u', ''), 16))
                            ).replace(/\\/g, '');
                            console.log(`[SocialController] IG Strategy 2 (pic) success`);
                        } else if (ogImg) {
                            avatarUrl = ogImg;
                            console.log(`[SocialController] IG Strategy 3 (og:image) success: ${ogImg.substring(0, 60)}`);
                        }
                    }

                    // Strategy 3: og:title for name
                    if (!name && ogTitle) {
                        const nameMatch = ogTitle.split(' (@')[0];
                        if (nameMatch && !nameMatch.includes('Instagram')) {
                            name = nameMatch.trim();
                        }
                        const userMatch = ogTitle.match(/\(@([^)]+)\)/);
                        if (userMatch && !username) username = userMatch[1];
                    }

                    if (!name) {
                        const pageTitle = $('title').text();
                        const parts = pageTitle.split(' (')[0];
                        if (parts && !parts.includes('Instagram')) name = parts.trim();
                    }
                }
            } catch (e) {
                console.log('[SocialController] Instagram HTML fetch error:', (e as any).message);
            }
            } // end fallback block

            console.log(`[SocialController] IG Final: name="${name}", followers="${followers}", avatar=${avatarUrl ? 'yes' : 'no'}`);

            // Fallbacks
            if (!username && handleMatch) username = handleMatch[1];
            if (!name) name = username;

            const followersText = followers ? `${followers} Seguidores` : '';
            const result = {
                name: name || username || 'Instagram',
                username: username || '',
                avatarUrl,
                followers: followersText,
                platform: 'instagram',
                profileUrl: cleanUrl
            };

            // Cache result if we got meaningful data
            if (name || avatarUrl || followersText) {
                igCache.set(cacheKey, { data: result, expiresAt: Date.now() + IG_CACHE_TTL_MS });
                console.log(`[SocialController] IG Result cached for ${username}`);
            }

            return res.json(result);

        } catch (error: any) {
            console.error('[SocialController] Error fetching Instagram info:', error);
            res.status(500).json({ error: 'Internal server error' });
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

            if (isInstagram) {
                // Use the better Instagram-specific logic
                return socialController.getInstagramProfileInfo(req, res);
            }

            if (!isTiktok && !isYoutube) {
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

            if (isTiktok) {
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
