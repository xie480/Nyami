# 冷启动自动加载和自动播放问题修复方案

## 问题根源分析

经过彻底排查，导致冷启动时一直转圈加载并最终自动播放的根本原因在于 **ExoPlayer 的急切准备机制（Eager Preparation）与 `PlaybackError` 事件处理器的冲突**。

1. **冷启动初始化**：在 `setupPlayer` 中，应用正确地将目标历史轨道作为 `placeholder://`（占位符）添加到队列中，并调用 `TrackPlayer.skip()` 跳转到该轨道，然后调用 `pause()` 保持静默。
2. **ExoPlayer 急切准备**：当 `skip()` 被调用时，底层的 ExoPlayer 会立即尝试准备（Prepare）这个新的活跃轨道，以获取时长等元数据。由于 `placeholder://` 是一个无效的音频 URL，ExoPlayer 准备失败，并向 JS 层抛出 `PlaybackError`。
3. **错误的拦截与自动播放**：在 `src/services/trackPlayer.ts` 的 `PlaybackError` 事件处理器中，有一段逻辑专门用于处理占位符播放失败的情况（原本是为了处理用户在正常播放中切歌太快导致的竞态问题）。该逻辑捕获到错误后，会设置 `_pendingAutoPlayAfterResolve = true`，并立即调用 `lazyResolve` 发起网络请求解析真实 URL。
4. **连锁反应**：`lazyResolve` 开始执行，触发了 UI 上的加载动画（一直转圈）。解析完成后，由于 `_pendingAutoPlayAfterResolve` 为 true，且当前轨道是冷启动目标轨道（`isColdStartTarget`），`lazyResolve` 内部强制调用了 `TrackPlayer.play()`，导致了非预期的自动播放。

## 修复方案

核心思路是：**在冷启动期间忽略由 ExoPlayer 急切准备引发的 `PlaybackError`，并拦截用户主动点击的“播放”操作来触发解析。**

### 步骤 1：忽略冷启动时的 `PlaybackError`
修改 `src/services/trackPlayer.ts` 中的 `PlaybackError` 事件监听器。当检测到报错的轨道是冷启动目标轨道（`_coldStartBvid`）时，直接 `return` 忽略该错误。
- 这样可以彻底阻止冷启动时的自动网络请求（消除转圈加载）和后续的自动播放。

### 步骤 2：新增 `resumePlayback` 拦截播放请求
在 `src/services/trackPlayer.ts` 中导出一个新的 `resumePlayback` 函数。
- 该函数在调用原生 `play()` 之前，先检查当前活跃轨道是否为占位符。
- 如果是占位符（即冷启动后用户首次点击播放），则主动调用 `lazyResolve(..., { autoPlay: true })` 进行解析并播放。
- 如果不是占位符，则正常调用 `TrackPlayer.play()`。

### 步骤 3：更新 UI 组件和远程控制事件
将应用中直接调用 `TrackPlayer.play()` 的地方（针对当前轨道的播放/暂停切换）替换为调用 `resumePlayback()`：
- `src/components/MiniPlayer.tsx` 中的播放按钮。
- `src/screens/PlayerScreen.tsx` 中的播放按钮。
- `src/services/trackPlayer.ts` 中的 `Event.RemotePlay`（耳机/锁屏播放键）事件处理器。

## 预期效果
- **冷启动时**：应用将保持完全静默，不会有任何网络请求，底部播放条不会显示加载动画，也不会自动播放。
- **点击播放时**：用户首次点击播放按钮，应用会无缝拦截请求，显示加载动画，解析真实音频 URL，并在解析完成后自动开始播放并恢复历史进度。