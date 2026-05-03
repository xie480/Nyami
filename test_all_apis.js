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
      return `\${encodeURIComponent(key)}=\${encodeURIComponent(value)}`;
    })
    .join('&');

  const wbiSign = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return `\${query}&w_rid=\${wbiSign}`;
};

async function test() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15',
    'Referer': 'https://www.bilibili.com/'
  };

  try {
    console.log('Testing getFavoriteFolders...');
    const res1 = await axios.get('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=3546565581561342', { headers });
    console.log('getFavoriteFolders:', res1.data.code);

    console.log('Testing getFavoriteVideos...');
    const res2 = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1131277602&pn=1&ps=20', { headers });
    console.log('getFavoriteVideos:', res2.data.code);

    console.log('Testing getVideoInfo...');
    const res3 = await axios.get('https://api.bilibili.com/x/web-interface/view?bvid=BV1114y11111', { headers });
    console.log('getVideoInfo:', res3.data.code);

    if (res3.data.code === 0) {
      const cid = res3.data.data.cid;
      const bvid = 'BV1114y11111';

      const navRes = await axios.get('https://api.bilibili.com/x/web-interface/nav', { headers });
      const imgUrl = navRes.data.data.wbi_img.img_url;
      const subUrl = navRes.data.data.wbi_img.sub_url;
      const imgKey = imgUrl.substring(imgUrl.lastIndexOf('/') + 1, imgUrl.length).split('.')[0];
      const subKey = subUrl.substring(subUrl.lastIndexOf('/') + 1, subUrl.length).split('.')[0];

      const params = { bvid, cid, fnval: 16, fnver: 0, fourk: 1 };
      const query = encWbi(params, imgKey, subKey);

      console.log('Testing getPlayUrl...');
      const res4 = await axios.get(`https://api.bilibili.com/x/player/wbi/playurl?\${query}\`, { headers });
      console.log('getPlayUrl:', res4.data.code);
    }
  } catch (e) {
    console.error('Error:', e.response ? e.response.status : e.message);
  }
      }
  test();
      