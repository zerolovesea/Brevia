<h1 align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></h1>

<p align="center"><strong>会話に集中し、大切なことを残す。</strong><br />ローカル処理を中心とした AI 会議アシスタント。録音・文字起こし・翻訳から、元の音声を確認できるノートやアクション項目まで。</p>

<p align="center"><a href="README.en.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <strong>日本語</strong> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

![Brevia](assets/showcase/desktop/en/live.gif)

## ダウンロード

| プラットフォーム | ダウンロード                                                                                         | 動作環境                     |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Mac              | [macOS][download-mac]                                                                                | Apple Silicon · macOS 14+    |
| Windows          | [Windows][download-windows]                                                                          | Windows 10 / 11 · x64 · AVX2 |
| iPhone           | [App Store](https://apps.apple.com/app/id6819869442)                                                 | iOS 15+                      |
| Android          | [APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) | Android 7+                   |

[download-mac]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.1/Brevia-WebKit-2.0.1-arm64.dmg
[download-windows]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.1/Brevia-2.0.1-x64-setup.exe

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases) · [brevia.work](https://brevia.work)

インストーラーは Mac 版が約 43 MiB（45.5 MB）、Windows 版が約 38 MB です。言語モデルは別途ダウンロードします。

## できること

- マイクとシステム音声を同時に録音。リアルタイム文字起こし、翻訳、フローティング字幕、録音操作に対応。
- 字幕を先に表示し、話者をバックグラウンドで識別。会議後に精度を整え、名前を修正し、声紋を保存。
- 高速文字起こし：M4 Pro で **66 分 40 秒**の録音を全文文字起こしするのに **3 分 33 秒**かかりました。
- メモを書きながら、AI で決定事項やタスクを整理。ノートから元の発言と音声へ戻れます。
- ワークスペースで会議を整理し、全文検索。Markdown、TXT、JSON、SRT、DOCX、PDF、WAV に書き出し。
- 既存の音声・動画を取り込み、文字起こし・翻訳・話者分析。ローカル Agent からの利用も可能。

![AI が会議メモに追加するタスクを提案](assets/showcase/desktop/en/ai-notes.png)

### 会議カプセル

メインウィンドウを最小化しても、フローティングカプセルから録音を一時停止・終了できます。カプセルを開くと、リアルタイムの二言語字幕や会議メモを確認できます。

<img src="assets/showcase/desktop/en/capsule.png" width="352" alt="字幕と録音操作ボタンを表示した会議カプセル" />

[![議事録と特性要因図。タイムスタンプから元の発言を確認できます](assets/showcase/desktop/en/summary.png)](assets/showcase/desktop/en/summary.gif)

議事録と特性要因図。タイムスタンプから元の発言を確認できます.

## 使い始める

1. デスクトップ版をインストールし、**設定 → モデルライブラリ**で文字起こしモデルをダウンロード。
2. マイク、システム音声、接続したスマートフォンを選んで会議を開始。ファイルの取り込みもできます。
3. 会議中にメモを取り、終了後に文字起こしや議事録を編集して書き出し。

macOS 14.4 以降ではシステム音声の録音権限のみをリクエストし、画面収録の権限は不要です。macOS 14.0〜14.3 では引き続き画面とシステム音声の権限を使用します。拒否した場合はシステム設定で再度許可してください。

推論エンジンはアプリに含まれます。Python や追加の推論実行環境は不要です。Windows に WebView2 がない場合のみ、インストーラーがダウンロードします。必要なモデルをダウンロードすれば、ローカルでオフライン利用できます。FunASR、Qwen3-ASR、Parakeet、Whisper、Qwen、Hy-MT などに対応し、利用可能なモデルは環境によって異なります。

## スマートフォンで録音

オフラインで録音し、メモや重要な時点を残せます。パソコンへの送信が受領確認されたら、スマートフォンのアプリを閉じても、取り込みと文字起こしはパソコン側で続きます。スマートフォンのコピーも残ります。パソコン用マイクやライブ字幕表示としても利用できます。同じローカルネットワークで **設定 → デバイス接続**からペアリングしてください。リアルタイム利用にはパソコンの起動が必要です。

![スマートフォンとパソコンで同じ会議の字幕を表示](assets/showcase/desktop/en/phone.png)

## ローカル Agent と連携

**設定 → Agent と MCP**で案内文をコピーし、ローカル Agent に渡してください。同梱の Skill を読み、CLI 経由で Brevia を操作します。MCP クライアントには同じ画面から設定をコピーできます。

> デスクトップのインタビュー音声を文字起こしし、SRT で保存して。
>
> 先週のリリース計画の会議を探し、未解決の質問をまとめて。
>
> 接続中のスマートフォンでこの会議の録音を始めて。

文字起こし、翻訳、話者分析、声紋照合、会議検索、録音操作を利用できます。長いタスクは進捗確認とキャンセルに対応し、既存ファイルは上書きしません。必要に応じてアプリをバックグラウンドで起動します。

[CLI / MCP](../DEVELOPMENT.md#本机-agent-接口) · [Brevia Skill](../skills/brevia/SKILL.md)

![Agent がスペイン語と英語の SRT 字幕を保存](assets/showcase/desktop/en/agent.png)

## CLI パラメーター

書式は `brevia メソッド [JSON] [--no-start]` です。CLI のパスは **設定 → Agent & MCP** で確認できます。`brevia help` はメソッド一覧を表示し、`brevia status --no-start` はアプリを起動せずに状態を確認します。

`inference.run` の `operation` に `transcribe` または `translate` を指定します。`input_path` と `output_path` は絶対パスで指定します。入力言語 `language` の既定値は `auto` です。翻訳には `target_language` も必要です。

```sh
brevia inference.run '{"operation":"transcribe","input_path":"/Users/me/interview.wav","language":"es","output_path":"/Users/me/interview.srt"}'
brevia task.get '{"task_id":"123e4567-e89b-42d3-a456-426614174000"}'
```

例のパスを置き換え、返された `task_id` を `task.get` に渡します。状態が `completed` になったら出力ファイルを開きます。 [コマンドとパラメーターの一覧](../DEVELOPMENT.md#本机-agent-接口)

## データについて

アカウントは不要です。録音・会議・モデルは自分のデバイスに保存され、スマートフォンとはローカル HTTPS で同期します。ローカル AI はオフラインで使えます。オンライン AI を選択した場合は、関連するテキストがそのサービスに送られます。 [Privacy](https://brevia.work/privacy.html).

## 技術スタック

デスクトップはシステムの WebView（macOS は WebKit、Windows は WebView2）、共通の会議処理とネイティブエンジンを使用。モバイル版は Flutter です。 デスクトップ版には Tauri と Rust を採用し、会議データは SQLite に保存します。音声処理には sherpa-onnx、議事録の生成には llama.cpp を使用します。

## プロジェクトに参加

[Issues](https://github.com/zerolovesea/Brevia/issues) · [Development](../DEVELOPMENT.md) · [Docs](README.md)

ISC ライセンス。モデルと外部コンポーネントには各自のライセンスが適用されます。Tauri、MLX、sherpa-onnx、llama.cpp、miniaudio と各モデルの開発者に感謝します。 [ISC](../LICENSE).
