// Backend Social Metadata Scraper - Updated Profile Logic
import { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { profileService } from '../services/profileService.js';
import { blogService } from '../services/blogService.js';
import axios from 'axios';
import { safeFetch, validateUserUrl, SsrfError } from '../utils/ssrfGuard.js';

// In-memory cache for social profiles (avoids hitting rate limits)
const igCache = new Map<string, { data: any; expiresAt: number }>();
const tiktokCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

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
            return res.json({
                name: name || '',
                avatarUrl,
                subscribers: subscribersText,
                platform: 'youtube',
                channelUrl: url
            });
        } catch (error: any) {
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /**
     * Fetches metadata for Instagram profiles (username, name, avatar, follower count).
     */
    async getInstagramProfileInfo(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

            const cleanUrl = url.split('?')[0].split('#')[0];
            const handleMatch = cleanUrl.match(/instagram\.com\/([^\/\?]+)/i);
            let username = handleMatch ? handleMatch[1].replace('@', '') : '';

            // Check cache
            const cacheKey = `ig:${username.toLowerCase()}`;
            const cached = igCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);

            console.log(`[SocialController] Fetching IG info (Stable HTML) for: ${username}`);

            let name = '';
            let avatarUrl = '';
            let followers = '';

            // Strategy 1: HTML Fallback
            if (!name || !avatarUrl || !followers) {
                try {
                    const pageRes = await safeFetch(cleanUrl, {
                        timeout: 8000,
                        headers: { 'User-Agent': 'facebookexternalhit/1.1' },
                    });

                    if (pageRes.ok) {
                        const html = await pageRes.text();
                        const $ = cheerio.load(html);
                        const metaDesc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
                        const ogTitle = $('meta[property="og:title"]').attr('content') || '';
                        
                        if (!followers && metaDesc) {
                            const match = metaDesc.match(/([\d.,]+[KMB]?) (?:Followers|Seguidores)/i) || metaDesc.match(/^([\d.,]+)/);
                            if (match) followers = match[1];
                        }
                        avatarUrl = avatarUrl || $('meta[property="og:image"]').attr('content') || '';
                        if (!name) name = ogTitle.split(' (@')[0].replace('Instagram', '').trim();
                    }
                } catch (e) {
                    console.log('[SocialController] IG HTML error:', (e as any).message);
                }
            }

            const followersText = followers ? `${followers} Seguidores` : '';
            const result = {
                name: name || username || 'Instagram',
                username,
                avatarUrl,
                followers: followersText,
                subscribers: followersText,
                platform: 'instagram',
                profileUrl: cleanUrl
            };

            if (avatarUrl || followersText) igCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
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
                    const $ = cheerio.load(html);
                    const metaDesc = $('meta[property="og:description"]').attr('content') || '';
                    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
                    
                    const fMatch = metaDesc.match(/([\d.,km\s]+)\s*(?:Followers|Seguidores)/i);
                    if (fMatch) followers = fMatch[1].trim();
                    avatarUrl = $('meta[property="og:image"]').attr('content') || '';
                    name = ogTitle.split(' | TikTok')[0].trim();
                }
            } catch (e) {
                console.log('[SocialController] TikTok error:', (e as any).message);
            }

            const followersText = followers ? `${followers} Seguidores` : '';
            const result = {
                name: `@${handle.replace('@', '')}`,
                username: handle,
                avatarUrl,
                followers: followersText,
                subscribers: followersText,
                platform: 'tiktok',
                profileUrl: url
            };

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
        
        try {
            console.log('[SocialMetadata] Falling back to generic/youtube scraper');
            const safeRes = await safeFetch(url, { timeout: 5000, headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
            const html = await safeRes.text();
            const $ = cheerio.load(html);
            
            let followers = '';
            let platform = 'unknown';
            let avatarUrl = $('meta[property="og:image"]').attr('content') || '';
            let name = $('meta[property="og:title"]').attr('content') || '';

            if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
                platform = 'youtube';
                const metaDesc = $('meta[name="description"]').attr('content') || '';
                const dMatch = metaDesc.match(/([\d.,]+\s*(?:K|M|B|mil|mi|milhão|milhões)?) (inscritos|subscribers)/i);
                if (dMatch) followers = dMatch[1].trim() + ' inscritos';
            }

            console.log(`[SocialMetadata] Generic result: platform=${platform}, followers=${followers}, avatar=${avatarUrl ? 'yes' : 'no'}`);
            return res.json({ followers: followers || null, subscribers: followers || null, platform, name, avatarUrl, url });
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
