import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {ChangeEvent, CSSProperties, FormEvent} from 'react';
import {Icon} from './icons';
import type {
  AuthStatus,
  DesktopAudioSettings,
  DesktopPeqFilterType,
  DesktopPage,
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopVideo,
  FavoriteFolderSummary,
  PlaybackSnapshot,
  PlaybackQueueMode,
  UserProfile,
} from '../shared/types';
import {
  DEFAULT_DESKTOP_AUDIO_SETTINGS,
  DESKTOP_GRAPHIC_PRESETS,
  GRAPHIC_BAND_FREQUENCIES,
} from './audio/eqPresets';
import coverBlueUrl from './assets/cover-blue.png';
import coverForestUrl from './assets/cover-forest.png';
import coverNightUrl from './assets/cover-night.png';
import coverPinkUrl from './assets/cover-pink.png';
import coverPortraitUrl from './assets/cover-portrait.png';
import coverSummerUrl from './assets/cover-summer.png';

/** PC 端设计稿对应的路由集合，沉浸式页面不参与普通导航。 */
export type PrototypeRoute =
  | 'search'
  | 'library'
  | 'folder-detail'
  | 'sound-lab'
  | 'settings'
  | 'immersive-windowed';

type PrototypeNoticeTone = 'info' | 'success' | 'error';

type PrototypePageProps = {
  route: PrototypeRoute;
  auth: AuthStatus;
  profile: UserProfile | null;
  playback: PlaybackSnapshot;
  spectrum: number[];
  searchQuery: string;
  settings: DesktopSettings | null;
  onRouteChange: (route: PrototypeRoute) => void;
  onSelectFolder: (folderId: number) => void;
  onSleepTimer: (seconds: number | null) => void;
  onPlayVideo: (video: DesktopVideo) => void;
  onPlayVideos: (videos: DesktopVideo[], shuffle: boolean) => void;
  onAddVideo: (video: DesktopVideo) => void;
  onNotice: (tone: PrototypeNoticeTone, message: string) => void;
  onUpdateSettings: (patch: DesktopSettingsPatch) => void;
  onOpenLogin: () => void;
  onPlay: () => void;
  onPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (position: number) => void;
  onVolume: (volume: number) => void;
  onModeChange: (mode: PlaybackQueueMode) => void;
  onSelectTrack: (trackId: string) => void;
  onRemoveTrack: (trackId: string) => void;
  selectedFolderId: number | null;
};

type PrototypeTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number;
  duration: number;
  cover: string;
};

const MOCK_TRACKS: PrototypeTrack[] = [
  {
    id: 'nyami-summer',
    title: '夏がまた終わらない',
    artist: 'Sena Mori',
    album: '夏の記憶',
    genre: 'Indie Pop',
    year: 2024,
    duration: 267,
    cover: coverSummerUrl,
  },
  {
    id: 'nyami-transparent',
    title: '雨のち、透明',
    artist: 'Mio Kato',
    album: '未明の庭',
    genre: 'Ambient',
    year: 2023,
    duration: 234,
    cover: coverPinkUrl,
  },
  {
    id: 'nyami-night',
    title: '夜のコレクション',
    artist: 'Lumen',
    album: '夜行標本',
    genre: 'Electronic',
    year: 2022,
    duration: 312,
    cover: coverNightUrl,
  },
  {
    id: 'nyami-blue-hour',
    title: 'Blue Hour',
    artist: 'Haru & Sea',
    album: '海辺の手紙',
    genre: 'Alternative',
    year: 2024,
    duration: 241,
    cover: coverBlueUrl,
  },
  {
    id: 'nyami-city',
    title: '眠れない街',
    artist: 'Rin Oda',
    album: '睡眠前奏曲',
    genre: 'Ambient',
    year: 2021,
    duration: 213,
    cover: coverForestUrl,
  },
  {
    id: 'nyami-lens',
    title: '雨上がりのレンズ',
    artist: 'Yuki Nara',
    album: '窓辺の標本',
    genre: 'Indie Pop',
    year: 2020,
    duration: 286,
    cover: coverPortraitUrl,
  },
  {
    id: 'nyami-dawn',
    title: '黎明之前的潮汐',
    artist: 'Aoi Kiri',
    album: '潮汐记录',
    genre: 'Field Recording',
    year: 2024,
    duration: 198,
    cover: coverBlueUrl,
  },
  {
    id: 'nyami-static',
    title: '静电与微光',
    artist: 'Mori Nao',
    album: '微光档案',
    genre: 'Electronic',
    year: 2023,
    duration: 255,
    cover: coverForestUrl,
  },
];

const EQ_FREQUENCIES = [...GRAPHIC_BAND_FREQUENCIES];

/** 渲染设计稿对应的普通页面内容。 */
export function PrototypePage(props: PrototypePageProps): JSX.Element {
  switch (props.route) {
    case 'search':
      return <DesignSearchPage {...props} />;
    case 'library':
      return <DesignLibraryPage {...props} />;
    case 'folder-detail':
      return <FolderDetailPage {...props} />;
    case 'sound-lab':
      return <SoundLabPage {...props} />;
    case 'settings':
      return <div className="prototype-empty-page" />;
    case 'immersive-windowed':
      return <PrototypeImmersivePage {...props} />;
    default:
      return <DesignLibraryPage {...props} />;
  }
}

/** 设计稿搜索页，回车后立即请求真实 Bilibili 搜索结果并应用筛选。 */
function DesignSearchPage(props: PrototypePageProps): JSX.Element {
  const {onNotice} = props;
  const [query, setQuery] = useState(props.searchQuery);
  const [activeQuery, setActiveQuery] = useState(props.searchQuery.trim());
  const [sort, setSort] = useState('综合排序');
  const [dateFilter, setDateFilter] = useState('全部日期');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [maxDuration, setMaxDuration] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [result, setResult] = useState<DesktopPage<DesktopVideo> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [requestError, setRequestError] = useState('');
  const requestIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const cancelActiveRequest = useCallback((): void => {
    const requestId = requestIdRef.current;
    if (requestId) {
      void window.nyamiDesktop.content.cancel({requestId});
      requestIdRef.current = null;
    }
  }, []);

  const getSearchOptions = useCallback(() => {
    const orderMap: Record<
      string,
      'totalrank' | 'click' | 'pubdate' | 'danmaku' | 'stow'
    > = {
      综合排序: 'totalrank',
      最多播放: 'click',
      最新发布: 'pubdate',
      最多弹幕: 'danmaku',
      最多收藏: 'stow',
    };
    const dateOffset =
      dateFilter === '最近一天'
        ? 86400
        : dateFilter === '最近一周'
        ? 86400 * 7
        : dateFilter === '最近半年'
        ? 86400 * 183
        : null;
    const customStart = startDate
      ? new Date(`${startDate}T00:00:00`).getTime() / 1000
      : undefined;
    const customEnd = endDate
      ? new Date(`${endDate}T23:59:59`).getTime() / 1000
      : undefined;
    return {
      order: orderMap[sort],
      startDate:
        customStart ??
        (dateOffset === null ? undefined : Date.now() / 1000 - dateOffset),
      endDate: customEnd,
      minDuration: minDuration ? Math.max(0, Number(minDuration) * 60) : undefined,
      maxDuration: maxDuration ? Math.max(0, Number(maxDuration) * 60) : undefined,
    };
  }, [dateFilter, endDate, maxDuration, minDuration, sort, startDate]);

  const loadPage = useCallback(
    async (page: number, append: boolean): Promise<void> => {
      const normalized = activeQuery.trim();
      if (!normalized || loadingRef.current) {
        return;
      }
      cancelActiveRequest();
      const requestId = makeRequestId('search');
      requestIdRef.current = requestId;
      loadingRef.current = true;
      setLoading(!append);
      setLoadingMore(append);
      setRequestError('');
      try {
        const next = await window.nyamiDesktop.content.search({
          keyword: normalized,
          page,
          requestId,
          ...getSearchOptions(),
        });
        if (requestIdRef.current !== requestId) {
          return;
        }
        setResult(current => {
          if (!append || !current) {
            return next;
          }
          const existing = new Set(current.items.map(item => item.bvid));
          return {
            ...next,
            items: [
              ...current.items,
              ...next.items.filter(item => !existing.has(item.bvid)),
            ],
          };
        });
      } catch (error) {
        if (requestIdRef.current !== requestId || isAbortError(error)) {
          return;
        }
        const message = error instanceof Error ? error.message : '搜索失败';
        setRequestError(message);
        onNotice('error', message);
      } finally {
        if (requestIdRef.current === requestId) {
          requestIdRef.current = null;
        }
        loadingRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [activeQuery, cancelActiveRequest, getSearchOptions, onNotice],
  );

  useEffect(() => {
    setQuery(props.searchQuery);
    setActiveQuery(props.searchQuery.trim());
  }, [props.searchQuery]);

  useEffect(() => {
    if (!activeQuery) {
      setResult(null);
      cancelActiveRequest();
      return;
    }
    const timer = window.setTimeout(() => void loadPage(1, false), 80);
    return () => {
      window.clearTimeout(timer);
      cancelActiveRequest();
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    };
  }, [activeQuery, cancelActiveRequest, getSearchOptions, loadPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !result?.hasMore) {
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && !loadingRef.current) {
        void loadPage(result.page + 1, true);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadPage, result]);

  useEffect(
    () => () => {
      cancelActiveRequest();
    },
    [cancelActiveRequest],
  );

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setActiveQuery(query.trim());
  };

  const sortOptions = [
    '综合排序',
    '最多播放',
    '最新发布',
    '最多弹幕',
    '最多收藏',
  ];
  const dateOptions = ['全部日期', '最近一天', '最近一周', '最近半年'];

  return (
    <div className="prototype-content prototype-search-page">
      <form
        className="prototype-toolbar prototype-search-toolbar"
        onSubmit={submit}>
        <input
          aria-label="搜索音乐"
          className="prototype-search-field"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setQuery(event.target.value)
          }
          placeholder="搜索标题、艺术家、专辑"
          type="search"
          value={query}
        />
        <button
          className="prototype-button prototype-button-primary"
          type="submit">
          搜索
        </button>
        <button
          className="prototype-filter-more"
          onClick={() => setShowMoreFilters(current => !current)}
          type="button">
          更多筛选 <Icon name="chevron-down" size={14} />
        </button>
        <button
          aria-label={view === 'grid' ? '切换为列表视图' : '切换为网格视图'}
          className="prototype-button prototype-view-toggle"
          onClick={() => setView(current => (current === 'grid' ? 'list' : 'grid'))}
          title={view === 'grid' ? '切换为列表视图' : '切换为网格视图'}
          type="button">
          <Icon name={view === 'grid' ? 'list' : 'maximize'} size={16} />
        </button>
      </form>
      <section
        className={
          showMoreFilters
            ? 'prototype-search-filters is-open'
            : 'prototype-search-filters'
        }>
        <FilterRow label="排序">
          {sortOptions.map(item => (
            <button
              className={
                sort === item
                  ? 'prototype-filter-chip is-selected'
                  : 'prototype-filter-chip'
              }
              key={item}
              onClick={() => setSort(item)}
              type="button">
              {item}
            </button>
          ))}
        </FilterRow>
        <FilterRow label="日期">
          {dateOptions.map(item => (
            <button
              className={
                dateFilter === item
                  ? 'prototype-filter-chip is-selected'
                  : 'prototype-filter-chip'
              }
              key={item}
              onClick={() => setDateFilter(item)}
              type="button">
              {item}
            </button>
          ))}
          <label className="prototype-range-field">
            <span>开始日期</span>
            <input
              onChange={event => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
          </label>
          <span>至</span>
          <label className="prototype-range-field">
            <span>结束日期</span>
            <input
              onChange={event => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>
        </FilterRow>
        <FilterRow label="时长">
          <label className="prototype-duration-field">
            <span>最小时长（分钟）</span>
            <input
              min="0"
              onChange={event => setMinDuration(event.target.value)}
              placeholder="不限"
              type="number"
              value={minDuration}
            />
          </label>
          <span>至</span>
          <label className="prototype-duration-field">
            <span>最大时长（分钟）</span>
            <input
              min="0"
              onChange={event => setMaxDuration(event.target.value)}
              placeholder="不限"
              type="number"
              value={maxDuration}
            />
          </label>
        </FilterRow>
      </section>
      {requestError ? (
        <div className="prototype-error" role="alert">
          {requestError}
        </div>
      ) : null}
      <div
        className={
          view === 'list'
            ? 'prototype-result-grid is-list'
            : 'prototype-result-grid'
        }>
        {(result?.items ?? []).map((video, index) => (
          <TrackCard
            index={index + 1}
            key={video.bvid}
            onPlay={() => props.onPlayVideo(video)}
            onQueue={() => props.onAddVideo(video)}
            track={video}
          />
        ))}
      </div>
      <div className="prototype-search-sentinel" ref={sentinelRef} />
      {loadingMore ? (
        <div className="prototype-inline-loading" role="status">
          <span className="prototype-spinner" />
          正在加载更多…
        </div>
      ) : null}
      {!result?.items.length && !loading ? (
        <SearchEmptyState hasQuery={Boolean(activeQuery)} query={activeQuery} />
      ) : null}
      {loading && !result?.items.length ? (
        <div className="prototype-inline-loading" role="status">
          <span className="prototype-spinner" />
          正在搜索…
        </div>
      ) : null}
    </div>
  );
}

/** 搜索页的空状态，用图形和上下文文案区分未搜索与无结果。 */
function SearchEmptyState({
  hasQuery,
  query,
}: {
  hasQuery: boolean;
  query: string;
}): JSX.Element {
  return (
    <div className="prototype-search-empty" role="status">
      <svg aria-hidden="true" viewBox="0 0 160 96">
        <path d="M21 70h118" />
        <path d="M38 58V35l17-12 17 12v23M72 58V29l17-14 17 14v29M106 58V40l17-10 13 10v18" />
        <circle cx="77" cy="70" r="7" />
        <path d="m82 75 8 8" />
      </svg>
      <strong>{hasQuery ? `没有找到“${query}”` : '让声音先从一个关键词开始'}</strong>
      <span>
        {hasQuery
          ? '换个关键词，或放宽筛选条件试试。'
          : '输入歌名、UP 主或专辑名，开始探索 Bilibili。'}
      </span>
    </div>
  );
}

/** 渲染与 B 站一致的三行筛选控制。 */
function FilterRow({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}): JSX.Element {
  return (
    <div className="prototype-filter-line">
      <span className="prototype-filter-label">{label}</span>
      <div className="prototype-filter-options">{children}</div>
    </div>
  );
}

/** 音乐库页读取真实收藏夹，并提供导入范围与全局随机播放。 */
function DesignLibraryPage(props: PrototypePageProps): JSX.Element {
  const [folders, setFolders] = useState<FavoriteFolderSummary[]>([]);
  const [folderCovers, setFolderCovers] = useState<Record<number, string>>({});
  const [folderVideos, setFolderVideos] = useState<
    Record<number, DesktopVideo[]>
  >({});
  const [importedIds, setImportedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!props.auth.loggedIn || !props.auth.uid) {
      setFolders([]);
      setFolderCovers({});
      setFolderVideos({});
      setImportedIds([]);
      return;
    }
    const requestId = makeRequestId('favorite-folders');
    setLoading(true);
    void window.nyamiDesktop.content
      .getFavoriteFolders({requestId, uid: props.auth.uid})
      .then(async nextFolders => {
        const entries = await Promise.all(
          nextFolders.map(async folder => {
            try {
              const page = await window.nyamiDesktop.content.getFavoriteVideos({
                mediaId: folder.id,
                page: 1,
                requestId: makeRequestId(`favorite-videos-${folder.id}`),
                uid: props.auth.uid as string,
              });
              return [folder.id, page.items] as const;
            } catch {
              return [folder.id, []] as const;
            }
          }),
        );
        const videosByFolder = Object.fromEntries(entries) as Record<
          number,
          DesktopVideo[]
        >;
        const covers = Object.fromEntries(
          entries.map(([folderId, videos]) => {
            const latest = [...videos].sort(
              (left, right) => (right.favTime ?? 0) - (left.favTime ?? 0),
            )[0];
            return [folderId, latest?.cover || coverSummerUrl];
          }),
        ) as Record<number, string>;
        setFolders(nextFolders);
        setFolderVideos(videosByFolder);
        setFolderCovers(covers);
        const storageKey = `nyami-imported-folders-${props.auth.uid}`;
        let stored: number[] = [];
        try {
          stored = JSON.parse(
            window.localStorage.getItem(storageKey) ?? '[]',
          ) as number[];
        } catch {
          stored = [];
        }
        setImportedIds(
          stored.length
            ? stored.filter(id => nextFolders.some(folder => folder.id === id))
            : nextFolders.map(folder => folder.id),
        );
      })
      .catch(() => {
        setFolders([]);
        setFolderCovers({});
        setFolderVideos({});
      })
      .finally(() => setLoading(false));
    return () => {
      void window.nyamiDesktop.content.cancel({requestId});
    };
  }, [props.auth.loggedIn, props.auth.uid]);

  const toggleImportedFolder = (folderId: number): void => {
    const next = importedIds.includes(folderId)
      ? importedIds.filter(id => id !== folderId)
      : [...importedIds, folderId];
    setImportedIds(next);
    if (props.auth.uid) {
      try {
        window.localStorage.setItem(
          `nyami-imported-folders-${props.auth.uid}`,
          JSON.stringify(next),
        );
      } catch {
        // 仅持久化失败时保留本次会话选择。
      }
    }
  };

  const recentTracks = shuffleVideos(
    dedupeVideos(Object.values(folderVideos).flat()),
  )
    .sort((left, right) => (right.favTime ?? 0) - (left.favTime ?? 0))
    .slice(0, 8);
  const importedTracks = dedupeVideos(
    importedIds.flatMap(id => folderVideos[id] ?? []),
  );
  const folderCards = folders.map(folder => ({
    id: folder.id,
    title: folder.title,
    subtitle: 'Bilibili 收藏夹 · 已同步',
    count: folder.mediaCount,
    cover: folderCovers[folder.id] || coverSummerUrl,
  }));

  return (
    <div className="prototype-content">
      <section className="prototype-section prototype-library-section">
        <SectionHeading
          action={
            <div className="prototype-library-actions">
              <button
                className="prototype-button prototype-button-quiet"
                disabled={!folders.length}
                onClick={() => setImportOpen(true)}
                type="button">
                <Icon name="folder" size={15} />
                导入收藏夹
              </button>
              <button
                className="prototype-button prototype-button-primary"
                disabled={!importedTracks.length}
                onClick={() => props.onPlayVideos(importedTracks, true)}
                type="button">
                <Icon name="shuffle" size={15} />
                全局随机播放
              </button>
            </div>
          }
          title="你的收藏与合辑"
          note={loading ? 'SYNCING / BILIBILI' : 'SYNCED / LOCAL ARCHIVE'}
        />
        {loading && !folderCards.length ? (
          <div className="prototype-loading-panel" role="status">
            <span className="prototype-spinner" />
            正在读取你的收藏夹…
          </div>
        ) : null}
        {!loading && !folderCards.length ? (
          <div className="prototype-empty-state">
            {props.auth.loggedIn ? '还没有读取到收藏夹。' : '登录 Bilibili 后即可读取收藏夹。'}
          </div>
        ) : null}
        <div className="prototype-card-grid">
          {folderCards.map(folder => (
            <button
              className="prototype-card prototype-folder-card"
              key={`${folder.id}-${folder.title}`}
              onClick={() => {
                if (Number.isFinite(folder.id)) {
                  props.onSelectFolder(folder.id);
                  props.onRouteChange('folder-detail');
                }
              }}
              type="button">
              <div className="prototype-cover">
                <img alt={`${folder.title}封面`} src={folder.cover} />
              </div>
              <div className="prototype-card-body">
                <h3>{folder.title}</h3>
                <div className="prototype-card-meta">{folder.subtitle}</div>
                <div className="prototype-card-actions">
                  <span className="prototype-meta">{folder.count} 首</span>
                  <span aria-hidden="true">→</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
      {importOpen ? (
        <div
          className="prototype-modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setImportOpen(false);
            }
          }}>
          <section
            aria-label="导入收藏夹"
            aria-modal="true"
            className="prototype-import-modal"
            role="dialog">
            <div className="prototype-modal-head">
              <div>
                <span className="prototype-meta">PLAYLIST SOURCES</span>
                <h2>导入收藏夹</h2>
              </div>
              <button
                aria-label="关闭导入收藏夹"
                onClick={() => setImportOpen(false)}
                type="button">
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="prototype-import-grid">
              {folders.map(folder => (
                <label className="prototype-import-option" key={folder.id}>
                  <input
                    checked={importedIds.includes(folder.id)}
                    onChange={() => toggleImportedFolder(folder.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{folder.title}</strong>
                    <small>{folder.mediaCount.toLocaleString()} 首 · 已同步</small>
                  </span>
                </label>
              ))}
            </div>
            <button
              className="prototype-button prototype-button-primary"
              onClick={() => setImportOpen(false)}
              type="button">
              完成（{importedTracks.length} 首）
            </button>
          </section>
        </div>
      ) : null}
      <section className="prototype-section">
        <SectionHeading title="最近添加" note="LAST 30 DAYS" />
        <TrackList
          items={recentTracks}
          onPlay={props.onPlayVideo}
          currentTrackId={props.playback.trackId}
        />
      </section>
      {!props.auth.loggedIn ? (
        <button
          className="prototype-inline-link"
          onClick={props.onOpenLogin}
          type="button">
          登录 Bilibili 以读取真实收藏夹
        </button>
      ) : null}
    </div>
  );
}

/** 收藏夹详情页复用统一曲目列表和实际播放队列。 */
function FolderDetailPage(props: PrototypePageProps): JSX.Element {
  const {onNotice} = props;
  const [tracks, setTracks] = useState<DesktopVideo[]>([]);
  const [description, setDescription] = useState('');
  const [folderTitle, setFolderTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const folder = props.selectedFolderId;

  useEffect(() => {
    if (!folder || !props.auth.loggedIn || !props.auth.uid) {
      setTracks([]);
      setDescription('');
      setFolderTitle('');
      setHasMore(false);
      return;
    }
    let disposed = false;
    const requestId = makeRequestId(`folder-detail-${folder}`);
    setLoading(true);
    setPage(1);
    void Promise.all([
      window.nyamiDesktop.content.getFavoriteVideos({
        mediaId: folder,
        page: 1,
        requestId,
        uid: props.auth.uid,
      }),
      window.nyamiDesktop.content.getFavoriteFolders({
        requestId: makeRequestId(`folder-summary-${folder}`),
        uid: props.auth.uid,
      }),
    ])
      .then(([nextPage, summaries]) => {
        if (disposed) {
          return;
        }
        setTracks(nextPage.items);
        setDescription(nextPage.description ?? '');
        setHasMore(nextPage.hasMore);
        setFolderTitle(
          summaries.find(summary => summary.id === folder)?.title ?? '',
        );
      })
      .catch(error => {
        if (disposed || isAbortError(error)) {
          return;
        }
        const message =
          error instanceof Error ? error.message : '收藏夹读取失败';
        onNotice('error', message);
        setTracks([]);
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [folder, props.auth.loggedIn, props.auth.uid, onNotice]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !folder || !props.auth.uid || !hasMore) {
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting || loadingMore) {
        return;
      }
      const nextPage = page + 1;
      setLoadingMore(true);
      void window.nyamiDesktop.content
        .getFavoriteVideos({
          mediaId: folder,
          page: nextPage,
          requestId: makeRequestId(`folder-detail-${folder}`),
          uid: props.auth.uid as string,
        })
        .then(next => {
          setTracks(current => {
            const existing = new Set(current.map(item => item.bvid));
            return [
              ...current,
              ...next.items.filter(item => !existing.has(item.bvid)),
            ];
          });
          setPage(nextPage);
          setHasMore(next.hasMore);
        })
        .catch(error => {
          if (!isAbortError(error)) {
            onNotice(
              'error',
              error instanceof Error ? error.message : '收藏夹加载失败',
            );
          }
        })
        .finally(() => setLoadingMore(false));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [folder, hasMore, loadingMore, onNotice, page, props.auth.uid]);

  const cover = tracks[0]?.cover || coverSummerUrl;
  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
  return (
    <div className="prototype-content">
      <section className="prototype-detail-head">
        <div className="prototype-detail-cover">
          <img alt="收藏夹封面" src={cover} />
        </div>
        <div className="prototype-detail-copy">
          <div className="prototype-meta">COLLECTION / PUBLIC</div>
          <h2>{folderTitle || (folder ? `收藏夹 ${folder}` : '选择收藏夹')}</h2>
          <p>{description || '这里展示当前收藏夹中真实同步的视频内容。'}</p>
          <div className="prototype-actions">
            <button
              className="prototype-button prototype-button-primary"
              disabled={!tracks.length}
              onClick={() => props.onPlayVideos(tracks, false)}
              type="button">
              播放全部
            </button>
            <button
              className="prototype-button prototype-button-quiet"
              disabled={!tracks.length}
              onClick={() => props.onPlayVideos(tracks, true)}
              type="button">
              随机播放
            </button>
          </div>
        </div>
        <div className="prototype-stats">
          <div>
            <strong>{loading ? '…' : tracks.length}</strong>
            <span>TRACKS</span>
          </div>
          <div>
            <strong>{Math.round(totalDuration / 60)} min</strong>
            <span>LISTENING TIME</span>
          </div>
          <div>
            <strong>
              {tracks[0]
                ? formatYear(tracks[0].favTime ?? tracks[0].pubtime)
                : '—'}
            </strong>
            <span>UPDATED</span>
          </div>
        </div>
      </section>
      <TrackList
        items={tracks}
        onPlay={props.onPlayVideo}
        currentTrackId={props.playback.trackId}
      />
      <div className="prototype-search-sentinel" ref={sentinelRef} />
      {loadingMore ? (
        <div className="prototype-inline-loading">正在加载更多…</div>
      ) : null}
      {loading ? (
        <div className="prototype-loading-panel" role="status">
          <span className="prototype-spinner" />
          正在读取收藏夹内容…
        </div>
      ) : null}
      {!loading && !tracks.length ? (
        <div className="prototype-empty-state">没有读取到该收藏夹的视频。</div>
      ) : null}
    </div>
  );
}

/** 声音实验室采用真实桌面音频设置，同时保留原型的频谱布局。 */
function SoundLabPage(props: PrototypePageProps): JSX.Element {
  const audio = props.settings?.audio ?? DEFAULT_DESKTOP_AUDIO_SETTINGS;
  const gains =
    audio.graphicGains.length === EQ_FREQUENCIES.length
      ? audio.graphicGains
      : EQ_FREQUENCIES.map(() => 0);
  const updateAudio = (patch: Partial<DesktopAudioSettings>): void => {
    props.onUpdateSettings({audio: patch});
  };
  const changedBands = gains.filter(value => value !== 0).length;
  const professional = audio.mode === 'parametric';
  const applyPreset = (
    preset: (typeof DESKTOP_GRAPHIC_PRESETS)[number],
  ): void => {
    updateAudio({
      graphicPreset: preset.id,
      graphicGains: [...preset.gains],
      mode: 'graphic',
    });
  };
  return (
    <div className="prototype-content">
      <div className="prototype-toolbar prototype-lab-toolbar">
        <span className="prototype-meta">GRAPHIC EQ / PEQ / LIMITER</span>
        <div
          className="prototype-mode-switch"
          role="group"
          aria-label="EQ 版本">
          <button
            className={!professional ? 'is-active' : ''}
            onClick={() => updateAudio({mode: 'graphic'})}
            type="button">
            标准版
          </button>
          <button
            className={professional ? 'is-active' : ''}
            onClick={() => updateAudio({mode: 'parametric'})}
            type="button">
            专业版
          </button>
        </div>
        <button
          className="prototype-button prototype-button-quiet"
          onClick={() =>
            updateAudio({
              graphicGains: EQ_FREQUENCIES.map(() => 0),
              graphicPreset: 'flat',
            })
          }
          type="button">
          重置参数
        </button>
        <button
          className="prototype-button prototype-button-primary"
          onClick={() => props.onNotice('success', 'EQ 预设已保存到桌面设置')}
          type="button">
          保存预设
        </button>
      </div>
      <section className="prototype-lab-layout">
        <div className="prototype-chart-panel">
          <SectionHeading
            title="实时频谱"
            note={
              changedBands ? `${changedBands} BANDS / CUSTOM` : 'FLAT / 0.0 dB'
            }
          />
          <SpectrumGraph
            isPlaying={props.playback.state === 'playing' && audio.spectrumEnabled}
            values={props.spectrum}
          />
          {professional ? (
            <div className="prototype-peq-grid">
              {audio.peqBands.map((band, index) => (
                <div
                  className="prototype-peq-band"
                  key={`${band.frequency}-${index}`}>
                  <label className="prototype-peq-enabled">
                    <input
                      aria-label={`启用 PEQ ${index + 1}`}
                      checked={band.enabled}
                      onChange={event => {
                        const next = audio.peqBands.map((item, itemIndex) =>
                          itemIndex === index
                            ? {...item, enabled: event.target.checked}
                            : item,
                        );
                        updateAudio({peqBands: next});
                      }}
                      type="checkbox"
                    />
                    <span>PEQ {index + 1}</span>
                  </label>
                  <label>
                    <span>滤波器类型</span>
                    <select
                      aria-label={`PEQ ${index + 1} 滤波器类型`}
                      onChange={event => {
                        const next = audio.peqBands.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                type: event.target
                                  .value as DesktopPeqFilterType,
                              }
                            : item,
                        );
                        updateAudio({peqBands: next});
                      }}
                      value={band.type}>
                      <option value="Peak">峰值 · Peak</option>
                      <option value="LowShelf">低频搁架</option>
                      <option value="HighShelf">高频搁架</option>
                      <option value="LowPass">低通</option>
                      <option value="HighPass">高通</option>
                      <option value="Notch">陷波</option>
                      <option value="BandPass">带通</option>
                    </select>
                  </label>
                  <label>
                    <span>频率</span>
                    <input
                      aria-label={`PEQ ${index + 1} 频率`}
                      max="20000"
                      min="20"
                      onChange={event => {
                        const next = audio.peqBands.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, frequency: Number(event.target.value) }
                            : item,
                        );
                        updateAudio({peqBands: next});
                      }}
                      type="number"
                      value={band.frequency}
                    />
                  </label>
                  <label>
                    <span>增益</span>
                    <input
                      aria-label={`PEQ ${index + 1} 增益`}
                      max="18"
                      min="-18"
                      onChange={event => {
                        const next = audio.peqBands.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, gain: Number(event.target.value) }
                            : item,
                        );
                        updateAudio({peqBands: next});
                      }}
                      step="0.5"
                      type="number"
                      value={band.gain}
                    />
                  </label>
                  <label>
                    <span>Q</span>
                    <input
                      aria-label={`PEQ ${index + 1} Q 值`}
                      max="20"
                      min="0.1"
                      onChange={event => {
                        const next = audio.peqBands.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, q: Number(event.target.value) }
                            : item,
                        );
                        updateAudio({peqBands: next});
                      }}
                      step="0.1"
                      type="number"
                      value={band.q}
                    />
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <div className="prototype-eq-grid">
              {EQ_FREQUENCIES.map((frequency, index) => (
                <label className="prototype-eq-band" key={frequency}>
                  <input
                    aria-label={`${frequency} Hz 增益`}
                    max="12"
                    min="-12"
                    onChange={event => {
                      const next = [...gains];
                      next[index] = Number(event.target.value);
                      updateAudio({
                        graphicPreset: 'custom',
                        graphicGains: next,
                      });
                    }}
                    step="0.5"
                    type="range"
                    value={gains[index]}
                  />
                  <output>{formatGain(gains[index])}</output>
                  <span>
                    {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="prototype-preset-list">
            <span className="prototype-meta">ANDROID PRESETS</span>
            <div>
              {DESKTOP_GRAPHIC_PRESETS.map(preset => (
                <div className="prototype-preset-item" key={preset.id}>
                  <button
                    className={
                      audio.graphicPreset === preset.id ? 'is-active' : ''
                    }
                    onClick={() => applyPreset(preset)}
                    type="button">
                    {preset.label}
                  </button>
                  <small>{preset.description}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="prototype-control-panel">
          <h3>动态控制</h3>
          <SettingSwitch
            checked={audio.limiterEnabled}
            label="Limiter"
            onChange={value => updateAudio({limiterEnabled: value})}
            subtitle="峰值保护"
          />
          <SettingSwitch
            checked={audio.mode === 'parametric'}
            label="PEQ"
            onChange={value =>
              updateAudio({mode: value ? 'parametric' : 'graphic'})
            }
            subtitle="参数均衡"
          />
          <SettingSwitch
            checked={audio.spectrumEnabled}
            label="实时频谱"
            onChange={value => updateAudio({spectrumEnabled: value})}
            subtitle="视觉反馈"
          />
          <label className="prototype-setting-row">
            <span>
              <strong>输出增益</strong>
              <small>安全范围 -6 dB</small>
            </span>
            <input
              aria-label="输出增益"
              max="6"
              min="-6"
              type="range"
              defaultValue="0"
            />
          </label>
        </aside>
      </section>
    </div>
  );
}

/** 渲染窗口版沉浸式播放器，并支持 ESC 返回音乐库。 */
export function PrototypeImmersivePage(props: PrototypePageProps): JSX.Element {
  const {onNext, onPause, onPlay, onPrevious, onRouteChange, playback} = props;
  const [queueOpen, setQueueOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [coverPalette, setCoverPalette] = useState<ImmersivePalette>(
    IMMERSIVE_PALETTES[0],
  );
  const fallback = toDesktopVideo(MOCK_TRACKS[0]);
  const track = props.playback.trackId
    ? {
        bvid: props.playback.trackId,
        title: props.playback.trackTitle ?? fallback.title,
        author: props.playback.trackArtist ?? fallback.author,
        cover: props.playback.artwork ?? fallback.cover,
        duration: props.playback.duration || fallback.duration,
        pubtime: fallback.pubtime,
        authorId: fallback.authorId,
        tags: fallback.tags,
      }
    : fallback;
  const palette = [
    coverPalette[paletteIndex % coverPalette.length],
    coverPalette[(paletteIndex + 1) % coverPalette.length],
    coverPalette[(paletteIndex + 2) % coverPalette.length],
  ] as const;
  const immersiveStyle = {
    '--immersive-a': palette[0],
    '--immersive-b': palette[1],
    '--immersive-c': palette[2],
    '--immersive-text': getReadableTextColor(palette[1]),
    '--immersive-muted': getReadableMutedColor(palette[1]),
    '--immersive-control-bg':
      getReadableTextColor(palette[1]) === '#fffaf4'
        ? 'rgba(31, 18, 27, 0.72)'
        : 'rgba(255, 255, 255, 0.72)',
    '--immersive-control-border':
      getReadableTextColor(palette[1]) === '#fffaf4'
        ? 'rgba(255, 255, 255, 0.3)'
        : 'rgba(47, 37, 30, 0.24)',
    backgroundImage: `linear-gradient(120deg, ${palette[0]}e8, ${palette[1]}dd 52%, ${palette[2]}e8), url(${track.cover})`,
  } as CSSProperties;

  /** 退出沉浸式播放器并返回音乐库。 */
  const exitImmersive = useCallback((): void => {
    onRouteChange('library');
  }, [onRouteChange]);

  useEffect(() => {
    setQueueOpen(false);
    setPaletteIndex(0);
  }, [track.bvid]);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) {
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 18;
        canvas.height = 18;
        const context = canvas.getContext('2d');
        if (!context) {
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const regions = [
          [0, 6],
          [6, 12],
          [12, 18],
        ] as const;
        const colors = regions.map(([start, end]) => {
          let red = 0;
          let green = 0;
          let blue = 0;
          let count = 0;
          for (let y = 0; y < canvas.height; y += 1) {
            for (let x = start; x < end; x += 1) {
              const offset = (y * canvas.width + x) * 4;
              const alpha = pixels[offset + 3] / 255;
              red += pixels[offset] * alpha;
              green += pixels[offset + 1] * alpha;
              blue += pixels[offset + 2] * alpha;
              count += alpha;
            }
          }
          return toPaletteHex(
            count ? [red / count, green / count, blue / count] : [40, 24, 36],
          );
        });
        setCoverPalette([colors[0], colors[1], colors[2]]);
      } catch {
        setCoverPalette(IMMERSIVE_PALETTES[0]);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setCoverPalette(IMMERSIVE_PALETTES[0]);
      }
    };
    image.src = track.cover;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [track.cover]);

  useEffect(() => {
    const timer = window.setInterval(
      () => {
        setPaletteIndex(index => index + 1);
      },
      playback.state === 'playing' ? 4200 : 9000,
    );
    return () => window.clearInterval(timer);
  }, [playback.state]);

  useEffect(() => {
    /** 沉浸式快捷键：ESC 返回音乐库、空格播放、左右键切歌。 */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        exitImmersive();
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        playback.state === 'playing' ? onPause() : onPlay();
      }
      if (event.key === 'ArrowLeft') {
        onPrevious();
      }
      if (event.key === 'ArrowRight') {
        onNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exitImmersive, onNext, onPause, onPlay, onPrevious, playback.state]);

  const sleepValue = props.playback.sleepTimerSeconds ? 'active' : '';

  return (
    <div
      className="prototype-immersive prototype-immersive-windowed"
      style={immersiveStyle}>
      <div className="prototype-immersive-backdrop" />
      <header className="prototype-immersive-heading">
        <div>
          <span className="prototype-meta">NYAMI / WINDOWED IMMERSIVE</span>
          <strong>{track.author}</strong>
          <span>{track.title}</span>
        </div>
        <div className="prototype-immersive-heading-actions">
          <button aria-label="返回音乐库" onClick={exitImmersive} type="button">
            <Icon name="arrow-left" size={17} />
          </button>
          <button
            aria-expanded={queueOpen}
            aria-label="打开播放列表"
            onClick={() => setQueueOpen(true)}
            type="button">
            <Icon name="list" size={17} />
          </button>
        </div>
      </header>
      <main className="prototype-immersive-main">
        <section className="prototype-immersive-art-stage">
          <div className="prototype-ambient-orbit" />
          <div className="prototype-immersive-art-frame">
            <img alt={`${track.title}封面`} src={track.cover} />
          </div>
          <span className="prototype-art-caption">
            {formatYear(track.pubtime)} / NYAMI ARCHIVE
          </span>
        </section>
        <section className="prototype-immersive-detail">
          <span className="prototype-meta">
            NOW PLAYING / {track.tags[0] ?? 'ARCHIVE'}
          </span>
          <div className="prototype-immersive-title-nav">
            <button
              aria-label="上一首"
              onClick={props.onPrevious}
              type="button">
              <Icon name="arrow-left" size={17} />
            </button>
            <h1 title={track.title}>{track.title}</h1>
            <button aria-label="下一首" onClick={props.onNext} type="button">
              <Icon name="arrow-right" size={17} />
            </button>
          </div>
          <p>{track.author} · NYAMI ARCHIVE</p>
          <div className="prototype-immersive-detail-meta">
            <span>{formatDuration(props.playback.position)}</span>
            <span>{formatDuration(track.duration)}</span>
          </div>
        </section>
      </main>
      <div className="prototype-floating-player">
        <button aria-label="上一首" onClick={props.onPrevious} type="button">
          <Icon name="arrow-left" size={17} />
        </button>
        <button
          aria-label={props.playback.state === 'playing' ? '暂停' : '播放'}
          className="prototype-floating-play"
          onClick={
            props.playback.state === 'playing' ? props.onPause : props.onPlay
          }
          type="button">
          <Icon
            name={props.playback.state === 'playing' ? 'pause' : 'play'}
            size={19}
          />
        </button>
        <button aria-label="下一首" onClick={props.onNext} type="button">
          <Icon name="arrow-right" size={17} />
        </button>
        <div className="prototype-floating-track">
          <strong title={track.title}>{track.title}</strong>
          <input
            aria-label="浮动播放器进度"
            max={track.duration}
            min="0"
            onChange={event => props.onSeek(Number(event.target.value))}
            type="range"
            value={Math.min(track.duration, props.playback.position)}
          />
        </div>
        <button
          aria-label="切换播放模式"
          aria-pressed={playback.mode === 'shuffle'}
          onClick={() =>
            props.onModeChange(
              playback.mode === 'shuffle' ? 'sequential' : 'shuffle',
            )
          }
          type="button">
          <Icon name="shuffle" size={16} />
        </button>
        <button
          aria-label="打开播放列表"
          onClick={() => setQueueOpen(true)}
          type="button">
          <Icon name="list" size={16} />
        </button>
        <label className="prototype-floating-sleep">
          <Icon name="moon" size={14} />
          <select
            aria-label="睡眠定时器"
            onChange={event => {
              const value = event.target.value;
              props.onSleepTimer(
                value === 'active' ? null : value ? Number(value) : null,
              );
            }}
            value={sleepValue}>
            <option value="">睡眠</option>
            <option value="900">15 分钟</option>
            <option value="1800">30 分钟</option>
            <option value="3600">60 分钟</option>
            {sleepValue === 'active' ? (
              <option value="active">
                剩余 {props.playback.sleepTimerSeconds} 秒
              </option>
            ) : null}
          </select>
        </label>
      </div>
      {queueOpen ? (
        <PrototypeQueueDrawer
          onClose={() => setQueueOpen(false)}
          onRemoveTrack={props.onRemoveTrack}
          onSelectTrack={props.onSelectTrack}
          playback={props.playback}
        />
      ) : null}
    </div>
  );
}

type ImmersivePalette = readonly [string, string, string];

const IMMERSIVE_PALETTES: ReadonlyArray<ImmersivePalette> = [
  ['#2b1421', '#6d263d', '#df715c'],
  ['#17243b', '#315b77', '#d48667'],
  ['#241b38', '#82536d', '#e3a778'],
  ['#1e2f2a', '#4b745e', '#d4a26b'],
];

/** 将封面采样出的 RGB 平均色转换为背景可用的 HEX 色值。 */
function toPaletteHex(rgb: readonly [number, number, number]): string {
  return `#${rgb
    .map(value => Math.max(0, Math.min(255, Math.round(value))))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** 根据封面主色选择可读的浅色或深色文字。 */
function getReadableTextColor(hex: string): string {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.58
    ? '#2f251e'
    : '#fffaf4';
}

/** 生成与主文字同方向的低对比度辅助色。 */
function getReadableMutedColor(hex: string): string {
  return getReadableTextColor(hex) === '#fffaf4'
    ? 'rgba(255, 250, 244, 0.66)'
    : 'rgba(47, 37, 30, 0.66)';
}

/** 将现有播放器队列绘制为沉浸式页面可复用的侧栏抽屉。 */
export function PrototypeQueueDrawer({
  onClose,
  onRemoveTrack,
  onSelectTrack,
  playback,
}: {
  onClose?: () => void;
  onRemoveTrack: (trackId: string) => void;
  onSelectTrack: (trackId: string) => void;
  playback: PlaybackSnapshot;
}): JSX.Element {
  return (
    <div
      className="prototype-queue-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}>
      <aside className="prototype-queue-drawer">
        <div className="prototype-queue-head">
          <div>
            <div className="prototype-meta">NOW / QUEUE</div>
            <h2>播放队列</h2>
          </div>
          <div className="prototype-queue-head-actions">
            <span>{playback.queueLength} 首</span>
            {onClose ? (
              <button aria-label="关闭播放队列" onClick={onClose} type="button">
                <Icon name="x" size={15} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="prototype-queue-list">
          {playback.queue.map((item, index) => (
            <div
              className={
                item.id === playback.trackId
                  ? 'prototype-queue-item is-current'
                  : 'prototype-queue-item'
              }
              key={item.id}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <button onClick={() => onSelectTrack(item.id)} type="button">
                <strong>{item.title}</strong>
                <small>{item.artist}</small>
              </button>
              <button
                aria-label={`移除 ${item.title}`}
                onClick={() => onRemoveTrack(item.id)}
                type="button">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          {!playback.queue.length ? (
            <div className="prototype-empty-state">队列为空</div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function SectionHeading({
  action,
  title,
  note,
}: {
  action?: React.ReactNode;
  title: string;
  note: string;
}): JSX.Element {
  return (
    <div className="prototype-section-head">
      <h2>{title}</h2>
      <div className="prototype-section-head-meta">
        <span>{note}</span>
        {action}
      </div>
    </div>
  );
}

function TrackCard({
  index,
  onPlay,
  onQueue,
  track,
}: {
  index: number;
  onPlay: () => void;
  onQueue: () => void;
  track: DesktopVideo;
}): JSX.Element {
  return (
    <article className="prototype-card">
      <div className="prototype-cover">
        <img alt={`${track.title}封面`} src={track.cover || coverSummerUrl} />
        <span className="prototype-card-index">
          {formatYear(track.pubtime)} / {track.tags[0] ?? 'Archive'}
        </span>
      </div>
      <div className="prototype-card-body">
        <h3>{track.title}</h3>
        <div className="prototype-card-meta">
          {track.author} · {track.tags[0] ?? 'Music'}
        </div>
        <div className="prototype-card-actions">
          <button
            aria-label={`播放 ${track.title}`}
            onClick={onPlay}
            type="button">
            <Icon name="play" size={14} />
          </button>
          <button
            aria-label={`加入 ${track.title} 到队列`}
            onClick={onQueue}
            type="button">
            <Icon name="plus" size={14} />
          </button>
          <span className="prototype-meta">
            {formatDuration(track.duration)}
          </span>
        </div>
      </div>
      <span className="sr-only">第 {index} 首</span>
    </article>
  );
}

function TrackList({
  currentTrackId,
  items,
  onPlay,
}: {
  currentTrackId: string | null;
  items: DesktopVideo[];
  onPlay: (video: DesktopVideo) => void;
}): JSX.Element {
  return (
    <div className="prototype-track-list">
      {items.map((track, index) => (
        <div
          className={
            track.bvid === currentTrackId
              ? 'prototype-track-row is-current'
              : 'prototype-track-row'
          }
          key={track.bvid}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <strong>{track.title}</strong>
            <small>
              {track.author} · {track.tags[0] ?? 'Music'}
            </small>
          </div>
          <span>{track.tags[0] ?? 'Archive'}</span>
          <span>{formatDuration(track.duration)}</span>
          <button
            aria-label={`播放 ${track.title}`}
            onClick={() => onPlay(track)}
            type="button">
            <Icon name="play" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SettingSwitch({
  checked,
  label,
  onChange,
  subtitle,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
  subtitle: string;
}): JSX.Element {
  return (
    <div className="prototype-setting-row">
      <span>
        <strong>{label}</strong>
        <small>{subtitle}</small>
      </span>
      <button
        aria-pressed={checked}
        className={checked ? 'prototype-switch is-on' : 'prototype-switch'}
        onClick={() => onChange(!checked)}
        type="button"
      />
    </div>
  );
}

/** 按视频 ID 去重，保证今日精选和近期播放不会重复渲染。 */
function dedupeVideos(videos: DesktopVideo[]): DesktopVideo[] {
  const seen = new Set<string>();
  return videos.filter(video => {
    if (seen.has(video.bvid)) {
      return false;
    }
    seen.add(video.bvid);
    return true;
  });
}

/** 复制并随机打散候选视频，避免刷新时始终保持同一顺序。 */
function shuffleVideos(videos: DesktopVideo[]): DesktopVideo[] {
  const next = [...videos];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function SpectrumGraph({
  isPlaying,
  values,
}: {
  isPlaying: boolean;
  values: number[];
}): JSX.Element {
  const points = isPlaying && values.length
    ? values
        .slice(0, 12)
        .map((value, index) => `${index * 60},${180 - Math.round(value * 120)}`)
        .join(' ')
    : '0,100 720,100';
  return (
    <svg
      aria-label="实时频谱曲线"
      className="prototype-spectrum"
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 720 220">
      <g stroke="var(--prototype-line)" strokeWidth="1">
        <line x1="0" x2="720" y1="40" y2="40" />
        <line x1="0" x2="720" y1="100" y2="100" />
        <line x1="0" x2="720" y1="160" y2="160" />
      </g>
      <polyline
        fill="none"
        points={points}
        stroke="var(--prototype-accent)"
        strokeWidth="3"
      />
    </svg>
  );
}

function toDesktopVideo(track: PrototypeTrack): DesktopVideo {
  return {
    aid: Number(track.id.replace(/\D/g, '').slice(0, 8)) || undefined,
    author: track.artist,
    authorId: 0,
    bvid: track.id,
    cover: track.cover,
    duration: track.duration,
    pubtime: new Date(`${track.year}-08-18T00:00:00Z`).getTime() / 1000,
    tags: [track.genre],
    title: track.title,
    source: 'popular',
  };
}

function formatDuration(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(
    safe % 60,
  ).padStart(2, '0')}`;
}

/** 格式化 EQ 增益，始终显示方向和一位小数。 */
function formatGain(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
}

function formatYear(value: number): string {
  if (!value) {
    return '2024.08.18';
  }
  return new Date(value * 1000).toISOString().slice(0, 10).replaceAll('-', '.');
}

function makeRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 判断内容请求是否因页面切换或刷新而主动取消。 */
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error && error.message.includes('请求已取消'))
  );
}
