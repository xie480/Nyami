# 声音实验室及双层 EQ 音频系统架构设计方案

基于 `docs/EQ均衡器方案.md` 的需求以及当前 BiliMusic 项目的 React Native 架构现状，特制定以下架构设计方案。

## 一、 文件目录规划

为了保持项目结构的清晰和高内聚，新增功能将按照功能模块进行拆分，涵盖前端 UI 层、状态管理层以及 Native DSP 处理层。

### 1. 前端 (React Native)
```text
src/
├── screens/
│   └── SoundLabScreen.tsx       # 声音实验室主页面（独立路由）
├── components/
│   └── eq/                      # EQ 相关专属组件
│       ├── GraphicEQ.tsx        # 普通模式：10-band 图形均衡器（霓虹滑块）
│       ├── ParametricEQ.tsx     # 高级模式：PEQ 参数均衡器（节点拖动曲线）
│       ├── SpectrumView.tsx     # 频谱可视化容器（封装 Native OpenGL 组件）
│       └── PresetSelector.tsx   # 情绪化预设选择器
├── store/
│   └── eqStore.ts               # EQ 状态管理 (Zustand)
└── native/
    └── AudioDSPModule.ts        # 与 Native DSP 引擎通信的桥接接口
```

### 2. 原生端 (Android - 核心 DSP 与渲染)
由于方案明确要求“不使用 Android 系统 EQ，直接在 ExoPlayer 音频链内部实现 DSP”以及“使用 OpenGL ES 进行 GPU 渲染”，必须在 Android 原生层实现核心逻辑。
```text
android/app/src/main/java/com/bilimusic/
├── audio/                       # DSP 音频处理引擎
│   ├── DSPAudioProcessor.kt     # 继承自 ExoPlayer BaseAudioProcessor，拦截 PCM Float Buffer
│   ├── filter/
│   │   ├── BiquadFilter.kt      # IIR Biquad 滤波器 (用于 Graphic EQ)
│   │   └── RBJFilter.kt         # RBJ Audio EQ Cookbook 实现 (用于 PEQ)
│   └── FFTAnalyzer.kt           # 基于 JTransforms/KissFFT 的实时 PCM 分析
├── visualizer/                  # OpenGL 渲染引擎
│   ├── SpectrumGLSurfaceView.kt # 承载 OpenGL 渲染的 SurfaceView
│   ├── SpectrumRenderer.kt      # 核心渲染逻辑（猫耳动态频谱、双层 FFT、Glow 发光）
│   └── SpectrumViewManager.kt   # 暴露给 React Native 的 ViewManager
└── module/
    └── AudioDSPModule.kt        # 暴露给 RN 的控制接口（设置增益、切换预设等）
```

## 二、 组件拆分策略

1. **SoundLabScreen (主容器)**:
   - 负责整体磨砂玻璃背景 (GlassBackground) 和深色 AMOLED 风格的布局。
   - 管理“普通模式 (Graphic EQ)”与“高级模式 (PEQ)”的视图切换。
   - 顶部放置 `SpectrumView`，中部放置 EQ 控制区，底部放置 `PresetSelector`。

2. **SpectrumView (视觉核心)**:
   - 这是一个 Native UI Component 的 Wrapper。
   - 内部直接由 Android 原生 `SpectrumGLSurfaceView` 接管渲染，确保高刷不掉帧。
   - 包含猫耳动态频谱和双层 FFT 主频谱。

3. **GraphicEQ (普通模式)**:
   - 渲染 10 个频段的垂直滑块。
   - 实现拖动惯性动画、发光轨迹和松手回弹效果 (基于 `react-native-reanimated` 或 `react-native-gesture-handler`)。

4. **ParametricEQ (高级模式)**:
   - 渲染 EQ 曲线和 8 个可拖动节点。
   - 支持左右拖动改变 Frequency，上下拖动改变 Gain，双指缩放改变 Q 值。

5. **PresetSelector (预设系统)**:
   - 横向滚动的按钮组，包含“猫耳低音”、“深夜电台”、“东京雨夜”等情绪化预设。

## 三、 路由嵌套层级

在 `src/App.tsx` 的主 `Stack.Navigator` 中注册全新的独立路由：

```tsx
// src/App.tsx
import { SoundLabScreen } from './screens/SoundLabScreen';
const SoundLabScreenWithBg = withBackground(SoundLabScreen);

<Stack.Navigator>
  {/* 现有路由 */}
  <Stack.Screen name="Settings" component={SettingsScreenWithBg} />
  {/* 新增声音实验室路由 */}
  <Stack.Screen name="SoundLab" component={SoundLabScreenWithBg} />
</Stack.Navigator>
```

在 `src/screens/SettingsScreen.tsx` 中新增入口：
```tsx
// src/screens/SettingsScreen.tsx
<Text style={s.section}>音效</Text>
<View style={s.group}>
  <ListItem
    title="声音实验室"
    subtitle="双层 EQ 与动态频谱"
    onPress={() => navigation.navigate('SoundLab')}
    showArrow
  />
</View>
```

## 四、 状态管理流转 (Data Flow)

采用单向数据流，确保 UI 与底层 DSP 引擎状态同步：

1. **状态存储 (`eqStore.ts`)**:
   - 存储当前模式 (Graphic/PEQ)、10-band 增益数组、8-filter PEQ 参数数组、当前选中的预设。
   - 状态持久化 (Zustand `persist`)，以便下次打开应用时恢复用户的 EQ 设置。

2. **UI 交互 -> Store**:
   - 用户在 `GraphicEQ` 拖动滑块，触发 `eqStore.setGraphicBandGain(index, value)`。
   - 用户选择预设，触发 `eqStore.applyPreset(presetId)`。

3. **Store -> Native DSP**:
   - `eqStore` 内部监听状态变化，一旦参数改变，立即调用 `AudioDSPModule.updateGraphicEQ(bands)` 或 `AudioDSPModule.updatePEQ(filters)`。
   - Native 层接收到参数后，线程安全地更新 `DSPAudioProcessor` 中的滤波器系数。

4. **PCM -> FFT -> OpenGL (渲染流转)**:
   - ExoPlayer 播放音频，PCM Float Buffer 流经 `DSPAudioProcessor`。
   - `DSPAudioProcessor` 应用 EQ 滤波后，将 PCM 数据拷贝一份送入 `FFTAnalyzer`。
   - `FFTAnalyzer` 计算出频域数据，直接传递给同在 Native 层的 `SpectrumRenderer`。
   - `SpectrumRenderer` 使用 OpenGL ES 绘制猫耳和频谱，直接上屏。
   - **注意**：高频的 FFT 数据流转完全在 Native 层闭环，绝不经过 React Native Bridge，以保证极致性能和零延迟。