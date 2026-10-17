# Brevia 手机端

Flutter 共用界面与录音同步逻辑，包含 Android 和 iPhone 原生工程。本指南介绍本地开发、录音恢复、桌面联动和构建分发；其他指南见[文档目录](../docs/README.md)。

## 已实现

- 会议库、搜索、配对、录音准备、实时转写、笔记、时间点重点、暂停与继续、结束、会后回听与文字分享、设置、深浅色及减少动态效果。
- 手机发起实时录音后直接进入转写页，可切换笔记或返回录音概览；离线录音与电脑麦克风模式保留录音界面。转写页顶部只显示连接状态，不显示持续变化的音频上传进度。
- 二维码，或输入电脑局域网 HTTPS 地址及 6 位 PIN；电脑应用内核对校验码后授权。凭据存入 Keychain / Android 安全存储。TLS 证书指纹固定，配对限时、限尝试次数；接口按设备隔离会议。
- 16 kHz 单声道 PCM16 录音，约 115 MB/小时。手机每秒保存分片；电脑持久化后才确认，顺序补传，重试幂等，部分写入恢复按实际样本数去重。
- 手机不运行识别或 AI 模型。手机发起的会议由电脑现有 worker 转写，已保存笔记和转写返回手机。AI 笔记配置、模型下载及会后精修继续在电脑完成。
- 桌面发起会议时，可在录制来源中选择已连接的手机麦克风；手机需打开 Brevia 且没有其他录音。桌面控制开始、暂停、继续与结束，手机只采集并保存音频，断线后沿用分片补传。逐字稿和笔记留在桌面，不回传手机；手机主动录音的原有流程保持独立。开始请求在模型加载完成后 30 秒失效，电脑重启不会重新发起未响应的录音请求。
- Android 使用麦克风前台服务及持续通知；iOS 使用原生录音会话和 audio 后台能力。来电或系统打断后显示中断，由用户继续；不会静默恢复麦克风。
- 支持未配对时新建离线录音，预设语言和人数；结束后由用户连接并确认目标电脑，再开始上传。配对本身不会上传本地会议。已选择实时转写的会议断网后继续本地录音，2/4/8/15 秒退避重试。电脑重启恢复缓存；同一电脑 IP 改变时，可在连接页更新地址或重新扫码，保留原凭据。
- 本机音频 WAV 导出，笔记 Markdown / 转写文本分享。结束后在前台自动补传；没有后台运行时长保证，也没有“已传输就删除”的行为。

## 开发运行

环境基线：Flutter 3.47.6 / Dart 3.13.5，Android minSdk 24，iOS 15.0。依赖锁定在 `pubspec.lock`。安装完整 Xcode 或 Android Studio / SDK 后运行：

```sh
# 仓库根目录：沿用现有 Python 环境和模型配置
npm install
npm run build
npm start

# 另一个终端
cd mobile
flutter pub get
flutter doctor -v
flutter devices
flutter run -d <device-id>
```

电脑「设置 → 设备连接 → 连接新设备」，两台设备连接可互通的局域网。允许电脑本地网络/防火墙访问 TCP 43187；无需公网端口映射。手机扫描二维码，或者填写电脑显示的地址和 PIN。核对两端校验码，在电脑允许连接。电脑需要装好对应转写模型，模型不可用时手机保留录音并显示处理错误。

首次打开未配对的手机应用，会通过 Bonjour / Android NSD 发现同一局域网的电脑并触发电脑连接弹窗；仍需扫码或 PIN、电脑核对校验码才能授权。电脑服务默认开启，手动关闭后不会自动重开。拒绝局域网权限或网络不支持发现时，可扫码或手动填写地址。多网卡电脑若二维码地址不可达，改填同一局域网的另一个地址。访客 Wi-Fi / AP 隔离、VPN 和电脑休眠可能阻止连接；恢复网络或唤醒电脑后重试。

```sh
# 手机逻辑和布局检查
cd mobile
flutter analyze
flutter test

# 仓库根目录：包含 HTTPS 手机协议、真实 WAV 去重及桌面回归
npm test

# 完整原生工具链安装后
cd mobile
flutter build apk --debug
flutter build ios --no-codesign
```

Android release 要求显式提供固定签名配置。iOS 需在 `ios/Runner.xcworkspace` 设置开发团队、签名与唯一 Bundle ID；真机运行需要签名。不要提交证书、keystore 或本机配置。

## 数据与恢复

手机应用支持目录 `recordings/<uuid>/`：`session.json`、按序号命名的 `.pcm`、缓存 `snapshot.json`。临时文件写完并 flush 后重命名；重启从完整 PCM 重建样本数。iOS 支持目录排除云备份，并配置首次解锁后可访问；Android 禁用应用备份。卸载应用会删除本地数据。

电脑数据目录 `mobile/` 保存 TLS 身份、设备 token 哈希、顺序上传缓存及处理进度；会议本身继续存入原会议库。手机只访问自己的会议，不接收电脑文件路径。补传未完成时阻止清理、迁移、取消信任和另开录音。当前一次仅一场录音，与现有 worker 一致。

录音样本时钟不计暂停时间；恢复处记录中断标记。网络中断不等于录音中断。电脑 worker 崩溃可能丢失尚未完成的转写任务，原始音频仍保留，会后用电脑精修补全。强制停止/杀进程无法保证继续录音；最后不足一秒的尚未落盘音频可能损失。

## 真机验收

修改录音、后台能力或同步逻辑后，需在目标平台验证以下场景；编译和自动化测试不能替代真机验收：

| 真机场景                                                   | 通过标准                                               |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| iPhone、Pixel 与至少一台国产 Android 锁屏 30 分钟 / 2 小时 | 实际音频连续；系统录音指示和通知真实；耗电、温升可接受 |
| 断 Wi-Fi、路由器重启、切换到原电脑热点                     | 本地录音继续，联网后无重复/缺片，最终样本数一致        |
| 电脑休眠、进程退出、手机被系统终止                         | 已落盘内容可恢复，页面明确标记中断，不伪造持续录音     |
| 来电、Siri/助手、蓝牙或耳机变化                            | 状态与实际麦克风一致，需要时用户主动继续               |
| 低空间、拒绝麦克风/相机/局域网权限                         | 给出可执行提示，保留已有录音；PIN 可替代扫码           |
| 修改电脑笔记、结束后精修                                   | 返回手机并可会后回看；手机未联网时显示本地缓存         |

不保证后台静默补传或被系统终止后继续录音；已落盘的音频保留供恢复。大字号、窄屏、超长会议、超大会议信息量和耗电需在目标设备验证。

## 日常开发与提交

常规路径：**功能分支 → 本地检查 → PR → 合并 main → Actions 打包 → TestFlight 内部测试 / Android 安装包**。本地 `git commit` 和功能分支的 `git push` 不会发布手机测试版；合并到 `main` 且改动匹配工作流路径时才发布。发布前由维护者配置下文 Secrets。普通开发者提交 PR 不需要持有发布私钥。

### 1. 创建分支并修改代码

在工作区干净时，从最新 `main` 创建分支；已有未提交修改时先整理，避免直接切换分支混入其他工作。

```sh
# 仓库根目录；分支名按本次任务修改
git switch main
git pull --ff-only origin main
git switch -c feature/mobile-transcript-layout
```

手机界面与同步逻辑在 `mobile/lib/`；原生后台能力在 `mobile/ios/`、`mobile/android/`。涉及配对协议或桌面联动时，同时检查 `electron/mobile-server.js`、`backend/worker_mobile.py` 和 `frontend/` 对应实现。修改前遵循[贡献规范](../CONTRIBUTING.md)。

需要新的展示版本时修改 `mobile/pubspec.yaml`，例如 `version: 0.1.5+5`。CI 保留 `0.1.5`，自动生成并覆盖 `+` 后的构建号；同一展示版本可以有多个测试构建，无需每个 PR 都升级版本。iOS 实时活动扩展从 Flutter 配置继承相同版本，不能另设版本号。

App Store 版本获批后，该版本的 TestFlight 上传通道会关闭。继续上传测试构建前，需要在 `pubspec.yaml` 中提高展示版本（例如 `1.0.0` → `1.0.1`）；只增加构建号或重跑旧提交无法解决 `90062` / `90186` 错误。

### 2. 检查并提交

```sh
cd mobile
flutter pub get --enforce-lockfile
flutter analyze
flutter test
ruby scripts/test-release.rb
cd ..

# 检查变更；下面的路径仅是本次修改涉及这些文件时的示例
git status --short
git diff
git add mobile/lib/main.dart mobile/pubspec.yaml
git diff --cached
git commit -m "调整手机会议字幕布局"
git push -u origin feature/mobile-transcript-layout
```

改动依赖时，运行 `flutter pub get` 更新并提交 `pubspec.lock`；其他时候使用 `--enforce-lockfile` 与 CI 保持一致。上面的 `git add` 应替换为实际修改的文件，包含必要的原生工程配置、测试和文档；提交前用 `git diff --cached` 检查**整个暂存区**。不要提交构建产物、录音、证书、私钥、密码或本机 SDK 路径。

按 [贡献规范](../CONTRIBUTING.md) 运行对应范围的检查，涉及桌面或后端时在仓库根目录运行 `npm test`；修改桌面样式源 `frontend/tailwind.css` 时，先运行 `npm run build` 并一起提交生成的 `frontend/styles.css`。涉及 ASR 或说话人分离时另跑对应模型检查。后台录音变更还需真机验证上文验收场景，单元测试和编译通过不能替代真机验证。

### 3. 创建 PR 并合并

在 GitHub 为功能分支创建目标为 `main` 的 PR，说明改动、验证结果，以及桌面端配套版本、权限或协议影响。手机工作流对涉及 `mobile/**` 或 `.github/workflows/mobile.yml` 的 PR 运行检查；通过检查和项目要求的审阅后再合并。仅修改桌面代码不会触发手机分发。维护者直接推送到 `main` 也会触发同样的发布条件。

### 4. 取得测试版本与处理失败

打开仓库 **Actions → Mobile CI and distribution**，核对运行对应的提交和各任务状态：

- iOS：`ios` 任务完成上传、等待 Apple 处理并分配内部测试组后，受邀账号可在 TestFlight 更新。上传成功不等于已经可安装。
- Android：在本次运行的 **Artifacts** 中下载 `Brevia-android-<构建号>`，解压后用 APK 安装；AAB 用于后续商店提交，不能直接在手机安装。当前不自动发布到 Google Play 或 GitHub Release。
- 检查失败：先修复并提交。签名或上传失败：查看失败步骤，由维护者核对 Secrets、证书、描述文件或 Apple 处理状态，不必修改业务代码绕过检查。
- 某个平台失败不代表另一平台未发布；先核对各任务结果。需要重新打包上传时选择 **Re-run all jobs**，以分配新构建号，避免重用已上传的构建号。

无需新提交而要重新发布时，在该工作流选择 **Run workflow → main → testflight**。日常测试不要选择 `appstore`；正式送审需要指定已验收的版本和构建号，详见下文。

## GitHub Actions：CI、TestFlight 与正式发布

工作流：`.github/workflows/mobile.yml`（Mobile CI and distribution）。

- PR 涉及 `mobile/**` 或该工作流：只跑静态分析与测试，不读取发布密钥。
- push 到 `main` 且上述路径有变化：检查通过后，iOS 上传并等待 Apple 处理，分配到“Brevia 内部测试”；Android 生成固定签名 APK / AAB，保存在本次 Actions 的 Artifacts 中。没有自动上传 Google Play。
- 手动运行选择 `testflight`：与自动推送相同；必须选择 `main`。
- 版本名来自 `pubspec.yaml`。构建号是自 2026-01-01 起的秒数加 1000，两端共用，括号数字会较大。发布任务串行，不中断正在上传的构建。重新上传时使用 **Re-run all jobs** 分配新号，不单独重跑已成功上传的任务。
- iOS 保存 IPA 和 dSYM，测试说明带 Git commit。安卓不回退到 debug 签名；旧 debug 签名 APK 无法被新签名覆盖，首次换签需要先备份录音再卸载旧包。

### 首次配置 Secrets

维护者需在仓库 Actions Secrets 配置以下项目。App Store Connect API Key 需具备 App Manager 权限；CI 导出使用主应用与实时活动扩展各自的描述文件进行手动签名。电脑端 `APPLE_CERTIFICATE_*` 为 Developer ID 证书，不能用于 iOS。

| Secret                         | 内容                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `IOS_CERTIFICATE_P12_BASE64`   | Apple Distribution 证书及私钥导出的带密码 P12 的 Base64                                    |
| `IOS_CERTIFICATE_PASSWORD`     | P12 密码                                                                                   |
| `IOS_PROFILE_BASE64`           | 手动创建的 App Store Connect 分发描述文件 Base64，匹配主应用 Bundle ID、开发团队和上述证书 |
| `IOS_EXTENSION_PROFILE_BASE64` | 匹配实时活动扩展 Bundle ID 的 App Store 分发描述文件 Base64，与主应用使用同一分发证书      |
| `ASC_KEY_ID`                   | App Store Connect 团队 API Key ID                                                          |
| `ASC_ISSUER_ID`                | 对应 Issuer ID                                                                             |
| `ASC_KEY_P8_BASE64`            | API Key 的 P8 私钥 Base64，需要 App Manager 权限以分发和提交审核                           |
| `ANDROID_KEYSTORE_BASE64`      | 固定 Android release/upload keystore Base64                                                |
| `ANDROID_KEYSTORE_PASSWORD`    | keystore 密码                                                                              |
| `ANDROID_KEY_ALIAS`            | 签名条目别名                                                                               |
| `ANDROID_KEY_PASSWORD`         | 签名条目密码                                                                               |

通过 GitHub Secret 页面或 `gh secret set NAME < 文件` 配置凭据；不要复用桌面证书，不要把凭据放进 issue、聊天或代码。签名密钥与 API Key 备份存放在仓库之外。描述文件、证书到期或换证后更新 Secrets。CI 使用临时钥匙串，结束后清理签名文件。

手机与电脑使用局域网 HTTPS 连接。维护者需按当前实现、依赖及供应地区重新复核 Apple 加密问卷，并在仓库 Actions Variables 中明确设置 `IOS_USES_NON_EXEMPT_ENCRYPTION` 为 `true` 或 `false`；本地运行 beta lane 时设置同名环境变量。缺失或非法值会在上传前失败，不会自动代答。该值表示是否使用非豁免加密，不是“是否包含任何加密”；该配置不替代正式 App Store 声明。

本次移除跨网传输及其加密依赖后，历史加密问卷结论不再作为当前实现的验收依据。下次送审前需重新复核；不要仅根据移除功能自动修改仓库中的申报变量。

### 正式发布

**每次 iOS 送审前，执行者必须重新阅读本节和根目录 `AGENTS.md`，不能只沿用上一轮检查结论。优先通过 App Store Connect API 提交，默认入口为现有 GitHub Actions 的 `appstore` 通道；浏览器用于补齐 API 未覆盖的资料或诊断实际失败。**

送审前逐项核对：

- 明确目标版本、构建号和候选提交；在 TestFlight 完成该构建的真机验收及公开电脑端配对、转写兼容性检查。不能用旧录像代替当前候选包验收。
- 读取当前正式版本和审核提交状态，优先使用 API；已等待审核、正在审核或审核通过时，报告现状，不重复提交。TestFlight 上传成功、内部测试分发及“准备提交”均不代表已送审。
- 确认所有已启用商店语言的介绍、更新说明、截图及适用的创意素材已保存且处理成功；核对支持与隐私网址、年龄分级、内容版权、审核联系资料和无需登录声明。需要电脑时提供可公开下载的配套版本与操作步骤；复用录像须注明录像版本及与当前版本的差异。
- 按实际数据流复核隐私标签、可选在线 AI 服务；按加密实现及供应地区复核加密申报和 `IOS_USES_NON_EXEMPT_ENCRYPTION`。历史结论不自动适用于更改后的服务或地区。
- 确认开发者协议、适用地区合规及发布设置；保持手动发布，除非用户明确要求变更。协议需要接受时交由账户持有人处理。网页提示异常时核对账户与 API 实际结果，不据此直接断言 API 也失败，不绕过协议要求。
- 确认用户已授权本次送审，并核对 `mobile-production` Environment 仍限制为 `main`、已配置 Required reviewers。仅写 `environment:` 不会自动开启审批规则；沿用现有审批，不提取或输出 API 私钥，也不从本机绕过审批。

检查通过后，在仓库根目录通过 GitHub CLI 触发既有工作流。先将 `RELEASE_VERSION`、`RELEASE_BUILD` 设置为本次已验收的实际值：

```sh
gh workflow run mobile.yml --repo zerolovesea/Brevia --ref main \
  -f channel=appstore -f version="$RELEASE_VERSION" -f build="$RELEASE_BUILD"
```

此入口运行 `mobile/fastlane/Fastfile` 的 `promote` lane，使用 App Store Connect API Key 复用指定构建送审。它跳过二进制、商店文案和截图上传，不重新编译、不自动上线；资料必须事先保存。通过审核后再手动发布。

触发后跟踪对应 Actions 运行及环境审批。任务结束后回读 App Store Connect 的正式审核提交记录，确认目标版本和构建、提交时间及“等待审核”或后续审核状态，再报告成功。记录工作流链接、实际提交方式及状态依据；不能仅凭任务触发成功或提交者显示名称判断送审成功或操作来源。API 实际失败时记录错误与阻塞，只有需要网页补查或备用提交时才切换并说明原因；切换前先确认没有已经成功的提交。

安卓使用同次 CI 的 AAB，在 Google Play Console 配置 Play App Signing、应用资料及审核后提交；Google Play 自动发布尚未接入，需要先确定账号与渠道。

缺少签名 Secrets 时发布任务明确失败，CI 检查仍可运行。本机开发使用 `flutter build apk --debug`；release 需设置 `ANDROID_KEYSTORE_PATH`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。

### 手机会议与桌面联动

桌面侧栏在“设置”下方提供独立“设备连接”状态卡片，设置页在“说话人识别”和“进阶设置”之间提供“设备连接”独立入口；点击入口或侧栏卡片，在浮窗查看在线/离线设备、首次连接日期、录音会议次数和配对管理。旧版设备未保存的首次连接日期显示“未记录”；次数按实际收到音频的独立会议计算，重传不重复计数。已信任不等于在线，手机心跳超过 15 秒未到达时显示离线。

手机开会前从电脑读取工作区和模型列表，可设置标题、工作区、语言、识别模型与翻译；缺少模型时先到电脑安装。会议进入桌面实时页，离开实时页后保留任务卡片，列表、实时页和详情标记“手机录音”。暂停和结束在手机操作，电脑继续编辑笔记和查看字幕。

已结束且同步完成的会议，可在手机详情右上角“会议操作 → 删除本机记录”中删除。删除会清除手机录音和缓存，保留电脑会议；未补传记录需先同步，避免删除唯一音频副本。

手机与电脑仅通过同一局域网的 HTTPS 连接。离开局域网后可继续本地录音，回到同一网络后恢复已授权的上传。

### Android 手动更新

设置页的「检查更新」从 ModelScope `zyaztec/brevia-release/android/latest.json` 读取版本，按 Android build number 比较。同版本号的新构建也可更新。仅在用户点击时联网；确认后下载并校验文件大小、SHA-256，安装前核对包名和签名，由系统确认安装。首次安装可能需要允许 Brevia 安装未知来源应用，然后返回点击「安装更新」。Android 使用系统 DownloadManager 后台下载，切换页面或应用不会取消任务；返回设置页恢复进度，完成后点击安装。系统可能因网络或省电策略暂停下载，恢复条件后继续；安装前仍核对大小、SHA-256、包名和签名。iOS 检查当前 App Store 地区的公开版本，发现更新后点击跳转商店；TestFlight 构建号不参与正式版本比较，未上架时显示暂无商店版本。

Android workflow 复用 `MODELSCOPE_API_TOKEN`，先上传带版本和构建号的签名 APK，更新桌面端二维码使用的固定地址 `android/Brevia-android.apk`，成功后再发布 `android/latest.json`。清单发布失败会令工作流失败，旧清单仍指向旧包。首次上线此功能仍需手动安装带更新入口的 APK；iOS 商店更新后续接入。
