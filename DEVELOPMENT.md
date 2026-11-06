# Brevia 开发者手册

本手册统一维护开发环境、代码协作、检查、桌面构建与正式发布流程。用户介绍见 [README](README.md)，手机录音、同步与送审详见[手机开发手册](mobile/README.md)，Windows/旧 Electron Worker 协议见[后端 README](backend/README.md)，原生推理接口见[引擎 README](macos/inference/README.md)。

- [macOS 开发与打包](#macos-开发与打包)
- [协作与检查](#协作与检查)
- [正式发布](#正式发布)

## macOS 开发与打包

macOS WebKit 实现面向 Apple Silicon、macOS 14 及以上。安装文件是一个包含全部推理引擎的 DMG：没有 Python、Electron 或 FFmpeg，也不再生成或下载可选 Runtime ZIP。模型权重仍由模型库管理，用户首次选择某个未安装的模型时才下载。

### 试用与升级

先退出旧版 Brevia，再打开 DMG 并将 Brevia 拖入「应用程序」。新版本继续使用原有会议、录音、工作区和已下载模型。首次启动从旧版 Chromium 存储只读迁移语言、主题、工作区、首选转写模型、新手引导、更新策略和下载源。两个版本共用会议目录，请依次运行。

首次打开应用不需要安装推理环境。录音可以离线开始，未下载转写权重时先保存原音，之后对同一场会议补做转写。已下载的模型可以离线使用。FunASR Nano、Qwen3-ASR、Parakeet、GGUF 模型继续使用已有模型 ID 和权重目录。

### 组成

| 部分           | 随应用提供的实现                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 窗口与系统集成 | Rust/Tauri 使用系统 WKWebView；AppKit 提供对话框、打印、窗口和状态栏。                                                    |
| 录音与导入     | Swift 使用 AVAudioEngine/Core Audio 和 ScreenCaptureKit；音频导入优先走系统 AudioToolbox，不支持的 Ogg 由原生解码器处理。 |
| ONNX 推理      | C++ 直接调用 sherpa-onnx 和 ONNX Runtime，支持转写、VAD、说话人分段与声纹嵌入。Silero VAD 权重也随包提供。                |
| MLX 推理       | Swift 直接调用 MLX/Metal，支持现有 FunASR Nano、Qwen3-ASR 和 Parakeet 权重。                                              |
| GGUF 推理      | C++ 直接调用 llama.cpp；本地纪要、实时 AI 笔记和 Hy-MT 翻译独立调度并支持取消。                                           |
| 会议业务       | 随包 Node.js 使用内置 SQLite 接口处理会议、手机同步、工作区、笔记、导出和任务；数据库字段、文件格式及手机协议保持兼容。   |

不依赖用户安装 Node.js 或其他解释器。Node.js 随应用提供；Python 已退出 macOS 的运行和打包路径。仓库的旧 Python 后端仍用于 Windows/Electron 和迁移对照，不进入 WebKit 成品。

### 接入模型

在 `backend/models.json` 注册稳定 ID、平台、权重来源、校验摘要、`runtime` 与 `backend`。WebKit 优先采用带 `macos-webkit` 平台的条目。`models.list` 中全部引擎的 `runtime_tier` 都是 `core`；这个兼容字段不再决定下载运行包。

`capabilities` 按能力名称声明 `input` 和 `output`，支持文本生成、转写、翻译、VAD、音源分离、说话人分段和声纹嵌入。原生业务端定义见 `macos/backend/models.cjs`；例如音源分离声明 `"separation": {"input":"audio","output":"audio_tracks"}`。接入新引擎需要实现对应 JSONL 执行命令、取消与资源释放，并加入完整应用构建。权重下载和执行引擎分开管理，既有模型 ID 不因实现语言变化而重命名。当前音源分离仍是扩展契约，尚未提供分离模型。

### 本地开发与打包

构建需要 Apple Silicon Mac、Xcode（Swift 6.2 或以上）、Metal Toolchain、rustup、CMake 和 Node.js 22.23.1 或以上。首次构建会下载固定版本的原生源码和依赖；构建缓存位于 `dist/native` 和 `macos/inference/.build`。不需要安装 Python。

```sh
xcodebuild -downloadComponent MetalToolchain
npm ci
npm start
```

`npm start` 在 macOS 构建并打开 WebKit 应用；`npm run start:fresh` 会重置新手引导。原生依赖使用构建缓存，修改后重新启动即可测试。`npm run start:electron` 保留旧壳的显式入口，仍使用旧后端，不属于无 Python 的 macOS 路径。

```sh
npm run package:mac       # 仅构建完整 Brevia.app
npm run dist:mac          # 构建完整应用与 DMG
npm run test:backend
npm run test:mac:webkit
```

成品位于 `dist/native/image/Brevia.app` 与 `dist/native/Brevia-WebKit-<版本>-arm64.dmg`。本地默认 ad-hoc 签名，设置 `BREVIA_SIGN_IDENTITY` 可使用钥匙串中的 Developer ID。打包检查每个 Mach-O 的 arm64 架构、macOS 14 最低版本和动态依赖，拒绝 Python 文件、包外运行库及超过 200 MB 的 DMG；正式替换产物前运行打包后录音与落盘测试。构建只生成本地文件。

`npm run test:backend` 和 `npm run test:mac:webkit` 验证新业务后端与原生应用，不需要 Python。完整兼容回归 `npm test` 还包括旧 Electron 端到端和 Python 静态检查，需要旧开发环境；旧后端单测可单独运行 `npm run test:backend:legacy`。原生检查使用临时会议库，验证真实 WKWebView、打包后的控制层与新业务后端、PDF 导出、录音暂停恢复和最后一批 PCM 落盘。`macos/inference/smoke.cjs` 使用本地已下载的真实模型验证各引擎。

正式发布前仍需在 macOS 14 真机核对设备授权、双轨长录音、系统休眠恢复和公证后升级安装。自动更新使用独立 `latest-webkit.json`，生成更新清单还需要安装 [Tauri CLI](https://tauri.app/reference/cli/)，并同时配置 `BREVIA_NATIVE_UPDATE_PUBKEY`、Tauri 私钥和 Developer ID。当前正式 Release 工作流仍生成 Electron 版；macOS WebKit 实现不会自动发布或更改线上资产。

## 协作与检查

手机、桌面、后端和官网共用以下原则；各语言遵循自己的默认工具，不改变接口或数据格式来统一命名。

界面修改沿用现有语义令牌、组件、页面层级与交互状态；维护者在本地统一管理详细协作和 UI 规范。

### 格式与检查

安装开发工具：`npm ci`、`python -m pip install -r requirements-dev.txt`；手机使用与 `.github/workflows/mobile.yml` 一致的 Flutter 版本。

| 范围                                        | 写入格式                | 只检查                                                                        |
| ------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| 桌面、官网 JS / CSS / HTML 和维护文档、配置 | `npm run format`        | `npm run format:check`                                                        |
| 后端与 Python 脚本                          | `npm run format:python` | `npm run lint:python`                                                         |
| 手机 Dart（在 mobile 目录）                 | `dart format lib test`  | `dart format --output=none --set-exit-if-changed lib test`、`flutter analyze` |

格式工具版本固定在锁文件或 `requirements-dev.txt`；升级工具单独提交。Prettier 保留 HTML 空白语义，不重排模板字符串中的嵌入代码；Markdown 不强制重排段落。`frontend/styles.css` 由 `npm run build` 生成，不手动格式化。模型、录音、翻译词条的实际内容、锁文件、第三方文件和原生工程生成配置不做人工风格清理。

Swift 使用与移动端 CI 一致的 Xcode 自带的 `swift-format`（`xcrun swift-format format --in-place <文件>`），CI 使用 `xcrun swift-format lint --strict` 检查；Kotlin 遵循 Android Studio 默认格式。少量 Ruby 和 Shell 脚本沿用语言惯例，不为格式引入额外依赖；分别用 `ruby -c`、`bash -n` 检查语法。原生源码修改后运行对应平台构建。

品牌图形以 `frontend/assets/brevia-logo.svg` 为唯一静态源，字形沿用开屏动画最终定格。安装 ImageMagick 后运行 `npm run assets:brand` 同步桌面、官网、文档和手机资源；`npm run assets:brand:check` 校验产物。不要直接修改生成的图标。

官网导航使用独立的手绘版本 `website/assets/brevia-logo-handdrawn.svg`，其他入口沿用统一品牌图形。

### 代码书写

- JS / Dart 的变量和函数使用 camelCase；Python 使用 snake_case；类名使用 PascalCase。
- 跨端协议、存储字段、IPC 名称和外部 API 字段保持既有约定，修改需要兼容性评估。
- 一行一个独立操作；简单提前返回可以单行，复杂条件、异常处理和多步操作展开。换行与引号以格式工具为准。
- 新增导入按标准库、第三方、本地模块分组。JS 有副作用导入及 Python 初始化顺序不得仅为排序而调整。
- 优先复用已有实现；不按文件行数强制拆分，不为统一外观引入抽象。

### 注释

- 新增或修改的自有代码注释以中文为主，技术名称保留英文；模板和第三方注释保留原文。
- 解释原因、协议约束、安全边界、平台限制和恢复策略，不复述明显的代码操作。
- 接口或复杂协议写简短说明，普通内部函数不强制补注释。
- 历史问题只保留当前仍有效的约束，详细过程放在 Git 或 issue；旧注释在修改相关代码时逐步统一，不批量翻译。
- 临时限制明确描述影响及解除条件；安全与数据恢复注释不能因精简而删除。

### 提交与验证

纯格式调整与功能修改分开提交。不要夹带字段重命名、依赖升级或逻辑重构，也不要覆盖其他人的未提交改动。

提交前运行上述范围内的格式与静态检查。桌面/后端修改运行 `npm test`；手机修改在 `mobile` 下运行 `flutter test`；发布脚本修改运行 `ruby mobile/scripts/test-release.rb`。网站演示修改运行 `node_modules/.bin/electron scripts/test-website-demos.cjs`（需要桌面环境）。格式检查由 CI 执行，不在发布流程里自动重写源码。

## 正式发布

发布任何版本前逐项确认。本指南保留可复用的检查与 CI 流程；证书、登录信息和本机路径由维护者在仓库外管理。

本页下列步骤用于桌面版本。每次 iOS 送审前必须重新阅读[手机正式发布流程](mobile/README.md#正式发布)，优先通过现有 API / CI 提交，并回读正式审核状态；Android 分发也见该指南。

### 1. 版本号（三处，只有一处是自动的）

| 位置                                  | 内容                                                                           | 谁负责                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `package.json` / `package-lock.json`  | `version`                                                                      | 使用 `npm version` 同步更新                                                       |
| `frontend/changelog.js` 的 `releases` | 新增一条 `{ version, date, current: true }`，并把上一条的 `current: true` 去掉 | 手动；`test-ui.mjs` 只守住「恰好一条 current 且它是最新一条」，条目的增补仍需人工 |
| `docs/releases/v<version>.md`         | GitHub Release Notes                                                           | 手动，发布前确认文件存在                                                          |

`releases` 漏更新的后果：应用内「更新日志」把上一个版本标成当前版本。
`current` 只能有一条，顺序按版本从新到旧。

### 2. 内容与文案

- [ ] `releases` 新条目按实际改动写 `summary` 与 `what` / `improved` / `fixed` / `security` / `changes`，至少 `zh` + `en`（其余语言回退到 `en`）。条目使用 `{ text, commit }`，引用已存在的真实提交；旧版字符串条目继续展示。
- [ ] `docs/releases/v<version>.md` 与 `releases` 口径一致；增加 `previousVersion` 完整对比链接，按 Git 历史核对首次贡献者后填写 `contributors: [{ login, pr }]`。当前版本展开、历史版本折叠。
- [ ] 用户可见行为变化同步到**所有** `README.md` 与 `docs/README.*.md`（例如停顿阈值、模型列表、识别模型选择说明）。
      只改 `README.md` + `docs/README.zh-CN.md` 会让其余语言继续描述已下线的功能——本清单以前就只写了这两个文件。
- [ ] 面向访客的功能描述同步到 `website/index-zh.html` / `website/index-en.html`（下载链接由 CI 自动更新，正文不会）。
- [ ] 基准报告、诊断脚本里的数字与类名/用例名指向当前代码（删除的功能不要留在文档里）。

### 3. 代码卫生（发版前最后一遍）

- [ ] 没有历史兼容分支：下架的功能不留占位字段、别名、空函数钩子或「保留旧客户端字段」的注释。
- [ ] 删除的配置项同时从 `backend/settings.json` 移除；用户覆盖文件的多余键由 `config._prune_to_template` 统一丢弃。
- [ ] 删除的模型 ID 同步从 `backend/config.py` 的 `BUNDLED_MODEL_IDS` 移除（否则 `pack:backend` 会以 `Unknown model` 直接失败）。
- [ ] 没有只写不读的状态、没有无调用方的函数、没有只被演示数据触发的渲染分支。
- [ ] 删掉的功能同时删掉它的 CSS 类与 i18n 文案。
- [ ] 新增的手写组件类二选一：颜色走语义令牌（`text-(--color-…)` / `var(--color-…)`），或者补一条 `html[data-theme="dark"]` 规则；两者都不做会被 `test-ui.mjs` 的暗色覆盖门禁拦下。
- [ ] 新增令牌时浅色/暗色必须成对（`@theme` 与暗色令牌块），令牌成对门禁会检查。
- [ ] 大范围改颜色（令牌化、删暗色覆盖）后，用 `npm run css:fingerprint before.json` / `after.json`
      对比计算样式，确认没有超出运行间噪声基线的差异（用法与已知噪声见脚本头部说明）。
- [ ] 模型清单（`models.json`）的每处消费方都跟着改：新增/退役整句识别模型时，`refined_priority`、
      `timestampAlignedRefinedModels`、`asr-copy.js` 的文案都必须同步（`test-ui.mjs` 里有联动断言）。
- [ ] 退役一个模型时，检查它是否还能被下载（`ModelManager.download` 必须拒绝 `retired`），
      以及引用它的会议记录在 live / 精修两条路径上都会被修复。

### 4. 验证

```bash
npm test              # 死代码门禁 + Electron 逻辑 + UI 结构 + E2E 冒烟 + 后端用例
ruff check backend/   # 必须 All checks passed
npm run build         # tailwind.css → styles.css，构建后 styles.css 应无额外差异
```

- [ ] 上述命令全绿。
- [ ] 手写组件类与 `styles.css` 同步（`npm run build` 后 `git diff frontend/styles.css` 只包含本次改动）。
- [ ] 启动一次应用：完成引导 → 录一段（或导入音频）→ 会后精修 → 导出，确认无控制台报错。

### 5. 打包与发布

先提交版本号、更新日志和 release note，确认待发布提交已通过检查，再由维护者创建并推送 `v<version>` 标签。[Release 工作流](.github/workflows/release.yml)在标签推送时构建并发布 macOS 和 Windows 安装包；也支持手动触发。签名和发布凭据由维护者配置，普通贡献者无需持有。

本机仅构建安装包时运行：

```bash
npm run release:offline
```

`pack:backend` 现在会在打包开始时就校验出厂模型清单，模型下架不同步会立刻失败，而不是等到用户机器上。

### 6. 发布后

- [ ] 确认 GitHub Release 里的 `Brevia-<version>-arm64.dmg` 与 `Brevia-<version>-x64-setup.exe` 存在。
- [ ] 确认 CI 已更新官网与各语言 README 的下载链接（`scripts/update-release-links.mjs`）。
- [ ] 在应用内「更新日志」里确认新版本被标为当前版本。
