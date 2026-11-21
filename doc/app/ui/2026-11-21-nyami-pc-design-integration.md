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
- 底部播放栏保留上一首、播放/暂停、下一首、音量、队列、顺序/随机图标和进度拖动；进度条加长到右侧控制区域，不再占用动态频谱区域。
- 点击播放条歌曲信息进入窗口版普通播放界面，底部栏不再显示沉浸式和睡眠入口。
- 窗口版沉浸式播放器没有普通页面侧边栏和底部播放栏，保留歌曲信息、封面舞台、播放控件和队列抽屉。
- 全屏版使用独立深色舞台、光晕背景和底部快捷提示，不复用窗口版布局；播放、上一首、下一首、进度和静音仍使用共享播放器状态。
- 全屏入口调用 `document.documentElement.requestFullscreen()`，退出时调用 `document.exitFullscreen()`；窗口大小变化由 CSS viewport 布局处理。
- 窗口版和全屏版共用封面取色动态背景、悬浮播放条和睡眠定时器；窗口版右上角仅保留全屏和队列图标，左侧保留静态封面舞台。
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

## 9. 2026-11-21 需求修复

### 9.1 首页与内容请求

- 移除侧边栏底部的“阶段 5 · 收藏索引”。首页 Hero 直接铺满合集封面，隐藏旧的渐变、竖排标题和描述，右侧改为推荐合集标题；订阅按钮改为 `+`/`✓`。
- `BiliContentRuntime.getHome` 一次读取 24 条热门视频，按 4 条去重切成最多 6 个推荐合集；“查看更多”打开合集选择与曲目列表，可播放整合集合。首页刷新保留已有卡片，并在请求期间显示加载状态，避免先清空“今日精选”。
- 内容请求中的 `AbortError` 现在记录为 debug 级别的取消事件；IPC handler 也不再把用户主动取消写成 error。首页请求清理只标记页面已卸载，不再无条件取消请求，降低页面切换时的取消噪声。

### 9.2 搜索、音乐库与偏好

- 搜索空态改为内嵌 SVG 图形和上下文文案；无结果、搜索中、加载更多分别显示不同反馈。网格/列表改为一个图标按钮切换，不再显示结果条数。
- 搜索请求支持排序、日期、时长参数；自定义日期和时长在主进程按当前页结果过滤，筛选条件变化会重新从第 1 页请求。底部 sentinel 使用 `IntersectionObserver` 追加下一页并按 `bvid` 去重。
- 音乐库将导入收藏夹移入顶部弹窗，全局随机播放与其并列；收藏夹拉取期间显示加载动画。收藏夹详情显示真实标题，并通过 sentinel 分页加载后续视频。
- 音乐偏好移除示例标签，只有全局收藏索引完成后才读取真实收藏内容中的标签；未完成同步时显示“请先同步全局索引”，同步入口复用现有 `sync.start`。

### 9.3 声音实验室、设置与播放器

- 实时频谱只在实际播放且打开频谱开关时绘制，停止播放时保持平直曲线。专业版补齐 Android 端的 Peak、Shelf、Pass、Notch、BandPass 滤波器类型、频率、增益和 Q 参数，并显示预设描述。
- 设置页修正导航图标对齐，账号与登录卡片移到顶部，新增全局收藏夹索引同步项。
- 底部播放条隐藏动态频谱、拉长进度条、去除上一首/下一首边框；顺序/随机按钮改为调用真实 `playback.setMode`。沉浸式播放器移除底部和右侧重复进度条、移除动态环形频谱，并根据封面采样色选择可读的文字、控件背景和边框颜色。

### 9.4 音频缓存索引

`AudioCacheStore` 将索引写入串行化，并对 Windows `EPERM`、`EACCES`、`EBUSY` 的临时占用进行递增重试；重试仍失败时使用 `copyFile` 保留可读索引，同时清理临时文件，避免并发写入把 `index.json` 留在半写状态。播放链路的缓存任务仍在后台执行，缓存失败不会阻断在线播放。

## 10. 本轮验证与限制

### 已执行

- `npm run desktop:typecheck`：通过。
- `npm run desktop:build`：通过，main、preload、renderer 均完成生产构建。
- `git diff --check`：通过；未跟踪的计划、资源和历史过程文档未加入本轮提交。

### 未验证

- 未重新宣称真实 Electron 窗口、Bilibili 网络和 Windows 文件句柄行为已验证。此前启动桌面运行时受 Windows ACL 限制：`ALL APPLICATION PACKAGES` 无法读取 `node_modules/electron/dist`；因此本记录只把类型检查、生产构建和静态代码审阅作为证据。
