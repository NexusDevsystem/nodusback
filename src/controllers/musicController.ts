import { Request, Response } from 'express';
import * as cheerio from 'cheerio';

/**
 * Music Controller
 * Handles metadata for embeddable media content:
 * - Spotify (tracks, albums, playlists)
 * - Deezer (tracks, albums)
 * - TikTok (videos)
 * - YouTube (videos and shorts only — channels are handled by socialController)
 */
export const musicController = {
    async getMetadata(req: Request, res: Response) {
        try {
            const { url } = req.query;
            if (!url || typeof url !== 'string') {
                return res.status(400).json({ error: 'URL is required' });
            }

            console.log(`[MusicMetadata] Fetching for: ${url}`);

            let targetUrl = url;
            let targetVideoUrl = '';

            // Resolve Deezer shortened links
            if (url.includes('link.deezer.com')) {
                try {
                    const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
                    targetUrl = headRes.url;
                } catch (e) {
                    console.error('[Metadata] Error following Deezer redirect', e);
                }
            }

            const isSpotify = targetUrl.includes('spotify.com');
            const isDeezer = targetUrl.includes('deezer.com');
            const isTiktok = targetUrl.includes('tiktok.com');
            const isYoutube = targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be');

            if (!isSpotify && !isDeezer && !isTiktok && !isYoutube) {
                return res.status(400).json({ error: 'Unsupported platform' });
            }

            // Resolve TikTok shortened links
            if (isTiktok && (url.includes('/vm/') || url.includes('/vt/') || url.includes('/v/') || url.includes('/t/'))) {
                try {
                    const headRes = await fetch(url, {
                        method: 'GET', redirect: 'follow',
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });
                    targetUrl = headRes.url;
                } catch (e) {
                    console.error('[Metadata] Error following TikTok redirect', e);
                }
            }

            let title = '';
            let artist = '';
            let thumbnailUrl = '';
            let type = 'track';

            // METHOD 1: OEmbed
            let oembedUrl = '';
            if (isSpotify) oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(targetUrl)}`;
            else if (isDeezer) oembedUrl = `https://api.deezer.com/oembed?url=${encodeURIComponent(targetUrl)}`;
            else if (isTiktok) oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(targetUrl)}`;
            else if (isYoutube) oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;

            try {
                if (oembedUrl) {
                    const response = await fetch(oembedUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });
                    if (response.ok) {
                        const data = await response.json() as any;
                        if (data.title) title = data.title;
                        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
                        if (data.author_name && data.author_name !== 'Spotify' && data.author_name !== 'TikTok') {
                            artist = data.author_name;
                        }
                        if (isTiktok) type = targetUrl.includes('/video/') ? 'video' : 'profile';
                    }
                }
            } catch (oembedError) {
                console.error('[Metadata] OEmbed failed:', oembedError);
            }

            // METHOD 2: Scraping fallback
            if (!title || !artist || !thumbnailUrl || isTiktok) {
                try {
                    const fetchUrl = encodeURI(targetUrl);
                    const pageRes = await fetch(fetchUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                        }
                    });

                    if (pageRes.ok) {
                        const html = await pageRes.text();
                        const $ = cheerio.load(html);

                        const ogTitle = $('meta[property="og:title"]').attr('content');
                        const ogDescription = $('meta[property="og:description"]').attr('content');
                        const ogImage = $('meta[property="og:image"]').attr('content');
                        const twitterArtist = $('meta[name="twitter:audio:artist_name"]').attr('content');

                        if (!title) title = ogTitle || $('title').text() || '';
                        if (!thumbnailUrl) thumbnailUrl = ogImage || '';

                        // TikTok video extraction
                        if (isTiktok && targetUrl.includes('/video/')) {
                            const playAddrMatch = html.match(/"playAddr":"(.*?)"/) || html.match(/playAddr":"(.*?)"/);
                            if (playAddrMatch?.[1]) {
                                targetVideoUrl = playAddrMatch[1]
                                    .replace(/\\u002F/g, '/').replace(/\\u003A/g, ':').replace(/\\/g, '');
                            }
                        }

                        // Spotify album detection
                        if (isSpotify && targetUrl.includes('/album/')) {
                            try {
                                const albumIdMatch = targetUrl.match(/album\/([a-zA-Z0-9]+)/);
                                const albumId = albumIdMatch?.[1];
                                if (albumId) {
                                    const embedRes = await fetch(`https://open.spotify.com/embed/album/${albumId}`, {
                                        headers: {
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                            'Referer': 'https://open.spotify.com/'
                                        }
                                    });
                                    if (embedRes.ok) {
                                        const $embed = cheerio.load(await embedRes.text());
                                        const nextData = $embed('script[id="__NEXT_DATA__"]').html();
                                        if (nextData) {
                                            const entity = JSON.parse(nextData)?.props?.pageProps?.state?.data?.entity;
                                            if (entity?.trackList) {
                                                const albumCover = entity.visualIdentity?.image?.[0]?.url || thumbnailUrl || '';
                                                return res.json({
                                                    title: entity.title || title || 'Álbum',
                                                    artist: entity.subtitle || artist || '',
                                                    thumbnailUrl: albumCover,
                                                    type: 'album',
                                                    platform: 'spotify',
                                                    tracks: entity.trackList.map((t: any) => ({
                                                        title: t.title,
                                                        artist: t.subtitle,
                                                        url: `https://open.spotify.com/track/${t.uri?.split(':').pop() || t.uid}`,
                                                        image: albumCover,
                                                        duration: t.duration
                                                    }))
                                                });
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error('[Metadata] Album scraping failed:', e);
                            }
                        }

                        // Artist refinement for Spotify/Deezer
                        if (!artist) {
                            if (twitterArtist) {
                                artist = twitterArtist;
                            } else if (ogDescription && isSpotify) {
                                const parts = ogDescription.split(' · ');
                                if (parts.length >= 2) artist = parts[0] === title ? parts[1] : parts[0];
                            } else if (ogDescription && isDeezer && ogDescription.includes(' by ')) {
                                artist = ogDescription.split(' by ')[1].split(' on Deezer')[0];
                            }
                        }

                        // Spotify: title refinement from page title
                        if (!artist && isSpotify) {
                            const pageTitle = $('title').text().replace(' | Spotify', '');
                            if (pageTitle.includes(' - song and lyrics by ')) artist = pageTitle.split(' - song and lyrics by ')[1];
                            else if (pageTitle.includes(' - Single by ')) artist = pageTitle.split(' - Single by ')[1];
                            else if (pageTitle.includes(' - EP by ')) artist = pageTitle.split(' - EP by ')[1];
                            else if (pageTitle.includes(' - Album by ')) artist = pageTitle.split(' - Album by ')[1];
                        }
                    }
                } catch (scrapeError) {
                    console.error('[Metadata] Scraping failed:', scrapeError);
                }
            }

            // Cleanup
            if (title) title = title.replace(/ - YouTube$/, '').replace(/ - (Single|EP|Album|Remastered|Radio Edit).*$/i, '').trim();
            if (artist) artist = artist.replace(/ on Spotify| on Deezer.*/i, '').trim();
            if (thumbnailUrl?.startsWith('//')) thumbnailUrl = 'https:' + thumbnailUrl;

            // Extract video ID
            let videoId = '';
            if (isTiktok) {
                const idMatch = targetUrl.match(/\/video\/(\d+)/) || targetUrl.match(/v=(\d+)/);
                if (idMatch) videoId = idMatch[1];
            } else if (isYoutube) {
                const idMatch = targetUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                if (idMatch) videoId = idMatch[1];
            }

            const platform = isSpotify ? 'spotify' : isDeezer ? 'deezer' : isTiktok ? 'tiktok' : 'youtube';

            return res.json({
                title: title || 'Link Desconhecido',
                artist: artist || '',
                thumbnailUrl: thumbnailUrl || '',
                type,
                platform,
                resolvedUrl: targetUrl,
                videoId,
                videoUrl: targetVideoUrl,
                // No 'followers' here — that belongs to socialController for channel links
            });

        } catch (error: any) {
            console.error('[MusicMetadata] Critical Error:', error);
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }
};
