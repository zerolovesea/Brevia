<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>会話に集中。大切なことは記録に。</strong><br />パソコンやスマートフォンで録音し、ローカル AI で文字起こし・決定事項・次のアクションを整理します。</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <strong>日本語</strong> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><img src="assets/demo/ai-assist-en.gif" width="820" alt="Brevia desktop demo (English)" /></p>

## ダウンロード

| デバイス                  | Brevia を入手                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| macOS 14+ · Apple Silicon | [DMG](https://github.com/zerolovesea/Brevia/releases/latest) · `arm64.dmg`                                          |
| Windows · x64             | [インストーラー](https://github.com/zerolovesea/Brevia/releases/latest) · `x64-setup.exe`                           |
| Android 7+                | [APK をダウンロード](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) |
| iPhone · iOS 15+          | App Store 審査中。TestFlight は招待者のみ。 [リリース情報](https://github.com/zerolovesea/Brevia/releases)          |

## できること

### 確認して使える AIメモ

AIメモはリアルタイム文字起こしを見ながら、決定事項、アクション、重要な数値、リスク、質問、話題の切り替わりを提示します。必要なときだけ使う、控えめな提案、自動整理から選べます。提案はすべて確認可能で、役立つものだけをノートへ追加し、リッチテキストまたは Markdown で編集できます。

### 静かな会議画面でのリアルタイム文字起こしと翻訳

開いて録音ボタンを押せば、字幕が現れます。Brevia はマイクとシステム音声を同時にキャプチャし、リモート通話の両側が同じ文字起こしに収まります。オプションのリアルタイム翻訳が字幕の隣に並列表示され、多言語の会話をサポートします。

![リアルタイム会議と翻訳](assets/tour/en/%E5%AE%9E%E6%97%B6%E4%BC%9A%E8%AE%AE%E5%92%8C%E7%BF%BB%E8%AF%91.png)

### 30 以上の文字起こし言語と会議要約

Brevia は 30 以上の言語で音声を文字起こしします——英語、中国語、日本語、韓国語、フランス語、ドイツ語、スペイン語、ロシア語、アラビア語、タイ語、ベトナム語、インドネシア語など。会議終了後、任意の LLM プロバイダに接続すれば、確認済みの文字起こしから会議要約、重要な決定事項、アクションアイテムを生成します。

### 会議後の精修で話者を識別

メンバーごとに短い音声サンプルを登録すると、会議終了後の精修時に話者を分離し、保存済みの声紋と照合して文字起こしに名前を表示します。会議中のリアルタイム字幕では話者を区別しません。声紋プロフィールは別の会議でも再利用できます。

Pyannote のセグメンテーションと話者埋め込みモデルを組み合わせ、すべて端末上で実行されます。

![会議後の精修で話者を識別](assets/tour/en/%E6%B3%A8%E5%86%8C%E5%A3%B0%E7%BA%B9%E8%AF%86%E5%88%AB.png)

### さらに

- **音声インポート** — 既存の録音を持ち込んで、同じ音声パイプラインでオフライン文字起こし。
- **豊富なエクスポート** — 文字起こしとメモを Markdown、TXT、JSON、SRT、DOCX、PDF で；音声を WAV で。
- **確認可能なノート** — リッチテキストまたは Markdown で書き、役立つ AI 提案だけを採用。
- **会議ライブラリとワークスペース** — タイトル、文字起こし、話者、タグを検索し、ワークスペースで整理。最近削除した会議は 30 日間復元できます。
- **集中できる表示** — ライト/ダークテーマ、文字起こし・要約のインライン編集、任意のフローティング字幕で会議画面をすっきり保ちます。
- **多言語 UI** — 英語、簡体中国語、スペイン語、日本語、韓国語、フランス語、ドイツ語、ロシア語。

## 対応モデル

音声認識・AI メモ・翻訳モデルは **設定 → モデルライブラリ** で必要に応じて取得します。音声区間検出と話者処理のモデルはアプリに同梱されています。以下はすべてパソコンで実行し、スマートフォンにモデルを入れる必要はありません。種類と容量はアプリ内で確認できます。

| 用途               | モデル                    | 言語／機能                               |
| ------------------ | ------------------------- | ---------------------------------------- |
| 文字起こし／後処理 | FunASR Nano               | 中国語・広東語・英語                     |
| 文字起こし／後処理 | Qwen3-ASR 0.6B            | 中国語・英語・日本語・韓国語など 30 言語 |
| 文字起こし／後処理 | Parakeet TDT 0.6B v3      | 欧州の 25 言語                           |
| AI メモ／要約      | Qwen 3.5 2B / 4B          | 中国語／英語                             |
| 字幕翻訳           | Tencent Hy-MT2 1.8B       | 多言語翻訳                               |
| 音声区間検出       | Silero VAD                | 発話と無音を検出                         |
| 話者分離           | Pyannote Segmentation 3.0 | 会議後に話者を分離                       |
| 声紋照合           | 3D-Speaker ERes2Net Base  | 保存済みの声紋と照合                     |

## スマートフォンで録音

[**Android APK をダウンロード**](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) · iPhone：App Store 審査中。TestFlight は招待者のみ（[リリース情報](https://github.com/zerolovesea/Brevia/releases)）

会議やインタビュー、日々の打ち合わせに Brevia を。アカウントを作らず、アプリを開いて録音を始められます。自分のパソコンにつなげば、録音しながら文字起こしやメモも確認できます。

<p align="center">
  <img src="assets/mobile/en/02-connect.png" width="240" alt="Brevia iPhone: computer connection (English)" />
  <img src="assets/mobile/en/01-record.png" width="240" alt="Brevia iPhone: offline recording setup (English)" />
  <img src="assets/mobile/en/03-transcript.png" width="240" alt="Brevia mobile: live transcript with demo content (English)" />
</p>

- **パソコンを持ち歩かずに録音。** ペアリングやインターネットは不要です。一時停止・再開・重要箇所のマークに対応。音声はスマートフォンに保存され、文字起こしが必要なときにパソコンを選んで送信を承認します。
- **スマートフォンで収音し、パソコンで整理。** ペアリング後はパソコンが音声認識を行い、文字起こしとメモをリアルタイムで返します。モデルや AI 設定はパソコン側にあり、スマートフォンに大きなモデルを入れる必要はありません。
- **聞き返して、共有。** 会議ライブラリで録音を探して再生し、音声を WAV、メモを Markdown、文字起こしをテキストで共有できます。スマートフォンのコピーを削除しても、パソコンの会議は残ります。

通信が途切れても音声はスマートフォンに保存され、承認済みの送信は再接続後に再開します。バックグラウンド録音に対応していますが、着信・強制終了・OS の制限で中断する場合があります。アプリに戻ったら状態を確認してください。録音後の送信にはアプリを開いておく必要がある場合があります。

## スマートフォンとパソコンの通信

ローカルネットワークでは、スマートフォンからペアリング済みパソコンへ **HTTPS** で音声を送り、文字起こしとメモを受け取ります。音声はまずスマートフォンに保存し、パソコンの保存確認後に送信位置を進めます。通信が途切れた場合は確認済みの位置から再開し、送信完了後もスマートフォンのコピーを自動削除しません。

自分でシグナリング／TURN サービスを設定すると、ペアリング済みの端末は **WebRTC DataChannel** で別のネットワークからも接続できます。直接接続を優先し、できない場合は暗号化された通信を中継します。中継運営者にはネットワークアドレスや通信量が見えますが、中継を通じて暗号化された会議内容を読むことはできません。 [異なるネットワーク間の接続には追加設定が必要です。初回ペアリングは同じローカルネットワークで行います。](mobile-remote.md)

音声認識はパソコン内で実行します。オフライン録音はアップロードを承認するまでスマートフォンに保存され、リアルタイム文字起こしではペアリング済みパソコンへ音声を送ります。会議を開発者へ自動送信することはありません。モデル取得後はローカル AI を利用できます。オンライン AI を選んだ場合、関連する文字情報をそのサービスへ送りますが、音声は送りません。任意の遠隔接続サービスは暗号化された通信を中継する場合があります。 [プライバシー](https://brevia.work/privacy.html).

スマートフォンの音声は録音 **1 時間あたり約 115 MB** を使い、書き出しやキャッシュは別途容量を消費します。遠隔アップロードには通信量と通信処理分の追加データが必要です。

## 使い始める

1. パソコンに Brevia をインストールし、音声の権限を許可して推奨の音声モデルをダウンロードします。オフライン AI メモにはローカル AI モデルも選びます。
2. 会議を開始するか録音を取り込み、結果を確認して書き出します。
3. スマートフォンを接続する場合は同じ Wi-Fi を使います。パソコンの **設定 → デバイス接続 → 新しいデバイスを接続** から QR を表示し、スマートフォンで読み取るかアドレスと PIN を入力。確認コードを照合してパソコンで許可します。

## FAQ

<details>
<summary><strong>Windows で Microsoft Defender SmartScreen の警告が表示される</strong></summary>

リリースビルドは有料のコード署名証明書で署名されていないため、SmartScreen は新しく見る実行ファイルをデフォルトでブロックします。**「詳細情報」→「実行」** をクリックし、ダウンロード元が公式 [Releases](https://github.com/zerolovesea/Brevia/releases) ページであることを確認してから続けてください。

</details>

<details>
<summary><strong>Python を別途インストールする必要はありますか？</strong></summary>

いいえ。リリースビルドは Python ランタイムと必要な依存関係をすべて同梱しています。ソースから実行する場合のみ、別途 Python 環境が必要です。

</details>

<details>
<summary><strong>モデルにはどれくらいのディスク容量が必要ですか？</strong></summary>

まず会議の言語に合う推奨音声モデルを選び、必要に応じてローカル AI や翻訳モデルを追加してください。ダウンロード容量はモデルライブラリに表示されます。すべてのモデルを入れる必要はありません。

</details>

## ヘルプと開発参加

[GitHub Issues](https://github.com/zerolovesea/Brevia/issues) — 不具合はアプリのバージョン、デバイス、再現手順を添えて報告してください。画像やログから個人情報と認証情報を除いてください。

[開発ガイド（英語）](DEVELOPMENT.md) · [モバイル開発（中国語）](../mobile/README.md) · [CONTRIBUTING](../CONTRIBUTING.md).

## ライセンス

Brevia は [ISC License](../LICENSE) の下でリリースされています。モデルファイルとサードパーティパッケージはそれぞれのライセンスと条件を保持します。

## 謝辞

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — ASR、VAD、句読点、話者処理を支えるローカルランタイム。[Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) でライセンスされています。
- [`backend/models.json`](../backend/models.json) で宣言されているダウンロード可能な成果物のモデル作者とメンテナに感謝します——Qwen3-ASR、FunASR、Parakeet (NeMo)、Pyannote、3D-Speaker、Silero、Tencent Hy-MT2 など。
- Electron、ONNX Runtime、Python、オープンソースの音声コミュニティが、このローカルファーストのワークフローを可能にしています。
