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
      'funasr-nano-int8': { tagline: "中文会议首选。中文识别准确率高，覆盖粤语等多种中文方言与各地口音以及英语。" },
      'qwen3-asr-0.6b-int8': { tagline: "日语与韩语会议首选，覆盖 30 种语言和 22 种中文方言。" },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "英语与欧洲语言会议首选。覆盖英语、西班牙语、法语、德语、俄语等 25 种语言。" },
    },
    en: {
      'funasr-nano-int8': { tagline: "Best for Chinese meetings. High accuracy on Chinese, covering Cantonese, other Chinese dialects, regional accents, and English." },
      'qwen3-asr-0.6b-int8': { tagline: "Best for Japanese and Korean meetings. Covers 30 languages and 22 Chinese dialects." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Best for English and other European-language meetings. Covers 25 languages including English, Spanish, French, German, and Russian." },
    },
    es: {
      'funasr-nano-int8': { tagline: "Ideal para reuniones en chino. Alta precisión en chino; cubre el cantonés, otros dialectos chinos, acentos regionales y el inglés." },
      'qwen3-asr-0.6b-int8': { tagline: "Ideal para reuniones en japonés y coreano. Cubre 30 idiomas y 22 dialectos del chino." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Ideal para reuniones en inglés y otras lenguas europeas. Cubre 25 idiomas, entre ellos inglés, español, francés, alemán y ruso." },
    },
    ja: {
      'funasr-nano-int8': { tagline: "中国語の会議に最適。中国語の精度が高く、広東語などの中国語方言、各地のなまり、英語に対応します。" },
      'qwen3-asr-0.6b-int8': { tagline: "日本語・韓国語の会議に最適。30 言語と 22 の中国語方言に対応します。" },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "英語・欧州言語の会議に最適。英語・スペイン語・フランス語・ドイツ語・ロシア語など 25 言語に対応します。" },
    },
    ko: {
      'funasr-nano-int8': { tagline: "중국어 회의에 최적. 중국어 인식 정확도가 높고 광둥어 등 중국어 방언, 지역 억양, 영어를 지원합니다." },
      'qwen3-asr-0.6b-int8': { tagline: "일본어·한국어 회의에 최적. 30개 언어와 22개 중국어 방언을 지원합니다." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "영어·유럽 언어 회의에 최적. 영어, 스페인어, 프랑스어, 독일어, 러시아어 등 25개 언어를 지원합니다." },
    },
    fr: {
      'funasr-nano-int8': { tagline: "Idéal pour les réunions en chinois. Grande précision en chinois ; couvre le cantonais, d’autres dialectes chinois, les accents régionaux et l’anglais." },
      'qwen3-asr-0.6b-int8': { tagline: "Idéal pour les réunions en japonais et en coréen. Couvre 30 langues et 22 dialectes chinois." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Idéal pour les réunions en anglais et dans les autres langues européennes. Couvre 25 langues dont l’anglais, l’espagnol, le français, l’allemand et le russe." },
    },
    de: {
      'funasr-nano-int8': { tagline: "Ideal für chinesische Besprechungen. Hohe Genauigkeit bei Chinesisch; deckt Kantonesisch, weitere chinesische Dialekte, regionale Akzente und Englisch ab." },
      'qwen3-asr-0.6b-int8': { tagline: "Ideal für japanische und koreanische Besprechungen. Deckt 30 Sprachen und 22 chinesische Dialekte ab." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Ideal für englische und andere europäische Besprechungen. Deckt 25 Sprachen ab, darunter Englisch, Spanisch, Französisch, Deutsch und Russisch." },
    },
    ru: {
      'funasr-nano-int8': { tagline: "Оптимально для встреч на китайском. Высокая точность для китайского; поддерживает кантонский и другие китайские диалекты, региональные акценты и английский." },
      'qwen3-asr-0.6b-int8': { tagline: "Оптимально для встреч на японском и корейском. Поддерживает 30 языков и 22 китайских диалекта." },
      'parakeet-tdt-0.6b-v3-int8': { tagline: "Оптимально для встреч на английском и других европейских языках. Поддерживает 25 языков, включая английский, испанский, французский, немецкий и русский." },
    },
  };

  const mlxDescriptions = {
    zh: ['日语和韩语会议的默认模型，支持多语种转写并自动生成标点。', '适合中文会议转写，也支持粤语和英语。', '中文和粤语会议的默认模型，也支持英语与日语。'],
    en: ['Default for Japanese and Korean meetings. Supports multilingual transcription with automatic punctuation.', 'Suited to Chinese meeting transcription, with support for Cantonese and English.', 'Default for Mandarin and Cantonese meetings. Also supports English and Japanese.'],
    es: ['Modelo predeterminado para reuniones en japonés y coreano. Transcripción multilingüe con puntuación automática.', 'Adecuado para transcribir reuniones en chino; también admite cantonés e inglés.', 'Modelo predeterminado para reuniones en mandarín y cantonés. También admite inglés y japonés.'],
    ja: ['日本語・韓国語の会議の既定モデル。多言語の文字起こしと句読点の自動挿入に対応します。', '中国語の会議の文字起こしに適しています。広東語と英語にも対応します。', '標準中国語・広東語の会議の既定モデル。英語と日本語にも対応します。'],
    ko: ['일본어·한국어 회의의 기본 모델. 다국어 전사와 자동 문장 부호를 지원합니다.', '중국어 회의 전사에 적합하며 광둥어와 영어도 지원합니다.', '표준 중국어·광둥어 회의의 기본 모델. 영어와 일본어도 지원합니다.'],
    fr: ['Modèle par défaut pour les réunions en japonais et coréen. Transcription multilingue avec ponctuation automatique.', 'Adapté à la transcription des réunions en chinois, avec prise en charge du cantonais et de l’anglais.', 'Modèle par défaut pour les réunions en mandarin et cantonais. Prend aussi en charge l’anglais et le japonais.'],
    de: ['Standardmodell für Besprechungen auf Japanisch und Koreanisch. Mehrsprachige Transkription mit automatischer Zeichensetzung.', 'Geeignet für die Transkription chinesischer Besprechungen; unterstützt auch Kantonesisch und Englisch.', 'Standardmodell für Besprechungen auf Mandarin und Kantonesisch. Unterstützt auch Englisch und Japanisch.'],
    ru: ['Модель по умолчанию для встреч на японском и корейском. Многоязычная транскрипция с автоматической пунктуацией.', 'Подходит для транскрипции встреч на китайском; также поддерживает кантонский и английский.', 'Модель по умолчанию для встреч на путунхуа и кантонском. Также поддерживает английский и японский.'],
  };
  for (const locale of LOCALES) {
    model[locale]['funasr-nano-mlx'] = { tagline: mlxDescriptions[locale][2] };
    model[locale]['qwen3-asr-0.6b-mlx'] = { tagline: mlxDescriptions[locale][0] };
    model[locale]['fireredasr2-aed-mlx'] = { tagline: mlxDescriptions[locale][1] };
    model[locale]['parakeet-tdt-0.6b-v3-mlx'] =
      model[locale]['parakeet-tdt-0.6b-v3-int8'];
  }

  // 推荐角标。用户在首启第 ① 步刚选过界面语言，「按界面语言推荐」是自明的，
  // 所以只需要一个短角标，不需要再配一段解释文字。
  const recommended = {
    zh: '推荐', en: 'Recommended', es: 'Recomendado', ja: 'おすすめ',
    ko: '추천', fr: 'Recommandé', de: 'Empfohlen', ru: 'Рекомендуем',
  };

  // 首启第 ③ 步页面文案。
  const setup = {
    zh: {
      title: '选择语音识别模型',
      pickHint: '按需选择要下载的模型',
      bundledTitle: '已随应用安装', bundledDetail: '语音活动检测 · 说话人分离 · 声纹识别',
      atLeastOne: '至少要选一个识别模型，否则无法生成字幕。',
      download: '下载并继续', later: '稍后设置', estimate: '本次下载', total: '合计',
    },
    en: {
      title: 'Choose speech recognition models',
      pickHint: 'Pick the models you need',
      bundledTitle: 'Included with the app', bundledDetail: 'Voice activity detection · Speaker diarization · Voiceprint',
      atLeastOne: 'Pick at least one recognition model, otherwise captions cannot be generated.',
      download: 'Download and continue', later: 'Set up later', estimate: 'Download', total: 'Total',
    },
    es: {
      title: 'Elige modelos de reconocimiento de voz',
      pickHint: 'Elige los modelos que necesites',
      bundledTitle: 'Incluido con la aplicación', bundledDetail: 'Detección de voz · Separación de hablantes · Huella de voz',
      atLeastOne: 'Elige al menos un modelo de reconocimiento; si no, no se pueden generar subtítulos.',
      download: 'Descargar y continuar', later: 'Configurar más tarde', estimate: 'Descarga', total: 'Total',
    },
    ja: {
      title: '音声認識モデルを選択',
      pickHint: '必要なモデルを選んでください',
      bundledTitle: 'アプリに同梱済み', bundledDetail: '音声活動検出 · 話者分離 · 声紋',
      atLeastOne: '認識モデルを 1 つ以上選んでください。選ばないと字幕を生成できません。',
      download: 'ダウンロードして続ける', later: 'あとで設定', estimate: 'ダウンロード', total: '合計',
    },
    ko: {
      title: '음성 인식 모델 선택',
      pickHint: '필요한 모델을 선택하세요',
      bundledTitle: '앱에 포함됨', bundledDetail: '음성 활동 감지 · 화자 분리 · 성문',
      atLeastOne: '인식 모델을 하나 이상 선택하세요. 선택하지 않으면 자막을 만들 수 없습니다.',
      download: '다운로드하고 계속', later: '나중에 설정', estimate: '다운로드', total: '합계',
    },
    fr: {
      title: 'Choisir les modèles de reconnaissance vocale',
      pickHint: 'Choisissez les modèles dont vous avez besoin',
      bundledTitle: 'Inclus avec l’application', bundledDetail: 'Détection vocale · Séparation des locuteurs · Empreinte vocale',
      atLeastOne: 'Choisissez au moins un modèle de reconnaissance, sinon aucun sous-titre ne peut être généré.',
      download: 'Télécharger et continuer', later: 'Configurer plus tard', estimate: 'Téléchargement', total: 'Total',
    },
    de: {
      title: 'Spracherkennungsmodelle wählen',
      pickHint: 'Wählen Sie die Modelle, die Sie brauchen',
      bundledTitle: 'In der App enthalten', bundledDetail: 'Sprachaktivitätserkennung · Sprechertrennung · Stimmabdruck',
      atLeastOne: 'Wählen Sie mindestens ein Erkennungsmodell, sonst können keine Untertitel erzeugt werden.',
      download: 'Herunterladen und fortfahren', later: 'Später einrichten', estimate: 'Download', total: 'Gesamt',
    },
    ru: {
      title: 'Выбор моделей распознавания речи',
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
