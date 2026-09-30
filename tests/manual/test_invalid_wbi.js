const axios = require('axios');

async function test() {
  try {
    const bvid = 'BV1S2RuB5EK2';
    const cid = 1402958282; // Just a guess or we can fetch it
    
    const infoRes = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/'
      }
    });
    const actualCid = infoRes.data.data.cid;

    const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1';
    
    // Test with invalid WBI sign
    const res1 = await axios.get(`https://api.bilibili.com/x/player/wbi/playurl?bvid=${bvid}&cid=${actualCid}&fnval=16&fnver=0&fourk=1&w_rid=invalid&wts=1234567890`, {
      headers: { 'User-Agent': mobileUA, 'Referer': 'https://www.bilibili.com/' }
    });
    console.log('Invalid WBI code:', res1.data.code);
    console.log('Invalid WBI message:', res1.data.message);
    if (res1.data.data) {
      console.log('Invalid WBI dash:', !!res1.data.data.dash);
    }

  } catch (e) {
    console.error(e.message);
  }
}
test();
