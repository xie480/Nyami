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
  FavoriteSourceSummary,
  PlaybackSnapshot,
  PlaybackQueueMode,
  PlaybackQueueContext,
  SyncSnapshot,
  UserProfile,
} from '../shared/types';
import {
  filterVisibleFavoriteIndex,
  filterVisibleFavoriteSources,
  getSyncStatusLabel,
} from '../shared/libraryFilters';
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
import {
  DEFAULT_SEARCH_TAG_FILTER,
  filterSearchVideosByTags,
  migrateSearchTagFilter,
  type SearchTagFilterState,
} from '../shared/searchTagFilters';

/** PC 端设计稿对应的路由集合，沉浸式页面不参与普通导航。 */
export type PrototypeRoute =
  | 'search'
  | 'library'
  | 'folder-detail'
  | 'settings'
  | 'immersive-windowed';

type PrototypeNoticeTone = 'info' | 'success' | 'error';

const SEARCH_TAG_FILTER_STORAGE_KEY = 'nyami-search-tag-filter-v1';
const DEFAULT_SEARCH_KEYWORD = '音乐';

type PrototypePageProps = {
  route: PrototypeRoute;
  auth: AuthStatus;
  profile: UserProfile | null;
  playback: PlaybackSnapshot;
  spectrum: number[];
  searchQuery: string;
  settings: DesktopSettings | null;
  sync: SyncSnapshot;
  onRouteChange: (route: PrototypeRoute) => void;
  onSelectFolder: (folderId: number) => void;
  onSelectSource: (sourceKey: string) => void;
  onSleepTimer: (seconds: number | null) => void;
  onPlayVideo: (video: DesktopVideo) => void;
  onPlayVideos: (
    videos: DesktopVideo[],
    shuffle: boolean,
    context?: PlaybackQueueContext | null,
    startIndex?: number,
  ) => void;
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
  selectedSourceKey: string | null;
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
  const [searchRequested, setSearchRequested] = useState(
    Boolean(props.searchQuery.trim()),
  );
  const [sort, setSort] = useState('综合排序');
  const [dateFilter, setDateFilter] = useState('全部日期');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [maxDuration, setMaxDuration] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [whitelistTagInput, setWhitelistTagInput] = useState('');
  const [blacklistTagInput, setBlacklistTagInput] = useState('');
  const [tagFilter, setTagFilter] = useState<SearchTagFilterState>(
    DEFAULT_SEARCH_TAG_FILTER,
  );
  const [result, setResult] = useState<DesktopPage<DesktopVideo> | null>(null);
  const [searchRevision, setSearchRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [requestError, setRequestError] = useState('');
  const requestIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEARCH_TAG_FILTER_STORAGE_KEY);
      if (!raw) {
        return;
      }
      setTagFilter(migrateSearchTagFilter(JSON.parse(raw)));
    } catch {
      // 本地筛选偏好损坏时使用默认条件，不阻断搜索页面。
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SEARCH_TAG_FILTER_STORAGE_KEY,
        JSON.stringify(tagFilter),
      );
    } catch {
      // 本地存储不可用时保留当前会话筛选条件。
    }
  }, [tagFilter]);

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
      const normalized = activeQuery.trim() || DEFAULT_SEARCH_KEYWORD;
      if (loadingRef.current) {
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
    setSearchRequested(Boolean(props.searchQuery.trim()));
  }, [props.searchQuery]);

  useEffect(() => {
    if (!searchRequested) {
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
  }, [
    activeQuery,
    cancelActiveRequest,
    getSearchOptions,
    loadPage,
    searchRevision,
    searchRequested,
  ]);

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
    setSearchRequested(true);
    setSearchRevision(current => current + 1);
    setActiveQuery(query.trim());
  };

  const addSearchTag = (
    listMode: 'whitelist' | 'blacklist',
  ): void => {
    const input =
      listMode === 'whitelist' ? whitelistTagInput : blacklistTagInput;
    const tag = input.trim();
    if (!tag) {
      return;
    }
    setTagFilter(current => {
      const key = listMode === 'whitelist' ? 'whitelistTags' : 'blacklistTags';
      const tags = current[key];
      return tags.includes(tag)
        ? current
        : {...current, [key]: [...tags, tag]};
    });
    if (listMode === 'whitelist') {
      setWhitelistTagInput('');
    } else {
      setBlacklistTagInput('');
    }
  };

  const filteredItems = filterSearchVideosByTags(
    result?.items ?? [],
    tagFilter,
  );

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
        <FilterRow label="标签">
          <div className="prototype-tag-filter-layout">
            <TagFilterSection
              input={whitelistTagInput}
              listMode="whitelist"
              mode={tagFilter.whitelistMode}
              onAdd={() => addSearchTag('whitelist')}
              onInput={setWhitelistTagInput}
              onModeChange={mode =>
                setTagFilter(current => ({...current, whitelistMode: mode}))
              }
              onRemove={tag =>
                setTagFilter(current => ({
                  ...current,
                  whitelistTags: current.whitelistTags.filter(
                    value => value !== tag,
                  ),
                }))
              }
              tags={tagFilter.whitelistTags}
            />
            <TagFilterSection
              input={blacklistTagInput}
              listMode="blacklist"
              onAdd={() => addSearchTag('blacklist')}
              onInput={setBlacklistTagInput}
              onRemove={tag =>
                setTagFilter(current => ({
                  ...current,
                  blacklistTags: current.blacklistTags.filter(
                    value => value !== tag,
                  ),
                }))
              }
              tags={tagFilter.blacklistTags}
            />
          </div>
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
        {filteredItems.map((video, index) => (
          <TrackCard
            index={index + 1}
            key={video.bvid}
            onPlay={() =>
              props.onPlayVideos(
                filteredItems,
                false,
                {
                  kind: 'search',
                  keyword: activeQuery || DEFAULT_SEARCH_KEYWORD,
                  page: result?.page ?? 1,
                },
                index,
              )
            }
            onQueue={() => props.onAddVideo(video)}
            track={video}
          />
        ))}
      </div>
      <div className="prototype-search-sentinel" ref={sentinelRef} />
      {loadingMore ? (
        <div className="prototype-inline-loading" role="status">
          <span className="prototype-spinner" />
          正在加载更多
        </div>
      ) : null}
      {!filteredItems.length && !loading ? (
        <SearchEmptyState
          hasQuery={Boolean(activeQuery)}
          hasSearched={searchRequested}
          query={activeQuery}
        />
      ) : null}
      {loading && !result?.items.length ? (
        <SearchLoadingState />
      ) : null}
    </div>
  );
}

/** 搜索页的空状态，用图形和上下文文案区分未搜索与无结果。 */
function SearchEmptyState({
  hasQuery,
  hasSearched,
  query,
}: {
  hasQuery: boolean;
  hasSearched: boolean;
  query: string;
}): JSX.Element {
  return (
    <div className="prototype-search-empty" role="status">
      <svg
        aria-hidden="true"
        preserveAspectRatio="xMidYMid meet"
        viewBox="0 0 160 96">
        <path d="M21 70h118" />
        <path d="M38 58V35l17-12 17 12v23M72 58V29l17-14 17 14v29M106 58V40l17-10 13 10v18" />
        <circle cx="77" cy="70" r="7" />
        <path d="m82 75 8 8" />
      </svg>
      <strong>
        {!hasSearched
          ? '让声音先从一个关键词开始'
          : hasQuery
          ? `没有找到“${query}”`
          : '没有符合当前筛选条件的结果'}
      </strong>
      <span>
        {!hasSearched
          ? '输入歌名、UP 主或专辑名，开始探索 Bilibili'
          : hasQuery
          ? '换个关键词，或放宽筛选条件试试'
          : '调整排序、日期、时长或标签条件后重试'}
      </span>
    </div>
  );
}

/** 搜索请求等待期间展示居中的 NYAMI 轨道动画。 */
function SearchLoadingState(): JSX.Element {
  return (
    <div className="prototype-search-loading" role="status">
      <div className="prototype-search-loading-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <strong>正在寻找声音</strong>
      <small>正在整理 Bilibili 搜索结果</small>
    </div>
  );
}

/** 渲染一组标签输入、匹配模式和已添加标签。 */
function TagFilterSection({
  input,
  listMode,
  mode,
  onAdd,
  onInput,
  onModeChange,
  onRemove,
  tags,
}: {
  input: string;
  listMode: 'whitelist' | 'blacklist';
  mode?: 'and' | 'or';
  onAdd: () => void;
  onInput: (value: string) => void;
  onModeChange?: (mode: 'and' | 'or') => void;
  onRemove: (tag: string) => void;
  tags: string[];
}): JSX.Element {
  const isWhitelist = listMode === 'whitelist';
  return (
    <section
      aria-label={isWhitelist ? '白名单标签' : '黑名单标签'}
      className={`prototype-tag-filter-section ${
        isWhitelist ? 'is-whitelist' : 'is-blacklist'
      }`}>
      <div className="prototype-tag-filter-section-head">
        <strong>{isWhitelist ? '白名单标签' : '黑名单标签'}</strong>
        <small>{isWhitelist ? '参与匹配' : '固定 And，全部命中才排除'}</small>
      </div>
      <div className="prototype-tag-filter-editor">
        <input
          aria-label={isWhitelist ? '添加白名单标签' : '添加黑名单标签'}
          onChange={event => onInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd();
            }
          }}
          placeholder="输入标签后回车"
          value={input}
        />
        <button className="prototype-filter-chip" onClick={onAdd} type="button">
          添加
        </button>
      </div>
      {isWhitelist && mode && onModeChange ? (
        <div
          aria-label="白名单匹配模式"
          className="prototype-mode-switch"
          role="group">
          <button
            className={mode === 'and' ? 'is-active' : ''}
            onClick={() => onModeChange('and')}
            type="button">
            And
          </button>
          <button
            className={mode === 'or' ? 'is-active' : ''}
            onClick={() => onModeChange('or')}
            type="button">
            Or
          </button>
        </div>
      ) : null}
      <div className="prototype-tag-filter-chips">
        {tags.map(tag => (
          <button
            aria-label={`移除${isWhitelist ? '白名单' : '黑名单'}标签 ${tag}`}
            className="prototype-filter-chip is-selected"
            key={tag}
            onClick={() => onRemove(tag)}
            type="button">
            {tag} ×
          </button>
        ))}
      </div>
    </section>
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

export type PrototypeSelectOption = {
  value: string;
  label: string;
};

/** 绘制跨平台下拉菜单，避免使用系统原生弹出层破坏 NYAMI 视觉。 */
export function PrototypeSelect({
  ariaLabel,
  className,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  options: PrototypeSelectOption[];
  value: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find(option => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const selectOption = (next: string): void => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div
      className={`prototype-select-menu ${className ?? ''}`.trim()}
      ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="prototype-select-trigger"
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const currentIndex = Math.max(
              0,
              options.findIndex(option => option.value === value),
            );
            const offset = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex =
              (currentIndex + offset + options.length) % options.length;
            selectOption(options[nextIndex].value);
          }
        }}
        type="button">
        <span>{selected?.label ?? ''}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open ? (
        <div className="prototype-select-options" role="listbox">
          {options.map(option => (
            <button
              aria-selected={option.value === value}
              className={
                option.value === value
                  ? 'prototype-select-option is-selected'
                  : 'prototype-select-option'
              }
              key={option.value}
              onClick={() => selectOption(option.value)}
              role="option"
              type="button">
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 仅在真实同步运行时展示同步中，避免恢复旧状态造成误导。 */
function getDisplayedSyncStatus(
  status: FavoriteSourceSummary['syncStatus'],
  syncActive: boolean,
): FavoriteSourceSummary['syncStatus'] {
  if (!syncActive && (status === 'syncing' || status === 'running')) {
    return 'idle';
  }
  return status;
}

/** 音乐库页读取真实收藏夹，并提供导入范围与全局随机播放。 */
function DesignLibraryPage(props: PrototypePageProps): JSX.Element {
  const [sources, setSources] = useState<FavoriteSourceSummary[]>([]);
  const [visibleSourceKeys, setVisibleSourceKeys] = useState<string[]>([]);
  const [allFavoriteIndex, setAllFavoriteIndex] = useState<DesktopVideo[]>([]);
  const [favoriteIndex, setFavoriteIndex] = useState<DesktopVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const syncActive = refreshing || props.sync.state === 'running';

  const persistVisibleSourceKeys = (next: string[]): void => {
    setVisibleSourceKeys(next);
    setFavoriteIndex(filterVisibleFavoriteIndex(allFavoriteIndex, next));
    if (props.auth.uid) {
      try {
        window.localStorage.setItem(
          `nyami-imported-sources-${props.auth.uid}`,
          JSON.stringify(next),
        );
      } catch {
        // 仅持久化失败时保留本次会话选择。
      }
    }
  };

  useEffect(() => {
    if (!props.auth.loggedIn || !props.auth.uid) {
      setSources([]);
      setVisibleSourceKeys([]);
      setAllFavoriteIndex([]);
      setFavoriteIndex([]);
      setLoading(false);
      return;
    }
    let disposed = false;
    const uid = props.auth.uid;
    const sourcesRequestId = makeRequestId('favorite-sources');
    const indexRequestId = makeRequestId('favorite-index');
    setLoading(true);
    void Promise.all([
      window.nyamiDesktop.content.getFavoriteSources({
        requestId: sourcesRequestId,
        uid,
      }),
      window.nyamiDesktop.content.getFavoriteIndex({
        requestId: indexRequestId,
        uid,
      }),
    ])
      .then(([nextSources, nextIndex]) => {
        if (disposed) {
          return;
        }
        const storageKey = `nyami-imported-sources-${uid}`;
        const storedRaw = window.localStorage.getItem(storageKey);
        let stored: string[] = [];
        if (storedRaw !== null) {
          try {
            const parsed: unknown = JSON.parse(storedRaw);
            stored = Array.isArray(parsed)
              ? parsed.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [];
          } catch {
            stored = [];
          }
        }
        const nextVisibleKeys = storedRaw === null
          ? nextSources.map(source => source.sourceKey)
          : stored.filter(sourceKey =>
              nextSources.some(source => source.sourceKey === sourceKey),
            );
        setSources(nextSources);
        setVisibleSourceKeys(nextVisibleKeys);
        setAllFavoriteIndex(nextIndex);
        setFavoriteIndex(
          filterVisibleFavoriteIndex(nextIndex, nextVisibleKeys),
        );
      })
      .catch(error => {
        if (!disposed) {
          props.onNotice(
            'error',
            error instanceof Error ? error.message : '收藏索引读取失败',
          );
          setSources([]);
          setVisibleSourceKeys([]);
          setAllFavoriteIndex([]);
          setFavoriteIndex([]);
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      void window.nyamiDesktop.content.cancel({requestId: sourcesRequestId});
      void window.nyamiDesktop.content.cancel({requestId: indexRequestId});
    };
  }, [props.auth.loggedIn, props.auth.uid, props.onNotice]);

  const toggleImportedSource = (sourceKey: string): void => {
    const next = visibleSourceKeys.includes(sourceKey)
      ? visibleSourceKeys.filter(value => value !== sourceKey)
      : [...visibleSourceKeys, sourceKey];
    persistVisibleSourceKeys(next);
  };

  const allSourcesSelected =
    sources.length > 0 &&
    sources.every(source => visibleSourceKeys.includes(source.sourceKey));

  const refreshImportedSources = async (): Promise<void> => {
    if (!props.auth.uid || refreshing || !visibleSourceKeys.length) {
      return;
    }
    setRefreshing(true);
    const requestId = makeRequestId('refresh-favorite-sources');
    try {
      const nextSources = await window.nyamiDesktop.content.refreshFavoriteSources({
        requestId,
        uid: props.auth.uid,
        sourceKeys: visibleSourceKeys,
      });
      const refreshedIndex = await window.nyamiDesktop.content.getFavoriteIndex({
        requestId: makeRequestId('favorite-index-refresh-all'),
        uid: props.auth.uid,
      });
      setSources(current => {
        const refreshed = new Map(
          nextSources.map(source => [source.sourceKey, source]),
        );
        return current.map(source => refreshed.get(source.sourceKey) ?? source);
      });
      setAllFavoriteIndex(refreshedIndex);
      setFavoriteIndex(
        filterVisibleFavoriteIndex(refreshedIndex, visibleSourceKeys),
      );
      props.onNotice('success', '导入收藏夹已刷新');
    } catch (error) {
      props.onNotice(
        'error',
        error instanceof Error ? error.message : '导入收藏夹刷新失败',
      );
    } finally {
      setRefreshing(false);
      void window.nyamiDesktop.content.cancel({requestId});
    }
  };

  const importedTracks = dedupeVideos(favoriteIndex);
  const recentTracks = importedTracks
    .sort((left, right) => (right.favTime ?? 0) - (left.favTime ?? 0))
    .slice(0, 8);
  const syncNote = syncActive
    ? 'SYNCING / BILIBILI'
    : sources.some(source => source.syncStatus === 'success')
    ? 'SYNCED / LOCAL ARCHIVE'
    : 'NOT SYNCED / LOCAL ARCHIVE';
  const folderCards = filterVisibleFavoriteSources(sources, visibleSourceKeys).map(
    source => ({
      sourceKey: source.sourceKey,
      title: source.title,
      subtitle: `${source.kind === 'owned' ? 'Bilibili 收藏夹' : '导入来源'} · ${getSyncStatusLabel(
        getDisplayedSyncStatus(source.syncStatus, syncActive),
      )}`,
      count: source.mediaCount,
      cover: source.cover,
    }),
  );

  return (
    <div className="prototype-content">
      <section className="prototype-section prototype-library-section">
        <SectionHeading
          action={
            <div className="prototype-library-actions">
              <button
                className="prototype-button prototype-button-quiet"
                disabled={!sources.length}
                onClick={() => setImportOpen(true)}
                type="button">
                <Icon name="folder" size={15} />
                导入收藏夹
              </button>
              <button
                aria-label="刷新导入收藏夹"
                className="prototype-button prototype-button-quiet prototype-refresh-button"
                disabled={refreshing || !visibleSourceKeys.length}
                onClick={() => void refreshImportedSources()}
                title="刷新导入收藏夹"
                type="button">
                <Icon className={refreshing ? 'spin' : undefined} name="refresh" size={15} />
                {refreshing ? '刷新中' : '刷新'}
              </button>
              <button
                className="prototype-button prototype-button-primary"
                disabled={!importedTracks.length}
                onClick={() => props.onPlayVideos(importedTracks, true, null, 0)}
                type="button">
                <Icon name="shuffle" size={15} />
                全局随机播放
              </button>
            </div>
          }
          title="你的收藏与合辑"
          note={syncNote}
        />
        {loading && !folderCards.length ? (
          <div className="prototype-loading-panel prototype-nyami-loader" role="status">
            <span className="prototype-loader-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <strong>正在读取收藏夹</strong>
            <small>索引状态会在读取完成后更新</small>
          </div>
        ) : null}
        {!loading && !folderCards.length ? (
          <div className="prototype-empty-state">
            {props.auth.loggedIn ? '还没有导入收藏夹' : '登录 Bilibili 后即可读取收藏夹'}
          </div>
        ) : null}
        <div className="prototype-card-grid">
          {folderCards.map(folder => (
            <button
              className="prototype-card prototype-folder-card"
              key={folder.sourceKey}
              onClick={() => {
                props.onSelectSource(folder.sourceKey);
                props.onRouteChange('folder-detail');
              }}
              type="button">
              <div className="prototype-cover">
                <SourceCover cover={folder.cover} title={folder.title} />
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
              <div className="prototype-modal-head-actions">
                <button
                  className="prototype-button prototype-button-quiet"
                  disabled={!sources.length}
                  onClick={() =>
                    persistVisibleSourceKeys(
                      allSourcesSelected
                        ? []
                        : sources.map(source => source.sourceKey),
                    )
                  }
                  type="button">
                  {allSourcesSelected ? '取消全选' : '全选'}
                </button>
                <button
                  aria-label="关闭导入收藏夹"
                  onClick={() => setImportOpen(false)}
                  type="button">
                  <Icon name="x" size={16} />
                </button>
              </div>
            </div>
            <div className="prototype-import-grid">
              {sources.map(source => (
                <label className="prototype-import-option" key={source.sourceKey}>
                  <input
                    checked={visibleSourceKeys.includes(source.sourceKey)}
                    onChange={() => toggleImportedSource(source.sourceKey)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{source.title}</strong>
                    <small>
                      {source.mediaCount.toLocaleString()} 首 ·{' '}
                      {getSyncStatusLabel(
                        getDisplayedSyncStatus(source.syncStatus, syncActive),
                      )}
                    </small>
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
          onPlay={(_video, index) =>
            props.onPlayVideos(recentTracks, false, null, index)
          }
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
  const [sourceKind, setSourceKind] = useState<FavoriteSourceSummary['kind']>('owned');
  const [loading, setLoading] = useState(false);
  const sourceKey =
    props.selectedSourceKey ??
    (props.selectedFolderId !== null
      ? `ownedFavorite:${props.selectedFolderId}`
      : null);

  useEffect(() => {
    if (!sourceKey || !props.auth.loggedIn || !props.auth.uid) {
      setTracks([]);
      setDescription('');
      setFolderTitle('');
      setLoading(false);
      return;
    }
    let disposed = false;
    const summaryRequestId = makeRequestId(`source-summary-${sourceKey}`);
    const videosRequestId = makeRequestId(`source-videos-${sourceKey}`);
    setLoading(true);
    const loadSourceVideos = async (): Promise<DesktopVideo[]> => {
      const items: DesktopVideo[] = [];
      let page = 1;
      while (page <= 1000) {
        const next = await window.nyamiDesktop.content.getFavoriteSourceVideos({
          requestId: videosRequestId,
          uid: props.auth.uid as string,
          sourceKey,
          page,
        });
        items.push(...next.items);
        if (!next.hasMore || !next.items.length) {
          break;
        }
        page += 1;
      }
      return dedupeVideos(items);
    };
    void Promise.all([
      window.nyamiDesktop.content.getFavoriteSources({
        requestId: summaryRequestId,
        uid: props.auth.uid,
        sourceKeys: [sourceKey],
      }),
      loadSourceVideos(),
    ])
      .then(([summaries, nextTracks]) => {
        if (disposed) {
          return;
        }
        const summary = summaries[0];
        setTracks(nextTracks);
        setDescription(summary?.description ?? '');
        setFolderTitle(summary?.title ?? '');
        setSourceKind(summary?.kind ?? 'owned');
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
      void window.nyamiDesktop.content.cancel({requestId: summaryRequestId});
      void window.nyamiDesktop.content.cancel({requestId: videosRequestId});
    };
  }, [onNotice, props.auth.loggedIn, props.auth.uid, sourceKey]);

  const cover = tracks[0]?.cover || coverSummerUrl;
  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
  const playSource = (shuffle: boolean, startIndex = 0): void => {
    if (!sourceKey) {
      return;
    }
    props.onPlayVideos(
      tracks,
      shuffle,
      {kind: 'favorite', sourceKey},
      startIndex,
    );
  };
  return (
    <div className="prototype-content">
      <section className="prototype-detail-head">
        <div className="prototype-detail-cover">
          <img alt="收藏夹封面" src={cover} />
        </div>
        <div className="prototype-detail-copy">
          <div className="prototype-meta">
            {sourceKind === 'owned' ? 'COLLECTION / OWNED' : 'COLLECTION / IMPORTED'}
          </div>
          <h2>{folderTitle || '选择收藏夹'}</h2>
          <p>{description || '这里展示当前收藏夹中已同步的视频内容'}</p>
          <div className="prototype-actions">
            <button
              className="prototype-button prototype-button-primary"
              disabled={!tracks.length}
              onClick={() => playSource(false)}
              type="button">
              播放全部
            </button>
            <button
              className="prototype-button prototype-button-quiet"
              disabled={!tracks.length}
              onClick={() => playSource(true)}
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
        onPlay={(video, index) => {
          const startIndex = tracks.findIndex(item => item.bvid === video.bvid);
          playSource(false, startIndex >= 0 ? startIndex : index);
        }}
        currentTrackId={props.playback.trackId}
      />
      {loading ? (
        <div className="prototype-loading-panel prototype-nyami-loader" role="status">
          <span className="prototype-loader-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <strong>正在读取收藏夹内容</strong>
        </div>
      ) : null}
      {!loading && !tracks.length ? (
        <div className="prototype-empty-state">没有读取到该收藏夹的视频</div>
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
                    <PrototypeSelect
                      ariaLabel={`PEQ ${index + 1} 滤波器类型`}
                      className="audio-settings-select"
                      onChange={value => {
                        const next = audio.peqBands.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                type: value as DesktopPeqFilterType,
                              }
                            : item,
                        );
                        updateAudio({peqBands: next});
                      }}
                      options={[
                        {value: 'Peak', label: '峰值 · Peak'},
                        {value: 'LowShelf', label: '低频搁架'},
                        {value: 'HighShelf', label: '高频搁架'},
                        {value: 'LowPass', label: '低通'},
                        {value: 'HighPass', label: '高通'},
                        {value: 'Notch', label: '陷波'},
                        {value: 'BandPass', label: '带通'},
                      ]}
                      value={band.type}
                    />
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
  const [isReady, setIsReady] = useState(false);
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
    setIsReady(false);
    const frame = window.requestAnimationFrame(() => setIsReady(true));
    return () => window.cancelAnimationFrame(frame);
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
      className={`prototype-immersive prototype-immersive-windowed ${
        isReady ? 'is-ready' : ''
      }`}
      style={immersiveStyle}>
      <div className="prototype-immersive-backdrop" />
      <header className="prototype-immersive-heading">
        <div>
          <span className="prototype-meta">NYAMI / WINDOWED IMMERSIVE</span>
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
        </section>
        <section className="prototype-immersive-detail">
          <span className="prototype-meta">
            NOW PLAYING / {track.tags[0] ?? 'ARCHIVE'}
          </span>
          <div className="prototype-immersive-title-nav">
            <h1 title={track.title}>{track.title}</h1>
          </div>
          <p>{track.author} · NYAMI ARCHIVE</p>
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
            style={
              {
                '--range-progress': `${Math.round(
                  (Math.min(props.playback.position, track.duration) /
                    Math.max(track.duration, 1)) *
                    100,
                )}%`,
              } as CSSProperties
            }
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
          <Icon
            name={playback.mode === 'shuffle' ? 'shuffle' : 'repeat'}
            size={16}
          />
        </button>
        <button
          aria-label="打开播放列表"
          onClick={() => setQueueOpen(true)}
          type="button">
          <Icon name="list" size={16} />
        </button>
        <label className="prototype-floating-sleep">
          <Icon name="moon" size={14} />
          <PrototypeSelect
            ariaLabel="睡眠定时器"
            className="prototype-floating-select"
            onChange={value =>
              props.onSleepTimer(
                value === 'active' ? null : value ? Number(value) : null,
              )
            }
            options={[
              {value: '', label: '睡眠'},
              {value: '900', label: '15 分钟'},
              {value: '1800', label: '30 分钟'},
              {value: '3600', label: '60 分钟'},
              ...(sleepValue === 'active'
                ? [
                    {
                      value: 'active',
                      label: `剩余 ${props.playback.sleepTimerSeconds} 秒`,
                    },
                  ]
                : []),
            ]}
            value={sleepValue}
          />
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

/** 渲染收藏夹封面，并在远端图片失效时保留可辨识的本地占位。 */
function SourceCover({
  cover,
  title,
}: {
  cover: string;
  title: string;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [cover]);
  const initials = title.trim().slice(0, 2) || 'NY';
  const hue = Array.from(title).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  ) % 360;
  return (
    <>
      {cover && !failed ? (
        <img
          alt={`${title}封面`}
          onError={() => setFailed(true)}
          src={cover}
        />
      ) : (
        <span
          aria-label={`${title}封面占位`}
          className="prototype-source-cover-placeholder"
          style={{'--source-cover-hue': hue} as CSSProperties}>
          {initials}
        </span>
      )}
    </>
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
  onPlay: (video: DesktopVideo, index: number) => void;
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
          key={track.bvid}
          onClick={() => onPlay(track, index)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onPlay(track, index);
            }
          }}
          role="button"
          tabIndex={0}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <strong>{track.title}</strong>
            <small>
              {track.author} · {track.tags[0] ?? 'Music'}
            </small>
          </div>
          <span>{track.tags[0] ?? 'Archive'}</span>
          <span>{formatDuration(track.duration)}</span>
          <span
            aria-hidden="true"
            className="prototype-track-play-indicator">
            <Icon name="play" size={14} />
          </span>
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
