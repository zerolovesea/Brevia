<h1 align="center"><img src="docs/assets/brevia-mark.svg?v=3" width="100%" alt="Brevia · 言录" /></h1>

<p align="center"><strong>Brevia 2.0 · 本地 AI 会议助手</strong><br />会中看双语字幕、记下决定，会后从纪要回到每一句原话。</p>

<p align="center"><a href="docs/README.en.md">English</a> · <strong>简体中文</strong> · <a href="docs/README.es.md">Español</a> · <a href="docs/README.ja.md">日本語</a> · <a href="docs/README.ko.md">한국어</a> · <a href="docs/README.fr.md">Français</a> · <a href="docs/README.de.md">Deutsch</a> · <a href="docs/README.ru.md">Русский</a></p>

![实时转写与会议笔记](docs/assets/showcase/desktop/zh/live.gif)

## 下载

| 设备    | 下载                                                                                                 | 系统要求                     |
| ------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Mac     | [macOS 版][download-mac]                                                                             | Apple Silicon · macOS 14+    |
| Windows | [Windows 版][download-windows]                                                                       | Windows 10 / 11 · x64 · AVX2 |
| iPhone  | [App Store](https://apps.apple.com/app/id6819869442)                                                 | iOS 15+                      |
| Android | [APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) | Android 7+                   |

[download-mac]: https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/Brevia-WebKit-2.0.1-arm64.dmg
[download-windows]: https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/Brevia-2.0.1-x64-setup.exe

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases) · [官网](https://brevia.work)

Mac 版安装包约 **43 MiB**（45.5 MB），Windows 版约 **38 MB**。首次使用时，按需要下载语言模型。

## 从录音到会议纪要

- **转写与翻译**　录制麦克风和电脑声音，边听边看双语字幕。也可以导入已有的访谈录音，导出 SRT 字幕。
- **说话人识别**　逐字稿按发言人分段。保存声纹后，下次开会也能认出熟悉的声音；名字和原文都可以修正。
- **快速转写** 在 M4 Pro 上，一段 **66 分 40 秒**的录音，完整转写共用了 **3 分 33 秒。**

### 会议纪要与鱼骨图

会后生成可编辑的纪要。鱼骨图把结论和背后的原因放在一起，点时间戳就能回听对应的原话。

[![会议回看：左侧是纪要，右侧鱼骨图展开了结论对应的发言](docs/assets/showcase/desktop/zh/summary.png)](docs/assets/showcase/desktop/zh/summary.gif)

### AI 笔记

讨论过程中，AI 会建议值得记下的决定和待办，你可以选择采纳，也可以随手写下自己的笔记。

![AI 建议将发言中的待办加入会议笔记](docs/assets/showcase/desktop/zh/ai-notes.png)

## 手机和电脑一起开会

在同一局域网内，用手机扫描电脑 **设置 → 设备连接** 里的二维码。手机可以充当无线麦克风，也可以查看实时字幕。外出时用手机独立录音，回来后传给电脑继续转写、整理。

![手机与电脑显示同一场会议的实时字幕](docs/assets/showcase/desktop/zh/phone.png)

## 会议胶囊

收起主窗口后，在悬浮的会议胶囊里就能暂停或结束录音。展开胶囊，可以查看实时双语字幕和会议笔记。

<img src="docs/assets/showcase/desktop/zh/capsule.png" width="352" alt="展开的会议胶囊，显示双语字幕、笔记页签和录音控件" />

## 把任务交给 Agent

在 **设置 → Agent 与 MCP** 一键复制引导语，发给本机 Agent。它会读取 Brevia 的 **Skill**，通过 **CLI** 直接调用转写、翻译或会议检索。支持 **MCP** 的客户端也可以从同一页复制配置接入。

> 把桌面上的西班牙语访谈转成字幕，再翻译成英文，两份都保存为 SRT。

![Agent 调用 Brevia，保存西班牙语原文和英语译文两份 SRT 字幕](docs/assets/showcase/desktop/zh/agent.png)

## CLI 参数

命令格式为 `brevia 方法 [JSON 参数] [--no-start]`。在 **设置 → Agent 与 MCP** 的引导语里找到本机 CLI 路径，用它替换示例中的 `brevia`。运行 `brevia help` 查看全部方法，`brevia status --no-start` 只检查状态。

用 `inference.run` 处理文件：`operation` 选 `transcribe`（转写）或 `translate`（翻译）；`input_path` 和 `output_path` 填绝对路径。`language` 是原文语言，默认 `auto`；翻译还需填写目标语言 `target_language`。

```sh
brevia inference.run '{"operation":"transcribe","input_path":"/Users/me/interview.wav","language":"es","output_path":"/Users/me/interview.srt"}'
brevia task.get '{"task_id":"123e4567-e89b-42d3-a456-426614174000"}'
```

把示例路径换成自己的文件路径。命令返回 `task_id`，用 `task.get` 查询，状态为 `completed` 时读取输出文件。 [完整命令与参数](DEVELOPMENT.md#本机-agent-接口)

## 数据与隐私

无需账号。录音和会议保存在自己的设备上，下载模型后可离线使用。选择在线 AI 时，相关文字会发送给你配置的服务商。[隐私政策](https://brevia.work/privacy.html)

## 技术栈

- **桌面端**用 Tauri 和 Rust 构建，借助系统自带的 WebKit（macOS）或 WebView2（Windows）显示界面。会议记录存储在本地 SQLite 数据库中。
- **手机端**用 Flutter 开发，iOS 和 Android 共用一套录音与配对界面。
- **本地 AI** 使用 sherpa-onnx 识别说话人，使用 llama.cpp 生成会议纪要。在 Apple Silicon Mac 上，Brevia 使用 MLX 运行 FunASR Nano、Qwen3-ASR 和 Parakeet 转写模型。

## 参与项目

[报告问题](https://github.com/zerolovesea/Brevia/issues) · [开发者手册](DEVELOPMENT.md) · [文档](docs/README.md)

采用 [ISC 许可证](LICENSE)。模型与第三方组件遵循各自许可。感谢 Tauri、MLX、sherpa-onnx、llama.cpp、miniaudio 及各模型的作者与维护者。
