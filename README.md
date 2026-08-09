<p align="center"><img src="docs/assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>A minimal, local-first AI meeting assistant.</strong><br />Live transcription · multilingual · speaker identification · AI summaries — no audio leaves your device.</p>

<p align="center">
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/v/release/zerolovesea/Brevia?style=flat-square" alt="Release" /></a>
  <a href="https://github.com/zerolovesea/Brevia/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zerolovesea/Brevia?style=flat-square" alt="License" /></a>
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/downloads/zerolovesea/Brevia/total?style=flat-square" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-43-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
</p>

<p align="center"><strong>English</strong> · <a href="docs/README.zh-CN.md">简体中文</a> · <a href="docs/README.es.md">Español</a> · <a href="docs/README.ja.md">日本語</a> · <a href="docs/README.ko.md">한국어</a> · <a href="docs/README.fr.md">Français</a> · <a href="docs/README.de.md">Deutsch</a> · <a href="docs/README.ru.md">Русский</a></p>

---

## About

Brevia is a desktop AI meeting assistant that hands the most time-consuming part of any meeting — capturing, organizing, and revisiting — off to on-device AI. It records microphone and system audio at the same time, streams live captions, and turns the finished conversation into structured notes. All speech recognition runs locally; recordings, transcripts, and speaker profiles stay on your machine by default.

The design is deliberately quiet: an interface that doesn't get in the way of the meeting, a feature set that follows a single arc — **capture → understand → retrieve** — and a firm rule that anything that can happen locally should.

## Features

### A quiet meeting screen with live transcription and translation

Open it, press record, watch the captions appear. Brevia captures your microphone and system audio at once, so both sides of a remote call land in the same transcript. Optional live translation renders next to the caption stream for cross-language conversations.

![Live meeting and translation](docs/assets/tour/en/%E5%AE%9E%E6%97%B6%E4%BC%9A%E8%AE%AE%E5%92%8C%E7%BF%BB%E8%AF%91.png)

### 30+ transcription languages and AI meeting notes

Brevia transcribes speech in 30+ languages — including English, Chinese, Japanese, Korean, French, German, Spanish, Russian, Arabic, Thai, Vietnamese, and Indonesian. Once a meeting ends, plug in any LLM provider and Brevia will draft the meeting summary, key decisions, and action items in one pass.

Built-in AI runs a bundled model on your own machine, or plug in Claude, OpenAI, OpenRouter, or any service that speaks the OpenAI or Anthropic chat format. Only text is sent, never audio.

![Multilingual support and AI notes](docs/assets/tour/en/%E5%A4%9A%E8%AF%AD%E8%A8%80%E6%94%AF%E6%8C%81%E4%B8%8E%E4%BC%9A%E8%AE%AE%E7%BA%AA%E8%A6%81.png)

### Voiceprint enrollment and cross-meeting speaker identification

Enroll a short voice sample per teammate and Brevia will recognize them by name in every future meeting — not as "Speaker 1, Speaker 2," but as the people they are. Recognition works across recordings, so browsing back through last week's meetings to find "what did Alice say?" is a single click.

Powered by Pyannote segmentation plus speaker-embedding models, all running on-device.

![Voiceprint enrollment](docs/assets/tour/en/%E6%B3%A8%E5%86%8C%E5%A3%B0%E7%BA%B9%E8%AF%86%E5%88%AB.png)

### A curated local model library

27+ downloadable models covering streaming ASR, offline refinement, punctuation restoration, voice activity detection, speaker diarization, speaker embedding, text-to-speech, and source separation. Mix and match by language and precision — everything runs on your device.

![Model library](docs/assets/tour/en/%E6%A8%A1%E5%9E%8B%E5%BA%93.png)

### And more

- **TTS voice synthesis and cloning** — ZipVoice uses reference audio from enrolled speakers to synthesize Chinese and English speech; VITS voices are available for German, French, Spanish, Russian, and Korean.
- **Source separation** — Spleeter splits recordings into vocal and non-vocal stems for post-processing.
- **Audio import** — bring in existing recordings for offline transcription through the same speech pipeline.
- **Rich exports** — transcript and notes as Markdown, TXT, JSON, SRT, DOCX, or PDF; audio as FLAC, WAV, or M4A.
- **Multilingual UI** — English, Simplified Chinese, Spanish, Japanese, Korean, French, German, and Russian.

## Install

Download the latest release from [GitHub Releases](https://github.com/zerolovesea/Brevia/releases):

| Platform | Installer |
| --- | --- |
| macOS (Apple Silicon) | `Brevia-<version>-arm64.dmg` |
| Windows (x64) | `Brevia-<version>-x64-setup.exe` |
> Windows may show a **Microsoft Defender SmartScreen** prompt on first run. Click **"More info" → "Run anyway"** after verifying the download came from the official Releases page.

On first launch, grant microphone and screen-recording permissions, then open **Settings → Model Library** to download the models you need.

## Architecture

```mermaid
flowchart LR
  A[Electron renderer<br/>HTML · Tailwind · JS] <-->|IPC + Zod validation| B[Electron main process]
  B <-->|JSONL stdin/stdout| C[Python worker<br/>bundled runtime]
  C --> D[sherpa-onnx<br/>ASR · VAD · speakers · punctuation · TTS]
  C --> E[Local storage<br/>SQLite · audio · exports]
  C -. explicit consent .-> F[Optional cloud API<br/>LLM summary · translation]
```

Brevia follows a strict local-first design:

- **The renderer opens no network ports**, and every IPC message is validated by the Electron main process against a Zod schema.
- **The main process is a thin shell.** It launches a single Python worker over JSONL stdin/stdout; the worker owns model management, audio processing, speaker profiles, local storage, and exports.
- **Data lives in `~/brevia`** by default — SQLite, raw audio, exports, cached models, and voice profiles.
- **Cloud calls are opt-in.** LLM summaries and translation require the user to configure a provider explicitly, and only text is sent upstream.

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron 43 — preload bridge, context isolation, sandboxed renderer |
| Frontend | Vanilla HTML/CSS/JS, Tailwind CSS 4, built-in i18n (8 locales) |
| Backend | Python 3.10+, JSONL worker protocol, SQLite storage |
| Speech engine | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 1.13.2, ONNX Runtime |
| Speaker processing | Pyannote segmentation + 3D-Speaker / NeMo Titanet / CAM++ embeddings |
| LLM client | Built-in llama.cpp (GGUF) plus OpenAI- / Anthropic-compatible chat APIs |
| Audio I/O | ffmpeg (bundled in releases) |
| Build & packaging | electron-builder, PyInstaller (bundled Python runtime) |
## Supported models

Every model is downloaded on demand from **Settings → Model Library**. The manifest lives in [`backend/models.json`](backend/models.json).

| Category | Representative models | Languages |
| --- | --- | --- |
| Streaming ASR | Zipformer (zh / en / fr / ko / multilingual), Paraformer bilingual, Nemotron 3.5 | 30+ |
| Refinement ASR | Qwen3-ASR 0.6B / 1.7B, Whisper Turbo / Large v3, FireRedASR2, FunASR Nano | Multilingual |
| Punctuation | CT-Transformer zh+en, Online Punct English casing | zh / en |
| Voice activity detection | Silero VAD | Universal |
| Speech enhancement | GTCRN Live Denoiser | Universal |
| Speaker diarization | Pyannote Segmentation 3.0, Reverb Diarization v1 | Universal |
| Speaker embeddings | 3D-Speaker ERes2Net, CAM++, NeMo Titanet | zh / en |
| Source separation | Spleeter 2 Stems | Universal |
| Text-to-speech | ZipVoice (zh + en), VITS Piper (fr / de / es / ru), VITS Mimic3 (ko) | Multilingual |

For LLM summaries, pick **Built-in AI** to run a bundled GGUF model locally (Qwen 3.5 2B / 4B, Gemma 3 1B / 4B), or point Brevia at Claude, OpenAI, OpenRouter, or any custom service that speaks OpenAI Chat Completions or Anthropic Messages — Gemini (OpenAI-compatible endpoint), DeepSeek, Kimi, Qwen, and more.

## Local development

Prerequisites: Node.js 18+, Python 3.10+, Git, and ffmpeg (for audio import).

```bash
git clone https://github.com/zerolovesea/Brevia.git
cd Brevia
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

Grant microphone and screen-recording permissions on first launch, then download the models you need from **Settings → Model Library**.

### Common scripts

```bash
npm test                    # Electron behavior + UI + backend tests
npm run build               # Build Tailwind CSS
npm run test:model          # ASR model diagnostics
npm run test:diarization    # Speaker diarization diagnostics
npm run start:fresh         # Reset the onboarding flow and start
```

### Environment variables

```bash
BREVIA_DATA_DIR=/path/to/data       # Custom data dir (recordings, exports, SQLite)
BREVIA_MODELS_DIR=/path/to/models   # Custom model dir
BREVIA_FFMPEG=/path/to/ffmpeg       # ffmpeg binary (if not on PATH)

BREVIA_DATA_DIR=~/brevia-dev BREVIA_MODELS_DIR=~/brevia-models npm start
```
### Build installers

```bash
npm ci
npm run build
python3 -m pip install -r backend/requirements-build.txt
npm run dist:mac   # macOS ARM64 DMG
npm run dist:win   # Windows x64 EXE
```

Artifacts land in `dist/`. Each platform build bundles a native Python worker; models are not bundled — they remain on-demand downloads.

## FAQ

<details>
<summary><strong>Windows shows a Microsoft Defender SmartScreen warning</strong></summary>

Release builds are not signed with a paid code-signing certificate, and SmartScreen defaults to blocking newly-seen executables. Click **"More info" → "Run anyway"** after confirming the download came from the official [Releases](https://github.com/zerolovesea/Brevia/releases) page.
</details>

<details>
<summary><strong>Do I need to install Python separately?</strong></summary>

No. Release builds bundle the Python runtime and all required dependencies. A separate Python installation is only needed for running from source.
</details>

<details>
<summary><strong>Where is my data stored?</strong></summary>

`~/brevia` by default — recordings, transcripts, exports, cached models, voice profiles, and the SQLite database. Set `BREVIA_DATA_DIR` to override.
</details>

<details>
<summary><strong>Which transcription languages are supported?</strong></summary>

30+ languages including Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Arabic, Thai, Vietnamese, and Indonesian. Pick the matching model from the in-app Model Library.
</details>
<details>
<summary><strong>Does Brevia send audio to the cloud?</strong></summary>

No. Speech recognition, diarization, and TTS all run locally. Only LLM summaries and translation contact the network, and only after you configure a provider — text only, never audio.
</details>

<details>
<summary><strong>How much disk space do models need?</strong></summary>

Depends on which you install. A typical setup (streaming + refinement + diarization) is 1–2 GB. Compact streaming models start around 80 MB; larger models exceed 1 GB.
</details>

<details>
<summary><strong>Can I import existing recordings?</strong></summary>

Yes. Import audio files from the meeting library and Brevia will transcribe them offline through the same speech pipeline. Requires `ffmpeg` on PATH (or set `BREVIA_FFMPEG`).
</details>

<details>
<summary><strong>How do I switch the UI language?</strong></summary>

**Settings → General → Interface language.** English, Simplified Chinese, Spanish, Japanese, Korean, French, German, and Russian are available.
</details>

<details>
<summary><strong>How are voiceprint samples stored?</strong></summary>

Voice embeddings (a small float vector) and reference audio live in the local SQLite database and filesystem. Nothing leaves the device, and deleting a profile removes the associated data.
</details>

## Feedback and contributing

### Report an issue

Found a bug or have a feature request? Please file it in [GitHub Issues](https://github.com/zerolovesea/Brevia/issues). Reports triage faster when they include:

- OS and version (e.g. macOS 14.5 / Windows 11 23H2)
- Brevia version (**Settings → About**)
- Models and language in use
- Steps to reproduce / expected result / actual result
- Relevant logs (**Settings → Advanced → Open log folder**) — please review them for sensitive content before attaching

**Security issues:** please do not open a public issue. Reach out to the maintainer by email.

### Contributing

Pull requests are welcome. To keep the tree tidy:

1. Branch from `main` with a narrow focus — one concern per PR.
2. Run `npm test` before submitting; run `npm run test:model` and `npm run test:diarization` when touching ASR or diarization.
3. Do not commit downloaded models, recordings, exports, API keys, or anything from `~/brevia`.
4. When you change user-facing copy, update all eight locales in `frontend/i18n-data.js` — add the English source string and its translations together.
5. Note any model, platform, or permission impact in the PR description.

## License

Brevia is released under the [ISC License](LICENSE). Model files and third-party packages retain their own licenses and terms.

## Acknowledgments

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — the local runtime powering ASR, VAD, punctuation, speaker processing, and TTS. Licensed under [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE).
- Thanks to the model authors and maintainers whose downloadable artifacts are declared in [`backend/models.json`](backend/models.json), including Zipformer, Paraformer, Whisper, Qwen3-ASR, FireRedASR, FunASR, Pyannote, 3D-Speaker, NeMo, Silero, Spleeter, ZipVoice, VITS Piper / Mimic3, and more.
- Electron, ONNX Runtime, Python, and the open-source speech community make this local-first workflow possible.
