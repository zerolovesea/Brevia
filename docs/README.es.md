<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>Concéntrate en la conversación. Conserva las notas.</strong><br />Graba en el ordenador o en el móvil y convierte las conversaciones en transcripciones, decisiones y tareas con IA local.</p>

<p align="center"><a href="README.en.md">English</a> · <a href="../README.md">简体中文</a> · <strong>Español</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><img src="assets/screenshots/desktop/en/live.png" width="960" alt="Brevia v1.4: live transcript and AI notes (English)" /></p>

## Descargar

| Dispositivo               | Obtener Brevia                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| macOS 14+ · Apple Silicon | [DMG](https://github.com/zerolovesea/Brevia/releases/latest) · `arm64.dmg`                                     |
| Windows · x64             | [Instalador](https://github.com/zerolovesea/Brevia/releases/latest) · `x64-setup.exe`                          |
| Android 7+                | [Descargar APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk) |
| iPhone · iOS 15+          | [App Store](https://apps.apple.com/app/id6819869442)                                                           |

<table align="center">
  <tr><th><a href="https://apps.apple.com/app/id6819869442">iPhone · App Store</a></th><th><a href="https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk">Android · APK</a></th></tr>
  <tr>
    <td align="center"><a href="https://apps.apple.com/app/id6819869442"><img src="assets/download/ios-qr.png" width="160" alt="iPhone · App Store QR" /></a></td>
    <td align="center"><a href="https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk"><img src="assets/download/android-qr.png" width="160" alt="Android · APK QR" /></a></td>
  </tr>
</table>

Escanea para descargar en el teléfono.

Escritorio v1.4.2 (17 de octubre de 2026). Versiones móviles verificadas el 15 de octubre de 2026: Android 1.0.1 e iOS 1.0.0. Las capturas del teléfono muestran la interfaz 1.0.1; la actualización de iOS aún no es pública.

## Novedades de v1.4

Nueva interfaz en ordenador y móvil: notas junto a la transcripción, biblioteca por espacios de trabajo y acceso directo a transcripción, notas y resumen. También puedes usar un teléfono conectado como micrófono del ordenador.

![Biblioteca de reuniones](assets/screenshots/desktop/en/library.png)

<details>
<summary>Resumen editable con decisiones y tareas</summary>

![Resumen editable con decisiones y tareas](assets/screenshots/desktop/en/summary.png)

</details>

## Qué puedes hacer

### Notas de IA siempre revisables

Las notas de IA siguen la transcripción en vivo y señalan decisiones, tareas, cifras clave, riesgos, preguntas y cambios de tema. Elige entre activarlas bajo demanda, recibir avisos suaves u organizar automáticamente. Las sugerencias siempre se revisan: añade solo las útiles a tus notas y edítalas en texto enriquecido o Markdown.

### Pantalla de reunión silenciosa con transcripción y traducción en vivo

Ábrelo, pulsa grabar y observa los subtítulos aparecer. Brevia captura el micrófono y el audio del sistema a la vez, de modo que ambas partes de una llamada remota quedan en la misma transcripción. La traducción en vivo opcional se muestra junto al flujo de subtítulos para conversaciones multilingües.

![Reunión y traducción en vivo](assets/screenshots/desktop/en/live.png)

### 30+ idiomas de transcripción y resúmenes de reuniones

Brevia transcribe voz en más de 30 idiomas — inglés, chino, japonés, coreano, francés, alemán, español, ruso, árabe, tailandés, vietnamita, indonesio y más. Al terminar la reunión, conecta cualquier proveedor de LLM y Brevia redactará el resumen, decisiones clave y tareas a partir de tu transcripción revisada.

### Identificación de hablantes después de la reunión

Graba una breve muestra de voz de cada participante. Una vez terminada la reunión, Brevia distingue a los hablantes durante el refinamiento y los compara con los perfiles de voz guardados para añadir sus nombres a la transcripción. Los subtítulos en directo no distinguen a los hablantes. Los perfiles de voz se pueden reutilizar en otras reuniones.

Con segmentación Pyannote más modelos de embeddings de voz, todo ejecutándose en el dispositivo.

![Identificación de hablantes después de la reunión](assets/screenshots/desktop/en/voiceprints.png)

### Y más

- **Importación de audio** — trae grabaciones existentes para transcribirlas offline con el mismo pipeline.
- **Exportaciones versátiles** — transcripciones y notas en Markdown, TXT, JSON, SRT, DOCX o PDF; audio en WAV.
- **Notas revisables** — escribe en texto enriquecido o Markdown y acepta solo las sugerencias de IA que te sirvan.
- **Biblioteca y espacios de trabajo** — busca títulos, transcripciones, hablantes y etiquetas; organiza las reuniones en espacios y restaura las eliminadas durante 30 días.
- **Vista centrada** — temas claro y oscuro, edición en línea de transcripciones y resúmenes, y una ventana opcional de subtítulos flotantes mantienen despejada la reunión.
- **Interfaz multilingüe** — inglés, chino simplificado, español, japonés, coreano, francés, alemán y ruso.

## Modelos compatibles

Descarga modelos de voz, notas IA y traducción desde **Ajustes → Biblioteca de modelos** según tus necesidades. Los modelos de actividad de voz y hablantes vienen incluidos. Todos se ejecutan en el ordenador; el móvil no necesita descargarlos. Consulta variantes y tamaños en la aplicación.

| Uso                      | Modelo                                  | Idiomas / función                                      |
| ------------------------ | --------------------------------------- | ------------------------------------------------------ |
| Transcripción / revisión | FunASR Nano                             | Chino, cantonés, inglés                                |
| Transcripción / revisión | Qwen3-ASR 0.6B                          | 30 idiomas, incluidos chino, inglés, japonés y coreano |
| Revisión (opcional)      | Qwen3-ASR 1.7B / Whisper Large v3 Turbo | Varios idiomas; solo Mac con Apple Silicon             |
| Transcripción / revisión | Parakeet TDT 0.6B v3                    | 25 idiomas europeos                                    |
| Notas IA / resúmenes     | Qwen 3.5 2B / 4B                        | Chino / inglés                                         |
| Traducción de subtítulos | Tencent Hy-MT2 1.8B                     | Traducción multilingüe                                 |
| Actividad de voz         | Silero VAD                              | Detectar voz y pausas                                  |
| Separación de hablantes  | Pyannote Segmentation 3.0               | Separar hablantes después de la reunión                |
| Perfiles de voz          | 3D-Speaker ERes2Net Base                | Comparar perfiles guardados                            |

## Graba con el móvil

[**iPhone · App Store**](https://apps.apple.com/app/id6819869442) · [**Android · APK**](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk)

Lleva Brevia a reuniones, entrevistas y conversaciones cotidianas. Abre la aplicación y graba sin crear una cuenta. Conecta tu propio ordenador para seguir la transcripción y las notas mientras grabas.

<p align="center">
  <img src="assets/screenshots/mobile/en/connection.png" width="240" alt="Brevia iPhone: computer connection (English)" />
  <img src="assets/screenshots/mobile/en/offline.png" width="240" alt="Brevia: offline phone recording (English)" />
  <img src="assets/screenshots/mobile/en/live.png" width="240" alt="Brevia mobile: live transcript (English)" />
</p>

<p align="center"><sub>Interfaz móvil</sub></p>

### Micrófono del teléfono

En una reunión nueva del ordenador, elige **Phone microphone**, comprueba el nivel de entrada y controla el inicio, pausa, reanudación y fin desde el ordenador. Requiere una app móvil compatible, conectada y en primer plano. La transcripción y las notas de estas reuniones permanecen en el ordenador; las reuniones iniciadas en el teléfono reciben el texto de vuelta.

![Micrófono del teléfono](assets/screenshots/desktop/en/phone-microphone.png)

- **Graba donde estés.** Sin emparejamiento ni internet: pausa, continúa y marca momentos importantes. El audio queda en el móvil hasta que eliges un ordenador y confirmas la subida para transcribirlo.
- **El móvil capta; el ordenador organiza.** Tras emparejarlos, el ordenador reconoce la voz y devuelve transcripciones y notas en directo. Los modelos y los ajustes de IA permanecen en el ordenador; no necesitas descargar modelos grandes al móvil.
- **Escucha y comparte después.** Busca grabaciones en la biblioteca, vuelve a escuchar la conversación, exporta audio WAV o comparte notas en Markdown y transcripciones como texto. Borrar la copia del móvil no borra la reunión del ordenador.

Si se pierde la red, el audio sigue guardándose en el móvil y las subidas autorizadas se reanudan al reconectar. Se admite grabación en segundo plano, pero las llamadas, el cierre forzado y las restricciones del sistema pueden interrumpirla. Comprueba el estado al volver; las subidas posteriores pueden necesitar la aplicación abierta.

## Cómo se conectan el móvil y el ordenador

En la red local, el móvil envía audio mediante **HTTPS** al ordenador emparejado y recibe transcripciones y notas. Guarda el audio primero en el teléfono y avanza la posición de subida solo cuando el ordenador confirma que lo ha guardado. Tras una desconexión, continúa desde esa posición; subir el audio no elimina la copia del teléfono.

El reconocimiento de voz se realiza en tu ordenador. Las grabaciones sin conexión permanecen en el móvil hasta que confirmas la subida; la transcripción en directo envía audio al ordenador emparejado. Brevia no envía automáticamente reuniones al desarrollador. Con los modelos descargados puedes usar IA local; si eliges un proveedor de IA en línea, recibe el texto pertinente, no el audio. [Privacidad](https://brevia.work/privacy.html).

El audio del móvil ocupa unos **115 MB por hora grabada**, sin contar exportaciones y cachés. Las subidas y la transcripción en directo requieren que el móvil y el ordenador estén en la misma red local.

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

[Desarrollo móvil (chino)](../mobile/README.md) · [CONTRIBUTING](../CONTRIBUTING.md).

## Licencia

Brevia se publica bajo la [ISC License](../LICENSE). Los archivos de modelos y paquetes de terceros mantienen sus propias licencias y términos.

## Agradecimientos

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — el runtime local que impulsa ASR, VAD, puntuación y procesamiento de hablantes. Licenciado bajo [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE).
- Gracias a los autores y mantenedores de modelos cuyos artefactos descargables se declaran en [`backend/models.json`](../backend/models.json), incluyendo Qwen3-ASR, FunASR, Parakeet (NeMo), Pyannote, 3D-Speaker, Silero y Tencent Hy-MT2.
- Electron, ONNX Runtime, Python y la comunidad open-source de voz hacen posible este flujo local.
