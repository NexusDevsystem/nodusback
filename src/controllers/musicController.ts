import { Request, Response } from 'express';
import * as cheerio from 'cheerio';

export const musicController = {
    async getMetadata(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') {
                return res.status(400).json({ error: 'URL is required' });
            }

            console.log(`[MusicMetadata] Fetching for: ${url}`);

            let targetUrl = url;

            // Follow redirects for Deezer shortened links
            if (url.includes('link.deezer.com')) {
                try {
                    const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
                    targetUrl = headRes.url;
                    console.log(`[MusicMetadata] Resolved Deezer redirect to: ${targetUrl}`);
                } catch (e) {
                    console.error('Error following generic redirect', e);
                }
            }

            const isSpotify = targetUrl.includes('spotify.com');
            const isDeezer = targetUrl.includes('deezer.com');

            if (!isSpotify && !isDeezer) {
                return res.status(400).json({ error: 'Unsupported music platform' });
            }

            // Normalize Spotify URLs (remove /intl-xx/) - REMOVED as it breaks OEmbed
            // if (isSpotify) {
            //    targetUrl = targetUrl.replace(/\/intl-[a-z]{2}\//, '/');
            // }

            let title = '';
            let artist = '';
            let thumbnailUrl = '';
            let type = 'track';

            // METHOD 1: OEMBED (Primary - Cleanest Data)
            // Use OEmbed first as it provides structured data including author_name for BOTH Spotify and Deezer
            const oembedUrl = isSpotify
                ? `https://open.spotify.com/oembed?url=${encodeURIComponent(targetUrl)}`
                : `https://api.deezer.com/oembed?url=${encodeURIComponent(targetUrl)}`;

            try {
                console.log(`[MusicMetadata] Trying OEmbed: ${oembedUrl}`);
                const response = await fetch(oembedUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });

                if (response.ok) {
                    const data = await response.json() as any;

                    if (data.title) title = data.title;
                    if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;

                    // Spotify OEmbed returns 'author_name' which is the Artist
                    // Deezer seems to not strictly return author_name in all cases, but let's check
                    if (data.author_name && data.author_name !== 'Spotify') {
                        artist = data.author_name;
                    }

                    console.log(`[MusicMetadata] OEmbed Result - Title: ${title}, Artist: ${artist}`);
                } else {
                    console.warn(`[MusicMetadata] OEmbed failed with status: ${response.status}`);
                }
            } catch (oembedError) {
                console.error('[MusicMetadata] OEmbed failed:', oembedError);
            }

            // METHOD 2: SCRAPING (Fallback if missing data)
            if (!title || !artist || !thumbnailUrl) {
                console.log('[MusicMetadata] Missing data, trying Scraping fallback...');
                try {
                    const pageRes = await fetch(targetUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.5'
                        }
                    });

                    if (pageRes.ok) {
                        const html = await pageRes.text();
                        const $ = cheerio.load(html);

                        const ogTitle = $('meta[property="og:title"]').attr('content');
                        const ogDescription = $('meta[property="og:description"]').attr('content');
                        const ogImage = $('meta[property="og:image"]').attr('content');

                        if (!title && ogTitle) title = ogTitle;
                        if (!thumbnailUrl && ogImage) thumbnailUrl = ogImage;

                        if (!artist && ogDescription) {
                            if (isSpotify) {
                                // "Song · Artist · Album" 
                                const parts = ogDescription.split(' · ');
                                if (parts.length >= 2) {
                                    if (parts[0] === title && parts[1]) artist = parts[1];
                                    else if (parts[1] === title && parts[0]) artist = parts[0];
                                    else artist = parts[0];
                                } else if (ogDescription.includes(', a song by ')) {
                                    artist = ogDescription.split(', a song by ')[1].replace(' on Spotify', '');
                                }
                            } else if (isDeezer && ogDescription.includes(' by ')) {
                                artist = ogDescription.split(' by ')[1].split(' on Deezer')[0];
                            }
                        }
                    }
                } catch (scrapeError) {
                    console.error('[MusicMetadata] Scraping failed:', scrapeError);
                }
            }

            // CLEANUP
            if (title) title = title.replace(/ - (Single|EP|Album|Remastered|Radio Edit).*$/i, '').trim();
            if (artist) artist = artist.replace(/ on Spotify| on Deezer.*/i, '').trim();

            // Fallback: If artist is still part of title (common in Deezer APIs sometimes)
            if (!artist && title.includes(' - ')) {
                const parts = title.split(' - ');
                if (parts.length === 2) {
                    // Usually "Song - Artist" or "Artist - Song" - hard to know for sure without heuristics
                    // But often Deezer OEmbed title is "Song - Artist"
                    if (isDeezer) {
                        title = parts[0];
                        artist = parts[1];
                    }
                }
            }

            return res.json({
                title: title || 'Música Desconhecida',
                artist: artist || 'Artista Desconhecido',
                thumbnailUrl: thumbnailUrl || '',
                type: 'track',
                platform: isSpotify ? 'spotify' : 'deezer'
            });

        } catch (error) {
            console.error('[MusicMetadata] Error:', error);
            res.status(500).json({ error: 'Internal server error while fetching metadata' });
        }
    }
};
