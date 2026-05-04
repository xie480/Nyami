# BiliMusic 播放器核心功能优化与重构方案

## 1. 播放列表定位逻辑优化

### 1.1 现状分析
当前 `PlaylistPanel.tsx` 中，打开播放列表时通过 `setTimeout` 和 `scrollToIndex` 实现定位，存在明显的滚动动画，且如果列表较长，体验不佳。

### 1.2 优化方案
*   **瞬间定位 (无动画)**: 
    *   利用 `FlatList` 的 `initialScrollIndex` 属性，在组件挂载时直接渲染到目标位置。
    *   由于 `initialScrollIndex` 要求列表项高度固定或已知，需要配合 `getItemLayout` 属性，精确计算每个列表项的高度（包括展开/折叠状态的动态高度处理，或者强制在初始渲染时折叠所有项以保证高度一致）。
    *   移除原有的 `useEffect` 中的 `scrollToIndex` 动画逻辑。
*   **单收藏夹顺序播放的动态上下文加载**:
    *   **状态扩展**: 在 `playerStore` 中增加 `playContext` 字段，记录当前播放的来源（如 `folderId`, `sortOption`, `searchQuery` 等）。
    *   **双向加载机制**: 当打开播放列表且处于单收藏夹模式时，以当前播放歌曲为中心（游标）。
    *   **向上/向下查询**: 结合全局索引 (`favoriteService.getGlobalIndex()`) 和当前的排序规则，动态计算当前歌曲前后的曲目。
    *   **无缝展示**: 初始加载时，不仅加载当前歌曲，还预加载其前后的 N 首歌曲，确保用户在列表中看到的是完整的上下文。

## 2. 随机播放模式逻辑重构

### 2.1 现状分析
当前 `playerStore.ts` 的 `togglePlayMode` 只是简单地对 `queue` 进行 `Math.random() - 0.5` 排序，没有保证当前播放的歌曲在头部。`VideosScreen.tsx` 中的 `shuffle` 也是类似。

### 2.2 优化方案
*   **进入随机模式的洗牌算法**:
    *   修改 `playerStore.togglePlayMode`：当切换到 `shuffle` 时，获取当前的 `queue` 和 `currentBvid`。
    *   将 `currentBvid` 对应的歌曲从列表中移出。
    *   对剩余的歌曲使用标准的 Fisher-Yates 洗牌算法进行深度打乱。
    *   将 `currentBvid` 对应的歌曲插入到打乱后列表的头部（索引 0）。
    *   更新 `queue` 并调用 `TrackPlayer.reorderQueue` 或重新 `loadQueue`。
*   **拦截手动点歌 (主动干预)**:
    *   修改 `VideosScreen.tsx` 的 `playFrom` 方法。
    *   判断当前 `playerStore` 的 `playMode` 是否为 `shuffle`。
    *   如果是 `shuffle` 模式：
        *   获取用户点击的歌曲 `targetVideo`。
        *   获取当前展示的列表（或全局列表），移除 `targetVideo`。
        *   对剩余列表进行 Fisher-Yates 洗牌。
        *   将 `targetVideo` 置于新列表的头部。
        *   调用 `setQueue` 和 `loadQueue` 开始播放。

## 3. 应用退出时的状态持久化机制

### 3.1 现状分析
当前 `playerStore` 使用了 `zustand/middleware` 的 `persist`，已经将 `queue`, `currentBvid`, `playMode` 等持久化到了 MMKV。但是，**精确到毫秒级的播放进度**并没有被持久化，且冷启动时的恢复逻辑不完善。

### 3.2 优化方案
*   **进度实时持久化**:
    *   在 `trackPlayer.ts` 的 `PlaybackService` 中，监听 `Event.PlaybackProgressUpdated`（需要配置 `progressUpdateEventInterval`）。
    *   或者，为了减少高频写入 MMKV 的性能损耗，可以监听 `AppState` 的变化（当应用进入 `background` 或 `inactive` 时），主动调用 `TrackPlayer.getProgress()` 获取当前进度并写入 MMKV。
    *   同时，在 `Event.PlaybackState` 变为 `Paused` 或 `Stopped` 时也保存进度。
*   **冷启动无缝恢复**:
    *   在 `App.tsx` 或 `trackPlayer.ts` 的 `setupPlayer` 流程中，增加初始化拦截。
    *   读取 MMKV 中的 `playerStore` 状态（队列、当前歌曲）以及单独保存的**播放进度时间戳**。
    *   如果存在恢复数据：
        *   调用 `TrackPlayer.add(queue)`。
        *   调用 `TrackPlayer.skip(currentIndex)`。
        *   调用 `TrackPlayer.seekTo(savedProgress)`。
        *   根据用户偏好决定是否自动恢复播放（通常冷启动不自动播放，只恢复状态和进度）。

## 4. 播放列表滑动分页加载与全局数据同步

### 4.1 现状分析
当前 `PlaylistPanel` 只是简单展示 `queue`，没有分页加载逻辑。`VideosScreen` 有分页加载，但数据是局部的 `list` 状态，与全局播放队列脱节。

### 4.2 优化方案
*   **统一数据源 (响应式状态同步)**:
    *   创建一个新的 Zustand Store：`useFolderDataStore`，用于管理特定收藏夹的完整数据列表、分页状态、排序状态等。
    *   `VideosScreen` 不再维护局部的 `list`，而是订阅 `useFolderDataStore`。
    *   当 `VideosScreen` 或 `PlaylistPanel` 触发加载更多时，调用 `useFolderDataStore.loadMore()`。
*   **播放列表触底拦截与缓存优先**:
    *   在 `PlaylistPanel.tsx` 的 `FlatList` 中实现 `onEndReached`。
    *   触发时，检查当前播放上下文（是否为单收藏夹顺序播放）。
    *   如果是，调用 `useFolderDataStore.loadMore()`。
    *   `loadMore` 逻辑：
        1.  查询全局索引 `favoriteService.getGlobalIndex()` 中是否已包含下一页的数据（通过比对当前已加载数量和全局索引中该 folderId 的数量）。
        2.  如果缓存命中，直接从全局索引提取数据追加到当前列表。
        3.  如果缓存未命中（触底），向远端发起分页网络请求 (`biliApi.getFavoriteVideos`)。
*   **实时分发与渲染更新**:
    *   网络请求获取到新数据后，更新 `useFolderDataStore` 的列表。
    *   由于 `VideosScreen` 和 `PlaylistPanel` 都订阅了该 Store，React 会自动触发重渲染，保证多视图之间视频数据源状态的唯一性与统一性。
    *   同时，将新获取的数据同步更新到 `playerStore.queue` 和原生的 `TrackPlayer` 队列中（使用 `TrackPlayer.add` 追加到队尾），确保播放器能无缝继续播放新加载的曲目。

## 实施步骤 (Todo List)

1.  **状态管理重构**: 创建 `useFolderDataStore`，迁移 `VideosScreen` 的局部状态。
2.  **播放列表定位**: 修改 `PlaylistPanel`，实现 `getItemLayout` 和 `initialScrollIndex`。
3.  **随机播放逻辑**: 修改 `playerStore.togglePlayMode` 和 `VideosScreen.playFrom`，实现 Fisher-Yates 洗牌和置顶逻辑。
4.  **进度持久化**: 在 `trackPlayer.ts` 中增加进度保存逻辑（结合 AppState 和播放状态）。
5.  **冷启动恢复**: 在 `setupPlayer` 后增加状态和进度恢复逻辑。
6.  **分页与同步**: 在 `PlaylistPanel` 中实现 `onEndReached`，对接 `useFolderDataStore` 的缓存优先加载逻辑，并同步更新原生播放队列。