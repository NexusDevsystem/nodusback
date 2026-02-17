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
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }
                    });

                    if (response.ok) {
                        const data = await response.json() as any;

                        if (data.title) title = data.title;
                        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;

                        // Artist extraction
                        if (data.author_name && data.author_name !== 'Spotify' && data.author_name !== 'TikTok') {
                            artist = data.author_name;
                        }

                        // TikTok specific type detection
                        if (isTiktok) {
                            type = targetUrl.includes('/video/') ? 'video' : 'profile';
                            // TikTok title often contains the description, let's keep it as title
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
            // If OEmbed missed any piece (especially Artist) OR if it's TikTok (to get clean video URL), try scraping
            if (!title || !artist || !thumbnailUrl || isTiktok) {
                console.log(`[Metadata] Missing data or TikTok video, trying Scraping fallback for: ${targetUrl}`);
                try {
                    const pageRes = await fetch(targetUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.5',
                            'Cookie': 'tt_webid_v2=7300000000000000000;' // Some dummy cookie might help
                        }
                    });

                    if (pageRes.ok) {
                        const html = await pageRes.text();
                        const $ = cheerio.load(html);

                        // TikTok specific direct video extraction
                        if (isTiktok && targetUrl.includes('/video/')) {
                            try {
                                // Plan A: Look for __UNIVERSAL_DATA_FOR_REHYDRATION__ (Modern TikTok)
                                const hydrationData = $('script#\__UNIVERSAL_DATA_FOR_REHYDRATION__').html();
                                if (hydrationData) {
                                    const json = JSON.parse(hydrationData);
                                    // Path: defaultScope.webapp.video-detail.itemInfo.itemStruct.video.playAddr
                                    const videoInfo = json?.['defaultScope']?.['webapp.video-detail']?.['itemInfo']?.['itemStruct']?.['video'];
                                    if (videoInfo && videoInfo.playAddr) {
                                        targetVideoUrl = videoInfo.playAddr;
                                        console.log(`[Metadata] Found TikTok playAddr via Hydration: ${targetVideoUrl.substring(0, 50)}...`);
                                    }
                                }

                                // Plan B: Look for SIGI_STATE (Another common pattern)
                                if (!targetVideoUrl) {
                                    const sigiData = $('script#SIGI_STATE').html();
                                    if (sigiData) {
                                        const json = JSON.parse(sigiData);
                                        const itemModule = json?.ItemModule;
                                        if (itemModule) {
                                            const firstKey = Object.keys(itemModule)[0];
                                            const video = itemModule[firstKey]?.video;
                                            if (video && video.playAddr) {
                                                targetVideoUrl = video.playAddr;
                                                console.log(`[Metadata] Found TikTok playAddr via SIGI_STATE: ${targetVideoUrl.substring(0, 50)}...`);
                                            }
                                        }
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
                        const twitterArtist = $('meta[name="twitter:audio:artist_name"]').attr('content'); // Twitter card tag
                        const pageTitle = $('title').text(); // <title> tag often formatted "Song - Artist | Spotify"

                        if (!title && ogTitle) title = ogTitle;
                        if (!thumbnailUrl && ogImage) thumbnailUrl = ogImage;

                        // ALBUM DETECTION & SCRAPING (Embed Method)
                        if (targetUrl.includes('/album/')) {
                            console.log('[Metadata] Detected Spotify Album, trying Embed scraping...');
                            try {
                                // Extract Album ID safely
                                const albumIdMatch = targetUrl.match(/album\/([a-zA-Z0-9]+)/);
                                const albumId = albumIdMatch ? albumIdMatch[1] : null;

                                if (albumId) {
                                    const embedUrl = `https://open.spotify.com/embed/album/${albumId}`;
                                    console.log(`[Metadata] Fetching Embed URL: ${embedUrl}`);

                                    const embedRes = await fetch(embedUrl, {
                                        headers: {
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

                                            if (entity && entity.trackList) {
                                                const albumCover = entity.visualIdentity?.image?.[0]?.url || thumbnailUrl || '';

                                                const tracks = entity.trackList.map((t: any) => {
                                                    const trackId = t.uri ? t.uri.split(':').pop() : t.uid;
                                                    return {
                                                        title: t.title,
                                                        artist: t.subtitle,
                                                        url: `https://open.spotify.com/track/${trackId}`,
                                                        image: albumCover,
                                                        duration: t.duration
                                                    };
                                                });

                                                console.log(`[Metadata] Found ${tracks.length} tracks via Embed __NEXT_DATA__.`);

                                                return res.json({
                                                    title: entity.title || title || 'Álbum',
                                                    artist: entity.subtitle || artist || '',
                                                    thumbnailUrl: albumCover,
                                                    type: 'album',
                                                    platform: 'spotify',
                                                    tracks: tracks
                                                });
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error('[Metadata] Failed to scrape Spotify Embed:', e);
                            }
                        }

                        // Priority 1: Specific Meta Tags
                        if (!artist) {
                            if (musicMusician) {
                                artist = musicMusician;
                                console.log(`[Metadata] Found artist via music:musician: ${artist}`);
                            } else if (twitterArtist) {
                                artist = twitterArtist;
                                console.log(`[Metadata] Found artist via twitter:audio:artist_name: ${artist}`);
                            }
                        }

                        // Priority 2: <title> Tag Parsing
                        if (!artist && isSpotify && pageTitle) {
                            const cleanTitle = pageTitle.replace(' | Spotify', '');
                            if (cleanTitle.includes(' - song and lyrics by ')) {
                                artist = cleanTitle.split(' - song and lyrics by ')[1];
                            } else if (cleanTitle.includes(' - Single by ')) {
                                artist = cleanTitle.split(' - Single by ')[1];
                            } else if (cleanTitle.includes(' - EP by ')) {
                                artist = cleanTitle.split(' - EP by ')[1];
                            } else if (cleanTitle.includes(' - Album by ')) {
                                artist = cleanTitle.split(' - Album by ')[1];
                            } else if (title && cleanTitle.startsWith(title + ' - ')) {
                                artist = cleanTitle.substring(title.length + 3);
                            }
                        }

                        // Priority 3: og:description Parsing (Fallback)
                        if (!artist && ogDescription) {
                            if (isSpotify) {
                                const parts = ogDescription.split(' · ');
                                if (parts.length >= 2) {
                                    if (parts[0] === title && parts[1]) artist = parts[1];
                                    else if (parts[1] === title && parts[0]) artist = parts[0];
                                    else artist = parts[0];
                                } else if (ogDescription.includes(', a song by ')) {
                                    const bySplit = ogDescription.split(', a song by ');
                                    if (bySplit[1]) {
                                        artist = bySplit[1].replace(' on Spotify', '').split(' on ')[0];
                                    }
                                }
                            } else if (isDeezer && ogDescription.includes(' by ')) {
                                artist = ogDescription.split(' by ')[1].split(' on Deezer')[0];
                            }
                        }
                    }
                } catch (scrapeError) {
                    console.error('[Metadata] Scraping failed:', scrapeError);
                }
            }

            // CLEANUP
            if (title) title = title.replace(/ - (Single|EP|Album|Remastered|Radio Edit).*$/i, '').trim();
            if (artist) artist = artist.replace(/ on Spotify| on Deezer.*/i, '').trim();

            // Clean up URLs
            if (thumbnailUrl && thumbnailUrl.startsWith('//')) thumbnailUrl = 'https:' + thumbnailUrl;

            let videoId = '';
            if (isTiktok && targetUrl.includes('/video/')) {
                const match = targetUrl.match(/\/video\/(\d+)/);
                if (match) videoId = match[1];
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
