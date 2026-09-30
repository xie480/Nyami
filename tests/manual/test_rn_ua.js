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
    const infoRes = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/'
      }
    });
    const cid = infoRes.data.data.cid;

    // Test with React Native default iOS User-Agent
    const rnUA = 'BiliMusic/1.0 CFNetwork/1240.0.4 Darwin/20.5.0';
    const params1 = { bvid, cid, fnval: 16, fnver: 0, fourk: 1 };
    const query1 = encWbi(params1, imgKey, subKey);
    
    const res1 = await axios.get(`https://api.bilibili.com/x/player/wbi/playurl?${query1}`, {
      headers: { 'User-Agent': rnUA, 'Referer': 'https://www.bilibili.com/' }
    });
    console.log('RN UA code:', res1.data.code);
    if (res1.data.data) {
      console.log('RN UA dash:', !!res1.data.data.dash);
      if (res1.data.data.dash) {
        console.log('RN UA audio:', !!res1.data.data.dash.audio);
      }
    }

    // Test with Android default UA
    const androidUA = 'Dalvik/2.1.0 (Linux; U; Android 11; Pixel 5 Build/RQ3A.210805.001.A1)';
    const params2 = { bvid, cid, fnval: 16, fnver: 0, fourk: 1 };
    const query2 = encWbi(params2, imgKey, subKey);
    const res2 = await axios.get(`https://api.bilibili.com/x/player/wbi/playurl?${query2}`, {
      headers: { 'User-Agent': androidUA, 'Referer': 'https://www.bilibili.com/' }
    });
    console.log('Android UA code:', res2.data.code);
    if (res2.data.data) {
      console.log('Android UA dash:', !!res2.data.data.dash);
      if (res2.data.data.dash) {
        console.log('Android UA audio:', !!res2.data.data.dash.audio);
      }
    }

  } catch (e) {
    console.error(e.message);
  }
}
test();
