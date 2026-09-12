<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="言录" /></p>

<p align="center"><strong>极简设计，本地部署的 AI 会议助手。</strong><br />AI 笔记 · 实时转写 · 多语言 · 说话人识别 · 可审阅总结 — 音频不出本机。</p>

<p align="center">
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/v/release/zerolovesea/Brevia?style=flat-square" alt="Release" /></a>
  <a href="https://github.com/zerolovesea/Brevia/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zerolovesea/Brevia?style=flat-square" alt="License" /></a>
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/downloads/zerolovesea/Brevia/total?style=flat-square" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-43-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
</p>

<p align="center"><a href="../README.md">English</a> · <strong>简体中文</strong> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

---

## 项目简介

言录是一款桌面端 AI 会议助手，把会议里最耗时间的部分——记录、整理、复盘——交给设备上的 AI。它同时录制麦克风和系统音频，实时生成字幕，会后自动整理成结构化笔记；会议进行中，AI 笔记会及时提示值得记录的内容。所有语音识别都在本机运行，录音、文字稿、说话人档案默认保存在你自己的电脑上。

设计上追求"少即是多"：界面尽可能安静，不打扰会议本身；功能围绕"记录 → 理解 → 检索"这条主线展开；能本地做的绝不发到云端。

<p align="center"><img src="assets/demo/ai-assist-zh.gif" width="820" alt="言录 AI 辅助笔记演示" /></p>

## 功能介绍

### AI 笔记：提示由你审核

AI 会跟随实时逐字稿，识别决策、待办、关键数字、风险、问题和话题切换。可选择仅按需触发、轻度提醒或自动整理。所有建议都先由你审核：只把有用的内容加入笔记，并可用富文本或 Markdown 继续编辑。

AI 笔记与 AI 会议总结可分别配置供应商、模型和 API Key。使用远程服务时，只会发送逐字稿文本与当前笔记上下文，音频始终留在本机；本地模型按需加载，分开配置不会同时常驻两个模型。

![AI 笔记](assets/tour/zh/AI辅助笔记.png)

### 识别模型怎么选

首次引导会列出可下载的语音模型，并按界面语言预勾选建议项（Silero VAD、说话人分离与声纹模型随包安装，无需选择）；下载前可以自行取消其余模型。

之后每场会议，言录按**会议语言**选默认识别模型，归属关系声明在 `backend/models.json` 里：

| 会议语言 | 默认识别模型 | 说明 |
| --- | --- | --- |
| 中文、粤语 | FunASR Nano int8 | 中文及中文方言准确率最高 |
| 日语、韩语 | Qwen3-ASR 0.6B int8 | 可选模型里唯一同时覆盖日韩的一个 |
| 英语、西班牙语、法语、德语、俄语、多语言混说 | Parakeet TDT 0.6B v3 | 一个模型覆盖 25 种欧洲语言，自带标点与时间戳 |
| 其他语言 | Qwen3-ASR 0.6B int8 | 其余模型里覆盖语言最广的一个 |

若声明的默认模型尚未下载，言录会改用**已安装且支持该语言**的模型，而不是让你再下一个。准备页提供「识别模型」下拉（未下载的模型也会列出体积），实时页是同一个切换器，会中即可通过 `meeting.reconfigure` 热切换。**设置 → 进阶 → 实时识别**里的 `live_asr.max_speech_seconds` 可以限制单段实时字幕最长能攒到多少秒；实际生效值始终是该值、语言级 VAD 配置与模型自身容量三者的最小值。

性能较低的设备建议使用 2B 内置 AI 笔记模型或在线服务。

### 极简的会议界面，实时转写和翻译

打开就录，每次说完停顿后输出整句字幕，无需切窗口。同时抓取麦克风与系统音频，远程会议里你和对方的声音都能被完整记录。可选的实时翻译在字幕旁并列显示，方便跨语言协作。

![实时会议和翻译](assets/tour/zh/%E5%AE%9E%E6%97%B6%E4%BC%9A%E8%AE%AE%E5%92%8C%E7%BF%BB%E8%AF%91.png)

### 多语言支持 + 会后 AI 会议纪要

言录支持 30+ 种语言的语音转写，涵盖中文、英语、日语、韩语、法语、德语、西班牙语、俄语、阿拉伯语、泰语、越南语、印尼语等。会议结束后，可连接大模型，根据审核后的逐字稿生成会议摘要、关键决策和待办事项。

内置 AI 可在本机直接运行捆绑模型，也可以接入 Claude、OpenAI、OpenRouter，或任意兼容 OpenAI / Anthropic 格式的自建服务。摘要只发送文本，不上传音频。

### 声纹注册 + 跨会议说话人识别

给团队成员录一段声音样本，言录就能在之后的每一场会议里认出他们——不只是"说话人 1、说话人 2"，而是真实的姓名。跨录音识别、自动归档，回看时一眼就能找到"张三上周说过什么"。

底层用 Pyannote 分段 + 声纹嵌入模型，全部在本机运行。

![注册声纹识别](assets/tour/zh/%E6%B3%A8%E5%86%8C%E5%A3%B0%E7%BA%B9%E8%AF%86%E5%88%AB.png)

### 丰富的本地模型库

可下载模型覆盖整句转写、离线精修、语音活动检测、说话人分离、声纹嵌入、AI 笔记与会议纪要，以及字幕翻译。可以按语言和精度自由组合，全部在设备上运行。

![模型库](assets/tour/zh/%E6%A8%A1%E5%9E%8B%E5%BA%93.png)

### 更多能力

- **音频导入** — 已有的会议录音可直接导入离线转写，共用同一套语音管线。
- **多格式导出** — 逐字稿 / 笔记支持 Markdown、TXT、JSON、SRT、DOCX、PDF；音频支持 FLAC、WAV、M4A。
- **可审阅笔记** — 富文本或 Markdown 自由编辑，只采纳真正有用的 AI 建议。
- **会议库与工作区** — 搜索标题、逐字稿、说话人和标签；用工作区归类，并可在 30 天内恢复最近删除的会议。
- **专注查看** — 明暗主题、逐字稿/摘要内联编辑和可选悬浮字幕，让会议界面保持清爽。
- **多语言界面** — 英语、简体中文、西班牙语、日语、韩语、法语、德语、俄语。

## 安装

从 [GitHub Releases](https://github.com/zerolovesea/Brevia/releases) 下载最新版本：

| 平台 | 安装包 |
| --- | --- |
| macOS (Apple Silicon) | `Brevia-<version>-arm64.dmg` |
| Windows (x64) | `Brevia-<version>-x64-setup.exe` |

> Windows 首次运行可能弹出 **Microsoft Defender SmartScreen** 提示。点击 **"更多信息" → "仍要运行"**，确认下载来源是官方 Releases 页面后继续即可。

首次启动请授予麦克风与屏幕录制权限，并进入 **设置 → 模型库** 下载所需语言的模型。

## 架构

```mermaid
flowchart LR
  A[Electron 渲染进程<br/>HTML · Tailwind · JS] <-->|IPC + Zod 校验| B[Electron 主进程]
  B <-->|JSONL stdin/stdout| C[Python Worker<br/>内置运行时]
  C --> D[sherpa-onnx<br/>VAD → 整句 ASR · 说话人]
  C --> E[本地存储<br/>SQLite · 音频 · 导出]
  C -. 显式授权 .-> F[可选云端 API<br/>LLM 摘要 · 翻译]
```

言录采用严格的本地优先架构：

- **渲染进程不打开任何网络端口**，所有跨进程通信由 Electron 主进程用 Zod schema 校验。
- **主进程只是壳**，启动一个 Python Worker，通过 JSONL over stdin/stdout 通信；Worker 负责模型管理、音频处理、说话人档案、本地存储、导出等所有重逻辑。
- **数据默认存放在 `~/brevia`**，包括 SQLite 数据库、原始音频、导出文件、模型缓存和声纹档案。
- **云端调用是可选的**，仅用于 LLM 摘要和翻译，需要用户显式配置服务商并授权后才启用，且只发送文本。

录音链路采用 **Silero VAD 分段 → 单次高精度识别 → 完整字幕**。中文停顿 0.7 秒、其他语言停顿 0.8 秒后触发；连续发言最长 30 / 20 秒切段，可在高级设置 `vad` 调整。VAD 按声音停顿分段，一段可能含多个语法句，字幕再把相邻的句子攒成段落：中文约 110 字（上限 150 字）、英文约 280 字符（上限 380 字符）为一段，短句不会单独成段。**VAD 端点不作为段落边界**——实测真实会议里端点之后的静音中位数只有 30–50 毫秒，按端点切会得到平均 24 字的碎片段；只有真正的长停顿（≥1.2 秒）才另起一段，不足目标的段落最多滞留 8 秒后兜底提交。连续语音被切开时，下一段解码会回看切点前 400 毫秒，让切在词中间的字在新的上下文里被完整识别，重复部分按接缝对齐去重。停止录音会处理完末句，识别失败仍保留原始录音。

参见[基准测试报告](../backend/benchmarks/vad-2026-09-05/REPORT.md)。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面外壳 | Electron 43 — preload 桥接、context isolation、渲染器沙箱 |
| 前端 | 原生 HTML/CSS/JS、Tailwind CSS 4、内置 i18n（8 种语言） |
| 后端 | Python 3.10+、JSONL Worker 协议、SQLite 存储 |
| 语音引擎 | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 1.13.2、ONNX Runtime |
| 说话人处理 | Pyannote 分段 + 3D-Speaker ERes2Net Base 声纹嵌入 |
| LLM 客户端 | 内置 llama.cpp（GGUF）+ 兼容 OpenAI / Anthropic 的标准 API |
| 音频 I/O | ffmpeg（发行版内置） |
| 构建打包 | electron-builder、PyInstaller（打包原生 Python 运行时） |

## 支持的模型

整句识别、会后精修、AI 笔记与字幕翻译模型可在应用内 **设置 → 模型库** 按需下载；语音活动检测、说话人分离与声纹模型随应用安装。模型清单声明在 [`backend/models.json`](../backend/models.json)。

| 类型 | 代表模型 | 语言 |
| --- | --- | --- |
| 整句识别 / 会后精修 | FunASR Nano int8、Qwen3-ASR 0.6B、Parakeet TDT 0.6B v3 | 中文 / 多语言 / 25 种欧洲语言 |
| 语音活动检测 | Silero VAD | 通用 |
| 说话人分离 | Pyannote Segmentation 3.0 | 通用 |
| 声纹嵌入 | 3D-Speaker ERes2Net Base | 中文 |
| AI 笔记与会议纪要 | Qwen 3.5 2B、Qwen 3.5 4B | 中文 / 英语 |
| 字幕翻译 | Tencent Hy-MT2 1.8B | 33 种语言 |

LLM 摘要可以选「内置 AI」在本机运行捆绑的 GGUF 模型（Qwen 3.5 2B / 4B），也可以接入 Claude、OpenAI、OpenRouter，或任意兼容 OpenAI Chat Completions / Anthropic Messages 的自建服务——例如 Gemini（OpenAI 兼容端点）、DeepSeek、Kimi、通义千问等。

## 本地开发

前置依赖：Node.js 18+、Python 3.10+、Git、ffmpeg（用于音频导入）。

```bash
git clone https://github.com/zerolovesea/Brevia.git
cd Brevia
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

首次启动按提示授予麦克风和屏幕录制权限，然后进入 **设置 → 模型库** 下载所需模型。

### 常用脚本

```bash
npm test                    # 死代码门禁 + Electron 行为 + UI + E2E 冒烟 + 后端测试
npm run test:e2e            # 启动真实应用并通过 CDP 断言
npm run build               # 构建 Tailwind CSS
npm run test:model          # ASR 模型诊断
npm run test:diarization    # 说话人分离诊断
npm run start:fresh         # 重置引导流程后启动
```

### 环境变量

```bash
# 自定义数据目录（录音、导出、SQLite）
BREVIA_DATA_DIR=/path/to/data

# 自定义模型目录
BREVIA_MODELS_DIR=/path/to/models

# 指定 ffmpeg 路径（如未在 PATH 中）
BREVIA_FFMPEG=/path/to/ffmpeg

BREVIA_DATA_DIR=~/brevia-dev BREVIA_MODELS_DIR=~/brevia-models npm start
```

### 构建安装包

```bash
npm ci
npm run build
python3 -m pip install -r backend/requirements-build.txt
npm run dist:mac   # macOS ARM64 DMG
npm run dist:win   # Windows x64 EXE
```

产物输出到 `dist/`。每个平台构建都会打包原生 Python Worker（内含语音活动检测、说话人分离与声纹模型）；识别、精修、AI 笔记与翻译模型由应用按需下载。

## 常见问题

<details>
<summary><strong>Windows 打开时弹出 Microsoft Defender SmartScreen 警告</strong></summary>

发布构建未做付费代码签名，SmartScreen 会对新出现的可执行文件默认拦截。点击 **"更多信息" → "仍要运行"**，确认下载来源是官方 [Releases](https://github.com/zerolovesea/Brevia/releases) 页面后继续即可。
</details>

<details>
<summary><strong>需要单独安装 Python 吗？</strong></summary>

不需要。发布版内置了 Python 运行时和所有依赖。只有从源码运行时才需要本机 Python 环境。
</details>

<details>
<summary><strong>数据存储在哪里？</strong></summary>

默认在 `~/brevia`，包含录音、逐字稿、导出文件、模型缓存、声纹档案和 SQLite 数据库。设置 `BREVIA_DATA_DIR` 可自定义位置。
</details>

<details>
<summary><strong>支持哪些语言的转写？</strong></summary>

30+ 种语言，包括中文、英语、日语、韩语、法语、德语、西班牙语、俄语、阿拉伯语、泰语、越南语、印尼语等。在应用内「模型库」中选择对应语言的模型即可。
</details>

<details>
<summary><strong>言录会把音频发送到云端吗？</strong></summary>

不会。所有语音识别和说话人分离都在本机运行。只有 LLM 摘要 / 翻译需要联网，且必须由用户显式配置服务商——只发送文本，不上传音频。
</details>

<details>
<summary><strong>模型需要多少磁盘空间？</strong></summary>

取决于所选模型。整句识别模型是主要占用；语音活动检测、说话人分离与声纹模型随应用安装，可按需另装 AI 笔记模型；具体大小以模型库显示为准。
</details>

<details>
<summary><strong>可以导入已有的会议录音吗？</strong></summary>

可以。从会议库导入音频，言录会用同一套语音管线离线转写。需要系统 PATH 中有 `ffmpeg`（或设置 `BREVIA_FFMPEG`）。
</details>

<details>
<summary><strong>如何切换界面语言？</strong></summary>

**设置 → 通用 → 界面语言**。目前提供英语、简体中文、西班牙语、日语、韩语、法语、德语、俄语。
</details>

<details>
<summary><strong>声纹样本是怎么存储的？</strong></summary>

声纹嵌入向量（几百维浮点数组）和参考音频保存在本地 SQLite 与文件系统中，不会离开本机；删除档案时对应数据也会一并清除。
</details>

## 反馈与贡献

### 提交 Issue

发现 Bug 或有新功能建议？欢迎前往 [GitHub Issues](https://github.com/zerolovesea/Brevia/issues) 提交。为了让问题更快得到定位，请尽量提供：

- 操作系统与版本（如 macOS 14.5 / Windows 11 23H2）
- 言录版本号（**设置 → 关于**）
- 使用的模型和语言
- 复现步骤 / 期望结果 / 实际结果
- 相关日志（**设置 → 高级 → 打开日志目录**），提交前请自行确认不含敏感信息

安全类问题请**不要公开发 Issue**，请通过邮件联系维护者。

### 参与贡献

欢迎 PR。为了保持代码质量，请遵循几点约定：

1. 从 `main` 切出聚焦分支，保持改动精简；一个 PR 只做一件事。
2. 提交前运行 `npm test`；涉及 ASR 或说话人分离时额外跑 `npm run test:model` 和 `npm run test:diarization`。
3. 不要提交模型文件、录音、导出文件、API 密钥或 `~/brevia` 目录里的任何本地数据。
4. 修改界面文案时，请同步维护所有八种语言（`frontend/i18n-data.js`）；添加英文源字符串时把翻译一起补上。
5. 在 PR 描述中说明改动对模型、平台或系统权限的影响，方便审阅。

## License

言录使用 [ISC License](../LICENSE) 发布。模型文件与第三方依赖遵循各自的许可证条款。

## 致谢

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — 本地 ASR、VAD、标点和说话人处理的核心运行时，采用 [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) 许可。
- 感谢 [`backend/models.json`](../backend/models.json) 中声明的所有模型作者与维护者，包括 Qwen3-ASR、FunASR、Parakeet（NeMo）、Pyannote、3D-Speaker、Silero、Qwen 和 Tencent Hy-MT2。
- Electron、ONNX Runtime、Python 以及整个开源语音社区，让本地优先的会议工作流成为可能。
