const axios = require('axios');
const crypto = require('crypto');

const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
];

const getMixinKey = (orig) => mixinKeyEncTab.map(n => orig[n]).join('').slice(0, 32);

const encWbi = (params, imgKey, subKey) => {
  const mixinKey = getMixinKey(imgKey + subKey);
  const currTime = Math.round(Date.now() / 1000);
  const chrFilter = /[!'()*]/g;

  Object.assign(params, { wts: currTime });
  const query = Object.keys(params)
    .sort()
    .map(key => {
      const value = params[key].toString().replace(chrFilter, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');

  const wbiSign = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wbiSign}`;
};

async function test() {
  try {
    const navRes = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/'
      }
    });
    const imgUrl = navRes.data.data.wbi_img.img_url;
    const subUrl = navRes.data.data.wbi_img.sub_url;
    const imgKey = imgUrl.substring(imgUrl.lastIndexOf('/') + 1, imgUrl.length).split('.')[0];
    const subKey = subUrl.substring(subUrl.lastIndexOf('/') + 1, subUrl.length).split('.')[0];

    const bvid = 'BV1S2RuB5EK2';
    const cid = 1402958282;

    const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1';
    
    // Test without Referer
    const params1 = { bvid, cid, fnval: 16, fnver: 0, fourk: 1 };
    const query1 = encWbi(params1, imgKey, subKey);
    const res1 = await axios.get(`https://api.bilibili.com/x/player/wbi/playurl?${query1}`, {
      headers: { 'User-Agent': mobileUA } // No Referer
    });
    console.log('No Referer code:', res1.data.code);
    console.log('No Referer message:', res1.data.message);
    if (res1.data.data) {
      console.log('No Referer dash:', !!res1.data.data.dash);
    }

  } catch (e) {
    console.error(e.message);
  }
}
test();
