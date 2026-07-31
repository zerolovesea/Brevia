<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>プライベートでローカルファーストな会議の記憶。</strong><br />会話を録音し、リアルタイムで追い、根拠をたどれる文字起こしを残します。</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <strong>日本語</strong> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

## Product tour

| | |
| --- | --- |
| ![Product tour](assets/tour/en/library.png) | ![Product tour](assets/tour/en/prepare.png) |
| ![Product tour](assets/tour/en/models.png) | ![Product tour](assets/tour/en/settings.png) |

![Product tour](assets/tour/en/notes.png)

## 機能

- マイクとシステム音声を録音し、会議中にライブ字幕を表示します。
- **sherpa-onnx** により、ストリーミング ASR、句読点、会後の精修、VAD、話者分離を端末内で実行します。
- 言語別モデルのダウンロード、最大 200 個のローカル用語、話者の識別・名前変更に対応します。
- 音声を取り込み、文字起こし／ノートを Markdown、TXT、JSON、SRT、DOCX、PDF に、音声を FLAC、WAV、M4A に書き出せます。
- 翻訳と構造化要約は任意で、明示的な同意とプロバイダー設定後にだけ利用されます。

## アーキテクチャと技術スタック

`Electron UI ↔ Zod で検証した IPC ↔ Python JSONL Worker → sherpa-onnx / ローカル SQLite・音声・エクスポート`。バックエンドの待受ポートはありません。Electron 43、素の HTML/CSS/JS、Python 3、SQLite、ONNX Runtime、`sherpa-onnx==1.13.2` を利用し、話者処理は sherpa-onnx の Pyannote セグメンテーションと声紋埋め込みモデルを使います。

## 要件と起動

- Node.js 20+、npm、Python 3.10+（診断例は Python 3.12）。
- 現在のライブ収録は macOS 向けで、マイクと画面収録の許可が必要です。音声インポートには不要です。
- 選ぶモデル分の空き容量が必要です。既定の中国語ストリーミングモデルは約 570 MiB、一部の音声出力には `ffmpeg` が必要です。

```bash
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

初回起動後、**Settings → Model library** で必要なモデルを取得します。開発時は `BREVIA_DATA_DIR` と `BREVIA_MODELS_DIR` で保存先を変え、`npm test` を実行してください。

## デプロイ

現状は未パッケージの Electron アプリです。配布時は `npm ci && npm run build` を実行し、`backend/`、`frontend/`、Python 実行環境と依存関係を同梱します。`.venv/bin/python` または `BREVIA_PYTHON` を使い、モデルは必要に応じて取得して各上流ライセンスを維持してください。

## Contributing

変更は小さく保ち、`npm test` と音声関連の診断を実行してください。モデル、録音、エクスポート、鍵、ローカルデータはコミットしません。8 言語の文言を揃え、モデル・権限・プラットフォームへの影響を PR に記載します。

## License

Brevia は [ISC License](../LICENSE) で提供され、モデルと依存関係には各自の条件が適用されます。

## Acknowledgments

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) はローカル ASR、VAD、句読点、話者処理の中核ランタイムであり、[Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) で提供されています。作者、Electron、ONNX Runtime、Python、オープンソース音声コミュニティに感謝します。
