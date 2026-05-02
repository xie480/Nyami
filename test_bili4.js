const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1131277602&pn=1&ps=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
        'Cookie': 'SESSDATA=fake_sessdata_for_test;'
      }
    });
    console.log('Success:', res.data.code);
  } catch (e) {
    console.error('Error:', e.response ? e.response.status : e.message);
  }
}
test();
