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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const igCache = new Map<string, { data: any, expiresAt: number }>();
const tiktokCache = new Map<string, { data: any, expiresAt: number }>();

const twitchCache = new Map<string, { data: any; expiresAt: number }>();
const kickCache = new Map<string, { data: any; expiresAt: number }>();

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
 * SOCIAL EXTRACTION CONTROLLER
 */
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

            // 🔍 PRE-CHECK: If we already have good data in DB, skip scraping
            const { linkId } = req.query;
            if (linkId && typeof linkId === 'string') {
                try {
                    const { data: currentLink } = await supabase.from('links').select('subtitle, image').eq('id', linkId).maybeSingle();
                    if (currentLink?.subtitle && currentLink?.image) {
                        console.log(`[YouTube] Link ${linkId} already has metadata. Skipping.`);
                        return res.json({
                            name: 'YouTube Channel',
                            avatarUrl: currentLink.image,
                            subscribers: currentLink.subtitle,
                            platform: 'youtube',
                            channelUrl: url
                        });
                    }
                } catch (err) {
                    console.error('[YouTube] Pre-check failed:', err);
                }
            }

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
            if (linkId && typeof linkId === 'string' && (subscribersText || avatarUrl)) {
                try {
                    const updates: any = {};
                    if (subscribersText) updates.subtitle = subscribersText;
                    if (avatarUrl) updates.image = avatarUrl;
                    
                    const updatedLink = await linkService.updateLink(linkId, updates);
                    console.log(`[YouTube] Auto-saved metadata for link ${linkId}: ${subscribersText}`);

                    // 📢 Notify Realtime Manager
                    if (updatedLink && updatedLink.userId) {
                        const { data: user } = await supabase.from('users').select('username').eq('id', updatedLink.userId).maybeSingle();
                        if (user?.username) realtimeManager.notifyUpdate(user.username);
                    }
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
     * Fetches metadata for Instagram profiles.
     * Uses Jina AI Reader (renders page like a real browser in the cloud) + AI extraction.
     * Saves to DB once and never re-fetches.
     */
    async getInstagramProfileInfo(req: Request, res: Response) {
        try {
            const { url, linkId } = req.query;
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

            const cleanUrl = url.split('?')[0].split('#')[0];
            const username = cleanUrl.match(/instagram\.com\/([^\/\?#]+)/i)?.[1]?.replace('@', '') || '';

            // 1. DB Cache — se já temos dados, retorna direto
            if (linkId && typeof linkId === 'string') {
                const { data: link } = await supabase.from('links').select('subtitle, image').eq('id', linkId).maybeSingle();
                if (link?.image && !link.image.includes('static.cdninstagram.com')) {
                    return res.json({
                        name: username, username, avatarUrl: link.image, avatar_url: link.image,
                        followers: link.subtitle || '', platform: 'instagram', profileUrl: cleanUrl
                    });
                }
            }

            console.log(`[Instagram] Fetching: ${username}`);
            let avatarUrl = '', followers = '', name = username;

            // ─── ESTRATÉGIA 1: oEmbed oficial (nunca bloqueado, retorna thumbnail + nome) ───
            try {
                const oembedRes = await safeFetch(
                    `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(`https://www.instagram.com/${username}/`)}&fields=author_name,thumbnail_url&access_token=application_access_token`,
                    { timeout: 5000 }
                );
                // tenta sem token também — o endpoint sem token ainda responde para perfis públicos
                const oembedPublic = await safeFetch(
                    `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(`https://www.instagram.com/${username}/`)}`,
                    { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }
                );
                if (oembedPublic.ok) {
                    const data = await oembedPublic.json() as any;
                    if (data.author_name) name = data.author_name;
                    if (data.thumbnail_url) avatarUrl = data.thumbnail_url;
                }
            } catch (e) { }

            // ─── ESTRATÉGIA 2: Jina Reader (renderiza JS, contorna bloqueio) ───
            if (!avatarUrl || !followers) {
                try {
                    const jinaRes = await safeFetch(`https://r.jina.ai/https://www.instagram.com/${username}/`, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'text/html',
                            'X-Return-Format': 'html',
                        },
                        timeout: 12000
                    });
                    if (jinaRes.ok) {
                        const raw = await jinaRes.text();
                        // Desescapa múltiplas camadas
                        let clean = raw;
                        for (let i = 0; i < 3; i++) {
                            clean = clean.replace(/\\u0026/g, '&').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\\//g, '/');
                        }

                        // Seguidores: busca pelo padrão title="407" próximo de "seguidores"
                        if (!followers) {
                            // Padrão 1: title="407" ... seguidores
                            const titleFol = clean.match(/title\s*=\s*["']([\d.,]+)["'][^<]{0,200}seguidores/i)
                                          || clean.match(/seguidores[^<]{0,200}title\s*=\s*["']([\d.,]+)["']/i);
                            if (titleFol) followers = titleFol[1];
                        }
                        if (!followers) {
                            // Padrão 2: número bruto antes de "seguidores" ou "followers"
                            const bruteFol = clean.match(/([\d.,]+[KMBkmb]?)(?:<[^>]+>|\s)*(?:seguidores|followers)/i);
                            if (bruteFol) followers = bruteFol[1];
                        }
                        if (!followers) {
                            // Padrão 3: JSON inline edge_followed_by
                            const jsonFol = clean.match(/edge_followed_by[^}]{0,60}count["\s:]+(\d+)/i)
                                         || clean.match(/followers_count["\s:]+(\d+)/i);
                            if (jsonFol) {
                                const n = parseInt(jsonFol[1]);
                                if (n >= 1_000_000) followers = (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
                                else if (n >= 1_000) followers = (n / 1_000).toFixed(1).replace('.0', '') + 'K';
                                else followers = n.toString();
                            }
                        }

                        // Avatar: CDN do Instagram tem assinatura t51
                        if (!avatarUrl) {
                            const cdnLinks = clean.match(/https:\/\/[^"'\s\\]+scontent[^"'\s\\]+t51[^"'\s\\]+\.jpg[^"'\s\\]*/gi);
                            if (cdnLinks) {
                                for (const link of cdnLinks) {
                                    if (!link.includes('static')) { avatarUrl = link.replace(/&amp;/g, '&'); break; }
                                }
                            }
                        }

                        // Cheerio para og:image e og:description como fallback
                        if (!avatarUrl || !followers) {
                            const $ = cheerio.load(raw);
                            if (!avatarUrl) {
                                const og = $('meta[property="og:image"]').attr('content');
                                if (og && !og.includes('static')) avatarUrl = og;
                            }
                            if (!followers) {
                                const desc = $('meta[property="og:description"]').attr('content') || '';
                                const m = desc.match(/([\d.,]+[KMBkmb]?)\s*(?:Followers|Seguidores)/i);
                                if (m) followers = m[1];
                            }
                        }
                    }
                } catch (e) { console.log(`[Instagram] Jina failed: ${(e as any).message}`); }
            }

            // ─── ESTRATÉGIA 3: Embed page (fallback) ───
            if (!avatarUrl || !followers) {
                try {
                    const embedRes = await safeFetch(`https://www.instagram.com/${username}/embed/`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
                        timeout: 8000
                    });
                    if (embedRes.ok) {
                        const raw = await embedRes.text();
                        let clean = raw;
                        for (let i = 0; i < 3; i++) {
                            clean = clean.replace(/\\u0026/g, '&').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\\//g, '/');
                        }
                        const $ = cheerio.load(raw);

                        if (!avatarUrl) {
                            // Procura CDN t51 no embed
                            const cdnLinks = clean.match(/https:\/\/[^"'\s\\]+scontent[^"'\s\\]+t51[^"'\s\\]+\.jpg[^"'\s\\]*/gi);
                            if (cdnLinks) for (const l of cdnLinks) { if (!l.includes('static')) { avatarUrl = l.replace(/&amp;/g, '&'); break; } }
                            // Fallback DOM
                            if (!avatarUrl) {
                                $('img').each((_i, el) => {
                                    const src = $(el).attr('src') || '';
                                    if (src.includes('scontent') && src.includes('t51')) { avatarUrl = src; return false; }
                                });
                            }
                        }

                        if (!followers) {
                            const titleFol = clean.match(/title\s*=\s*["']([\d.,]+)["'][^<]{0,200}(?:seguidores|followers)/i);
                            if (titleFol) followers = titleFol[1];
                            if (!followers) {
                                $('*').each((_i, el) => {
                                    const t = $(el).attr('title') || '';
                                    const txt = $(el).text();
                                    if (/^\d+$/.test(t) && (txt.includes('seguidores') || txt.includes('followers'))) {
                                        followers = t; return false;
                                    }
                                });
                            }
                        }
                    }
                } catch (e) { }
            }

            console.log(`[Instagram] Final: name="${name}", followers="${followers}", avatar=${!!avatarUrl}`);

            const followersText = followers ? `${followers} Seguidores` : '';

            // Wrap avatar through backend proxy to avoid browser CORS errors with Instagram CDN
            const backendBase = process.env.BACKEND_URL || 'https://api.nodus.my';
            const proxiedAvatar = avatarUrl
                ? `${backendBase}/api/social/proxy-image?url=${encodeURIComponent(avatarUrl)}`
                : false;

            const result = {
                name, display_name: name, username, platform: 'instagram', profileUrl: cleanUrl,
                avatarUrl: proxiedAvatar, avatar_url: proxiedAvatar,
                followers: followersText,
                follower_count: parseFollowerCount(followersText)
            };

            // 4. Persistência
            if (linkId && typeof linkId === 'string' && (followers || avatarUrl)) {
                try {
                    const updates: any = {};
                    if (followers) updates.subtitle = followersText;
                    if (avatarUrl) updates.image = proxiedAvatar; // save proxied URL
                    const { data: updatedLink } = await supabase.from('links').update(updates).eq('id', linkId).select('userId').single();
                    if (updatedLink?.userId) {
                        const { data: user } = await supabase.from('users').select('username').eq('id', updatedLink.userId).maybeSingle();
                        if (user?.username) realtimeManager.notifyUpdate(user.username);
                    }
                } catch (e) { }
            }

            return res.json(result);
        } catch (e) {
            return res.status(500).json({ error: 'Server error' });
        }
    },

    async getTiktokProfileInfo(req: Request, res: Response) {

        try {
            const { url, linkId } = req.query;
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

            const handle = url.split('/').find(p => p.startsWith('@'))?.replace('@', '') || url.split('/').pop() || '';
            const cacheKey = `tiktok:${handle.toLowerCase()}`;
            
            const cached = tiktokCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);

            let avatarUrl = '', followers = '', name = '';
            try {
                const page = await safeFetch(url, { headers: { 'User-Agent': 'facebookexternalhit/1.1' }, timeout: 8000 });
                if (page.ok) {
                    const html = await page.text();
                    const $ = cheerio.load(html);
                    avatarUrl = $('meta[property="og:image"]').attr('content') || '';
                    name = $('meta[property="og:title"]').attr('content')?.split(' | ')[0] || handle;
                    const desc = $('meta[property="og:description"]').attr('content') || '';
                    followers = desc.match(/([\d.,]+[kmMB]?)\s*(?:Followers|Seguidores)/i)?.[1] || '';
                }
            } catch (e) { }

            const followersText = followers ? `${followers} Seguidores` : '';
            const result = {
                name: `@${handle}`, display_name: `@${handle}`, username: handle,
                avatarUrl, avatar_url: avatarUrl, followers: followersText,
                follower_count: parseFollowerCount(followersText),
                platform: 'tiktok', profileUrl: url
            };

            if (linkId && typeof linkId === 'string' && (followers || avatarUrl)) {
                try {
                    const updates: any = {};
                    if (followers) updates.subtitle = followersText;
                    if (avatarUrl) updates.image = avatarUrl;
                    await linkService.updateLink(linkId, updates);
                } catch (e) { }
            }

            tiktokCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
            return res.json(result);
        } catch (e) {
            return res.status(500).json({ error: 'Server error' });
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

            // 🔍 PRE-CHECK: If we already have good data in DB, skip scraping
            const { linkId } = req.query;
            if (linkId && typeof linkId === 'string') {
                try {
                    const { data: currentLink } = await supabase.from('links').select('subtitle, image').eq('id', linkId).maybeSingle();
                    if (currentLink?.subtitle && currentLink?.image) {
                        console.log(`[Twitch] Link ${linkId} already has metadata. Skipping.`);
                        return res.json({
                            name: username,
                            username,
                            avatarUrl: currentLink.image,
                            followers: currentLink.subtitle,
                            platform: 'twitch',
                            profileUrl: `https://www.twitch.tv/${username}`
                        });
                    }
                } catch (err) {
                    console.error('[Twitch] Pre-check failed:', err);
                }
            }

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
                // Strategy 2: Scrape via Googlebot (SSR) + Deep Scan
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
                                         html.match(/([\d,.]+)\s*(?:&nbsp;|\u00A0|\s)*(?:mil\s*)?seguidores/i) ||
                                         html.match(/"followers":\s*\{\s*"total":\s*(\d+)/); // Deep JSON scan

                            if (fMatch && !followers) {
                                followers = fMatch[1].replace(',', '.');
                                console.log(`[Twitch] Found followers via Scrape/Deep Scan: ${followers}`);
                            }
                            return !!avatarUrl || !!followers;
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

            // 💾 AUTO-SAVE: If linkId is provided, persist the metadata
            if (linkId && typeof linkId === 'string' && (followers || avatarUrl)) {
                try {
                    const updates: any = {};
                    const fText = followers ? `${followers} Seguidores` : '';
                    if (fText) updates.subtitle = fText;
                    if (avatarUrl) updates.image = avatarUrl;
                    
                    const updatedLink = await linkService.updateLink(linkId, updates);
                    console.log(`[Twitch] Auto-saved metadata for link ${linkId}: ${fText}`);

                    // 📢 Notify Realtime Manager
                    if (updatedLink && updatedLink.userId) {
                        const { data: user } = await supabase.from('users').select('username').eq('id', updatedLink.userId).maybeSingle();
                        if (user?.username) realtimeManager.notifyUpdate(user.username);
                    }
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

            // 🔍 PRE-CHECK: If we already have good data in DB, skip scraping
            const { linkId } = req.query;
            if (linkId && typeof linkId === 'string') {
                try {
                    const { data: currentLink } = await supabase.from('links').select('subtitle, image').eq('id', linkId).maybeSingle();
                    if (currentLink?.subtitle && currentLink?.image) {
                        console.log(`[Kick] Link ${linkId} already has metadata. Skipping.`);
                        return res.json({
                            name: username,
                            username,
                            avatarUrl: currentLink.image,
                            followers: currentLink.subtitle,
                            platform: 'kick',
                            profileUrl: url
                        });
                    }
                } catch (err) {
                    console.error('[Kick] Pre-check failed:', err);
                }
            }

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

                        // Run standard scraping logic on the HTML
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
            
            const $ = cheerio.load(html);

            let followers = '';
            let platform = 'unknown';
            let avatarUrl = $('meta[property="og:image"]').attr('content') || '';
            let name = $('meta[property="og:title"]').attr('content') || '';

            if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
                platform = 'youtube';
                if (!followers) {
                    const metaDesc = $('meta[name="description"]').attr('content') || '';
                    const dMatch = metaDesc.match(/([\d.,]+[KMB]?)\s*(?:inscritos|subscribers)/i);
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
    },

    /**
     * Image proxy — serves Instagram/CDN images through the server to bypass browser CORS.
     * GET /api/social/proxy-image?url=<encoded_cdn_url>
     */
    async proxyImage(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

            // Only allow Instagram CDN and known safe origins
            const allowed = ['scontent', 'cdninstagram.com', 'fbcdn.net', 'cdntiktok.com', 'tiktokcdn.com', 'static-cdn.jtvnw.net'];
            const isAllowed = allowed.some(d => url.includes(d));
            if (!isAllowed) return res.status(403).json({ error: 'Domain not allowed' });

            const imgRes = await safeFetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Referer': 'https://www.instagram.com/',
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                },
                timeout: 10000
            });

            if (!imgRes.ok) return res.status(502).json({ error: 'Upstream error' });

            const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
            const buffer = await imgRes.arrayBuffer();

            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 24h no browser
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.send(Buffer.from(buffer));
        } catch (e) {
            res.status(500).json({ error: 'Proxy error' });
        }
    }
};
