# 桌面工作台设计 · 2026-11-04

在 `codex/ui-design` 分支实施，以 `main` 的 `1924a203` 为基线。本文记录本轮桌面组件、布局和交互重建的当前契约，覆盖旧规范中的桌面参数。手机 App、官网、跨端协议和持久化字段不在改动范围内。

## 设计依据与适配边界

用户指定 [Orca](https://github.com/stablyai/orca) 的设计语言、比例、按钮与交互为参考。已检查其 [README 截图](https://github.com/stablyai/orca/blob/main/docs/assets/readme-hero.jpg)、用户提供的实际运行截图及以下源码：

- [AppWorkspaceShell.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/app-shell/AppWorkspaceShell.tsx)、[SidebarNav.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/sidebar/SidebarNav.tsx)：持续导航、明确收起入口、紧凑导航行和搜索。
- [main.css](https://github.com/stablyai/orca/blob/main/src/renderer/src/assets/main.css)、[button.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/ui/button.tsx)：中性灰双主题、细分隔线、36px常规按钮、32px小按钮、16px图标及短时反馈。
- [settings-page-renderer.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/settings/page/settings-page-renderer.tsx)、[SettingsSidebar.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/settings/navigation/SettingsSidebar.tsx)、[SettingsSection.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/settings/section-layout/SettingsSection.tsx)：独立目录、设置分组、内容滚动和就近操作。
- [MobilePageContent.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/mobile/MobilePageContent.tsx)、[MobileHeroPairingStep.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/mobile/MobileHeroPairingStep.tsx)：手机介绍、安装/配对流程、可信设备管理与右侧演示分工。
- [PhoneCarousel.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/mobile/PhoneCarousel.tsx)：三个真实 DOM 场景，每场停留4500ms，切换前240ms提供点击提示。其首页、工作树和终端内容属于 Orca。
- [mobile-page.css](https://github.com/stablyai/orca/blob/main/src/renderer/src/assets/mobile-page.css)：手机屏幕320ms滑动、`cubic-bezier(.32,.72,.24,1)`曲线、9:19.5手机比例、受视口约束的尺寸；介绍画布使用5px静态点阵。
- [integration-card-shell.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/integrations/presentation/integration-card-shell.tsx)：真实连接状态与对应操作就近呈现，窄内容区允许操作换行。
- [SidebarToolbar.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/sidebar/SidebarToolbar.tsx)、[StatusBarSurface.tsx](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/status-bar/StatusBarSurface.tsx)：侧栏工具与全宽24px状态栏分开，摘要展开360px浮层。

用户提供的两张 Orca 截图均为1406×873。设置截图 `codex-clipboard-3d84b4f3-fcc7-4034-b75d-4d4ad023d0aa.png` 可观察到280px目录，正文卡片从x422到x1254，实际宽832px；源码中的896px外包装包含左右各32px留白。手机截图 `codex-clipboard-723cbf4c-0251-4ee6-b044-cf6c31155288.png` 可观察到60px双行标题、18px说明、平台胶囊和约352×758px手机。

这些尺寸是参考证据，Brevia 的最终宽度与会议工作流按实际窗口适配。会议导航采用用户随后指定的 Codex 式单侧栏：工作区文件夹直接包含会议，不保留独立工具轨道或第二层会议库。字体继续使用现有系统字体栈，不新增 Geist 依赖；品牌仍为 Brevia。

本轮重新构建侧栏命令区、选择器、菜单、工作区对话框、录音/导入编辑器、设置表单和手机演示的 DOM 与专用样式。保留的旧 ID、`data-*` 或业务类名用于连接原控制器，不作为旧组件布局的依赖。Orca 的账户、工作树、终端、Relay和远程主机能力不移植到 Brevia。

## 单一侧栏与底部状态

主会议导航宽260px，窗口不超过1050px时宽240px。顶部为品牌、34px搜索框和创建命令：新建会议保留文字，导入使用独立图标按钮；搜索内显示快捷键。中部工作区会议树独立滚动，底部为一行紧凑工具：会议库、最近删除和设置，其中最近删除、设置用带说明的图标入口。

工作区组头包含展开箭头、文件夹、名称和数量，默认展开，`aria-expanded` 与实际状态同步；管理按钮在悬停或键盘聚焦时出现。会议使用32px标题行，保留当前选择与 `aria-current`，不在每行重复状态、时间或文档图标。重命名、多选、工作区归属、删除和恢复继续使用原业务。

`#library-toggle` 将整个侧栏显式收起到0px，再次点击恢复。`Cmd/Ctrl K` 展开侧栏并聚焦搜索，查找时保留当前文档或实时会议。未保存的笔记或纪要阻止直接切换会议。进入设置时隐藏会议侧栏，返回时恢复用户原有显隐偏好；不会因返回首页强制展开。

全宽底部状态栏高24px。设备入口显示真实短状态，完整设备名称由悬浮说明和无障碍标签保留。任务摘要显示数量、录音时间或错误；点击原地展开任务层，再次点击、点击外部或按Esc收起，键盘关闭后恢复摘要焦点。任务层默认收起，宽360px并受视口约束，左侧12px、底部36px，最大高度 `min(420px, 100dvh - 84px)`。真实进度、暂停、重试、最小化和恢复不因新外观改变。

## 内容页与新组件

| 工作面             | 当前结构与行为                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开始工作           | 居中起始面提供录音与导入操作，会议查找留在侧栏。                                                                                                                                                |
| 录音准备           | 新 `compose-page`：固定页头、左侧会议信息编辑器、右侧音源与设备检查区、固定提交栏。内容上限1080px，检查区280px；四种音源采用2×2选择器，翻译、说话人和模型等选项在原生 `details`「更多设置」中。 |
| 录音导入           | 共用两列编辑器，左侧为拖放目标、已选文件、会议信息，右侧为处理选项；支持的文件、校验、处理进度、取消及错误恢复沿用原业务。                                                                      |
| 实时会议           | 左侧笔记约60%、右侧转写约40%，各自滚动，工具归属对应内容。保留说话人、纠错、查找替换、AI建议、计时、音量、暂停和结束。                                                                          |
| 会议详情           | 水平内容标签、独立上下文工具栏和阅读工作面；原编辑器节点持续存在，保留版本、参会者、播放器、翻译、精修、生成、导出及失败重试。                                                                  |
| 设置               | 新目录、固定标题栏、可滚动正文和独立设置行。通用、进阶、模型、AI、声纹、设备及存储各自组织字段与操作，具体规格见下文。                                                                          |
| 手机连接           | 左侧真实安装/配对流程，右侧真实 DOM 交互演示和 Canvas 动态背景。预览与真实连接状态相互独立。                                                                                                    |
| 公共控件           | 新 `ui-button`、`ui-select`、`ui-menu` 与 `ui-dialog`。选择器保留键盘选择与视口内定位；会议菜单分组显示操作；工作区表单采用420px对话框。                                                        |
| 引导与桌面辅助界面 | 欢迎、权限、模型配置、导出和确认层保留真实校验与错误处理。桌面胶囊、系统权限和原生托盘继续使用原实现。                                                                                          |

### 两列录音与导入编辑器

页头高76px，显示返回、模式图标、18px标题与说明。内容区独立滚动，底部提交栏位于滚动区之外：左侧显示当前操作说明，右侧至少128×36px的提交按钮，错误在同一区域显示。短窗口不会把提交按钮推到长表单末尾。

以工作面容器宽度决定布局：不超过760px时检查区240px，不超过600px时220px，不超过520px时改为上下两区。单列时检查区通过顶部细线与编辑区区分；固定提交栏持续可达。导入和录音使用各自必要字段，不依赖隐藏旧卡片拼装页面。

### 设置工作面

设置目录宽220px，窗口不超过1050px时200px。返回行与搜索固定在顶部，目录分组独立滚动，实际入口按「应用设置」「AI 功能」「设备与数据」组织。搜索筛选当前语言的入口名称，隐藏无匹配的小节，空结果显示「未找到设置」；不会改变当前页面或保存状态。

正文采用新 `preferences-workspace`、固定标题栏和 `preferences-scroll`。标题18px、说明12px，内容上限840px。每组由小节标题与分隔线组织，设置行左侧说明、右侧控件；常规行至少68px高，控件32px，开关32×18px。长表单、模型记录和存储说明各自保持可滚动、可换行的内容结构，不用一张大圆角卡片包住全部设置。

原有保存、连接测试、模型下载、存储清理、声纹管理和隐私操作仍由对应控制器执行。操作反馈与字段或页面标题就近呈现；设置目录的返回动作恢复主工作面。

### 菜单与工作区对话框

公共控件采用32px高度、6px圆角。选择列表保留当前值、键盘导航、滚动和浮层定位。会议菜单宽212px且受视口限制，标题说明、普通操作和危险操作分开呈现。

工作区 `ui-dialog` 宽420px，最大宽度为视口减48px，最大高度为视口减80px；标题、关闭、表单和底部动作拥有独立结构。它不改变工作区创建、编辑、删除或确认的原逻辑。手机配对弹窗是独立流程，继续使用640px受限宽度及原二维码、六位码、审批和错误恢复。

### 手机连接与交互演示

介绍页左侧为60px标题、18px说明、iOS/Android平台标签和150×40px主入口；右侧是9:19.5的手机框。框宽上限354px，同时根据视口高度给演示控制区留出空间。窗口不超过1050px时改为纵向布局，手机保留在操作区下方，宽度上限300px并受高度约束；屏幕内部内容可以滚动。

手机预览由独立 DOM 构成三个 Brevia 场景：

1. 会议列表：展示演示会议，点击会议或录音按钮进入实时场景。
2. 实时转写：演示计时、随时间变化的音量柱与逐字推进的三段发言，可进入纪要。
3. 会议纪要：展示约1400ms的演示生成进度、摘要和可勾选的行动项。

预览带「交互预览」「演示内容，不代表设备连接状态」说明，每个屏幕也标记「演示」。下方标签可手动切换，方向键、Home/End可导航，暂停/继续按钮控制自动演示。非当前屏幕使用 `aria-hidden` 与 `inert`，避免键盘进入不可见控件。人工查看并暂停时呈现完整内容；自动模式保留逐字与进度变化。

运行时不加载旧手机截图资源。语言变化原地更新文案，不重置当前场景或键盘位置。预览不调用配对、录音、上传或会议 API，其计时与进度仅属于有明确标记的演示。

背景保留 Orca 5px淡点阵的视觉基础，另用 Canvas 绘制缓慢流动、响应指针位置的点阵波，绘制上限30fps。**Orca 当前源码的背景是静态点阵；动态波纹是本次按用户要求新增的 Brevia 扩展。** 手机本体不做持续漂浮。

窗口进入后台、页面隐藏、预览离开视口、用户暂停或启用减少动态效果时停止帧循环。键盘探索预览时暂停自动换屏，明确点击继续可恢复；恢复不补跑停留期间的时间。销毁时取消帧、移除监听与观察器，迟到回调不能重启演示。

真实手机页面状态仍为 `intro`、`install`、`pair`、`paired`。安装使用原下载与二维码入口，配对沿用原生弹窗、倒计时、刷新、审批和取消。离线可信设备仍归入已配对阶段；只有真实设备与审批结果驱动连接状态。轮询和语言更新不重新配对，也不重播左侧同一阶段的进入动效。连接服务开关、状态及错误说明位于页面支持区，通过页面滚动可达。

## 视觉与动效

窗口页头40px，主操作与选择器通常32px，正文编辑输入按内容采用32–36px；控件圆角6px、菜单8–9px。导航文字13px、常用图标16px。转写、笔记和纪要保持独立阅读字号，不随窗口缩放整页。

| 语义        | 浅色                  | 深色      |
| ----------- | --------------------- | --------- |
| 画布        | `#ffffff`             | `#0a0a0a` |
| 导航 / 弹层 | `#fafafa` / `#ffffff` | `#171717` |
| 主要文字    | `#171717`             | `#f0f0f0` |
| 次要文字    | `#696969`             | `#acacac` |
| 分隔线      | `#e5e5e5`             | `#2b2b2b` |
| 选中底色    | `#eeeeee`             | `#2a2a2a` |
| 输入边界    | `#d4d4d4`             | `#404040` |

录音、异常与任务仍使用各自语义颜色。键盘焦点保持可见，按控件采用底色、文字或轮廓反馈；保留Tab/Esc、关闭后焦点恢复和中文输入法。主动搜索快捷键不扩展为打开页面时自动抢焦点。

| 场景                   | Brevia 时序                                                         | 来源与边界                                                                               |
| ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 首次进入设置           | 180ms、`ease-out`，透明度0→1、Y轴8px→0                              | 对照 Orca `settings-shell-enter`；同级设置导航不重复淡空整页。                           |
| 真实手机流程前进／返回 | 280ms、`cubic-bezier(.32,.72,.24,1)`，X轴±40px→0、透明度0→1         | 对照 Orca 手机流程；原版透明度单独200ms，Brevia使用统一280ms时间轴。                     |
| 手机演示换屏           | 停留4500ms、点击提示240ms、滑动320ms                                | 停留与提示来自 `PhoneCarousel.tsx`，滑动来自 `mobile-page.css`；内容改为 Brevia 三场景。 |
| 手机演示背景与内容     | Canvas最多30fps，逐字转写与音量随演示时间推进，纪要演示约1400ms完成 | Brevia独立演示，不代表真实会议、设备状态或实际处理速度。                                 |
| 详情内容标签           | 180ms、Y轴6px→0，正文透明度保持1                                    | 保持原编辑器与阅读连续性的适配。                                                         |
| 任务层                 | 160ms、透明度0→1、从下方6px进入                                     | 状态栏展开方式的适配，真实进度不受影响。                                                 |
| 任务卡                 | 160ms进入、120ms退出，最小化／恢复180ms                             | 原真实任务状态驱动。                                                                     |

真实手机步骤只在可见页面发生状态转换时播放，同态轮询不重播；新操作可取消未结束的视觉过渡。减少动态效果不延迟业务状态生效。纠错面板继续锚定录音控制栏或播放器上沿，避免被24px状态栏或窄窗口换行遮挡。

## 实施文件与边界

- `frontend/index.html`、`frontend/app.js`：新桌面结构与组件装配、工作区会议树、搜索、显式收起、会议切换和草稿保护。
- `frontend/desktop-shell.css`：主题、紧凑会议导航、窗口框架、底部状态栏和任务层。
- `frontend/desktop-workspace.css`：实时、详情、手机连接流程及引导工作面的内容结构。
- `frontend/desktop-controls.css`、`frontend/ui-components.js`：按钮、选择器、菜单、420px工作区对话框及设置组件结构，保留原事件契约。
- `frontend/desktop-compose.css`：录音/导入两列编辑器、检查区、固定提交栏和容器响应布局。
- `frontend/desktop-settings.css`：独立设置目录、标题栏、设置行、模型、声纹、AI与存储工作面。
- `frontend/desktop-mobile-preview.js`、`frontend/desktop-mobile-preview.css`：真实 DOM 三场景、Canvas背景、自动初始化、手动控制、语言更新、可见性与减少动态偏好，以及生命周期清理。
- `frontend/mobile-connection.js`：原手机 API、真实阶段导航、配对取消保护与设备状态；不与演示状态混用。
- `frontend/motion.js`、`frontend/motion.css`：设置首入、真实流程换步、详情标签、任务反馈及减少动态处理。
- `frontend/i18n-data.js`：新组件及预览文案的八语种覆盖。
- `scripts/test-desktop-mobile-preview.mjs`、`scripts/test-motion.mjs`、`frontend/test-ui.mjs`、`electron/test-e2e.mjs`：生命周期、交互和实际渲染验证。

不改跨端协议、IPC名称、持久化字段、录音保存或模型服务。手机 App 与官网使用原加载入口，桌面专用样式不作用于它们。生成的 `frontend/styles.css` 只通过构建更新。

## 验证记录

自动化使用隔离数据目录与演示会议。以下分开记录上轮验证和本轮组件重建，不把已有日志视为新代码的验收。

### 上轮框架调整的历史记录

`output/ui-design-2026-11-04/final-tests.log` 记录上轮 `npm test` 通过，包括dead-code、Electron、UI/motion和E2E；后端468项中7项按条件跳过，其余通过。`format-final.log`、当轮构建及差异检查通过。`desktop-experience.log` 验证了隔离窗口、快捷录音、退出保存和桌面胶囊，生成19张截图。

`preview/index.html`、`preview/measurements.json`、`final-preview.log` 是上轮11场景×两主题×两尺寸的44张截图。该轮修复纠错面板遮挡、高级设置收起空白、迟到配对结果重新弹窗和回收站返回问题。这些记录仅说明对应旧轮次通过，不能证明本轮新组件已完成全量验证。

### 本轮组件重建

- [x] `node scripts/test-desktop-mobile-preview.mjs`：Canvas实际绘制点变化、自动停留与换屏、逐字转写、音量、纪要完成、手动切换、暂停恢复、隐藏/离屏/减少动态停止、语言保持场景、键盘焦点与销毁清理通过。
- [x] 新预览JS语法检查、动效控件清单检查通过；源码中34个文案键的八语种覆盖已核对。
- [x] `components-preview/index.html` 已建立21页面/状态的截图浏览入口，84张PNG链接与浏览页脚本语法有效。
- [x] 本轮 `npm run build` 与 `npm test` 通过；`components-tests.log` 包含 dead-code、Electron、UI、动效、动态预览和实际 Electron E2E。后端468项，7项按环境条件跳过，其余通过。`components-format.log` 与 `git diff --check` 通过。
- [x] 布局复核覆盖紧凑侧栏、两列编辑器及固定提交栏、独立设置行、选择器/菜单、420px对话框、任务层、声纹与关于页；包含宽窄窗口和两主题。
- [x] 实际 Electron 动态采样通过：背景帧、计时、逐字转写与自动换屏变化；暂停、减少动态与离开页面停止。结果在 `components-preview/motion-verification.json`。

当前 `components-preview/` 包含会议工作台、准备、导入、实时、详情、通用、模型、AI、进阶、存储、手机介绍/安装/配对、手机转写/纪要演示、任务、会议菜单、选择菜单和工作区对话框，并新增声纹与关于页，共21个场景，分别覆盖1280×800/880×640及浅深两主题。截图记录页面状态，另以实际帧采样验证动画运行。

自动化渲染不等同于麦克风、系统音频、手机实机连接或Windows原生窗口验收，交付时需保留实际检查范围。

本轮还修复了新组件接入中的具体回归：模型长标题压住选择器箭头、麦克风断连后隐藏字段仍保留失效设备ID、多语言底部导航挤压、新工作区对话框层级低于侧栏，以及键盘在页面入场过程中打开菜单导致锚点偏移。官网演示仍读取桌面外壳，因此在官网入口隔离原选择器与会议行，并适配演示所需结构，保持官网原有布局。

`components-desktop-experience.log`：隔离的桌面窗口、真实鼠标悬停、快速录音、全局快捷键、退出保存和桌面胶囊验证通过，生成19张截图。`components-website-tests.log`：官网演示两轮播放、布局、控制、语言、减少动态与静态回退全部通过。

最终截图：`components-preview/measurements.json` 记录21场景×浅深主题×两尺寸共84张实际Electron图，页面无横向溢出。`components-preview/phone-demo.mp4` 是15秒实际运行录屏，包含会议列表、逐字转写与纪要三个场景及动态点阵；录屏使用隔离演示内容。`components-motion.log` 保存最后一次独立动效采样结果。
