<h1 align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></h1>

<p align="center"><strong>Focus on the conversation. Keep what matters.</strong><br />A local-first AI meeting assistant. Record, transcribe and translate conversations, then turn them into editable notes and actions linked to the original audio.</p>

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

![Brevia](assets/showcase/desktop/en/live.gif)

## Download

| Platform | Download                                                                                             | Requirements                 |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Mac      | [macOS][download-mac]                                                                                | Apple Silicon · macOS 14+    |
| Windows  | [Windows][download-windows]                                                                          | Windows 10 / 11 · x64 · AVX2 |
| iPhone   | [App Store](https://apps.apple.com/app/id6819869442)                                                 | iOS 15+                      |
| Android  | [APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) | Android 7+                   |

[download-mac]: https://github.com/zerolovesea/Brevia/releases/download/v1.4.5/Brevia-1.4.5-arm64.dmg
[download-windows]: https://github.com/zerolovesea/Brevia/releases/download/v1.4.5/Brevia-1.4.5-x64-setup.exe

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases) · [brevia.work](https://brevia.work)

<!-- native-release-pending -->

This page describes the new features on main. Downloads still provide v1.4.5; native installers will arrive with the next release.

<!-- /native-release-pending -->

## What you can do

- Record your microphone and system audio together, with live transcription, translation, floating captions and recording controls.
- Identify speakers in the background while captions appear immediately. Refine the transcript afterward, correct names and save voice profiles.
- Write notes as you listen. Let AI extract decisions and tasks, then trace them back to the transcript and recording.
- Organize meetings in workspaces, search their contents, and export Markdown, TXT, JSON, SRT, DOCX, PDF or WAV.
- Import existing audio and video for transcription, translation and speaker analysis, or process files through your local agent.

![Brevia](assets/showcase/desktop/en/summary.gif)

## Get started

1. Install the desktop app and download a transcription model in **Settings → Model library**.
2. Start a meeting with your microphone, system audio or connected phone. You can also import a file.
3. Take notes during the meeting, refine the transcript afterward, and edit or export the results.

Inference engines come with the app. No Python installation or separate runtime download is needed. Download the model weights you want once, then use local models offline. Available models include FunASR, Qwen3-ASR, Parakeet, Whisper, Qwen and Hy-MT; availability depends on your platform.

## Record on your phone

Record offline, take notes and mark important moments. Upload the recording to your computer; once the computer confirms receipt, you can leave the phone app. Import and transcription continue on the desktop, and the phone keeps its copy. Your phone can also act as a desktop microphone or display live captions. Pair over the same local network in **Settings → Device connection**; live transcription requires the computer to remain running.

## Connect your local agent

Open **Settings → Agent & MCP**, copy the setup message and give it to your local agent. It reads the bundled Skill and uses Brevia through the CLI. For an MCP client, copy the MCP configuration from the same page.

> Transcribe the interview on my desktop and save it as an SRT file.
>
> Find last week’s meetings about the launch and list the unresolved questions.
>
> Start recording this meeting with my connected phone.

Agents can transcribe, translate, identify speakers, match voice profiles, search meetings and control recordings. Long tasks support progress and cancellation. Existing files are never overwritten, and Brevia can start in the background when needed.

[CLI / MCP](../DEVELOPMENT.md#本机-agent-接口) · [Brevia Skill](../skills/brevia/SKILL.md)

## Your data

No account required. Recordings, meetings and models stay on your devices. Phone sync uses local HTTPS. Local AI works offline; if you choose an online AI provider, relevant text is sent to that provider. [Privacy](https://brevia.work/privacy.html).

The desktop uses the system WebView (WebKit on macOS, WebView2 on Windows), shared meeting logic and native audio and inference engines. The mobile app uses Flutter.

## Contribute

[Issues](https://github.com/zerolovesea/Brevia/issues) · [Development](../DEVELOPMENT.md) · [Docs](README.md)

Licensed under ISC. Models and third-party components retain their own licenses. Thanks to Tauri, MLX, sherpa-onnx, llama.cpp, miniaudio and the model authors. [ISC](../LICENSE).
