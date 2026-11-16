import {encWbi, WbiSigner} from '../src/api/wbi';

describe('共享核心 WBI', () => {
  it('生成排序后的签名参数，并移除危险字符', () => {
    const signed = encWbi(
      {keyword: "a!'()", page: 2},
      'abcdefghijklmnopqrstuvwxyz012345',
      '0123456789abcdefghijklmnopqrstuvwxyz',
      1_700_000_000_000,
    );

    expect(signed).toContain('keyword=a');
    expect(signed).toContain('page=2');
    expect(signed).toContain('wts=1700000000');
    expect(signed).toMatch(/&w_rid=[0-9a-f]{32}$/);
  });

  it('缓存未过期时不会重复读取密钥', async () => {
    const values = new Map<string, string>();
    const loadKeys = jest.fn(async () => ({imgKey: 'img', subKey: 'sub'}));
    const signer = new WbiSigner(
      loadKeys,
      {
        getString: key => values.get(key) ?? null,
        setString: (key, value) => values.set(key, value),
        delete: key => values.delete(key),
        contains: key => values.has(key),
      },
      60_000,
      () => 100_000,
    );

    await signer.getKeys();
    await signer.getKeys();

    expect(loadKeys).toHaveBeenCalledTimes(1);
  });
});
