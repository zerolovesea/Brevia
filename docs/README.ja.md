<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>会話に集中。大切なことは記録に。</strong><br />パソコンやスマートフォンで録音し、ローカル AI で文字起こし・決定事項・次のアクションを整理します。</p>

<p align="center"><a href="README.en.md">English</a> · <a href="../README.md">简体中文</a> · <a href="README.es.md">Español</a> · <strong>日本語</strong> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><img src="assets/showcase/desktop/en/live.gif" width="960" alt="Brevia: live transcript and AI notes (English)" /></p>

## ダウンロード

| デバイス                  | Brevia を入手                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| macOS 14+ · Apple Silicon | [DMG](https://github.com/zerolovesea/Brevia/releases/download/v1.4.5/Brevia-1.4.5-arm64.dmg)                        |
| Windows · x64             | [インストーラー](https://github.com/zerolovesea/Brevia/releases/download/v1.4.5/Brevia-1.4.5-x64-setup.exe)         |
| Android 7+                | [APK をダウンロード](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) |
| iPhone · iOS 15+          | [App Store](https://apps.apple.com/app/id6819869442)                                                                |

<table align="center">
  <tr><th><a href="https://apps.apple.com/app/id6819869442">iPhone · App Store</a></th><th><a href="https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk">Android · APK</a></th></tr>
  <tr>
    <td align="center"><a href="https://apps.apple.com/app/id6819869442"><img src="assets/download/ios-qr.png" width="160" alt="iPhone · App Store QR" /></a></td>
    <td align="center"><a href="https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk"><img src="assets/download/android-qr.png" width="160" alt="Android · APK QR" /></a></td>
  </tr>
</table>

スマートフォンでスキャンしてダウンロード。

## v1.4 の新機能

パソコンとスマートフォンの画面を刷新。ノートとライブ文字起こしを並べ、ワークスペース別の会議一覧や、文字起こし・ノート・議事録の切り替えを整理しました。接続したスマートフォンをパソコンのマイクとしても使えます。

![新しい会議ライブラリ](assets/showcase/desktop/en/library.gif)

### フローティング録音カプセル

カプセルから録音を操作し、字幕やメモを確認できます。一時停止・再開や保存の再試行にも対応します。

![フローティング録音カプセル](assets/showcase/desktop/en/capsule.gif)

### 決定事項とタスクを編集できる議事録

![決定事項とタスクを編集できる議事録](assets/showcase/desktop/en/summary.gif)

## できること

### 確認して使える AIメモ

AIメモはリアルタイム文字起こしを見ながら、決定事項、アクション、重要な数値、リスク、質問、話題の切り替わりを提示します。必要なときだけ使う、控えめな提案、自動整理から選べます。提案はすべて確認可能で、役立つものだけをノートへ追加し、リッチテキストまたは Markdown で編集できます。

### 静かな会議画面でのリアルタイム文字起こしと翻訳

開いて録音ボタンを押せば、字幕が現れます。Brevia はマイクとシステム音声を同時にキャプチャし、リモート通話の両側が同じ文字起こしに収まります。オプションのリアルタイム翻訳が字幕の隣に並列表示され、多言語の会話をサポートします。

![リアルタイム会議と翻訳](assets/showcase/desktop/en/live.gif)

### 30 以上の文字起こし言語と会議要約

Brevia は 30 以上の言語で音声を文字起こしします——英語、中国語、日本語、韓国語、フランス語、ドイツ語、スペイン語、ロシア語、アラビア語、タイ語、ベトナム語、インドネシア語など。会議終了後、任意の LLM プロバイダに接続すれば、確認済みの文字起こしから会議要約、重要な決定事項、アクションアイテムを生成します。

### 会議後の精修で話者を識別

メンバーごとに短い音声サンプルを登録すると、会議終了後の精修時に話者を分離し、保存済みの声紋と照合して文字起こしに名前を表示します。会議中のリアルタイム字幕では話者を区別しません。声紋プロフィールは別の会議でも再利用できます。

Pyannote のセグメンテーションと話者埋め込みモデルを組み合わせ、すべて端末上で実行されます。

### さらに

- **録音操作をすぐ手元に。** 前回の会議設定で素早く録音を開始。メイン画面を最小化・非表示にしても、メニューバー、トレイ、フローティングカプセルから録音を操作し、字幕とノートを確認できます。
- **文字をまとめて修正** — 文字起こし・ノート・議事録の置換箇所をプレビューして選択し、一括置換と取り消しができます。録音中は、その会議の以降の字幕にルールを適用できます。
- **音声インポート** — 既存の録音を持ち込んで、同じ音声パイプラインでオフライン文字起こし。
- **豊富なエクスポート** — 文字起こしとメモを Markdown、TXT、JSON、SRT、DOCX、PDF で；音声を WAV で。
- **確認可能なノート** — リッチテキストまたは Markdown で書き、役立つ AI 提案だけを採用。
- **会議ライブラリとワークスペース** — タイトル、文字起こし、話者、タグを検索し、ワークスペースで整理。最近削除した会議は 30 日間復元できます。
- **集中できる表示** — ライト/ダークテーマ、文字起こし・要約のインライン編集、任意のフローティング字幕で会議画面をすっきり保ちます。
- **多言語 UI** — 英語、簡体中国語、スペイン語、日本語、韓国語、フランス語、ドイツ語、ロシア語。

## 対応モデル

音声認識・AI メモ・翻訳モデルは **設定 → モデルライブラリ** で必要に応じて取得します。音声区間検出と話者処理のモデルはアプリに同梱されています。以下はすべてパソコンで実行し、スマートフォンにモデルを入れる必要はありません。種類と容量はアプリ内で確認できます。

| 用途               | モデル                                  | 言語／機能                               |
| ------------------ | --------------------------------------- | ---------------------------------------- |
| 文字起こし／後処理 | FunASR Nano                             | 中国語・広東語・英語                     |
| 文字起こし／後処理 | Qwen3-ASR 0.6B                          | 中国語・英語・日本語・韓国語など 30 言語 |
| 後処理（任意）     | Qwen3-ASR 1.7B / Whisper Large v3 Turbo | 多言語；Apple Silicon Mac のみ           |
| 文字起こし／後処理 | Parakeet TDT 0.6B v3                    | 欧州の 25 言語                           |
| AI メモ／要約      | Qwen 3.5 2B / 4B                        | 中国語／英語                             |
| 字幕翻訳           | Tencent Hy-MT2 1.8B                     | 多言語翻訳                               |
| 音声区間検出       | Silero VAD                              | 発話と無音を検出                         |
| 話者分離           | Pyannote Segmentation 3.0               | 会議後に話者を分離                       |
| 声紋照合           | 3D-Speaker ERes2Net Base                | 保存済みの声紋と照合                     |

## スマートフォンで録音

[**iPhone · App Store**](https://apps.apple.com/app/id6819869442) · [**Android · APK**](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk)

会議やインタビュー、日々の打ち合わせに Brevia を。アカウントを作らず、アプリを開いて録音を始められます。自分のパソコンにつなげば、録音しながら文字起こしやメモも確認できます。

<p align="center">
  <img src="assets/showcase/mobile/en/library.png" width="240" alt="Brevia phone meeting library (English)" />
  <img src="assets/showcase/mobile/en/offline.png" width="240" alt="Brevia: offline phone recording (English)" />
  <img src="assets/showcase/mobile/en/live.png" width="240" alt="Brevia mobile: live transcript (English)" />
</p>

### スマートフォンをマイクに

パソコンで新しい会議を開き、**Phone microphone** を選択します。入力レベルを確認し、パソコンから録音の開始・一時停止・再開・終了を操作できます。対応するスマートフォンアプリを接続し、前面で待機させてください。この会議の文字起こしとノートはパソコンに保存されます。スマートフォンから始めた会議では、文字がスマートフォンに返されます。

![スマートフォンをマイクに](assets/showcase/desktop/en/phone-microphone.gif)

- **パソコンを持ち歩かずに録音。** ペアリングやインターネットは不要です。一時停止・再開・重要箇所のマークに対応。音声はスマートフォンに保存され、文字起こしが必要なときにパソコンを選んで送信を承認します。
- **スマートフォンで収音し、パソコンで整理。** ペアリング後はパソコンが音声認識を行い、文字起こしとメモをリアルタイムで返します。モデルや AI 設定はパソコン側にあり、スマートフォンに大きなモデルを入れる必要はありません。
- **聞き返して、共有。** 会議ライブラリで録音を探して再生し、音声を WAV、メモを Markdown、文字起こしをテキストで共有できます。スマートフォンのコピーを削除しても、パソコンの会議は残ります。

通信が途切れても音声はスマートフォンに保存され、承認済みの送信は再接続後に再開します。バックグラウンド録音に対応していますが、着信・強制終了・OS の制限で中断する場合があります。アプリに戻ったら状態を確認してください。録音後の送信にはアプリを開いておく必要がある場合があります。

## スマートフォンとパソコンの通信

ローカルネットワークでは、スマートフォンからペアリング済みパソコンへ **HTTPS** で音声を送り、文字起こしとメモを受け取ります。音声はまずスマートフォンに保存し、パソコンの保存確認後に送信位置を進めます。通信が途切れた場合は確認済みの位置から再開し、送信完了後もスマートフォンのコピーを自動削除しません。

音声認識はパソコン内で実行します。オフライン録音はアップロードを承認するまでスマートフォンに保存され、リアルタイム文字起こしではペアリング済みパソコンへ音声を送ります。会議を開発者へ自動送信することはありません。モデル取得後はローカル AI を利用できます。オンライン AI を選んだ場合、関連する文字情報をそのサービスへ送りますが、音声は送りません。[プライバシー](https://brevia.work/privacy.html).

## 使い始める

1. パソコンに Brevia をインストールし、音声の権限を許可して推奨の音声モデルをダウンロードします。オフライン AI メモにはローカル AI モデルも選びます。
2. 会議を開始するか録音を取り込み、結果を確認して書き出します。
3. スマートフォンを接続する場合は同じ Wi-Fi を使います。パソコンの **設定 → デバイス接続 → 新しいデバイスを接続** から QR を表示し、スマートフォンで読み取るかアドレスと PIN を入力。確認コードを照合してパソコンで許可します。

## 技術構成

- **デスクトップ：** Electron と JavaScript、画面は HTML と Tailwind CSS で構成。
- **ローカル処理：** Python Worker が音声とモデルを管理し、MLX / sherpa-onnx が音声推論、llama.cpp がローカル AI を実行。
- **モバイル：** Flutter と Dart で iOS・Android の画面と録音フローを共通化。
- **保存と同期：** パソコンの会議記録は SQLite に保存し、端末間はローカルネットワークの HTTPS で同期。

## FAQ

### Windows で Microsoft Defender SmartScreen の警告が表示される

リリースビルドは有料のコード署名証明書で署名されていないため、SmartScreen は新しく見る実行ファイルをデフォルトでブロックします。**「詳細情報」→「実行」** をクリックし、ダウンロード元が公式 [Releases](https://github.com/zerolovesea/Brevia/releases) ページであることを確認してから続けてください。

### Python を別途インストールする必要はありますか？

いいえ。リリースビルドは Python ランタイムと必要な依存関係をすべて同梱しています。ソースから実行する場合のみ、別途 Python 環境が必要です。

### モデルにはどれくらいのディスク容量が必要ですか？

まず会議の言語に合う推奨音声モデルを選び、必要に応じてローカル AI や翻訳モデルを追加してください。ダウンロード容量はモデルライブラリに表示されます。すべてのモデルを入れる必要はありません。

## ヘルプと開発参加

[GitHub Issues](https://github.com/zerolovesea/Brevia/issues) — 不具合はアプリのバージョン、デバイス、再現手順を添えて報告してください。画像やログから個人情報と認証情報を除いてください。

[モバイル開発（中国語）](../mobile/README.md) · [CONTRIBUTING](../CONTRIBUTING.md).

## ライセンス

Brevia は [ISC License](../LICENSE) の下でリリースされています。モデルファイルとサードパーティパッケージはそれぞれのライセンスと条件を保持します。

## 謝辞

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — ASR、VAD、句読点、話者処理を支えるローカルランタイム。[Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) でライセンスされています。
- [`backend/models.json`](../backend/models.json) で宣言されているダウンロード可能な成果物のモデル作者とメンテナに感謝します——Qwen3-ASR、FunASR、Parakeet (NeMo)、Pyannote、3D-Speaker、Silero、Tencent Hy-MT2 など。
- Electron、ONNX Runtime、Python、オープンソースの音声コミュニティが、このローカルファーストのワークフローを可能にしています。
