<p align="center"><img src="assets/brevia-mark.svg" width="258" alt="Brevia" /></p>

<p align="center"><strong>Restez dans la conversation. Gardez les notes.</strong><br />Enregistrez sur ordinateur ou téléphone et transformez vos échanges en transcriptions, décisions et actions avec une IA locale.</p>

<p align="center"><a href="README.en.md">English</a> · <a href="../README.md">简体中文</a> · <a href="README.es.md">Español</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <strong>Français</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><img src="assets/showcase/desktop/en/live.gif" width="960" alt="Brevia: live transcript and AI notes (English)" /></p>

## Télécharger

| Appareil                  | Obtenir Brevia                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| macOS 14+ · Apple Silicon | [DMG](https://github.com/zerolovesea/Brevia/releases/download/v1.4.4/Brevia-1.4.4-arm64.dmg)                          |
| Windows · x64             | [Programme d’installation](https://github.com/zerolovesea/Brevia/releases/download/v1.4.4/Brevia-1.4.4-x64-setup.exe) |
| Android 7+                | [Télécharger l’APK](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk)    |
| iPhone · iOS 15+          | [App Store](https://apps.apple.com/app/id6819869442)                                                                  |

<table align="center">
  <tr><th><a href="https://apps.apple.com/app/id6819869442">iPhone · App Store</a></th><th><a href="https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk">Android · APK</a></th></tr>
  <tr>
    <td align="center"><a href="https://apps.apple.com/app/id6819869442"><img src="assets/download/ios-qr.png" width="160" alt="iPhone · App Store QR" /></a></td>
    <td align="center"><a href="https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk"><img src="assets/download/android-qr.png" width="160" alt="Android · APK QR" /></a></td>
  </tr>
</table>

Scannez pour télécharger sur votre téléphone.

## Nouveautés de la version 1.4

Une nouvelle interface sur ordinateur et téléphone : notes à côté de la transcription, bibliothèque par espaces de travail et accès aux notes, à la transcription et au résumé. Un téléphone connecté peut aussi servir de microphone à l’ordinateur.

![Nouvelle bibliothèque de réunions](assets/showcase/desktop/en/library.gif)

### Résumé modifiable avec décisions et actions

![Résumé modifiable avec décisions et actions](assets/showcase/desktop/en/summary.gif)

## Ce que vous pouvez faire

### Des notes IA toujours verifiables

Les notes IA suivent la transcription en direct et peuvent signaler decisions, actions, chiffres cles, risques, questions et changements de sujet. Choisissez l'activation a la demande, des suggestions discretes ou l'organisation automatique. Chaque suggestion reste verifiable : ajoutez seulement les utiles a vos notes et continuez a ecrire en texte enrichi ou Markdown.

### Un ecran de reunion discret avec transcription et traduction en direct

Ouvrez l'application, appuyez sur enregistrer, et regardez les sous-titres apparaitre. Brevia capture simultanement votre microphone et l'audio systeme, si bien que les deux cotes d'un appel distant se retrouvent dans la meme transcription. La traduction en direct optionnelle s'affiche a cote du flux de sous-titres pour les conversations multilingues.

![Reunion et traduction en direct](assets/showcase/desktop/en/live.gif)

### Plus de 30 langues de transcription et des resumes de reunion

Brevia transcrit la parole dans plus de 30 langues — anglais, chinois, japonais, coreen, francais, allemand, espagnol, russe, arabe, thai, vietnamien, indonesien et plus. Une fois la reunion terminee, branchez n'importe quel fournisseur LLM et Brevia redigera le resume, les decisions cles et les taches a partir de votre transcription verifiee.

### Identification des intervenants après la réunion

Enregistrez un court échantillon vocal pour chaque membre. Après la réunion, Brevia distingue les intervenants lors de la révision de la transcription et les associe aux profils vocaux enregistrés pour afficher leurs noms. Les sous-titres en direct ne distinguent pas les intervenants. Les profils vocaux sont réutilisables entre les réunions.

Propulse par la segmentation Pyannote plus les modeles d'embeddings de locuteur, le tout s'executant sur l'appareil.

### Et plus encore

- **Corrections par lot** — prévisualisez et sélectionnez les remplacements dans les transcriptions, notes et résumés, avec annulation ; pendant l’enregistrement, appliquez des règles aux sous-titres suivants de la réunion.
- **Import audio** — apportez des enregistrements existants pour une transcription hors ligne via le meme pipeline.
- **Exports riches** — transcriptions et notes en Markdown, TXT, JSON, SRT, DOCX ou PDF ; audio en WAV.
- **Notes verifiables** — ecrivez en texte enrichi ou Markdown et acceptez seulement les suggestions IA utiles.
- **Bibliotheque et espaces de travail** — recherchez titres, transcriptions, intervenants et etiquettes ; classez les reunions dans des espaces et restaurez celles supprimees pendant 30 jours.
- **Vue concentree** — themes clair et sombre, edition en ligne des transcriptions et resumes, et fenetre optionnelle de sous-titres flottants gardent l'ecran de reunion epure.
- **Interface multilingue** — anglais, chinois simplifie, espagnol, japonais, coreen, francais, allemand et russe.

## Modèles pris en charge

Téléchargez les modèles vocaux, de notes IA et de traduction dans **Réglages → Bibliothèque de modèles** selon vos besoins. Les modèles de détection vocale et des intervenants sont inclus. Tous fonctionnent sur l’ordinateur ; aucun téléchargement de modèle sur le téléphone n’est nécessaire. Les variantes et tailles sont indiquées dans l’application.

| Usage                       | Modèle                                  | Langues / fonction                                    |
| --------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Transcription / révision    | FunASR Nano                             | Chinois, cantonais, anglais                           |
| Transcription / révision    | Qwen3-ASR 0.6B                          | 30 langues, dont chinois, anglais, japonais et coréen |
| Révision (facultative)      | Qwen3-ASR 1.7B / Whisper Large v3 Turbo | Multilingue ; Mac avec Apple Silicon uniquement       |
| Transcription / révision    | Parakeet TDT 0.6B v3                    | 25 langues européennes                                |
| Notes IA / résumés          | Qwen 3.5 2B / 4B                        | Chinois / anglais                                     |
| Traduction des sous-titres  | Tencent Hy-MT2 1.8B                     | Traduction multilingue                                |
| Activité vocale             | Silero VAD                              | Détecter la parole et les pauses                      |
| Séparation des intervenants | Pyannote Segmentation 3.0               | Distinguer les intervenants après la réunion          |
| Profils vocaux              | 3D-Speaker ERes2Net Base                | Comparer les profils enregistrés                      |

## Enregistrer avec le téléphone

[**iPhone · App Store**](https://apps.apple.com/app/id6819869442) · [**Android · APK**](https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/Brevia-android.apk)

Emportez Brevia en réunion, en entretien ou dans vos échanges du quotidien. Ouvrez l’application et enregistrez sans créer de compte. Connectez votre propre ordinateur pour suivre la transcription et les notes pendant l’enregistrement.

<p align="center">
  <img src="assets/showcase/mobile/en/library.png" width="240" alt="Brevia phone meeting library (English)" />
  <img src="assets/showcase/mobile/en/offline.png" width="240" alt="Brevia: offline phone recording (English)" />
  <img src="assets/showcase/mobile/en/live.png" width="240" alt="Brevia mobile: live transcript (English)" />
</p>

### Le téléphone comme microphone

Dans une nouvelle réunion sur ordinateur, choisissez **Phone microphone**, vérifiez le niveau audio et contrôlez le démarrage, la pause, la reprise et l’arrêt depuis l’ordinateur. L’application mobile compatible doit être connectée et prête au premier plan. La transcription et les notes de ces réunions restent sur l’ordinateur ; les réunions lancées sur le téléphone reçoivent le texte en retour.

![Le téléphone comme microphone](assets/showcase/desktop/en/phone-microphone.gif)

- **Enregistrez où vous voulez.** Aucun jumelage ni accès à internet nécessaire : mettez en pause, reprenez et marquez les moments importants. L’audio reste sur le téléphone jusqu’au choix d’un ordinateur et à votre confirmation du transfert pour transcription.
- **Le téléphone capte, l’ordinateur organise.** Une fois jumelé, l’ordinateur reconnaît la parole et renvoie transcriptions et notes en direct. Les modèles et réglages IA restent sur l’ordinateur ; aucun gros modèle à télécharger sur le téléphone.
- **Réécoutez et partagez.** Retrouvez les enregistrements dans la bibliothèque, réécoutez les échanges, exportez l’audio en WAV ou partagez les notes en Markdown et les transcriptions en texte. Supprimer la copie du téléphone n’efface pas la réunion sur l’ordinateur.

En cas de coupure réseau, l’audio continue à être sauvegardé sur le téléphone et les transferts autorisés reprennent à la reconnexion. L’enregistrement en arrière-plan est pris en charge, mais les appels, l’arrêt forcé et les restrictions système peuvent l’interrompre. Vérifiez l’état à votre retour ; les transferts après enregistrement peuvent nécessiter de garder l’application ouverte.

## Comment le téléphone et l’ordinateur communiquent

Sur le réseau local, le téléphone envoie l’audio par **HTTPS** à l’ordinateur jumelé, qui renvoie transcriptions et notes. L’audio est d’abord enregistré sur le téléphone ; la progression du transfert n’avance qu’après confirmation de sa sauvegarde par l’ordinateur. Après une coupure, le transfert reprend à cette position. La copie du téléphone n’est pas supprimée automatiquement.

La reconnaissance vocale s’effectue sur votre ordinateur. Les enregistrements hors ligne restent sur le téléphone jusqu’à votre confirmation ; la transcription en direct envoie l’audio à l’ordinateur jumelé. Brevia n’envoie pas automatiquement vos réunions au développeur. Après téléchargement des modèles, vous pouvez utiliser une IA locale. Un fournisseur IA en ligne choisi par vos soins reçoit le texte pertinent, pas l’audio. [Confidentialité](https://brevia.work/privacy.html).

## Bien démarrer

1. Installez Brevia sur l’ordinateur, accordez les autorisations audio et téléchargez le modèle vocal suggéré. Choisissez aussi un modèle IA local pour les notes hors ligne.
2. Lancez une réunion ou importez un enregistrement, puis vérifiez et exportez les résultats.
3. Pour connecter le téléphone, utilisez le même Wi-Fi. Sur ordinateur, ouvrez **Réglages → Connexion des appareils → Connecter un nouvel appareil**. Scannez le QR ou saisissez l’adresse et le PIN, comparez le code de vérification et autorisez la connexion sur l’ordinateur.

## Architecture

- **Ordinateur :** Electron et JavaScript, avec HTML et Tailwind CSS pour l’interface.
- **Traitement local :** Un worker Python coordonne l’audio et les modèles ; MLX / sherpa-onnx traitent la parole et llama.cpp exécute l’IA locale.
- **Mobile :** Flutter et Dart partagent l’interface et le parcours d’enregistrement entre iOS et Android.
- **Stockage et synchronisation :** SQLite conserve les réunions sur l’ordinateur ; les appareils se synchronisent en HTTPS sur le réseau local.

## FAQ

### Windows affiche un avertissement Microsoft Defender SmartScreen

Les builds de release ne sont pas signes avec un certificat de signature de code payant, et SmartScreen bloque par defaut les executables recemment observes. Cliquez sur **« Informations complementaires » → « Executer quand meme »** apres avoir confirme que le telechargement provient de la page officielle [Releases](https://github.com/zerolovesea/Brevia/releases).

### Dois-je installer Python separement ?

Non. Les builds de release integrent le runtime Python et toutes les dependances necessaires. Un environnement Python separe n'est requis que pour l'execution depuis les sources.

### Quel espace disque les modeles necessitent-ils ?

Commencez par le modèle vocal recommandé pour votre langue. Ajoutez les modèles IA et de traduction selon vos besoins. La bibliothèque indique les tailles de téléchargement ; inutile de tout installer.

## Aide et contributions

[GitHub Issues](https://github.com/zerolovesea/Brevia/issues) — Signalez les problèmes avec la version, l’appareil et les étapes de reproduction ; retirez les informations privées et identifiants des captures et journaux.

[Développement mobile (chinois)](../mobile/README.md) · [CONTRIBUTING](../CONTRIBUTING.md).

## Licence

Brevia est publie sous la [ISC License](../LICENSE). Les fichiers de modeles et les paquets tiers conservent leurs propres licences et conditions.

## Remerciements

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — le runtime local propulsant ASR, VAD, ponctuation et traitement des locuteurs. Sous licence [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE).
- Merci aux auteurs et mainteneurs des modeles dont les artefacts telechargeables sont declares dans [`backend/models.json`](../backend/models.json), incluant Qwen3-ASR, FunASR, Parakeet (NeMo), Pyannote, 3D-Speaker, Silero et Tencent Hy-MT2.
- Electron, ONNX Runtime, Python et la communaute open-source de la parole rendent ce flux local-first possible.
