<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>Memoria de reuniones privada y local.</strong><br />Graba una conversación, síguela en directo y conserva una transcripción verificable.</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>Español</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

## Product tour

| | |
| --- | --- |
| ![Product tour](assets/tour/en/library.png) | ![Product tour](assets/tour/en/prepare.png) |
| ![Product tour](assets/tour/en/models.png) | ![Product tour](assets/tour/en/settings.png) |

![Product tour](assets/tour/en/notes.png)

## Funciones

- Graba micrófono y audio del sistema con subtítulos en directo.
- Ejecuta ASR en streaming, puntuación, refinamiento, VAD y diarización localmente con **sherpa-onnx**.
- Descarga modelos por idioma, usa hasta 200 términos locales y renombra participantes.
- Importa audio y exporta transcripciones/notas a Markdown, TXT, JSON, SRT, DOCX o PDF; exporta audio a FLAC, WAV o M4A.
- Las traducciones y resúmenes son opcionales y requieren consentimiento explícito y configuración del proveedor.

## Arquitectura y stack

`Interfaz Electron ↔ IPC validado con Zod ↔ Worker Python JSONL → sherpa-onnx / SQLite, audio y exportaciones locales`. No hay puerto de backend. El stack incluye Electron 43, HTML/CSS/JS nativo, Python 3, SQLite, ONNX Runtime y `sherpa-onnx==1.13.2`; la diarización usa segmentación Pyannote y modelos de embeddings de voz de sherpa-onnx.

## Requisitos y uso

- Node.js 20+, npm y Python 3.10+ (los diagnósticos usan Python 3.12).
- En macOS, la captura en directo necesita permisos de micrófono y grabación de pantalla. El audio importado no los necesita.
- Reserva espacio para los modelos: el streaming chino predeterminado ocupa ~570 MiB. Algunas exportaciones requieren `ffmpeg`.

```bash
npm install
python3 -m pip install -r backend/requirements.txt
npm start
```

Después, abre **Settings → Model library** y descarga los modelos necesarios. Usa `BREVIA_DATA_DIR` y `BREVIA_MODELS_DIR` para rutas de desarrollo alternativas y `npm test` para verificar cambios.

## Instalar la versión de desarrollo v0.1.0 para macOS

Descarga `Brevia-0.1.0-arm64.dmg` desde [GitHub Releases](https://github.com/zerolovesea/Brevia/releases), ábrelo y arrastra **Brevia** a Applications. Esta compilación es para Macs con Apple Silicon.

> **Compilación de desarrollo sin firma:** v0.1.0 no está firmada ni notarizada. Si macOS bloquea el primer inicio, ve a **Ajustes del Sistema → Privacidad y seguridad** y elige **Abrir de todos modos** para Brevia; o ejecuta en Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Brevia.app"
```

El primer DMG de desarrollo incluye la app Electron y el código backend local, pero aún no incluye un runtime Python portátil ni dependencias de modelos de voz. Instala los requisitos de Python desde una copia del código fuente antes de usar la transcripción local.

## Crear un DMG de desarrollo

```bash
npm ci
npm run build
python3 -m pip install -r backend/requirements.txt
npm run dist
```

El DMG se escribe en `dist/`. Una versión futura autocontenida debe incluir un runtime Python reubicable en `.venv/bin/python`; los modelos deben seguir descargándose bajo demanda y conservar sus licencias upstream.

## Contributing

Trabaja en cambios pequeños, ejecuta `npm test` y diagnósticos al tocar voz, y no confirmes modelos, grabaciones, exportaciones, claves ni datos locales. Mantén coherentes los ocho idiomas y describe cambios de modelo, permisos o plataforma en el PR.

## License

Brevia se publica bajo la [ISC License](../LICENSE); modelos y dependencias conservan sus propias condiciones.

## Acknowledgments

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) es el runtime central para ASR, VAD, puntuación y procesamiento de hablantes locales, bajo [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE). Gracias a sus autores, a Electron, ONNX Runtime, Python y la comunidad de voz libre.
