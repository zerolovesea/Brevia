# Brevia 开发者手册

本手册统一维护开发环境、代码协作、检查、桌面构建与正式发布流程。用户介绍见 [README](README.md)，手机录音、同步与送审详见[手机开发手册](mobile/README.md)，模型与配置资源见[后端 README](backend/README.md)，原生推理接口见[引擎 README](macos/inference/README.md)。

- [原生桌面开发与打包](#macos-开发与打包)
- [Windows 开发与打包](#windows-开发与打包)
- [协作与检查](#协作与检查)
- [正式发布](#正式发布)

## macOS 开发与打包

macOS WebKit 实现面向 Apple Silicon、macOS 14 及以上。安装文件是一个包含全部推理引擎的 DMG：没有 Python、Electron 或 FFmpeg，也不再生成或下载可选 Runtime ZIP。模型权重仍由模型库管理，用户首次选择某个未安装的模型时才下载。

### 试用与升级

先退出旧版 Brevia，再打开 DMG 并将 Brevia 拖入「应用程序」。新版本继续使用原有会议、录音、工作区和已下载模型。首次启动从旧版 Chromium 存储只读迁移语言、主题、工作区、首选转写模型、新手引导、更新策略和下载源。两个版本共用会议目录，请依次运行。

首次打开应用不需要安装推理环境。录音可以离线开始，未下载转写权重时先保存原音，之后对同一场会议补做转写。已下载的模型可以离线使用。FunASR Nano、Qwen3-ASR、Parakeet、GGUF 模型继续使用已有模型 ID 和权重目录。

### 组成

| 部分           | 随应用提供的实现                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 窗口与系统集成 | Rust/Tauri 使用系统 WKWebView；AppKit 提供对话框、打印、窗口和状态栏。                                                                                |
| 录音与导入     | Swift 使用 AVAudioEngine/Core Audio Tap（macOS 14.4+），旧系统使用 ScreenCaptureKit；音频导入优先走系统 AudioToolbox，不支持的 Ogg 由原生解码器处理。 |
| ONNX 推理      | C++ 直接调用 sherpa-onnx 和 ONNX Runtime，支持转写、VAD、说话人分段与声纹嵌入。Silero VAD 权重也随包提供。                                            |
| MLX 推理       | Swift 直接调用 MLX/Metal，支持现有 FunASR Nano、Qwen3-ASR 和 Parakeet 权重。                                                                          |
| GGUF 推理      | C++ 直接调用 llama.cpp；本地纪要、实时 AI 笔记和 Hy-MT 翻译独立调度并支持取消。                                                                       |
| 会议业务       | 随包 Node.js 使用内置 SQLite 接口处理会议、手机同步、工作区、笔记、导出和任务；数据库字段、文件格式及手机协议保持兼容。                               |

Node.js 随应用提供，两端共用同一业务层与 C++ 推理引擎。旧 Electron 壳、Python 后端及对应开发入口已删除，应用不依赖用户安装解释器。

长会议纪要按上下文容量和语言估算分段，预留指令与成稿空间。内置模型按实际加载窗口和模型目录上限计算；未提供窗口的在线模型按 8192 token 估算。本地串行，在线最多三个请求同时处理。成功提取且含有效来源的片段保存在会议库内；重新生成时按原文、语言、模型、服务地址和提示词核对复用，随会议永久删除。合并后的行动、决定和数字与分段来源核对，仅对字幕中可逐字确认的遗漏自动补写。

### 接入模型

在 `backend/models.json` 注册稳定 ID、平台、权重来源、校验摘要、`runtime` 与 `backend`。macOS 优先采用带 `macos-webkit` 平台的条目，Windows 使用 `windows` 条目。`models.list` 中全部引擎的 `runtime_tier` 都是 `core`；这个兼容字段不再决定下载运行包。

`capabilities` 按能力名称声明 `input` 和 `output`，支持文本生成、转写、翻译、VAD、音源分离、说话人分段和声纹嵌入。原生业务端定义见 `macos/backend/models.cjs`；例如音源分离声明 `"separation": {"input":"audio","output":"audio_tracks"}`。接入新引擎需要实现对应 JSONL 执行命令、取消与资源释放，并加入完整应用构建。权重下载和执行引擎分开管理，既有模型 ID 不因实现语言变化而重命名。当前音源分离仍是扩展契约，尚未提供分离模型。

### 本地开发与打包

构建需要 Apple Silicon Mac、Xcode 26.4.1 或以上（Swift 6.3）、Metal Toolchain、rustup、CMake 和 Node.js 22.23.1 或以上。固定的 MLX Swift 0.33.0 依赖要求 Swift 6.3；桌面 CI 统一使用 Xcode 26.4.1。首次构建会下载固定版本的原生源码和依赖；构建缓存位于 `dist/native` 和 `macos/inference/.build`。不需要安装 Python。

```sh
xcodebuild -downloadComponent MetalToolchain
npm ci
npm start
```

`npm start` 在 macOS 构建并打开 WebKit 应用；`npm run start:fresh` 会重置新手引导。原生依赖使用构建缓存，修改后重新启动即可测试。

```sh
npm run package:mac       # 仅构建完整 Brevia.app
npm run dist:mac          # 构建完整应用与 DMG
npm run test:backend
npm run test:mac:webkit
```

成品位于 `dist/native/image/Brevia.app` 与 `dist/native/Brevia-WebKit-<版本>-arm64.dmg`。本地默认 ad-hoc 签名，设置 `BREVIA_SIGN_IDENTITY` 可使用钥匙串中的 Developer ID。打包检查每个 Mach-O 的 arm64 架构、macOS 14 最低版本和动态依赖，拒绝 Python 文件、包外运行库及超过 200 MB 的 DMG；正式替换产物前运行打包后录音与落盘测试。构建只生成本地文件。

`npm test` 包括死代码检查、桌面控制器、UI、Playwright 端到端、Node 后端、Agent 与发布回归；首次运行前执行 `npx playwright install chromium`。Playwright 只用于开发检查，不进入安装包。`npm run test:backend` 可单独验证业务后端；`npm run test:mac:webkit` 使用临时会议库检查真实 WKWebView、包内控制层、PDF 导出、录音暂停恢复和最后一批 PCM 落盘。`macos/inference/smoke.cjs` 使用本地真实模型验证各引擎。

macOS 14.4+ 的系统声音使用公开 Core Audio Tap API，仅申请音频录制权限；14.0–14.3 保留 ScreenCaptureKit。权限查询不会探录音，也不以录屏权限代替音频权限；公开 API 无法查询时返回 `screen: "unknown"`（保留既有协议字段），界面显示“录音时确认”。主动请求通过临时启动并释放 Tap 触发系统授权，检测到真实声音时返回 `true`，没有检测到声音时返回 `null`，首次尚未确认时，界面保留申请记录与重新检测入口；实际采集成功后本地记住确认结果，后续启动显示“已允许”。该记录表示上次确认成功，公开 API 无法同步用户在系统设置里的撤销操作。系统静音时不能推断授权结果。发布前额外验证延迟确认、拒绝后恢复、耳机／扬声器切换、采样率变化及双轨暂停收尾。

正式发布前仍需在 macOS 14 真机核对设备授权、双轨长录音、系统休眠恢复和公证后升级安装。自动更新使用独立 `latest-webkit.json`，生成更新清单还需要安装 [Tauri CLI](https://tauri.app/reference/cli/)，并同时配置 `BREVIA_NATIVE_UPDATE_PUBKEY`、Tauri 私钥和 Developer ID。正式 Release 同时构建 macOS 原生版与 Windows 原生版。v1.4.5 的 Electron 更新器从 ModelScope 读取 `latest-mac.yml`（macOS）或 `latest.yml`（Windows）。v2.0.0 是桌面大版本更新：在 v1.4.5 内保存录音，等待后台任务结束，再检查并安装更新。此次 Release 同时生成旧版清单，macOS 指向符合旧版签名要求的 Brevia.app ZIP，Windows 指向同一份 x64 安装器。Windows 的旧版清单指向 v2.0.1，macOS 的旧版清单继续指向 v2.0.0。后续 Release 保留这两份清单及对应文件；完成迁移的桌面应用通过 `latest-webkit.json` 或 `latest-windows.json` 在应用内更新。

## Windows 开发与打包

Windows 10/11 x64，CPU 需支持 AVX2。Rust/Tauri 使用 WebView2；界面、Node 业务层、SQLite 数据和 Agent/MCP 与 macOS 共用。C++ 使用 WASAPI 采集麦克风与系统回环音频，Media Foundation 解码系统支持的音视频，miniaudio/Opus 补充 WAV、FLAC、MP3、Ogg 等格式。不打包 Python、Electron、FFmpeg。Windows N 缺少媒体组件时，仍能处理原生解码器支持的格式。

构建需要 Node.js 22.23.1、Rust MSVC 工具链、Visual Studio C++ Build Tools、Windows SDK、CMake 和 Tauri CLI 2.12.2。

NSIS 3.11 与 Tauri NSIS 插件 0.5.3 在打包前按固定 SHA256 下载并校验，临时网络失败最多尝试三次。Windows 打包和升级测试下载 GitHub Release 资产时，第二次尝试通过官方资产 API 获取相同文件，所有入口使用同一 SHA256。归档保存在 `dist/native-win/sources`，复用原生 CI 与 Release 的源码缓存；每次打包从已校验归档准备工具，不依赖 Tauri 的单次在线下载。

```powershell
npm ci
cargo install tauri-cli --version 2.12.2 --locked
npm start                  # 构建并启动原生版
npm run start:fresh         # 同上，并重置新手引导
npm run dist:win            # 构建 NSIS 安装包
npm run test:windows:native
```

输出为 `dist/native-win/app/` 和 `dist/native-win/Brevia-<版本>-x64-setup.exe`。原生依赖固定版本并校验 SHA256。必要推理引擎和 Node 始终随包提供，不下载推理运行包。Windows 复用系统 WebView2，安装包只内置小型引导程序；已安装 WebView2 时不下载，缺失时在安装阶段联网补装。没有 WebView2 的离线机器需由管理员预装微软运行时。模型权重仍按所选模型下载；macOS 的 MLX 模型由 Windows 的 ONNX/GGUF 实现承担相应功能，不能直接运行 MLX 权重。当前 Windows 推理使用 CPU，不保证与 Apple Silicon 的 Metal 性能相同。

从 Windows 正式版 v1.4.3 或 v1.4.5 升级至 v2.0.1 会按版本校验旧卸载器并清理旧程序文件，保留会议、模型和原安装目录。未列入校验范围的版本或卸载器被修改时拒绝自动执行，先保留应用数据手动卸载旧版再安装。应用内更新前保存录音并等待后台任务结束，旧版会在启动安装器时自行退出。安装器先检查 AVX2 能力，再迁移旧安装；不强行结束正在运行的 Brevia。原生更新清单为 `latest-windows.json`，与 macOS 分开。

`npm start` 在两端都复用原生依赖的编译缓存，但仍重新组装应用；`start:fresh` 只额外重置引导，不清会议。`npm run clean` 回收可重建的原生编译目录，保留安装包和已下载模型；下次启动会重新编译。`npm run clean:dist` 删除整个 `dist`（包括本地安装包与下载缓存），先退出其中运行的应用。

### 手机导入与实时说话人

离线手机录音先按序上传并在电脑持久化完整 PCM；电脑确认 `received` 后手机结束发送，可离开应用。桌面持久化队列独立完成导入与完整转写，重启后恢复；缺模型或处理失败不删除原音。实时手机会议继续边录边传，不能把上传完成误当作识别完成。

实时字幕沿用 v1.4.5 的分段。先显示草稿，保留切点处的尾句，等下一段识别结果到达后修复接缝、合并短句，再提交正式段落。声纹模型的安装状态不改变字幕内容、分段或转写次数。字幕落盘后，已安装的 ERes2Net 在独立低优先级进程中异步补充说话人。它使用段落覆盖的原始 VAD 有声区间，排除回看前缀和静音间隙。如果字幕切在一次发声中间，保留未知身份。

不足 1 秒的语音不识别人，1–2 秒只匹配已有身份，至少 2 秒才允许创建或更新临时中心。注册声纹与临时身份共同比较，歧义、混声或证据不足时保持未知；多个窗口全部一致后才写回姓名。中心只在字幕修订及人工更正检查通过后学习，不自动修改用户注册声纹。每轮最多计算一个 4 秒窗口，单线程、至少间隔 8 秒，并按实际推理耗时退避；字幕积压时让出资源。队列及窗口数量有上限，30 秒过期丢弃，暂停/结束取消，闲置释放模型。持续无停顿换人、重叠发言及未能及时确认的片段由会后精修处理。

算法思路参考 [sherpa-onnx 的 VAD 后身份识别示例](https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/python-api-examples/speaker-identification-with-vad.py)、[Screenpipe 的识别与学习时长门槛](https://github.com/screenpipe/screenpipe/blob/25868de50b2daa73b118c8588c99fa5f123ad549/crates/screenpipe-audio/src/speaker/identify_gate.rs)和[身份歧义拒绝及中心更新](https://github.com/screenpipe/screenpipe/blob/25868de50b2daa73b118c8588c99fa5f123ad549/crates/screenpipe-db/src/db/speakers.rs)，在现有 Node/C++ 结构内独立实现。

## 协作与检查

手机、桌面、后端和官网共用以下原则；各语言遵循自己的默认工具，不改变接口或数据格式来统一命名。

界面修改沿用现有语义令牌、组件、页面层级与交互状态；维护者在本地统一管理详细协作和 UI 规范。

### 格式与检查

安装开发工具：`npm ci`、`python -m pip install -r requirements-dev.txt`；手机使用与 `.github/workflows/mobile.yml` 一致的 Flutter 版本。

| 范围                                        | 写入格式                | 只检查                                                                        |
| ------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| 桌面、官网 JS / CSS / HTML 和维护文档、配置 | `npm run format`        | `npm run format:check`                                                        |
| 手机与发布 Python 脚本                      | `npm run format:python` | `npm run lint:python`                                                         |
| 手机 Dart（在 mobile 目录）                 | `dart format lib test`  | `dart format --output=none --set-exit-if-changed lib test`、`flutter analyze` |

官网手机演示直接使用 Flutter 扫码、会议设置和实时转写页面。从仓库根目录运行 `(cd mobile && flutter build web --target=web/preview.dart --output=../website/mobile-preview --no-web-resources-cdn --no-tree-shake-icons)` 后，通过 HTTP 服务打开官网。GitHub Pages 使用同一命令构建手机界面。

格式工具版本固定在锁文件或 `requirements-dev.txt`；升级工具单独提交。Prettier 保留 HTML 空白语义，不重排模板字符串中的嵌入代码；Markdown 不强制重排段落。`frontend/styles.css` 由 `npm run build` 生成，不手动格式化。模型、录音、翻译词条的实际内容、锁文件、第三方文件和原生工程生成配置不做人工风格清理。

Swift 使用对应平台 CI 固定的 Xcode 自带的 `swift-format`（`xcrun swift-format format --in-place <文件>`），CI 使用 `xcrun swift-format lint --strict` 检查；Kotlin 遵循 Android Studio 默认格式。少量 Ruby 和 Shell 脚本沿用语言惯例，不为格式引入额外依赖；分别用 `ruby -c`、`bash -n` 检查语法。原生源码修改后运行对应平台构建。

品牌图形以 `frontend/assets/brevia-logo.svg` 为唯一静态源，字形沿用开屏动画最终定格。安装 Playwright Chromium 后运行 `npm run assets:brand` 同步桌面、官网、文档和手机资源；`npm run assets:brand:check` 校验产物。不要直接修改生成的图标。

README 使用同一命令生成的 `docs/assets/brevia-hero.gif`：白底动态点阵、50 fps、4 秒无缝循环；应用与手机资源保持静态。

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

提交前运行上述范围内的格式与静态检查。桌面/后端修改运行 `npm test`；手机修改在 `mobile` 下运行 `flutter test`；发布脚本修改运行 `ruby mobile/scripts/test-release.rb`。网站演示修改运行 `node scripts/test-website-demos.cjs`（需要 Playwright Chromium）。格式检查由 CI 执行，不在发布流程里自动重写源码。

依赖安全检查同时运行 `npm audit` 与 `npm audit --omit=dev`，覆盖开发及生产依赖。

### CI / CD 职责

| 工作流                         | 职责与触发范围                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code style                     | PR / main 的统一 JS、文档及 Python 格式与静态检查。                                                                                                   |
| Native macOS validation        | 桌面相关改动的测试、原生打包、真实 WKWebView / PDF / 录音收尾及 Agent 验证。                                                                          |
| Native Windows validation      | Windows 与共享桌面代码的测试、MSVC / NSIS 构建、WebView2 / PDF、旧版升级和真实模型验证；macOS 专属代码、手机、官网和说明文档不触发。                  |
| Release                        | 标签或手动运行时构建两端正式签名成品，验证公证、升级与推理；仅 `v*` 标签公开发布和更新下载链接。                                                      |
| Mobile CI and distribution     | 手机改动的 Flutter / 原生检查；main 按共享、iOS、Android 改动选择分发平台，文档不触发，Flutter／发布脚本测试改动仅检查；正式 App Store 送审单独触发。 |
| Deploy website to GitHub Pages | 官网与演示脚本变更独立运行浏览器回归；PR 只检查，main 检查通过后部署静态站点。                                                                        |

Code style 额外运行 `node --test scripts/test-ci.cjs`，验证平台触发范围与缓存兼容性。Mobile check 使用 `scripts/ci-mobile-changes.py` 从上次成功的 main 推送分发开始累计比较差异，避免等待任务被合并后漏发；查询失败或提交不可达时保留两端。共享 Flutter、资源或依赖变更分发两端，平台专属代码只分发对应端，Flutter／发布脚本测试和分析配置变更只检查；Android 原生单测变更仍运行对应构建任务。手动 TestFlight 构建仍覆盖两端，App Store 送审继续复用已有构建。

原生 CI 和 Release 共用编译缓存，按运行器系统、架构、镜像、构建配置与依赖区分，再按提交保存增量结果。只恢复相同配置的最近缓存，缓存成功任务的编译中间产物，不缓存正式安装包或签名材料。缓存命中后仍重新组装、签名并验收成品；新镜像或构建配置第一次运行需要重新预热。

格式检查集中在 Code style；两端业务测试保留各自运行，以覆盖路径、进程及系统差异。Release 重新验证实际签名成品，不能用普通 CI 的未签名构件代替。

官网演示测试、官网全局分析与下载链接更新脚本不触发桌面打包。两端 CI 与 Release 通过 `.github/actions/bundled-vad` 准备 Silero VAD：按平台、模型 revision 和校验值缓存已安装权重，缓存命中仍校验 SHA-256，再复制到现有打包目录。缓存缺失时使用主源，临时网络错误可回退到同一 SHA-256 的 ModelScope 镜像；完整性校验失败直接中止。模型校验成功即保存缓存，不等待整个安装包构建结束；不缓存成品或签名材料，也不改变应用内用户选择的下载源。

完整 `npm test` 中，桌面 Agent 用例归入 `test:desktop`，后端 Agent 用例随 `test:backend` 执行一次；独立 `npm run test:agent` 仍覆盖两端 Agent 用例。后端单测由 `npm test` / `npm run test:backend` 执行；`test:mac:webkit` 专门检查原生平台与成品，不重复后端单测。macOS 验证及 Release 均先执行完整 `npm test`，再检查原生成品。

`desktop/` 管理两端共用的桌面控制器、手机服务、Agent、预加载协议与品牌资源。`desktop/platform.cjs` 显式连接 Rust 原生宿主，`macos/backend/` 管理共用 Node Worker，`macos/`、`windows/` 分别维护平台能力和打包。旧数据迁移及旧版安装器升级验证继续保留。

## 正式发布

发布任何版本前逐项确认。本指南保留可复用的检查与 CI 流程；证书、登录信息和本机路径由维护者在仓库外管理。

本页下列步骤用于桌面版本。每次 iOS 送审前必须重新阅读[手机正式发布流程](mobile/README.md#正式发布)，优先通过现有 API / CI 提交，并回读正式审核状态；Android 分发也见该指南。

### 1. 版本号与更新日志

| 位置                                                  | 内容                                                                           | 谁负责                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `package.json` / `package-lock.json`                  | `version`                                                                      | 使用 `npm version` 同步更新                                                                               |
| `macos/host/Cargo.toml`、`Cargo.lock` 与 `Info.plist` | 宿主版本及 macOS 应用版本                                                      | 修改 crate 和 plist 版本，通过 Cargo 刷新锁文件                                                           |
| `frontend/changelog.js` 的 `releases`                 | 新增一条 `{ version, date, current: true }`，并把上一条的 `current: true` 去掉 | 手动；`test-ui.mjs` 只守住「恰好一条 current 且它是最新一条」，发布测试另核对包版本、双语摘要及上一版链接 |
| `docs/releases/v<version>.md`                         | GitHub Release Notes                                                           | 手动，发布前确认文件存在                                                                                  |

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

- [ ] 兼容逻辑只服务仍受支持的旧数据或客户端；下架功能不留无调用方的占位字段、别名和空钩子。
- [ ] 删除的配置项同时从 `backend/settings.json` 移除；用户覆盖文件的多余键由 `config._prune_to_template` 统一丢弃。
- [ ] 删除的模型 ID 同步检查模型清单、平台覆盖及出厂 VAD 准备步骤；成品真实加载失败必须阻止发布。
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
npm test              # 死代码门禁 + 桌面控制器 + UI 结构 + E2E 冒烟 + 后端用例
npm run lint:python   # 手机与发布辅助脚本
npm run build         # tailwind.css → styles.css，构建后 styles.css 应无额外差异
```

- [ ] 上述命令全绿。
- [ ] 手写组件类与 `styles.css` 同步（`npm run build` 后 `git diff frontend/styles.css` 只包含本次改动）。
- [ ] 启动一次应用：完成引导 → 录一段（或导入音频）→ 会后精修 → 导出，确认无控制台报错。

### 5. 打包与发布

先提交版本号、更新日志和 release note，确认待发布提交已通过检查，再由维护者创建并推送 `v<version>` 标签。[Release 工作流](.github/workflows/release.yml)在标签推送时构建并发布 macOS 和 Windows 安装包；也支持手动触发。签名和发布凭据由维护者配置，普通贡献者无需持有。

macOS 使用 Apple Silicon 的 `macos-26` runner、Xcode 26.4.1（Swift 6.3）与固定版本的 Tauri CLI；构建目标仍为 macOS 14。GitHub Secrets 需配置 `APPLE_CERTIFICATE_P12_BASE64`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，以及稳定的 `BREVIA_NATIVE_UPDATE_PUBKEY` 和 `TAURI_SIGNING_PRIVATE_KEY`（加密私钥另设 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。缺少任一必要密钥会阻止发布，不会生成无法更新的正式版。

工作流先验证应用签名和成品业务测试，再公证并装订应用，生成签名更新归档与 `latest-webkit.json`，最后公证 DMG。应用与 DMG 的公证状态均回读验证；临时钥匙串总在收尾删除。Windows 使用 MSVC 构建原生引擎和 Tauri NSIS 安装器，验证随包 CLI/MCP、WebView2、PDF、旧版迁移和更新签名，并使用校验过的真实权重执行转写、VAD、声纹、说话人分段及翻译；推理失败阻止发布。Windows 更新复用上述 Tauri 密钥；可配置 `WIN_CERTIFICATE_P12_BASE64` 和 `WIN_CERTIFICATE_PASSWORD` 进行 Authenticode 签名，未配置时 Windows 会显示未签名发布者提示。

本机仅构建安装包时运行：

```bash
npm run release:offline
```

`release:offline` 按当前系统生成原生 DMG 或 Windows 安装器，不运行 Python 或 Electron 打包。此入口不提交 Apple 公证。手动触发 Release 工作流会构建和验证两端签名成品；只有 `v*` 标签触发才公开发布。

### 6. 发布后

- [ ] 确认 GitHub Release 里的 `Brevia-WebKit-<version>-arm64.dmg`、签名原生更新包和 `latest-webkit.json` 与 `Brevia-<version>-x64-setup.exe`、其签名和 `latest-windows.json` 存在。
- [ ] 确认 CI 已更新官网与各语言 README 的下载链接（`scripts/update-release-links.mjs`）。
- [ ] 在应用内「更新日志」里确认新版本被标为当前版本。

## 本机 Agent 接口

macOS 和 Windows 原生应用提供同一套本地认证接口；CLI 和 stdio MCP 只连接应用已运行的业务控制器，不直接打开数据库或创建第二套 Worker。两端支持本地推理、电脑录音和已连接手机录音，沿用各平台业务引擎与授权检查。

macOS 安装版入口为 `/Applications/Brevia.app/Contents/Resources/control/brevia`，随包携带 Node。Windows 入口为安装目录的 `brevia.cmd`（默认 `C:\Program Files\Brevia\brevia.cmd`），使用随包 `resources/control/node.exe`；两端都无需安装系统 Node。源码入口为 `npm run brevia --`。以下示例用 `brevia` 表示入口，可自行添加 shell alias；Windows 参数里的绝对路径使用 `C:/Users/me/...` 或 JSON 转义反斜杠。Skill 位于仓库 `skills/brevia/SKILL.md`，macOS 包内为 `Contents/Resources/skills/brevia/SKILL.md`，Windows 为 `resources/skills/brevia/SKILL.md`。

Windows 打包在 `package:win` 中 bundle CLI，并把命令、脚本和 Skill 放入安装包。CI 使用包内 Node 验证 CLI/MCP 与 `status --no-start`，不依赖构建机 Node。

```sh
brevia status --no-start
brevia models.list
brevia devices.list
brevia meeting.search '{"query":"发布"}'
brevia meeting.get '{"meeting_id":"会议 UUID"}'
brevia inference.run '{"operation":"transcribe","input_path":"/Users/me/input.mp4","language":"zh","model_id":"qwen3-asr-0.6b-int8","output_path":"/Users/me/transcript.srt"}'
brevia inference.run '{"operation":"translate","input_path":"/Users/me/input.mov","language":"en","target_language":"zh","output_path":"/Users/me/translated.vtt"}'
brevia inference.run '{"operation":"translate","input_path":"/Users/me/subtitles.srt","target_language":"en","output_path":"/Users/me/translated.srt"}'
brevia inference.run '{"operation":"translate","text":"会议改到明天。","target_language":"en","output_path":"/Users/me/translation.txt"}'
brevia task.get '{"task_id":"返回的任务 UUID"}'
brevia task.cancel '{"task_id":"返回的任务 UUID"}'
brevia inference.run '{"operation":"diarize","input_path":"/Users/me/meeting.wav","language":"zh","output_path":"/Users/me/speakers.json"}'
brevia speaker-profile.list
brevia inference.run '{"operation":"voice-match","input_path":"/Users/me/voice.wav","profile_id":"声纹 UUID","output_path":"/Users/me/match.json"}'
brevia recording.control '{"action":"start","target":"computer","request_id":"meeting-2026-11-06-start","title":"项目会议","language":"zh","audio_tracks":["mic"]}'
brevia recording.control '{"action":"pause","target":"computer","request_id":"meeting-2026-11-06-pause"}'
brevia recording.control '{"action":"resume","target":"computer","request_id":"meeting-2026-11-06-resume"}'
brevia recording.control '{"action":"stop","target":"computer","request_id":"meeting-2026-11-06-stop"}'
```

手机录音把 `target` 换成 `devices.list` 返回的手机 ID。设备必须已信任、在线且可录音；应用保留原有权限检查、录音界面、状态栏和胶囊提示。`confirmed: true` 只在电脑采集器 ack 或手机报告实际状态后返回，手机停止确认不等于补传完成。`request_id` 在当前应用会话内去重；重试同一个动作必须复用原 ID 与完全相同的参数，改动作使用新 ID。应用重启后先查状态再决定是否发起新动作。

推理立即返回 `task_id`，用 `task.get` 轮询 `queued/running/completed/failed/cancelled`、进度与结果。完成后 `result.output_path` 是实际写入路径。任务记录保留至应用退出，已完成记录至少保留一小时；当前最多四个运行或排队任务、128 个任务记录；推理串行复用业务引擎，排队阶段不预加载模型。应用退出或崩溃后任务 ID 不再有效，已导入会议和已完成结果仍保留，可在应用中继续处理。

输入、输出均使用绝对路径，输出目录须存在。默认保留源文件，拒绝覆盖任何已有目标（包括软链）；TXT、Markdown（`md`）、SRT、VTT、JSON 可由后缀推断，也可用 `format` 指定。音视频先导入并转写，再逐段本地翻译；字幕文件翻译保留时间戳。纯文本没有时间戳，不能导出为 SRT/VTT。`diarize` 复用精修管线输出说话人及字幕；`voice-match` 使用已注册声纹，仅导出 JSON。缺模型报 `model_not_installed`，解码失败报 `decode_failed`，不会下载模型或静默切到云服务。系统解码器不支持的媒体会明确失败。

CLI 默认自动后台启动安装版并等待就绪。`--no-start` 禁止启动，`status --no-start` 可用来只检查是否运行。`BREVIA_APP` 可指定应用可执行文件绝对路径，`BREVIA_DATA_DIR` 必须与应用使用的数据目录一致。原生宿主单实例锁及控制服务数据锁共同避免并发启动；启动失败返回 `app_not_found`、`launch_failed` 或 `startup_timeout`，不会另起无界重试。

### 设置中的 Agent 管理

在 **设置 → AI 功能分类 → Agent 与 MCP**，优先通过 **Skill + CLI** 接入能操作本机的 Agent。复制引导语发给 Agent，其中包含当前安装对应的 Skill 文件、CLI 路径与数据目录；Agent 先读操作说明，再执行命令。支持 MCP 的客户端可另行复制配置。页面不再提供常驻权限开关，不显示或复制认证令牌。

默认启用读取、推理和录音三类权限；已有 `.agent/settings.json` 中的受限配置继续生效，打开页面不会自动提权。仅在能力未启用时显示“启用本机接入”，由用户主动恢复。被禁用的权限阻止对应的新请求，既有任务仍可取消、录音仍可停止；已完成文件保留。关闭接口后仍持有单实例数据锁，CLI/MCP 不能自行重新启用。权限只能从主窗口设置 IPC 修改，本地控制 API 不暴露自授权方法。配置文件损坏时接口保持禁用，用户可从此入口恢复。

### 提示词配置兼容

已有数据目录中的 `prompts.json` 继续兼容，保留既有配置字段与读取、写入接口。macOS 与 Windows 的纪要、实时 AI 笔记、应用字幕翻译及 Agent 翻译共用此配置；额外要求追加到基础提示词，原有 JSON 格式、来源标记和目标语言约束继续保留。设置页面已移除提示词编辑入口。

### 认证和权限

控制接口为 Unix 上 `/tmp/brevia-agent-<uid>-<数据目录哈希>/control.sock` 的 HTTP `POST /v1`（Windows 使用命名管道），请求体为 `{"method":"app.status","params":{}}`，Header 为 `Authorization: Bearer <token>`。服务不监听业务 TCP 端口，不接受浏览器 Origin；Unix 目录权限 0700、凭据文件与 socket 权限 0600，凭据存于数据目录 `.agent/credentials.json`，每次启动轮换。Windows 用原生 DACL 将凭据目录限制为当前用户 SID，命名管道请求仍必须通过令牌认证。短 socket 路径支持较长的数据目录，socket 目录拒绝软链并核对所有者。数据锁恢复使用临时 loopback 端口互斥，不承载业务。

三类独立凭据：`read` 可查询应用、模型、设备、会议和任务；`infer` 可提交/取消推理及查询任务；`record` 仅允许录音控制。`brevia token read|infer|record` 返回对应凭据，勿把输出写进日志或仓库。默认 CLI 从当前用户私有凭据文件选择所需权限；交给受限 Agent 时用 `BREVIA_AGENT_TOKEN` 指定单枚令牌，服务端不会回退到更高权限。此机制隔离凭据权限，不用于沙箱化已经能读取同一操作系统用户文件的进程。

MCP 客户端配置：

```json
{
  "mcpServers": {
    "brevia": {
      "command": "/Applications/Brevia.app/Contents/Resources/control/brevia",
      "args": ["mcp"]
    }
  }
}
```

Windows MCP 客户端可直接调用随包运行时，避免依赖 shell 对 JSON 的转义：

```json
{
  "mcpServers": {
    "brevia": {
      "command": "C:\\Program Files\\Brevia\\resources\\control\\node.exe",
      "args": ["C:\\Program Files\\Brevia\\resources\\control\\brevia.cjs", "mcp"]
    }
  }
}
```

自定义安装目录时同步修改这两个路径；自动启动优先使用 CLI 所在安装包的应用。

工具名将 CLI 方法的点换成下划线，如 `inference_run`、`task_get`、`recording_control`。stdio 使用 JSON-RPC 换行消息，stdout 只输出协议内容；`mcp --no-start` 禁止工具调用自动启动应用。应用协议与 MCP 工具参数由同一 schema 生成。运行 `npm run test:agent` 检查认证、权限、自动启动、任务、文件导出和录音确认回归。
