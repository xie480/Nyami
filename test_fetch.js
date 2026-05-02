async function test() {
  try {
    const res = await fetch('https://api.bilibili.com/x/v3/fav/resource/list?media_id=1131277602&pn=1&ps=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/'
      }
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Body:', text.substring(0, 100));
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
