import { Request, Response } from 'express';
import * as cheerio from 'cheerio';

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

            // Detect if this is a video, not a channel
            const isVideo = url.includes('watch?v=') || url.includes('/shorts/') || url.includes('/live/') || url.includes('youtu.be/');
            if (isVideo) {
                return res.status(400).json({ error: 'URL is a video, not a channel' });
            }

            console.log(`[SocialController] Fetching YouTube channel info for: ${url}`);

            let name = '';
            let avatarUrl = '';
            let subscribers = '';

            // Encode URI to handle accented characters like @ZéMoitinha
            const fetchUrl = encodeURI(url);

            const pageRes = await fetch(fetchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                }
            });

            if (!pageRes.ok) {
                console.warn(`[SocialController] YouTube fetch failed: ${pageRes.status}`);
                return res.status(502).json({ error: 'Failed to fetch YouTube page' });
            }

            const html = await pageRes.text();
            const $ = cheerio.load(html);

            // 1. Channel Name from og:title
            name = $('meta[property="og:title"]').attr('content') || $('title').text().replace(' - YouTube', '') || '';

            // 2. Avatar from og:image
            avatarUrl = $('meta[property="og:image"]').attr('content') || '';

            // 3. Subscriber Count - multiple strategies
            const metaDesc = $('meta[name="description"]').attr('content') || '';
            console.log(`[SocialController] Meta description: "${metaDesc}"`);

            // Strategy A: meta description patterns (Portuguese + English)
            const descMatch = metaDesc.match(/([\d.,]+\s*(?:K|M|B|mil|mi|milhão|milhões)?) (inscritos|subscribers)/i);
            if (descMatch) {
                subscribers = descMatch[1].trim();
                console.log(`[SocialController] Found subscribers via meta: ${subscribers}`);
            }

            // Strategy B: ytInitialData in page scripts
            if (!subscribers) {
                $('script').each((_i: any, el: any) => {
                    const content = $(el).html() || '';
                    if (!content.includes('subscriberCountText')) return true;

                    // simpleText: "1,2 mi" or "12 mil" etc.
                    const simpleMatch = content.match(/"subscriberCountText"\s*:\s*\{"simpleText"\s*:\s*"([^"]+)"\}/);
                    if (simpleMatch) {
                        subscribers = simpleMatch[1];
                        console.log(`[SocialController] Found via simpleText: ${subscribers}`);
                        return false;
                    }

                    // accessibility label: "1,24 million subscribers"
                    const labelMatch = content.match(/"subscriberCountText"[^}]{0,200}"label"\s*:\s*"([^"]+)"/);
                    if (labelMatch) {
                        // Keep only the number part, remove "subscribers" / "inscritos"
                        subscribers = labelMatch[1].replace(/\s+(subscribers?|inscritos?).*/i, '').trim();
                        console.log(`[SocialController] Found via label: ${subscribers}`);
                        return false;
                    }
                });
            }

            // Strategy C: fallback - extract from URL handle
            if (!name) {
                const handleMatch = url.match(/\/@([^/?#]+)/);
                if (handleMatch) name = handleMatch[1];
            }

            // Format subscribers with "inscritos" suffix if found
            const subscribersText = subscribers ? `${subscribers} inscritos` : 'Canal do YouTube';

            console.log(`[SocialController] Result - name: "${name}", avatar: ${avatarUrl ? 'yes' : 'no'}, subscribers: "${subscribersText}"`);

            return res.json({
                name: name || 'Canal do YouTube',
                avatarUrl,
                subscribers: subscribersText,
                platform: 'youtube',
                channelUrl: url
            });

        } catch (error: any) {
            console.error('[SocialController] Error fetching YouTube info:', error);
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }
};
