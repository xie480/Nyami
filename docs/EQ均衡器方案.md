你的最终方案应该直接做成：

# 「双层 EQ 音频系统」

包含：

* 普通模式（Graphic EQ）
* 高级模式（Parametric EQ / PEQ）
* 实时 FFT 频谱
* 猫耳动态频谱
* 霓虹滑块
* GPU 流光动画
* ExoPlayer 内置 DSP
* 情绪化预设系统
* 磨砂玻璃音频控制台

并且：

> 不使用 Android 系统 EQ。
> 直接在 ExoPlayer 音频链内部实现 DSP。

这是现在真正高级播放器的路线。因为安卓原生 `Equalizer` 在不同 ROM 上频段、精度、行为都不一致。([android-doc.com][1])

---

# 一、整体架构（最终版）

你的播放器音频链：

```text
ExoPlayer
    ↓
PCM Float Buffer
    ↓
DSP Engine
    ├── Graphic EQ
    ├── Parametric EQ
    ├── Limiter
    ├── Stereo Width
    ├── Reverb
    ├── Compressor（预留）
    ↓
FFT Analyzer
    ↓
Visualizer Renderer(OpenGL)
    ↓
AudioTrack
```

核心思想：

> 所有音频处理都在 PCM 阶段完成。

不要依赖：

```java
android.media.audiofx.Equalizer
```

因为：

* ROM 差异巨大
* 精度低
* 很多手机只有 5-band
* Apple Music 等会绕过系统链路
* 很多 EQ 是“伪 PEQ” ([Reddit][2])

---

# 二、EQ 双模式设计（核心）

# 1. 普通模式（Graphic EQ）

这是默认模式。

采用：

# 10-band Graphic EQ

频段：

| 频段    |
| ----- |
| 31Hz  |
| 62Hz  |
| 125Hz |
| 250Hz |
| 500Hz |
| 1kHz  |
| 2kHz  |
| 4kHz  |
| 8kHz  |
| 16kHz |

范围：

```text
-12dB ~ +12dB
```

每个频段：

* 霓虹滑块
* 实时波动
* 拖动惯性动画
* 发光轨迹

---

# 为什么 10-band 最合适

因为：

* UI 最平衡
* 手机屏幕不会拥挤
* 用户能理解
* 动画最舒服
* ACG 风格最好看

31-band 虽然专业：

但移动端 UI 会崩。

---

# 普通模式 UI

你应该做：

```text
╭────────────────────╮
│        EQ          │
│      Nyami         │
│                    │
│   /\      /\       │ ← 猫耳频谱
│  /  \____/  \      │
│                    │
│ ▂▃▅▇█▇▅▃▂ FFT      │
│                    │
│ 31 62 125 250 ... │
│ │  │  │  │        │
│ │  │  │  │        │
│ ●  ●  ●  ●        │ ← 霓虹滑块
│                    │
│ [默认] [女声] ...  │
╰────────────────────╯
```

---

# 三、高级模式（PEQ）

点击：

```text
高级模式
```

进入：

# Parametric EQ

支持：

| 参数        | 含义 |
| --------- | -- |
| Frequency | 频率 |
| Gain      | 增益 |
| Q         | 带宽 |

每个 Filter：

```text
Peak
Low Shelf
High Shelf
Low Pass
High Pass
Notch
Band Pass
```

---

# 推荐配置

# 8 Filter PEQ

已经完全够用。

例如：

```text
Filter 1:
Type: Peak
Freq: 320Hz
Gain: -2.5dB
Q: 1.2
```

---

# PEQ UI

不要做成工程软件。

而是：

# 「节点拖动式 EQ 曲线」

类似：

* Poweramp
* Wavelet
* FabFilter

用户：

直接拖动曲线节点。

视觉：

```text
      ●
    ／  ＼
___/      \____
```

拖动：

* 左右 = 频率
* 上下 = Gain
* 双指缩放 = Q值

这是最高级的交互。

---

# 四、DSP 引擎（核心实现）

你必须：

# 自己实现 DSP

而不是系统 EQ。

方案：

# ExoPlayer + AudioProcessor

Media3：

```kotlin
AudioProcessor
```

实现：

```kotlin
BaseAudioProcessor
```

处理：

```text
PCM Float32
```

不要：

```text
16-bit short
```

否则会有失真。

---

# EQ 实现方式

Graphic EQ：

```text
IIR Biquad Filters
```

PEQ：

```text
RBJ Audio EQ Cookbook
```

这是业界标准。

---

# 五、FFT 可视化（重点）

# 频谱系统

使用：

```text
FFT
```

实时分析 PCM。

Android 官方 `Visualizer` 也支持 FFT。([Android Developers][3])

但：

# 不要直接用 Visualizer。

因为：

* 精度低
* 8bit FFT
* 会受系统音量影响
* 延迟大 ([Stack Overflow][4])

你应该：

# 自己对 PCM 做 FFT

推荐：

```text
JTransforms
```

或者：

```text
KissFFT
```

---

# 六、猫耳动态频谱（核心特色）

这个会成为你的播放器标志性功能。

---

# 猫耳频谱设计

原理：

把左右声道高频映射到：

```text
耳朵尖尖
```

低频：

映射到底部圆弧。

形成：

```text
 /\    /\
/  \__/  \
```

音乐越激烈：

猫耳抖动越明显。

---

# 动画细节

猫耳：

* 跟随高频节奏摆动
* 会轻微弹性变形
* 峰值时发光
* Beat 时会“炸毛”

实现：

```text
OpenGL ES
Canvas + RenderThread
```

不要普通 View。

否则掉帧。

---

# 七、FFT 主频谱（主视觉）

推荐：

# 双层频谱

---

# 第一层

粗柱状：

```text
▂▃▅▇█▇▅▃
```

代表低频能量。

---

# 第二层

细线波形：

```text
~~~~~~~
```

代表高频细节。

---

# 动画

必须：

* 惯性
* 平滑插值
* 峰值残影
* Glow 发光
* 频率衰减

不要：

```text
生硬跳动
```

会很廉价。

---

# 八、霓虹滑块（重点）

你应该做：

# 发光滑块轨道

包括：

* 滑块发光
* 拖动尾迹
* 呼吸灯
* 高亮渐变

---

# 滑块动画

拖动：

```text
scale 1.0 → 1.08
```

松手：

```text
spring back
```

轨道：

```text
blur glow
```

非常高级。

---

# 九、GPU 渲染（必须）

所有：

* FFT
* Glow
* Blur
* Neon
* 粒子
* 猫耳

全部：

# OpenGL ES

不要：

```text
普通 Canvas
```

否则：

* 频谱一卡一卡
* 发热严重
* 高刷掉帧

---

# 十、EQ 预设（非常重要）

不要只做：

```text
Rock
Jazz
Pop
```

太老了。

你应该做：

# 情绪化预设

例如：

| 名称        | 特征         |
| --------- | ---------- |
| 猫耳低音      | 超低频增强      |
| 深夜电台      | 高频柔化       |
| 东京雨夜      | 空间感增强      |
| 少女乐队      | 女声增强       |
| Vaporwave | 中低频氛围      |
| Cyberpunk | 高频电子感      |
| 赛博低频      | Sub Bass增强 |
| Live现场    | 混响增强       |

这会非常符合你的项目风格。

---

# 光效

不要彩虹。

建议：

```text
蓝紫霓虹
```

或者：

```text
青蓝渐变
```

高级感最强。

---

# 十二、技术栈（最终推荐）

| 模块    | 技术                |
| ----- | ----------------- |
| 播放器   | Media3 ExoPlayer  |
| DSP   | AudioProcessor    |
| EQ    | Biquad            |
| PEQ   | RBJ Cookbook      |
| FFT   | JTransforms       |
| 渲染    | OpenGL ES         |
| UI    | Compose           |
| 动画    | Compose Animation |
| Blur  | RenderEffect      |
| GPU频谱 | GLSurfaceView     |

---

# 十三、最终效果（你应该达到的感觉）

最终效果应该像：

* Sony Walkman
* Poweramp
* Wavelet
* Nothing Music
* Cyberpunk HUD

但：

更 ACG。

用户一打开：

就能看到：

* 猫耳频谱
* 霓虹 EQ
* 呼吸流光
* 实时 FFT
* 深色 AMOLED

而不是：

```text
安卓原生音效面板
```

那种会瞬间廉价。