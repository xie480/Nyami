const axios = require('axios');

async function test() {
  try {
    const spiRes = await axios.get('https://api.bilibili.com/x/frontend/finger/spi');
    const buvid3 = spiRes.data.data.b_3;
    const buvid4 = spiRes.data.data.b_4;
    console.log('buvid3:', buvid3);
    
    const res = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1131277602&pn=1&ps=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
        'Cookie': `buvid3=${buvid3}; buvid4=${buvid4}`
      }
    });
    console.log('Success:', res.data.code);
  } catch (e) {
    console.error('Error:', e.response ? e.response.status : e.message);
  }
}
test();
