<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>디바이스에서 완결되는 미니멀 회의 녹음기.</strong><br />전사, AI 요약, 기억 — 클라우드 없이, 완전한 프라이버시.</p>

<p align="center">
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/v/release/zerolovesea/Brevia?style=flat-square" alt="Release" /></a>
  <a href="https://github.com/zerolovesea/Brevia/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zerolovesea/Brevia?style=flat-square" alt="License" /></a>
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/downloads/zerolovesea/Brevia/total?style=flat-square" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-43-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

## 제품 투어

| | |
| --- | --- |
| ![회의 라이브러리](assets/tour/en/library.png) | ![회의 시작](assets/tour/en/prepare.png) |
| ![모델 라이브러리](assets/tour/en/models.png) | ![로컬 설정](assets/tour/en/settings.png) |

![AI 회의 노트](assets/tour/en/notes.png)

## 기능

- **실시간 전사** — 마이크와 시스템 오디오를 동시에 캡처하고 회의 중 실시간 자막을 표시합니다.
- **완전한 로컬 음성 AI** — 스트리밍 ASR, 문장부호 복원, 사후 정제, VAD, 화자 분리 모두 sherpa-onnx를 통해 기기에서 실행됩니다. 음성이 기기를 떠나지 않습니다.
- **27개 다운로드 가능 모델** — Zipformer, Paraformer, Whisper, SenseVoice, FireRedASR, FunASR 등 30개 이상 언어를 지원합니다.
- **화자 식별** — Pyannote 분할 + 음성 임베딩 모델로 자동 화자 분리. 녹음 간 이름 변경 및 추적 가능.
- **풍부한 내보내기** — 전사/노트를 Markdown, TXT, JSON, SRT, DOCX, PDF로, 오디오를 FLAC, WAV, M4A로 내보내기.
- **오디오 가져오기** — 기존 녹음을 가져와 오프라인 전사 및 정제.
- **선택적 AI 요약** — 명시적 동의와 공급자 설정 후에만 번역과 구조화 노트를 생성.
- **다국어 UI** — 영어, 중국어 간체, 스페인어, 일본어, 한국어, 프랑스어, 독일어, 러시아어.

## 설치

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases)에서 최신 버전을 다운로드하세요:

| 플랫폼 | 파일 |
| --- | --- |
| macOS (Apple Silicon) | `Brevia-<version>-arm64.dmg` |
| Windows (x64) | `Brevia-<version>-x64-setup.exe` |

> **미서명 빌드 안내:** macOS에서 "손상됨" 또는 열 수 없다고 표시될 수 있습니다. **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 선택하거나 터미널에서 실행:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/Brevia.app"
> ```
>
> Windows에서는 Microsoft Defender SmartScreen이 경고할 수 있습니다 — 다운로드 출처를 확인한 후 진행하세요.

## 아키텍처

```mermaid
flowchart LR
  A[Electron 렌더러<br/>HTML · Tailwind · JS] <-->|IPC + Zod 검증| B[Electron 메인 프로세스]
  B <-->|JSONL stdin/stdout| C[Python Worker<br/>번들 런타임]
  C --> D[sherpa-onnx<br/>ASR · VAD · 화자 분리 · 문장부호]
  C --> E[로컬 스토리지<br/>SQLite · 오디오 · 내보내기]
  C -. 명시적 동의 .-> F[선택적 클라우드 API<br/>요약 · 번역]
```

Brevia는 엄격한 로컬 우선 설계를 따릅니다. 렌더러는 네트워크 포트를 열지 않습니다. Electron은 Zod 스키마로 모든 IPC 페이로드를 검증합니다. 메인 프로세스가 단일 Python Worker를 실행하여 모델 관리, 오디오 처리, 로컬 저장, 파일 내보내기를 담당합니다. 데이터는 `~/Library/Application Support/Brevia`(macOS) 또는 `%APPDATA%/Brevia`(Windows)에 저장됩니다.

## 기술 스택

| 레이어 | 기술 |
| --- | --- |
| 데스크톱 쉘 | Electron 43 — preload 브릿지, 컨텍스트 격리, 샌드박스 렌더러 |
| 프론트엔드 | 네이티브 HTML/CSS/JS, Tailwind CSS, 내장 i18n (8개 언어) |
| 백엔드 | Python 3.10+, JSONL Worker 프로토콜, SQLite 스토리지 |
| 음성 엔진 | sherpa-onnx 1.13.2, ONNX Runtime, 27개 모델 (Zipformer / Paraformer / Whisper / SenseVoice / FireRedASR / FunASR) |
| 화자 처리 | sherpa-onnx Pyannote 분할 + 음성 임베딩 모델 |
| 빌드 및 패키징 | electron-builder, PyInstaller (Python 런타임 내장) |

## 소스에서 실행

```bash
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

첫 실행 시 마이크 및 화면 녹화 접근을 허용하세요. **Settings → Model Library**에서 언어에 맞는 모델을 다운로드한 후 녹음하세요.

개발 명령어:

```bash
npm test                    # UI + 백엔드 테스트
npm run build               # Tailwind CSS 빌드
npm run test:model          # ASR 모델 진단
npm run test:diarization    # 화자 분리 진단
```

개발용 데이터/모델 디렉토리 변경:

```bash
BREVIA_DATA_DIR=/path/to/data BREVIA_MODELS_DIR=/path/to/models npm start
```

## 인스톨러 빌드

```bash
npm ci
npm run build
python3 -m pip install -r backend/requirements-build.txt
npm run dist:mac   # macOS ARM64 DMG
npm run dist:win   # Windows x64 EXE
```

인스톨러는 `dist/`에 생성됩니다. 각 플랫폼 빌드에 네이티브 Python Worker가 포함됩니다. 모델은 포함되지 않으며 필요 시 다운로드됩니다.

## 자주 묻는 질문

<details>
<summary><strong>macOS에서 앱이 "손상됨" 또는 열 수 없다고 나옵니다</strong></summary>

코드 서명이 없기 때문입니다. 터미널에서 실행하세요:

```bash
xattr -dr com.apple.quarantine "/Applications/Brevia.app"
```

그런 다음 정상적으로 앱을 열 수 있습니다.
</details>

<details>
<summary><strong>Python을 별도로 설치해야 하나요?</strong></summary>

아니요. 릴리스 빌드에는 Python 런타임과 모든 의존성이 포함되어 있습니다. 소스에서 실행하는 경우에만 별도 Python이 필요합니다.
</details>

<details>
<summary><strong>데이터는 어디에 저장되나요?</strong></summary>

- macOS: `~/Library/Application Support/Brevia`
- Windows: `%APPDATA%/Brevia`

녹음, 전사, 화자 프로필이 모두 기기에 유지됩니다. `BREVIA_DATA_DIR`로 위치를 변경할 수 있습니다.
</details>

<details>
<summary><strong>어떤 언어의 전사를 지원하나요?</strong></summary>

중국어, 영어, 일본어, 한국어, 프랑스어, 독일어, 스페인어, 러시아어, 아랍어, 태국어, 베트남어, 인도네시아어 등 30개 이상의 언어를 지원합니다. 앱 내 모델 라이브러리에서 회의 언어에 맞는 모델을 선택하세요.
</details>

<details>
<summary><strong>Brevia가 음성을 클라우드로 전송하나요?</strong></summary>

아니요. 모든 음성 인식은 sherpa-onnx를 통해 로컬에서 실행됩니다. 선택적 요약/번역 기능은 명시적 동의와 API 공급자 설정이 필요하며, 텍스트만 전송하고 음성은 전송하지 않습니다.
</details>

<details>
<summary><strong>모델에 얼마나 디스크 공간이 필요한가요?</strong></summary>

선택한 모델에 따라 다릅니다. 일반적인 설정(스트리밍 + 정제 + 화자 분리)은 약 1–2 GB입니다. 소형 스트리밍 모델은 최소 ~80 MB, 대형 모델은 ~1 GB입니다.
</details>

<details>
<summary><strong>기존 녹음을 가져올 수 있나요?</strong></summary>

네. 회의 라이브러리에서 오디오 파일을 가져올 수 있습니다. Brevia가 동일한 음성 파이프라인으로 오프라인 전사를 수행합니다. PATH에 `ffmpeg`가 필요합니다(또는 `BREVIA_FFMPEG` 설정).
</details>

<details>
<summary><strong>UI 언어를 어떻게 변경하나요?</strong></summary>

**Settings → General**에서 원하는 언어를 선택하세요. 영어, 중국어 간체, 스페인어, 일본어, 한국어, 프랑스어, 독일어, 러시아어를 지원합니다.
</details>

## 기여하기

1. 집중된 브랜치를 만들고 변경을 작게 유지하세요.
2. `npm test`를 실행하세요. ASR이나 화자 분리를 수정할 때는 모델 진단도 실행하세요.
3. 모델 파일, 녹음, 내보내기, API 키, 로컬 데이터를 커밋하지 마세요.
4. UI 텍스트 변경 시 8개 언어를 동기화하세요.
5. PR에 모델, 플랫폼, 권한에 대한 영향을 기술하세요.

## 라이선스

Brevia는 [ISC License](../LICENSE)로 배포됩니다. 모델 파일과 서드파티 패키지는 각자의 라이선스와 조건을 따릅니다.

## 감사의 말

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — 로컬 ASR, VAD, 문장부호, 화자 처리의 핵심 런타임. [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) 라이선스.
- `backend/models.json`에 선언된 모델 저자 및 관리자분들께 감사드립니다.
- Electron, ONNX Runtime, Python, 오픈소스 음성 커뮤니티가 이 로컬 우선 워크플로를 가능하게 합니다.
