import { Request, Response } from 'express';

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
                const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
                targetUrl = headRes.url;
                console.log(`[MusicMetadata] Resolved Deezer redirect to: ${targetUrl}`);
            }

            const isSpotify = targetUrl.includes('spotify.com');
            const isDeezer = targetUrl.includes('deezer.com');

            if (!isSpotify && !isDeezer) {
                return res.status(400).json({ error: 'Unsupported music platform' });
            }

            const oembedUrl = isSpotify
                ? `https://open.spotify.com/oembed?url=${encodeURIComponent(targetUrl)}`
                : `https://api.deezer.com/oembed?url=${encodeURIComponent(targetUrl)}`;

            const response = await fetch(oembedUrl);
            if (!response.ok) {
                return res.status(response.status).json({ error: 'Failed to fetch OEmbed metadata' });
            }

            const data = await response.json() as any;

            // Standardize metadata
            let title = data.title || 'Música';
            let artist = data.author_name || '';

            if (isSpotify) {
                if (!artist || artist === 'Spotify') {
                    if (title.includes(' by ')) {
                        const parts = title.split(' by ');
                        title = parts[0];
                        artist = parts[1];
                    } else if (title.includes(' - ')) {
                        const parts = title.split(' - ');
                        if (parts.length > 1) {
                            title = parts[0];
                            artist = parts[1];
                        }
                    }
                }
                artist = artist.replace(/ - (Single|EP|Album|Playlist)$/i, '').trim();
                title = title.replace(/ by .*$/i, '').trim();
            } else if (isDeezer) {
                if (!artist && title.includes(' - ')) {
                    const parts = title.split(' - ');
                    artist = parts[0];
                    title = parts[1];
                }
            }

            return res.json({
                title,
                artist,
                thumbnailUrl: data.thumbnail_url || '',
                type: data.type || 'track',
                platform: isSpotify ? 'spotify' : 'deezer'
            });

        } catch (error) {
            console.error('[MusicMetadata] Error:', error);
            res.status(500).json({ error: 'Internal server error while fetching metadata' });
        }
    }
};
