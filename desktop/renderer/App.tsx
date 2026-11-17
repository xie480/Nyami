import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  AudioProbeResult,
  AudioRequestRecord,
  AuthStatus,
  QrStatusEvent,
} from '../shared/types';

type Panel = 'login' | 'audio';

/**
 * 阶段 0 桌面验证工作台。
 * 用两个独立面板验证登录、受控 WebContentsView、远程音频请求和离线样例播放。
 */
export function App(): JSX.Element {
  const [panel, setPanel] = useState<Panel>('login');
  const [auth, setAuth] = useState<AuthStatus>({
    loggedIn: false,
    uid: null,
  });
  const [qrImageDataUrl, setQrImageDataUrl] = useState('');
  const [qrStatus, setQrStatus] = useState('准备生成二维码');
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [retryUrl, setRetryUrl] = useState('');
  const [audioSrc, setAudioSrc] = useState('');
  const [probeResult, setProbeResult] = useState<AudioProbeResult | null>(null);
  const [probeError, setProbeError] = useState('');
  const [requestRecords, setRequestRecords] = useState<AudioRequestRecord[]>([]);
  const [localFileName, setLocalFileName] = useState('');
  const localObjectUrlRef = useRef<string | null>(null);
  const qrStartedRef = useRef(false);

  /**
   * 刷新主进程脱敏登录状态。
   */
  const refreshAuthStatus = useCallback(async () => {
    setAuth(await window.nyamiDesktop.auth.getStatus());
  }, []);

  /**
   * 请求主进程生成二维码并开始轮询。
   */
  const startQrLogin = useCallback(async () => {
    setLoginBusy(true);
    setQrStatus('正在生成二维码');
    try {
      const result = await window.nyamiDesktop.auth.startQrLogin();
      setQrImageDataUrl(result.qrImageDataUrl);
      setQrExpiresAt(result.expiresAt);
      setQrStatus('请使用 Bilibili 客户端扫码');
    } catch (error) {
      setQrStatus(error instanceof Error ? error.message : '二维码生成失败');
    } finally {
      setLoginBusy(false);
    }
  }, []);

  /**
   * 注册二维码状态事件并在启动时读取登录状态。
   */
  useEffect(() => {
    const unsubscribe = window.nyamiDesktop.auth.onQrStatus(
      (event: QrStatusEvent) => {
        setQrStatus(event.message);
        if (event.expiresAt) {
          setQrExpiresAt(event.expiresAt);
        }
        if (event.auth) {
          setAuth(event.auth);
        }
        if (event.status === 'success') {
          setLoginBusy(false);
        }
      },
    );
    void refreshAuthStatus();
    if (!qrStartedRef.current) {
      qrStartedRef.current = true;
      void startQrLogin();
    }
    return unsubscribe;
  }, [refreshAuthStatus, startQrLogin]);

  /**
   * 释放本地对象 URL，避免重复选择文件后积累 Blob 引用。
   */
  useEffect(
    () => () => {
      if (localObjectUrlRef.current) {
        URL.revokeObjectURL(localObjectUrlRef.current);
      }
    },
    [],
  );

  /**
   * 触发一次远程音频 Range 探测，并在提供新地址时验证过期重取。
   */
  const inspectAudio = useCallback(async () => {
    setProbeError('');
    setProbeResult(null);
    try {
      const result = await window.nyamiDesktop.probes.inspectAudio({
        url: remoteUrl,
        retryUrl: retryUrl || undefined,
      });
      setProbeResult(result);
      if (result.ok) {
        setAudioSrc(result.retried && retryUrl ? retryUrl : remoteUrl);
      } else {
        setAudioSrc('');
      }
      setRequestRecords(
        await window.nyamiDesktop.probes.getRecentAudioRequests(),
      );
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : '音频探测失败');
    }
  }, [remoteUrl, retryUrl]);

  /**
   * 读取 Chromium 播放器产生的脱敏请求摘要。
   */
  const refreshRequestRecords = useCallback(async () => {
    setRequestRecords(
      await window.nyamiDesktop.probes.getRecentAudioRequests(),
    );
  }, []);

  /**
   * 播放仓库内固定样例，验证完全离线时的本地协议播放。
   */
  const playOfflineSample = useCallback(async () => {
    setProbeError('');
    setAudioSrc(await window.nyamiDesktop.probes.getSampleAudioUrl());
  }, []);

  /**
   * 处理用户选择的本地音频文件。
   * @param event 文件输入事件
   */
  const handleLocalFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (localObjectUrlRef.current) {
      URL.revokeObjectURL(localObjectUrlRef.current);
    }
    localObjectUrlRef.current = URL.createObjectURL(file);
    setLocalFileName(file.name);
    setAudioSrc(localObjectUrlRef.current);
  };

  /**
   * 退出登录并刷新脱敏状态。
   */
  const logout = useCallback(async () => {
    await window.nyamiDesktop.auth.logout();
    await refreshAuthStatus();
    setQrImageDataUrl('');
  }, [refreshAuthStatus]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">NYAMI / WINDOWS SPIKE</p>
          <h1>桌面关键链路验证台</h1>
        </div>
        <div className="auth-chip" aria-live="polite">
          <span className={auth.loggedIn ? 'status-dot online' : 'status-dot'} />
          {auth.loggedIn ? `已登录 · UID ${auth.uid ?? '未知'}` : '未登录'}
        </div>
      </header>

      <nav className="tabs" aria-label="阶段 0 验证面板">
        <button
          className={panel === 'login' ? 'tab active' : 'tab'}
          onClick={() => setPanel('login')}
          type="button">
          登录与 WebContentsView
        </button>
        <button
          className={panel === 'audio' ? 'tab active' : 'tab'}
          onClick={() => setPanel('audio')}
          type="button">
          音频与离线播放
        </button>
      </nav>

      {panel === 'login' ? (
        <section className="panel-grid">
          <section className="card qr-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">AUTH PROBE</p>
                <h2>二维码登录</h2>
              </div>
              <span className="badge">主进程轮询</span>
            </div>
            <p className="muted">
              二维码密钥只留在 Electron 主进程；扫码确认后，登录页会在受控的
              WebContentsView 中读取 Cookie。
            </p>
            <div className="qr-stage">
              {qrImageDataUrl ? (
                <img
                  alt="Bilibili 登录二维码"
                  className="qr-image"
                  src={qrImageDataUrl}
                />
              ) : (
                <div className="qr-placeholder">二维码尚未生成</div>
              )}
            </div>
            <p className="probe-status" aria-live="polite">
              {qrStatus}
            </p>
            {qrExpiresAt ? (
              <p className="muted small">
                过期时间：{new Date(qrExpiresAt).toLocaleTimeString()}
              </p>
            ) : null}
            <div className="button-row">
              <button
                className="primary-button"
                disabled={loginBusy}
                onClick={() => void startQrLogin()}
                type="button">
                {loginBusy ? '生成中…' : '重新生成二维码'}
              </button>
              <button
                className="secondary-button"
                disabled={!auth.loggedIn}
                onClick={() => void logout()}
                type="button">
                退出登录
              </button>
            </div>
          </section>

          <section className="card checklist-card">
            <p className="eyebrow">SECURITY CHECK</p>
            <h2>阶段 0 安全边界</h2>
            <ul className="checklist">
              <li>Renderer 不接收完整 Cookie 或 refresh token。</li>
              <li>二维码轮询密钥不会通过普通 IPC 传入页面。</li>
              <li>登录 WebContentsView 只允许 HTTPS Bilibili 域名。</li>
              <li>凭证使用 Electron safeStorage 加密后写入 userData。</li>
              <li>音频请求日志只保留域名、路径、Range 和响应摘要。</li>
            </ul>
          </section>
        </section>
      ) : (
        <section className="panel-grid audio-grid">
          <section className="card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">AUDIO PROBE</p>
                <h2>远程音频与过期重取</h2>
              </div>
              <span className="badge">Range + Headers</span>
            </div>
            <label className="field-label" htmlFor="remote-url">
              当前音频 URL
            </label>
            <input
              id="remote-url"
              className="text-input"
              onChange={event => setRemoteUrl(event.target.value)}
              placeholder="粘贴 Bilibili CDN 音频 URL"
              spellCheck={false}
              value={remoteUrl}
            />
            <label className="field-label" htmlFor="retry-url">
              过期后的新 URL（可选）
            </label>
            <input
              id="retry-url"
              className="text-input"
              onChange={event => setRetryUrl(event.target.value)}
              placeholder="用于模拟 403/410 后重取"
              spellCheck={false}
              value={retryUrl}
            />
            <div className="button-row">
              <button
                className="primary-button"
                disabled={!remoteUrl.trim()}
                onClick={() => void inspectAudio()}
                type="button">
                探测并播放
              </button>
              <button
                className="secondary-button"
                onClick={() => void playOfflineSample()}
                type="button">
                播放离线样例
              </button>
            </div>
            <label className="file-button secondary-button">
              选择本地音频
              <input
                accept="audio/*"
                onChange={handleLocalFile}
                type="file"
              />
            </label>
            {localFileName ? <p className="muted small">{localFileName}</p> : null}
            {audioSrc ? (
              <audio
                className="audio-player"
                controls
                onError={() => void refreshRequestRecords()}
                onLoadedMetadata={() => void refreshRequestRecords()}
                preload="metadata"
                src={audioSrc}
              />
            ) : (
              <div className="audio-placeholder">选择 URL 或本地文件开始播放</div>
            )}
            {probeError ? <p className="error-text">{probeError}</p> : null}
          </section>

          <section className="card result-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">OBSERVATIONS</p>
                <h2>请求与响应记录</h2>
              </div>
              <button
                className="link-button"
                onClick={async () => {
                  await window.nyamiDesktop.probes.clearRecentAudioRequests();
                  setRequestRecords([]);
                }}
                type="button">
                清空
              </button>
            </div>
            {probeResult ? (
              <div className="result-summary">
                <span className={probeResult.ok ? 'result-ok' : 'result-fail'}>
                  {probeResult.ok ? '请求成功' : '请求失败'}
                </span>
                <span>{probeResult.rangeSupported ? '支持 Range' : '未确认 Range'}</span>
                {probeResult.retried ? <span>已执行重取</span> : null}
              </div>
            ) : (
              <p className="muted">探测结果将在这里显示。</p>
            )}
            <div className="request-list">
              {requestRecords.length ? (
                requestRecords.map(record => (
                  <div className="request-row" key={`${record.requestId}-${record.timestamp}`}>
                    <div>
                      <strong>{record.host}</strong>
                      <span>{record.pathname}</span>
                    </div>
                    <div className="request-meta">
                      <span>{record.status ?? '—'}</span>
                      <span>{record.range ?? '无 Range'}</span>
                      <span>{record.contentRange ?? '无 Content-Range'}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">播放远程音频后刷新这里的 Chromium 请求摘要。</div>
              )}
            </div>
          </section>
        </section>
      )}

      <footer className="footer-note">
        阶段 0 spike · Electron {window.navigator.userAgent.match(/Electron\/([^ ]+)/)?.[1] ?? 'dev'} ·
        目标 Windows 10/11 x64
      </footer>
    </main>
  );
}
