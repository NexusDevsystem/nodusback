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
            let targetVideoUrl = '';

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
            const isTiktok = targetUrl.includes('tiktok.com');
            const isYoutube = targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be');

            if (!isSpotify && !isDeezer && !isTiktok && !isYoutube) {
                return res.status(400).json({ error: 'Unsupported platform' });
            }

            // Follow redirects for TikTok shortened links (vm, v, t, vt)
            if (url.includes('tiktok.com') && (url.includes('/vm/') || url.includes('/vt/') || url.includes('/v/') || url.includes('/t/'))) {
                try {
                    const headRes = await fetch(url, {
                        method: 'GET',
                        redirect: 'follow',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                        }
                    });
                    targetUrl = headRes.url;
                    console.log(`[Metadata] Resolved TikTok redirect to: ${targetUrl}`);
                } catch (e) {
                    console.error('[Metadata] Error following redirect', e);
                }
            }

            let title = '';
            let artist = '';
            let thumbnailUrl = '';
            let type = 'track';

            // METHOD 1: OEMBED (Primary - Cleanest Data)
            let oembedUrl = '';
            if (isSpotify) oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(targetUrl)}`;
            else if (isDeezer) oembedUrl = `https://api.deezer.com/oembed?url=${encodeURIComponent(targetUrl)}`;
            else if (isTiktok) oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(targetUrl)}`;
            else if (isYoutube) oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;

            try {
                if (oembedUrl) {
                    const response = await fetch(oembedUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                        }
                    });

                    if (response.ok) {
                        const data = await response.json() as any;
                        if (data.title) title = data.title;
                        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
                        if (data.author_name && data.author_name !== 'Spotify' && data.author_name !== 'TikTok') {
                            artist = data.author_name;
                        }
                        if (isTiktok) {
                            type = targetUrl.includes('/video/') ? 'video' : 'profile';
                        }
                    }
                }
            } catch (oembedError) {
                console.error('[Metadata] OEmbed failed:', oembedError);
            }

            // METHOD 2: SCRAPING (Fallback/Enhancement)
            if (!title || !artist || !thumbnailUrl || isTiktok || isYoutube) {
                try {
                    const fetchUrl = encodeURI(targetUrl);
                    const pageRes = await fetch(fetchUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                        }
                    });

                    if (pageRes.ok) {
                        const html = await pageRes.text();
                        const $ = cheerio.load(html);

                        // Basic Meta Tags
                        const ogTitle = $('meta[property="og:title"]').attr('content');
                        const ogDescription = $('meta[property="og:description"]').attr('content');
                        const ogImage = $('meta[property="og:image"]').attr('content');
                        const twitterArtist = $('meta[name="twitter:audio:artist_name"]').attr('content');

                        if (!title) title = ogTitle || $('title').text() || '';
                        if (!thumbnailUrl) thumbnailUrl = ogImage || '';

                        // YouTube Channel Special Case
                        if (isYoutube && !targetUrl.includes('watch?v=') && !targetUrl.includes('youtu.be/')) {
                            if (!title || title === 'Link Desconhecido') {
                                const parts = targetUrl.split('/@');
                                if (parts.length > 1) title = parts[1].split(/[/?#]/)[0];
                            }
                        }

                        // TikTok specific direct video extraction
                        if (isTiktok && targetUrl.includes('/video/')) {
                            const hydrationData = $('script#\\__UNIVERSAL_DATA_FOR_REHYDRATION__').html() ||
                                $('script#SIGI_STATE').html();

                            const playAddrMatch = html.match(/"playAddr":"(.*?)"/) || html.match(/playAddr":"(.*?)"/);
                            if (playAddrMatch && playAddrMatch[1]) {
                                targetVideoUrl = playAddrMatch[1].replace(/\\u002F/g, '/').replace(/\\u003A/g, ':').replace(/\\/g, '');
                            }
                        }

                        // Spotify Album Detection
                        if (isSpotify && targetUrl.includes('/album/')) {
                            try {
                                const albumIdMatch = targetUrl.match(/album\/([a-zA-Z0-9]+)/);
                                const albumId = albumIdMatch ? albumIdMatch[1] : null;
                                if (albumId) {
                                    const embedRes = await fetch(`https://open.spotify.com/embed/album/${albumId}`, {
                                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://open.spotify.com/' }
                                    });
                                    if (embedRes.ok) {
                                        const embedHtml = await embedRes.text();
                                        const $embed = cheerio.load(embedHtml);
                                        const nextData = $embed('script[id="__NEXT_DATA__"]').html();
                                        if (nextData) {
                                            const jsonData = JSON.parse(nextData);
                                            const entity = jsonData?.props?.pageProps?.state?.data?.entity;
                                            if (entity?.trackList) {
                                                const albumCover = entity.visualIdentity?.image?.[0]?.url || thumbnailUrl || '';
                                                const albumTracks = entity.trackList.map((t: any) => ({
                                                    title: t.title,
                                                    artist: t.subtitle,
                                                    url: `https://open.spotify.com/track/${t.uri?.split(':').pop() || t.uid}`,
                                                    image: albumCover,
                                                    duration: t.duration
                                                }));
                                                return res.json({
                                                    title: entity.title || title || 'Álbum',
                                                    artist: entity.subtitle || artist || '',
                                                    thumbnailUrl: albumCover,
                                                    type: 'album',
                                                    platform: 'spotify',
                                                    tracks: albumTracks
                                                });
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error('[Metadata] Album scraping failed:', e);
                            }
                        }

                        // Artist Refinement
                        if (!artist) {
                            if (twitterArtist) artist = twitterArtist;
                            else if (ogDescription && isSpotify) {
                                const parts = ogDescription.split(' · ');
                                if (parts.length >= 2) artist = parts[0] === title ? parts[1] : parts[0];
                            } else if (ogDescription && isDeezer && ogDescription.includes(' by ')) {
                                artist = ogDescription.split(' by ')[1].split(' on Deezer')[0];
                            }
                        }

                        // YouTube Subscriber Scraping
                        if (isYoutube) {
                            try {
                                const metaDesc = $('meta[name="description"]').attr('content') || '';
                                const subMatch = metaDesc.match(/([\d.,]+[KMB]?) (inscritos|subscribers)/i);
                                if (subMatch) {
                                    artist = `${subMatch[1]} inscritos`;
                                } else {
                                    $('script').each((i, el) => {
                                        const content = $(el).html() || '';
                                        if (content.includes('subscriberCountText')) {
                                            const countMatch = content.match(/"subscriberCountText":\s*\{"accessibility":\s*\{"accessibilityData":\s*\{"label":"(.*?)"\}/) ||
                                                content.match(/"subscriberCountText":\s*\{"simpleText":"(.*?)"\}/);
                                            if (countMatch) {
                                                artist = `${countMatch[1].split(/\s+/)[0]} inscritos`;
                                                return false;
                                            }
                                        }
                                    });
                                }
                            } catch (e) { }
                        }
                    }
                } catch (scrapeError) {
                    console.error('[Metadata] Scraping failed:', scrapeError);
                }
            }

            // CLEANUP
            if (isYoutube) {
                if (title.endsWith(' - YouTube')) title = title.replace(' - YouTube', '');
            }
            if (title) title = title.replace(/ - (Single|EP|Album|Remastered|Radio Edit).*$/i, '').trim();
            if (artist) artist = artist.replace(/ on Spotify| on Deezer.*/i, '').trim();
            if (thumbnailUrl && thumbnailUrl.startsWith('//')) thumbnailUrl = 'https:' + thumbnailUrl;

            const isVideoUrl = targetUrl.includes('watch?v=') || targetUrl.includes('/shorts/') || targetUrl.includes('/live/') || targetUrl.includes('youtu.be/');
            const followers = (isYoutube && !isVideoUrl) || isTiktok ? artist : '';

            let videoId = '';
            if (isTiktok) {
                const idMatch = targetUrl.match(/\/video\/(\d+)/) || targetUrl.match(/v=(\d+)/);
                if (idMatch) videoId = idMatch[1];
            } else if (isYoutube) {
                const idMatch = targetUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                if (idMatch) videoId = idMatch[1];
            }

            return res.json({
                title: title || 'Link Desconhecido',
                artist: artist || '',
                thumbnailUrl: thumbnailUrl || '',
                type: type,
                platform: isSpotify ? 'spotify' : isDeezer ? 'deezer' : isTiktok ? 'tiktok' : 'youtube',
                resolvedUrl: targetUrl,
                videoId: videoId,
                videoUrl: targetVideoUrl,
                followers: followers
            });

        } catch (error) {
            console.error('[MusicMetadata] Critical Error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
};
