const axios = require('axios');

async function test() {
  try {
    console.log('Test 1: Desktop UA, no platform');
    const res1 = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1131277602&pn=1&ps=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/'
      }
    });
    console.log('Test 1 Success:', res1.data.code);
  } catch (e) {
    console.log('Test 1 Error:', e.response ? e.response.status : e.message);
  }

  try {
    console.log('\nTest 2: Mobile UA, no platform');
    const res2 = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1131277602&pn=1&ps=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.bilibili.com/'
      }
    });
    console.log('Test 2 Success:', res2.data.code);
  } catch (e) {
    console.log('Test 2 Error:', e.response ? e.response.status : e.message);
  }

  try {
    console.log('\nTest 3: Mobile UA, platform=web');
    const res3 = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1131277602&pn=1&ps=20&platform=web', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.bilibili.com/'
      }
    });
    console.log('Test 3 Success:', res3.data.code);
  } catch (e) {
    console.log('Test 3 Error:', e.response ? e.response.status : e.message);
  }
}
test();
