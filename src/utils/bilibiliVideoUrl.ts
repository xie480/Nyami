const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

export const createBilibiliVideoUrl = (
  bvid: string | null | undefined,
): string | null => {
  const normalizedBvid = bvid?.trim();

  if (!normalizedBvid || !BVID_PATTERN.test(normalizedBvid)) {
    return null;
  }

  return `https://www.bilibili.com/video/${normalizedBvid}`;
};
