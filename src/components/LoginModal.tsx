/**
 * B 站登录弹窗，提供网页登录二维码和账号密码两种入口。
 * Cookie 与刷新令牌只在 B 站页面上下文和本地 Keychain 之间流转。
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import CookieManager, {
  type Cookie,
  type Cookies,
} from '@react-native-cookies/cookies';
import QRCode from 'react-native-qrcode-svg';
import {WebView, type WebViewMessageEvent} from 'react-native-webview';
import {config} from '../config';
import {
  BILIBILI_AUTH_ENDPOINTS,
  BILIBILI_AUTH_HOSTS,
  BILIBILI_AUTH_TIMING,
  BILIBILI_API_STATUS,
  BILIBILI_COOKIE_REFRESH_CONFIRM_PARAMETER,
  BILIBILI_COOKIE_REFRESH_PARAMETER,
  BILIBILI_LOGIN_COOKIE_NAMES,
  BILIBILI_MAIN_HOSTS,
  BILIBILI_QR_STATUS,
  BILIBILI_REFRESH_PUBLIC_KEY,
  BILIBILI_REFRESH_TOKEN_CAPTURE_HOSTS,
  BILIBILI_REFRESH_TOKEN_PATTERN,
  BILIBILI_REFRESH_CSRF_SELECTOR,
  BILIBILI_REFRESH_TOKEN_STORAGE_KEY,
  BILIBILI_CSRF_COOKIE_NAME,
  BILIBILI_COOKIE_REFRESH_SOURCE,
  BILIBILI_WEBVIEW_MESSAGE,
} from '../config/bilibiliAuth';
import {biliLoginService} from '../services/biliLoginService';
import {biliWebViewBridge} from '../services/biliWebViewBridge';
import {cookieService} from '../services';
import {useAuthStore} from '../store/authStore';
import {useUIStore} from '../store/uiStore';
import {useTheme} from '../theme';

type LoginMode = 'qr' | 'password';
type WebViewPurpose = 'password' | 'qr-ticket' | 'refresh' | null;
type RefreshResultMessage = {
  type: (typeof BILIBILI_WEBVIEW_MESSAGE)[keyof typeof BILIBILI_WEBVIEW_MESSAGE];
  refreshToken?: string;
  taskId?: string;
};

const HTTPS_URL_HOST_PATTERN = /^https:\/\/([a-z0-9.-]+)(?::443)?(?:[/?#]|$)/i;

const REFRESH_TOKEN_CAPTURE_SCRIPT = `
(function () {
  try {
    var host = window.location.hostname;
    var captureHosts = ${JSON.stringify(BILIBILI_REFRESH_TOKEN_CAPTURE_HOSTS)};
    if (captureHosts.indexOf(host) !== -1) {
      var token = window.localStorage.getItem(${JSON.stringify(
        BILIBILI_REFRESH_TOKEN_STORAGE_KEY,
      )});
      if (token && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: ${JSON.stringify(
          BILIBILI_WEBVIEW_MESSAGE.refreshToken,
        )}, refreshToken: token }));
      }
    }
  } catch (error) {}
  true;
})();
`;

/** 只解析标准 HTTPS 主机，避免将外站地址或非标准端口视为 B 站页面。 */
function getHttpsUrlHost(value: string): string | null {
  const match = HTTPS_URL_HOST_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const host = match[1].toLowerCase();
  const labels = host.split('.');
  if (
    labels.some(
      label =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }
  return host;
}

/** 判断跳转是否仍处于允许的 B 站网页域名，防止桥接凭证进入外站。 */
function isTrustedBiliUrl(value: string): boolean {
  const host = getHttpsUrlHost(value);
  return (
    !!host &&
    BILIBILI_AUTH_HOSTS.some(root => host === root || host.endsWith(`.${root}`))
  );
}

/** 判断当前页面是否位于承载续期脚本的 B 站主站 origin。 */
function isMainBiliUrl(value: string): boolean {
  const host = getHttpsUrlHost(value);
  return !!host && BILIBILI_MAIN_HOSTS.some(mainHost => mainHost === host);
}

/** 将 CookieManager 返回的 Cookie map 转为请求头格式。 */
function cookiesToHeader(cookies: Cookies): string {
  return Object.entries(cookies)
    .filter(
      ([, cookie]) =>
        typeof cookie.value === 'string' && cookie.value.length > 0,
    )
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join('; ');
}

/** 合并主站与 Passport Cookie，重复名称以后出现的值为准。 */
function mergeCookieHeaders(...headers: string[]): string {
  const values = new Map<string, string>();
  headers.forEach(header => {
    header.split(';').forEach(part => {
      const separator = part.indexOf('=');
      if (separator <= 0) {
        return;
      }
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (name && value) {
        values.set(name, value);
      }
    });
  });
  return Array.from(values.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** 从两个 B 站 origin 读取共享的网页登录会话 Cookie。 */
async function readBilibiliCookie(): Promise<string> {
  const [mainCookies, passportCookies] = await Promise.all([
    CookieManager.get(BILIBILI_AUTH_ENDPOINTS.webHomeOrigin),
    CookieManager.get(BILIBILI_AUTH_ENDPOINTS.passportOrigin),
  ]);
  return mergeCookieHeaders(
    cookiesToHeader(mainCookies),
    cookiesToHeader(passportCookies),
  );
}

/** 等待 WebView 的 Set-Cookie 到达原生 CookieManager 后再读取。 */
async function waitForBilibiliCookie(): Promise<string> {
  let cookie = '';
  if (Platform.OS === 'android') {
    await CookieManager.flush();
  }
  for (
    let attempt = 0;
    attempt < BILIBILI_AUTH_TIMING.cookieWaitAttempts;
    attempt += 1
  ) {
    cookie = await readBilibiliCookie();
    if (
      cookieService.extractSessdata(cookie) &&
      cookieService.extractUid(cookie)
    ) {
      return cookie;
    }
    await new Promise(resolve =>
      setTimeout(resolve, BILIBILI_AUTH_TIMING.cookieWaitIntervalMs),
    );
  }
  return cookie;
}

/** 把 Keychain 中已有的 B 站 Cookie 注入 WebView，供网页登录续期复用。 */
async function seedWebViewCookies(cookieHeader: string): Promise<void> {
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name || !value) {
      continue;
    }
    const cookie: Cookie = {
      name,
      value,
      domain: '.bilibili.com',
      path: '/',
      secure: true,
    };
    const stored = await CookieManager.set(
      BILIBILI_AUTH_ENDPOINTS.webHomeOrigin,
      cookie,
    );
    if (!stored) {
      throw new Error('无法恢复 B 站网页 Cookie');
    }
  }
  if (Platform.OS === 'android') {
    await CookieManager.flush();
  }
}

/** 构造只在 B 站第一方页面执行的续期脚本，调用方校验任务 ID。 */
function buildCookieRefreshScript(
  refreshToken: string,
  timestamp: number,
  taskId: string,
): string {
  if (
    !BILIBILI_REFRESH_TOKEN_PATTERN.test(refreshToken) ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    throw new Error('B 站续期参数无效');
  }
  const input = JSON.stringify({refreshToken, timestamp, taskId});
  const protocol = JSON.stringify({
    publicKey: BILIBILI_REFRESH_PUBLIC_KEY,
    correspondPrefix: BILIBILI_AUTH_ENDPOINTS.correspondPrefix,
    cookieRefresh: BILIBILI_AUTH_ENDPOINTS.cookieRefresh,
    cookieRefreshConfirm: BILIBILI_AUTH_ENDPOINTS.cookieRefreshConfirm,
    refreshParameter: BILIBILI_COOKIE_REFRESH_PARAMETER,
    confirmParameter: BILIBILI_COOKIE_REFRESH_CONFIRM_PARAMETER,
    source: BILIBILI_COOKIE_REFRESH_SOURCE,
    apiSuccessCode: BILIBILI_API_STATUS.success,
    csrfCookieName: BILIBILI_CSRF_COOKIE_NAME,
    refreshCsrfSelector: BILIBILI_REFRESH_CSRF_SELECTOR,
    successMessage: BILIBILI_WEBVIEW_MESSAGE.cookieRefreshSuccess,
    errorMessage: BILIBILI_WEBVIEW_MESSAGE.cookieRefreshError,
  });
  return `
(function () {
  var input = ${input};
  var protocol = ${protocol};
  var send = function (message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };
  var readCookie = function (name) {
    var prefix = name + '=';
    var item = document.cookie.split(';').map(function (part) { return part.trim(); }).find(function (part) { return part.indexOf(prefix) === 0; });
    return item ? item.slice(prefix.length) : '';
  };
  (async function () {
    try {
      var publicKey = await window.crypto.subtle.importKey(
        'jwk',
        protocol.publicKey,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt']
      );
      var encrypted = await window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        new TextEncoder().encode('refresh_' + input.timestamp)
      );
      var correspondPath = Array.from(new Uint8Array(encrypted)).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
      var correspondResponse = await fetch(protocol.correspondPrefix + correspondPath, { credentials: 'include' });
      if (!correspondResponse.ok) throw new Error('correspond');
      var correspondHtml = await correspondResponse.text();
      var correspondDoc = new DOMParser().parseFromString(correspondHtml, 'text/html');
      var refreshCsrf = (correspondDoc.querySelector(protocol.refreshCsrfSelector) || {}).textContent;
      var csrf = readCookie(protocol.csrfCookieName);
      if (!refreshCsrf || !csrf) throw new Error('csrf');

      var refreshResponse = await fetch(protocol.cookieRefresh, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({
          [protocol.refreshParameter.csrf]: csrf,
          [protocol.refreshParameter.refreshCsrf]: refreshCsrf.trim(),
          [protocol.refreshParameter.source]: protocol.source,
          [protocol.refreshParameter.refreshToken]: input.refreshToken
        }).toString()
      });
      var refreshResult = await refreshResponse.json();
      if (!refreshResponse.ok || refreshResult.code !== protocol.apiSuccessCode || !refreshResult.data || !refreshResult.data[protocol.refreshParameter.refreshToken]) {
        throw new Error('refresh');
      }

      var newCsrf = readCookie(protocol.csrfCookieName);
      if (!newCsrf) throw new Error('new-csrf');
      var confirmResponse = await fetch(protocol.cookieRefreshConfirm, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({
          [protocol.confirmParameter.csrf]: newCsrf,
          [protocol.confirmParameter.refreshToken]: input.refreshToken
        }).toString()
      });
      var confirmResult = await confirmResponse.json();
      if (!confirmResponse.ok || confirmResult.code !== protocol.apiSuccessCode) throw new Error('confirm');
      send({ type: protocol.successMessage, refreshToken: refreshResult.data[protocol.refreshParameter.refreshToken], taskId: input.taskId });
    } catch (error) {
      send({ type: protocol.errorMessage, taskId: input.taskId });
    }
  })();
  true;
})();
`;
}

export const LoginModal = () => {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshTokenResolverRef = useRef<
    ((token: string | null) => void) | null
  >(null);
  const completingLoginRef = useRef(false);
  const refreshScriptStartedRef = useRef<string | null>(null);
  const login = useAuthStore(state => state.login);
  const loginModalVisible = useUIStore(state => state.loginModalVisible);
  const setLoginModalVisible = useUIStore(state => state.setLoginModalVisible);
  const refreshTask = useUIStore(state => state.authRefreshTask);
  const [mode, setMode] = useState<LoginMode>('qr');
  const [webViewPurpose, setWebViewPurpose] = useState<WebViewPurpose>(null);
  const [webViewUri, setWebViewUri] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrStatus, setQrStatus] = useState('正在生成二维码…');
  const [qrBusy, setQrBusy] = useState(false);
  const [qrGeneration, setQrGeneration] = useState(0);
  const [loginError, setLoginError] = useState('');
  const [loginChecking, setLoginChecking] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordReloadKey, setPasswordReloadKey] = useState(0);
  const [refreshStatus, setRefreshStatus] =
    useState('正在安全续期 B 站登录状态…');

  useEffect(() => {
    if (loginModalVisible) {
      setMode('qr');
      setWebViewPurpose(null);
      setWebViewUri(null);
      setQrUrl('');
      setLoginError('');
      setLoginChecking(false);
      setPasswordLoading(false);
      setPasswordError('');
      refreshTokenRef.current = null;
    }
  }, [loginModalVisible]);

  useEffect(() => {
    if (!refreshTask) {
      return;
    }
    let cancelled = false;
    completingLoginRef.current = false;
    refreshScriptStartedRef.current = null;
    setRefreshStatus('正在安全续期 B 站登录状态…');
    setWebViewPurpose('refresh');

    seedWebViewCookies(refreshTask.cookie)
      .then(() => {
        if (!cancelled) {
          setWebViewUri(BILIBILI_AUTH_ENDPOINTS.webHome);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        biliWebViewBridge.finish(
          refreshTask.id,
          null,
          new Error('无法准备 B 站网页会话'),
        );
        setWebViewUri(null);
        setWebViewPurpose(null);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshTask]);

  useEffect(() => {
    if (!loginModalVisible || mode !== 'qr' || refreshTask || webViewUri) {
      return;
    }
    let cancelled = false;
    let waitTimer: ReturnType<typeof setTimeout> | null = null;

    const wait = (duration: number) =>
      new Promise<void>(resolve => {
        waitTimer = setTimeout(resolve, duration);
      });

    const run = async () => {
      setQrBusy(true);
      setQrUrl('');
      setQrStatus('正在生成二维码…');
      setLoginError('');
      refreshTokenRef.current = null;
      try {
        const qr = await biliLoginService.generateQrCode();
        if (cancelled) {
          return;
        }
        if (!isTrustedBiliUrl(qr.url)) {
          const qrHost = getHttpsUrlHost(qr.url);
          throw new Error(
            qrHost
              ? `B 站返回了不受信任的二维码地址（${qrHost}）`
              : 'B 站返回的二维码地址格式无效',
          );
        }
        setQrUrl(qr.url);
        const expiresAt = Date.now() + BILIBILI_AUTH_TIMING.qrLifetimeMs;
        let scanned = false;

        while (!cancelled && Date.now() < expiresAt) {
          await wait(BILIBILI_AUTH_TIMING.qrPollIntervalMs);
          if (cancelled) {
            return;
          }
          const result = await biliLoginService.pollQrCode(qr.qrcode_key);
          if (result.code === BILIBILI_QR_STATUS.waiting) {
            if (!scanned) {
              setQrStatus('请在另一台已登录 B 站的设备上用哔哩哔哩 App 扫码');
            }
            continue;
          }
          if (result.code === BILIBILI_QR_STATUS.scanned) {
            scanned = true;
            setQrStatus('已扫码，请在手机上确认登录');
            continue;
          }
          if (result.code === BILIBILI_QR_STATUS.expired) {
            setQrUrl('');
            setQrStatus('二维码已过期，请重新生成');
            setQrBusy(false);
            return;
          }
          if (result.code === BILIBILI_API_STATUS.success) {
            if (!result.url) {
              throw new Error('B 站未返回登录凭证');
            }
            refreshTokenRef.current =
              typeof result.refresh_token === 'string' &&
              BILIBILI_REFRESH_TOKEN_PATTERN.test(result.refresh_token)
                ? result.refresh_token
                : null;
            setQrStatus('已确认，正在完成登录…');
            setQrBusy(false);
            await openQrLoginResult(result.url);
            return;
          }
          throw new Error('B 站返回了未知扫码状态');
        }
        if (!cancelled) {
          setQrUrl('');
          setQrStatus('二维码已过期，请重新生成');
          setQrBusy(false);
        }
      } catch (error) {
        if (!cancelled) {
          setQrUrl('');
          setQrStatus(
            error instanceof Error
              ? error.message
              : '无法连接 B 站二维码服务，请检查网络后重试',
          );
          setQrBusy(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      if (waitTimer) {
        clearTimeout(waitTimer);
      }
    };
  }, [loginModalVisible, mode, refreshTask, webViewUri, qrGeneration]);

  const openQrLoginResult = async (url: string) => {
    if (!isTrustedBiliUrl(url)) {
      throw new Error('B 站返回了不受信任的登录地址');
    }

    // 兼容旧版成功响应中直接携带 Cookie 的 URL 格式。
    try {
      const parsed = new URL(url);
      const cookieParts = BILIBILI_LOGIN_COOKIE_NAMES.map(name => {
        const value = parsed.searchParams.get(name);
        return value ? `${name}=${value}` : '';
      }).filter(Boolean);
      const oldStyleCookie = cookieParts.join('; ');
      if (cookieService.extractSessdata(oldStyleCookie)) {
        await seedWebViewCookies(oldStyleCookie);
        setWebViewPurpose('qr-ticket');
        setWebViewUri(url);
        return;
      }
    } catch {
      // 新版 ticket URL 不包含 Cookie，交给 B 站 WebView 完成跨域回调。
    }

    completingLoginRef.current = false;
    setWebViewPurpose('qr-ticket');
    setWebViewUri(url);
  };

  const waitForRefreshToken = async (): Promise<string | null> => {
    if (refreshTokenRef.current) {
      return refreshTokenRef.current;
    }
    return new Promise(resolve => {
      let settled = false;
      const finish = (token: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        refreshTokenResolverRef.current = null;
        clearTimeout(timer);
        resolve(token);
      };
      const timer = setTimeout(
        () => finish(refreshTokenRef.current),
        BILIBILI_AUTH_TIMING.refreshTokenCaptureWaitMs,
      );
      refreshTokenResolverRef.current = finish;
      webViewRef.current?.injectJavaScript(REFRESH_TOKEN_CAPTURE_SCRIPT);
    });
  };

  const completeWebLogin = async () => {
    if (completingLoginRef.current) {
      return;
    }
    completingLoginRef.current = true;
    setLoginChecking(true);
    setQrStatus('正在验证 B 站登录状态…');
    setLoginError('');
    try {
      const cookie = await waitForBilibiliCookie();
      if (
        !cookieService.extractSessdata(cookie) ||
        !cookieService.extractUid(cookie)
      ) {
        throw new Error('没有取得完整的 B 站登录 Cookie');
      }
      const refreshToken =
        refreshTokenRef.current || (await waitForRefreshToken());
      const previousCredentials = await cookieService.getCredentials();
      await cookieService.setCredentials(cookie, refreshToken, false);
      const valid = await login(cookieService.extractUid(cookie) ?? undefined);
      if (!valid) {
        if (previousCredentials.cookie) {
          await cookieService.setCredentials(
            previousCredentials.cookie,
            previousCredentials.refreshToken,
            false,
          );
        } else {
          await cookieService.clear();
        }
        throw new Error('B 站没有确认当前会话，请重新扫码或检查账号验证');
      }
      if (
        cookieService.extractUid(previousCredentials.cookie) !==
        cookieService.extractUid(cookie)
      ) {
        cookieService.clearAccountCaches();
      }
      setLoginModalVisible(false);
      setWebViewUri(null);
      setWebViewPurpose(null);
      setQrUrl('');
    } catch (error) {
      completingLoginRef.current = false;
      const message =
        error instanceof Error ? error.message : '登录未完成，请重试';
      if (webViewPurpose === 'qr-ticket') {
        setQrStatus('请先在下方 B 站页面完成验证，再点击检查登录');
      }
      setLoginError(message);
    } finally {
      setLoginChecking(false);
    }
  };

  const completeCookieRefresh = async (message: RefreshResultMessage) => {
    if (!refreshTask || completingLoginRef.current) {
      return;
    }
    completingLoginRef.current = true;
    try {
      if (!message.refreshToken) {
        throw new Error('B 站未返回新的续期凭证');
      }
      const cookie = await waitForBilibiliCookie();
      if (
        !cookieService.extractSessdata(cookie) ||
        !cookieService.extractUid(cookie)
      ) {
        throw new Error('续期后未取得完整 Cookie');
      }
      biliWebViewBridge.finish(refreshTask.id, {
        cookie,
        refreshToken: message.refreshToken,
      });
      setWebViewUri(null);
      setWebViewPurpose(null);
    } catch {
      biliWebViewBridge.finish(
        refreshTask.id,
        null,
        new Error('B 站登录续期未完成'),
      );
      setWebViewUri(null);
      setWebViewPurpose(null);
    }
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    if (!isTrustedBiliUrl(event.nativeEvent.url ?? '')) {
      return;
    }
    try {
      const message = JSON.parse(
        event.nativeEvent.data,
      ) as RefreshResultMessage;
      if (
        message.type === BILIBILI_WEBVIEW_MESSAGE.refreshToken &&
        typeof message.refreshToken === 'string' &&
        BILIBILI_REFRESH_TOKEN_PATTERN.test(message.refreshToken)
      ) {
        refreshTokenRef.current = message.refreshToken;
        refreshTokenResolverRef.current?.(message.refreshToken);
        return;
      }
      if (
        message.type === BILIBILI_WEBVIEW_MESSAGE.cookieRefreshSuccess &&
        refreshTask &&
        message.taskId === refreshTask.id
      ) {
        completeCookieRefresh(message);
        return;
      }
      if (
        message.type === BILIBILI_WEBVIEW_MESSAGE.cookieRefreshError &&
        refreshTask &&
        message.taskId === refreshTask.id
      ) {
        biliWebViewBridge.finish(
          refreshTask.id,
          null,
          new Error('B 站登录续期失败'),
        );
        setWebViewUri(null);
        setWebViewPurpose(null);
      }
    } catch {
      // 忽略非本应用桥接消息，不记录 WebView 内容。
    }
  };

  const handleLoadEnd = (url: string) => {
    if (refreshTask && webViewPurpose === 'refresh') {
      if (
        isMainBiliUrl(url) &&
        refreshScriptStartedRef.current !== refreshTask.id
      ) {
        refreshScriptStartedRef.current = refreshTask.id;
        webViewRef.current?.injectJavaScript(
          buildCookieRefreshScript(
            refreshTask.refreshToken,
            refreshTask.timestamp,
            refreshTask.id,
          ),
        );
      }
      return;
    }

    if (!webViewUri || !isTrustedBiliUrl(url)) {
      return;
    }
    if (
      (webViewPurpose === 'qr-ticket' || webViewPurpose === 'password') &&
      isMainBiliUrl(url)
    ) {
      completeWebLogin();
    }
  };

  const handleWebViewError = () => {
    if (refreshTask) {
      biliWebViewBridge.finish(
        refreshTask.id,
        null,
        new Error('B 站网页续期请求失败'),
      );
      setWebViewUri(null);
      setWebViewPurpose(null);
      return;
    }
    if (webViewPurpose === 'password') {
      setPasswordLoading(false);
      setPasswordError('无法连接 B 站登录页面，请检查网络后重试。');
      return;
    }
    if (webViewPurpose === 'qr-ticket') {
      completingLoginRef.current = false;
      setQrStatus('无法打开 B 站登录回调，请重新扫码');
      setLoginError('网络连接失败，请重试扫码登录');
      setWebViewUri(null);
      setWebViewPurpose(null);
    }
  };

  const handlePasswordHttpError = (statusCode: number) => {
    setPasswordLoading(false);
    setPasswordError(
      `B 站登录页面暂时无法加载（HTTP ${statusCode}），请稍后重试。`,
    );
  };

  const handlePasswordLoadEnd = (url: string) => {
    setPasswordLoading(false);
    handleLoadEnd(url);
  };

  const retryPasswordPage = () => {
    setPasswordError('');
    setPasswordLoading(true);
    setPasswordReloadKey(value => value + 1);
  };

  const selectMode = (nextMode: LoginMode) => {
    setMode(nextMode);
    setWebViewUri(
      nextMode === 'password' ? BILIBILI_AUTH_ENDPOINTS.passwordLogin : null,
    );
    setWebViewPurpose(nextMode === 'password' ? 'password' : null);
    setLoginError('');
    setQrUrl('');
    setQrStatus('正在生成二维码…');
    setQrBusy(false);
    setLoginChecking(false);
    setPasswordLoading(nextMode === 'password');
    setPasswordError('');
    if (nextMode === 'password') {
      setPasswordReloadKey(value => value + 1);
    }
    completingLoginRef.current = false;
    refreshTokenRef.current = null;
  };

  const closeLogin = () => {
    if (refreshTask) {
      return;
    }
    setLoginModalVisible(false);
    setWebViewUri(null);
    setWebViewPurpose(null);
  };

  const styles = StyleSheet.create({
    root: {flex: 1, backgroundColor: theme.colors.background},
    header: {
      minHeight: 82,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 22,
      paddingVertical: 12,
    },
    headerIdentity: {flex: 1, flexDirection: 'row', alignItems: 'center'},
    brandBadge: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 15,
      backgroundColor: theme.colors.primary,
    },
    brandBadgeText: {color: '#FFFFFF', fontSize: 25, fontWeight: '800'},
    headerCopy: {flex: 1, marginLeft: 12},
    title: {color: theme.colors.text, fontSize: 19, fontWeight: '700'},
    subtitle: {marginTop: 3, color: theme.colors.textSub, fontSize: 12},
    close: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 19,
      backgroundColor: theme.colors.surface,
    },
    closeText: {color: theme.colors.textSub, fontSize: 24, lineHeight: 28},
    tabs: {
      flexDirection: 'row',
      padding: 4,
      marginHorizontal: 22,
      marginTop: 8,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
    },
    tab: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 11,
    },
    activeTab: {backgroundColor: theme.colors.primary},
    tabText: {color: theme.colors.textSub, fontSize: 14, fontWeight: '500'},
    activeTabText: {color: '#FFFFFF'},
    qrScroll: {flex: 1},
    qrScrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      paddingHorizontal: 22,
      paddingTop: 24,
      paddingBottom: 30,
    },
    qrPanel: {width: '100%', maxWidth: 440, alignItems: 'center'},
    qrIntroTitle: {
      color: theme.colors.text,
      fontSize: 21,
      fontWeight: '700',
      textAlign: 'center',
    },
    qrIntroHint: {
      marginTop: 6,
      color: theme.colors.textSub,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
    },
    qrCard: {
      width: '100%',
      alignItems: 'center',
      marginTop: 18,
      paddingHorizontal: 18,
      paddingVertical: 20,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.divider,
      backgroundColor: theme.colors.surface,
      shadowColor: '#000000',
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: {width: 0, height: 6},
      elevation: 2,
    },
    qrFrame: {
      width: 236,
      height: 236,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FFFFFF',
      borderRadius: 19,
    },
    qrUnavailable: {alignItems: 'center', paddingHorizontal: 24},
    qrUnavailableMark: {
      color: theme.colors.error,
      fontSize: 32,
      fontWeight: '700',
    },
    qrUnavailableText: {
      marginTop: 6,
      color: theme.colors.textSub,
      fontSize: 13,
      textAlign: 'center',
    },
    qrHint: {
      marginTop: 17,
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    help: {
      marginTop: 7,
      color: theme.colors.textSub,
      fontSize: 12,
      lineHeight: 20,
      textAlign: 'center',
    },
    statusRow: {
      width: '100%',
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 10,
    },
    status: {
      flexShrink: 1,
      color: theme.colors.textSub,
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'center',
    },
    recoveryActions: {
      width: '100%',
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
    },
    recoveryButton: {
      flex: 1,
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
      borderRadius: 12,
      backgroundColor: theme.colors.background,
    },
    recoveryButtonPrimary: {backgroundColor: theme.colors.primary},
    recoveryButtonText: {
      color: theme.colors.primary,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    recoveryButtonTextPrimary: {color: '#FFFFFF'},
    action: {
      alignSelf: 'center',
      marginTop: 14,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
    },
    actionText: {color: theme.colors.primary, fontSize: 14, fontWeight: '600'},
    error: {
      marginTop: 12,
      color: theme.colors.error,
      fontSize: 13,
      textAlign: 'center',
    },
    passwordHelp: {
      marginHorizontal: 22,
      marginTop: 12,
      padding: 12,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
    },
    passwordHelpText: {
      color: theme.colors.textSub,
      fontSize: 12,
      lineHeight: 19,
    },
    passwordCheckButton: {
      alignSelf: 'flex-start',
      minHeight: 42,
      justifyContent: 'center',
      marginTop: 10,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: theme.colors.primary,
    },
    passwordCheckContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    passwordCheckText: {color: '#FFFFFF', fontSize: 13, fontWeight: '600'},
    disabledAction: {opacity: 0.7},
    webViewShell: {
      flex: 1,
      marginHorizontal: 12,
      marginTop: 10,
      marginBottom: 12,
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: theme.colors.background,
    },
    webView: {flex: 1, backgroundColor: theme.colors.background},
    webViewOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: theme.colors.background,
    },
    webViewLoadingText: {
      marginTop: 12,
      color: theme.colors.textSub,
      fontSize: 13,
    },
    webViewErrorTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
    },
    webViewErrorText: {
      marginTop: 8,
      color: theme.colors.textSub,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
    },
    webViewRetry: {
      marginTop: 18,
      paddingHorizontal: 18,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: theme.colors.primary,
    },
    webViewRetryText: {color: '#FFFFFF', fontSize: 14, fontWeight: '600'},
    ticketPanel: {paddingHorizontal: 20, paddingVertical: 10},
    refreshPanel: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 28,
    },
    refreshTitle: {
      marginTop: 16,
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    refreshHint: {
      marginTop: 8,
      color: theme.colors.textSub,
      fontSize: 13,
      textAlign: 'center',
      lineHeight: 20,
    },
    hiddenWebView: {position: 'absolute', width: 1, height: 1, opacity: 0},
  });

  return (
    <Modal
      visible={loginModalVisible || !!refreshTask}
      animationType="slide"
      onRequestClose={closeLogin}>
      <SafeAreaView style={styles.root}>
        {refreshTask ? (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>保持 B 站登录</Text>
            </View>
            <View style={styles.refreshPanel}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.refreshTitle}>{refreshStatus}</Text>
              <Text style={styles.refreshHint}>
                正在通过 B 站网页安全更新登录凭证，请稍候。
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.header}>
              <View style={styles.headerIdentity}>
                <View style={styles.brandBadge}>
                  <Text style={styles.brandBadgeText}>B</Text>
                </View>
                <View style={styles.headerCopy}>
                  <Text style={styles.title}>登录 BiliMusic</Text>
                  <Text style={styles.subtitle}>安全连接哔哩哔哩账号</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={closeLogin}
                style={styles.close}
                accessibilityRole="button">
                <Text style={styles.closeText}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.tabs}>
              <TouchableOpacity
                onPress={() => selectMode('qr')}
                disabled={loginChecking}
                style={[styles.tab, mode === 'qr' && styles.activeTab]}
                accessibilityRole="button">
                <Text
                  style={[
                    styles.tabText,
                    mode === 'qr' && styles.activeTabText,
                  ]}>
                  扫码登录
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => selectMode('password')}
                disabled={loginChecking}
                style={[styles.tab, mode === 'password' && styles.activeTab]}
                accessibilityRole="button">
                <Text
                  style={[
                    styles.tabText,
                    mode === 'password' && styles.activeTabText,
                  ]}>
                  账号密码
                </Text>
              </TouchableOpacity>
            </View>
            {mode === 'qr' && !webViewUri ? (
              <ScrollView
                style={styles.qrScroll}
                contentContainerStyle={styles.qrScrollContent}
                keyboardShouldPersistTaps="handled">
                <View style={styles.qrPanel}>
                  <Text style={styles.qrIntroTitle}>扫码快速登录</Text>
                  <Text style={styles.qrIntroHint}>
                    使用哔哩哔哩 App 扫描二维码并确认
                  </Text>
                  <View style={styles.qrCard}>
                    <View style={styles.qrFrame}>
                      {qrUrl ? (
                        <QRCode value={qrUrl} size={204} ecl="M" />
                      ) : qrBusy ? (
                        <ActivityIndicator
                          size="large"
                          color={theme.colors.primary}
                        />
                      ) : (
                        <View style={styles.qrUnavailable}>
                          <Text style={styles.qrUnavailableMark}>!</Text>
                          <Text style={styles.qrUnavailableText}>
                            暂时没有可用的二维码
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.qrHint}>
                      请用另一台已登录 B 站的设备扫码
                    </Text>
                    <Text style={styles.help}>
                      登录状态会安全保存在本机。若 B
                      站要求手机号验证，请按页面提示完成。
                    </Text>
                    <View style={styles.statusRow}>
                      {qrBusy && (
                        <ActivityIndicator
                          size="small"
                          color={theme.colors.primary}
                        />
                      )}
                      <Text style={styles.status}>{qrStatus}</Text>
                    </View>
                    {!qrBusy &&
                      (qrStatus.includes('过期') ||
                        (!qrUrl && qrStatus !== '正在生成二维码…') ||
                        !!loginError) && (
                        <View style={styles.recoveryActions}>
                          <TouchableOpacity
                            onPress={() => setQrGeneration(value => value + 1)}
                            style={styles.recoveryButton}
                            accessibilityRole="button">
                            <Text style={styles.recoveryButtonText}>
                              重新生成
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => selectMode('password')}
                            style={[
                              styles.recoveryButton,
                              styles.recoveryButtonPrimary,
                            ]}
                            accessibilityRole="button">
                            <Text
                              style={[
                                styles.recoveryButtonText,
                                styles.recoveryButtonTextPrimary,
                              ]}>
                              打开 B 站网页登录
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    {!!loginError && (
                      <Text style={styles.error}>{loginError}</Text>
                    )}
                  </View>
                </View>
              </ScrollView>
            ) : mode === 'password' && webViewUri ? (
              <>
                <View style={styles.passwordHelp}>
                  <Text style={styles.passwordHelpText}>
                    请在 B
                    站官方页面完成扫码、账密或人机验证。若验证完成后未自动登录，点击下方确认；应用不会读取密码或验证码。
                  </Text>
                  <TouchableOpacity
                    onPress={completeWebLogin}
                    disabled={loginChecking}
                    style={[
                      styles.passwordCheckButton,
                      loginChecking && styles.disabledAction,
                    ]}
                    accessibilityRole="button">
                    <View style={styles.passwordCheckContent}>
                      {loginChecking && (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      )}
                      <Text style={styles.passwordCheckText}>
                        {loginChecking
                          ? '正在确认登录…'
                          : '我已完成验证，检查登录'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {!!loginError && (
                    <Text style={styles.error}>{loginError}</Text>
                  )}
                </View>
                <View style={styles.webViewShell}>
                  <WebView
                    key={passwordReloadKey}
                    ref={webViewRef}
                    source={{uri: webViewUri}}
                    userAgent={config.userAgent}
                    onLoadStart={() => {
                      setPasswordLoading(true);
                      setPasswordError('');
                    }}
                    onLoadEnd={event =>
                      handlePasswordLoadEnd(event.nativeEvent.url)
                    }
                    onHttpError={event =>
                      handlePasswordHttpError(event.nativeEvent.statusCode)
                    }
                    onMessage={handleMessage}
                    onError={handleWebViewError}
                    onShouldStartLoadWithRequest={request =>
                      isTrustedBiliUrl(request.url)
                    }
                    injectedJavaScript={REFRESH_TOKEN_CAPTURE_SCRIPT}
                    sharedCookiesEnabled
                    thirdPartyCookiesEnabled
                    style={styles.webView}
                  />
                  {passwordLoading && !passwordError && (
                    <View pointerEvents="none" style={styles.webViewOverlay}>
                      <ActivityIndicator
                        size="large"
                        color={theme.colors.primary}
                      />
                      <Text style={styles.webViewLoadingText}>
                        正在安全加载 B 站登录页面…
                      </Text>
                    </View>
                  )}
                  {!!passwordError && (
                    <View style={styles.webViewOverlay}>
                      <Text style={styles.webViewErrorTitle}>
                        暂时无法显示登录页面
                      </Text>
                      <Text style={styles.webViewErrorText}>
                        {passwordError}
                      </Text>
                      <TouchableOpacity
                        onPress={retryPasswordPage}
                        style={styles.webViewRetry}
                        accessibilityRole="button">
                        <Text style={styles.webViewRetryText}>重新加载</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </>
            ) : webViewPurpose === 'qr-ticket' ? (
              <>
                <View style={styles.ticketPanel}>
                  <Text style={styles.refreshHint}>
                    如 B
                    站要求手机验证，请在下方官方页面完成；返回主站后会自动确认，或点击按钮检查登录。
                  </Text>
                  <TouchableOpacity
                    onPress={completeWebLogin}
                    disabled={loginChecking}
                    style={styles.action}
                    accessibilityRole="button">
                    <View style={styles.passwordCheckContent}>
                      {loginChecking && (
                        <ActivityIndicator
                          size="small"
                          color={theme.colors.primary}
                        />
                      )}
                      <Text style={styles.actionText}>
                        {loginChecking
                          ? '正在确认登录…'
                          : '我已完成验证，检查登录'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {!!loginError && (
                    <Text style={styles.error}>{loginError}</Text>
                  )}
                </View>
                {!!webViewUri && (
                  <WebView
                    ref={webViewRef}
                    source={{uri: webViewUri}}
                    userAgent={config.userAgent}
                    onLoadEnd={event => handleLoadEnd(event.nativeEvent.url)}
                    onMessage={handleMessage}
                    onError={handleWebViewError}
                    onShouldStartLoadWithRequest={request =>
                      isTrustedBiliUrl(request.url)
                    }
                    sharedCookiesEnabled
                    thirdPartyCookiesEnabled
                    style={styles.webView}
                  />
                )}
              </>
            ) : null}
          </>
        )}

        {refreshTask && webViewUri && (
          <WebView
            ref={webViewRef}
            source={{uri: webViewUri}}
            userAgent={config.userAgent}
            onLoadEnd={event => handleLoadEnd(event.nativeEvent.url)}
            onMessage={handleMessage}
            onError={handleWebViewError}
            onShouldStartLoadWithRequest={request =>
              isTrustedBiliUrl(request.url)
            }
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            style={styles.hiddenWebView}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
};
