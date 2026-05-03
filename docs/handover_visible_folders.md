# 交接文档：收藏夹可见性偏好设置重构

## 1. 任务目标
重构当前的收藏夹展示与全局索引逻辑，支持用户自定义配置可见的收藏夹。
*   **展示层**：仅渲染用户选中的收藏夹。
*   **索引层**：全局索引仅包含选中收藏夹内的数据，提升性能。
*   **默认策略**：默认全选；用户新建的收藏夹默认可见。
*   **状态同步**：修改偏好后，自动触发全局索引重新计算。

## 2. 核心架构设计（黑名单机制）
为了优雅地实现“新建收藏夹默认可见”的需求，我们决定采用**黑名单机制**（`hiddenFolders`）而非白名单机制（`visibleFolders`）。
*   状态中保存用户**不想看到**的收藏夹 ID 列表。
*   当拉取到全量收藏夹列表时，过滤掉存在于 `hiddenFolders` 中的项。
*   由于新建的收藏夹 ID 不可能存在于历史的 `hiddenFolders` 中，因此自然会被展示并参与索引。

## 3. 当前进度
*   [x] 需求分析与架构设计完成。
*   [x] 制定了详细的 5 步实施计划。
*   [ ] 尝试修改 `src/store/settingsStore.ts` 时遇到 diff 匹配错误，尚未实际修改代码。

## 4. 待办事项 (Todo List)
接下来的会话请严格按照以下步骤进行开发：

1.  **更新状态管理 (Settings Store)**
    *   文件：`src/store/settingsStore.ts`
    *   操作：在 `Settings` 和 `SettingsState` 接口中新增 `hiddenFolders: number[]` 及其更新方法 `setHiddenFolders`。初始值设为 `[]`。
    *   *注意：上次尝试修改此文件时 diff 失败，请先使用 `read_file` 读取最新内容再修改。*

2.  **开发可见收藏夹配置 UI**
    *   文件：`src/screens/SettingsScreen.tsx`
    *   操作：新增“可见收藏夹”偏好设置入口。可以弹出一个 Modal 或导航到一个新页面。
    *   逻辑：拉取并展示用户的所有收藏夹（使用 `favoriteService.getFolders`），允许用户勾选/取消勾选。将**未勾选**的收藏夹 ID 收集起来，保存至 `hiddenFolders`。

3.  **拦截并过滤展示层数据**
    *   文件：`src/screens/FoldersScreen.tsx`
    *   操作：引入 `useSettingsStore` 获取 `hiddenFolders`。在 `load` 方法拉取到 `data` 后，或者在渲染 `FlatList` 前，过滤掉 `hiddenFolders.includes(item.id)` 的收藏夹。

4.  **重构全局索引底层逻辑**
    *   文件：`src/services/favoriteService.ts`
    *   操作：修改 `syncGlobalIndex` 方法。在获取到 `folders` 后，读取 `useSettingsStore.getState().hiddenFolders`，将这些隐藏的收藏夹从 `folders` 列表中剔除，然后再进行后续的并发视频拉取。

5.  **实现状态严格同步机制**
    *   文件：`src/screens/SettingsScreen.tsx` (或处理保存逻辑的地方)
    *   操作：在用户修改并保存 `hiddenFolders` 后，调用 `useSyncStore.getState().startSync(uid, true)` 强制重新构建全局索引，确保底层数据与前端视图严格一致。

## 5. 关键文件与依赖
*   状态管理：Zustand (`src/store/settingsStore.ts`, `src/store/syncStore.ts`)
*   持久化：MMKV (`src/core/storage.ts`)
*   服务层：`src/services/favoriteService.ts`
*   UI 层：`src/screens/SettingsScreen.tsx`, `src/screens/FoldersScreen.tsx`

## 6. 恢复开发建议
在新的会话中，请先阅读本交接文档，然后直接从**待办事项的第 1 步**开始，使用 `read_file` 读取 `src/store/settingsStore.ts` 并应用修改。