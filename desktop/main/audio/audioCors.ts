const ACCESS_CONTROL_ALLOW_ORIGIN = 'Access-Control-Allow-Origin';
const ACCESS_CONTROL_EXPOSE_HEADERS = 'Access-Control-Expose-Headers';
const ACCESS_CONTROL_ALLOW_CREDENTIALS = 'Access-Control-Allow-Credentials';
const EXPOSED_AUDIO_HEADERS = [
  'Accept-Ranges',
  'Content-Length',
  'Content-Range',
  'Content-Type',
].join(', ');

/**
 * 为受控音频响应补充 Web Audio 所需的 CORS 头。
 * @param responseHeaders Electron 返回的响应头
 * @returns 不修改原对象的 CORS 响应头
 */
export function withAudioCorsHeaders(
  responseHeaders: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const nextHeaders = {...(responseHeaders ?? {})};
  Object.keys(nextHeaders).forEach(key => {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === ACCESS_CONTROL_ALLOW_ORIGIN.toLowerCase() ||
      normalizedKey === ACCESS_CONTROL_EXPOSE_HEADERS.toLowerCase() ||
      normalizedKey === ACCESS_CONTROL_ALLOW_CREDENTIALS.toLowerCase()
    ) {
      delete nextHeaders[key];
    }
  });
  nextHeaders[ACCESS_CONTROL_ALLOW_ORIGIN] = ['*'];
  nextHeaders[ACCESS_CONTROL_EXPOSE_HEADERS] = [EXPOSED_AUDIO_HEADERS];
  return nextHeaders;
}
