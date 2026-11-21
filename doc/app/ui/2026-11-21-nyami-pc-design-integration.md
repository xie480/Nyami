# NYAMI PC 端设计原型迁移记录

## 1. 背景与目标

本次工作将 `E:\EProjectsUI-Designs\e568845c-e938-4dbf-a129-54134485b0b8` 中的 NYAMI PC 端设计原型接入 Electron + React 桌面端。在保留现有 Bilibili 内容、收藏、播放队列和音频控制链路的前提下，统一迁移原型的页面结构、浅色纸张色板、衬线标题、侧边导航、底部播放栏和沉浸式播放器。

本次只修改 PC 端 renderer 与其静态资源，未修改 Android 页面和 React Native 入口。

## 2. 原型盘点与页面映射

原型目录包含 9 个可访问页面，以及 `css/styles.css`、`js/common.js` 和 7 张封面资源。页面映射如下：

| 原型页面 | 项目路由 | 主要迁移内容 | 状态 |
| --- | --- | --- | --- |
| `index.html` | `discover` | Hero、精选卡片、继续聆听、底部播放栏 | 已接入真实 `content.getHome`，网络失败保留预览数据 |
| `pages/search.html` | `search` | 搜索框、类型筛选、排序、网格/列表切换 | 已接入真实 `content.search`，支持播放和入队 |
| `pages/library.html` | `library` | 收藏夹卡片、最近添加、登录提示 | 已接入真实收藏夹 API，未登录时使用隔离的视觉回退数据 |
| `pages/folder-detail.html` | `folder-detail` | 合集头图、统计信息、曲目列表 | 已实现，曲目控制接入现有播放器 |
| `pages/taste.html` | `taste` | 听歌指标、SVG 雷达图、标签云、标签同步 | 已实现标签同步、手动添加/移除，去除推荐路径并提高雷达文字可读性 |
| `pages/sound-lab.html` | `sound-lab` | 频谱 SVG、标准/专业 EQ、Limiter、PEQ 与实时频谱开关 | 已对接 `DesktopAudioSettings`，显示增益数值并同步 Android 端预设 |
| `pages/settings.html` | `settings` | 桌面设置、Android 同步偏好、缓存、日志、更新、账号 | 复用现有 `SettingsPage` 业务组件，统一浅色视觉并补充启动、推荐、网络、播放偏好 |
| `pages/immersive-windowed.html` | `immersive-windowed` | 无侧栏/无底部栏的窗口版沉浸式播放器 | 已实现，播放、进度、音量、队列抽屉可用 |
| `pages/immersive-fullscreen.html` | `immersive-fullscreen` | 独立深色全屏舞台、背景光晕、播放控件 | 已实现，使用 DOM fullscreen，并支持退出回到发现页 |

普通页面共享 `WindowTitlebar`、`Sidebar`、`workspace-header` 与 `PlayerPlaceholder`；两个沉浸式路由独立渲染，不携带普通页面的侧边栏和底部栏。

## 3. 方案与核心修改

### 3.1 设计系统

新增 `desktop/renderer/prototype.css`，定义原型的设计 token：

- 纸张背景 `#f7f4ee`、表面 `#fffefb`、边线 `#d9d0c5`。
- 墨色文字、暖红强调色、低饱和阴影和透明层。
- `DM Serif Display` 风格衬线标题、`IBM Plex Mono` 元信息、系统无衬线正文。
- 224px 侧边栏、74px 底部播放栏、0 圆角纸张卡片和细边框。
- 响应式布局、减少动画模式和沉浸式断点布局。

### 3.2 页面组件

新增 `desktop/renderer/PrototypePages.tsx`，包括：

- `PrototypePage` 路由分发器。
- `DiscoverPage`、`DesignSearchPage`、`DesignLibraryPage`、`FolderDetailPage`。
- `TastePage`、`SoundLabPage`。
- `PrototypeImmersivePage`，区分窗口版和全屏版。
- `PrototypeQueueDrawer`，复用现有播放队列状态。
- `TrackCard`、`TrackList`、`SectionHeading`、`RadarChart`、`SpectrumGraph` 等公共视觉组件。

`desktop/renderer/App.tsx` 负责路由、真实 IPC 回调、播放器状态和通知；页面视觉结构集中在新文件中，避免继续扩大旧页面组件的耦合。

### 3.3 资源

将原型封面复制到 `desktop/renderer/assets/`，作为 Vite 可处理的模块资源：`cover-summer.png`、`cover-pink.png`、`cover-night.png`、`cover-blue.png`、`cover-forest.png`、`cover-portrait.png`、`canonical-player-bar.png`。

## 4. 播放器改造

- 普通页面继续使用现有 HTMLAudio、播放队列和 IPC 状态同步，只更换为原型风格的底部播放栏外壳。
- 底部播放栏保留上一首、播放/暂停、下一首、音量、队列、顺序/随机图标和进度拖动；进度条加长，右下角显示实时频谱。
- 点击播放条歌曲信息进入窗口版普通播放界面，底部栏不再显示沉浸式和睡眠入口。
- 窗口版沉浸式播放器没有普通页面侧边栏和底部播放栏，保留歌曲信息、封面舞台、播放控件和队列抽屉。
- 全屏版使用独立深色舞台、光晕背景和底部快捷提示，不复用窗口版布局；播放、上一首、下一首、进度和静音仍使用共享播放器状态。
- 全屏入口调用 `document.documentElement.requestFullscreen()`，退出时调用 `document.exitFullscreen()`；窗口大小变化由 CSS viewport 布局处理。
- 窗口版和全屏版共用封面取色动态背景、悬浮播放条、睡眠定时器和实时柱形频谱；窗口版右上角仅保留全屏和队列图标。
- 沉浸式页面支持 `Space` 播放/暂停、左右方向键切换上一首/下一首，`Esc` 在全屏与窗口版之间切换并最终返回发现页。
- 播放队列使用抽屉进入动画，点击遮罩区域或关闭按钮收起。

## 5. 真实数据与回退边界

- 发现页调用 `window.nyamiDesktop.content.getHome`。
- 搜索页调用 `window.nyamiDesktop.content.search`。
- 音乐库在已登录时读取 `getFavoriteFolders`、`getFavoriteVideos`。
- 播放和设置操作都沿用现有 `window.nyamiDesktop.playback`、`window.nyamiDesktop.settings` API。
- 原型展示用的静态曲目仅用于接口失败、未登录或无数据时保持页面可预览；这些数据未写入业务存储，也没有替代真实播放链路。
- `desktop/renderer/preferences.ts` 负责持久化 Android 端同步到 PC 的启动、首页刷新、推荐时长/标签、缓存、网络、播放分集、混音和音质偏好；均与现有桌面设置文件隔离，避免破坏 Electron 主进程协议。

## 6. 验证结果

### 已执行

- `npm run desktop:typecheck`：通过。
- `npm run desktop:build`：通过，Electron main、preload、renderer 均完成构建。
- 使用 CUA 浏览器加载构建后的 renderer 静态预览，逐页检查 9 个页面：页面结构、封面资源、路由激活态、底部播放栏和沉浸式布局均能渲染。
- 在预览中验证：登录态收藏夹封面取最新收藏视频、收藏夹详情读取真实 mock API、全局搜索回车直接得到结果、空搜索不显示示例卡、Bilibili 风格筛选栏、偏好/声音实验室/设置同步选项、播放队列抽屉、窗口/全屏沉浸切换及两次 `Esc` 返回。
- 最近一次 `npm run desktop:typecheck`、`npm run desktop:build` 和 Renderer ESLint 检查均通过。
- 对新增 `PrototypePages.tsx` 执行 ESLint：0 个 error，保留 8 个项目既有 `no-void` warning。

### 未完成或受阻

- `npm run lint -- --quiet` 的全仓扫描在本机长时间没有输出，已手动停止；对 `App.tsx` 的全文件检查还会暴露原有的大量 Prettier/React 规则问题，本次没有做无关的全文件格式化。
- `npm run desktop:dev` 已尝试启动，但 Electron sandbox 报 Windows ACL 错误：`ALL APPLICATION PACKAGES` 无法读取 `node_modules/electron/dist`。因此没有把“真实 Electron 窗口启动成功”当作已验证事实；静态 renderer 预览和构建结果已验证。

## 7. 风险与后续

1. Bilibili 真实内容仍受登录状态、网络和接口返回影响，需在具备有效登录与网络的 Electron 环境中再次检查真实封面、音频 URL 和收藏同步。
2. 当前全屏实现是 renderer 内容全屏，未新增 BrowserWindow 原生 `fullScreen` IPC；若需要系统级窗口全屏，需要在主进程窗口能力中增加独立协议并同步窗口状态。
3. 设置页继续复用原有业务控制组件，以保护缓存、日志、更新和账号功能；视觉外壳已统一，但原型中的设置页分栏结构仍可在后续迭代中继续细化。
4. Android 端未修改，仍需在 CI 或真机回归时确认共享资源构建边界没有误引入 PC-only 资源。

## 8. 结论

PC 端 9 个原型页面已完成路由级迁移，普通页面和两种沉浸式播放器均已接入现有 Electron 播放状态。构建和类型检查通过，浏览器静态预览完成逐页及关键交互检查；真实 Electron 启动和线上 Bilibili 数据流仍需在修复本机 Electron ACL 或换用可启动环境后补验。
