const https = require('https');

const url = 'https://open.spotify.com/oembed?url=https://open.spotify.com/track/2Z4QIsokss61j6jYZgcOTh';

https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        try {
            console.log(JSON.parse(data));
        } catch (e) {
            console.log('Body:', data);
        }
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});
