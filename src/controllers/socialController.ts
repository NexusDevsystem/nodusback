// Backend Social Metadata Scraper - Updated Profile Logic
import { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { profileService } from '../services/profileService.js';
import { blogService } from '../services/blogService.js';
import { linkService } from '../services/linkService.js';
import axios from 'axios';
import { safeFetch, validateUserUrl, SsrfError } from '../utils/ssrfGuard.js';
import { realtimeManager } from '../realtime/RealtimeManager.js';
import { supabase } from '../config/supabaseClient.js';

// In-memory cache for social profiles (avoids hitting rate limits)
const igCache = new Map<string, { data: any; expiresAt: number }>();
const tiktokCache = new Map<string, { data: any; expiresAt: number }>();
const twitchCache = new Map<string, { data: any; expiresAt: number }>();
const kickCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

function parseFollowerCount(str: string): number {
    if (!str) return 0;
    const cleanStr = str.toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
    const numMatch = cleanStr.match(/([\d.]+)/);
    if (!numMatch) return 0;
    let val = parseFloat(numMatch[1]);
    if (cleanStr.includes('k')) val *= 1000;
    if (cleanStr.includes('m')) val *= 1000000;
    if (cleanStr.includes('b')) val *= 1000000000;
    return Math.floor(val);
}

/**
 * AI-powered data extraction using OpenRouter
 */
async function extractMetadataWithAI(html: string, platform: string): Promise<any> {
    try {
        console.log(`\x1b[35m[AI-Extraction] Starting extraction for ${platform}...\x1b[0m`);
        
        const $ = cheerio.load(html);
        
        // Clean HTML to save tokens but PRESERVE application/ld+json which contains profile data
        $('script:not([type="application/ld+json"])').remove();
        $('style').remove();
        $('svg').remove();
        $('path').remove();
        $('nav').remove();
        $('footer').remove();
        
        // Extract meta tags and title as they are most relevant
        const metaTags: any = {};
        $('meta').each((i, el) => {
            const name = $(el).attr('name') || $(el).attr('property');
            const content = $(el).attr('content');
            if (name && content) metaTags[name] = content;
        });

        const title = $('title').text();
        const bodyText = $('body').text().replace(/\s+/g, ' ').slice(0, 3000); // Grab first 3k chars of text

        console.log(`[AI-Extraction] Metadata found - Title: "${title}", Meta Tags Count: ${Object.keys(metaTags).length}`);

        const prompt = `
            Extract social media profile metadata from the following HTML/Context for ${platform}.
            Return ONLY a valid JSON object with these fields:
            - name (full display name)
            - username (handle)
            - avatarUrl (profile picture URL)
            - followers (formatted string like "10K" or "1.5M")
            - followersRaw (numeric count if found)

            Context Title: ${title}
            Meta Tags: ${JSON.stringify(metaTags)}
            Page Text Sample: ${bodyText}
        `;

        const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-lite-preview-02-05:free';
        console.log(`[AI-Extraction] Sending request to OpenRouter (Model: ${model}, Platform: ${platform}) with Structured Output...`);

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: model,
            messages: [
                {
                    role: 'system',
                    content: 'You are a precise web data extractor. Extract the requested social media profile metadata from the provided context.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'social_metadata',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Full display name of the profile' },
                            username: { type: 'string', description: 'Profile handle/username' },
                            avatarUrl: { type: 'string', description: 'Direct URL to the profile avatar image' },
                            followers: { type: 'string', description: 'Formatted follower count (e.g., 10K, 1.5M, 500)' },
                            followersRaw: { type: ['integer', 'null'], description: 'Numeric follower count if available' }
                        },
                        required: ['name', 'username', 'avatarUrl', 'followers'],
                        additionalProperties: false
                    }
                }
            },
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY || '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'}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://nodus.my',
                'X-OpenRouter-Title': 'Nodus App'
            }
        });

        const aiContent = response.data.choices[0]?.message?.content;
        console.log(`[AI-Extraction] Raw AI Response:`, aiContent);

        if (!aiContent) {
            console.log(`\x1b[31m[AI-Extraction] Empty response from AI.\x1b[0m`);
            return null;
        }

        try {
            const result = JSON.parse(aiContent);
            console.log(`\x1b[32m[AI-Extraction] Success! Extracted: name="${result.name}", followers="${result.followers}"\x1b[0m`);
            return result;
        } catch (parseErr) {
            console.error(`\x1b[31m[AI-Extraction] JSON Parse Error:\x1b[0m`, aiContent);
            return null;
        }
    } catch (err: any) {
        console.error('\x1b[31m[AI-Extraction] Error:\x1b[0m', err.response?.data || err.message);
        return null;
    }
}

export const socialController = {

    /**
     * Fetches metadata for YouTube channels (name, avatar, subscriber count).
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

            // Strategy 0: InnerTube
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

                if (!browseId && handle) {
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

                    if (innerTubeRes.ok) {
                        const data: any = await innerTubeRes.json();
                        const header = data?.header?.c4TabbedHeaderRenderer || data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;

                        if (data?.header?.c4TabbedHeaderRenderer) {
                            const hdr = data.header.c4TabbedHeaderRenderer;
                            name = hdr.title || '';
                            const thumbs = hdr.avatar?.thumbnails ?? [];
                            if (thumbs.length) avatarUrl = thumbs[thumbs.length - 1].url;
                            const subText = hdr.subscriberCountText?.simpleText || hdr.subscriberCountText?.runs?.[0]?.text || '';
                            if (subText) subscribers = subText.replace(/\s*(de\s*)?(inscritos?|subscribers?)/gi, '').trim();
                        } else if (data?.header?.pageHeaderRenderer) {
                            const hdrVm = data.header.pageHeaderRenderer.content.pageHeaderViewModel;
                            name = hdrVm?.title?.dynamicTextViewModel?.text?.content || '';
                            const meta = data?.metadata?.channelMetadataRenderer;
                            if (meta?.avatar?.thumbnails?.length) avatarUrl = meta.avatar.thumbnails[meta.avatar.thumbnails.length - 1].url;
                            const rows = hdrVm?.metadata?.contentMetadataViewModel?.metadataRows || [];
                            for (const row of rows) {
                                for (const part of (row.metadataParts || [])) {
                                    const text = part.text?.content || '';
                                    if (/inscritos|subscribers/i.test(text)) {
                                        subscribers = text.replace(/\s*(de\s*)?(inscritos?|subscribers?)/gi, '').trim();
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('[SocialController] YT Strategy 0 error:', (e as any).message);
            }

            // HTML scraping fallbacks
            if (!name || !subscribers) {
                try {
                    const pageRes = await safeFetch(url, {
                        timeout: 8000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        },
                    });

                    if (pageRes?.ok) {
                        const html = await pageRes.text();
                        const $ = cheerio.load(html);
                        if (!name) name = $('meta[property="og:title"]').attr('content') || $('title').text().replace(/ - YouTube$/, '').trim() || '';
                        if (!avatarUrl) avatarUrl = $('meta[property="og:image"]').attr('content') || '';

                        if (!subscribers) {
                            const metaDesc = $('meta[name="description"]').attr('content') || '';
                            const descMatch = metaDesc.match(/([\d.,]+\s*(?:K|M|B|mil|mi|milhão|milhões|thousand|million|billion)?)\s*(inscritos|subscribers)/i);
                            if (descMatch) subscribers = descMatch[1].trim();
                        }
                    }
                } catch (e) {
                    console.log('[SocialController] YT HTML error:', (e as any).message);
                }
            }

            const subscribersText = subscribers ? `${subscribers} inscritos` : '';

            // 💾 AUTO-SAVE: If linkId is provided, persist the metadata to the link's subtitle
            const { linkId } = req.query;
            if (linkId && typeof linkId === 'string' && subscribersText) {
                try {
                    await linkService.updateLink(linkId, { subtitle: subscribersText });
                    console.log(`[YouTube] Auto-saved subscribers for link ${linkId}: ${subscribersText}`);
                } catch (saveErr) {
                    console.error(`[YouTube] Failed to auto-save metadata for link ${linkId}:`, saveErr);
                }
            }

            return res.json({
                name: name || '',
                avatarUrl,
                subscribers: subscribersText,
                platform: 'youtube',
                channelUrl: url
            });
        } catch (error: any) {
            console.error('[SocialController] getYoutubeChannelInfo error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /**
     * Fetches metadata for Instagram profiles (username, name, avatar, follower count).
     */
    async getInstagramProfileInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            console.log(`\x1b[36m[Instagram] Initiating metadata fetch for: ${url}\x1b[0m`);
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

            const cleanUrl = url.split('?')[0].split('#')[0];
            const handleMatch = cleanUrl.match(/instagram\.com\/([^\/\?]+)/i);
            let username = handleMatch ? handleMatch[1].replace('@', '') : '';
            const cacheKey = `ig:${username.toLowerCase()}`;

            const cached = igCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now() && cached.data.avatarUrl) return res.json(cached.data);

            console.log(`[Instagram] Resilient fetch for: ${username}`);

            let name = '', avatarUrl = '', followers = '';

            const strategies = [
                // 1. oEmbed (Official-ish)
                async () => {
                    const oEmbedUrl = `https://graph.facebook.com/v12.0/instagram_oembed?url=${encodeURIComponent(cleanUrl)}&omitscript=true`;
                    const res = await safeFetch(oEmbedUrl, { timeout: 4000 });
                    if (res.ok) {
                        const data: any = await res.json();
                        name = data.author_name || name;
                        avatarUrl = data.thumbnail_url || avatarUrl;
                        return !!avatarUrl;
                    }
                    return false;
                },
                // 2. Twitterbot (High privilege for previews)
                async () => {
                    const res = await safeFetch(cleanUrl, {
                        headers: { 'User-Agent': 'Twitterbot/1.0' },
                        timeout: 6000
                    });
                    if (res.ok) {
                        const html = await res.text();
                        const $ = cheerio.load(html);
                        if (!avatarUrl) avatarUrl = $('meta[property="og:image"]').attr('content') || '';
                        const desc = $('meta[property="og:description"]').attr('content') || '';
                        const match = desc.match(/([\d.,]+[KMB]?)\s*(?:Followers|Seguidores)/i);
                        if (match) followers = match[1];
                        if (!name) name = $('meta[property="og:title"]').attr('content')?.split(' (')[0] || '';
                        return !!avatarUrl;
                    }
                    return false;
                },
                // 3. WhatsApp (Mobile View)
                async () => {
                    const res = await safeFetch(cleanUrl, {
                        headers: { 'User-Agent': 'WhatsApp/2.23.20.0 A' },
                        timeout: 6000
                    });
                    if (res.ok) {
                        const html = await res.text();
                        const $ = cheerio.load(html);
                        if (!avatarUrl) avatarUrl = $('meta[property="og:image"]').attr('content') || '';
                        if (!followers) {
                            const desc = $('meta[property="og:description"]').attr('content') || '';
                            const match = desc.match(/([\d.,]+[KMB]?)\s*(?:Followers|Seguidores)/i);
                            if (match) followers = match[1];
                        }
                        return !!avatarUrl;
                    }
                    return false;
                },
                // 4. LinkedInBot (Professional Crawler)
                async () => {
                    const res = await safeFetch(cleanUrl, {
                        headers: { 'User-Agent': 'LinkedInBot/1.0 (at customer-request)' },
                        timeout: 6000
                    });
                    if (res.ok) {
                        const html = await res.text();
                        const $ = cheerio.load(html);
                        if (!avatarUrl) avatarUrl = $('meta[property="og:image"]').attr('content') || '';
                        if (!followers) {
                            const desc = $('meta[property="og:description"]').attr('content') || '';
                            const match = desc.match(/([\d.,]+[KMB]?)\s*(?:Followers|Seguidores)/i);
                            if (match) followers = match[1];
                        }
                        return !!avatarUrl;
                    }
                    return false;
                },
                // 5. AI Brain Strategy (Smart Extraction)
                async () => {
                    try {
                        const res = await safeFetch(cleanUrl, {
                            headers: { 
                                'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
                            },
                            timeout: 10000
                        });
                        console.log(`[Instagram] AI Strategy response status: ${res.status} for ${username}`);
                        if (res.ok) {
                            const html = await res.text();
                            const aiData = await extractMetadataWithAI(html, 'Instagram');
                            if (aiData) {
                                if (aiData.name) name = aiData.name;
                                if (aiData.avatarUrl) avatarUrl = aiData.avatarUrl;
                                if (aiData.followers) followers = aiData.followers;
                                return !!avatarUrl || !!followers;
                            }
                        }
                    } catch (e) {
                        console.log('[Instagram] AI Strategy failed:', (e as any).message);
                    }
                    return false;
                }
            ];

            for (const [index, strategy] of strategies.entries()) {
                try { 
                    if (await strategy()) {
                        console.log(`[Instagram] Strategy ${index + 1} succeeded for ${username}`);
                        break; 
                    } 
                } catch (e) { 
                    console.log(`[Instagram] Strategy ${index + 1} failed for ${username}:`, (e as any).message);
                }
            }

            if (!avatarUrl || !followers) {
                // Final fallback: Scan for JSON-like patterns in HTML
                try {
                    const html = await (await safeFetch(cleanUrl, { 
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
                        timeout: 5000
                    })).text();
                    
                    if (!avatarUrl) {
                        const picMatch = html.match(/"profile_pic_url":"([^"]+)"/) || html.match(/"og:image" content="([^"]+)"/);
                        if (picMatch) avatarUrl = picMatch[1].replace(/\\u0026/g, '&');
                    }
                    if (!followers) {
                        const folMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/) || html.match(/"followers_count":(\d+)/);
                        if (folMatch) {
                            const count = parseInt(folMatch[1]);
                            if (count >= 1000000) followers = (count / 1000000).toFixed(1).replace('.0', '') + 'M';
                            else if (count >= 1000) followers = (count / 1000).toFixed(1).replace('.0', '') + 'K';
                            else followers = count.toString();
                        }
                    }
                } catch (e) {}
            }

            const result = {
                name: name || username || 'Instagram',
                display_name: name || username || 'Instagram',
                username,
                avatarUrl,
                avatar_url: avatarUrl,
                followers: followers ? `${followers} Seguidores` : '',
                follower_count: parseFollowerCount(followers),
                subscribers: followers ? `${followers} Seguidores` : '',
                platform: 'instagram',
                profileUrl: cleanUrl
            };

            // 💾 AUTO-SAVE: If linkId is provided, persist the metadata to the link's subtitle
            const { linkId } = req.query;
            if (linkId && typeof linkId === 'string' && (followers || avatarUrl)) {
                try {
                    const updates: any = {};
                    if (followers) updates.subtitle = `${followers} Seguidores`;
                    if (avatarUrl) updates.image = avatarUrl;
                    await linkService.updateLink(linkId, updates);
                    console.log(`[Instagram] Auto-saved metadata for link ${linkId}: ${followers} Seguidores`);
                } catch (saveErr) {
                    console.error(`[Instagram] Failed to auto-save metadata for link ${linkId}:`, saveErr);
                }
            }

            if (avatarUrl) igCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
            return res.json(result);
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    },

    /**
     * Fetches metadata for TikTok profiles.
     */
    async getTiktokProfileInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            console.log(`\x1b[36m[TikTok] Initiating metadata fetch for: ${url}\x1b[0m`);
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

            const lowerUrl = url.toLowerCase();
            const urlParts = lowerUrl.split('/').filter((p) => p && !p.includes('?') && !p.includes('#'));
            const tiktokHandle = urlParts.find(p => p.startsWith('@'));
            let handle = tiktokHandle ? tiktokHandle.replace('@', '') : (urlParts.length > 0 ? urlParts[urlParts.length - 1].replace('@', '') : '');

            if (!handle) return res.status(400).json({ error: 'Invalid TikTok URL' });

            const cacheKey = `tiktok:${handle.toLowerCase()}`;
            const cached = tiktokCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);

            let name = '';
            let avatarUrl = '';
            let followers = '';

            try {
                const pageRes = await safeFetch(url, {
                    timeout: 8000,
                    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
                });

                if (pageRes.ok) {
                    const html = await pageRes.text();
                    
                    // Try AI Strategy first for TikTok as it's very reliable
                    const aiData = await extractMetadataWithAI(html, 'TikTok');
                    if (aiData) {
                        if (aiData.name) name = aiData.name;
                        if (aiData.avatarUrl) avatarUrl = aiData.avatarUrl;
                        if (aiData.followers) followers = aiData.followers;
                    }

                    // Fallback to Cheerio if AI misses something
                    if (!name || !avatarUrl || !followers) {
                        const $ = cheerio.load(html);
                        const metaDesc = $('meta[property="og:description"]').attr('content') || '';
                        const ogTitle = $('meta[property="og:title"]').attr('content') || '';

                        if (!followers) {
                            const fMatch = metaDesc.match(/([\d.,]+[kmMB]?)\s*(?:Followers|Seguidores)/i);
                            if (fMatch) followers = fMatch[1].trim();
                        }
                        if (!avatarUrl) avatarUrl = $('meta[property="og:image"]').attr('content') || '';
                        if (!name) name = ogTitle.split(' | TikTok')[0].trim();
                    }
                }
            } catch (e) {
                console.log('[SocialController] TikTok AI/HTML error:', (e as any).message);
            }

            const platformName = 'TikTok';
            const followersText = followers ? `${followers} Seguidores` : '';
            const result = {
                name: `@${handle.replace('@', '')}`,
                display_name: `@${handle.replace('@', '')}`,
                username: handle,
                avatarUrl,
                avatar_url: avatarUrl,
                followers: followersText,
                follower_count: parseFollowerCount(followersText),
                subscribers: followersText,
                platform: 'tiktok',
                profileUrl: url
            };

            // 💾 AUTO-SAVE: If linkId is provided, persist the metadata to the link's subtitle
            const { linkId } = req.query;
            if (linkId && typeof linkId === 'string' && (followersText || avatarUrl)) {
                try {
                    const updates: any = {};
                    if (followersText) updates.subtitle = followersText;
                    if (avatarUrl) updates.image = avatarUrl;
                    await linkService.updateLink(linkId, updates);
                    console.log(`[TikTok] Auto-saved metadata for link ${linkId}: ${followersText}`);
                } catch (saveErr) {
                    console.error(`[TikTok] Failed to auto-save metadata for link ${linkId}:`, saveErr);
                }
            }

            if (avatarUrl || followersText) tiktokCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
            return res.json(result);
        } catch (e) {
            res.status(500).json({ error: 'Server error' });
        }
    },

    /**
     * Discord logic.
     */
    async getDiscordInviteInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL required' });
            const code = url.split('/').pop()?.split('?')[0];
            if (!code) return res.status(400).json({ error: 'Invalid Discord' });

            const response = await axios.get(`https://discord.com/api/v9/invites/${code}?with_counts=true`);
            const data = response.data;
            return res.json({
                name: data.guild.name,
                online: data.approximate_presence_count || 0,
                total: data.approximate_member_count || 0,
                icon: data.guild.icon ? `https://cdn.discordapp.com/icons/${data.guild.id}/${data.guild.icon}.webp?size=128` : null,
                platform: 'discord'
            });
        } catch (e) {
            res.status(500).json({ error: 'Discord error' });
        }
    },

    /**
     * Fetches metadata for Twitch channels.
     */
    async getTwitchProfileInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            console.log(`\x1b[36m[Twitch] Initiating metadata fetch for: ${url}\x1b[0m`);
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

            // More robust username extraction
            const match = url.match(/twitch\.tv\/([^/?#\s]+)/i);
            const username = match ? match[1].replace('@', '').toLowerCase() : null;

            if (!username || username === 'directory' || username === 'search') {
                return res.status(400).json({ error: 'Invalid Twitch channel URL' });
            }

            const cacheKey = `twitch:${username}`;
            const cached = twitchCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now() && cached.data.avatarUrl) {
                return res.json(cached.data);
            }

            console.log(`[Twitch] Fetching metadata for: ${username}`);

            let name = '', avatarUrl = '', followers = '';

            const strategies = [
                // Strategy 1: GraphQL (Internal API) - Preferred
                async () => {
                    try {
                        const gqlRes = await safeFetch('https://gql.twitch.tv/gql', {
                            method: 'POST',
                            headers: {
                                'Client-Id': 'kimne78kx3ncx6brs4gm76y394zkx',
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify([{
                                operationName: 'ChannelShell',
                                variables: { login: username },
                                query: `query ChannelShell($login: String!) {
                                    user(login: $login) {
                                        displayName
                                        profileImageURL(width: 300)
                                        followers { totalCount }
                                    }
                                }`
                            }])
                        });

                        if (gqlRes.ok) {
                            const data: any = await gqlRes.json();
                            const user = data[0]?.data?.user;
                            if (user) {
                                name = user.displayName || username;
                                avatarUrl = user.profileImageURL || '';
                                const count = user.followers?.totalCount;
                                if (count !== undefined) {
                                    if (count >= 1000000) followers = (count / 1000000).toFixed(1).replace('.0', '') + 'M';
                                    else if (count >= 1000) followers = (count / 1000).toFixed(1).replace('.0', '') + 'K';
                                    else followers = count.toString();
                                }
                                return !!avatarUrl;
                            }
                        }
                    } catch (e) {
                        console.error(`[Twitch] GQL Error for ${username}:`, (e as any).message);
                    }
                    return false;
                },
                // Strategy 2: AI Brain Strategy (Smart Extraction)
                async () => {
                    try {
                        const scrapeRes = await safeFetch(`https://www.twitch.tv/${username}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
                            timeout: 8000
                        });
                        if (scrapeRes.ok) {
                            const html = await scrapeRes.text();
                            const aiData = await extractMetadataWithAI(html, 'Twitch');
                            if (aiData) {
                                if (aiData.name) name = aiData.name;
                                if (aiData.avatarUrl) avatarUrl = aiData.avatarUrl;
                                if (aiData.followers) followers = aiData.followers;
                                return !!avatarUrl || !!followers;
                            }
                        }
                    } catch (e) {
                        console.error(`[Twitch] AI Strategy Error for ${username}:`, (e as any).message);
                    }
                    return false;
                },
                // Strategy 3: Scrape via Googlebot (SSR)
                async () => {
                    try {
                        const scrapeRes = await safeFetch(`https://www.twitch.tv/${username}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
                            timeout: 8000
                        });
                        if (scrapeRes.ok) {
                            const html = await scrapeRes.text();
                            const $ = cheerio.load(html);
                            if (!name) name = $('meta[property="og:title"]').attr('content')?.split(' - ')[0] || name;
                            if (!avatarUrl) avatarUrl = $('meta[property="og:image"]').attr('content') || avatarUrl;

                            const desc = $('meta[property="og:description"]').attr('content') || '';
                            const fMatch = desc.match(/([\d.,]+[KMB]?)\s*(?:followers|seguidores)/i) ||
                                html.match(/([\d,.]+)\s*(?:&nbsp;|\u00A0|\s)*(?:mil\s*)?seguidores/i);

                            if (fMatch && !followers) {
                                followers = fMatch[1].replace(',', '.');
                            }
                            return !!avatarUrl;
                        }
                    } catch (e) {
                        console.error(`[Twitch] Scrape Error for ${username}:`, (e as any).message);
                    }
                    return false;
                }
            ];

            for (const strategy of strategies) {
                if (await strategy()) break;
            }

            const result = {
                name: name || username,
                display_name: name || username,
                username,
                avatarUrl,
                avatar_url: avatarUrl,
                followers: followers ? `${followers} Seguidores` : '',
                follower_count: parseFollowerCount(followers),
                platform: 'twitch',
                profileUrl: `https://www.twitch.tv/${username}`
            };

            // 💾 AUTO-SAVE: If linkId is provided, persist the metadata to the link's subtitle
            const { linkId } = req.query;
            if (linkId && typeof linkId === 'string' && (followers || avatarUrl)) {
                try {
                    const updates: any = {};
                    const fText = followers ? `${followers} Seguidores` : '';
                    if (fText) updates.subtitle = fText;
                    if (avatarUrl) updates.image = avatarUrl;
                    await linkService.updateLink(linkId, updates);
                    console.log(`[Twitch] Auto-saved metadata for link ${linkId}: ${fText}`);
                } catch (saveErr) {
                    console.error(`[Twitch] Failed to auto-save metadata for link ${linkId}:`, saveErr);
                }
            }

            if (avatarUrl) {
                twitchCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
            }

            return res.json(result);
        } catch (e) {
            console.error(`[Twitch] Fatal controller error:`, e);
            res.status(500).json({ error: 'Twitch integration error' });
        }
    },

    /**
     * Fetches metadata for Kick channels.
     */
    async getKickProfileInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            console.log(`\x1b[36m[Kick] Initiating metadata fetch for: ${url}\x1b[0m`);
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

            const username = url.split('/').filter(p => p).pop();
            if (!username) return res.status(400).json({ error: 'Invalid Kick URL' });

            const cacheKey = `kick:${username.toLowerCase()}`;
            const cached = kickCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);

            console.log(`[SocialController] Fetching Kick info for: ${username}`);

            let name = '';
            let avatarUrl = '';
            let followers = '';

            // Kick is tricky. We try the API first, then HTML.
            try {
                const apiRes = await safeFetch(`https://kick.com/api/v1/channels/${username}`, {
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                        'Accept': 'application/json'
                    }
                });

                if (apiRes.ok) {
                    const data: any = await apiRes.json();
                    name = data.user?.username || data.name || username;
                    avatarUrl = data.user?.profile_pic || data.user?.profile_image || data.profile_pic || '';

                    const count = data.followersCount ?? data.followers_count ?? data.subscriber_count;
                    if (count !== undefined) {
                        if (count >= 1000000) followers = (count / 1000000).toFixed(1).replace('.0', '') + 'M';
                        else if (count >= 1000) followers = (count / 1000).toFixed(1).replace('.0', '') + 'K';
                        else followers = count.toString();
                    }
                }
            } catch (e: any) {
                console.log(`[Kick] API attempt failed: ${e.message}. Trying HTML...`);
            }

            if (!avatarUrl || !followers) {
                console.log(`[Kick] Standard API failed to get all data. Triggering AI/HTML Fallback for ${username}...`);
                // Try AI Strategy as a primary fallback
                try {
                    const pageRes = await safeFetch(`https://kick.com/${username}`, {
                        timeout: 8000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
                            'Accept': 'text/html',
                        },
                    });

                    console.log(`[Kick] HTML Page Attempt status: ${pageRes.status}`);

                    if (pageRes.ok || pageRes.status === 403) {
                        const html = await pageRes.text();
                        console.log(`[Kick] HTML Length: ${html?.length || 0}`);
                        const aiData = await extractMetadataWithAI(html, 'Kick.com');
                        if (aiData) {
                            if (!name && aiData.name) name = aiData.name;
                            if (!avatarUrl && aiData.avatarUrl) avatarUrl = aiData.avatarUrl;
                            if (!followers && aiData.followers) followers = aiData.followers;
                        }

                        // Also run standard scraping logic on the same HTML just in case
                        const $ = cheerio.load(html);

                        name = name || $('meta[property="og:title"]').attr('content')?.split(' | ')[0] || username;
                        avatarUrl = avatarUrl || $('meta[property="og:image"]').attr('content') || '';

                        // Deep scan fallback for Kick's specific file structure if meta fails
                        if (!avatarUrl || avatarUrl.includes('default')) {
                            const allFilesMatches = html.match(/https:\/\/files\.kick\.com\/[^\s"']+/g);
                            if (allFilesMatches) {
                                const profileImg = allFilesMatches.find(m => m.includes('profile_image'));
                                if (profileImg) avatarUrl = profileImg.replace(/\\/g, '');
                            }
                        }

                        const metaDesc = $('meta[property="og:description"]').attr('content') || '';
                        const fMatch = metaDesc.match(/([\d.,]+[kmMB]?)\s*(?:Followers|Seguidores)/i);
                        if (fMatch && !followers) followers = fMatch[1].trim();

                        // JSON-LD or internal state scan for followers if meta fails
                        if (!followers) {
                            const folMatch = html.match(/"followers_count":\s*(\d+)/i) ||
                                html.match(/"followers":\s*(\d+)/i) ||
                                html.match(/([\d.,]+[KMB]?)\s*(?:followers|seguidores)/i);
                            if (folMatch) {
                                if (folMatch[1].match(/^\d+$/)) {
                                    const count = parseInt(folMatch[1]);
                                    if (count >= 1000000) followers = (count / 1000000).toFixed(1).replace('.0', '') + 'M';
                                    else if (count >= 1000) followers = (count / 1000).toFixed(1).replace('.0', '') + 'K';
                                    else followers = count.toString();
                                } else {
                                    followers = folMatch[1].trim();
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.log('[SocialController] Kick AI/HTML error:', (e as any).message);
                }
            }

            const followersText = followers ? `${followers} Seguidores` : '';
            const result = {
                name: name || username,
                display_name: name || username,
                username,
                avatarUrl: avatarUrl || '',
                avatar_url: avatarUrl || '',
                followers: followersText,
                follower_count: parseFollowerCount(followersText),
                subscribers: followersText,
                platform: 'kick',
                profileUrl: url
            };

            // 💾 AUTO-SAVE: If linkId is provided, persist the metadata to the link's subtitle
            const { linkId } = req.query;
            if (linkId && typeof linkId === 'string' && (followersText || avatarUrl)) {
                try {
                    const updates: any = {};
                    if (followersText) updates.subtitle = followersText;
                    if (avatarUrl) updates.image = avatarUrl;
                    const updatedLink = await linkService.updateLink(linkId, updates);
                    console.log(`[Kick] Auto-saved metadata for link ${linkId}: ${followersText}`);

                    // 📢 Notify Realtime Manager to refresh clients
                    if (updatedLink && updatedLink.userId) {
                        const { data: user } = await supabase.from('users').select('username').eq('id', updatedLink.userId).maybeSingle();
                        if (user?.username) {
                            realtimeManager.notifyUpdate(user.username);
                        }
                    }
                } catch (saveErr) {
                    console.error(`[Kick] Failed to auto-save metadata for link ${linkId}:`, saveErr);
                }
            }

            if (avatarUrl) kickCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
            return res.json(result);
        } catch (e: any) {
            console.error('[SocialController] getKickProfileInfo error:', e);
            res.status(500).json({ error: 'Kick server error' });
        }
    },

    /**
     * Unified search.
     */
    async getSocialMetadata(req: Request, res: Response) {
        const { url } = req.query;
        if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL required' });

        const lowerUrl = url.toLowerCase();
        console.log(`[SocialMetadata] Unified fetch for: ${url}`);

        if (lowerUrl.includes('instagram.com')) {
            console.log('[SocialMetadata] Routing to Instagram handler');
            return socialController.getInstagramProfileInfo(req, res);
        }
        if (lowerUrl.includes('tiktok.com')) {
            console.log('[SocialMetadata] Routing to TikTok handler');
            return socialController.getTiktokProfileInfo(req, res);
        }
        if (lowerUrl.includes('twitch.tv')) {
            console.log('[SocialMetadata] Routing to Twitch handler');
            return socialController.getTwitchProfileInfo(req, res);
        }
        if (lowerUrl.includes('kick.com')) {
            console.log('[SocialMetadata] Routing to Kick handler');
            return socialController.getKickProfileInfo(req, res);
        }

        try {
            console.log('[SocialMetadata] Falling back to generic/youtube scraper');
            const safeRes = await safeFetch(url, { timeout: 5000, headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
            const html = await safeRes.text();
            
            // Try AI extraction for generic links first
            const aiData = await extractMetadataWithAI(html, 'Social Media Profile');
            
            const $ = cheerio.load(html);

            let followers = aiData?.followers || '';
            let platform = aiData?.platform || 'unknown';
            let avatarUrl = aiData?.avatarUrl || $('meta[property="og:image"]').attr('content') || '';
            let name = aiData?.name || $('meta[property="og:title"]').attr('content') || '';

            if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
                platform = 'youtube';
                if (!followers) {
                    const metaDesc = $('meta[name="description"]').attr('content') || '';
                    const dMatch = metaDesc.match(/([\d.,]+(?:K|M|B|mil|mi|milhão|milhões|thousand|million|billion)?)\s*(inscritos|subscribers)/i);
                    if (dMatch) followers = dMatch[1].trim() + ' inscritos';
                }
            }

            console.log(`[SocialMetadata] Generic result: platform=${platform}, followers=${followers}, avatar=${avatarUrl ? 'yes' : 'no'}`);
            return res.json({
                followers: followers || null,
                follower_count: parseFollowerCount(followers),
                subscribers: followers || null,
                platform,
                name,
                display_name: name,
                avatarUrl,
                avatar_url: avatarUrl,
                url
            });
        } catch (e) {
            console.error('[SocialMetadata] Scrape failed:', (e as any).message);
            res.status(500).json({ error: 'Scrape failed' });
        }
    },

    async shareProfile(req: Request, res: Response) {
        try {
            const { username } = req.params;
            const profile = await profileService.getProfileByUsername(username);
            if (!profile) return res.status(404).send('Not found');
            const ogImage = profile.avatarUrl || 'https://nodus.my/og-default.png';
            const html = `<html><head><title>${profile.name}</title><meta property="og:image" content="${ogImage}"><script>window.location.href = "https://nodus.my/${username}";</script></head><body>Redirecting...</body></html>`;
            res.send(html);
        } catch (e) { res.status(500).send('Error'); }
    },

    async shareBlog(req: Request, res: Response) {
        try {
            const { slug } = req.params;
            const post = await blogService.getPostBySlug(slug);
            if (!post) return res.status(404).send('Not found');
            const html = `<html><head><title>${post.title}</title><meta property="og:image" content="${post.imageUrl}"><script>window.location.href = "https://nodus.my/blog/${slug}";</script></head><body>Redirecting...</body></html>`;
            res.send(html);
        } catch (e) { res.status(500).send('Error'); }
    }
};
