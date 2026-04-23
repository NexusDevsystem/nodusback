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
            const { url } = req.query;
            if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

            const cleanUrl = url.split('?')[0].split('#')[0];
            const handleMatch = cleanUrl.match(/instagram\.com\/([^\/\?]+)/i);
            const username = handleMatch ? handleMatch[1].replace('@', '') : '';
            const { linkId } = req.query;

            // ✅ STEP 1: If we already saved this data in DB, return immediately
            if (linkId && typeof linkId === 'string') {
                const { data: currentLink } = await supabase.from('links').select('subtitle, image').eq('id', linkId).maybeSingle();
                if (currentLink?.image && !currentLink.image.includes('static.cdninstagram.com')) {
                    console.log(`[Instagram] Returning saved data for link ${linkId}`);
                    return res.json({
                        name: username, username,
                        avatarUrl: currentLink.image, avatar_url: currentLink.image,
                        followers: currentLink.subtitle || '', subscribers: currentLink.subtitle || '',
                        follower_count: parseFollowerCount(currentLink.subtitle || ''),
                        platform: 'instagram', profileUrl: cleanUrl
                    });
                }
            }

            // 🌐 STEP 2: Fetch the page content (Jina Reader renders like a real browser)
            console.log(`[Instagram] Fetching profile for: ${username}`);
            let name = '', avatarUrl = '', followers = '';
            let bestHtml = '';

            // Strategy A: Jina AI Reader — renders the page with a real browser in the cloud
            try {
                const jinaRes = await safeFetch(`https://r.jina.ai/${cleanUrl}`, {
                    headers: {
                        'Accept': 'text/html',
                        'X-Return-Format': 'html',
                        'X-Wait-For-Selector': 'header img',
                    },
                    timeout: 20000
                });
                if (jinaRes.ok) {
                    bestHtml = await jinaRes.text();
                    console.log(`[Instagram] Jina Reader: ${bestHtml.length} bytes`);
                }
            } catch (e) {
                console.log(`[Instagram] Jina Reader failed: ${(e as any).message}`);
            }

            // 🔍 STRATEGY 1: Discovery via Search Engine Proxy (Very high success, bypasses bot detection)
            try {
                console.log(`[Instagram] Discovery Strategy (Jina Search) for: ${username}`);
                // Search specifically for the profile metadata on a search engine proxy
                const searchRes = await safeFetch(`https://s.jina.ai/instagram.com/${username}`, { timeout: 10000 });
                if (searchRes.ok) {
                    const searchHtml = await searchRes.text();
                    console.log(`[Instagram] Discovery Success: ${searchHtml.length} bytes`);
                    
                    // Look for followers in search snippet patterns (e.g., "407 followers", "5.5K seguidores")
                    const folMatch = searchHtml.match(/([\d.,]+[KMB]?)\s*(?:Followers|Seguidores)/i) ||
                                    searchHtml.match(/Followers:\s*([\d.,]+[KMB]?)/i) ||
                                    searchHtml.match(/Seguidores:\s*([\d.,]+[KMB]?)/i);
                    if (folMatch && !followers) {
                        followers = folMatch[1];
                        console.log(`[Instagram] Discovery found followers: ${followers}`);
                    }

                    // Look for profile pic in markdown or raw URLs
                    const picMatch = searchHtml.match(/!\[.*?\]\((https:\/\/scontent[^)]+)\)/) ||
                                    searchHtml.match(/https:\/\/scontent[^"'\s)]+t51[^"'\s)]+/i);
                    if (picMatch && !avatarUrl) {
                        avatarUrl = (picMatch[1] || picMatch[0]).replace(/&amp;/g, '&');
                        console.log(`[Instagram] Discovery found avatar: ${avatarUrl.substring(0, 50)}...`);
                    }
                    
                    if (followers && avatarUrl) {
                        bestHtml = searchHtml; // Save for fallback parsing if needed
                    }
                }
            } catch (e) {
                console.log(`[Instagram] Discovery Strategy failed: ${(e as any).message}`);
            }

            // 🔍 STRATEGY 2: Official JSON Bridge (Hidden API)
            if (!followers || !avatarUrl) {
                try {
                    console.log(`[Instagram] API Bridge Strategy for: ${username}`);
                    const apiRes = await safeFetch(`https://www.instagram.com/${username}/?__a=1&__d=dis`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1' },
                        timeout: 5000
                    });
                    if (apiRes.ok) {
                        const json = await apiRes.json() as any;
                        const user = json.graphql?.user || json.show_suggestions?.users?.[0];
                        if (user) {
                            if (!name) name = user.full_name || user.username;
                            if (!avatarUrl) avatarUrl = user.profile_pic_url_hd || user.profile_pic_url;
                            if (!followers) {
                                const count = user.edge_followed_by?.count || user.follower_count;
                                if (count) {
                                    if (count >= 1000000) followers = (count / 1000000).toFixed(1).replace('.0', '') + 'M';
                                    else if (count >= 1000) followers = (count / 1000).toFixed(1).replace('.0', '') + 'K';
                                    else followers = count.toString();
                                }
                            }
                            console.log(`[Instagram] API Bridge success!`);
                        }
                    }
                } catch (e) {
                    console.log(`[Instagram] API Bridge failed (expected if no cookies)`);
                }
            }

            // Strategy 3: Instagram Embed (Powerful fallback)
            if (!followers || !avatarUrl) {
                try {
                    console.log(`[Instagram] Trying Embed Strategy for: ${username}`);
                    const embedRes = await safeFetch(`https://www.instagram.com/${username}/embed/`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
                        timeout: 8000
                    });
                    if (embedRes.ok) {
                        const embedHtml = await embedRes.text();
                        if (embedHtml.length > 5000) {
                            bestHtml = embedHtml;
                            console.log(`[Instagram] Embed Strategy Success: ${embedHtml.length} bytes`);
                        }
                    }
                } catch (e) {
                    console.log(`[Instagram] Embed Strategy failed: ${(e as any).message}`);
                }
            }

            // Strategy 4: Direct HTTP with multiple User-Agents (fallback)
            if (!followers || !avatarUrl) {
                const userAgents = [
                    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                    'WhatsApp/2.23.20.0 A',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                ];
                for (const ua of userAgents) {
                    try {
                        const pageRes = await safeFetch(cleanUrl, {
                            headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' },
                            timeout: 8000
                        });
                        if (pageRes.ok) {
                            const html = await pageRes.text();
                            const hasData = html.includes('profile_pic_url') || html.includes('edge_followed_by') || html.includes('seguidores');
                            if (hasData) { bestHtml = html; break; }
                        }
                    } catch (e) { }
                }
            }

            // 🔍 Extract data from whatever HTML we got
            if (bestHtml) {
                // 🧹 CLEANUP: Create a cleaned version for Regex matching, but PRESERVE original for Cheerio
                let searchHtml = bestHtml;
                for (let i = 0; i < 3; i++) {
                    searchHtml = searchHtml
                        .replace(/\\u0026/g, '&')
                        .replace(/\\n/g, '\n')
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, '\\')
                        .replace(/\\\//g, '/');
                }
                
                // Use the cleaned HTML for matching
                // ... (rest of the regex matching)

                // 🎯 "JUST THE NUMBER" Strategy: Direct extraction without over-engineering
                const simpleFol = searchHtml.match(/followers_count["']?\s*[:=]\s*(\\?["'])?(\d+)/i) ||
                                 searchHtml.match(/edge_followed_by["']?\s*[:=]\s*\{[^}]*count["']?\s*[:=]\s*(\\?["'])?(\d+)/i) ||
                                 searchHtml.match(/edge_followed_by["']?\s*[:=]\s*(\\?["'])?(\d+)/i);
                
                if (simpleFol) {
                    const rawCount = parseInt(simpleFol[1]);
                    if (!isNaN(rawCount)) {
                        if (rawCount >= 1000000) followers = (rawCount / 1000000).toFixed(1).replace('.0', '') + 'M';
                        else if (rawCount >= 1000) followers = (rawCount / 1000).toFixed(1).replace('.0', '') + 'K';
                        else followers = rawCount.toString();
                        console.log(`[Instagram] Captured raw number: ${followers}`);
                    }
                }

                if (!followers) {
                    const fallbackFol = bestHtml.match(/([\d.,KMB]+)\s*(?:Followers|Seguidores)/i);
                    if (fallbackFol) followers = fallbackFol[1].toUpperCase();
                }

                const picMatch = searchHtml.match(/profile_pic_url(?:_hd)?["'\\ ]+\s*[:=]\s*["'\\ ]+(https:[^"' \n]+)/i) ||
                                searchHtml.match(/https:\/\/scontent[^"'\s)]+\.jpg/i);
                if (picMatch) {
                    const candidate = (picMatch[1] || picMatch[0]).replace(/&amp;/g, '&');
                    if (!candidate.includes('static.cdninstagram.com') && candidate.startsWith('http')) {
                        avatarUrl = candidate;
                        console.log(`[Instagram] Found avatar: ${avatarUrl.substring(0, 50)}...`);
                    }
                }

                // 📦 DEEP SCAN: Handle Instagram's escaped contextJSON (found in embeds)
                // 📦 DEEP SCAN: Handle Instagram's escaped contextJSON
                const contextMatch = searchHtml.match(/["']contextJSON["']\s*:\s*["'](.+?)["']\s*[,}]/);
                if (contextMatch) {
                    try {
                        // Unescape the JSON string inside the HTML
                        const rawJson = contextMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\\/ /g, '/');
                        const context = JSON.parse(rawJson);
                        const user = context.context || context;
                        if (user) {
                            if (!name && (user.full_name || user.name)) name = user.full_name || user.name;
                            if (!avatarUrl && (user.profile_pic_url || user.profile_image)) avatarUrl = user.profile_pic_url || user.profile_image;
                            if (!followers && (user.followers_count || user.follower_count)) followers = (user.followers_count || user.follower_count).toString();
                            console.log(`[Instagram] Deep scan success: name="${name}", followers="${followers}"`);
                        }
                    } catch (e) {
                        console.log(`[Instagram] Deep scan failed: ${(e as any).message}`);
                    }
                }

                // og:meta tags via cheerio
                const $ = cheerio.load(bestHtml);
                const pageTitle = $('title').text() || '';
                console.log(`[Instagram] Page title: "${pageTitle}", HTML Size: ${bestHtml.length}`);

                if (!avatarUrl || !followers) {
                    if (!avatarUrl) {
                        const ogImage = $('meta[property="og:image"]').attr('content');
                        // Embed selector fallback
                        const embedPic = $('.Avatar').attr('src') || $('.EmbedAccountImage').attr('src') || $('.profile-pic').attr('src') || $('header img').attr('src');
                        avatarUrl = (ogImage && !ogImage.includes('static.cdninstagram.com')) ? ogImage : (embedPic || avatarUrl);
                        
                        // Last resort Cheerio: Scan ALL images for scontent pattern or profile alt text
                        if (!avatarUrl) {
                            $('img').each((i, el) => {
                                const src = $(el).attr('src');
                                const alt = $(el).attr('alt') || '';
                                if (src && src.includes('scontent') && (
                                    src.includes('/t51.2885-19/') || 
                                    src.includes('/v/t51.82787-19/') ||
                                    alt.toLowerCase().includes('foto do perfil') ||
                                    alt.toLowerCase().includes('profile picture')
                                )) {
                                    avatarUrl = src;
                                    console.log(`[Instagram] Cheerio found avatar via img/alt scan: ${avatarUrl.substring(0, 50)}...`);
                                    return false; // break
                                }
                            });
                        }
                    }
                    if (!followers) {
                        const desc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
                        // Embed selector fallback
                        const embedFollowers = $('.EmbedAccountFollowers').text() || $('.FollowersCount').text() || $('.followed-by').text();
                        // 🇧🇷 Deep Portuguese/English Fallback: Check for "seguidores" or "followers" in any tag
                        $('*').each((i, el) => {
                            const text = $(el).text().trim();
                            const title = $(el).attr('title') || '';
                            
                            // Exact match from user: <span title="407">...</span> seguidores
                            if (title && /^\d+$/.test(title) && (text.includes('seguidores') || text.includes('followers'))) {
                                followers = title;
                                console.log(`[Instagram] Cheerio found followers via title attribute: ${followers}`);
                                return false;
                            }

                            if (text.toLowerCase().includes('seguidores') || text.toLowerCase().includes('followers')) {
                                // Found the label, look for the number in the text, title, or parent
                                const numMatch = text.match(/([\d.,]+[KMB]?)/) || title.match(/([\d.,]+[KMB]?)/) || $(el).parent().text().match(/([\d.,]+[KMB]?)/);
                                if (numMatch && !followers) {
                                    followers = numMatch[1];
                                    console.log(`[Instagram] Cheerio found followers via label scan: ${followers}`);
                                    return false;
                                }
                            }
                        });
                    }
                    if (!name) {
                        const ogTitle = $('meta[property="og:title"]').attr('content') || '';
                        const candidate = ogTitle.split(' (')[0].split('•')[0].replace('Instagram photos and videos', '').trim();
                        if (candidate && candidate.toLowerCase() !== 'instagram' && candidate.toLowerCase() !== 'login') {
                            name = candidate;
                        }
                    }
                }

                // 🚀 TAG-AGNOSTIC BRUTE FORCE: Ignore nested tags and spaces
                if (!followers) {
                    // This regex looks for a number, followed by optional tags/spaces, followed by "seguidores" or "followers"
                    const bruteFol = bestHtml.match(/(\d[\d.,]*[KMB]?)(?:<[^>]+>|[\s\\])*seguidores/i) ||
                                    bestHtml.match(/(\d[\d.,]*[KMB]?)(?:<[^>]+>|[\s\\])*followers/i);
                    if (bruteFol) {
                        followers = bruteFol[1];
                        console.log(`[Instagram] Brute Tag-Agnostic found followers: ${followers}`);
                    }
                }

                if (!avatarUrl) {
                    // Scan for any scontent link that looks like a profile picture, ignoring tags
                    const brutePic = bestHtml.match(/https:\/\/[^"'\s\\]+scontent[^"'\s\\]+t51[^"'\s\\]+/i);
                    if (brutePic) {
                        avatarUrl = brutePic[0].replace(/\\/g, '').replace(/&amp;/g, '&');
                        console.log(`[Instagram] Brute found avatar URL: ${avatarUrl.substring(0, 50)}...`);
                    }
                }

                // 🦅 SCAVENGER MODE: If everything else fails, scan the WHOLE text for anything that looks like a user profile
                if (!followers || !avatarUrl) {
                    const allNumbers = searchHtml.matchAll(/["']?followers(?:_count)?["']?\s*[:=]\s*["']?(\d+)/gi);
                    for (const m of allNumbers) {
                        const val = parseInt(m[1]);
                        if (val > 0 && !followers) {
                             if (val >= 1000000) followers = (val / 1000000).toFixed(1).replace('.0', '') + 'M';
                             else if (val >= 1000) followers = (val / 1000).toFixed(1).replace('.0', '') + 'K';
                             else followers = val.toString();
                             console.log(`[Instagram] Scavenger found followers: ${followers}`);
                             break;
                        }
                    }

                    if (!avatarUrl) {
                        const allCdnImages = searchHtml.matchAll(/https:\/\/scontent[^"'\s)]+\.jpg/gi);
                        for (const m of allCdnImages) {
                            const url = m[0].replace(/&amp;/g, '&');
                            // Profile pictures usually have a specific pattern in the URL
                            if (!url.includes('static.cdninstagram.com') && (url.includes('/t51.2885-19/') || url.includes('/v/t51.82787-19/'))) {
                                avatarUrl = url;
                                console.log(`[Instagram] Scavenger found avatar (profile pattern): ${avatarUrl.substring(0, 50)}...`);
                                break;
                            }
                        }
                    }
                }
            }

            // 🆘 LAST RESORT: If no image found, try a quick search for the profile pic
            if (!avatarUrl) {
                try {
                    console.log(`[Instagram] Last resort: Searching for profile picture of ${username}`);
                    const searchRes = await safeFetch(`https://s.jina.ai/instagram%20profile%20picture%20${username}`, { timeout: 8000 });
                    if (searchRes.ok) {
                        const searchContent = await searchRes.text();
                        
                        // Look for image in raw text or markdown format
                        const imgMatch = searchContent.match(/https:\/\/scontent[^"'\s)]+\.jpg/i) || 
                                         searchContent.match(/!\[.*?\]\((https:\/\/scontent[^)]+)\)/);
                        if (imgMatch) {
                            avatarUrl = imgMatch[1] || imgMatch[0];
                            console.log(`[Instagram] Found avatar via Jina Search fallback!`);
                        }

                        // Also look for followers in search results snippet
                        const folMatch = searchContent.match(/([\d.,]+[KMB]?)\s*(?:Followers|Seguidores)/i);
                        if (folMatch && !followers) {
                            followers = folMatch[1];
                            console.log(`[Instagram] Found followers via Jina Search fallback: ${followers}`);
                        }
                    }
                } catch (e) {
                    console.log(`[Instagram] Last resort failed: ${(e as any).message}`);
                }
            }

            // Sanitize: reject names that are just the platform name (means login page was scraped)
            if (!name || name.toLowerCase() === 'instagram' || name.toLowerCase() === 'login') name = username;
            console.log(`[Instagram] Final: name="${name}", followers="${followers}", avatar=${!!avatarUrl}`);

            const followersText = followers ? `${followers} Seguidores` : '';
            const result = {
                name: name || username,
                display_name: name || username,
                username,
                avatarUrl,
                avatar_url: avatarUrl,
                followers: followersText,
                subscribers: followersText,
                follower_count: parseFollowerCount(followers),
                platform: 'instagram',
                profileUrl: cleanUrl
            };

            // 💾 STEP 3: Persist to DB so this never needs to run again
            // ONLY save if we actually found something useful (followers or non-generic avatar)
            if (linkId && typeof linkId === 'string' && (followersText || (avatarUrl && !avatarUrl.includes('static.cdninstagram.com')))) {
                try {
                    const updates: any = {};
                    if (followersText) updates.subtitle = followersText;
                    if (avatarUrl) updates.image = avatarUrl;
                    const updatedLink = await linkService.updateLink(linkId, updates);
                    
                    if (updatedLink) {
                        console.log(`[Instagram] Saved to DB for link ${linkId}`);
                        if (updatedLink.userId) {
                            const { data: user } = await supabase.from('users').select('username').eq('id', updatedLink.userId).maybeSingle();
                            if (user?.username) realtimeManager.notifyUpdate(user.username);
                        }
                    }
                } catch (saveErr) {
                    console.error(`[Instagram] Failed to save to DB:`, saveErr);
                }
            }

            if (avatarUrl) igCache.set(`ig:${username.toLowerCase()}`, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
            return res.json(result);
        } catch (e) {
            console.error(`[Instagram] Fatal error:`, (e as any).message);
            res.status(500).json({ error: 'Server error' });
        }

    },
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
                    
                    // Standard scraping logic for TikTok
                    const $ = cheerio.load(html);
                    const metaDesc = $('meta[property="og:description"]').attr('content') || '';
                    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
                    name = ogTitle.split(' | ')[0] || handle;
                    avatarUrl = $('meta[property="og:image"]').attr('content') || '';

                    if (!followers) {
                        const fMatch = metaDesc.match(/([\d.,]+[kmMB]?)\s*(?:Followers|Seguidores)/i);
                        if (fMatch) followers = fMatch[1].trim();
                    }
                    if (!avatarUrl) avatarUrl = $('meta[property="og:image"]').attr('content') || '';
                    if (!name) name = ogTitle.split(' | TikTok')[0].trim();
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
    }
};
