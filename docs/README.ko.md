<h1 align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></h1>

<p align="center"><strong>대화에 집중하고, 중요한 내용을 남기세요.</strong><br />로컬 처리를 우선하는 AI 회의 도우미. 녹음, 전사, 번역부터 원본 음성을 확인할 수 있는 노트와 실행 항목까지 한곳에서 관리합니다.</p>

<p align="center"><a href="README.en.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

![Brevia](assets/showcase/desktop/en/live.gif)

## 다운로드

| 플랫폼  | 다운로드                                                                                             | 요구 사항                    |
| ------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Mac     | [macOS][download-mac]                                                                                | Apple Silicon · macOS 14+    |
| Windows | [Windows][download-windows]                                                                          | Windows 10 / 11 · x64 · AVX2 |
| iPhone  | [App Store](https://apps.apple.com/app/id6819869442)                                                 | iOS 15+                      |
| Android | [APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) | Android 7+                   |

[download-mac]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.1/Brevia-WebKit-2.0.1-arm64.dmg
[download-windows]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.1/Brevia-2.0.1-x64-setup.exe

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases) · [brevia.work](https://brevia.work)

설치 파일은 Mac용 약 43 MiB(45.5 MB), Windows용 약 38 MB입니다. 언어 모델은 별도로 다운로드합니다.

## 주요 기능

- 마이크와 시스템 소리를 함께 녹음하고 실시간 전사, 번역, 플로팅 자막과 녹음 컨트롤을 사용하세요.
- 자막은 먼저 표시하고 화자는 백그라운드에서 식별합니다. 회의 후 전사를 다듬고 이름을 수정하며 음성 프로필을 저장할 수 있습니다.
- 빠른 전사: M4 Pro에서 **66분 40초** 분량의 녹음을 모두 전사하는 데 **3분 33초**가 걸렸습니다.
- 직접 메모하며 AI로 결정 사항과 할 일을 정리하세요. 노트에서 원래 발언과 녹음으로 돌아갈 수 있습니다.
- 작업 공간과 검색으로 회의를 관리하고 Markdown, TXT, JSON, SRT, DOCX, PDF, WAV로 내보내세요.
- 기존 음성·영상 파일을 가져와 전사, 번역, 화자 분석을 실행하거나 로컬 Agent에 맡기세요.

![AI가 회의 노트에 추가할 할 일을 제안하는 화면](assets/showcase/desktop/en/ai-notes.png)

### 회의 캡슐

메인 창을 최소화한 뒤에도 화면에 떠 있는 캡슐에서 녹음을 일시 정지하거나 종료할 수 있습니다. 캡슐을 펼치면 실시간 이중 언어 자막과 회의 노트를 확인할 수 있습니다.

<img src="assets/showcase/desktop/en/capsule.png" width="352" alt="자막과 녹음 버튼이 보이는 회의 캡슐" />

[![회의록과 생선뼈 다이어그램에서 원래 발언 확인](assets/showcase/desktop/en/summary.png)](assets/showcase/desktop/en/summary.gif)

회의록과 생선뼈 다이어그램에서 원래 발언 확인.

## 시작하기

1. 데스크톱 앱을 설치하고 **설정 → 모델 라이브러리**에서 전사 모델을 다운로드하세요.
2. 마이크, 시스템 소리 또는 연결된 휴대폰을 선택해 회의를 시작하세요. 파일을 가져와도 됩니다.
3. 회의 중 메모를 남기고 종료 후 전사와 회의록을 편집하거나 내보내세요.

macOS 14.4 이상에서는 화면 녹화 권한 없이 시스템 오디오 녹음 권한만 요청합니다. macOS 14.0–14.3에서는 화면 및 시스템 오디오 권한을 사용합니다. 접근을 거부했다면 시스템 설정에서 다시 허용하세요.

추론 엔진은 앱에 포함됩니다. Python이나 별도 추론 실행 환경은 필요하지 않습니다. Windows에 WebView2가 없는 경우에만 설치 프로그램이 다운로드합니다. 원하는 모델을 다운로드하면 오프라인에서 사용할 수 있습니다. FunASR, Qwen3-ASR, Parakeet, Whisper, Qwen, Hy-MT 등을 지원하며 사용 가능한 모델은 플랫폼에 따라 다릅니다.

## 휴대폰으로 녹음

오프라인에서 녹음하고 메모와 중요 시점을 남기세요. 컴퓨터가 녹음 수신을 확인하면 휴대폰 앱을 떠나도 가져오기와 전사는 컴퓨터에서 계속됩니다. 휴대폰의 복사본도 유지됩니다. 휴대폰을 컴퓨터 마이크로 쓰거나 실시간 자막을 볼 수도 있습니다. 같은 로컬 네트워크에서 **설정 → 기기 연결**로 페어링하세요. 실시간 모드에는 실행 중인 컴퓨터가 필요합니다.

![휴대폰과 컴퓨터에 표시된 실시간 자막](assets/showcase/desktop/en/phone.png)

## 로컬 Agent 연결

**설정 → Agent 및 MCP**에서 안내문을 복사해 로컬 Agent에 전달하세요. 포함된 Skill을 읽고 CLI로 Brevia를 사용합니다. MCP 클라이언트는 같은 화면에서 MCP 설정을 복사하면 됩니다.

> 바탕 화면의 인터뷰 녹음을 전사해 SRT 파일로 저장해 줘.
>
> 지난주 출시 계획 회의를 찾아 미해결 질문을 정리해 줘.
>
> 연결된 휴대폰으로 이 회의 녹음을 시작해 줘.

전사, 번역, 화자 분석, 음성 프로필 매칭, 회의 검색과 녹음 제어를 지원합니다. 긴 작업은 진행 상황 확인과 취소가 가능하며 기존 파일은 덮어쓰지 않습니다. 필요하면 앱이 백그라운드에서 시작됩니다.

[CLI / MCP](../DEVELOPMENT.md#本机-agent-接口) · [Brevia Skill](../skills/brevia/SKILL.md)

![Agent가 스페인어 및 영어 SRT 자막을 저장하는 화면](assets/showcase/desktop/en/agent.png)

## CLI 매개변수

명령 형식은 `brevia 메서드 [JSON] [--no-start]`입니다. CLI 경로는 **설정 → Agent & MCP**에서 확인합니다. `brevia help`는 메서드 목록을 표시하고, `brevia status --no-start`는 앱을 실행하지 않고 상태를 확인합니다.

`inference.run`의 `operation`에 `transcribe` 또는 `translate`를 지정합니다. `input_path`와 `output_path`에는 절대 경로를 사용합니다. 원문 언어 `language`의 기본값은 `auto`이며, 번역에는 `target_language`가 필요합니다.

```sh
brevia inference.run '{"operation":"transcribe","input_path":"/Users/me/interview.wav","language":"es","output_path":"/Users/me/interview.srt"}'
brevia task.get '{"task_id":"123e4567-e89b-42d3-a456-426614174000"}'
```

예시 경로를 실제 경로로 바꾼 뒤, 반환된 `task_id`를 `task.get`에 전달합니다. 상태가 `completed`이면 출력 파일을 엽니다. [전체 명령과 매개변수](../DEVELOPMENT.md#本机-agent-接口)

## 내 데이터

계정이 필요 없습니다. 녹음, 회의와 모델은 내 기기에 저장되며 휴대폰은 로컬 HTTPS로 동기화합니다. 로컬 AI는 오프라인에서 작동합니다. 온라인 AI를 선택하면 관련 텍스트가 선택한 서비스에 전송됩니다. [Privacy](https://brevia.work/privacy.html).

## 기술 스택

데스크톱은 시스템 WebView(macOS의 WebKit, Windows의 WebView2), 공통 회의 로직과 네이티브 엔진을 사용합니다. 모바일 앱은 Flutter로 구현됩니다. 데스크톱 앱은 Tauri와 Rust로 개발했으며 회의 데이터는 SQLite에 저장합니다. 음성 처리는 sherpa-onnx, 회의록 생성은 llama.cpp가 담당합니다.

## 프로젝트 참여

[Issues](https://github.com/zerolovesea/Brevia/issues) · [Development](../DEVELOPMENT.md) · [Docs](README.md)

ISC 라이선스입니다. 모델과 외부 구성 요소에는 각각의 라이선스가 적용됩니다. Tauri, MLX, sherpa-onnx, llama.cpp, miniaudio와 모델 개발자에게 감사드립니다. [ISC](../LICENSE).
