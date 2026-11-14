<h1 align="center"><img src="assets/brevia-hero.gif" width="100%" alt="Brevia" /></h1>

<p align="center"><strong>Concéntrate en la conversación. Conserva lo importante.</strong><br />Un asistente de reuniones con IA que prioriza tus dispositivos. Graba, transcribe y traduce conversaciones; conviértelas en notas y acciones vinculadas al audio original.</p>

<p align="center">
  <a href="https://github.com/zerolovesea/Brevia/releases/latest"><img src="https://img.shields.io/github/v/release/zerolovesea/Brevia?style=flat-square" alt="Latest release" /></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/License-ISC-blue?style=flat-square" alt="ISC License" /></a>
  <a href="https://github.com/zerolovesea/Brevia/releases"><img src="https://img.shields.io/github/downloads/zerolovesea/Brevia/total?style=flat-square" alt="GitHub downloads" /></a>
  <a href="https://github.com/zerolovesea/Brevia/stargazers"><img src="https://img.shields.io/github/stars/zerolovesea/Brevia?style=flat-square" alt="GitHub stars" /></a>
</p>

<p align="center"><a href="README.en.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>Español</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

![Brevia](assets/showcase/desktop/en/live.gif)

## Descargar

| Plataforma | Descarga                                                                                             | Requisitos                   |
| ---------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| Mac        | [macOS][download-mac]                                                                                | Apple Silicon · macOS 14+    |
| Windows    | [Windows][download-windows] · [CUDA](https://brevia.work)                                            | Windows 10 / 11 · x64 · AVX2 |
| Linux      | [CPU · CUDA](https://brevia.work)                                                                    | Ubuntu 24.04 · x86-64 · AVX2 |
| iPhone     | [App Store](https://apps.apple.com/app/id6819869442)                                                 | iOS 15+                      |
| Android    | [APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) | Android 7+                   |

[download-mac]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.3/Brevia-WebKit-2.0.3-arm64.dmg
[download-windows]: https://github.com/zerolovesea/Brevia/releases/download/v2.0.3/Brevia-2.0.3-x64-setup.exe

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases) · [brevia.work](https://brevia.work)

El instalador ocupa unos 43 MiB (45,5 MB) en Mac y 38 MB en Windows. Los modelos de idioma se descargan por separado.

> Windows y Linux ofrecen instaladores para CPU y NVIDIA CUDA. La transcripción utiliza MLX en macOS y Linux, y sherpa-onnx en Windows.

## Qué puedes hacer

- Graba el micrófono y el audio del sistema, con transcripción, traducción, subtítulos flotantes y controles de grabación.
- Identifica hablantes en segundo plano mientras aparecen los subtítulos. Después puedes refinar el texto, corregir nombres y guardar perfiles de voz.
- **Transcripción rápida:** En un M4 Pro, Brevia transcribió una grabación de **66 min 40 s** en **3 min 33 s**.
- Organiza reuniones en espacios de trabajo, busca su contenido y exporta Markdown, TXT, JSON, SRT, DOCX, PDF o WAV.
- Importa audio y vídeo para transcribir, traducir y analizar hablantes, también mediante tu agente local.

### Acta y diagrama de espina de pescado

[![Acta y diagrama de espina de pescado con referencias a la grabación](assets/showcase/desktop/en/summary.png)](assets/showcase/desktop/en/summary.gif)

El acta tiene siete secciones. El diagrama de causas permite comprobar las citas y escuchar la grabación. El acta y el análisis se exportan por separado. Puedes filtrar la transcripción por hablante o cambiar su nombre en toda la reunión.

### Notas con IA

Toma notas y extrae decisiones y tareas con IA. Vuelve a las palabras originales y al audio desde las notas.

![La IA propone añadir una tarea a las notas](assets/showcase/desktop/en/ai-notes.png)

## Graba con el móvil

Graba sin conexión, toma notas y marca momentos importantes. Tras subir la grabación y recibir la confirmación del ordenador, puedes salir de la aplicación móvil: la importación y la transcripción continúan en el escritorio. El móvil conserva su copia. También puede funcionar como micrófono o mostrar subtítulos en directo. Empareja ambos dispositivos en la misma red local desde **Ajustes → Conexión de dispositivos**; el modo en directo necesita el ordenador encendido.

![Subtítulos en el teléfono y el ordenador](assets/showcase/desktop/en/phone.png)

## Cápsula de reunión

Minimiza la ventana principal para controlar la grabación o reproducción, leer subtítulos, editar notas y pegar imágenes en la cápsula. En segundo plano, Brevia puede avisarte cuando una aplicación de reuniones compatible emita sonido.

<img src="assets/showcase/desktop/en/capsule.png" width="352" alt="Cápsula con subtítulos y controles de grabación" />

## Conecta tu agente local

En **Ajustes → Agent y MCP**, copia el mensaje de configuración y entrégaselo a tu agente local. Leerá el Skill incluido y utilizará la CLI. Para clientes MCP, copia la configuración MCP de la misma página.

> Transcribe la entrevista de mi escritorio y guárdala como SRT.
>
> Busca las reuniones de la semana pasada sobre el lanzamiento y enumera las preguntas pendientes.
>
> Empieza a grabar esta reunión con el teléfono conectado.

El agente puede transcribir, traducir, identificar voces, buscar reuniones y controlar la grabación. Las tareas largas permiten consultar el progreso y cancelar. No se sobrescriben archivos existentes; Brevia puede iniciarse en segundo plano.

[CLI / MCP](../DEVELOPMENT.md#本机-agent-接口) · [Brevia Skill](../skills/brevia/SKILL.md)

![El agente guarda subtítulos SRT en español e inglés](assets/showcase/desktop/en/agent.png)

## Parámetros de la CLI

Usa `brevia MÉTODO [JSON] [--no-start]`. La ruta de la CLI está en **Ajustes → Agent & MCP**. `brevia help` enumera los métodos y `brevia status --no-start` consulta el estado sin iniciar la aplicación.

En `inference.run`, elige `transcribe` o `translate` como `operation`. Usa rutas absolutas para `input_path` y `output_path`. El idioma de origen `language` tiene el valor predeterminado `auto`. Para traducir, indica `target_language`.

```sh
brevia inference.run '{"operation":"transcribe","input_path":"/Users/me/interview.wav","language":"es","output_path":"/Users/me/interview.srt"}'
brevia task.get '{"task_id":"123e4567-e89b-42d3-a456-426614174000"}'
```

Sustituye las rutas del ejemplo y pasa el `task_id` devuelto a `task.get`. Cuando el estado sea `completed`, abre el archivo de salida. [Todos los comandos y parámetros](../DEVELOPMENT.md#本机-agent-接口)

## Primeros pasos

1. Instala la aplicación de escritorio y descarga un modelo de transcripción en **Ajustes → Biblioteca de modelos**.
2. Inicia una reunión con el micrófono, el audio del sistema o un teléfono conectado; también puedes importar un archivo.
3. Toma notas, refina la transcripción y edita o exporta los resultados.

En macOS 14.4 y posteriores, la grabación del audio del sistema solo necesita permiso de audio, sin acceso a la pantalla. macOS 14.0–14.3 sigue usando el permiso de pantalla y audio del sistema. Si denegaste el acceso, actívalo de nuevo en Ajustes del Sistema.

Los motores de inferencia vienen incluidos. No necesitas instalar Python ni un entorno de inferencia adicional. En Windows, el instalador descarga WebView2 solo si falta. Descarga los modelos que elijas y úsalos sin conexión. La biblioteca incluye FunASR, Qwen3-ASR, Parakeet, Whisper, Qwen y Hy-MT, según la plataforma.

## Tus datos

No requiere cuenta. Grabaciones, reuniones y modelos se guardan en tus dispositivos. La sincronización usa HTTPS local. La IA local funciona sin conexión; si eliges un proveedor en línea, se le enviará el texto correspondiente. [Privacy](https://brevia.work/privacy.html).

## Tecnologías

El escritorio usa el WebView del sistema (WebKit en macOS y WebView2 en Windows), lógica compartida y motores nativos. El móvil usa Flutter. Brevia usa Tauri y Rust en el escritorio, SQLite para guardar los datos de las reuniones, sherpa-onnx para procesar la voz y llama.cpp para generar las actas.

## Participar

[Issues](https://github.com/zerolovesea/Brevia/issues) · [Development](../DEVELOPMENT.md) · [Docs](README.md)

Licencia ISC. Los modelos y componentes externos conservan sus licencias. Gracias a Tauri, MLX, sherpa-onnx, llama.cpp, miniaudio y a los autores de los modelos. [ISC](../LICENSE).
