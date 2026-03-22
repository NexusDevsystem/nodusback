import { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { profileService } from '../services/profileService.js';
import { blogService } from '../services/blogService.js';

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

            // Find the OG image. 
            // Priority: 1. Manual field (if exists) -> 2. Generated card in storage -> 3. Avatar fallback
            const ogImage = (profile as any).ogImageUrl || 
                            `https://api.nodus.my/uploads/${profile.id}/og/share-card.png` || 
                            profile.avatarUrl || 
                            'https://nodus.my/og-default.png';
            
            const profileUrl = `https://nodus.my/${username}`;
            const title = profile.seoTitle || `${profile.name} (@${username}) | Nodus`;
            const description = profile.seoDescription || profile.bio || 'Confira meus links e projetos no Nodus.';

            const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${profileUrl}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${ogImage}">

    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${profileUrl}">
    <meta property="twitter:title" content="${title}">
    <meta property="twitter:description" content="${description}">
    <meta property="twitter:image" content="${ogImage}">

    <!-- Redirection for Humans -->
    <script>
        window.location.href = "${profileUrl}";
    </script>
</head>
<body style="background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
    <div style="text-align: center;">
        <h2>Carregando perfil de ${profile.name}...</h2>
        <p>Você será redirecionado em instantes.</p>
        <a href="${profileUrl}" style="color: #ffdf00; text-decoration: none;">Clique aqui se não for redirecionado automaticamente.</a>
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
            const ogImage = `https://nodusback-production.up.railway.app/api/files/download/blog-cards/${slug}.png` || post.imageUrl || 'https://nodus.my/og-default.png';
            
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
