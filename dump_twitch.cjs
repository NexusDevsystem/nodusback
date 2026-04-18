const https = require('https');
https.get('https://www.twitch.tv/v1xenbeast', {headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'}}, (res) => {
  let d='';
  res.on('data', c=>d+=c);
  res.on('end', ()=> {
    const fs = require('fs');
    fs.writeFileSync('twitch_dump.html', d);
    console.log('Dumped HTML to twitch_dump.html');
  });
});
