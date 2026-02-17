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

            if (!isSpotify && !isDeezer && !isTiktok) {
                return res.status(400).json({ error: 'Unsupported platform' });
            }

            // Follow redirects for Deezer and TikTok shortened links (vm, v, t, vt)
            if (url.includes('link.deezer.com') || url.includes('tiktok.com')) {
                try {
                    const headRes = await fetch(url, {
                        method: 'GET',
                        redirect: 'follow',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                        }
                    });
                    targetUrl = headRes.url;
                    console.log(`[Metadata] Resolved redirect to: ${targetUrl}`);
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

            try {
                if (oembedUrl) {
                    console.log(`[Metadata] Trying OEmbed: ${oembedUrl}`);
                    const response = await fetch(oembedUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
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

                        console.log(`[Metadata] OEmbed Result - Title: ${title}, Artist: ${artist}, Type: ${type}`);
                    } else {
                        console.warn(`[Metadata] OEmbed failed with status: ${response.status}`);
                    }
                }
            } catch (oembedError) {
                console.error('[Metadata] OEmbed failed:', oembedError);
            }

            // METHOD 2: SCRAPING (Fallback/Enhancement)
            if (!title || !artist || !thumbnailUrl || isTiktok) {
                console.log(`[Metadata] Missing data or TikTok video, trying Scraping fallback for: ${targetUrl}`);
                try {
                    const pageRes = await fetch(targetUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache',
                            'Referer': 'https://www.tiktok.com/',
                            'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
                            'Sec-Ch-Ua-Mobile': '?0',
                            'Sec-Ch-Ua-Platform': '"macOS"',
                            'Sec-Fetch-Dest': 'document',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-Site': 'same-origin',
                            'Sec-Fetch-User': '?1',
                            'Upgrade-Insecure-Requests': '1'
                        }
                    });

                    if (pageRes.ok) {
                        const html = await pageRes.text();
                        console.log(`[Metadata] Scraped HTML length: ${html.length}`);
                        const $ = cheerio.load(html);

                        // TikTok specific direct video extraction
                        if (isTiktok && targetUrl.includes('/video/')) {
                            try {
                                // 1. Check Hydration Data
                                const hydrationData = $('script#\\__UNIVERSAL_DATA_FOR_REHYDRATION__').html() ||
                                    $('script#SIGI_STATE').html() ||
                                    $('script').filter((i: any, el: any) => $(el).html()?.includes('playAddr') || false).first().html();

                                if (hydrationData) {
                                    try {
                                        const json = JSON.parse(hydrationData);
                                        targetVideoUrl =
                                            json?.['defaultScope']?.['webapp.video-detail']?.['itemInfo']?.['itemStruct']?.['video']?.playAddr ||
                                            json?.['webapp.video-detail']?.['itemInfo']?.['itemStruct']?.['video']?.playAddr ||
                                            json?.ItemModule?.[Object.keys(json?.ItemModule || {})[0]]?.video?.playAddr ||
                                            json?.itemInfo?.itemStruct?.video?.playAddr;

                                        if (targetVideoUrl) console.log(`[Metadata] Found TikTok playAddr via JSON.`);
                                    } catch (e) { }
                                }

                                // 2. Regex Fallback
                                if (!targetVideoUrl) {
                                    const playAddrMatch = html.match(/"playAddr":"(.*?)"/) || html.match(/playAddr":"(.*?)"/);
                                    if (playAddrMatch && playAddrMatch[1]) {
                                        targetVideoUrl = playAddrMatch[1].replace(/\\u002F/g, '/').replace(/\\u003A/g, ':').replace(/\\/g, '');
                                        console.log(`[Metadata] Found TikTok playAddr via Regex.`);
                                    }
                                }

                                if (!targetVideoUrl) {
                                    const mp4Match = html.match(/(https:\/\/v16-webapp-prime\.tiktok\.com\/.*?\.mp4)/);
                                    if (mp4Match) {
                                        targetVideoUrl = mp4Match[1];
                                        console.log(`[Metadata] Found TikTok .mp4 via CDN.`);
                                    }
                                }
                            } catch (e) {
                                console.error('[Metadata] Error parsing TikTok scripts:', e);
                            }
                        }

                        const ogTitle = $('meta[property="og:title"]').attr('content');
                        const ogDescription = $('meta[property="og:description"]').attr('content');
                        const ogImage = $('meta[property="og:image"]').attr('content');
                        const musicMusician = $('meta[property="music:musician"]').attr('content');
                        const twitterArtist = $('meta[name="twitter:audio:artist_name"]').attr('content');
                        const pageTitle = $('title').text();

                        if (!title && ogTitle) title = ogTitle;
                        if (!thumbnailUrl && ogImage) thumbnailUrl = ogImage;

                        // ALBUM DETECTION
                        if (targetUrl.includes('/album/')) {
                            try {
                                const albumIdMatch = targetUrl.match(/album\/([a-zA-Z0-9]+)/);
                                const albumId = albumIdMatch ? albumIdMatch[1] : null;
                                if (albumId) {
                                    const embedUrl = `https://open.spotify.com/embed/album/${albumId}`;
                                    const embedRes = await fetch(embedUrl, {
                                        headers: {
                                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                                            'Referer': 'https://open.spotify.com/'
                                        }
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
                                                const tracks = entity.trackList.map((t: any) => {
                                                    const trackId = t.uri ? t.uri.split(':').pop() : t.uid;
                                                    return { title: t.title, artist: t.subtitle, url: `https://open.spotify.com/track/${trackId}`, image: albumCover, duration: t.duration };
                                                });
                                                return res.json({ title: entity.title || title || 'Álbum', artist: entity.subtitle || artist || '', thumbnailUrl: albumCover, type: 'album', platform: 'spotify', tracks: tracks });
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error('[Metadata] Album scraping failed:', e);
                            }
                        }

                        if (!artist) {
                            if (musicMusician) artist = musicMusician;
                            else if (twitterArtist) artist = twitterArtist;
                        }

                        if (!artist && isSpotify && pageTitle) {
                            const cleanTitle = pageTitle.replace(' | Spotify', '');
                            if (cleanTitle.includes(' - song and lyrics by ')) artist = cleanTitle.split(' - song and lyrics by ')[1];
                            else if (cleanTitle.includes(' - Single by ')) artist = cleanTitle.split(' - Single by ')[1];
                            else if (cleanTitle.includes(' - EP by ')) artist = cleanTitle.split(' - EP by ')[1];
                            else if (cleanTitle.includes(' - Album by ')) artist = cleanTitle.split(' - Album by ')[1];
                        }

                        if (!artist && ogDescription) {
                            if (isSpotify) {
                                const parts = ogDescription.split(' · ');
                                if (parts.length >= 2) artist = parts[0] === title ? parts[1] : parts[0];
                            } else if (isDeezer && ogDescription.includes(' by ')) {
                                artist = ogDescription.split(' by ')[1].split(' on Deezer')[0];
                            }
                        }
                    }
                } catch (scrapeError) {
                    console.error('[Metadata] Scraping failed:', scrapeError);
                }
            }

            if (title) title = title.replace(/ - (Single|EP|Album|Remastered|Radio Edit).*$/i, '').trim();
            if (artist) artist = artist.replace(/ on Spotify| on Deezer.*/i, '').trim();
            if (thumbnailUrl && thumbnailUrl.startsWith('//')) thumbnailUrl = 'https:' + thumbnailUrl;

            let videoId = '';
            if (isTiktok) {
                const idMatch = targetUrl.match(/\/video\/(\d+)/) || targetUrl.match(/v=(\d+)/) || targetUrl.match(/\/v\/(\d+)/);
                if (idMatch) videoId = idMatch[1];
            }

            return res.json({
                title: title || 'Link Desconhecido',
                artist: artist || '',
                thumbnailUrl: thumbnailUrl || '',
                type: type,
                platform: isSpotify ? 'spotify' : isDeezer ? 'deezer' : 'tiktok',
                resolvedUrl: targetUrl,
                videoId: videoId,
                videoUrl: targetVideoUrl
            });

        } catch (error) {
            console.error('[MusicMetadata] Error:', error);
            res.status(500).json({ error: 'Internal server error while fetching metadata' });
        }
    }
};
