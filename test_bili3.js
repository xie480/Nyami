const axios = require('axios');

async function test() {
  try {
    const res = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1131277602&pn=1&ps=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.bilibili.com/'
      }
    });
    console.log('Success:', res.data.code);
  } catch (e) {
    console.error('Error:', e.response ? e.response.status : e.message);
  }
}
test();
