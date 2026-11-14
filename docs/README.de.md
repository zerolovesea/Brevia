<h1 align="center"><img src="assets/brevia-hero.gif" width="100%" alt="Brevia" /></h1>

<p align="center"><strong>Auf das Gespräch konzentrieren. Das Wichtige festhalten.</strong><br />Ein KI-Meetingassistent mit lokaler Verarbeitung. Gespräche aufnehmen, transkribieren und übersetzen – mit bearbeitbaren Notizen und Aufgaben, die zur Originalaufnahme zurückführen.</p>

<p align="center">
  <a href="https://github.com/zerolovesea/Brevia/releases/latest"><img src="https://img.shields.io/github/v/release/zerolovesea/Brevia?style=flat-square" alt="Latest release" /></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/License-ISC-blue?style=flat-square" alt="ISC License" /></a>
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/downloads/zerolovesea/Brevia/total?style=flat-square" alt="GitHub downloads" /></a>
  <a href="https://github.com/zerolovesea/Brevia/stargazers"><img src="https://img.shields.io/github/stars/zerolovesea/Brevia?style=flat-square" alt="GitHub stars" /></a>
</p>

<p align="center"><a href="README.en.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <strong>Deutsch</strong> · <a href="README.ru.md">Русский</a></p>

![Brevia](assets/showcase/desktop/en/live.gif)

## Download

| Plattform | Download                                                                                             | Voraussetzungen              |
| --------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Mac       | [macOS][download-mac]                                                                                | Apple Silicon · macOS 14+    |
| Windows   | [Windows][download-windows] · [CUDA](https://brevia.work)                                            | Windows 10 / 11 · x64 · AVX2 |
| Linux     | [CPU · CUDA](https://brevia.work)                                                                    | Ubuntu 24.04 · x86-64 · AVX2 |
| iPhone    | [App Store](https://apps.apple.com/app/id6819869442)                                                 | iOS 15+                      |
| Android   | [APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) | Android 7+                   |

[download-mac]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.4/Brevia-WebKit-2.0.4-arm64.dmg
[download-windows]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.4/Brevia-2.0.4-x64-setup.exe

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases) · [brevia.work](https://brevia.work)

Mac ca. 43 MiB (45,5 MB), Windows 38 MB. Sprachmodelle werden separat heruntergeladen.

> Für Windows und Linux stehen Installationspakete für CPU und NVIDIA CUDA bereit. Zur Transkription dient MLX unter macOS und Linux, unter Windows sherpa-onnx.

## Funktionen

- Mikrofon und Systemton gemeinsam aufnehmen, mit Live-Transkription, Übersetzung, schwebenden Untertiteln und Aufnahmesteuerung.
- Sprecher im Hintergrund erkennen, während Untertitel sofort erscheinen. Anschließend Transkripte verbessern, Namen korrigieren und Stimmprofile speichern.
- **Schnelle Transkription:** Auf einem M4 Pro dauerte die vollständige Transkription einer **66 min 40 s** langen Aufnahme **3 min 33 s**.
- Meetings in Arbeitsbereichen organisieren, Inhalte durchsuchen und als Markdown, TXT, JSON, SRT, DOCX, PDF oder WAV exportieren.
- Vorhandene Audio- und Videodateien transkribieren, übersetzen und nach Sprechern auswerten – auch über einen lokalen Agenten.

### Protokoll und Fischgrätendiagramm

[![Sitzungsprotokoll und Fischgrätendiagramm mit Verweis auf die Originalaufnahme](assets/showcase/desktop/en/summary.png)](assets/showcase/desktop/en/summary.gif)

Das Protokoll hat sieben Abschnitte. Über das Ursachendiagramm können Sie Aussagen im Transkript prüfen und anhören. Protokoll und Ursachenanalyse lassen sich getrennt exportieren. Sie können nach Sprechern filtern und Namen für eine ganze Besprechung ändern.

### KI-Notizen

Notizen schreiben und mit KI Entscheidungen und Aufgaben herausarbeiten. Von den Notizen zu Originalaussagen und Aufnahme zurückspringen.

![KI schlägt eine Aufgabe für die Notizen vor](assets/showcase/desktop/en/ai-notes.png)

## Mit dem Smartphone aufnehmen

Offline aufnehmen, Notizen schreiben und wichtige Stellen markieren. Sobald der Computer den Empfang bestätigt, kann die Smartphone-App verlassen werden: Import und Transkription laufen auf dem Desktop weiter. Die lokale Kopie bleibt erhalten. Das Smartphone kann auch als Mikrofon oder zur Anzeige von Live-Untertiteln dienen. Beide Geräte unter **Einstellungen → Geräteverbindung** im selben lokalen Netzwerk koppeln; für den Live-Modus muss der Computer laufen.

![Live-Untertitel auf Smartphone und Computer](assets/showcase/desktop/en/phone.png)

## Meeting-Kapsel

Minimieren Sie das Hauptfenster, um in der Kapsel Aufnahme oder Wiedergabe zu steuern, Untertitel zu lesen, Notizen zu bearbeiten und Bilder einzufügen. Im Hintergrund kann Brevia bei Ton aus einer unterstützten Konferenz-App an die Aufnahme erinnern.

<img src="assets/showcase/desktop/en/capsule.png" width="352" alt="Meeting-Kapsel mit Untertiteln und Aufnahmesteuerung" />

## Lokalen Agenten verbinden

Unter **Einstellungen → Agent & MCP** die Einrichtungsnachricht kopieren und dem lokalen Agenten geben. Er liest den enthaltenen Skill und nutzt Brevia über die CLI. Für MCP-Clients die MCP-Konfiguration auf derselben Seite kopieren.

> Transkribiere das Interview auf meinem Desktop und speichere es als SRT.
>
> Finde die Meetings der letzten Woche zur Veröffentlichung und liste offene Fragen auf.
>
> Starte die Aufnahme dieses Meetings mit meinem verbundenen Smartphone.

Agenten können transkribieren, übersetzen, Stimmen erkennen, Meetings durchsuchen und Aufnahmen steuern. Lange Aufgaben bieten Fortschrittsanzeige und Abbruch. Vorhandene Dateien werden nicht überschrieben; Brevia startet bei Bedarf im Hintergrund.

[CLI / MCP](../DEVELOPMENT.md#本机-agent-接口) · [Brevia Skill](../skills/brevia/SKILL.md)

![Agent erstellt spanische und englische SRT-Dateien](assets/showcase/desktop/en/agent.png)

## CLI-Parameter

Syntax: `brevia METHODE [JSON] [--no-start]`. Der CLI-Pfad steht unter **Einstellungen → Agent & MCP**. `brevia help` listet die Methoden auf. `brevia status --no-start` prüft den Status, ohne die App zu starten.

Für `inference.run` ist `operation` entweder `transcribe` oder `translate`. `input_path` und `output_path` sind absolute Pfade. Die Quellsprache `language` ist standardmäßig `auto`. Eine Übersetzung benötigt `target_language`.

```sh
brevia inference.run '{"operation":"transcribe","input_path":"/Users/me/interview.wav","language":"es","output_path":"/Users/me/interview.srt"}'
brevia task.get '{"task_id":"123e4567-e89b-42d3-a456-426614174000"}'
```

Ersetze die Beispielpfade und übergib die zurückgegebene `task_id` an `task.get`. Bei `completed` ist die Ausgabedatei fertig. [Alle Befehle und Parameter](../DEVELOPMENT.md#本机-agent-接口)

## Erste Schritte

1. Desktop-App installieren und unter **Einstellungen → Modellbibliothek** ein Transkriptionsmodell herunterladen.
2. Ein Meeting mit Mikrofon, Systemton oder verbundenem Smartphone starten oder eine Datei importieren.
3. Notizen machen, das Transkript nachbearbeiten und Ergebnisse bearbeiten oder exportieren.

Ab macOS 14.4 wird nur die Berechtigung zur Systemaudioaufnahme angefragt, ohne Zugriff auf den Bildschirm. macOS 14.0–14.3 verwendet weiterhin die Berechtigung für Bildschirm und Systemaudio. Nach einer Ablehnung lässt sich der Zugriff in den Systemeinstellungen wieder erlauben.

Die Inferenz-Engines sind enthalten. Python oder eine zusätzliche Inferenz-Laufzeitumgebung werden nicht benötigt. Unter Windows lädt das Installationsprogramm WebView2 nur bei Bedarf herunter. Gewünschte Modelle einmal herunterladen und offline nutzen. Je nach Plattform stehen FunASR, Qwen3-ASR, Parakeet, Whisper, Qwen und Hy-MT zur Verfügung.

## Deine Daten

Kein Konto erforderlich. Aufnahmen, Meetings und Modelle bleiben auf deinen Geräten. Das Smartphone synchronisiert per lokalem HTTPS. Lokale KI funktioniert offline; bei einem gewählten Onlinedienst werden die betreffenden Texte an diesen Anbieter gesendet. [Privacy](https://brevia.work/privacy.html).

## Technik

Der Desktop nutzt das System-WebView (WebKit auf macOS, WebView2 auf Windows), gemeinsame Meetinglogik und native Engines. Die mobile App verwendet Flutter. Brevia verwendet Tauri und Rust für den Desktop, SQLite für lokale Meetingdaten, sherpa-onnx für die Sprachverarbeitung und llama.cpp für Zusammenfassungen.

## Mitmachen

[Issues](https://github.com/zerolovesea/Brevia/issues) · [Development](../DEVELOPMENT.md) · [Docs](README.md)

ISC-Lizenz. Für Modelle und Drittanbieterkomponenten gelten deren eigene Lizenzen. Danke an Tauri, MLX, sherpa-onnx, llama.cpp, miniaudio und die Modellautoren. [ISC](../LICENSE).
