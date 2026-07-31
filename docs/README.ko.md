<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>비공개 로컬 우선 회의 메모리.</strong><br />대화를 녹음하고 실시간으로 따라가며 추적 가능한 회의록을 남깁니다.</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

## Product tour

| | |
| --- | --- |
| ![Product tour](assets/tour/en/library.png) | ![Product tour](assets/tour/en/prepare.png) |
| ![Product tour](assets/tour/en/models.png) | ![Product tour](assets/tour/en/settings.png) |

![Product tour](assets/tour/en/notes.png)

## 기능

- 마이크와 시스템 오디오를 녹음하고 회의 중 실시간 자막을 표시합니다.
- **sherpa-onnx**로 스트리밍 ASR, 문장부호, 사후 정제, VAD, 화자 분리를 기기에서 처리합니다.
- 언어별 모델 다운로드, 최대 200개의 로컬 용어, 화자 식별 및 이름 변경을 지원합니다.
- 오디오를 가져오고 회의록/메모를 Markdown, TXT, JSON, SRT, DOCX, PDF로, 오디오를 FLAC, WAV, M4A로 내보냅니다.
- 번역과 구조화 요약은 선택 사항이며 명시적 동의와 공급자 설정 후에만 사용합니다.

## 아키텍처와 기술 스택

`Electron UI ↔ Zod 검증 IPC ↔ Python JSONL Worker → sherpa-onnx / 로컬 SQLite·오디오·내보내기` 구조이며 백엔드 포트는 열지 않습니다. Electron 43, 순수 HTML/CSS/JS, Python 3, SQLite, ONNX Runtime, `sherpa-onnx==1.13.2`를 사용합니다. 화자 처리는 sherpa-onnx Pyannote 분할과 음성 임베딩 모델을 사용합니다.

## 요구 사항과 실행

- Node.js 20+, npm, Python 3.10+ (진단 예시는 Python 3.12).
- 현재 라이브 캡처는 macOS용이며 마이크 및 화면 녹화 권한이 필요합니다. 오디오 가져오기에는 필요하지 않습니다.
- 선택 모델을 위한 저장 공간이 필요합니다. 기본 중국어 스트리밍 모델은 약 570 MiB이며 일부 오디오 내보내기에는 `ffmpeg`가 필요합니다.

```bash
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

첫 실행 후 **Settings → Model library**에서 모델을 다운로드합니다. 개발 저장 위치는 `BREVIA_DATA_DIR`, `BREVIA_MODELS_DIR`로 바꾸고 `npm test`로 검증합니다.

## 배포

현재는 패키징되지 않은 Electron 앱입니다. 배포 시 `npm ci && npm run build`를 실행하고 `backend/`, `frontend/`, Python 런타임과 의존성을 포함하세요. `.venv/bin/python` 또는 `BREVIA_PYTHON`을 사용하고 모델은 필요할 때 내려받으며 상위 라이선스를 유지합니다.

## Contributing

작고 집중된 변경을 만들고 `npm test`와 음성 진단을 실행하세요. 모델, 녹음, 내보내기, 키, 로컬 데이터를 커밋하지 마세요. 8개 언어 문구를 함께 유지하고 PR에 모델·권한·플랫폼 영향을 적어 주세요.

## License

Brevia는 [ISC License](../LICENSE)로 배포되며 모델과 의존성은 각자의 조건을 따릅니다.

## Acknowledgments

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)는 로컬 ASR, VAD, 문장부호, 화자 처리의 핵심 런타임이며 [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) 라이선스입니다. 저자들과 Electron, ONNX Runtime, Python, 오픈소스 음성 커뮤니티에 감사드립니다.
