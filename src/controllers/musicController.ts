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

            // NOTE: We do NOT strip /intl-xx/ from Spotify URLs anymore because 
            // the OEmbed API often returns 404 if the URL doesn't match the canonical one, 
            // or sometimes it needs the locale. Letting it pass through as-is is safer.

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

            // METHOD 2: SCRAPING (Fallback/Enhancement)
            // If OEmbed missed any piece (especially Artist), try scraping
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
                        const musicMusician = $('meta[property="music:musician"]').attr('content');
                        const twitterArtist = $('meta[name="twitter:audio:artist_name"]').attr('content'); // Twitter card tag
                        const pageTitle = $('title').text(); // <title> tag often formatted "Song - Artist | Spotify"

                        if (!title && ogTitle) title = ogTitle;
                        if (!thumbnailUrl && ogImage) thumbnailUrl = ogImage;

                        // ALBUM DETECTION & SCRAPING (Embed Method)
                        if (targetUrl.includes('/album/')) {
                            console.log('[MusicMetadata] Detected Spotify Album, trying Embed scraping...');
                            try {
                                // Extract Album ID safely
                                const albumIdMatch = targetUrl.match(/album\/([a-zA-Z0-9]+)/);
                                const albumId = albumIdMatch ? albumIdMatch[1] : null;

                                if (albumId) {
                                    const embedUrl = `https://open.spotify.com/embed/album/${albumId}`;
                                    console.log(`[MusicMetadata] Fetching Embed URL: ${embedUrl}`);

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
                                            // Path to entity might vary, but usually props.pageProps.state.data.entity
                                            const entity = jsonData?.props?.pageProps?.state?.data?.entity;

                                            if (entity && entity.trackList) {
                                                const albumCover = entity.visualIdentity?.image?.[0]?.url || thumbnailUrl || '';

                                                const tracks = entity.trackList.map((t: any) => ({
                                                    title: t.title,
                                                    artist: t.subtitle,
                                                    url: `https://open.spotify.com/track/${t.uid}`,
                                                    image: albumCover, // Assign album cover to each track
                                                    duration: t.duration
                                                }));

                                                console.log(`[MusicMetadata] Found ${tracks.length} tracks via Embed __NEXT_DATA__.`);

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
                                console.error('[MusicMetadata] Failed to scrape Spotify Embed:', e);
                            }
                        }

                        // Priority 1: Specific Meta Tags
                        if (!artist) {
                            if (musicMusician) {
                                artist = musicMusician;
                                console.log(`[MusicMetadata] Found artist via music:musician: ${artist}`);
                            } else if (twitterArtist) {
                                artist = twitterArtist;
                                console.log(`[MusicMetadata] Found artist via twitter:audio:artist_name: ${artist}`);
                            }
                        }

                        // Priority 2: <title> Tag Parsing
                        // Format is usually "Song Name - song and lyrics by Artist Name | Spotify" or "Song Name - Single by Artist Name | Spotify"
                        if (!artist && isSpotify && pageTitle) {
                            // Remove " | Spotify" suffix
                            const cleanTitle = pageTitle.replace(' | Spotify', '');

                            // Check for " - song and lyrics by "
                            if (cleanTitle.includes(' - song and lyrics by ')) {
                                artist = cleanTitle.split(' - song and lyrics by ')[1];
                                console.log(`[MusicMetadata] Found artist via <title> (lyrics pattern): ${artist}`);
                            }
                            // Check for " - Single by "
                            else if (cleanTitle.includes(' - Single by ')) {
                                artist = cleanTitle.split(' - Single by ')[1];
                                console.log(`[MusicMetadata] Found artist via <title> (single pattern): ${artist}`);
                            }
                            // Check for " - EP by "
                            else if (cleanTitle.includes(' - EP by ')) {
                                artist = cleanTitle.split(' - EP by ')[1];
                                console.log(`[MusicMetadata] Found artist via <title> (EP pattern): ${artist}`);
                            }
                            // Check for " - Album by "
                            else if (cleanTitle.includes(' - Album by ')) {
                                artist = cleanTitle.split(' - Album by ')[1];
                                console.log(`[MusicMetadata] Found artist via <title> (Album pattern): ${artist}`);
                            }
                            // Fallback: Check for simple dash separator if title is known
                            else if (title && cleanTitle.startsWith(title + ' - ')) {
                                artist = cleanTitle.substring(title.length + 3); // Remove "Title - "
                                console.log(`[MusicMetadata] Found artist via <title> (dash pattern): ${artist}`);
                            }
                        }

                        // Priority 3: og:description Parsing (Fallback)
                        if (!artist && ogDescription) {
                            if (isSpotify) {
                                // "Listen to [Song] on Spotify. [Artist] · Song · [Year]."
                                // "Song · Artist · Album"
                                const parts = ogDescription.split(' · ');
                                if (parts.length >= 2) {
                                    // Heuristic: If we have the title, the other part might be the artist
                                    if (parts[0] === title && parts[1]) artist = parts[1];
                                    else if (parts[1] === title && parts[0]) artist = parts[0];
                                    else artist = parts[0]; // Best guess is usually the first part if not title
                                    console.log(`[MusicMetadata] Found artist via og:description (dot pattern): ${artist}`);
                                } else if (ogDescription.includes(', a song by ')) {
                                    // "Song Name, a song by Artist Name on Spotify"
                                    const bySplit = ogDescription.split(', a song by ');
                                    if (bySplit[1]) {
                                        artist = bySplit[1].replace(' on Spotify', '').split(' on ')[0];
                                        console.log(`[MusicMetadata] Found artist via og:description (sentence pattern): ${artist}`);
                                    }
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

            // Clean up URLs
            if (thumbnailUrl && thumbnailUrl.startsWith('//')) thumbnailUrl = 'https:' + thumbnailUrl;

            return res.json({
                title: title || 'Música Desconhecida',
                artist: artist || '', // Empty string to allow frontend placeholder
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
