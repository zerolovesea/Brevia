// 识别模型相关的本地化文案。
//
// 设计原则（对应设计文档 §2.12）：
//  1. 速度/质量用**三档刻度**表达，不做模型间比较。不写「比 X 慢」这种话——
//     用户看不懂，也不知道慢多少、值不值得。刻度让他自己权衡。
//  2. `minRamGB` 这类硬约束直接写出来（本地推理最容易踩的坑就是跑不动）。
//  3. 定位短句讲**适用场景与模型卡上的真实特点**（语言覆盖、是否自动判语种、
//     是否自带标点），不讲参数清单，也**不单列「不适合什么」**——把缺点摊开写
//     会让首启页像在劝退；语言范围写进短句，用户自己推得出来。
//  4. 不写「某某混说最稳」这类表述：这几个模型都不是为某组混说语言专门训练的，
//     写成卖点会让人以为模型按语言对定制。
//  5. 「首选」表达的是**清单里的默认模型**（`default_for_languages`），不是厂商基准排名。
//     三个可选模型都按这个口径写。产品决定（2026-09-11）：Qwen3-ASR 0.6B 的日韩一句保留
//     「首选」——它是清单里日韩的默认，也是可选模型里唯一覆盖日韩的。
//     ⚠️ 但依据只是「默认 + 唯一」，不是「更准」：Qwen 自己在 1.7B 卡上发布的多语种基准里，
//     Whisper large-v3 在含日韩的每个数据集上都优于 0.6B（CommonVoice 10.77 vs 12.75、
//     MLC-SLM 15.68 vs 15.84、Fleurs 5.27 vs 7.57、News-Multilingual 14.80 vs 17.39，
//     越低越好），而 Whisper 已被退役。这是选型遗留问题，不是文案问题。
//  6. key 一律用 model.id / asr_role 这类机器可读标识，不用数组下标——
//     下标对齐是脆弱的（见设计文档 §1.4）。
//
// 速度/质量分档的依据是 backend/bench_asr_models.py 在真实英西混说会议上的实测
// （cpu_rtf 与峰值内存，见设计文档 §2.4 与 §2.8）。

(() => {
  const LOCALES = ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'];

  // 角标：按清单里的 asr_role 枚举取值。说明「这个模型擅长什么」。
  // 三档共用同一个词根（多语种 / 多语种（欧洲）），只在地域范围上收窄——
  // 否则「多语种」和「欧洲语言」并列出现时，用户无法判断哪个覆盖更广。
  const asrRole = {
    zh: { 'zh-optimized': '中文优化', multilingual: '多语种', western: '欧洲多语种' },
    en: { 'zh-optimized': 'Chinese-optimized', multilingual: 'Multilingual', western: 'European multilingual' },
    es: { 'zh-optimized': 'Optimizado para chino', multilingual: 'Multilingüe', western: 'Multilingüe europeo' },
    ja: { 'zh-optimized': '中国語に最適化', multilingual: '多言語', western: '欧州の多言語' },
    ko: { 'zh-optimized': '중국어 최적화', multilingual: '다국어', western: '유럽 다국어' },
    fr: { 'zh-optimized': 'Optimisé pour le chinois', multilingual: 'Multilingue', western: 'Multilingue européen' },
    de: { 'zh-optimized': 'Für Chinesisch optimiert', multilingual: 'Mehrsprachig', western: 'Mehrsprachig (Europa)' },
    ru: { 'zh-optimized': 'Оптимизировано для китайского', multilingual: 'Многоязычная', western: 'Многоязычная (Европа)' },
  };

  // 三档刻度文案。speed/quality 的档位由 models.json 提供（1..3），这里只负责本地化。
  const tiers = {
    zh: { speed: ['慢', '适中', '快'], quality: ['一般', '好', '很好'], speedLabel: '速度', qualityLabel: '准确度', memoryLabel: '内存需求' },
    en: { speed: ['Slow', 'Medium', 'Fast'], quality: ['Fair', 'Good', 'Very good'], speedLabel: 'Speed', qualityLabel: 'Accuracy', memoryLabel: 'Memory needed' },
    es: { speed: ['Lenta', 'Media', 'Rápida'], quality: ['Aceptable', 'Buena', 'Muy buena'], speedLabel: 'Velocidad', qualityLabel: 'Precisión', memoryLabel: 'Memoria necesaria' },
    ja: { speed: ['遅い', '普通', '速い'], quality: ['ふつう', '高い', 'とても高い'], speedLabel: '速度', qualityLabel: '精度', memoryLabel: '必要メモリ' },
    ko: { speed: ['느림', '보통', '빠름'], quality: ['보통', '좋음', '매우 좋음'], speedLabel: '속도', qualityLabel: '정확도', memoryLabel: '필요 메모리' },
    fr: { speed: ['Lente', 'Moyenne', 'Rapide'], quality: ['Correcte', 'Bonne', 'Très bonne'], speedLabel: 'Vitesse', qualityLabel: 'Précision', memoryLabel: 'Mémoire requise' },
    de: { speed: ['Langsam', 'Mittel', 'Schnell'], quality: ['Ordentlich', 'Gut', 'Sehr gut'], speedLabel: 'Geschwindigkeit', qualityLabel: 'Genauigkeit', memoryLabel: 'Benötigter Speicher' },
    ru: { speed: ['Медленно', 'Средне', 'Быстро'], quality: ['Обычная', 'Хорошая', 'Очень хорошая'], speedLabel: 'Скорость', qualityLabel: 'Точность', memoryLabel: 'Нужная память' },
  };

  // 每个模型的一句话定位：先说适合什么会议，再说它在模型卡上真正的特点
  // （语言覆盖、是否自动判语种、是否自带标点）。
  //
  // 写这几句时必须守两条：
  //  1. **不单列「不适合什么」。** 早先版本给每个模型配了一行 `caveat`
  //     （「遇到西班牙语会识别失败」「不支持中文」），等于把缺点摊到用户脸上，
  //     首启页看起来像在劝退。语言范围写进定位短句即可——「25 种欧洲语言」
  //     本身就说明了它不含中文，用户自己推得出来。
  //  2. **不写「某某混说最稳」。** 这几个模型都不是为某组混说语言专门训练的，
  //     把「中英夹杂」「英西混说」写成卖点会让人以为模型是按语言对定制的。
  //     有实测依据的差异（速度、内存）交给 speed/quality 刻度和体积去表达。
  const model = {
    zh: {
      'funasr-nano-int8': { tagline: "中文会议首选。中文识别准确率高，覆盖粤语等多种中文方言与各地口音，英语也能识别。" },
      'qwen3-asr-0.6b-int8': { tagline: "日语与韩语会议首选，覆盖 30 种语言和 22 种中文方言，支持自动判断语种。" },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "英语与欧洲语言会议首选。覆盖英语、西班牙语、法语、德语、俄语等 25 种语言，自动判断语种，自带标点与大小写。" },
    },
    en: {
      'funasr-nano-int8': { tagline: "Best for Chinese meetings. High accuracy on Chinese, with Cantonese and other Chinese dialects and regional accents covered; English works too." },
      'qwen3-asr-0.6b-int8': { tagline: "Best for Japanese and Korean meetings. Covers 30 languages and 22 Chinese dialects, with automatic language detection." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Best for English and other European-language meetings. 25 languages including English, Spanish, French, German and Russian, with automatic language detection, punctuation, and capitalization." },
    },
    es: {
      'funasr-nano-int8': { tagline: "Ideal para reuniones en chino. Alta precisión en chino, con cantonés y otros dialectos chinos y acentos regionales; el inglés también funciona." },
      'qwen3-asr-0.6b-int8': { tagline: "Ideal para reuniones en japonés y coreano. Cubre 30 idiomas y 22 dialectos del chino, con detección automática del idioma." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Ideal para reuniones en inglés y otras lenguas europeas. 25 idiomas, entre ellos inglés, español, francés, alemán y ruso, con detección automática del idioma, puntuación y mayúsculas." },
    },
    ja: {
      'funasr-nano-int8': { tagline: "中国語の会議に最適。中国語の精度が高く、広東語など中国語の方言や各地のなまりにも対応し、英語も認識します。" },
      'qwen3-asr-0.6b-int8': { tagline: "日本語・韓国語の会議に最適。30 言語と 22 の中国語方言に対応し、言語を自動判定します。" },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "英語・欧州言語の会議に最適。英語・スペイン語・フランス語・ドイツ語・ロシア語など 25 言語に対応し、言語を自動判定して句読点と大文字も付与します。" },
    },
    ko: {
      'funasr-nano-int8': { tagline: "중국어 회의에 최적. 중국어 정확도가 높고 광둥어 등 중국어 방언과 지역 억양도 지원하며 영어도 인식합니다." },
      'qwen3-asr-0.6b-int8': { tagline: "일본어·한국어 회의에 최적. 30개 언어와 22개 중국어 방언을 지원하고 언어를 자동 판별합니다." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "영어·유럽 언어 회의에 최적. 영어, 스페인어, 프랑스어, 독일어, 러시아어 등 25개 언어를 지원하고 언어를 자동 판별하며 문장 부호와 대문자도 함께 표시합니다." },
    },
    fr: {
      'funasr-nano-int8': { tagline: "Idéal pour les réunions en chinois. Grande précision en chinois, avec le cantonais et d’autres dialectes chinois et accents régionaux ; l’anglais fonctionne aussi." },
      'qwen3-asr-0.6b-int8': { tagline: "Idéal pour les réunions en japonais et en coréen. Couvre 30 langues et 22 dialectes chinois, avec détection automatique de la langue." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Idéal pour les réunions en anglais et dans les autres langues européennes. 25 langues dont l’anglais, l’espagnol, le français, l’allemand et le russe, avec détection automatique de la langue, ponctuation et majuscules." },
    },
    de: {
      'funasr-nano-int8': { tagline: "Ideal für chinesische Besprechungen. Hohe Genauigkeit bei Chinesisch, inklusive Kantonesisch und weiterer chinesischer Dialekte und regionaler Akzente; Englisch funktioniert ebenfalls." },
      'qwen3-asr-0.6b-int8': { tagline: "Ideal für japanische und koreanische Besprechungen. Deckt 30 Sprachen und 22 chinesische Dialekte ab, mit automatischer Spracherkennung." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Ideal für englische und andere europäische Besprechungen. 25 Sprachen, darunter Englisch, Spanisch, Französisch, Deutsch und Russisch, mit automatischer Spracherkennung, Zeichensetzung und Großschreibung." },
    },
    ru: {
      'funasr-nano-int8': { tagline: "Оптимально для встреч на китайском. Высокая точность для китайского, включая кантонский и другие китайские диалекты и региональные акценты; английский тоже распознаётся." },
      'qwen3-asr-0.6b-int8': { tagline: "Оптимально для встреч на японском и корейском. Поддерживает 30 языков и 22 китайских диалекта с автоопределением языка." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Оптимально для встреч на английском и других европейских языках. 25 языков, включая английский, испанский, французский, немецкий и русский, с автоопределением языка, пунктуацией и заглавными буквами." },
    },
  };

  // 推荐角标。用户在首启第 ① 步刚选过界面语言，「按界面语言推荐」是自明的，
  // 所以只需要一个短角标，不需要再配一段解释文字。
  const recommended = {
    zh: '推荐', en: 'Recommended', es: 'Recomendado', ja: 'おすすめ',
    ko: '추천', fr: 'Recommandé', de: 'Empfohlen', ru: 'Рекомендуем',
  };

  // 首启第 ③ 步页面文案。
  const setup = {
    zh: {
      title: '选择语音识别模型', intro: '识别模型决定字幕与逐字稿的准确度。可以多选，之后随时能在设置里增减。',
      pickHint: '按需选择要下载的模型',
      bundledTitle: '已随应用安装', bundledDetail: '语音活动检测 · 说话人分离 · 声纹识别',
      atLeastOne: '至少要选一个识别模型，否则无法生成字幕。',
      download: '下载并继续', later: '稍后设置', estimate: '本次下载', total: '合计',
    },
    en: {
      title: 'Choose speech recognition models', intro: 'The model decides how accurate your captions and transcripts are. Pick more than one if you need to; you can add or remove them later in Settings.',
      pickHint: 'Pick the models you need',
      bundledTitle: 'Included with the app', bundledDetail: 'Voice activity detection · Speaker diarization · Voiceprint',
      atLeastOne: 'Pick at least one recognition model, otherwise captions cannot be generated.',
      download: 'Download and continue', later: 'Set up later', estimate: 'Download', total: 'Total',
    },
    es: {
      title: 'Elige modelos de reconocimiento de voz', intro: 'El modelo determina la precisión de los subtítulos y las transcripciones. Puedes elegir varios; después podrás añadirlos o quitarlos en Ajustes.',
      pickHint: 'Elige los modelos que necesites',
      bundledTitle: 'Incluido con la aplicación', bundledDetail: 'Detección de voz · Separación de hablantes · Huella de voz',
      atLeastOne: 'Elige al menos un modelo de reconocimiento; si no, no se pueden generar subtítulos.',
      download: 'Descargar y continuar', later: 'Configurar más tarde', estimate: 'Descarga', total: 'Total',
    },
    ja: {
      title: '音声認識モデルを選択', intro: '認識モデルは字幕と文字起こしの精度を決めます。複数選べますし、あとから設定で増減できます。',
      pickHint: '必要なモデルを選んでください',
      bundledTitle: 'アプリに同梱済み', bundledDetail: '音声活動検出 · 話者分離 · 声紋',
      atLeastOne: '認識モデルを 1 つ以上選んでください。選ばないと字幕を生成できません。',
      download: 'ダウンロードして続ける', later: 'あとで設定', estimate: 'ダウンロード', total: '合計',
    },
    ko: {
      title: '음성 인식 모델 선택', intro: '인식 모델이 자막과 녹취의 정확도를 결정합니다. 여러 개를 선택할 수 있고, 나중에 설정에서 바꿀 수 있습니다.',
      pickHint: '필요한 모델을 선택하세요',
      bundledTitle: '앱에 포함됨', bundledDetail: '음성 활동 감지 · 화자 분리 · 성문',
      atLeastOne: '인식 모델을 하나 이상 선택하세요. 선택하지 않으면 자막을 만들 수 없습니다.',
      download: '다운로드하고 계속', later: '나중에 설정', estimate: '다운로드', total: '합계',
    },
    fr: {
      title: 'Choisir les modèles de reconnaissance vocale', intro: 'Le modèle détermine la précision des sous-titres et des transcriptions. Vous pouvez en choisir plusieurs ; vous pourrez les modifier plus tard dans les réglages.',
      pickHint: 'Choisissez les modèles dont vous avez besoin',
      bundledTitle: 'Inclus avec l’application', bundledDetail: 'Détection vocale · Séparation des locuteurs · Empreinte vocale',
      atLeastOne: 'Choisissez au moins un modèle de reconnaissance, sinon aucun sous-titre ne peut être généré.',
      download: 'Télécharger et continuer', later: 'Configurer plus tard', estimate: 'Téléchargement', total: 'Total',
    },
    de: {
      title: 'Spracherkennungsmodelle wählen', intro: 'Das Modell bestimmt die Genauigkeit von Untertiteln und Transkripten. Sie können mehrere wählen und später in den Einstellungen ändern.',
      pickHint: 'Wählen Sie die Modelle, die Sie brauchen',
      bundledTitle: 'In der App enthalten', bundledDetail: 'Sprachaktivitätserkennung · Sprechertrennung · Stimmabdruck',
      atLeastOne: 'Wählen Sie mindestens ein Erkennungsmodell, sonst können keine Untertitel erzeugt werden.',
      download: 'Herunterladen und fortfahren', later: 'Später einrichten', estimate: 'Download', total: 'Gesamt',
    },
    ru: {
      title: 'Выбор моделей распознавания речи', intro: 'Модель определяет точность субтитров и расшифровок. Можно выбрать несколько; позже их можно изменить в настройках.',
      pickHint: 'Выберите нужные модели',
      bundledTitle: 'Входит в приложение', bundledDetail: 'Детекция речи · Разделение говорящих · Голосовой отпечаток',
      atLeastOne: 'Выберите хотя бы одну модель распознавания, иначе субтитры создать нельзя.',
      download: 'Скачать и продолжить', later: 'Настроить позже', estimate: 'Загрузка', total: 'Всего',
    },
  };

  // 准备页标签。语言仍是显式设置（它同时影响端点检测参数与翻译目标）。
  const prepare = {
    zh: { modelLabel: '识别模型' }, en: { modelLabel: 'Recognition model' },
    es: { modelLabel: 'Modelo de reconocimiento' }, ja: { modelLabel: '認識モデル' },
    ko: { modelLabel: '인식 모델' }, fr: { modelLabel: 'Modèle de reconnaissance' },
    de: { modelLabel: 'Erkennungsmodell' }, ru: { modelLabel: 'Модель распознавания' },
  };

  window.BreviaAsrCopy = { LOCALES, asrRole, tiers, model, recommended, setup, prepare };
})();
