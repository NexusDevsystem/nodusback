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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const igCache = new Map<string, { data: any, expiresAt: number }>();
const tiktokCache = new Map<string, { data: any, expiresAt: number }>();

// Global Rate Limiter for AI Extraction (OpenRouter Free tier is strict)
let lastAiRequestTime = 0;
const AI_COOLDOWN_MS = 2000; // 2 seconds between AI calls
const aiQueue: (() => void)[] = [];
let isAiProcessing = false;

async function waitForAiTurn(): Promise<void> {
    if (!isAiProcessing && (Date.now() - lastAiRequestTime) >= AI_COOLDOWN_MS) {
        isAiProcessing = true;
        lastAiRequestTime = Date.now();
        return;
    }
    return new Promise((resolve) => {
        aiQueue.push(() => {
            lastAiRequestTime = Date.now();
            resolve();
        });
        if (!isAiProcessing) processNextInAiQueue();
    });
}

function processNextInAiQueue() {
    if (aiQueue.length === 0) {
        isAiProcessing = false;
        return;
    }
    const next = aiQueue.shift();
    if (next) {
        const timeSinceLast = Date.now() - lastAiRequestTime;
        const delay = Math.max(0, AI_COOLDOWN_MS - timeSinceLast);
        setTimeout(() => {
            isAiProcessing = true;
            next();
        }, delay);
    }
}

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
            Return ONLY a valid JSON object.
            
            Platform: ${platform}
            Title: ${title}
            Meta Tags: ${JSON.stringify(metaTags)}
            Page Text Snippet: ${bodyText}

            IMPORTANT:
            - Look for follower counts like "10K", "1.5M" or "500 followers".
            - Look for the profile image URL in og:image or script tags (look for 'profile_pic_url').
            - If you see a login screen, generic "Instagram" title, or "Redirecting..." page, set name to "LOGIN_REQUIRED".
            - Check for JSON data in script tags if provided.
        `;

        // 🚦 RATE LIMITER: Wait for turn
        await waitForAiTurn();

        const model = process.env.OPENROUTER_MODEL || "z-ai/glm-4.5-air:free";
        console.log(`[AI-Extraction] Sending request to OpenRouter (Model: ${model}, Platform: ${platform}) with Structured Output...`);
        
        try {
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
                response_format: { type: 'json_object' },
                timeout: 20000 // 20s timeout
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY || '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'}`,
                    'HTTP-Referer': 'https://nodus.my',
                    'X-Title': 'Nodus Social Scraper',
                    'Content-Type': 'application/json'
                }
            });

            processNextInAiQueue(); // Free up queue

            const aiContent = response.data.choices?.[0]?.message?.content;
            if (!aiContent) {
                console.error(`[AI-Extraction] Empty response from OpenRouter`);
                return null;
            }

            // Clean markdown code blocks if present
            let cleanedContent = aiContent.trim();
            if (cleanedContent.includes('```')) {
                cleanedContent = cleanedContent.replace(/```json/g, '').replace(/```/g, '').trim();
            }

            try {
                const result = JSON.parse(cleanedContent);
                
                // Normalize fields if model ignored schema
                const normalized = {
                    name: result.name || result.full_name || result.title || '',
                    username: result.username || result.handle || result.profile_handle || '',
                    avatarUrl: result.avatarUrl || result.profile_image || result.profile_image_url || result.avatar_url || '',
                    followers: result.followers || result.follower_count || result.subscribers || ''
                };

                console.log(`\x1b[32m[AI-Extraction] Success! Extracted: name="${normalized.name}", followers="${normalized.followers}"\x1b[0m`);
                return normalized;
            } catch (parseErr) {
                console.error(`\x1b[31m[AI-Extraction] JSON Parse Error:\x1b[0m`, aiContent);
                return null;
            }
        } catch (err: any) {
            processNextInAiQueue(); // Free up queue even on error
            if (err.response?.status === 429) {
                console.error('\x1b[33m[AI-Extraction] 429 Rate Limit hit. Slowing down...\x1b[0m');
                // Give extra cooldown
                lastAiRequestTime += 5000;
            } else {
                console.error('\x1b[31m[AI-Extraction] Error:\x1b[0m', err.response?.data || err.message);
            }
            return null;
        }
    } catch (outerErr: any) {
        console.error('\x1b[31m[AI-Extraction] Fatal Queue Error:\x1b[0m', outerErr.message);
        return null;
    }
}

function isLoginWall(html: string, title: string): boolean {
    const lowerTitle = title.toLowerCase();
    const lowerHtml = html.toLowerCase();
    
    // Common login patterns
    if (lowerTitle.includes('login') || lowerTitle.includes('entrar')) {
        // If the HTML is large, it might just be a login link in a valid page
        if (lowerHtml.length < 50000) return true;
    }
    
    if (lowerTitle === 'instagram' || lowerTitle === 'tiktok') {
        // Generic title + small HTML usually means login or splash
        if (lowerHtml.length < 50000 && (lowerHtml.includes('log in') || lowerHtml.includes('sign up'))) return true;
    }
    
    // Platform specific redirects
    if (lowerHtml.includes('redirecting...') || lowerHtml.includes('window.location.replace')) {
        if (lowerHtml.length < 5000) return true;
    }
    
    return false;
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

            // Strategy B: Instagram Embed (Powerful fallback)
            if (!bestHtml || bestHtml.length < 5000 || bestHtml.toLowerCase().includes('login')) {
                try {
                    console.log(`[Instagram] Trying Embed Strategy for: ${username}`);
                    const embedRes = await safeFetch(`https://www.instagram.com/${username}/embed/`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
                        timeout: 10000
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

            // Strategy C: Direct HTTP with multiple User-Agents (fallback)
            if (bestHtml.length < 5000) {
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
                            timeout: 10000
                        });
                        if (pageRes.ok) {
                            const html = await pageRes.text();
                            if (html.length > bestHtml.length) bestHtml = html;
                            const hasData = html.includes('profile_pic_url') || html.includes('edge_followed_by');
                            console.log(`[Instagram] UA="${ua.substring(0, 25)}..." → ${html.length} bytes, hasData=${hasData}`);
                            if (hasData) { bestHtml = html; break; }
                        }
                    } catch (e) {
                        console.log(`[Instagram] UA failed: ${(e as any).message}`);
                    }
                }
            }

            // 🔍 Extract data from whatever HTML we got
            if (bestHtml) {
                // Quick regex extraction (catches data in JSON blobs)
                const folMatch = bestHtml.match(/"edge_followed_by":\s*\{"count":\s*(\d+)\}/) ||
                                bestHtml.match(/"followers_count":\s*(\d+)/) ||
                                bestHtml.match(/"edge_followed_by":\s*(\d+)/) ||
                                bestHtml.match(/([\d.,KMB]+)\s*Followers/i); // Common in meta
                if (folMatch) {
                    const rawStr = folMatch[1];
                    const rawCount = parseInt(rawStr.replace(/[,.]/g, ''));
                    if (!isNaN(rawCount)) {
                        if (rawCount >= 1000000) followers = (rawCount / 1000000).toFixed(1).replace('.0', '') + 'M';
                        else if (rawCount >= 1000) followers = (rawCount / 1000).toFixed(1).replace('.0', '') + 'K';
                        else followers = rawCount.toString();
                    } else if (rawStr.match(/[\dKMB]/i)) {
                        followers = rawStr.toUpperCase();
                    }
                    console.log(`[Instagram] Regex found followers: ${followers}`);
                }

                const picMatch = bestHtml.match(/"profile_pic_url_hd":"([^"]+)"/) ||
                                bestHtml.match(/"profile_pic_url":"([^"]+)"/) ||
                                bestHtml.match(/profile_pic_url\\":\\"(https:[^"]+)\\"/) ||
                                bestHtml.match(/src="([^"]+)"[^>]*class="[^"]*Avatar/i) ||
                                bestHtml.match(/https:\/\/scontent[^"']+\.jpg/i); // Very aggressive scontent match
                if (picMatch) {
                    const candidate = picMatch[1]?.replace(/\\u0026/g, '&').replace(/\\/g, '') || picMatch[0];
                    if (!candidate.includes('static.cdninstagram.com') && candidate.startsWith('http')) {
                        avatarUrl = candidate;
                        console.log(`[Instagram] Regex found avatar: ${avatarUrl.substring(0, 50)}...`);
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
                    }
                    if (!followers) {
                        const desc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
                        // Embed selector fallback
                        const embedFollowers = $('.EmbedAccountFollowers').text() || $('.FollowersCount').text() || $('.followed-by').text();
                        const m = desc.match(/([\d.,]+[KMB]?)\s*(?:Followers|Seguidores)/i);
                        followers = m ? m[1] : (embedFollowers.match(/([\d.,]+[KMB]?)/i)?.[1] || followers);
                    }
                    if (!name) {
                        const ogTitle = $('meta[property="og:title"]').attr('content') || '';
                        const candidate = ogTitle.split(' (')[0].split('•')[0].replace('Instagram photos and videos', '').trim();
                        if (candidate && candidate.toLowerCase() !== 'instagram' && candidate.toLowerCase() !== 'login') {
                            name = candidate;
                        }
                    }
                }

                // 🤖 AI as final resort for anything regex/cheerio missed
                if (!avatarUrl || !followers) {
                    // PRE-CHECK: Don't waste AI on login walls
                    if (isLoginWall(bestHtml, pageTitle)) {
                        console.log(`[Instagram] Pre-AI check: Login wall detected. Skipping AI.`);
                    } else {
                        console.log(`[Instagram] Sending to AI for remaining data...`);
                        const aiData = await extractMetadataWithAI(bestHtml, 'Instagram');
                        if (aiData) {
                            if (aiData.name === 'LOGIN_REQUIRED') {
                                console.log(`[Instagram] AI detected login wall. Skipping metadata extraction.`);
                            } else {
                                if (!name && aiData.name) name = aiData.name;
                                if (!avatarUrl && aiData.avatarUrl) avatarUrl = aiData.avatarUrl;
                                if (!followers && aiData.followers) followers = aiData.followers;
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
                        const imgMatch = searchContent.match(/https:\/\/scontent[^"'\s)]+\.jpg/i);
                        if (imgMatch) {
                            avatarUrl = imgMatch[0];
                            console.log(`[Instagram] Found avatar via Jina Search fallback!`);
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
                // Strategy 3: Scrape via Googlebot (SSR) + Deep Scan
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
