import {useCallback, useEffect, useRef, useState, memo} from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  ReactNode,
} from 'react';
import {Icon, type IconName} from './icons';
import type {
  AuthStatus,
  AuthWebViewState,
  CacheProgressEvent,
  CacheSummary,
  DesktopPage,
  DesktopSettings,
  DesktopTheme,
  DesktopUpdateInfo,
  DesktopVideo,
  DesktopWindowState,
  FavoriteFolderContentRequest,
  FavoriteFolderSummary,
  FavoriteSearchContentRequest,
  FavoriteVideoContentRequest,
  PlaybackAudioEvent,
  PlaybackQueueContext,
  PlaybackQueueItem,
  PlaybackQueueMode,
  PlaybackSnapshot,
  QrStatusEvent,
  SearchContentRequest,
  SyncSnapshot,
  UserProfile,
} from '../shared/types';
import {ElectronAudioPlayerAdapter} from './audio/electronAudioPlayer';
import {
  PrototypeImmersivePage,
  PrototypePage,
  type PrototypeRoute,
} from './PrototypePages';
import {
  loadDesktopUserPreferences,
  saveDesktopUserPreferences,
  type DesktopUserPreferences,
} from './preferences';

type Route = PrototypeRoute;
type NoticeTone = 'info' | 'success' | 'error';

type Notice = {
  id: number;
  tone: NoticeTone;
  message: string;
};

type AsyncState = 'idle' | 'loading' | 'success' | 'error';

const NAV_ITEMS: Array<{
  route: Route;
  label: string;
  icon: IconName;
}> = [
  {route: 'discover', label: '发现', icon: 'home'},
  {route: 'search', label: '搜索', icon: 'search'},
  {route: 'library', label: '音乐库', icon: 'folder'},
  {route: 'taste', label: '音乐偏好', icon: 'heart'},
  {route: 'sound-lab', label: '声音实验室', icon: 'sparkles'},
  {route: 'settings', label: '设置', icon: 'settings'},
];

const THEME_OPTIONS: Array<{
  value: DesktopTheme;
  label: string;
  description: string;
}> = [{value: 'light', label: '浅色', description: '适合明亮环境'}];

const EMPTY_PLAYBACK: PlaybackSnapshot = {
  state: 'idle',
  trackId: null,
  trackTitle: null,
  trackArtist: null,
  artwork: null,
  position: 0,
  duration: 0,
  volume: 1,
  queueLength: 0,
  queueIndex: -1,
  queue: [],
  mode: 'sequential',
  queueContext: null,
  sleepTimerSeconds: null,
  networkOnline: true,
  cached: false,
  error: null,
  diagnostic: null,
};

const EMPTY_SYNC: SyncSnapshot = {
  state: 'idle',
  taskId: null,
  completed: 0,
  total: 0,
  phase: 'idle',
  uid: null,
  processedVideos: 0,
  totalVideos: 0,
  skippedTasks: 0,
  failedTasks: 0,
  message: null,
  canRetry: false,
  startedAt: null,
  finishedAt: null,
  error: null,
};

const EMPTY_UPDATE: DesktopUpdateInfo = {
  status: 'idle',
  currentVersion: '',
  latestVersion: null,
  releaseDate: null,
  notes: null,
  downloadUrl: null,
  portableUrl: null,
  sha256: null,
  blockmapUrl: null,
  source: null,
  checkedAt: null,
  error: null,
};

/** 阶段 3 桌面端应用根组件，负责导航、认证状态和全局任务通知。 */
export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>('discover');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [auth, setAuth] = useState<AuthStatus>({
    loggedIn: false,
    uid: null,
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [qrImageDataUrl, setQrImageDataUrl] = useState('');
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [qrStatus, setQrStatus] = useState('准备登录');
  const [qrBusy, setQrBusy] = useState(false);
  const [webViewState, setWebViewState] = useState<AuthWebViewState>({
    open: false,
    mode: null,
  });
  const [notices, setNotices] = useState<Notice[]>([]);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [playback, setPlayback] = useState<PlaybackSnapshot>(EMPTY_PLAYBACK);
  const [sync, setSync] = useState<SyncSnapshot>(EMPTY_SYNC);
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo>(EMPTY_UPDATE);
  const [spectrum, setSpectrum] = useState<number[]>([]);
  const [cacheSummary, setCacheSummary] = useState<CacheSummary | null>(null);
  const [cacheProgress, setCacheProgress] = useState<CacheProgressEvent | null>(
    null,
  );
  const [cacheBusy, setCacheBusy] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioAdapterRef = useRef<ElectronAudioPlayerAdapter | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const noticeSequenceRef = useRef(0);
  const authRefreshSequenceRef = useRef(0);

  /** 追加全局任务通知，并保留最近的通知历史。 */
  const pushNotice = useCallback((tone: NoticeTone, message: string): void => {
    const id = ++noticeSequenceRef.current;
    setNotices(current => [...current, {id, tone, message}].slice(-12));
    window.setTimeout(() => {
      setNotices(current => current.filter(notice => notice.id !== id));
    }, 5000);
  }, []);

  /** 刷新脱敏登录状态和公开账号资料。 */
  const refreshAuth = useCallback(async (): Promise<void> => {
    const sequence = ++authRefreshSequenceRef.current;
    const status = await window.nyamiDesktop.auth.getStatus();
    if (sequence !== authRefreshSequenceRef.current) {
      return;
    }
    setAuth(status);
    if (!status.loggedIn) {
      setProfile(null);
      return;
    }
    if (status.profile) {
      setProfile(status.profile);
    }
    try {
      const nextProfile = await window.nyamiDesktop.auth.getProfile();
      if (sequence !== authRefreshSequenceRef.current) {
        return;
      }
      setProfile(nextProfile);
    } catch (error) {
      if (sequence !== authRefreshSequenceRef.current) {
        return;
      }
      setProfile(current =>
        current?.uid === status.uid ? current : status.profile ?? null,
      );
      pushNotice('error', getErrorMessage(error, '账号资料加载失败'));
    }
  }, [pushNotice]);

  /** 启动二维码登录并更新登录弹窗状态。 */
  const startQrLogin = useCallback(async (): Promise<void> => {
    setQrBusy(true);
    setQrStatus('正在生成二维码…');
    try {
      const result = await window.nyamiDesktop.auth.startQrLogin();
      setQrImageDataUrl(result.qrImageDataUrl);
      setQrExpiresAt(result.expiresAt);
      setQrStatus('请使用 Bilibili 客户端扫码');
    } catch (error) {
      setQrStatus(getErrorMessage(error, '二维码生成失败'));
      pushNotice('error', getErrorMessage(error, '二维码生成失败'));
    } finally {
      setQrBusy(false);
    }
  }, [pushNotice]);

  /** 打开网页登录视图。 */
  const openWebLogin = useCallback(async (): Promise<void> => {
    setLoginOpen(false);
    try {
      await window.nyamiDesktop.auth.openWebLogin();
      pushNotice('info', '网页登录已打开，请在页面内完成登录');
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '网页登录打开失败'));
    }
  }, [pushNotice]);

  /** 关闭网页登录视图并返回登录方式选择弹窗。 */
  const closeWebLoginAndReturn = useCallback(async (): Promise<void> => {
    const mode = webViewState.mode;
    try {
      await window.nyamiDesktop.auth.closeWebLogin();
      if (mode === 'login') {
        setQrImageDataUrl('');
        setQrExpiresAt(null);
        setQrStatus('准备登录');
        setLoginOpen(true);
      }
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '关闭网页登录失败'));
    }
  }, [pushNotice, webViewState.mode]);

  /** 请求 Bilibili Cookie 续期。 */
  const renewLogin = useCallback(async (): Promise<void> => {
    setLoginOpen(false);
    try {
      await window.nyamiDesktop.auth.renew();
      await refreshAuth();
      pushNotice('success', '登录状态已续期');
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '登录续期失败'));
    }
  }, [pushNotice, refreshAuth]);

  /** 退出登录并清理当前账号在 Renderer 中的展示状态。 */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await window.nyamiDesktop.auth.logout();
      authRefreshSequenceRef.current += 1;
      setAuth({loggedIn: false, uid: null});
      setProfile(null);
      setLoginOpen(false);
      setQrImageDataUrl('');
      pushNotice('success', '已退出登录');
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '退出登录失败'));
    }
  }, [pushNotice]);

  /** 聚焦全局搜索并切换到搜索页。 */
  const focusSearch = useCallback((): void => {
    setRoute('search');
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  /** 提交全局搜索条件。 */
  const submitSearch = useCallback((value: string): void => {
    const normalized = value.trim();
    setSearchQuery(normalized);
    setRoute('search');
  }, []);

  /** 记录最近播放的视频，供首页继续聆听区恢复真实播放轨迹。 */
  const rememberRecentVideo = useCallback((video: DesktopVideo): void => {
    try {
      const raw = window.localStorage.getItem('nyami-recent-played');
      const previous = raw ? (JSON.parse(raw) as DesktopVideo[]) : [];
      const next = [
        video,
        ...previous.filter(item => item.bvid !== video.bvid),
      ].slice(0, 30);
      window.localStorage.setItem('nyami-recent-played', JSON.stringify(next));
    } catch {
      // 本地存储不可用时不影响播放流程。
    }
  }, []);

  /** 执行播放器的播放/暂停控制。 */
  const togglePlayback = useCallback(async (): Promise<void> => {
    if (!playback.trackId) {
      pushNotice('info', '请先从内容卡片选择一首歌曲');
      return;
    }
    try {
      const next =
        playback.state === 'playing'
          ? await window.nyamiDesktop.playback.pause()
          : await window.nyamiDesktop.playback.play();
      setPlayback(next);
      if (next.error) {
        pushNotice('error', next.error);
      }
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '播放失败'));
    }
  }, [playback.state, playback.trackId, pushNotice]);

  /** 从内容卡片创建队列项目并立即播放。 */
  const playVideo = useCallback(
    (video: DesktopVideo): void => {
      rememberRecentVideo(video);
      void window.nyamiDesktop.playback
        .loadQueue({
          items: [toPlaybackQueueItem(video)],
          startIndex: 0,
          autoplay: true,
          expandParts: true,
          context: getPopularQueueContext(video),
        })
        .then(snapshot => {
          setPlayback(snapshot);
          if (snapshot.error) {
            pushNotice('error', snapshot.error);
          }
        })
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '音频加载失败'));
        });
    },
    [pushNotice, rememberRecentVideo],
  );

  /** 将多个真实视频一次性载入播放器，支持收藏夹全局随机播放。 */
  const playVideos = useCallback(
    (videos: DesktopVideo[], shuffle: boolean): void => {
      const items = videos.map(toPlaybackQueueItem);
      if (!items.length) {
        pushNotice('info', '当前收藏夹没有可播放内容');
        return;
      }
      const queue = shuffle ? shuffleQueueItems(items) : items;
      void window.nyamiDesktop.playback
        .loadQueue({
          items: queue,
          startIndex: 0,
          autoplay: true,
          expandParts: false,
          context: null,
        })
        .then(snapshot => {
          setPlayback(snapshot);
          if (snapshot.error) {
            pushNotice('error', snapshot.error);
          }
        })
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '收藏夹播放失败'));
        });
    },
    [pushNotice],
  );

  /** 将内容卡片追加到当前播放队列。 */
  const addVideoToQueue = useCallback(
    (video: DesktopVideo): void => {
      void window.nyamiDesktop.playback
        .addToQueue({
          item: toPlaybackQueueItem(video),
          autoplay: false,
          context: getPopularQueueContext(video),
        })
        .then(snapshot => {
          setPlayback(snapshot);
          pushNotice('success', '已加入播放队列');
        })
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '加入播放队列失败'));
        });
    },
    [pushNotice],
  );

  /** 调整播放进度并同步主进程状态。 */
  const seekPlayback = useCallback(
    (position: number): void => {
      void window.nyamiDesktop.playback
        .seek({position})
        .then(setPlayback)
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '调整播放进度失败'));
        });
    },
    [pushNotice],
  );

  /** 调整播放器音量。 */
  const setPlaybackVolume = useCallback(
    (volume: number): void => {
      void window.nyamiDesktop.playback
        .setVolume({volume})
        .then(setPlayback)
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '调整音量失败'));
        });
    },
    [pushNotice],
  );

  /** 切换播放顺序模式。 */
  const setPlaybackMode = useCallback(
    (mode: PlaybackQueueMode): void => {
      void window.nyamiDesktop.playback
        .setMode({mode})
        .then(setPlayback)
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '切换播放模式失败'));
        });
    },
    [pushNotice],
  );

  /** 设置或取消睡眠定时器。 */
  const setPlaybackSleepTimer = useCallback(
    (seconds: number | null): void => {
      void window.nyamiDesktop.playback
        .setSleepTimer({seconds})
        .then(setPlayback)
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '设置睡眠定时器失败'));
        });
    },
    [pushNotice],
  );

  /** 从播放队列移除一个项目。 */
  const removePlaybackItem = useCallback(
    (trackId: string): void => {
      void window.nyamiDesktop.playback
        .removeFromQueue({trackId})
        .then(setPlayback)
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '移除队列项目失败'));
        });
    },
    [pushNotice],
  );

  /** 按拖拽结果保存播放队列顺序。 */
  const reorderPlaybackQueue = useCallback(
    (trackIds: string[]): void => {
      void window.nyamiDesktop.playback
        .reorderQueue({trackIds})
        .then(setPlayback)
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '调整播放队列失败'));
        });
    },
    [pushNotice],
  );

  /** 从队列面板选择指定歌曲并保持其余项目顺序。 */
  const playQueueTrack = useCallback(
    (trackId: string): void => {
      const startIndex = playback.queue.findIndex(item => item.id === trackId);
      if (startIndex < 0) {
        return;
      }
      void window.nyamiDesktop.playback
        .loadQueue({
          items: playback.queue,
          startIndex,
          autoplay: true,
          expandParts: false,
          context: playback.queueContext,
        })
        .then(snapshot => {
          setPlayback(snapshot);
          if (snapshot.error) {
            pushNotice('error', snapshot.error);
          }
        })
        .catch(error => {
          pushNotice('error', getErrorMessage(error, '切换队列项目失败'));
        });
    },
    [playback.queue, playback.queueContext, pushNotice],
  );

  /** 读取音频和图片缓存摘要，供设置页展示容量。 */
  const refreshCacheSummary = useCallback(async (): Promise<void> => {
    try {
      setCacheSummary(await window.nyamiDesktop.cache.getSummary());
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '缓存摘要读取失败'));
    }
  }, [pushNotice]);

  /** 清理缓存并刷新容量摘要。 */
  const clearCache = useCallback(async (): Promise<void> => {
    setCacheBusy(true);
    try {
      setCacheSummary(await window.nyamiDesktop.cache.clear());
      pushNotice('success', '音频和图片缓存已清理');
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '缓存清理失败'));
    } finally {
      setCacheBusy(false);
      setCacheProgress(null);
    }
  }, [pushNotice]);

  /** 打开系统保存对话框导出脱敏日志。 */
  const exportLogs = useCallback(async (): Promise<void> => {
    try {
      const result = await window.nyamiDesktop.logs.export();
      if (!result.cancelled && result.path) {
        pushNotice('success', `日志已导出（${formatBytes(result.bytes)}）`);
      }
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '日志导出失败'));
    }
  }, [pushNotice]);

  /** 手动检查发布清单，并把结果转换成设置页提示。 */
  const checkForUpdates = useCallback(async (): Promise<void> => {
    try {
      const result = await window.nyamiDesktop.updates.check();
      setUpdateInfo(result);
      if (result.status === 'available' && result.latestVersion) {
        pushNotice('success', `发现新版本 v${result.latestVersion}`);
        return;
      }
      if (result.status === 'disabled') {
        pushNotice('info', '尚未配置更新源');
        return;
      }
      if (result.status === 'up-to-date') {
        pushNotice('success', '当前已是最新版本');
        return;
      }
      if (result.error) {
        pushNotice('error', result.error);
      }
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '检查更新失败'));
    }
  }, [pushNotice]);

  /** 打开已校验的安装包地址，由用户手动下载和确认升级。 */
  const openUpdateDownload = useCallback(async (): Promise<void> => {
    try {
      const opened = await window.nyamiDesktop.updates.openDownload();
      if (!opened) {
        pushNotice('info', '请先检查更新');
      }
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '打开更新地址失败'));
    }
  }, [pushNotice]);

  /** 注册全局快捷键，支持 Ctrl+K、Space 和 Ctrl+方向键。 */
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (isTyping) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      if (event.ctrlKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        void window.nyamiDesktop.playback.skipPrevious().then(setPlayback);
      }
      if (event.ctrlKey && event.key === 'ArrowRight') {
        event.preventDefault();
        void window.nyamiDesktop.playback.skipNext().then(setPlayback);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusSearch, togglePlayback]);

  /** 创建隐藏音频元素，接收主进程来源、命令和网络状态事件。 */
  useEffect(() => {
    const element = audioElementRef.current;
    if (!element) {
      return;
    }
    const adapter = new ElectronAudioPlayerAdapter(element, event => {
      void window.nyamiDesktop.playback
        .reportAudioEvent(event)
        .then(setPlayback)
        .catch(() => undefined);
    });
    audioAdapterRef.current = adapter;
    void adapter.setup();
    const unsubscribeSpectrum = adapter.subscribeSpectrum(setSpectrum);
    const unsubscribeSource = window.nyamiDesktop.playback.onSourceChanged(
      event => adapter.loadSource(event.source),
    );
    const unsubscribeCommand = window.nyamiDesktop.playback.onCommand(event => {
      void adapter.handleCommand(event.command).catch(error => {
        const audioEvent: PlaybackAudioEvent = {
          type: 'error',
          trackId: event.command.trackId,
          message: getErrorMessage(error, '音频播放命令失败'),
        };
        void window.nyamiDesktop.playback.reportAudioEvent(audioEvent);
      });
    });
    const reportNetwork = (type: 'network-online' | 'network-offline') => {
      const event: PlaybackAudioEvent = {type};
      void window.nyamiDesktop.playback
        .reportAudioEvent(event)
        .then(setPlayback)
        .catch(() => undefined);
    };
    const handleOnline = () => reportNetwork('network-online');
    const handleOffline = () => reportNetwork('network-offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    reportNetwork(navigator.onLine ? 'network-online' : 'network-offline');
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeSource();
      unsubscribeCommand();
      unsubscribeSpectrum();
      adapter.dispose();
      audioAdapterRef.current = null;
    };
  }, []);

  /** 设置变化后把完整音频参数快照发送到 AudioWorklet。 */
  useEffect(() => {
    if (settings?.audio) {
      audioAdapterRef.current?.setAudioSettings(settings.audio);
    }
  }, [settings?.audio]);

  /** 初始化认证、设置、播放状态和跨进程事件订阅。 */
  useEffect(() => {
    const unsubscribeQr = window.nyamiDesktop.auth.onQrStatus(
      (event: QrStatusEvent) => {
        setQrStatus(event.message);
        if (event.expiresAt) {
          setQrExpiresAt(event.expiresAt);
        }
        if (event.auth) {
          setAuth(event.auth);
          if (event.auth.profile !== undefined) {
            setProfile(event.auth.profile ?? null);
          }
        }
        if (event.status === 'success') {
          setQrBusy(false);
          setLoginOpen(false);
          void refreshAuth();
          pushNotice('success', event.message);
        }
        if (event.status === 'error' || event.status === 'expired') {
          pushNotice('error', event.message);
        }
      },
    );
    const unsubscribeWebView = window.nyamiDesktop.auth.onWebViewState(
      (event: AuthWebViewState) => {
        setWebViewState(event);
      },
    );
    const unsubscribeSettings =
      window.nyamiDesktop.settings.onChanged(setSettings);
    const unsubscribePlayback = window.nyamiDesktop.playback.onStateChanged(
      event => setPlayback(event.snapshot),
    );
    const unsubscribeSync = window.nyamiDesktop.sync.onStateChanged(event =>
      setSync(event.snapshot),
    );
    const unsubscribeCache = window.nyamiDesktop.cache.onProgress(
      (event: CacheProgressEvent) => setCacheProgress(event),
    );
    void Promise.all([
      refreshAuth(),
      window.nyamiDesktop.settings.get().then(setSettings),
      window.nyamiDesktop.playback.getState().then(setPlayback),
      window.nyamiDesktop.sync.getStatus().then(setSync),
      window.nyamiDesktop.cache.getSummary().then(setCacheSummary),
      window.nyamiDesktop.updates.getStatus().then(setUpdateInfo),
    ]).catch(error => {
      pushNotice('error', getErrorMessage(error, '桌面运行时初始化失败'));
    });
    return () => {
      unsubscribeQr();
      unsubscribeWebView();
      unsubscribeSettings();
      unsubscribePlayback();
      unsubscribeSync();
      unsubscribeCache();
    };
  }, [pushNotice, refreshAuth]);

  /** 初始化自绘窗口边框状态，并订阅主进程的最大化变化。 */
  useEffect(() => {
    const handleWindowState = (state: DesktopWindowState): void => {
      setIsWindowMaximized(state.isMaximized);
    };
    const unsubscribe =
      window.nyamiDesktop.window.onStateChanged(handleWindowState);
    void window.nyamiDesktop.window
      .getState()
      .then(handleWindowState)
      .catch(() => undefined);
    return unsubscribe;
  }, []);

  /** 仅在设置开启且账号已有本地索引时自动执行增量同步。 */
  const autoSyncUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!auth.loggedIn || !auth.uid || !settings?.autoSyncIndex) {
      autoSyncUidRef.current = null;
      return;
    }
    if (autoSyncUidRef.current === auth.uid) {
      return;
    }
    autoSyncUidRef.current = auth.uid;
    void window.nyamiDesktop.sync
      .start({force: false, automatic: true})
      .then(setSync)
      .catch(error => {
        pushNotice('error', getErrorMessage(error, '收藏同步启动失败'));
      });
  }, [auth.loggedIn, auth.uid, pushNotice, settings?.autoSyncIndex]);

  /** 登录弹窗打开后自动生成首张二维码。 */
  useEffect(() => {
    if (loginOpen && !auth.loggedIn && !qrImageDataUrl && !qrBusy) {
      void startQrLogin();
    }
  }, [auth.loggedIn, loginOpen, qrBusy, qrImageDataUrl, startQrLogin]);

  /** 根据用户设置将页面映射为桌面主题类名。 */
  const themeClassName = 'theme-light';

  /** 修改桌面设置，并在失败时恢复可见提示。 */
  const updateSettings = useCallback(
    async (
      patch: Parameters<typeof window.nyamiDesktop.settings.update>[0],
    ) => {
      try {
        setSettings(await window.nyamiDesktop.settings.update(patch));
      } catch (error) {
        pushNotice('error', getErrorMessage(error, '设置保存失败'));
      }
    },
    [pushNotice],
  );

  /** 请求主进程最小化当前窗口。 */
  const minimizeWindow = useCallback((): void => {
    void window.nyamiDesktop.window.minimize();
  }, []);

  /** 切换当前窗口的最大化状态，并同步自绘边框状态。 */
  const toggleWindowMaximize = useCallback(async (): Promise<void> => {
    try {
      const state = await window.nyamiDesktop.window.toggleMaximize();
      setIsWindowMaximized(state.isMaximized);
    } catch (error) {
      pushNotice('error', getErrorMessage(error, '窗口状态切换失败'));
    }
  }, [pushNotice]);

  /** 请求主进程关闭当前窗口，关闭到托盘策略仍由主进程统一处理。 */
  const closeWindow = useCallback((): void => {
    void window.nyamiDesktop.window.close();
  }, []);

  const activeProfile = getActiveProfile(auth, profile);
  const isImmersiveRoute =
    route === 'immersive-windowed' || route === 'immersive-fullscreen';
  const prototypePageProps = {
    auth,
    onAddVideo: addVideoToQueue,
    onNext: () => {
      void window.nyamiDesktop.playback.skipNext().then(setPlayback);
    },
    onNotice: pushNotice,
    onOpenLogin: () => setLoginOpen(true),
    onPause: () => {
      void window.nyamiDesktop.playback.pause().then(setPlayback);
    },
    onPlay: () => {
      void togglePlayback();
    },
    onPlayVideo: playVideo,
    onPlayVideos: playVideos,
    onPrevious: () => {
      void window.nyamiDesktop.playback.skipPrevious().then(setPlayback);
    },
    onRemoveTrack: removePlaybackItem,
    onRouteChange: setRoute,
    onSelectFolder: (folderId: number) => {
      setSelectedFolderId(folderId);
    },
    onSeek: seekPlayback,
    onSleepTimer: setPlaybackSleepTimer,
    onSelectTrack: playQueueTrack,
    onUpdateSettings: updateSettings,
    onVolume: setPlaybackVolume,
    playback,
    profile: activeProfile,
    settings,
    searchQuery,
    spectrum,
    route,
    selectedFolderId,
  } satisfies Parameters<typeof PrototypePage>[0];

  return (
    <div
      className={`desktop-app prototype-app ${themeClassName} ${
        isWindowMaximized ? 'window-maximized' : 'window-restored'
      }`}>
      {isImmersiveRoute ? (
        <PrototypeImmersivePage {...prototypePageProps} />
      ) : (
        <>
          <WindowTitlebar
            isMaximized={isWindowMaximized}
            onClose={closeWindow}
            onMinimize={minimizeWindow}
            onToggleMaximize={() => void toggleWindowMaximize()}
          />
          <div className="desktop-frame">
            <Sidebar
              auth={auth}
              profile={activeProfile}
              route={route}
              onLogin={() => setLoginOpen(true)}
              onRouteChange={setRoute}
            />
            <section className="workspace">
              <header
                className={
                  route === 'search'
                    ? 'workspace-header search-route'
                    : 'workspace-header'
                }>
                <div className="breadcrumb-block">
                  <p className="section-kicker">
                    {getRouteHeader(route).eyebrow}
                  </p>
                  <h1>{getRouteHeader(route).title}</h1>
                </div>
                <form
                  className={
                    route === 'search'
                      ? 'global-search is-hidden'
                      : 'global-search'
                  }
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    submitSearch(searchQuery);
                  }}>
                  <Icon name="search" size={18} />
                  <input
                    aria-label="搜索 Bilibili 视频"
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="搜索视频、音乐或 UP 主"
                    ref={searchInputRef}
                    value={searchQuery}
                  />
                  <kbd>Ctrl K</kbd>
                </form>
                <div className="header-actions">
                  {webViewState.open ? (
                    <button
                      className="webview-close-button"
                      onClick={() => void closeWebLoginAndReturn()}
                      type="button">
                      <Icon name="x" size={16} />
                      {webViewState.mode === 'login'
                        ? '返回登录方式'
                        : '关闭网页登录'}
                    </button>
                  ) : null}
                  <div className="task-center-wrap">
                    <button
                      aria-expanded={taskCenterOpen}
                      aria-label="打开任务通知"
                      className="icon-button notification-button"
                      onClick={() => setTaskCenterOpen(current => !current)}
                      title="任务通知"
                      type="button">
                      <Icon name="bell" size={18} />
                      {notices.length ? (
                        <span className="notification-count">
                          {notices.length}
                        </span>
                      ) : null}
                    </button>
                    {taskCenterOpen ? (
                      <TaskCenter
                        notices={notices}
                        onCancelSync={() => {
                          void window.nyamiDesktop.sync.cancel().then(setSync);
                        }}
                        onDismiss={id =>
                          setNotices(current =>
                            current.filter(notice => notice.id !== id),
                          )
                        }
                        onStartSync={(force = false) => {
                          void window.nyamiDesktop.sync
                            .start({force})
                            .then(setSync)
                            .catch(error => {
                              pushNotice(
                                'error',
                                getErrorMessage(error, '同步启动失败'),
                              );
                            });
                        }}
                        sync={sync}
                      />
                    ) : null}
                  </div>
                </div>
              </header>

              {webViewState.open ? (
                <div className="webview-banner" role="status">
                  <span className="status-dot online" />
                  {webViewState.mode === 'refresh'
                    ? '正在安全续期 Bilibili 登录状态…'
                    : 'Bilibili 网页已打开，请在上方页面完成登录'}
                </div>
              ) : null}

              <main className="page-scroll">
                {route === 'settings' ? (
                  <SettingsPage
                    auth={auth}
                    cacheBusy={cacheBusy}
                    cacheProgress={cacheProgress}
                    cacheSummary={cacheSummary}
                    onClearCache={() => void clearCache()}
                    onExportLogs={() => void exportLogs()}
                    onLogin={() => setLoginOpen(true)}
                    onLogout={() => void logout()}
                    onRenew={() => void renewLogin()}
                    onRefreshCache={() => void refreshCacheSummary()}
                    onCheckForUpdates={() => void checkForUpdates()}
                    onUpdate={updateSettings}
                    onOpenUpdateDownload={() => void openUpdateDownload()}
                    profile={activeProfile}
                    settings={settings}
                    updateInfo={updateInfo}
                  />
                ) : (
                  <PrototypePage {...prototypePageProps} />
                )}
              </main>

              <PlayerPlaceholder
                playback={playback}
                spectrum={spectrum}
                onModeChange={setPlaybackMode}
                onNext={() =>
                  void window.nyamiDesktop.playback.skipNext().then(setPlayback)
                }
                onPause={() =>
                  void window.nyamiDesktop.playback.pause().then(setPlayback)
                }
                onPlay={() => void togglePlayback()}
                onPrevious={() =>
                  void window.nyamiDesktop.playback
                    .skipPrevious()
                    .then(setPlayback)
                }
                onRemove={removePlaybackItem}
                onReorder={reorderPlaybackQueue}
                onSeek={seekPlayback}
                onSelectTrack={playQueueTrack}
                onOpenPlayback={() => setRoute('immersive-windowed')}
                onVolume={setPlaybackVolume}
              />
            </section>
          </div>
        </>
      )}

      <audio
        aria-hidden="true"
        className="desktop-audio-element"
        ref={audioElementRef}
      />

      <NoticeStack notices={notices.slice(-3)} />

      {loginOpen ? (
        <LoginDialog
          auth={auth}
          busy={qrBusy}
          expiresAt={qrExpiresAt}
          imageDataUrl={qrImageDataUrl}
          onClose={() => setLoginOpen(false)}
          onLogout={() => void logout()}
          onRenew={() => void renewLogin()}
          onStartQr={() => void startQrLogin()}
          onWebLogin={() => void openWebLogin()}
          profile={activeProfile}
          status={qrStatus}
        />
      ) : null}
    </div>
  );
}

/** 自绘桌面窗口标题栏，承载拖拽区域和 Windows 窗口控制按钮。 */
function WindowTitlebar({
  isMaximized,
  onClose,
  onMinimize,
  onToggleMaximize,
}: {
  isMaximized: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
}): JSX.Element {
  return (
    <header
      className="window-titlebar"
      onDoubleClick={event => {
        if ((event.target as HTMLElement).closest('button')) {
          return;
        }
        onToggleMaximize();
      }}>
      <div className="window-titlebar-caption">
        <span className="window-titlebar-mark">N</span>
        <strong>Nyami</strong>
        <span>桌面播放器</span>
      </div>
      <div className="window-titlebar-controls">
        <button
          aria-label="最小化窗口"
          className="window-control"
          onClick={onMinimize}
          title="最小化"
          type="button">
          <Icon name="minus" size={16} />
        </button>
        <button
          aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
          aria-pressed={isMaximized}
          className="window-control"
          onClick={onToggleMaximize}
          title={isMaximized ? '还原' : '最大化'}
          type="button">
          <Icon name={isMaximized ? 'restore' : 'maximize'} size={15} />
        </button>
        <button
          aria-label="关闭窗口"
          className="window-control window-control-close"
          onClick={onClose}
          title="关闭"
          type="button">
          <Icon name="x" size={16} />
        </button>
      </div>
    </header>
  );
}

/** 渲染桌面端侧边栏导航和账号入口。 */
function Sidebar({
  auth,
  profile,
  route,
  onLogin,
  onRouteChange,
}: {
  auth: AuthStatus;
  profile: UserProfile | null;
  route: Route;
  onLogin: () => void;
  onRouteChange: (route: Route) => void;
}): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">NYAMI</div>
        <span>art book / record archive</span>
      </div>
      <nav aria-label="主导航" className="primary-nav">
        <p className="nav-label">LIBRARY</p>
        <div className="nav-list">
          {NAV_ITEMS.map(item => (
            <button
              aria-current={route === item.route ? 'page' : undefined}
              className={route === item.route ? 'nav-item active' : 'nav-item'}
              key={item.route}
              onClick={() => onRouteChange(item.route)}
              type="button">
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.route === 'library' && auth.loggedIn ? (
                <span className="nav-hint">账号</span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>
      <div className="sidebar-bottom">
        {auth.loggedIn ? (
          <button className="sidebar-account" onClick={onLogin} type="button">
            <Avatar profile={profile} />
            <span className="sidebar-account-copy">
              <strong>{profile?.name ?? 'Bilibili 账号'}</strong>
              <small>
                {profile?.uid ?? auth.uid
                  ? `UID ${profile?.uid ?? auth.uid}`
                  : '已登录'}
              </small>
            </span>
          </button>
        ) : (
          <button className="sidebar-login" onClick={onLogin} type="button">
            <Icon name="log-in" size={17} />
            <span>登录 Bilibili</span>
          </button>
        )}
        <p className="sidebar-footnote">阶段 5 · 收藏索引</p>
      </div>
    </aside>
  );
}

/** 搜索页支持分页、取消请求、重试和公开结果浏览。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SearchPage({
  initialTrigger,
  inputRef,
  onAddVideo,
  onNotice,
  onPlayVideo,
  onSearch,
  query,
  setQuery,
}: {
  initialTrigger: number;
  inputRef: React.RefObject<HTMLInputElement>;
  onAddVideo: (video: DesktopVideo) => void;
  onNotice: (tone: NoticeTone, message: string) => void;
  onPlayVideo: (video: DesktopVideo) => void;
  onSearch: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
}): JSX.Element {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<AsyncState>('idle');
  const [result, setResult] = useState<DesktopPage<DesktopVideo> | null>(null);
  const [error, setError] = useState('');
  const requestIdRef = useRef<string | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  /** 取消上一笔搜索请求，避免旧结果覆盖当前关键词。 */
  const cancelActiveRequest = useCallback((): void => {
    const requestId = requestIdRef.current;
    if (requestId) {
      void window.nyamiDesktop.content.cancel({requestId});
      requestIdRef.current = null;
    }
  }, []);

  /** 请求搜索分页，并将取消视为正常的交互结果。 */
  const load = useCallback(
    async (targetPage: number): Promise<void> => {
      const normalized = queryRef.current.trim();
      if (!normalized) {
        setState('idle');
        setResult(null);
        return;
      }
      cancelActiveRequest();
      const requestId = makeRequestId('search');
      requestIdRef.current = requestId;
      setState('loading');
      setError('');
      const request: SearchContentRequest = {
        requestId,
        keyword: normalized,
        page: targetPage,
      };
      try {
        const next = await window.nyamiDesktop.content.search(request);
        if (requestIdRef.current !== requestId) {
          return;
        }
        setResult(next);
        setPage(targetPage);
        setState('success');
      } catch (requestError) {
        if (requestIdRef.current !== requestId || isAbortError(requestError)) {
          return;
        }
        const message = getErrorMessage(requestError, '搜索失败');
        setError(message);
        setState('error');
        onNotice('error', message);
      } finally {
        if (requestIdRef.current === requestId) {
          requestIdRef.current = null;
        }
      }
    },
    [cancelActiveRequest, onNotice],
  );

  useEffect(() => {
    if (initialTrigger > 0) {
      void load(1);
    }
  }, [initialTrigger, load]);

  useEffect(
    () => () => {
      cancelActiveRequest();
    },
    [cancelActiveRequest],
  );

  /** 处理搜索表单提交。 */
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSearch(query);
  };

  /** 处理 Escape，给用户一个明确的取消入口。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape' && state === 'loading') {
      event.preventDefault();
      cancelActiveRequest();
      setState('idle');
    }
  };

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="SEARCH"
        title="搜索 Bilibili 内容"
        description="搜索请求在主进程执行，输入框始终保持可用；按 Esc 或点击取消即可中止当前请求。"
      />
      <form className="search-panel" onSubmit={handleSubmit}>
        <Icon name="search" size={19} />
        <input
          aria-label="搜索关键词"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setQuery(event.target.value)
          }
          onKeyDown={handleKeyDown}
          placeholder="例如：周杰伦、钢琴、日语歌"
          ref={inputRef}
          value={query}
        />
        {state === 'loading' ? (
          <button
            className="subtle-button"
            onClick={event => {
              event.preventDefault();
              cancelActiveRequest();
              setState('idle');
            }}
            type="button">
            取消
          </button>
        ) : (
          <button className="primary-button compact" type="submit">
            搜索
          </button>
        )}
      </form>
      {state === 'idle' && !result ? (
        <EmptyState
          icon="search"
          message="输入关键词开始搜索公开视频"
          secondary="未登录也可以浏览搜索结果"
        />
      ) : null}
      {state === 'loading' ? <LoadingState label="正在搜索 Bilibili" /> : null}
      {state === 'error' ? (
        <ErrorState message={error} onRetry={() => void load(page)} />
      ) : null}
      {state === 'success' && result?.items.length === 0 ? (
        <EmptyState icon="search" message={`没有找到“${query}”的结果`} />
      ) : null}
      {state === 'success' && result?.items.length ? (
        <>
          <div className="result-meta-row">
            <span>“{query}”的搜索结果</span>
            {result.total !== null ? (
              <small>约 {result.total.toLocaleString()} 条</small>
            ) : null}
          </div>
          <VideoGrid
            items={result.items}
            onAddVideo={onAddVideo}
            onPlayVideo={onPlayVideo}
          />
          <Pagination
            hasMore={result.hasMore}
            loading={false}
            onNext={() => void load(page + 1)}
            onPrevious={() => void load(page - 1)}
            page={page}
          />
        </>
      ) : null}
    </div>
  );
}

/** 收藏页展示当前账号的收藏夹目录和视频分页。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function FavoritesPage({
  auth,
  onAddVideo,
  onLogin,
  onNotice,
  onPlayVideo,
  profile,
}: {
  auth: AuthStatus;
  onAddVideo: (video: DesktopVideo) => void;
  onLogin: () => void;
  onNotice: (tone: NoticeTone, message: string) => void;
  onPlayVideo: (video: DesktopVideo) => void;
  profile: UserProfile | null;
}): JSX.Element {
  const [folderState, setFolderState] = useState<AsyncState>('idle');
  const [folders, setFolders] = useState<FavoriteFolderSummary[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [videoState, setVideoState] = useState<AsyncState>('idle');
  const [videos, setVideos] = useState<DesktopPage<DesktopVideo> | null>(null);
  const [videoPage, setVideoPage] = useState(1);
  const [favoriteSearchQuery, setFavoriteSearchQuery] = useState('');
  const [favoriteSearchState, setFavoriteSearchState] =
    useState<AsyncState>('idle');
  const [favoriteSearchResult, setFavoriteSearchResult] =
    useState<DesktopPage<DesktopVideo> | null>(null);
  const [favoriteSearchPage, setFavoriteSearchPage] = useState(1);
  const [error, setError] = useState('');
  const folderRequestRef = useRef(makeRequestId('favorite-folders'));
  const videoRequestRef = useRef(makeRequestId('favorite-videos'));
  const favoriteSearchRequestRef = useRef(makeRequestId('favorite-search'));

  /** 加载当前账号收藏夹目录。 */
  const loadFolders = useCallback(async (): Promise<void> => {
    if (!auth.loggedIn || !auth.uid) {
      setFolders([]);
      setSelectedFolderId(null);
      setFolderState('idle');
      return;
    }
    const requestId = makeRequestId('favorite-folders');
    folderRequestRef.current = requestId;
    setFolderState('loading');
    setError('');
    const request: FavoriteFolderContentRequest = {
      requestId,
      uid: auth.uid,
    };
    try {
      const next = await window.nyamiDesktop.content.getFavoriteFolders(
        request,
      );
      setFolders(next);
      setSelectedFolderId(current => current ?? next[0]?.id ?? null);
      setFolderState('success');
    } catch (requestError) {
      if (isAbortError(requestError)) {
        return;
      }
      const message = getErrorMessage(requestError, '收藏夹目录加载失败');
      setError(message);
      setFolderState('error');
      onNotice('error', message);
    }
  }, [auth.loggedIn, auth.uid, onNotice]);

  /** 加载选中收藏夹的视频分页。 */
  const loadVideos = useCallback(
    async (folderId: number, targetPage: number): Promise<void> => {
      if (!auth.loggedIn || !auth.uid) {
        return;
      }
      const requestId = makeRequestId('favorite-videos');
      videoRequestRef.current = requestId;
      setVideoState('loading');
      setError('');
      const request: FavoriteVideoContentRequest = {
        requestId,
        uid: auth.uid,
        mediaId: folderId,
        page: targetPage,
      };
      try {
        const next = await window.nyamiDesktop.content.getFavoriteVideos(
          request,
        );
        setVideos(next);
        setVideoPage(targetPage);
        setVideoState('success');
      } catch (requestError) {
        if (isAbortError(requestError)) {
          return;
        }
        const message = getErrorMessage(requestError, '收藏视频加载失败');
        setError(message);
        setVideoState('error');
        onNotice('error', message);
      }
    },
    [auth.loggedIn, auth.uid, onNotice],
  );

  /** 搜索已经同步到本地的收藏视频。 */
  const loadFavoriteSearch = useCallback(
    async (targetPage: number): Promise<void> => {
      if (!auth.loggedIn || !auth.uid || !favoriteSearchQuery.trim()) {
        return;
      }
      const requestId = makeRequestId('favorite-search');
      favoriteSearchRequestRef.current = requestId;
      setFavoriteSearchState('loading');
      setError('');
      const request: FavoriteSearchContentRequest = {
        requestId,
        uid: auth.uid,
        keyword: favoriteSearchQuery.trim(),
        page: targetPage,
      };
      try {
        const next = await window.nyamiDesktop.content.searchFavorites(request);
        setFavoriteSearchResult(next);
        setFavoriteSearchPage(targetPage);
        setFavoriteSearchState('success');
      } catch (requestError) {
        if (isAbortError(requestError)) {
          return;
        }
        const message = getErrorMessage(requestError, '本地收藏搜索失败');
        setError(message);
        setFavoriteSearchState('error');
        onNotice('error', message);
      }
    },
    [auth.loggedIn, auth.uid, favoriteSearchQuery, onNotice],
  );

  /** 提交本地收藏搜索，并切换到搜索结果视图。 */
  const submitFavoriteSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!favoriteSearchQuery.trim()) {
      setFavoriteSearchResult(null);
      setFavoriteSearchState('idle');
      return;
    }
    setSelectedFolderId(null);
    void loadFavoriteSearch(1);
  };

  /** 清除本地收藏搜索并恢复收藏夹浏览。 */
  const clearFavoriteSearch = (): void => {
    setFavoriteSearchQuery('');
    setFavoriteSearchResult(null);
    setFavoriteSearchState('idle');
    setFavoriteSearchPage(1);
  };

  /** 切换账号时清除旧账号的本地搜索结果，避免跨账号短暂展示。 */
  useEffect(() => {
    clearFavoriteSearch();
  }, [auth.uid]);

  useEffect(() => {
    void loadFolders();
    return () => {
      void window.nyamiDesktop.content.cancel({
        requestId: folderRequestRef.current,
      });
      void window.nyamiDesktop.content.cancel({
        requestId: videoRequestRef.current,
      });
      void window.nyamiDesktop.content.cancel({
        requestId: favoriteSearchRequestRef.current,
      });
    };
  }, [loadFolders]);

  useEffect(() => {
    if (selectedFolderId !== null) {
      void loadVideos(selectedFolderId, 1);
    } else {
      setVideos(null);
      setVideoState('idle');
    }
  }, [loadVideos, selectedFolderId]);

  if (!auth.loggedIn || !auth.uid) {
    return (
      <div className="page-stack">
        <PageIntro
          eyebrow="LIBRARY"
          title="你的收藏夹"
          description="登录后可以读取 Bilibili 收藏夹目录，并在桌面上分页浏览收藏视频。"
        />
        <EmptyState
          action={
            <button className="primary-button" onClick={onLogin} type="button">
              <Icon name="log-in" size={17} />
              登录后查看收藏
            </button>
          }
          icon="heart"
          message="登录后解锁收藏夹"
          secondary="公开搜索和发现内容仍然可以正常使用"
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="LIBRARY"
        title={profile?.name ? `${profile.name} 的收藏夹` : '我的收藏夹'}
        description="目录和视频列表采用独立请求，切换收藏夹时不会阻塞整个窗口；搜索使用已同步的本地索引。"
      />
      <form
        className="search-panel library-search-panel"
        onSubmit={submitFavoriteSearch}>
        <Icon name="search" size={19} />
        <input
          aria-label="搜索本地收藏"
          onChange={event => {
            setFavoriteSearchQuery(event.target.value);
            setFavoriteSearchResult(null);
            setFavoriteSearchState('idle');
          }}
          placeholder="搜索已同步收藏：标题、UP 主或收藏夹"
          value={favoriteSearchQuery}
        />
        {favoriteSearchQuery ? (
          <button
            className="subtle-button"
            onClick={event => {
              event.preventDefault();
              clearFavoriteSearch();
            }}
            type="button">
            清除
          </button>
        ) : null}
        <button className="primary-button compact" type="submit">
          搜索收藏
        </button>
      </form>
      {favoriteSearchQuery.trim() ? (
        <section className="library-content favorite-search-results">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">LOCAL INDEX</p>
              <h3>收藏搜索结果</h3>
            </div>
            {favoriteSearchResult?.total !== null &&
            favoriteSearchResult?.total !== undefined ? (
              <span className="muted-label">
                {favoriteSearchResult.total.toLocaleString()} 个视频
              </span>
            ) : null}
          </div>
          {favoriteSearchState === 'idle' ? (
            <EmptyState icon="search" message="提交关键词搜索已同步收藏" />
          ) : null}
          {favoriteSearchState === 'loading' ? (
            <LoadingState label="正在搜索本地收藏" />
          ) : null}
          {favoriteSearchState === 'error' ? (
            <ErrorState
              message={error}
              onRetry={() => void loadFavoriteSearch(favoriteSearchPage)}
            />
          ) : null}
          {favoriteSearchState === 'success' &&
          favoriteSearchResult?.items.length === 0 ? (
            <EmptyState
              icon="search"
              message={`没有找到“${favoriteSearchQuery.trim()}”的收藏`}
            />
          ) : null}
          {favoriteSearchState === 'success' &&
          favoriteSearchResult?.items.length ? (
            <>
              <VideoGrid
                items={favoriteSearchResult.items}
                onAddVideo={onAddVideo}
                onPlayVideo={onPlayVideo}
              />
              <Pagination
                hasMore={favoriteSearchResult.hasMore}
                loading={false}
                onNext={() => void loadFavoriteSearch(favoriteSearchPage + 1)}
                onPrevious={() =>
                  void loadFavoriteSearch(favoriteSearchPage - 1)
                }
                page={favoriteSearchPage}
              />
            </>
          ) : null}
        </section>
      ) : null}
      {!favoriteSearchQuery.trim() ? (
        <div className="library-layout">
          <aside className="folder-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">FOLDERS</p>
                <h3>收藏目录</h3>
              </div>
              <span className="count-badge">{folders.length}</span>
            </div>
            {folderState === 'loading' ? (
              <LoadingState label="正在读取目录" compact />
            ) : null}
            {folderState === 'error' ? (
              <ErrorState
                compact
                message={error}
                onRetry={() => void loadFolders()}
              />
            ) : null}
            {folderState === 'success' && folders.length === 0 ? (
              <EmptyState compact icon="folder" message="还没有收藏夹" />
            ) : null}
            <div className="folder-list">
              {folders.map(folder => (
                <button
                  className={
                    selectedFolderId === folder.id
                      ? 'folder-item active'
                      : 'folder-item'
                  }
                  key={folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  type="button">
                  <Icon name="folder" size={17} />
                  <span>
                    <strong>{folder.title}</strong>
                    <small>{folder.mediaCount.toLocaleString()} 个视频</small>
                  </span>
                  <Icon name="chevron-right" size={14} />
                </button>
              ))}
            </div>
          </aside>
          <section className="library-content">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">VIDEOS</p>
                <h3>
                  {folders.find(folder => folder.id === selectedFolderId)
                    ?.title ?? '选择收藏夹'}
                </h3>
              </div>
              {videos?.total !== null && videos?.total !== undefined ? (
                <span className="muted-label">
                  {videos.total.toLocaleString()} 个视频
                </span>
              ) : null}
            </div>
            {videoState === 'loading' ? (
              <LoadingState label="正在读取收藏视频" />
            ) : null}
            {videoState === 'error' ? (
              <ErrorState
                message={error}
                onRetry={() =>
                  selectedFolderId === null
                    ? undefined
                    : void loadVideos(selectedFolderId, videoPage)
                }
              />
            ) : null}
            {videoState === 'success' && videos?.items.length === 0 ? (
              <EmptyState icon="folder" message="这个收藏夹暂时为空" />
            ) : null}
            {videoState === 'success' && videos?.items.length ? (
              <>
                {videos.description ? (
                  <p className="folder-description">{videos.description}</p>
                ) : null}
                <VideoGrid
                  items={videos.items}
                  onAddVideo={onAddVideo}
                  onPlayVideo={onPlayVideo}
                />
                <Pagination
                  hasMore={videos.hasMore}
                  loading={false}
                  onNext={() =>
                    selectedFolderId === null
                      ? undefined
                      : void loadVideos(selectedFolderId, videoPage + 1)
                  }
                  onPrevious={() =>
                    selectedFolderId === null
                      ? undefined
                      : void loadVideos(selectedFolderId, videoPage - 1)
                  }
                  page={videoPage}
                />
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

/** 设置页承载浅色主题、窗口行为、Android 同步偏好和账号操作。 */
function SettingsPage({
  auth,
  cacheBusy,
  cacheProgress,
  cacheSummary,
  onClearCache,
  onCheckForUpdates,
  onExportLogs,
  onLogin,
  onLogout,
  onRenew,
  onRefreshCache,
  onOpenUpdateDownload,
  onUpdate,
  profile,
  settings,
  updateInfo,
}: {
  auth: AuthStatus;
  cacheBusy: boolean;
  cacheProgress: CacheProgressEvent | null;
  cacheSummary: CacheSummary | null;
  onClearCache: () => void;
  onCheckForUpdates: () => void;
  onExportLogs: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onRenew: () => void;
  onRefreshCache: () => void;
  onOpenUpdateDownload: () => void;
  onUpdate: (
    patch: Parameters<typeof window.nyamiDesktop.settings.update>[0],
  ) => void;
  profile: UserProfile | null;
  settings: DesktopSettings | null;
  updateInfo: DesktopUpdateInfo;
}): JSX.Element {
  const [preferences, setPreferences] = useState<DesktopUserPreferences>(() =>
    loadDesktopUserPreferences(),
  );
  const [blacklistInput, setBlacklistInput] = useState('');

  /** 更新 Android 端同步到桌面的偏好并立即持久化。 */
  const updatePreference = useCallback(
    (patch: Partial<DesktopUserPreferences>): void => {
      setPreferences(previous => {
        const next = {...previous, ...patch};
        saveDesktopUserPreferences(next);
        return next;
      });
    },
    [],
  );

  /** 将文本输入转换为正整数，避免推荐时长写入非法值。 */
  const updateDurationLimit = (value: string): void => {
    const parsed = Number(value);
    if (value.trim() && Number.isFinite(parsed) && parsed > 0) {
      updatePreference({
        recommendationDurationLimitMinutes: Math.floor(parsed),
      });
    }
  };

  /** 将黑名单输入按 Android 端支持的分隔符拆分并去重。 */
  const addBlacklistTags = (value: string): void => {
    const tags = value
      .split(/[\n,，、;；\t]+/)
      .map(item => item.trim())
      .filter(Boolean);
    if (!tags.length) {
      return;
    }
    updatePreference({
      recommendationTagBlacklist: Array.from(
        new Set([...preferences.recommendationTagBlacklist, ...tags]),
      ),
    });
  };

  return (
    <div className="page-stack settings-page">
      <PageIntro
        eyebrow="SETTINGS"
        title="桌面设置"
        description="窗口尺寸和主题会保存到本地设置文件，重新启动后继续使用。"
      />
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">APPEARANCE</p>
            <h3>外观主题</h3>
          </div>
        </div>
        <div className="theme-options">
          {THEME_OPTIONS.map(option => (
            <button
              className="theme-option active"
              key={option.value}
              onClick={() => onUpdate({theme: 'light'})}
              type="button">
              <span className={`theme-swatch swatch-${option.value}`} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <Icon name="check" size={17} />
            </button>
          ))}
        </div>
      </section>
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">WINDOW</p>
            <h3>窗口行为</h3>
          </div>
        </div>
        <label className="setting-row">
          <span>
            <strong>关闭窗口时最小化到托盘</strong>
            <small>关闭主窗口后继续在后台播放，可从系统托盘恢复。</small>
          </span>
          <input
            checked={settings?.closeToTray ?? false}
            onChange={event => onUpdate({closeToTray: event.target.checked})}
            type="checkbox"
          />
        </label>
      </section>
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">LIBRARY</p>
            <h3>收藏索引</h3>
          </div>
        </div>
        <label className="setting-row">
          <span>
            <strong>登录后自动同步收藏索引</strong>
            <small>默认关闭；新账号首次同步必须在任务通知中手动执行。</small>
          </span>
          <input
            checked={settings?.autoSyncIndex ?? false}
            onChange={event => onUpdate({autoSyncIndex: event.target.checked})}
            type="checkbox"
          />
        </label>
      </section>
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">STARTUP / SYNC</p>
            <h3>启动与同步</h3>
          </div>
        </div>
        <label className="setting-row">
          <span>
            <strong>启动时拉取收藏夹最新视频</strong>
            <small>重新启动时增量检查收藏夹，仍可在任务通知中手动同步。</small>
          </span>
          <input
            checked={preferences.autoRefreshFavoritesOnLaunch}
            onChange={event =>
              updatePreference({
                autoRefreshFavoritesOnLaunch: event.target.checked,
              })
            }
            type="checkbox"
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>自动刷新首页推荐</strong>
            <small>
              {preferences.homeRefreshMode === 'automatic'
                ? `每 ${preferences.homeRefreshIntervalHours} 小时自动检查`
                : '手动模式 · 通过首页刷新按钮更新'}
            </small>
          </span>
          <input
            checked={preferences.homeRefreshMode === 'automatic'}
            onChange={event =>
              updatePreference({
                homeRefreshMode: event.target.checked ? 'automatic' : 'manual',
              })
            }
            type="checkbox"
          />
        </label>
        {preferences.homeRefreshMode === 'automatic' ? (
          <label className="setting-row setting-row-select">
            <span>
              <strong>自动刷新间隔</strong>
              <small>控制首页推荐的检查频率。</small>
            </span>
            <select
              aria-label="首页自动刷新间隔"
              onChange={event =>
                updatePreference({
                  homeRefreshIntervalHours: Number(event.target.value),
                })
              }
              value={preferences.homeRefreshIntervalHours}>
              <option value="6">6 小时</option>
              <option value="12">12 小时</option>
              <option value="24">24 小时</option>
            </select>
          </label>
        ) : null}
      </section>
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">RECOMMENDATION</p>
            <h3>推荐偏好</h3>
          </div>
        </div>
        <label className="setting-row">
          <span>
            <strong>推荐视频时长筛选</strong>
            <small>开启后，首页个性化推荐只保留限定时长内的视频。</small>
          </span>
          <input
            checked={preferences.recommendationDurationFilterEnabled}
            onChange={event =>
              updatePreference({
                recommendationDurationFilterEnabled: event.target.checked,
              })
            }
            type="checkbox"
          />
        </label>
        <label className="setting-row setting-row-input">
          <span>
            <strong>最长时长（分钟）</strong>
            <small>只填写最大时长，留空时不限制。</small>
          </span>
          <input
            aria-label="推荐视频最长时长"
            disabled={!preferences.recommendationDurationFilterEnabled}
            min="1"
            onChange={event => updateDurationLimit(event.target.value)}
            type="number"
            value={preferences.recommendationDurationLimitMinutes}
          />
        </label>
        <div className="setting-row setting-row-tags">
          <span>
            <strong>推荐关键词屏蔽</strong>
            <small>使用换行或逗号分隔，匹配标签后不再进入推荐。</small>
          </span>
          <div className="setting-tags-control">
            <input
              aria-label="添加推荐屏蔽标签"
              onChange={event => setBlacklistInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addBlacklistTags(blacklistInput);
                  setBlacklistInput('');
                }
              }}
              placeholder="例如：搬运"
              value={blacklistInput}
            />
            <button
              className="text-button"
              onClick={() => {
                addBlacklistTags(blacklistInput);
                setBlacklistInput('');
              }}
              type="button">
              添加
            </button>
            <div className="setting-tags-list">
              {preferences.recommendationTagBlacklist.map(tag => (
                <button
                  aria-label={`移除屏蔽标签 ${tag}`}
                  key={tag}
                  onClick={() =>
                    updatePreference({
                      recommendationTagBlacklist:
                        preferences.recommendationTagBlacklist.filter(
                          item => item !== tag,
                        ),
                    })
                  }
                  type="button">
                  {tag} ×
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="setting-row">
          <span>
            <strong>个性化播放缓存</strong>
            <small>按当前偏好缓存推荐内容，减少重复加载。</small>
          </span>
          <input
            checked={preferences.cachePersonalizedRecommendations}
            onChange={event =>
              updatePreference({
                cachePersonalizedRecommendations: event.target.checked,
              })
            }
            type="checkbox"
          />
        </label>
      </section>
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">NETWORK / PLAYBACK</p>
            <h3>网络与播放</h3>
          </div>
        </div>
        <label className="setting-row">
          <span>
            <strong>仅 Wi-Fi 下加载</strong>
            <small>使用移动网络时不加载新的在线音频。</small>
          </span>
          <input
            checked={preferences.wifiOnly}
            onChange={event =>
              updatePreference({wifiOnly: event.target.checked})
            }
            type="checkbox"
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Wi-Fi 下自动缓存已播放音频</strong>
            <small>再次播放时优先使用本机缓存。</small>
          </span>
          <input
            checked={preferences.autoCacheOnWifi}
            onChange={event =>
              updatePreference({autoCacheOnWifi: event.target.checked})
            }
            type="checkbox"
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>自动展开视频分集</strong>
            <small>多分集视频加入队列时展开全部分集。</small>
          </span>
          <input
            checked={preferences.expandMultiPart}
            onChange={event =>
              updatePreference({expandMultiPart: event.target.checked})
            }
            type="checkbox"
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>与其他应用同时播放</strong>
            <small>允许音频与其他桌面应用混合播放。</small>
          </span>
          <input
            checked={preferences.mixWithOthers}
            onChange={event =>
              updatePreference({mixWithOthers: event.target.checked})
            }
            type="checkbox"
          />
        </label>
        <label className="setting-row setting-row-select">
          <span>
            <strong>播放音质</strong>
            <small>仅影响后续请求，实际质量仍以 Bilibili 音源为准。</small>
          </span>
          <select
            aria-label="播放音质"
            onChange={event =>
              updatePreference({
                quality: event.target
                  .value as DesktopUserPreferences['quality'],
              })
            }
            value={preferences.quality}>
            <option value="standard">标准</option>
            <option value="high">高品质</option>
            <option value="best">最高可用</option>
          </select>
        </label>
      </section>
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">STORAGE</p>
            <h3>缓存管理</h3>
          </div>
          <button
            aria-label="刷新缓存摘要"
            className="icon-button"
            onClick={onRefreshCache}
            title="刷新缓存摘要"
            type="button">
            <Icon name="refresh" size={16} />
          </button>
        </div>
        <div className="cache-summary-grid">
          <div>
            <span>音频缓存</span>
            <strong>{formatBytes(cacheSummary?.audioBytes ?? 0)}</strong>
          </div>
          <div>
            <span>图片缓存</span>
            <strong>{formatBytes(cacheSummary?.imageBytes ?? 0)}</strong>
          </div>
          <div>
            <span>文件数量</span>
            <strong>{cacheSummary?.fileCount ?? 0}</strong>
          </div>
        </div>
        {cacheProgress ? (
          <div className="cache-progress" role="status">
            <span>
              {cacheProgress.operation === 'clear'
                ? '正在清理缓存'
                : '正在扫描缓存'}
            </span>
            <span>
              {cacheProgress.completed}/{cacheProgress.total}
            </span>
          </div>
        ) : null}
        <div className="settings-actions-row">
          <button
            className="danger-button"
            disabled={cacheBusy}
            onClick={onClearCache}
            type="button">
            <Icon name="trash" size={16} />
            {cacheBusy ? '清理中…' : '清空缓存'}
          </button>
          <small>
            清理会删除已下载音频和图片，播放队列会在下次播放时重新获取。
          </small>
        </div>
      </section>
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">DIAGNOSTICS</p>
            <h3>诊断日志</h3>
          </div>
        </div>
        <div className="settings-actions-row">
          <button
            className="secondary-button"
            onClick={onExportLogs}
            type="button">
            <Icon name="download" size={16} />
            导出脱敏日志
          </button>
          <small>日志会过滤 Cookie、token、二维码密钥和 URL 查询参数。</small>
        </div>
      </section>
      <section className="settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">RELEASE</p>
            <h3>版本与更新</h3>
          </div>
          <span className="status-chip">
            {updateInfo.currentVersion
              ? `v${updateInfo.currentVersion}`
              : '读取版本…'}
          </span>
        </div>
        <div className="update-summary" role="status">
          <strong>{getUpdateStatusLabel(updateInfo)}</strong>
          {updateInfo.latestVersion && updateInfo.status === 'available' ? (
            <span>可升级到 v{updateInfo.latestVersion}</span>
          ) : null}
          {updateInfo.error ? <span>{updateInfo.error}</span> : null}
          {updateInfo.notes && updateInfo.status === 'available' ? (
            <small>{getReleaseNoteSummary(updateInfo.notes)}</small>
          ) : null}
        </div>
        <div className="settings-actions-row">
          <button
            className="secondary-button"
            disabled={updateInfo.status === 'checking'}
            onClick={onCheckForUpdates}
            type="button">
            <Icon name="refresh" size={16} />
            {updateInfo.status === 'checking' ? '检查中…' : '检查更新'}
          </button>
          {updateInfo.status === 'available' ? (
            <button
              className="primary-button"
              onClick={onOpenUpdateDownload}
              type="button">
              <Icon name="download" size={16} />
              打开下载页
            </button>
          ) : null}
          <small>
            {updateInfo.source
              ? '更新源由 NYAMI_UPDATE_URL 配置；下载和安装由用户手动确认。'
              : '未配置更新源时仍可使用当前版本，发布环境可通过 NYAMI_UPDATE_URL 接入 latest.json。'}
          </small>
        </div>
      </section>
      <section className="settings-card account-settings-card">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">ACCOUNT</p>
            <h3>账号与登录</h3>
          </div>
        </div>
        {auth.loggedIn ? (
          <div className="account-settings-summary">
            <Avatar profile={profile} size="large" />
            <div>
              <strong>{profile?.name ?? 'Bilibili 账号'}</strong>
              <span>
                {profile?.uid ?? auth.uid
                  ? `UID ${profile?.uid ?? auth.uid}`
                  : '已登录'}
              </span>
              <small>
                {auth.refreshAvailable
                  ? '支持自动续期'
                  : '建议重新扫码获取续期凭证'}
              </small>
            </div>
            <div className="account-settings-actions">
              <button
                className="secondary-button"
                onClick={onRenew}
                type="button">
                <Icon name="refresh" size={16} />
                续期登录
              </button>
              <button
                className="danger-button"
                onClick={onLogout}
                type="button">
                <Icon name="log-out" size={16} />
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <div className="account-settings-summary logged-out">
            <div className="avatar avatar-large avatar-placeholder">
              <Icon name="user" size={22} />
            </div>
            <div>
              <strong>尚未登录</strong>
              <span>公开内容仍可浏览</span>
            </div>
            <button className="primary-button" onClick={onLogin} type="button">
              <Icon name="log-in" size={16} />
              去登录
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** 受控登录弹窗，提供二维码、网页登录、续期和退出登录入口。 */
function LoginDialog({
  auth,
  busy,
  expiresAt,
  imageDataUrl,
  onClose,
  onLogout,
  onRenew,
  onStartQr,
  onWebLogin,
  profile,
  status,
}: {
  auth: AuthStatus;
  busy: boolean;
  expiresAt: number | null;
  imageDataUrl: string;
  onClose: () => void;
  onLogout: () => void;
  onRenew: () => void;
  onStartQr: () => void;
  onWebLogin: () => void;
  profile: UserProfile | null;
  status: string;
}): JSX.Element {
  return (
    <div
      aria-modal="true"
      className="modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog">
      <section className="login-dialog">
        <div className="dialog-header">
          <div>
            <p className="section-kicker">BILIBILI ACCOUNT</p>
            <h2>{auth.loggedIn ? '账号已连接' : '连接 Bilibili 账号'}</h2>
          </div>
          <button
            aria-label="关闭登录窗口"
            className="icon-button"
            onClick={onClose}
            type="button">
            <Icon name="x" size={18} />
          </button>
        </div>
        {auth.loggedIn ? (
          <div className="logged-in-dialog">
            <Avatar profile={profile} size="large" />
            <strong>{profile?.name ?? 'Bilibili 账号'}</strong>
            <span>
              {profile?.uid ?? auth.uid
                ? `UID ${profile?.uid ?? auth.uid}`
                : '已登录'}
            </span>
            <p>
              登录凭证保存在 Windows 安全存储中，Renderer 不会读取完整 Cookie。
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={onRenew}
                type="button">
                <Icon name="refresh" size={16} />
                续期登录
              </button>
              <button
                className="danger-button"
                onClick={onLogout}
                type="button">
                <Icon name="log-out" size={16} />
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="login-method-tabs">
              <span className="login-method active">扫码登录</span>
              <button
                className="text-button"
                onClick={onWebLogin}
                type="button">
                <Icon name="user" size={15} />
                网页登录
              </button>
            </div>
            <div className="qr-login-stage">
              {imageDataUrl ? (
                <img
                  alt="Bilibili 登录二维码"
                  className="qr-image"
                  src={imageDataUrl}
                />
              ) : (
                <div className="qr-placeholder">
                  <Icon name="loader" size={22} />
                  正在准备二维码
                </div>
              )}
            </div>
            <p aria-live="polite" className="login-status">
              {status}
            </p>
            {expiresAt ? (
              <p className="muted-label">
                二维码有效期至 {new Date(expiresAt).toLocaleTimeString()}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button
                className="primary-button"
                disabled={busy}
                onClick={onStartQr}
                type="button">
                <Icon name="refresh" size={16} />
                {busy ? '生成中…' : '重新生成二维码'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** 渲染统一视频卡片网格，保留封面比例避免异步图片造成布局跳动。 */
function VideoGrid({
  items,
  onAddVideo,
  onPlayVideo,
}: {
  items: DesktopVideo[];
  onAddVideo: (video: DesktopVideo) => void;
  onPlayVideo: (video: DesktopVideo) => void;
}): JSX.Element {
  return (
    <div className="video-grid">
      {items.map(video => (
        <VideoCard
          item={video}
          key={video.bvid}
          onAdd={() => onAddVideo(video)}
          onPlay={() => onPlayVideo(video)}
        />
      ))}
    </div>
  );
}

/** 渲染一个公开视频摘要卡片。 */
function VideoCard({
  item,
  onAdd,
  onPlay,
}: {
  item: DesktopVideo;
  onAdd: () => void;
  onPlay: () => void;
}): JSX.Element {
  return (
    <article className="video-card" onDoubleClick={onPlay}>
      <button
        aria-label={`播放 ${item.title}`}
        className="video-cover-button"
        onClick={onPlay}
        type="button">
        <div className="video-cover-wrap">
          <VideoCoverImage src={item.cover} />
          <span className="duration-chip">{formatDuration(item.duration)}</span>
        </div>
      </button>
      <div className="video-card-body">
        <h3 title={item.title}>{item.title}</h3>
        <p>{item.author}</p>
        <div className="video-card-meta">
          <span>{formatDate(item.pubtime)}</span>
          {item.source === 'favorite' ? (
            <span className="source-chip">已收藏</span>
          ) : null}
          <button
            aria-label={`将 ${item.title} 加入队列`}
            className="queue-add-button"
            onClick={onAdd}
            title="加入播放队列"
            type="button">
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

/** 加载视频封面，失败时回退到稳定占位图，避免显示原生破图图标。 */
function VideoCoverImage({src}: {src: string}): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div aria-label="视频封面暂不可用" className="cover-placeholder">
        <Icon name="play" size={22} />
      </div>
    );
  }

  return (
    <img
      alt=""
      className="video-cover"
      loading="lazy"
      onError={() => setFailed(true)}
      src={src}
    />
  );
}

/** 渲染页面标题区。 */
function PageIntro({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}): JSX.Element {
  return (
    <section className="page-intro">
      <p className="section-kicker">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

/** 渲染区块标题和可选动作。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SectionHeading({
  action,
  eyebrow,
  title,
}: {
  action?: ReactNode;
  eyebrow: string;
  title: string;
}): JSX.Element {
  return (
    <div className="section-heading">
      <div>
        <p className="section-kicker">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

/** 渲染统一加载状态。 */
function LoadingState({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}): JSX.Element {
  return (
    <div
      className={compact ? 'state-card compact' : 'state-card'}
      role="status">
      <Icon className="spin" name="loader" size={20} />
      <span>{label}</span>
    </div>
  );
}

/** 渲染统一空状态，并在需要时提供主操作。 */
function EmptyState({
  action,
  compact = false,
  icon,
  message,
  secondary,
}: {
  action?: ReactNode;
  compact?: boolean;
  icon: IconName;
  message: string;
  secondary?: string;
}): JSX.Element {
  return (
    <div
      className={
        compact ? 'state-card empty-state compact' : 'state-card empty-state'
      }>
      <span className="state-icon">
        <Icon name={icon} size={21} />
      </span>
      <strong>{message}</strong>
      {secondary ? <span>{secondary}</span> : null}
      {action}
    </div>
  );
}

/** 渲染统一错误状态和重试入口。 */
function ErrorState({
  compact = false,
  message,
  onRetry,
}: {
  compact?: boolean;
  message: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div
      className={
        compact ? 'state-card error-state compact' : 'state-card error-state'
      }
      role="alert">
      <span className="state-icon error">
        <Icon name="alert" size={21} />
      </span>
      <strong>{message}</strong>
      <button className="text-button" onClick={onRetry} type="button">
        <Icon name="refresh" size={15} />
        重试
      </button>
    </div>
  );
}

/** 渲染统一分页控制，避免列表页面重复实现边界判断。 */
function Pagination({
  hasMore,
  loading,
  onNext,
  onPrevious,
  page,
}: {
  hasMore: boolean;
  loading: boolean;
  onNext: () => void;
  onPrevious: () => void;
  page: number;
}): JSX.Element {
  return (
    <nav aria-label="分页" className="pagination">
      <button
        aria-label="上一页"
        className="icon-button"
        disabled={loading || page <= 1}
        onClick={onPrevious}
        title="上一页"
        type="button">
        <Icon name="chevron-left" size={17} />
      </button>
      <span>第 {page} 页</span>
      <button
        aria-label="下一页"
        className="icon-button"
        disabled={loading || !hasMore}
        onClick={onNext}
        title="下一页"
        type="button">
        <Icon name="chevron-right" size={17} />
      </button>
    </nav>
  );
}

/** 渲染受 AudioWorklet 驱动的轻量频谱柱，限制柱数和重绘频率。 */
const SpectrumVisualizer = memo(function SpectrumVisualizer({
  isPlaying = false,
  values,
}: {
  isPlaying?: boolean;
  values: number[];
}): JSX.Element {
  const displayValues = values.slice(0, 24);
  return (
    <div
      aria-label="实时频谱"
      className={
        isPlaying ? 'spectrum-visualizer is-playing' : 'spectrum-visualizer'
      }
      role="img">
      {(displayValues.length ? displayValues : Array(24).fill(0)).map(
        (value, index) => (
          <span
            className="spectrum-bar"
            key={index}
            style={
              {
                '--bar-index': index,
                height: `${Math.max(6, Math.round(value * 100))}%`,
              } as CSSProperties
            }
          />
        ),
      )}
    </div>
  );
});

/** 渲染底部播放器、进度控制和可拖拽播放队列。 */
function PlayerPlaceholder({
  playback,
  spectrum,
  onModeChange,
  onNext,
  onPause,
  onPlay,
  onPrevious,
  onRemove,
  onReorder,
  onSeek,
  onSelectTrack,
  onOpenPlayback,
  onVolume,
}: {
  playback: PlaybackSnapshot;
  spectrum: number[];
  onModeChange: (mode: PlaybackQueueMode) => void;
  onNext: () => void;
  onPause: () => void;
  onPlay: () => void;
  onPrevious: () => void;
  onRemove: (trackId: string) => void;
  onReorder: (trackIds: string[]) => void;
  onSeek: (position: number) => void;
  onSelectTrack: (trackId: string) => void;
  onOpenPlayback: () => void;
  onVolume: (volume: number) => void;
}): JSX.Element {
  const isPlaying = playback.state === 'playing';
  const [queueOpen, setQueueOpen] = useState(false);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const duration = playback.duration > 0 ? playback.duration : 1;

  /** 将拖拽中的队列项目移动到目标位置。 */
  const handleDrop = (targetId: string): void => {
    if (!draggedTrackId || draggedTrackId === targetId) {
      return;
    }
    const ids = playback.queue.map(item => item.id);
    const sourceIndex = ids.indexOf(draggedTrackId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }
    const [moved] = ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, moved);
    onReorder(ids);
    setDraggedTrackId(null);
  };

  return (
    <footer className="player-placeholder">
      <div className="player-main-row">
        <button
          aria-label="打开普通播放界面"
          className="player-track player-track-button"
          onClick={onOpenPlayback}
          type="button">
          <PlayerArtworkImage src={playback.artwork} />
          <div className="player-track-copy">
            <strong title={playback.trackTitle ?? '尚未选择歌曲'}>
              {playback.trackTitle ?? '尚未选择歌曲'}
            </strong>
            <div className="player-track-meta">
              <span>{playback.trackArtist ?? '选择内容卡片开始播放'}</span>
              {playback.cached ? (
                <span className="player-state-badge cached">已缓存</span>
              ) : null}
              {playback.state === 'error' ? (
                <span className="player-state-badge error">播放失败</span>
              ) : null}
            </div>
          </div>
        </button>
        <div className="player-controls">
          <button
            aria-label="上一首"
            className="player-step-button"
            onClick={onPrevious}
            title="上一首"
            type="button">
            <Icon name="arrow-left" size={17} />
          </button>
          <button
            aria-label={isPlaying ? '暂停' : '播放'}
            className="player-main-button"
            onClick={isPlaying ? onPause : onPlay}
            title={isPlaying ? '暂停' : '播放'}
            type="button">
            <Icon name={isPlaying ? 'pause' : 'play'} size={18} />
          </button>
          <button
            aria-label="下一首"
            className="player-step-button"
            onClick={onNext}
            title="下一首"
            type="button">
            <Icon name="arrow-right" size={17} />
          </button>
        </div>
        <div className="player-actions">
          <label className="player-volume-control">
            <Icon name="volume" size={15} />
            <span className="sr-only">音量</span>
            <input
              aria-label="音量"
              max="1"
              min="0"
              onChange={event => onVolume(Number(event.target.value))}
              step="0.01"
              type="range"
              value={playback.volume}
            />
          </label>
          <button
            aria-expanded={queueOpen}
            className="player-tool-button queue-toggle"
            onClick={() => setQueueOpen(current => !current)}
            title="播放队列"
            type="button">
            <Icon name="list" size={15} />
            <strong>{playback.queueLength}</strong>
          </button>
          <button
            aria-label="切换播放模式"
            aria-pressed={playback.mode === 'shuffle'}
            className="player-tool-button queue-mode-button"
            onClick={() =>
              onModeChange(
                playback.mode === 'shuffle' ? 'sequential' : 'shuffle',
              )
            }
            title={playback.mode === 'shuffle' ? '随机播放' : '顺序播放'}
            type="button">
            <Icon name="shuffle" size={15} />
          </button>
        </div>
      </div>
      <div className="player-progress-row">
        <span className="player-time">{formatDuration(playback.position)}</span>
        <input
          aria-label="播放进度"
          className="player-progress-input"
          disabled={!playback.trackId}
          max={duration}
          min="0"
          onChange={event => onSeek(Number(event.target.value))}
          step="0.1"
          type="range"
          value={Math.min(playback.position, duration)}
        />
        <span className="player-time">{formatDuration(playback.duration)}</span>
        <SpectrumVisualizer isPlaying={isPlaying} values={spectrum} />
      </div>
      {playback.diagnostic ? (
        <div className="player-diagnostic" role="status">
          {playback.diagnostic.message}
          {playback.diagnostic.retrying ? '…' : ''}
        </div>
      ) : null}
      {queueOpen ? (
        <div
          className="queue-panel-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setQueueOpen(false);
            }
          }}>
          <div className="queue-panel" role="dialog">
            <div className="queue-panel-header">
              <strong>播放队列</strong>
              <span>{playback.queueLength} 首</span>
            </div>
            {playback.queue.length ? (
              playback.queue.map(item => (
                <div
                  className={
                    item.id === playback.trackId
                      ? 'queue-item active'
                      : 'queue-item'
                  }
                  draggable
                  key={item.id}
                  onDragEnd={() => setDraggedTrackId(null)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={() => handleDrop(item.id)}
                  onDragStart={() => setDraggedTrackId(item.id)}>
                  <span className="queue-drag-handle">⋮⋮</span>
                  <button
                    className="queue-item-play"
                    onClick={() => onSelectTrack(item.id)}
                    type="button">
                    <strong>{item.title}</strong>
                    <small>{item.artist}</small>
                  </button>
                  <button
                    aria-label="移除队列项目"
                    className="task-dismiss"
                    onClick={() => onRemove(item.id)}
                    type="button">
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))
            ) : (
              <div className="queue-empty">
                队列为空，点击内容卡片开始播放。
              </div>
            )}
          </div>
        </div>
      ) : null}
    </footer>
  );
}

/** 加载播放器封面，失败时回退到统一占位图。 */
function PlayerArtworkImage({src}: {src: string | null}): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="player-art">
        <Icon name="play" size={18} />
      </div>
    );
  }

  return (
    <img
      alt=""
      className="player-art player-art-image"
      onError={() => setFailed(true)}
      src={src}
    />
  );
}

/** 渲染全局任务通知下拉面板。 */
function TaskCenter({
  notices,
  onCancelSync,
  onDismiss,
  onStartSync,
  sync,
}: {
  notices: Notice[];
  onCancelSync: () => void;
  onDismiss: (id: number) => void;
  onStartSync: (force?: boolean) => void;
  sync: SyncSnapshot;
}): JSX.Element {
  return (
    <div className="task-center" role="status">
      <div className="task-center-header">
        <strong>任务通知</strong>
        <span>{notices.length ? `${notices.length} 条` : '暂无'}</span>
      </div>
      <div className="task-item sync-task">
        <span className="task-item-icon">
          <Icon name="refresh" size={15} />
        </span>
        <span className="sync-task-copy">
          <strong>{sync.message ?? '收藏同步未启动'}</strong>
          {sync.state === 'running' ? (
            <small>
              {sync.phase === 'favorites'
                ? `${sync.processedVideos}/${sync.totalVideos} 个视频`
                : `${sync.completed}/${sync.total} 个收藏夹`}
            </small>
          ) : null}
          {sync.error ? <small>{sync.error}</small> : null}
        </span>
        {sync.state === 'running' ? (
          <button className="task-action" onClick={onCancelSync} type="button">
            取消
          </button>
        ) : (
          <button
            className="task-action"
            onClick={() => onStartSync(sync.state === 'failed')}
            type="button">
            {sync.state === 'failed' ? '重试' : '同步'}
          </button>
        )}
      </div>
      {notices.length ? (
        notices
          .slice()
          .reverse()
          .map(notice => (
            <div className={`task-item ${notice.tone}`} key={notice.id}>
              <span className="task-item-icon">
                <Icon
                  name={
                    notice.tone === 'error'
                      ? 'alert'
                      : notice.tone === 'success'
                      ? 'check'
                      : 'sparkles'
                  }
                  size={15}
                />
              </span>
              <span>{notice.message}</span>
              <button
                aria-label="移除通知"
                className="task-dismiss"
                onClick={() => onDismiss(notice.id)}
                type="button">
                <Icon name="x" size={13} />
              </button>
            </div>
          ))
      ) : (
        <div className="task-empty">登录、搜索和同步状态会显示在这里。</div>
      )}
    </div>
  );
}

/** 渲染短时提示栈。 */
function NoticeStack({notices}: {notices: Notice[]}): JSX.Element {
  return (
    <div aria-live="polite" className="notice-stack">
      {notices.map(notice => (
        <div className={`notice-toast ${notice.tone}`} key={notice.id}>
          <Icon
            name={
              notice.tone === 'error'
                ? 'alert'
                : notice.tone === 'success'
                ? 'check'
                : 'sparkles'
            }
            size={16}
          />
          <span>{notice.message}</span>
        </div>
      ))}
    </div>
  );
}

/** 渲染账号头像，缺少头像时使用无障碍友好的默认图标。 */
function Avatar({
  profile,
  size = 'small',
}: {
  profile: UserProfile | null;
  size?: 'small' | 'large';
}): JSX.Element {
  if (profile?.avatar) {
    return (
      <img alt="" className={`avatar avatar-${size}`} src={profile.avatar} />
    );
  }
  return (
    <span className={`avatar avatar-${size} avatar-placeholder`}>
      <Icon name="user" size={size === 'large' ? 22 : 16} />
    </span>
  );
}

/** 只保留属于当前账号的资料，避免登录切换期间显示旧用户。 */
function getActiveProfile(
  auth: AuthStatus,
  profile: UserProfile | null,
): UserProfile | null {
  if (!auth.loggedIn || !profile) {
    return null;
  }
  if (auth.uid && profile.uid !== auth.uid) {
    return null;
  }
  return profile;
}

/** 将秒数格式化为播放器和卡片可读的时长。 */
function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '--:--';
  }
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
  }
  return `${minutes}:${remainder}`;
}

/** 将缓存和导出文件大小转成便于设置页阅读的单位。 */
/** 将更新状态转换为设置页的简短提示。 */
function getUpdateStatusLabel(info: DesktopUpdateInfo): string {
  if (info.status === 'available') {
    return '发现可用更新';
  }
  if (info.status === 'checking') {
    return '正在检查更新';
  }
  if (info.status === 'up-to-date') {
    return '当前已是最新版本';
  }
  if (info.status === 'disabled') {
    return '更新源未配置';
  }
  if (info.status === 'error') {
    return '更新检查失败';
  }
  return '尚未检查更新';
}

/** 将发布说明压缩为设置页可读的一行摘要。 */
function getReleaseNoteSummary(notes: string): string {
  return notes
    .replace(/[#>*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  return `${(value / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${
    units[unitIndex]
  }`;
}

/** 将 Unix 秒时间戳格式化为内容卡片日期。 */
function formatDate(value: number): string {
  if (!value) {
    return '日期未知';
  }
  return new Date(value * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** 读取主进程或网络错误的安全展示文案。 */
function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 判断请求是否因用户取消而结束。 */
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error && error.message.includes('请求已取消'))
  );
}

/** 生成仅用于当前 Renderer 生命周期的请求 ID。 */
function makeRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 计算播放器进度百分比，避免无效时长产生布局异常。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getProgressPercent(snapshot: PlaybackSnapshot): number {
  if (!snapshot.duration || snapshot.duration <= 0) {
    return 0;
  }
  return Math.min(
    100,
    Math.max(0, (snapshot.position / snapshot.duration) * 100),
  );
}

/** 将内容卡片转换为跨进程播放队列项目。 */
function toPlaybackQueueItem(video: DesktopVideo): PlaybackQueueItem {
  return {
    id: video.bvid,
    bvid: video.bvid,
    title: video.title,
    artist: video.author,
    artwork: video.cover,
    duration: video.duration,
    ...(video.page !== undefined ? {page: video.page} : {}),
    ...(video.source ? {source: video.source} : {}),
  };
}

/** 复制并打散收藏夹队列，避免修改调用方持有的数组。 */
function shuffleQueueItems(items: PlaybackQueueItem[]): PlaybackQueueItem[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

/** 将首页/发现热门结果标记为可自动续页的热门队列。 */
function getPopularQueueContext(
  video: DesktopVideo,
): PlaybackQueueContext | null {
  return video.source === 'popular' ? {kind: 'popular', page: 1} : null;
}

/** 返回设计稿顶栏使用的路由编号、分组和标题。 */
function getRouteHeader(route: Route): {eyebrow: string; title: string} {
  const headers: Record<Route, {eyebrow: string; title: string}> = {
    discover: {eyebrow: '01 / DISCOVER', title: 'DISCOVER'},
    search: {eyebrow: '02 / SEARCH', title: 'SEARCH'},
    library: {eyebrow: '03 / LIBRARY', title: 'LIBRARY'},
    'folder-detail': {
      eyebrow: '04 / LIBRARY / FOLDER',
      title: 'FOLDER DETAIL',
    },
    taste: {eyebrow: '05 / MUSIC TASTE', title: 'MUSIC TASTE'},
    'sound-lab': {eyebrow: '06 / SOUND LAB', title: 'SOUND LAB'},
    settings: {eyebrow: '07 / SETTINGS', title: 'SETTINGS'},
    'immersive-windowed': {
      eyebrow: '08 / IMMERSIVE',
      title: 'WINDOWED IMMERSIVE',
    },
    'immersive-fullscreen': {
      eyebrow: '09 / IMMERSIVE',
      title: 'FULLSCREEN IMMERSIVE',
    },
  };
  return headers[route];
}
