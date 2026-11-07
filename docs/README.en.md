<h1 align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></h1>

<p align="center"><strong>Brevia 2.0 · Local AI meeting assistant</strong><br />Follow bilingual captions, capture decisions, and jump from meeting minutes back to the original conversation.</p>

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

![Brevia](assets/showcase/desktop/en/live.gif)

## Download

| Platform | Download                                                                                             | Requirements                 |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Mac      | [macOS][download-mac]                                                                                | Apple Silicon · macOS 14+    |
| Windows  | [Windows][download-windows]                                                                          | Windows 10 / 11 · x64 · AVX2 |
| iPhone   | [App Store](https://apps.apple.com/app/id6819869442)                                                 | iOS 15+                      |
| Android  | [APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) | Android 7+                   |

[download-mac]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.1/Brevia-WebKit-2.0.1-arm64.dmg
[download-windows]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.1/Brevia-2.0.1-x64-setup.exe

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases) · [brevia.work](https://brevia.work)

The Mac installer is about **43 MiB** (45.5 MB), and the Windows installer is **38 MB**. Download the language models you need on first use.

## From conversation to minutes

- **Transcription and translation.** Record your microphone and computer audio with live bilingual captions, or import an interview and export SRT subtitles.
- **Speaker recognition.** See who said what, correct a name, and save a voice profile to recognize the same speaker next time.

Fast transcription: On an M4 Pro, Brevia transcribed a **66 min 40 s** recording in **3 min 33 s**.

### AI notes

Choose which suggested decisions and tasks to keep alongside your own notes as the conversation unfolds.

![An AI suggestion to add a follow-up task to the meeting notes](assets/showcase/desktop/en/ai-notes.png)

### Meeting capsule

With the main window tucked away, pause or stop recording from the floating capsule. Expand it to read live bilingual captions or check your notes.

<img src="assets/showcase/desktop/en/capsule.png" width="352" alt="Expanded meeting capsule with bilingual captions, a Notes tab and recording controls" />

### Minutes and fishbone diagrams

Edit the meeting summary and explore the reasons behind each conclusion. Select a timestamp to hear the original exchange.

[![Meeting minutes beside a fishbone diagram with a source passage expanded](assets/showcase/desktop/en/summary.png)](assets/showcase/desktop/en/summary.gif)

## Connect your phone

On the same local network, scan the QR code under **Settings → Device Connection**. Use your phone as a wireless microphone or follow live captions. You can also record on your phone and transfer the meeting to your computer later.

![Live meeting captions on a paired phone and computer](assets/showcase/desktop/en/phone.png)

## Ask your agent

Under **Settings → Agent & MCP**, copy the instructions into your local agent. It reads the bundled **Skill** and calls Brevia through the **CLI**. For an **MCP** client, copy the configuration from the same screen.

> Transcribe the Spanish interview on my desktop, then translate the subtitles into English. Save both as SRT files.

![An agent uses Brevia to save Spanish and English SRT subtitles](assets/showcase/desktop/en/agent.png)

## CLI parameters

Use `brevia METHOD [JSON] [--no-start]`. Replace `brevia` with the CLI path shown under **Settings → Agent & MCP**. Run `brevia help` to list methods or `brevia status --no-start` to check status without launching the app.

For `inference.run`, set `operation` to `transcribe` or `translate`. Use absolute paths for `input_path` and `output_path`. The source `language` defaults to `auto`. Translation requires `target_language`.

```sh
brevia inference.run '{"operation":"transcribe","input_path":"/Users/me/interview.wav","language":"es","output_path":"/Users/me/interview.srt"}'
brevia task.get '{"task_id":"123e4567-e89b-42d3-a456-426614174000"}'
```

Replace the example paths with your own. Pass the returned `task_id` to `task.get` and read the output file when the status is `completed`. [All commands and parameters](../DEVELOPMENT.md#本机-agent-接口)

## Your data

No account required. Recordings and meetings stay on your devices. Local models work offline once downloaded. If you choose an online AI provider, the relevant text goes to that provider. [Privacy](https://brevia.work/privacy.html)

## Technology stack

- **Desktop** uses Tauri and Rust with the built-in WebKit on macOS and WebView2 on Windows. Meeting records are stored locally in SQLite.
- **Mobile** uses Flutter to share the recording and pairing interface across iOS and Android.
- **Local AI** uses sherpa-onnx to identify speakers and llama.cpp to generate meeting summaries. On Apple Silicon Macs, Brevia uses MLX to run the FunASR Nano, Qwen3-ASR and Parakeet transcription models.

## Contribute

[Issues](https://github.com/zerolovesea/Brevia/issues) · [Development](../DEVELOPMENT.md) · [Docs](README.md)

Licensed under ISC. Models and third-party components retain their own licenses. Thanks to Tauri, MLX, sherpa-onnx, llama.cpp, miniaudio and the model authors. [ISC](../LICENSE).
