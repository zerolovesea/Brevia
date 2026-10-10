<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>Concéntrate en la conversación. Conserva las notas.</strong><br />Graba en el ordenador o en el móvil y convierte las conversaciones en transcripciones, decisiones y tareas con IA local.</p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>Español</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><img src="assets/demo/ai-assist-en.gif" width="820" alt="Brevia desktop demo (English)" /></p>

## Descargar

| Dispositivo               | Obtener Brevia                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| macOS 14+ · Apple Silicon | [DMG](https://github.com/zerolovesea/Brevia/releases/latest) · `arm64.dmg`                                                      |
| Windows · x64             | [Instalador](https://github.com/zerolovesea/Brevia/releases/latest) · `x64-setup.exe`                                           |
| Android 7+                | [Descargar APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk)                  |
| iPhone · iOS 15+          | App Store: en revisión. TestFlight solo con invitación. [Estado de publicación](https://github.com/zerolovesea/Brevia/releases) |

## Qué puedes hacer

### Notas de IA siempre revisables

Las notas de IA siguen la transcripción en vivo y señalan decisiones, tareas, cifras clave, riesgos, preguntas y cambios de tema. Elige entre activarlas bajo demanda, recibir avisos suaves u organizar automáticamente. Las sugerencias siempre se revisan: añade solo las útiles a tus notas y edítalas en texto enriquecido o Markdown.

### Pantalla de reunión silenciosa con transcripción y traducción en vivo

Ábrelo, pulsa grabar y observa los subtítulos aparecer. Brevia captura el micrófono y el audio del sistema a la vez, de modo que ambas partes de una llamada remota quedan en la misma transcripción. La traducción en vivo opcional se muestra junto al flujo de subtítulos para conversaciones multilingües.

![Reunión y traducción en vivo](assets/tour/en/%E5%AE%9E%E6%97%B6%E4%BC%9A%E8%AE%AE%E5%92%8C%E7%BF%BB%E8%AF%91.png)

### 30+ idiomas de transcripción y resúmenes de reuniones

Brevia transcribe voz en más de 30 idiomas — inglés, chino, japonés, coreano, francés, alemán, español, ruso, árabe, tailandés, vietnamita, indonesio y más. Al terminar la reunión, conecta cualquier proveedor de LLM y Brevia redactará el resumen, decisiones clave y tareas a partir de tu transcripción revisada.

### Identificación de hablantes después de la reunión

Graba una breve muestra de voz de cada participante. Una vez terminada la reunión, Brevia distingue a los hablantes durante el refinamiento y los compara con los perfiles de voz guardados para añadir sus nombres a la transcripción. Los subtítulos en directo no distinguen a los hablantes. Los perfiles de voz se pueden reutilizar en otras reuniones.

Con segmentación Pyannote más modelos de embeddings de voz, todo ejecutándose en el dispositivo.

![Identificación de hablantes después de la reunión](assets/tour/en/%E6%B3%A8%E5%86%8C%E5%A3%B0%E7%BA%B9%E8%AF%86%E5%88%AB.png)

### Y más

- **Importación de audio** — trae grabaciones existentes para transcribirlas offline con el mismo pipeline.
- **Exportaciones versátiles** — transcripciones y notas en Markdown, TXT, JSON, SRT, DOCX o PDF; audio en WAV.
- **Notas revisables** — escribe en texto enriquecido o Markdown y acepta solo las sugerencias de IA que te sirvan.
- **Biblioteca y espacios de trabajo** — busca títulos, transcripciones, hablantes y etiquetas; organiza las reuniones en espacios y restaura las eliminadas durante 30 días.
- **Vista centrada** — temas claro y oscuro, edición en línea de transcripciones y resúmenes, y una ventana opcional de subtítulos flotantes mantienen despejada la reunión.
- **Interfaz multilingüe** — inglés, chino simplificado, español, japonés, coreano, francés, alemán y ruso.

## Modelos compatibles

Descarga modelos de voz, notas IA y traducción desde **Ajustes → Biblioteca de modelos** según tus necesidades. Los modelos de actividad de voz y hablantes vienen incluidos. Todos se ejecutan en el ordenador; el móvil no necesita descargarlos. Consulta variantes y tamaños en la aplicación.

| Uso                      | Modelo                    | Idiomas / función                                      |
| ------------------------ | ------------------------- | ------------------------------------------------------ |
| Transcripción / revisión | FunASR Nano               | Chino, cantonés, inglés                                |
| Transcripción / revisión | Qwen3-ASR 0.6B            | 30 idiomas, incluidos chino, inglés, japonés y coreano |
| Transcripción / revisión | Parakeet TDT 0.6B v3      | 25 idiomas europeos                                    |
| Notas IA / resúmenes     | Qwen 3.5 2B / 4B          | Chino / inglés                                         |
| Traducción de subtítulos | Tencent Hy-MT2 1.8B       | Traducción multilingüe                                 |
| Actividad de voz         | Silero VAD                | Detectar voz y pausas                                  |
| Separación de hablantes  | Pyannote Segmentation 3.0 | Separar hablantes después de la reunión                |
| Perfiles de voz          | 3D-Speaker ERes2Net Base  | Comparar perfiles guardados                            |

## Graba con el móvil

[**Descargar APK para Android**](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) · iPhone: App Store en revisión; TestFlight por invitación ([Novedades de publicación](https://github.com/zerolovesea/Brevia/releases))

Lleva Brevia a reuniones, entrevistas y conversaciones cotidianas. Abre la aplicación y graba sin crear una cuenta. Conecta tu propio ordenador para seguir la transcripción y las notas mientras grabas.

<p align="center">
  <img src="assets/mobile/en/02-connect.png" width="240" alt="Brevia iPhone: computer connection (English)" />
  <img src="assets/mobile/en/01-record.png" width="240" alt="Brevia iPhone: offline recording setup (English)" />
  <img src="assets/mobile/en/03-transcript.png" width="240" alt="Brevia mobile: live transcript with demo content (English)" />
</p>

- **Graba donde estés.** Sin emparejamiento ni internet: pausa, continúa y marca momentos importantes. El audio queda en el móvil hasta que eliges un ordenador y confirmas la subida para transcribirlo.
- **El móvil capta; el ordenador organiza.** Tras emparejarlos, el ordenador reconoce la voz y devuelve transcripciones y notas en directo. Los modelos y los ajustes de IA permanecen en el ordenador; no necesitas descargar modelos grandes al móvil.
- **Escucha y comparte después.** Busca grabaciones en la biblioteca, vuelve a escuchar la conversación, exporta audio WAV o comparte notas en Markdown y transcripciones como texto. Borrar la copia del móvil no borra la reunión del ordenador.

Si se pierde la red, el audio sigue guardándose en el móvil y las subidas autorizadas se reanudan al reconectar. Se admite grabación en segundo plano, pero las llamadas, el cierre forzado y las restricciones del sistema pueden interrumpirla. Comprueba el estado al volver; las subidas posteriores pueden necesitar la aplicación abierta.

## Cómo se conectan el móvil y el ordenador

En la red local, el móvil envía audio mediante **HTTPS** al ordenador emparejado y recibe transcripciones y notas. Guarda el audio primero en el teléfono y avanza la posición de subida solo cuando el ordenador confirma que lo ha guardado. Tras una desconexión, continúa desde esa posición; subir el audio no elimina la copia del teléfono.

Con un servicio propio de señalización/TURN, los dispositivos ya emparejados pueden comunicarse entre redes mediante **WebRTC DataChannel**. Se intenta una conexión directa; si no es posible, un servidor retransmite tráfico cifrado. El operador puede ver direcciones de red y volumen de tráfico, pero no leer el contenido cifrado a través del relay. [La conexión entre redes requiere configuración adicional; el primer emparejamiento se hace en la red local.](mobile-remote.md)

El reconocimiento de voz se realiza en tu ordenador. Las grabaciones sin conexión permanecen en el móvil hasta que confirmas la subida; la transcripción en directo envía audio al ordenador emparejado. Brevia no envía automáticamente reuniones al desarrollador. Con los modelos descargados puedes usar IA local; si eliges un proveedor de IA en línea, recibe el texto pertinente, no el audio. Las conexiones remotas opcionales pueden retransmitir tráfico cifrado. [Privacidad](https://brevia.work/privacy.html).

El audio del móvil ocupa unos **115 MB por hora grabada**, sin contar exportaciones y cachés. Las subidas remotas también consumen datos y tráfico adicional del protocolo.

## Primeros pasos

1. Instala Brevia en el ordenador, concede los permisos de audio y descarga el modelo de voz sugerido. Para notas sin conexión, elige también un modelo de IA local.
2. Inicia una reunión o importa audio; revisa y exporta los resultados.
3. Para conectar el móvil, usa la misma Wi-Fi. En el ordenador abre **Ajustes → Conexión de dispositivos → Conectar nuevo dispositivo**. Escanea el QR o introduce la dirección y el PIN, compara el código de verificación y autoriza en el ordenador.

## FAQ

<details>
<summary><strong>Windows muestra un aviso de Microsoft Defender SmartScreen</strong></summary>

Los builds de release no están firmados con un certificado de firma de código de pago, y SmartScreen bloquea por defecto los ejecutables recién vistos. Haz clic en **"Más información" → "Ejecutar de todas formas"** tras confirmar que la descarga provino de la página oficial de [Releases](https://github.com/zerolovesea/Brevia/releases).

</details>

<details>
<summary><strong>¿Necesito instalar Python por separado?</strong></summary>

No. Los builds de release incluyen el runtime Python y todas las dependencias. Solo necesitas Python para ejecutar desde el código fuente.

</details>

<details>
<summary><strong>¿Cuánto espacio en disco requieren los modelos?</strong></summary>

Empieza por el modelo de voz recomendado para tu idioma; añade modelos locales de IA y traducción solo si los necesitas. La biblioteca muestra el tamaño de cada descarga. No es necesario instalarlos todos.

</details>

## Ayuda y contribuciones

[GitHub Issues](https://github.com/zerolovesea/Brevia/issues) — Informa de problemas indicando la versión, el dispositivo y los pasos para reproducirlos; elimina contenido privado y credenciales de capturas y registros.

[Desarrollo (inglés)](DEVELOPMENT.md) · [Desarrollo móvil (chino)](../mobile/README.md) · [CONTRIBUTING](../CONTRIBUTING.md).

## Licencia

Brevia se publica bajo la [ISC License](../LICENSE). Los archivos de modelos y paquetes de terceros mantienen sus propias licencias y términos.

## Agradecimientos

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — el runtime local que impulsa ASR, VAD, puntuación y procesamiento de hablantes. Licenciado bajo [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE).
- Gracias a los autores y mantenedores de modelos cuyos artefactos descargables se declaran en [`backend/models.json`](../backend/models.json), incluyendo Qwen3-ASR, FunASR, Parakeet (NeMo), Pyannote, 3D-Speaker, Silero y Tencent Hy-MT2.
- Electron, ONNX Runtime, Python y la comunidad open-source de voz hacen posible este flujo local.
