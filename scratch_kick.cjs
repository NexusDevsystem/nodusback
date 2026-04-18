const https = require('https');
https.get('https://api.kick.com/v1/channels/v1xenbeast', {headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'}}, (res) => {
  let d='';
  res.on('data', c=>d+=c);
  res.on('end', ()=> {
    console.log('Status:', res.statusCode);
    console.log('Data:', d.substring(0, 500));
  });
});
