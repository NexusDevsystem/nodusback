const https = require('https');
https.get('https://www.twitch.tv/v1xenbeast', {headers: {'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'}}, (res) => {
  let d='';
  res.on('data', c=>d+=c);
  res.on('end', ()=> {
    const regex = /.{0,50}followers.{0,50}/gi;
    let match;
    while ((match = regex.exec(d)) !== null) {
      console.log('Match found:', match[0]);
    }
  });
});
