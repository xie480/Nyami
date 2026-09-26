/**
 * B 站登录弹窗，提供网页登录二维码和账号密码两种入口。
 * Cookie 与刷新令牌只在 B 站页面上下文和本地 Keychain 之间流转。
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
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

/** 判断跳转是否仍处于允许的 B 站网页域名，防止桥接凭证进入外站。 */
function isTrustedBiliUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return BILIBILI_AUTH_HOSTS.some(
      root => host === root || host.endsWith(`.${root}`),
    );
  } catch {
    return false;
  }
}

/** 判断当前页面是否位于承载续期脚本的 B 站主站 origin。 */
function isMainBiliUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return BILIBILI_MAIN_HOSTS.some(mainHost => mainHost === host);
  } catch {
    return false;
  }
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
  const [refreshStatus, setRefreshStatus] =
    useState('正在安全续期 B 站登录状态…');

  useEffect(() => {
    if (loginModalVisible) {
      setMode('qr');
      setWebViewPurpose(null);
      setWebViewUri(null);
      setQrUrl('');
      setLoginError('');
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
          throw new Error('B 站返回了不受信任的二维码地址');
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
          setQrStatus('二维码已过期，请重新生成');
          setQrBusy(false);
        }
      } catch {
        if (!cancelled) {
          setQrStatus('暂时无法获取扫码状态，请检查网络后重试');
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
    if (webViewPurpose === 'qr-ticket') {
      completingLoginRef.current = false;
      setQrStatus('无法打开 B 站登录回调，请重新扫码');
      setLoginError('网络连接失败，请重试扫码登录');
      setWebViewUri(null);
      setWebViewPurpose(null);
    }
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
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.divider,
    },
    title: {color: theme.colors.text, fontSize: 17, fontWeight: '600'},
    close: {paddingVertical: 8, paddingHorizontal: 6},
    closeText: {color: theme.colors.textSub, fontSize: 15},
    tabs: {
      flexDirection: 'row',
      padding: 4,
      marginHorizontal: 20,
      marginTop: 16,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
    },
    tab: {
      flex: 1,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    },
    activeTab: {backgroundColor: theme.colors.primary},
    tabText: {color: theme.colors.textSub, fontSize: 14, fontWeight: '500'},
    activeTabText: {color: '#FFFFFF'},
    qrPanel: {alignItems: 'center', paddingHorizontal: 24, paddingTop: 30},
    qrFrame: {
      width: 252,
      height: 252,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FFFFFF',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.divider,
    },
    qrHint: {
      marginTop: 20,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: '500',
      textAlign: 'center',
    },
    help: {
      marginTop: 8,
      color: theme.colors.textSub,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
    },
    statusRow: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
    },
    status: {color: theme.colors.textSub, fontSize: 13},
    action: {marginTop: 16, paddingVertical: 10, paddingHorizontal: 16},
    actionText: {color: theme.colors.primary, fontSize: 14, fontWeight: '600'},
    error: {
      marginTop: 12,
      color: theme.colors.error,
      fontSize: 13,
      textAlign: 'center',
    },
    webView: {flex: 1, marginTop: 12},
    passwordHelp: {marginHorizontal: 22, marginTop: 12},
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
              <Text style={styles.title}>登录哔哩哔哩</Text>
              <TouchableOpacity
                onPress={closeLogin}
                style={styles.close}
                accessibilityRole="button">
                <Text style={styles.closeText}>关闭</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.tabs}>
              <TouchableOpacity
                onPress={() => selectMode('qr')}
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
              <View style={styles.qrPanel}>
                <View style={styles.qrFrame}>
                  {qrUrl ? (
                    <QRCode value={qrUrl} size={220} ecl="M" />
                  ) : (
                    <ActivityIndicator
                      size="large"
                      color={theme.colors.primary}
                    />
                  )}
                </View>
                <Text style={styles.qrHint}>
                  使用另一台已登录 B 站的设备扫码
                </Text>
                <Text style={styles.help}>
                  扫码确认后，本应用会安全保存登录状态。若 B
                  站要求手机号验证，仍需按 B 站页面完成验证。
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
                {(qrStatus.includes('过期') ||
                  qrStatus.includes('无法') ||
                  !!loginError) && (
                  <TouchableOpacity
                    onPress={() => setQrGeneration(value => value + 1)}
                    style={styles.action}
                    accessibilityRole="button">
                    <Text style={styles.actionText}>重新生成二维码</Text>
                  </TouchableOpacity>
                )}
                {!!loginError && <Text style={styles.error}>{loginError}</Text>}
              </View>
            ) : mode === 'password' && webViewUri ? (
              <>
                <Text style={[styles.help, styles.passwordHelp]}>
                  请在 B
                  站页面完成登录和必要的安全验证；若收不到短信，可返回尝试扫码登录。
                </Text>
                <WebView
                  ref={webViewRef}
                  source={{uri: webViewUri}}
                  onLoadEnd={event => handleLoadEnd(event.nativeEvent.url)}
                  onNavigationStateChange={() => {}}
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
                {!!loginError && <Text style={styles.error}>{loginError}</Text>}
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
                    style={styles.action}
                    accessibilityRole="button">
                    <Text style={styles.actionText}>
                      我已完成验证，检查登录
                    </Text>
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
