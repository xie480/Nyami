import React, {useCallback, useEffect, useMemo, useState} from 'react';
import type {ChangeEvent, CSSProperties, FormEvent} from 'react';
import {Icon} from './icons';
import type {
  AuthStatus,
  DesktopAudioSettings,
  DesktopPage,
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopVideo,
  FavoriteFolderSummary,
  HomeSnapshot,
  PlaybackSnapshot,
  UserProfile,
} from '../shared/types';
import {
  DEFAULT_DESKTOP_AUDIO_SETTINGS,
  DESKTOP_GRAPHIC_PRESETS,
  GRAPHIC_BAND_FREQUENCIES,
} from './audio/eqPresets';
import {loadDesktopUserPreferences} from './preferences';
import coverBlueUrl from './assets/cover-blue.png';
import coverForestUrl from './assets/cover-forest.png';
import coverNightUrl from './assets/cover-night.png';
import coverPinkUrl from './assets/cover-pink.png';
import coverPortraitUrl from './assets/cover-portrait.png';
import coverSummerUrl from './assets/cover-summer.png';

/** PC 端设计稿对应的路由集合，沉浸式页面不参与普通导航。 */
export type PrototypeRoute =
  | 'discover'
  | 'search'
  | 'library'
  | 'folder-detail'
  | 'taste'
  | 'sound-lab'
  | 'settings'
  | 'immersive-windowed'
  | 'immersive-fullscreen';

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

const MOCK_FOLDERS = [
  {
    id: 'archive',
    title: '收藏夹',
    subtitle: '最近标记的声音',
    count: 12,
    cover: coverSummerUrl,
  },
  {
    id: 'night-work',
    title: '夜间工作',
    subtitle: '低亮度、慢拍、长线条',
    count: 8,
    cover: coverNightUrl,
  },
  {
    id: 'rainy-days',
    title: '雨天档案',
    subtitle: '透明的环境与人声',
    count: 16,
    cover: coverPinkUrl,
  },
];

const EQ_FREQUENCIES = [...GRAPHIC_BAND_FREQUENCIES];

/** 渲染设计稿对应的普通页面内容。 */
export function PrototypePage(props: PrototypePageProps): JSX.Element {
  switch (props.route) {
    case 'discover':
      return <DiscoverPage {...props} />;
    case 'search':
      return <DesignSearchPage {...props} />;
    case 'library':
      return <DesignLibraryPage {...props} />;
    case 'folder-detail':
      return <FolderDetailPage {...props} />;
    case 'taste':
      return <TastePage {...props} />;
    case 'sound-lab':
      return <SoundLabPage {...props} />;
    case 'settings':
      return <div className="prototype-empty-page" />;
    case 'immersive-windowed':
    case 'immersive-fullscreen':
      return <PrototypeImmersivePage {...props} />;
    default:
      return <DiscoverPage {...props} />;
  }
}

/** 发现页优先读取真实热门内容，网络不可用时保持可预览的设计稿数据。 */
function DiscoverPage(props: PrototypePageProps): JSX.Element {
  const [home, setHome] = useState<HomeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [curated, setCurated] = useState<DesktopVideo[]>([]);
  const [recentTracks, setRecentTracks] = useState<DesktopVideo[]>([]);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    let disposed = false;
    const requestId = makeRequestId('home');
    setLoading(true);
    void window.nyamiDesktop.content
      .getHome({requestId})
      .then(result => {
        if (!disposed) {
          setHome(result);
        }
      })
      .catch(() => {
        if (!disposed) {
          setHome(null);
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      void window.nyamiDesktop.content.cancel({requestId});
    };
  }, []);

  const collectionItems = useMemo(() => {
    const source = [...(home?.featured ?? []), ...(home?.popular ?? [])];
    const fallback = MOCK_TRACKS.map(toDesktopVideo);
    const videos = source.length ? source : fallback;
    return Array.from(
      {length: Math.max(1, Math.ceil(videos.length / 4))},
      (_, index) => {
        const items = videos.slice(index * 4, index * 4 + 4);
        return {
          id: `recommended-collection-${index + 1}`,
          title:
            index === 0
              ? '本周推荐合辑'
              : `推荐收藏 · ${String(index + 1).padStart(2, '0')}`,
          subtitle:
            index === 0 ? '根据近期播放与热门内容整理' : '来自 NYAMI 推荐档案',
          cover: items[0]?.cover || coverSummerUrl,
          items,
        };
      },
    );
  }, [home]);

  const featureCollection = collectionItems[0];

  useEffect(() => {
    const source = collectionItems.flatMap(collection => collection.items);
    const pool = dedupeVideos([...source, ...MOCK_TRACKS.map(toDesktopVideo)]);
    const preferences = loadDesktopUserPreferences();
    const blockedTags = preferences.recommendationTagBlacklist.map(tag =>
      tag.toLocaleLowerCase(),
    );
    const durationLimit = preferences.recommendationDurationFilterEnabled
      ? preferences.recommendationDurationLimitMinutes * 60
      : null;
    const eligible = pool.filter(video => {
      const matchesBlockedTag = video.tags.some(tag =>
        blockedTags.includes(tag.toLocaleLowerCase()),
      );
      const matchesDuration =
        durationLimit === null || video.duration <= durationLimit;
      return !matchesBlockedTag && matchesDuration;
    });
    let favoredTags: string[] = [];
    try {
      const raw = window.localStorage.getItem('nyami-preferred-tags');
      favoredTags = raw
        ? (JSON.parse(raw) as string[]).map(tag => tag.toLocaleLowerCase())
        : [];
    } catch {
      favoredTags = [];
    }
    const favored = eligible.filter(video =>
      video.tags.some(tag => favoredTags.includes(tag.toLocaleLowerCase())),
    );
    const others = eligible.filter(video => !favored.includes(video));
    const storageKey = `nyami-home-curated-${new Date()
      .toISOString()
      .slice(0, 10)}`;
    let seen: string[] = [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      seen = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      seen = [];
    }
    const fresh = shuffleVideos(favored)
      .concat(shuffleVideos(others))
      .filter(video => !seen.includes(video.bvid))
      .slice(0, 8);
    const nextSeen = Array.from(
      new Set([...seen, ...fresh.map(video => video.bvid)]),
    );
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextSeen));
    } catch {
      // 本地存储不可用时仍允许刷新当前页面内容。
    }
    setCurated(fresh);
  }, [collectionItems, refreshSeed]);

  useEffect(() => {
    let next: DesktopVideo[] = [];
    try {
      const raw = window.localStorage.getItem('nyami-recent-played');
      next = raw ? (JSON.parse(raw) as DesktopVideo[]) : [];
    } catch {
      next = [];
    }
    const fallback = collectionItems.flatMap(collection => collection.items);
    setRecentTracks(
      shuffleVideos(dedupeVideos([...next, ...fallback])).slice(0, 5),
    );
  }, [collectionItems]);

  useEffect(() => {
    try {
      setSubscribed(
        window.localStorage.getItem('nyami-subscription-recommended') === '1',
      );
    } catch {
      setSubscribed(false);
    }
  }, []);

  const toggleSubscription = (): void => {
    const next = !subscribed;
    setSubscribed(next);
    try {
      window.localStorage.setItem(
        'nyami-subscription-recommended',
        next ? '1' : '0',
      );
    } catch {
      // 订阅状态只影响当前界面时也保持可用。
    }
  };

  return (
    <div className="prototype-content">
      <section className="prototype-hero">
        <div className="prototype-hero-art">
          <img
            alt={`${featureCollection.title}封面`}
            src={featureCollection.cover}
          />
          <span>{featureCollection.title}</span>
        </div>
        <div className="prototype-hero-copy">
          <button
            aria-label="查看更多推荐合集"
            className="prototype-hero-more"
            onClick={() => setCollectionsOpen(true)}
            type="button">
            查看更多
            <Icon name="arrow-right" size={14} />
          </button>
          <div className="prototype-meta">
            RECOMMENDED COLLECTION / {featureCollection.items.length} VIDEOS
          </div>
          <h2>{featureCollection.title}</h2>
          <p>
            {featureCollection.subtitle}
            。把值得反复聆听的视频整理成一张持续更新的合辑。
          </p>
          <div className="prototype-actions">
            <button
              className="prototype-button prototype-button-primary"
              onClick={() => props.onPlayVideo(featureCollection.items[0])}
              type="button">
              {props.playback.trackId === featureCollection.items[0]?.bvid
                ? '继续播放'
                : '开始播放'}
            </button>
            <button
              className="prototype-button prototype-button-quiet"
              onClick={() => setCollectionsOpen(true)}
              type="button">
              查看合集
            </button>
            <button
              className={
                subscribed
                  ? 'prototype-button prototype-button-subscribed'
                  : 'prototype-button prototype-button-quiet'
              }
              onClick={toggleSubscription}
              type="button">
              {subscribed ? '已订阅' : '订阅'}
            </button>
          </div>
          {loading ? (
            <span className="prototype-loading">同步热门内容…</span>
          ) : null}
        </div>
      </section>
      {collectionsOpen ? (
        <section className="prototype-collection-list">
          <SectionHeading title="推荐合集" note="ALL RECOMMENDED COLLECTIONS" />
          <div className="prototype-collection-grid">
            {collectionItems.map(collection => (
              <button
                className="prototype-collection-item"
                key={collection.id}
                onClick={() => props.onPlayVideo(collection.items[0])}
                type="button">
                <img alt="" src={collection.cover} />
                <span>
                  <strong>{collection.title}</strong>
                  <small>
                    {collection.items.length} 个视频 · {collection.subtitle}
                  </small>
                </span>
                <Icon name="play" size={15} />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="prototype-section">
        <SectionHeading
          action={
            <button
              aria-label="刷新今日精选"
              className="prototype-icon-action"
              onClick={() => setRefreshSeed(seed => seed + 1)}
              title="刷新今日精选"
              type="button">
              <Icon name="refresh" size={15} />
              刷新
            </button>
          }
          title="今日精选"
          note={`CURATED / ${String(curated.length).padStart(2, '0')} RECORDS`}
        />
        <div className="prototype-card-grid">
          {curated.map((video, index) => (
            <TrackCard
              index={index + 1}
              key={video.bvid}
              onPlay={() => props.onPlayVideo(video)}
              onQueue={() => props.onAddVideo(video)}
              track={video}
            />
          ))}
        </div>
      </section>
      <section className="prototype-section">
        <SectionHeading title="继续聆听" note="FROM YOUR ARCHIVE" />
        <TrackList
          items={recentTracks}
          onPlay={props.onPlayVideo}
          currentTrackId={props.playback.trackId}
        />
      </section>
    </div>
  );
}

/** 设计稿搜索页，回车后立即请求真实 Bilibili 搜索结果并应用筛选。 */
function DesignSearchPage(props: PrototypePageProps): JSX.Element {
  const {onNotice} = props;
  const [query, setQuery] = useState(props.searchQuery);
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
  const [requestError, setRequestError] = useState('');

  const executeSearch = useCallback(
    (value: string): void => {
      const normalized = value.trim();
      setQuery(value);
      if (!normalized) {
        setResult(null);
        setRequestError('');
        return;
      }
      const requestId = makeRequestId('search');
      setLoading(true);
      setRequestError('');
      void window.nyamiDesktop.content
        .search({keyword: normalized, page: 1, requestId})
        .then(next => setResult(next))
        .catch(error => {
          const message = error instanceof Error ? error.message : '搜索失败';
          setRequestError(message);
          onNotice('error', message);
        })
        .finally(() => setLoading(false));
    },
    [onNotice],
  );

  useEffect(() => {
    setQuery(props.searchQuery);
    if (props.searchQuery.trim()) {
      executeSearch(props.searchQuery);
    } else {
      setResult(null);
    }
  }, [executeSearch, props.searchQuery]);

  const displayItems = useMemo(() => {
    if (!query.trim()) {
      return [];
    }
    const today = Date.now() / 1000;
    const dateStart = startDate
      ? new Date(`${startDate}T00:00:00`).getTime() / 1000
      : null;
    const dateEnd = endDate
      ? new Date(`${endDate}T23:59:59`).getTime() / 1000
      : null;
    const dateOffset =
      dateFilter === '最近一天'
        ? 86400
        : dateFilter === '最近一周'
        ? 86400 * 7
        : dateFilter === '最近半年'
        ? 86400 * 183
        : null;
    const minSeconds = minDuration
      ? Math.max(0, Number(minDuration) * 60)
      : null;
    const maxSeconds = maxDuration
      ? Math.max(0, Number(maxDuration) * 60)
      : null;
    const filtered = (result?.items ?? []).filter(item => {
      const inDateRange = dateStart === null || item.pubtime >= dateStart;
      const beforeDate = dateEnd === null || item.pubtime <= dateEnd;
      const inShortcut =
        dateOffset === null || item.pubtime >= today - dateOffset;
      const aboveMinimum = minSeconds === null || item.duration >= minSeconds;
      const belowMaximum = maxSeconds === null || item.duration <= maxSeconds;
      return (
        inDateRange && beforeDate && inShortcut && aboveMinimum && belowMaximum
      );
    });
    return [...filtered].sort((left, right) => {
      if (sort === '最新发布') {
        return right.pubtime - left.pubtime;
      }
      if (sort === '标题') {
        return left.title.localeCompare(right.title);
      }
      return 0;
    });
  }, [
    dateFilter,
    endDate,
    maxDuration,
    minDuration,
    query,
    result,
    sort,
    startDate,
  ]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    executeSearch(query);
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
          className={
            view === 'grid'
              ? 'prototype-button prototype-button-selected'
              : 'prototype-button prototype-button-quiet'
          }
          onClick={() => setView('grid')}
          type="button">
          网格
        </button>
        <button
          className={
            view === 'list'
              ? 'prototype-button prototype-button-selected'
              : 'prototype-button prototype-button-quiet'
          }
          onClick={() => setView('list')}
          type="button">
          列表
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
      <div className="prototype-toolbar prototype-filter-toolbar">
        <span className="prototype-results-count">
          {loading ? 'LOADING…' : `${displayItems.length} RESULTS`}
        </span>
      </div>
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
        {displayItems.map((video, index) => (
          <TrackCard
            index={index + 1}
            key={video.bvid}
            onPlay={() => props.onPlayVideo(video)}
            onQueue={() => props.onAddVideo(video)}
            track={video}
          />
        ))}
      </div>
      {!displayItems.length && !loading ? (
        <div className="prototype-empty-state">
          {query.trim()
            ? '没有匹配的内容。请调整筛选条件。'
            : '输入关键词开始搜索。'}
        </div>
      ) : null}
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
  const [loading, setLoading] = useState(false);

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
  const folderCards = folders.length
    ? folders.map(folder => ({
        id: folder.id,
        title: folder.title,
        subtitle: 'Bilibili 收藏夹 · 已同步',
        count: folder.mediaCount,
        cover: folderCovers[folder.id] || coverSummerUrl,
      }))
    : MOCK_FOLDERS.map(folder => ({...folder, id: Number.NaN}));

  return (
    <div className="prototype-content">
      <section className="prototype-section prototype-library-section">
        <SectionHeading
          title="你的收藏与合辑"
          note={loading ? 'SYNCING / BILIBILI' : 'SYNCED / LOCAL ARCHIVE'}
        />
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
      {folders.length ? (
        <section className="prototype-section prototype-import-section">
          <SectionHeading title="导入收藏夹" note="PLAYLIST SOURCES" />
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
                  <small>
                    {folder.mediaCount.toLocaleString()} 首 · 使用最新收藏封面
                  </small>
                </span>
              </label>
            ))}
          </div>
          <button
            className="prototype-button prototype-button-primary"
            disabled={!importedTracks.length}
            onClick={() => props.onPlayVideos(importedTracks, true)}
            type="button">
            <Icon name="shuffle" size={15} />
            全局随机播放（{importedTracks.length} 首）
          </button>
        </section>
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
  const [loading, setLoading] = useState(false);
  const folder = props.selectedFolderId;

  useEffect(() => {
    if (!folder || !props.auth.loggedIn || !props.auth.uid) {
      setTracks([]);
      setDescription('');
      return;
    }
    const requestId = makeRequestId(`folder-detail-${folder}`);
    setLoading(true);
    void window.nyamiDesktop.content
      .getFavoriteVideos({
        mediaId: folder,
        page: 1,
        requestId,
        uid: props.auth.uid,
      })
      .then(page => {
        setTracks(page.items);
        setDescription(page.description ?? '');
      })
      .catch(error => {
        const message =
          error instanceof Error ? error.message : '收藏夹读取失败';
        onNotice('error', message);
        setTracks([]);
      })
      .finally(() => setLoading(false));
    return () => {
      void window.nyamiDesktop.content.cancel({requestId});
    };
  }, [folder, props.auth.loggedIn, props.auth.uid, onNotice]);

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
          <h2>{folder ? `收藏夹 ${folder}` : '选择收藏夹'}</h2>
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
      {!loading && !tracks.length ? (
        <div className="prototype-empty-state">没有读取到该收藏夹的视频。</div>
      ) : null}
    </div>
  );
}

/** 音乐偏好页同步标签画像，支持手动维护喜爱标签。 */
function TastePage(props: PrototypePageProps): JSX.Element {
  const [activeTags, setActiveTags] = useState([
    'Ambient',
    'Slowcore',
    'Japanese Pop',
  ]);
  const [newTag, setNewTag] = useState('');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const tags = [
    'Ambient',
    'Slowcore',
    'Japanese Pop',
    'Field Recording',
    'Neo Classical',
    'Indie Pop',
    'Soft Electronic',
  ];
  const toggleTag = (tag: string): void => {
    setActiveTags(current =>
      current.includes(tag)
        ? current.filter(item => item !== tag)
        : [...current, tag],
    );
  };
  const addTag = (): void => {
    const normalized = newTag.trim();
    if (!normalized || activeTags.includes(normalized)) {
      return;
    }
    setActiveTags(current => [...current, normalized]);
    setNewTag('');
  };
  const syncTags = (): void => {
    const timestamp = new Date().toLocaleString();
    setSyncedAt(timestamp);
    try {
      window.localStorage.setItem(
        'nyami-preferred-tags',
        JSON.stringify(activeTags),
      );
      window.localStorage.setItem('nyami-preferred-tags-synced-at', timestamp);
    } catch {
      // 同步失败不影响当前标签的编辑体验。
    }
    props.onNotice('success', '音乐偏好标签已同步');
  };
  return (
    <div className="prototype-content">
      <div className="prototype-metrics">
        <Metric value="1,248" label="MINUTES THIS MONTH" />
        <Metric value="86" label="SAVED TRACKS" />
        <Metric value={String(activeTags.length + 9)} label="ACTIVE TAGS" />
        <Metric accent value="92%" label="MOOD MATCH" />
      </div>
      <section className="prototype-preference-layout">
        <div className="prototype-radar">
          <RadarChart />
        </div>
        <div>
          <div className="prototype-preference-panel">
            <SectionHeading
              action={
                <button
                  className="prototype-button prototype-button-quiet"
                  onClick={syncTags}
                  type="button">
                  同步标签
                </button>
              }
              title="你的标签"
              note={syncedAt ? `已同步 ${syncedAt}` : '点击标签调整偏好'}
            />
            <div className="prototype-tag-cloud">
              {tags.map(tag => (
                <button
                  className={
                    activeTags.includes(tag)
                      ? 'prototype-taste-tag is-hot'
                      : 'prototype-taste-tag'
                  }
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  type="button">
                  {tag}
                </button>
              ))}
            </div>
            <div className="prototype-tag-editor">
              <input
                aria-label="添加喜爱标签"
                onChange={event => setNewTag(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder="添加你喜爱的标签"
                value={newTag}
              />
              <button
                className="prototype-button prototype-button-primary"
                onClick={addTag}
                type="button">
                添加
              </button>
            </div>
          </div>
        </div>
      </section>
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
          <SpectrumGraph values={props.spectrum} />
          {professional ? (
            <div className="prototype-peq-grid">
              {audio.peqBands.map((band, index) => (
                <label
                  className="prototype-eq-band"
                  key={`${band.frequency}-${index}`}>
                  <input
                    aria-label={`专业 EQ ${band.frequency} Hz 增益`}
                    max="12"
                    min="-12"
                    onChange={event => {
                      const next = audio.peqBands.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              gain: Number(event.target.value),
                              enabled: true,
                            }
                          : item,
                      );
                      updateAudio({peqBands: next});
                    }}
                    step="0.5"
                    type="range"
                    value={band.gain}
                  />
                  <output>{formatGain(band.gain)}</output>
                  <span>
                    {band.frequency >= 1000
                      ? `${band.frequency / 1000}k`
                      : band.frequency}
                  </span>
                </label>
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
                <button
                  className={
                    audio.graphicPreset === preset.id ? 'is-active' : ''
                  }
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  title={preset.description}
                  type="button">
                  {preset.label}
                </button>
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

/** 渲染窗口版与全屏版共用的沉浸式播放器，并支持 ESC 返回普通播放界面。 */
export function PrototypeImmersivePage(props: PrototypePageProps): JSX.Element {
  const isFullscreen = props.route === 'immersive-fullscreen';
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
    backgroundImage: `linear-gradient(120deg, ${palette[0]}e8, ${palette[1]}dd 52%, ${palette[2]}e8), url(${track.cover})`,
  } as CSSProperties;

  /** 进入浏览器内容全屏并切换到独立的全屏布局。 */
  const enterFullscreen = (): void => {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
    props.onRouteChange('immersive-fullscreen');
  };

  /** 从全屏回到窗口版，从窗口版回到发现页。 */
  const exitFullscreen = useCallback((): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    onRouteChange(isFullscreen ? 'immersive-windowed' : 'discover');
  }, [isFullscreen, onRouteChange]);

  useEffect(() => {
    setQueueOpen(false);
    setPaletteIndex(0);
    if (!isFullscreen && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [isFullscreen, track.bvid]);

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
    /** 沉浸式快捷键：ESC 退出、空格播放、左右键切歌。 */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        exitFullscreen();
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
  }, [exitFullscreen, onNext, onPause, onPlay, onPrevious, playback.state]);

  const sleepValue = props.playback.sleepTimerSeconds ? 'active' : '';

  return (
    <div
      className={
        isFullscreen
          ? 'prototype-immersive prototype-immersive-fullscreen'
          : 'prototype-immersive prototype-immersive-windowed'
      }
      style={immersiveStyle}>
      <div className="prototype-immersive-backdrop" />
      <header className="prototype-immersive-heading">
        <div>
          <span className="prototype-meta">
            {isFullscreen
              ? 'NYAMI / FULLSCREEN IMMERSIVE'
              : 'NYAMI / WINDOWED IMMERSIVE'}
          </span>
          <strong>{track.author}</strong>
          <span>{track.title}</span>
        </div>
        <div className="prototype-immersive-heading-actions">
          {!isFullscreen ? (
            <button
              aria-label="进入全屏播放器"
              onClick={enterFullscreen}
              type="button">
              <Icon name="fullscreen" size={17} />
            </button>
          ) : null}
          <button
            aria-expanded={queueOpen}
            aria-label="打开播放列表"
            onClick={() => setQueueOpen(true)}
            type="button">
            <Icon name="list" size={17} />
          </button>
          {isFullscreen ? (
            <button
              aria-label="退出沉浸式播放器"
              onClick={exitFullscreen}
              type="button">
              <Icon name="x" size={17} />
            </button>
          ) : null}
        </div>
      </header>
      <main className="prototype-immersive-main">
        <section className="prototype-immersive-art-stage">
          <div className="prototype-ambient-orbit" />
          <ImmersiveOrbitSpectrum
            isPlaying={props.playback.state === 'playing'}
            values={props.spectrum}
          />
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
          <input
            aria-label="调整播放进度"
            className="prototype-progress-input"
            max={track.duration}
            min="0"
            onChange={event => props.onSeek(Number(event.target.value))}
            type="range"
            value={Math.min(track.duration, props.playback.position)}
          />
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
          onClick={() => props.onNotice('info', '已切换播放顺序')}
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
      <ImmersiveSpectrum
        isPlaying={props.playback.state === 'playing'}
        values={props.spectrum}
      />
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

/** 沉浸式底部实时柱状频谱，播放时通过 CSS 轻量扰动保持动态。 */
function ImmersiveSpectrum({
  isPlaying,
  values,
}: {
  isPlaying: boolean;
  values: number[];
}): JSX.Element {
  const displayValues = values.length
    ? values.slice(0, 64)
    : Array(48).fill(0.12);
  return (
    <div
      aria-label="沉浸式实时频谱"
      className={
        isPlaying
          ? 'prototype-immersive-spectrum is-playing'
          : 'prototype-immersive-spectrum'
      }
      role="img">
      {displayValues.map((value, index) => (
        <span
          key={index}
          style={
            {
              height: `${Math.max(6, Math.round(value * 100))}%`,
              '--bar-index': index,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** 在沉浸式封面外围绘制随播放状态变化的环形频谱。 */
function ImmersiveOrbitSpectrum({
  isPlaying,
  values,
}: {
  isPlaying: boolean;
  values: number[];
}): JSX.Element {
  const displayValues = values.length
    ? values.slice(0, 32)
    : Array(32).fill(0.16);
  return (
    <div
      aria-label="封面环形实时频谱"
      className={
        isPlaying
          ? 'prototype-orbit-spectrum is-playing'
          : 'prototype-orbit-spectrum'
      }
      role="img">
      {displayValues.map((value, index) => (
        <span
          key={index}
          style={
            {
              '--orbit-angle': `${(360 / displayValues.length) * index}deg`,
              '--orbit-height': `${Math.max(8, Math.round(value * 30))}%`,
              '--orbit-index': index,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
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

function Metric({
  accent = false,
  label,
  value,
}: {
  accent?: boolean;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="prototype-metric">
      <span
        className={
          accent ? 'prototype-metric-value accent' : 'prototype-metric-value'
        }>
        {value}
      </span>
      <span className="prototype-metric-label">{label}</span>
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

function RadarChart(): JSX.Element {
  return (
    <svg aria-label="音乐偏好雷达图" role="img" viewBox="0 0 320 280">
      <polygon
        fill="none"
        points="160,20 258,91 220,223 100,223 62,91"
        stroke="currentColor"
      />
      <polygon
        fill="none"
        points="160,54 224,101 200,187 120,187 96,101"
        stroke="currentColor"
      />
      <polygon
        fill="rgba(200,76,49,.17)"
        points="160,44 238,104 192,210 105,180 86,104"
        stroke="var(--prototype-accent)"
        strokeWidth="2"
      />
      <g
        fill="var(--prototype-ink-2)"
        fontFamily="var(--prototype-sans)"
        fontSize="13"
        fontWeight="600">
        <text x="145" y="15">
          氛围
        </text>
        <text x="266" y="96">
          节奏
        </text>
        <text x="226" y="237">
          人声
        </text>
        <text x="76" y="237">
          器乐
        </text>
        <text x="35" y="96">
          实验
        </text>
      </g>
    </svg>
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

function SpectrumGraph({values}: {values: number[]}): JSX.Element {
  const points = values.length
    ? values
        .slice(0, 12)
        .map((value, index) => `${index * 60},${180 - Math.round(value * 120)}`)
        .join(' ')
    : '0,164 48,110 75,124 120,72 208,68 254,96 320,172 372,158 436,88 480,114 552,158 608,118 664,86 720,98';
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
