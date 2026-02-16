
import * as cheerio from 'cheerio';
import * as fs from 'fs';

async function testScrapeAlbum(url: string) {
    console.log(`[MusicMetadata] Fetching for: ${url}`);

    try {
        const pageRes = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                // Important for embed scraping
                'Referer': 'https://open.spotify.com/'
            }
        });

        console.log(`Response Status: ${pageRes.status}`);

        if (pageRes.ok) {
            const html = await pageRes.text();

            // Save HTML to file for inspection
            fs.writeFileSync('spotify_dump_embed.html', html);
            console.log('Saved HTML to spotify_dump_embed.html');

            const $ = cheerio.load(html);

            const pageTitle = $('title').text();
            console.log('Title:', pageTitle);

            // In embed pages, data is often in a specific script tag: parsing `resource` or `initial-state`
            const nextDataScript = $('script[id="__NEXT_DATA__"]');
            if (nextDataScript.length > 0) {
                console.log('Found __NEXT_DATA__ script!');
                // parsing logic here
            }

            const resourceScript = $('script[id="resource"]'); // Older embed format
            if (resourceScript.length > 0) {
                console.log('Found resource script!');
                try {
                    const data = JSON.parse(resourceScript.html() || '{}');
                    if (data.tracks && data.tracks.items) {
                        console.log(`Found ${data.tracks.items.length} tracks in resource script.`);
                        data.tracks.items.forEach((t: any, idx: number) => {
                            if (idx < 5) console.log(`- ${t.name} by ${t.artists?.[0]?.name}`);
                        });
                    }
                } catch (e) { console.error(e); }
            }

            // Try extracting from JSON-LD if present (unlikely on embed but possible)
            const ldJsonScripts = $('script[type="application/ld+json"]');
            console.log(`Found ${ldJsonScripts.length} JSON-LD scripts`);

        } else {
            console.error('Failed to fetch page:', pageRes.status);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Test with embed URL
const testUrl = 'https://open.spotify.com/embed/album/0cS2hbnw0DfRqDHyqycEAm';
testScrapeAlbum(testUrl);
