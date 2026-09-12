<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>미니멀하고 로컬 우선인 AI 회의 어시스턴트.</strong><br />AI 메모 · 실시간 전사 · 다국어 · 화자 식별 · 검토 가능한 요약 — 오디오가 기기를 벗어나지 않습니다.</p>

<p align="center">
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/v/release/zerolovesea/Brevia?style=flat-square" alt="Release" /></a>
  <a href="https://github.com/zerolovesea/Brevia/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zerolovesea/Brevia?style=flat-square" alt="License" /></a>
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/downloads/zerolovesea/Brevia/total?style=flat-square" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-43-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

---

## 소개

Brevia 는 회의에서 가장 시간이 많이 걸리는 부분——기록, 정리, 복기——을 기기 위의 AI 에 맡기는 데스크톱 AI 회의 어시스턴트입니다. 마이크와 시스템 오디오를 동시에 녹음하고, 실시간 자막을 스트리밍하며, 끝난 대화를 구조화된 메모로 정리합니다. 모든 음성 인식은 로컬에서 동작하며, 녹음·전사·화자 프로필은 기본적으로 사용자 기기에 남습니다.

디자인은 의도적으로 조용합니다: 회의를 방해하지 않는 인터페이스, **캡처 → 이해 → 검색** 이라는 하나의 흐름을 따르는 기능 세트, 그리고 로컬에서 할 수 있는 일은 로컬에서 한다는 확고한 원칙.

<p align="center"><img src="assets/demo/ai-assist-en.gif" width="820" alt="Brevia AI Assist Notes 데모" /></p>

## 기능

### 검토하며 쓰는 AI 메모

AI 메모는 실시간 전사를 따라가며 결정, 실행 항목, 핵심 수치, 위험, 질문, 주제 전환을 제안합니다. 필요할 때만 요청하거나, 가벼운 안내 또는 자동 정리를 선택할 수 있습니다. 모든 제안은 검토 후 사용합니다. 유용한 항목만 노트에 넣고 서식 있는 텍스트 또는 Markdown으로 이어서 작성하세요.

AI 메모와 AI 회의 요약은 공급자, 모델, API Key를 각각 설정할 수 있습니다. 원격 공급자를 쓸 때도 전사 텍스트와 현재 노트 맥락만 전송되며 오디오는 기기를 벗어나지 않습니다. 로컬 모델은 필요할 때만 로드되므로 설정을 나누어도 두 모델이 동시에 메모리에 상주하지 않습니다.

![AI Assist Notes](assets/tour/en/AI%20Assist%20Notes.png)

### 인식 모델 선택

첫 실행 설정은 내려받을 수 있는 음성 모델을 나열하고 **인터페이스 언어**에 맞는 권장 모델을 미리 선택합니다(Silero VAD, 화자 분리, 성문 모델은 앱에 포함되어 항상 설치되어 있습니다). 나머지는 내려받기 전에 해제할 수 있습니다.

이후에는 회의마다 **회의 언어**를 기준으로 기본 인식 모델을 고릅니다. 대응 관계는 `backend/models.json`에 선언되어 있습니다.

| 회의 언어 | 기본 인식 모델 | 이유 |
| --- | --- | --- |
| 중국어, 광둥어 | FunASR Nano int8 | 중국어와 그 방언에서 정확도가 가장 높음 |
| 일본어, 한국어 | Qwen3-ASR 0.6B int8 | 선택 가능한 모델 중 일·한을 모두 지원하는 유일한 모델 |
| 영어, 스페인어, 프랑스어, 독일어, 러시아어, 혼합 언어 | Parakeet TDT 0.6B v3 | 유럽 25개 언어를 한 모델로 지원하고 문장 부호와 타임스탬프도 생성 |
| 그 밖의 언어 | Qwen3-ASR 0.6B int8 | 나머지 모델 중 언어 범위가 가장 넓음 |

선언된 기본 모델이 아직 없으면 다른 모델을 내려받게 하는 대신 **이미 설치되어 있고 그 언어를 지원하는** 모델을 사용합니다. 준비 화면에는 '인식 모델' 선택기가 있고(미설치 모델도 용량과 함께 표시), 회의 중에도 같은 선택기로 `meeting.reconfigure`를 통해 모델을 바꿀 수 있습니다. **설정 → 고급 → 실시간 인식**의 `live_asr.max_speech_seconds`는 자막 세그먼트가 늘어날 수 있는 상한을 지정합니다. 실제 적용값은 이 설정, 언어별 VAD 설정, 모델 자체 용량 중 가장 작은 값입니다.

성능이 낮은 기기에서는 2B 로컬 AI 메모 모델이나 온라인 공급자를 권장합니다.

### 조용한 회의 화면에서의 실시간 전사와 번역

앱을 열고 녹음 버튼을 누르면 자막이 나타납니다. Brevia 는 마이크와 시스템 오디오를 동시에 캡처하므로, 원격 통화의 양쪽이 같은 전사에 담깁니다. 선택적인 실시간 번역이 자막 흐름 옆에 나란히 표시되어 다국어 대화를 지원합니다.

![실시간 회의와 번역](assets/tour/en/%E5%AE%9E%E6%97%B6%E4%BC%9A%E8%AE%AE%E5%92%8C%E7%BF%BB%E8%AF%91.png)

### 30 개 이상의 전사 언어와 회의 요약

Brevia 는 30 개 이상의 언어로 음성을 전사합니다 — 영어, 중국어, 일본어, 한국어, 프랑스어, 독일어, 스페인어, 러시아어, 아랍어, 태국어, 베트남어, 인도네시아어 등. 회의가 끝나면 원하는 LLM 공급자를 연결해 검토한 전사를 바탕으로 회의 요약, 주요 결정 사항, 실행 항목을 작성합니다.

내장 AI는 번들 모델을 이 기기에서 실행합니다. Claude, OpenAI, OpenRouter 또는 OpenAI / Anthropic 채팅 형식을 지원하는 서비스도 연결할 수 있습니다. 오디오가 아닌 텍스트만 전송됩니다.

### 성문 등록과 회의 간 화자 식별

팀 구성원별로 짧은 음성 샘플을 등록하면 Brevia 가 이후 모든 회의에서 이름으로 인식합니다 — "화자 1, 화자 2" 가 아닌 실제 사람으로. 녹음 간 인식이 작동하므로 지난주 회의에서 "지수가 뭐라고 했지?" 를 찾는 것은 한 번의 클릭입니다.

Pyannote 분할 + 화자 임베딩 모델을 사용하며 모두 기기에서 실행됩니다.

![성문 등록](assets/tour/en/%E6%B3%A8%E5%86%8C%E5%A3%B0%E7%BA%B9%E8%AF%86%E5%88%AB.png)

### 정선된 로컬 모델 라이브러리

문장 인식, 회의 후 정제, 음성 활동 감지, 화자 분리, 성문, AI 메모와 회의록, 자막 번역을 아우르는 다운로드 가능한 모델. 언어와 정밀도에 따라 자유롭게 조합 — 모두 기기에서 실행됩니다.

![모델 라이브러리](assets/tour/en/%E6%A8%A1%E5%9E%8B%E5%BA%93.png)

### 그 외

- **오디오 가져오기** — 기존 녹음을 같은 음성 파이프라인으로 오프라인 전사.
- **다양한 내보내기** — 전사와 메모를 Markdown, TXT, JSON, SRT, DOCX, PDF 로; 오디오를 FLAC, WAV, M4A 로.
- **검토 가능한 메모** — 서식 있는 텍스트 또는 Markdown으로 작성하고 유용한 AI 제안만 반영.
- **회의 라이브러리와 워크스페이스** — 제목, 전사, 화자, 태그를 검색하고 워크스페이스로 정리하며 최근 삭제한 회의는 30일 동안 복원할 수 있습니다.
- **집중형 보기** — 라이트/다크 테마, 전사·요약 인라인 편집, 선택형 플로팅 자막 창으로 회의 화면을 깔끔하게 유지합니다.
- **다국어 UI** — 영어, 중국어 간체, 스페인어, 일본어, 한국어, 프랑스어, 독일어, 러시아어.

## 설치

최신 버전을 [GitHub Releases](https://github.com/zerolovesea/Brevia/releases) 에서 다운로드하세요:

| 플랫폼 | 설치 파일 |
| --- | --- |
| macOS (Apple Silicon) | `Brevia-<version>-arm64.dmg` |
| Windows (x64) | `Brevia-<version>-x64-setup.exe` |
> Windows 에서는 첫 실행 시 **Microsoft Defender SmartScreen** 경고가 나타날 수 있습니다. 다운로드 출처가 공식 Releases 페이지인지 확인한 후 **"추가 정보" → "실행"** 을 클릭하세요.

첫 실행 시 마이크와 화면 녹화 권한을 부여한 후, **설정 → 모델 라이브러리** 에서 필요한 모델을 다운로드하세요.

## 아키텍처

```mermaid
flowchart LR
  A[Electron 렌더러<br/>HTML · Tailwind · JS] <-->|IPC + Zod 검증| B[Electron 메인 프로세스]
  B <-->|JSONL stdin/stdout| C[Python 워커<br/>번들 런타임]
  C --> D[sherpa-onnx<br/>ASR · VAD · 화자 · 구두점]
  C --> E[로컬 스토리지<br/>SQLite · 오디오 · 내보내기]
  C -. 명시적 동의 .-> F[선택적 클라우드 API<br/>LLM 요약 · 번역]
```

Brevia 는 엄격한 로컬 우선 설계를 따릅니다:

- **렌더러는 네트워크 포트를 열지 않으며**, 모든 IPC 메시지는 Electron 메인 프로세스가 Zod 스키마로 검증합니다.
- **메인 프로세스는 얇은 쉘입니다.** JSONL stdin/stdout 을 통해 단일 Python 워커를 실행하며, 워커가 모델 관리, 오디오 처리, 화자 프로필, 로컬 스토리지, 내보내기를 모두 담당합니다.
- **데이터는 기본적으로 `~/brevia`** 에 저장됩니다 — SQLite, 원본 오디오, 내보내기, 캐시된 모델, 성문 프로필.
- **클라우드 호출은 옵트인**입니다. LLM 요약과 번역은 사용자가 명시적으로 공급자를 구성해야만 활성화되며, 텍스트만 전송됩니다.

녹음은 **Silero VAD 분할 → 한 번의 오프라인 인식 → 완성된 자막** 흐름으로 동작합니다. 말이 멈출 때마다(중국어 0.7초, 그 밖의 언어 0.8초) 문장이 확정되고, 연속 발화는 30 / 20초에서 잘립니다(`vad`에서 조정). VAD 한 구간에 여러 문장이 들어갈 수 있으며, 인접한 문장은 하나의 문단으로 묶습니다(중국어 약 110자·최대 150자, 라틴 문자 약 280자·최대 380자). VAD 끝점은 문단 경계가 **아닙니다** — 실제로 긴 무음(1.2초 이상)만 새 문단을 시작하고, 목표에 못 미치는 문단은 최대 8초 뒤 확정됩니다. 잘린 지점에서는 다음 디코딩이 400밀리초를 되돌아가 이음새의 중복을 제거합니다. 정지하면 마지막 문장까지 처리하며, 인식이 실패해도 원본 오디오는 유지됩니다.

[벤치마크 방법과 결과](../backend/benchmarks/vad-2026-09-05/REPORT.md)를 참고하세요.

## 기술 스택

| 계층 | 기술 |
| --- | --- |
| 데스크톱 쉘 | Electron 43 — preload 브리지, 컨텍스트 격리, 샌드박스 렌더러 |
| 프론트엔드 | 순수 HTML/CSS/JS, Tailwind CSS 4, 내장 i18n (8 로케일) |
| 백엔드 | Python 3.10+, JSONL 워커 프로토콜, SQLite 스토리지 |
| 음성 엔진 | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 1.13.2, ONNX Runtime |
| 화자 처리 | Pyannote 분할 + 3D-Speaker ERes2Net Base 임베딩 |
| LLM 클라이언트 | 내장 llama.cpp(GGUF) + OpenAI / Anthropic 호환 채팅 API |
| 오디오 I/O | ffmpeg (릴리스에 포함) |
| 빌드 및 패키징 | electron-builder, PyInstaller (Python 런타임 포함) |
## 지원 모델

모든 모델은 **설정 → 모델 라이브러리** 에서 요청 시 다운로드됩니다. 매니페스트는 [`backend/models.json`](../backend/models.json) 에 있습니다.

| 종류 | 대표 모델 | 언어 |
| --- | --- | --- |
| 문장 인식 / 회의 후 정제 | FunASR Nano int8, Qwen3-ASR 0.6B, Parakeet TDT 0.6B v3 | 중국어 / 다국어 / 유럽 25개 언어 |
| 음성 활동 감지 | Silero VAD | 범용 |
| 화자 분리 | Pyannote Segmentation 3.0 | 범용 |
| 화자 임베딩 | 3D-Speaker ERes2Net Base | 중국어 |
| AI 메모 및 회의록 | Qwen 3.5 2B, Qwen 3.5 4B | 중국어 / 영어 |
| 자막 번역 | Tencent Hy-MT2 1.8B | 33개 언어 |

LLM 요약에서는 **내장 AI**를 선택해 번들 GGUF 모델(Qwen 3.5 2B / 4B)을 로컬에서 실행할 수 있고, Claude, OpenAI, OpenRouter 또는 OpenAI Chat Completions / Anthropic Messages를 지원하는 자체 서비스(Gemini의 OpenAI 호환 엔드포인트, DeepSeek, Kimi, Qwen 등)를 연결할 수도 있습니다.

## 로컬 개발

전제 조건: Node.js 18+, Python 3.10+, Git, ffmpeg (오디오 가져오기용).

```bash
git clone https://github.com/zerolovesea/Brevia.git
cd Brevia
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

첫 실행 시 마이크와 화면 녹화 권한을 부여한 후, **설정 → 모델 라이브러리** 에서 필요한 모델을 다운로드하세요.

### 자주 쓰는 스크립트

```bash
npm test                    # 데드 코드 게이트 + Electron 동작 + UI + E2E 스모크 + 백엔드 테스트
npm run test:e2e            # 실제 앱을 실행하고 CDP 로 검증
npm run build               # Tailwind CSS 빌드
npm run test:model          # ASR 모델 진단
npm run test:diarization    # 화자 다이어라이제이션 진단
npm run start:fresh         # 온보딩 초기화 후 시작
```

### 환경 변수

```bash
BREVIA_DATA_DIR=/path/to/data       # 사용자 지정 데이터 디렉터리 (녹음, 내보내기, SQLite)
BREVIA_MODELS_DIR=/path/to/models   # 사용자 지정 모델 디렉터리
BREVIA_FFMPEG=/path/to/ffmpeg       # ffmpeg 바이너리 (PATH 에 없을 때)

BREVIA_DATA_DIR=~/brevia-dev BREVIA_MODELS_DIR=~/brevia-models npm start
```
### 설치 파일 빌드

```bash
npm ci
npm run build
python3 -m pip install -r backend/requirements-build.txt
npm run dist:mac   # macOS ARM64 DMG
npm run dist:win   # Windows x64 EXE
```

산출물은 `dist/` 에 생성됩니다. 각 플랫폼 빌드는 네이티브 Python 워커를 포함하지만 모델은 포함하지 않으며 요청 시 다운로드됩니다.

## FAQ

<details>
<summary><strong>Windows 에서 Microsoft Defender SmartScreen 경고가 표시됩니다</strong></summary>

릴리스 빌드는 유료 코드 서명 인증서로 서명되어 있지 않아 SmartScreen 이 새로 보이는 실행 파일을 기본적으로 차단합니다. 다운로드 출처가 공식 [Releases](https://github.com/zerolovesea/Brevia/releases) 페이지인지 확인한 후 **"추가 정보" → "실행"** 을 클릭하세요.
</details>

<details>
<summary><strong>Python 을 별도로 설치해야 하나요?</strong></summary>

아니요. 릴리스 빌드는 Python 런타임과 모든 필요 의존성을 포함합니다. 소스에서 실행할 때만 별도 Python 환경이 필요합니다.
</details>

<details>
<summary><strong>데이터는 어디에 저장되나요?</strong></summary>

기본적으로 `~/brevia` — 녹음, 전사, 내보내기, 캐시된 모델, 성문 프로필, SQLite 데이터베이스. `BREVIA_DATA_DIR` 을 설정해 변경할 수 있습니다.
</details>

<details>
<summary><strong>어떤 언어의 전사를 지원하나요?</strong></summary>

중국어, 영어, 일본어, 한국어, 프랑스어, 독일어, 스페인어, 러시아어, 아랍어, 태국어, 베트남어, 인도네시아어 등 30 개 이상의 언어. 앱 내 모델 라이브러리에서 해당 모델을 선택하세요.
</details>
<details>
<summary><strong>Brevia 가 오디오를 클라우드로 보내나요?</strong></summary>

아니요. 음성 인식과 다이어라이제이션은 모두 로컬에서 실행됩니다. LLM 요약과 번역만 네트워크와 통신하며, 공급자를 구성한 이후에만 — 텍스트만, 오디오는 절대 보내지 않습니다.
</details>

<details>
<summary><strong>모델은 얼마나 많은 디스크 공간을 필요로 하나요?</strong></summary>

설치하는 모델에 따라 다릅니다. 일반적인 구성 (문장 인식 + 정제 + 화자 분리) 은 1–2 GB. 가장 작은 인식 모델은 약 487 MB, 대형 모델은 1 GB 이상.
</details>

<details>
<summary><strong>기존 녹음을 가져올 수 있나요?</strong></summary>

가능합니다. 회의 라이브러리에서 오디오 파일을 가져오면 Brevia 가 동일한 음성 파이프라인으로 오프라인 전사합니다. PATH 에 `ffmpeg` 이 필요합니다 (또는 `BREVIA_FFMPEG` 설정).
</details>

<details>
<summary><strong>UI 언어는 어떻게 바꾸나요?</strong></summary>

**설정 → 일반 → 인터페이스 언어**. 영어, 중국어 간체, 스페인어, 일본어, 한국어, 프랑스어, 독일어, 러시아어를 지원합니다.
</details>

<details>
<summary><strong>성문 샘플은 어떻게 저장되나요?</strong></summary>

성문 임베딩 (작은 부동소수 벡터) 과 참조 오디오는 로컬 SQLite 데이터베이스와 파일 시스템에 저장됩니다. 기기를 벗어나지 않으며, 프로필을 삭제하면 관련 데이터도 함께 제거됩니다.
</details>

## 피드백과 기여

### 이슈 제보

버그나 기능 요청은 [GitHub Issues](https://github.com/zerolovesea/Brevia/issues) 에 제보해 주세요. 다음 정보를 포함하면 트리아지가 빨라집니다:

- 운영 체제와 버전 (예: macOS 14.5 / Windows 11 23H2)
- Brevia 버전 (**설정 → 정보**)
- 사용 중인 모델과 언어
- 재현 단계 / 예상 결과 / 실제 결과
- 관련 로그 (**설정 → 고급 → 로그 폴더 열기**) — 첨부 전에 민감한 내용이 있는지 확인해 주세요

**보안 이슈:** 공개 이슈로 열지 말고 이메일로 메인테이너에게 연락해 주세요.

### 기여

풀 리퀘스트를 환영합니다. 트리를 깔끔하게 유지하기 위해:

1. `main` 에서 좁게 초점을 맞춘 브랜치를 분기하세요 — PR 하나당 하나의 관심사.
2. 제출 전 `npm test` 를 실행; ASR 이나 다이어라이제이션을 다룰 때는 `npm run test:model` 과 `npm run test:diarization` 도 실행.
3. 다운로드한 모델, 녹음, 내보내기, API 키, `~/brevia` 의 어떤 내용도 커밋하지 마세요.
4. 사용자 대상 텍스트를 변경할 때는 `frontend/i18n-data.js` 의 여덟 로케일을 모두 업데이트하세요 — 영어 원문과 그 번역을 함께 추가.
5. 모델, 플랫폼, 권한에 대한 영향을 PR 설명에 명시하세요.

## 라이선스

Brevia 는 [ISC License](../LICENSE) 하에 배포됩니다. 모델 파일과 서드파티 패키지는 각자의 라이선스와 조건을 유지합니다.

## 감사의 말

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — ASR, VAD, 구두점, 화자 처리를 지원하는 로컬 런타임. [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) 라이선스로 배포.
- [`backend/models.json`](../backend/models.json) 에 선언된 다운로드 가능한 산출물의 모델 작성자와 메인테이너 여러분께 감사드립니다 — Qwen3-ASR, FunASR, Parakeet (NeMo), Pyannote, 3D-Speaker, Silero, Tencent Hy-MT2 등.
- Electron, ONNX Runtime, Python, 그리고 오픈 소스 음성 커뮤니티 덕분에 이 로컬 우선 워크플로가 가능해졌습니다.
