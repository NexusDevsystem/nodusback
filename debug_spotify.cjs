const https = require('https');

const targetUrl = 'https://open.spotify.com/intl-pt/track/2Z4QIsokss61j6jYZgcOTh?si=8c106bee2c4640b3';
const encodedTarget = encodeURIComponent(targetUrl);
const oembedUrl = `https://open.spotify.com/oembed?url=${encodedTarget}`;

console.log('Testing OEmbed:', oembedUrl);

function doRequest(u, label) {
    return new Promise(resolve => {
        https.get(u, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                console.log(`\n[${label}] Status:`, res.statusCode);
                if (label === 'OEMBED') {
                    try {
                        const json = JSON.parse(data);
                        console.log('Title:', json.title);
                        console.log('Author:', json.author_name);
                    } catch (e) { console.log('Body:', data.substring(0, 200)); }
                } else {
                    // Scraping
                    const ogDesc = data.match(/<meta property="og:description" content="([^"]+)"/);
                    const ogTitle = data.match(/<meta property="og:title" content="([^"]+)"/);
                    const musicMusician = data.match(/<meta property="music:musician" content="([^"]+)"/);

                    console.log('og:title:', ogTitle ? ogTitle[1] : 'null');
                    console.log('og:description:', ogDesc ? ogDesc[1] : 'null');
                    console.log('music:musician:', musicMusician ? musicMusician[1] : 'null');

                    // Check for redirect
                    if (res.statusCode >= 300 && res.statusCode < 400) {
                        console.log('Redirect to:', res.headers.location);
                    }
                }
                resolve();
            });
        }).on('error', e => { console.error(e); resolve(); });
    });
}

(async () => {
    await doRequest(oembedUrl, 'OEMBED');
    await doRequest(targetUrl, 'SCRAPING');
})();
