<h1 align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></h1>

<p align="center"><strong>Concentrez-vous sur la conversation. Gardez l’essentiel.</strong><br />Un assistant de réunion IA qui privilégie le traitement local. Enregistrez, transcrivez et traduisez vos échanges, puis retrouvez vos notes et actions dans l’audio d’origine.</p>

<p align="center"><a href="README.en.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <strong>Français</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

![Brevia](assets/showcase/desktop/en/live.gif)

## Télécharger

| Plateforme | Télécharger                                                                                              | Configuration                |
| ---------- | -------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Mac        | [macOS](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/Brevia-1.4.5-arm64.dmg)       | Apple Silicon · macOS 14+    |
| Windows    | [Windows](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/Brevia-1.4.5-x64-setup.exe) | Windows 10 / 11 · x64 · AVX2 |
| iPhone     | [App Store](https://apps.apple.com/app/id6819869442)                                                     | iOS 15+                      |
| Android    | [APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk)     | Android 7+                   |

[GitHub Releases](https://github.com/zerolovesea/Brevia/releases) · [brevia.work](https://brevia.work)

Vous utilisez la version Electron ? Installez une fois le paquet natif. Les réunions et modèles sont conservés ; les mises à jour suivantes passent par l’application.

## Fonctionnalités

- Enregistrez le microphone et le son du système, avec transcription, traduction, sous-titres flottants et commandes d’enregistrement.
- Identifiez les intervenants en arrière-plan pendant que les sous-titres s’affichent. Affinez ensuite la transcription, corrigez les noms et enregistrez les profils vocaux.
- Prenez des notes et laissez l’IA extraire décisions et tâches. Revenez aux propos d’origine et à l’enregistrement depuis vos notes.
- Classez les réunions par espace de travail, recherchez leur contenu et exportez en Markdown, TXT, JSON, SRT, DOCX, PDF ou WAV.
- Importez des fichiers audio ou vidéo pour les transcrire, les traduire et analyser les intervenants, y compris via un agent local.

![Brevia](assets/showcase/desktop/en/summary.gif)

## Bien démarrer

1. Installez l’application de bureau et téléchargez un modèle de transcription dans **Paramètres → Bibliothèque de modèles**.
2. Lancez une réunion avec le microphone, le son du système ou un téléphone connecté. Vous pouvez aussi importer un fichier.
3. Prenez des notes, affinez la transcription et modifiez ou exportez les résultats.

Les moteurs d’inférence sont inclus. Il n’est pas nécessaire d’installer Python ni un environnement supplémentaire. Téléchargez les modèles souhaités pour les utiliser hors ligne. FunASR, Qwen3-ASR, Parakeet, Whisper, Qwen et Hy-MT sont disponibles selon la plateforme.

## Enregistrer avec le téléphone

Enregistrez hors ligne, prenez des notes et marquez les moments importants. Dès que l’ordinateur confirme la réception, vous pouvez quitter l’application mobile : l’importation et la transcription continuent sur le bureau. Le téléphone conserve sa copie. Il peut aussi servir de microphone ou afficher les sous-titres en direct. Associez les appareils sur le même réseau local dans **Paramètres → Connexion des appareils** ; le mode direct exige que l’ordinateur reste allumé.

## Connecter un agent local

Dans **Paramètres → Agent et MCP**, copiez le message de configuration et transmettez-le à votre agent local. Il lit le Skill fourni et utilise Brevia via la CLI. Pour un client MCP, copiez la configuration MCP depuis la même page.

> Transcris l’interview sur mon bureau et enregistre-la au format SRT.
>
> Retrouve les réunions de la semaine dernière sur le lancement et liste les questions ouvertes.
>
> Commence à enregistrer cette réunion avec mon téléphone connecté.

Les agents peuvent transcrire, traduire, identifier les voix, chercher des réunions et contrôler l’enregistrement. Les tâches longues proposent suivi et annulation. Les fichiers existants ne sont pas écrasés et l’application peut démarrer en arrière-plan.

[CLI / MCP](../DEVELOPMENT.md#本机-agent-接口) · [Brevia Skill](../skills/brevia/SKILL.md)

## Vos données

Aucun compte nécessaire. Enregistrements, réunions et modèles restent sur vos appareils. La synchronisation utilise HTTPS sur le réseau local. L’IA locale fonctionne hors ligne ; si vous choisissez un service en ligne, le texte concerné lui est envoyé. [Privacy](https://brevia.work/privacy.html).

Le bureau utilise le WebView du système (WebKit sur macOS, WebView2 sur Windows), une logique commune et des moteurs natifs. L’application mobile utilise Flutter.

## Contribuer

[Issues](https://github.com/zerolovesea/Brevia/issues) · [Development](../DEVELOPMENT.md) · [Docs](README.md)

Licence ISC. Les modèles et composants tiers conservent leurs licences. Merci à Tauri, MLX, sherpa-onnx, llama.cpp, miniaudio et aux auteurs des modèles. [ISC](../LICENSE).
