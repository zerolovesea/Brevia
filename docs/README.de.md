<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>Private, lokale Meeting-Erinnerung.</strong><br />Gespräche aufzeichnen, live verfolgen und ein nachvollziehbares Transkript behalten.</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <strong>Deutsch</strong> · <a href="README.ru.md">Русский</a></p>

## Product tour

| | |
| --- | --- |
| ![Product tour](assets/tour/en/library.png) | ![Product tour](assets/tour/en/prepare.png) |
| ![Product tour](assets/tour/en/models.png) | ![Product tour](assets/tour/en/settings.png) |

![Product tour](assets/tour/en/notes.png)

## Funktionen

- Mikrofon und Systemaudio aufnehmen und Live-Untertitel anzeigen.
- Streaming-ASR, Zeichensetzung, Nachbearbeitung, VAD und Sprechertrennung mit **sherpa-onnx** lokal ausführen.
- Sprachmodelle herunterladen, bis zu 200 lokale Fachbegriffe nutzen und Sprecher erkennen bzw. umbenennen.
- Audio importieren; Transkripte/Notizen als Markdown, TXT, JSON, SRT, DOCX, PDF und Audio als FLAC, WAV, M4A exportieren.
- Optionale Übersetzungen und strukturierte Zusammenfassungen erst nach ausdrücklicher Zustimmung und Provider-Konfiguration erstellen.

## Architektur und Stack

`Electron-Oberfläche ↔ Zod-validiertes IPC ↔ Python-JSONL-Worker → sherpa-onnx / lokales SQLite, Audio und Exporte`. Es gibt keinen Backend-Port. Eingesetzt werden Electron 43, natives HTML/CSS/JS, Python 3, SQLite, ONNX Runtime und `sherpa-onnx==1.13.2`; die Sprechertrennung nutzt Pyannote-Segmentierung und Voice-Embedding-Modelle von sherpa-onnx.

## Voraussetzungen und Start

- Node.js 20+, npm und Python 3.10+ (Diagnosebeispiele nutzen Python 3.12).
- Die aktuelle Live-Aufnahme ist für macOS ausgelegt und benötigt Mikrofon- sowie Bildschirmaufnahme-Rechte. Audioimport benötigt sie nicht.
- Platz für Modelle einplanen: Das Standardmodell für chinesisches Streaming benötigt etwa 570 MiB. Einige Audioexporte brauchen `ffmpeg`.

```bash
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

Nach dem Start Modelle unter **Settings → Model library** laden. Entwicklungsordner lassen sich mit `BREVIA_DATA_DIR` und `BREVIA_MODELS_DIR` umstellen; Änderungen mit `npm test` prüfen.

## macOS-Entwicklungsbuild v0.1.0 installieren

Lade `Brevia-0.1.0-arm64.dmg` von den [GitHub Releases](https://github.com/zerolovesea/Brevia/releases) herunter, öffne es und ziehe **Brevia** nach Applications. Dieser Build ist für Apple-Silicon-Macs.

> **Unsignierter Entwicklungsbuild:** v0.1.0 ist weder codesigniert noch notarisiert. Wenn macOS den ersten Start blockiert, öffne **Systemeinstellungen → Datenschutz & Sicherheit** und wähle für Brevia **Dennoch öffnen**; alternativ im Terminal ausführen:

```bash
xattr -dr com.apple.quarantine "/Applications/Brevia.app"
```

Das erste Entwicklungs-DMG enthält die Electron-App und den lokalen Backend-Code, aber noch keine portable Python-Laufzeit oder Abhängigkeiten für Sprachmodelle. Installiere die Python-Anforderungen aus einem Source-Checkout, bevor du die lokale Transkription verwendest.

## Entwicklungs-DMG bauen

```bash
npm ci
npm run build
python3 -m pip install -r backend/requirements.txt
npm run dist
```

Das DMG wird in `dist/` erzeugt. Eine künftige eigenständige Version muss eine verschiebbare Python-Laufzeit unter `.venv/bin/python` enthalten; Modelle sollen weiter bei Bedarf geladen werden und ihre Upstream-Lizenzen behalten.

## Contributing

Kleine, fokussierte Änderungen erstellen, `npm test` und passende Sprachdiagnosen ausführen. Keine Modelle, Aufnahmen, Exporte, Schlüssel oder lokalen Daten committen. Alle acht Sprachen pflegen und Modell-, Rechte- oder Plattformauswirkungen im PR beschreiben.

## License

Brevia steht unter der [ISC License](../LICENSE); Modelle und Abhängigkeiten behalten ihre jeweiligen Bedingungen.

## Acknowledgments

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) ist die Kernlaufzeit für lokales ASR, VAD, Zeichensetzung und Sprecherverarbeitung und steht unter [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE). Danke an die Autor:innen, Electron, ONNX Runtime, Python und die Open-Source-Sprachcommunity.
