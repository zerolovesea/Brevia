# Brevia 手机端 · 0.1

Flutter 共用界面与录音同步逻辑，包含 Android 和 iPhone 原生工程。此版本已通过 Android release APK 和 iOS App Store 签名 IPA 编译，并上传 TestFlight；真机后台稳定性仍待验收。设计参考见 [设计文档](../docs/mobile-design/README.md)。

## 已实现

- 会议库、搜索、配对、录音准备、实时转写、笔记、时间点重点、暂停与继续、结束、会后回听与文字分享、设置、深浅色。手机竖屏，24 pt 页面留白，正文 18 pt；沿用桌面米白与炭黑，使用平台导航过渡，底部导航淡入与主题切换 180 ms（导航响应减少动态效果设置），无波形装饰和持续闪动。
- 二维码，或输入电脑局域网 HTTPS 地址及 6 位 PIN；电脑应用内核对校验码后授权。凭据存入 Keychain / Android 安全存储。TLS 证书指纹固定，配对限时、限尝试次数；接口按设备隔离会议。
- 16 kHz 单声道 PCM16 录音，约 115 MB/小时。手机每秒保存分片；电脑持久化后才确认，顺序补传，重试幂等，部分写入恢复按实际样本数去重。
- 手机不运行识别或 AI 模型。电脑现有 worker 转写；已保存笔记和转写返回手机。AI 笔记配置、模型下载及会后精修继续在电脑完成。
- Android 使用麦克风前台服务及持续通知；iOS 使用原生录音会话和 audio 后台能力。来电或系统打断后显示中断，由用户继续；不会静默恢复麦克风。
- 断网后继续本地录音，2/4/8/15 秒退避重试。电脑重启恢复缓存；同一电脑 IP 改变时，可在连接页更新地址或重新扫码，保留原凭据。
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

Android release 现要求显式提供固定签名配置；此前生成的首轮 APK 为开发签名测试包。iOS 需在 `ios/Runner.xcworkspace` 设置开发团队、签名与唯一 Bundle ID；真机运行需要签名。不要提交证书、keystore 或本机配置。

## 数据与恢复

手机应用支持目录 `recordings/<uuid>/`：`session.json`、按序号命名的 `.pcm`、缓存 `snapshot.json`。临时文件写完并 flush 后重命名；重启从完整 PCM 重建样本数。iOS 支持目录排除云备份，并配置首次解锁后可访问；Android 禁用应用备份。卸载应用会删除本地数据。

电脑数据目录 `mobile/` 保存 TLS 身份、设备 token 哈希、顺序上传缓存及处理进度；会议本身继续存入原会议库。手机只访问自己的会议，不接收电脑文件路径。补传未完成时阻止清理、迁移、取消信任和另开录音。当前一次仅一场录音，与现有 worker 一致。

录音样本时钟不计暂停时间；恢复处记录中断标记。网络中断不等于录音中断。电脑 worker 崩溃可能丢失尚未完成的转写任务，原始音频仍保留，会后用电脑精修补全。强制停止/杀进程无法保证继续录音；最后不足一秒的尚未落盘音频可能损失。

## 验证记录与后续验收

首轮实现已通过 Flutter 静态分析、4 项手机存储/地址校验/小屏布局测试、电脑 HTTPS 配对与重启补传检查、桌面 UI/Electron/E2E 检查，以及 354 项 Python 测试。录音页面另做了实际 Flutter 渲染目视检查。

2026-10-07 已安装 Flutter 3.47.6、Android Studio、Android SDK 35/36、NDK 28.2、CMake 3.22.1 和 Xcode 27.0（iOS 27 SDK），复用 Java 21 与 CocoaPods 1.16.2。Flutter 位于 `~/.local/share/flutter`，Android SDK 位于 `~/Library/Android/sdk`，终端路径已写入 `~/.zprofile`。Android 工具链检查通过；未安装模拟器运行时，不影响真机目标编译。

已生成 `build/app/outputs/flutter-apk/app-release.apk`（内部测试签名）并通过签名验证；另生成 `build/ios/iphoneos/Runner.app`（未签名，不能直接安装 iPhone）。供取用的 APK 副本位于仓库 `dist/mobile/Brevia-0.1.0-android.apk`。iOS 构建为不支持 Swift Package Manager 的插件生成了 CocoaPods 配置，应保留 `Podfile` 和 `Podfile.lock`。

以下项目**尚未验证**，不能把编译成功等同于真机验收：

| 真机场景                                                   | 通过标准                                               |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| iPhone、Pixel 与至少一台国产 Android 锁屏 30 分钟 / 2 小时 | 实际音频连续；系统录音指示和通知真实；耗电、温升可接受 |
| 断 Wi-Fi、路由器重启、切换到原电脑热点                     | 本地录音继续，联网后无重复/缺片，最终样本数一致        |
| 电脑休眠、进程退出、手机被系统终止                         | 已落盘内容可恢复，页面明确标记中断，不伪造持续录音     |
| 来电、Siri/助手、蓝牙或耳机变化                            | 状态与实际麦克风一致，需要时用户主动继续               |
| 低空间、拒绝麦克风/相机/局域网权限                         | 给出可执行提示，保留已有录音；PIN 可替代扫码           |
| 修改电脑笔记、结束后精修                                   | 返回手机并可会后回看；手机未联网时显示本地缓存         |

尚未提供：蜂窝远程连接、后台静默补传保证、锁屏录音操作控件、PDF 导出、手机编辑笔记、自动清理音频、平板/横屏、多语言 UI。现有快照轮询与每秒 PCM 文件优先保证可恢复性；大规模会议库、超长会议的带宽、文件数量和耗电仍需实测，再决定是否改增量传输与分段封装。

## TestFlight 分发

2026-10-07 更新：`0.1.4 (5)` 已由本机打包并通过 Fastlane 分发至“Brevia 内部测试”，Apple 状态已核验为 `IN_BETA_TESTING`。新增 iOS 16.2 及以上的锁屏实时活动与灵动岛状态、Android 录音通知与返回入口，缩小启动 Logo，收紧字幕布局。10 项手机测试、静态分析、桌面 UI/E2E、iOS 签名导出与 Android release 构建通过，后台表现仍需真机验收。安装包副本：`dist/mobile/Brevia-0.1.4-5-ios.ipa` 与 `dist/mobile/Brevia-0.1.4-5-android.apk`。

2026-10-07 更新：`0.1.3 (4)` 已发布至“Brevia 内部测试”。手机复用桌面端 `brevia-logo-reveal.gif`，首帧播放满 1500ms 且初始化完成后，以 360ms 淡出；减少动态效果时使用静态标识。按 PNG 重排全屏欢迎、PIN、扫码框、会议双标签与图标控制、固定录音按钮、日期分组、设置行与结束保存页。9 项回归测试、静态分析、iOS 归档与 Android debug 编译通过。签名 IPA：`dist/mobile/Brevia-0.1.3-4-ios.ipa`。

2026-10-07 UI 更新：`0.1.2 (3)` 按 `docs/mobile-design` 调整连接欢迎/PIN/确认、会议列表与准备、转写/笔记标签、离线提示、回看播放器和设置视觉。Flutter 分析、小屏与大字号测试、iOS 归档及 Android debug 编译通过。已发布到“Brevia 内部测试”，IPA 保存在 `dist/mobile/Brevia-0.1.2-3-ios.ipa`。截图为 Flutter 渲染检查，不代替真机后台验收。

2026-10-07 更新：`0.1.1 (2)` 已从当前本机工作区构建、签名并上传，Apple 状态为 `IN_BETA_TESTING`，已核验分配至“Brevia 内部测试”。新增局域网发现、会议前设置与已同步记录的本机删除，需配合最新桌面端。IPA：`dist/mobile/Brevia-0.1.1-2-ios.ipa`。本次未通过 GitHub Actions 发布。

2026-10-07 已创建 Brevia 应用记录（Apple ID `6819869442`）、Bundle ID `com.brevia.breviaMobile`，团队为 `4M64879BBM`。版本 `0.1.0 (1)` 已由 Xcode 成功上传，Apple 后台处理已完成，加密问卷按标准 TLS、此次不在法国分发填写。分发证书与私钥存于当前 Mac 登录钥匙串；仓库不包含私钥。

签名 IPA 副本：`dist/mobile/Brevia-0.1.0-1-ios.ipa`（仓库根目录下）。这是 App Store 分发包，安装应通过 TestFlight。内部群组“Brevia 内部测试”已包含当前账号及 `0.1.0 (1)`，构建采用手动分配。测试员通过 Apple 邀请邮件在 iPhone 的 TestFlight 中接受并安装。

后续开发按下文「日常开发与提交」操作，默认由 GitHub Actions 打包发布。上述历史版本来自本机打包上传，不代表云端工作流已验证成功；本机发布时必须自行选择尚未使用的构建号。

## 日常开发与提交

常规路径：**功能分支 → 本地检查 → PR → 合并 main → Actions 打包 → TestFlight 内部测试 / Android 安装包**。本地 `git commit` 和功能分支的 `git push` 不会发布手机测试版；合并到 `main` 且改动匹配工作流路径时才发布。首次启用前，需要将手机端工程、锁文件、工作流、Fastlane 和签名脚本提交到远端，并由维护者配置下文 Secrets。普通开发者提交 PR 不需要持有发布私钥。

### 1. 创建分支并修改代码

在工作区干净时，从最新 `main` 创建分支；已有未提交修改时先整理，避免直接切换分支混入其他工作。

```sh
# 仓库根目录；分支名按本次任务修改
git switch main
git pull --ff-only origin main
git switch -c feature/mobile-transcript-layout
```

手机界面与同步逻辑在 `mobile/lib/`；原生后台能力在 `mobile/ios/`、`mobile/android/`。涉及配对协议或桌面联动时，同时检查 `electron/mobile-server.js`、`backend/worker_mobile.py` 和 `frontend/` 对应实现。设计参考位于 `docs/mobile-design/`。

需要新的展示版本时修改 `mobile/pubspec.yaml`，例如 `version: 0.1.5+5`。CI 保留 `0.1.5`，自动生成并覆盖 `+` 后的构建号；同一展示版本可以有多个测试构建，无需每个 PR 都升级版本。iOS 实时活动扩展从 Flutter 配置继承相同版本，不能另设版本号。

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

按主 README 的贡献要求运行仓库根目录 `npm test`；修改桌面样式源 `frontend/tailwind.css` 时，先运行 `npm run build` 并一起提交生成的 `frontend/styles.css`。涉及 ASR 或说话人分离时另跑对应模型检查。后台录音变更还需真机验证上文验收场景，单元测试和编译通过不能替代真机验证。

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

已在仓库 Actions Secrets 配齐以下 11 项配置。App Store Connect API 使用“Brevia GitHub Actions”团队密钥（App Manager 权限），已通过 API 实测读取 Brevia 应用和“Brevia 内部测试”群组。CI 导出使用主应用与实时活动扩展各自的描述文件进行手动签名，不依赖云签名权限。现有电脑端 `APPLE_CERTIFICATE_*` 为 Developer ID 证书，不能用于 iOS。

| Secret                         | 内容                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `IOS_CERTIFICATE_P12_BASE64`   | Apple Distribution 证书及私钥导出的带密码 P12 的 Base64                                                             |
| `IOS_CERTIFICATE_PASSWORD`     | P12 密码                                                                                                            |
| `IOS_PROFILE_BASE64`           | 手动创建的 App Store Connect 分发描述文件 Base64，应用 `com.brevia.breviaMobile`、团队 `4M64879BBM`，包含上述证书   |
| `IOS_EXTENSION_PROFILE_BASE64` | 扩展 `com.brevia.breviaMobile.RecordingActivity` 的手动创建 App Store 分发描述文件 Base64，与主应用使用同一分发证书 |
| `ASC_KEY_ID`                   | App Store Connect 团队 API Key ID                                                                                   |
| `ASC_ISSUER_ID`                | 对应 Issuer ID                                                                                                      |
| `ASC_KEY_P8_BASE64`            | API Key 的 P8 私钥 Base64，需要 App Manager 权限以分发和提交审核                                                    |
| `ANDROID_KEYSTORE_BASE64`      | 固定 Android release/upload keystore Base64                                                                         |
| `ANDROID_KEYSTORE_PASSWORD`    | keystore 密码                                                                                                       |
| `ANDROID_KEY_ALIAS`            | 签名条目别名                                                                                                        |
| `ANDROID_KEY_PASSWORD`         | 签名条目密码                                                                                                        |

iOS 私钥位于本机登录钥匙串。导出后通过 `gh secret set NAME < 文件` 或 GitHub Secret 页面设置；不要复用桌面证书，不要把凭据放进 issue、聊天或代码。安卓固定签名密钥已创建；本机签名备份保存在仓库外的 `~/.local/share/brevia-signing/`，目录仅当前用户可访问。API Key 已创建并备份到同一目录；私钥和密码未写入仓库。描述文件、证书到期或换证后更新 Secrets。CI 使用临时钥匙串，结束后清理签名文件。

Beta 出口声明按当前已确认范围：标准 TLS、内部测试、不在法国分发。更改加密实现、依赖或扩大分发地区前，重新核对 Apple 要求与 `fastlane/Fastfile` 设置。该设置不覆盖正式 App Store 送审声明。

### 正式发布

1. 在 TestFlight 验收指定版本和构建号。在 App Store Connect 完成描述、截屏、隐私政策与问卷、年龄分级、审核联系信息、局域网电脑配套使用说明和适用地区的合规信息。
2. 在 GitHub 创建 `mobile-production` Environment，限制为 `main` 并配置 Required reviewers。仅写 `environment:` 不会自动开启审批规则。
3. 手动运行工作流，选择 `appstore`，填写已验收版本（如 `1.0.0`）和构建号。复用该构建提交审核，不重新编译、不自动上线；通过审核后在 App Store Connect 手动发布。
4. 安卓使用同次 CI 的 AAB，在 Google Play Console 配置 Play App Signing、应用资料及审核后提交；Google Play 自动发布尚未接入，需要先确定账号与渠道。

缺少签名 Secrets 时发布任务明确失败，CI 检查仍可运行。本机开发使用 `flutter build apk --debug`；release 需设置 `ANDROID_KEYSTORE_PATH`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。

### 手机会议与桌面联动

桌面侧栏在“设置”下方提供独立“设备连接”状态卡片，设置页在“说话人识别”和“进阶设置”之间提供“设备连接”独立入口；点击入口或侧栏卡片，在浮窗查看在线/离线设备、首次连接日期、录音会议次数和配对管理。旧版设备未保存的首次连接日期显示“未记录”；次数按实际收到音频的独立会议计算，重传不重复计数。已信任不等于在线，手机心跳超过 15 秒未到达时显示离线。

手机开会前从电脑读取工作区和模型列表，可设置标题、工作区、语言、识别模型与翻译；缺少模型时先到电脑安装。会议进入桌面实时页，离开实时页后保留任务卡片，列表、实时页和详情标记“手机录音”。暂停和结束在手机操作，电脑继续编辑笔记和查看字幕。

已结束且同步完成的会议，可在手机详情右上角“会议操作 → 删除本机记录”中删除。删除会清除手机录音和缓存，保留电脑会议；未补传记录需先同步，避免删除唯一音频副本。
