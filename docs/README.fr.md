<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>La mémoire de réunion privée, d'abord locale.</strong><br />Enregistrez une conversation, suivez-la en direct et conservez une transcription traçable.</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <strong>Français</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

## Product tour

| | |
| --- | --- |
| ![Product tour](assets/tour/en/library.png) | ![Product tour](assets/tour/en/prepare.png) |
| ![Product tour](assets/tour/en/models.png) | ![Product tour](assets/tour/en/settings.png) |

![Product tour](assets/tour/en/notes.png)

## Fonctionnalités

- Enregistrement du microphone et du son système avec sous-titres en direct.
- ASR temps réel, ponctuation, raffinement, VAD et diarisation en local avec **sherpa-onnx**.
- Téléchargement des modèles par langue, jusqu'à 200 termes locaux, identification et renommage des intervenants.
- Import d'audio ; export des transcriptions/notes en Markdown, TXT, JSON, SRT, DOCX, PDF et de l'audio en FLAC, WAV, M4A.
- Traductions et résumés structurés facultatifs, uniquement après consentement explicite et configuration d'un fournisseur.

## Architecture et stack

`UI Electron ↔ IPC validé par Zod ↔ Worker Python JSONL → sherpa-onnx / SQLite, audio et exports locaux`. Aucun port backend n'est exposé. La stack emploie Electron 43, HTML/CSS/JS natif, Python 3, SQLite, ONNX Runtime et `sherpa-onnx==1.13.2`; la diarisation utilise les modèles de segmentation Pyannote et d'empreintes vocales de sherpa-onnx.

## Prérequis et lancement

- Node.js 20+, npm et Python 3.10+ (les diagnostics illustrent Python 3.12).
- La capture directe actuelle vise macOS et demande les autorisations Microphone et Enregistrement de l'écran. L'import audio n'en a pas besoin.
- Prévoyez l'espace des modèles : le modèle chinois de streaming par défaut fait ~570 Mio. Certains exports audio demandent `ffmpeg`.

```bash
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

Après le premier lancement, téléchargez vos modèles dans **Settings → Model library**. Changez les chemins de développement avec `BREVIA_DATA_DIR` et `BREVIA_MODELS_DIR`, puis vérifiez avec `npm test`.

## Installer la version de développement macOS v0.1.0

Téléchargez `Brevia-0.1.0-arm64.dmg` depuis les [GitHub Releases](https://github.com/zerolovesea/Brevia/releases), ouvrez-le puis faites glisser **Brevia** dans Applications. Cette build est destinée aux Mac Apple Silicon.

> **Build de développement non signée :** v0.1.0 n'est ni signée ni notarisée. Si macOS bloque le premier lancement, ouvrez **Réglages Système → Confidentialité et sécurité**, puis choisissez **Ouvrir quand même** pour Brevia ; ou exécutez dans le Terminal :

```bash
xattr -dr com.apple.quarantine "/Applications/Brevia.app"
```

Le premier DMG de développement contient l'application Electron et le code backend local, mais n'inclut pas encore de runtime Python portable ni les dépendances des modèles vocaux. Installez les dépendances Python depuis une copie du code source avant d'utiliser la transcription locale.

## Construire un DMG de développement

```bash
npm ci
npm run build
python3 -m pip install -r backend/requirements.txt
npm run dist
```

Le DMG est créé dans `dist/`. Une future version autonome devra fournir un runtime Python relogeable dans `.venv/bin/python` ; les modèles doivent rester téléchargés à la demande et conserver leurs licences amont.

## Contributing

Gardez les changements ciblés, exécutez `npm test` et les diagnostics audio concernés. Ne commitez ni modèles, ni enregistrements, ni exports, ni clés, ni données locales. Maintenez les huit langues et décrivez l'impact modèle, permission ou plateforme dans la PR.

## License

Brevia est publié sous [ISC License](../LICENSE) ; modèles et dépendances conservent leurs propres conditions.

## Acknowledgments

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) est le moteur principal de l'ASR, VAD, ponctuation et traitement des intervenants en local, sous [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE). Merci à ses auteurs, Electron, ONNX Runtime, Python et la communauté voix libre.
