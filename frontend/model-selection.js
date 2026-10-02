// 模型选择的纯逻辑核心。
//
// 抽出来的理由：这些规则原先写在 app.js 里，全部靠模块级可变绑定（`modelCatalog`、
// `modelPaths`、`locale`、`catalog`）取数，于是测试只能断言「源码里存在这个函数名」——
// 改个名字就变红，而真正会出错的边界（声明的默认没装、模型带不动某语言、退役模型混进
// 候选）一条都测不到。结果是同一类"清单与代码漂移"的 bug 反复出现且测试全绿。
//
// 这里只保留**纯函数**：所有输入显式传入，不读全局、不写全局、不碰 DOM。app.js 里保留
// 同名薄包装负责绑定全局，测试直接加载本文件并用合成清单跑真实边界。
//
// 加载方式沿用项目的 classic script（挂到 window），因此它可以被 index.html 与
// test-ui.mjs 用同一种方式加载，不需要构建步骤。

(() => {
  const LOCALES = ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'];
  // 「多语言混说」（auto）只接受按整段音频判断语种的模型类型；逐语言微调的模型在混说
  // 输入上会串语言。必须与后端 worker_common.MULTILINGUAL_MODEL_KINDS 完全一致。
  const MULTILINGUAL_MODEL_KINDS = new Set(['qwen3', 'whisper', 'nemo-transducer']);
  const DEFAULT_REFINED_PRIORITY = 99;

  /** 该模型能否承担某语言的整句识别。
   *
   * 具体语言只认 `languages` 里显式列出的代码（外加 `all` 这种显式通配）。`multilingual`
   * **不是**通配符：它的含义是「广谱多语种模型」，由 auto 分支按 kind 判断。早期把它当
   * 通配符时，不含中文的 Parakeet 会被判成支持中文，前端因此把它列进中文会议的识别模型
   * 下拉——用户选得出、结果全是垃圾。
   * @param {object|undefined} model 清单项。@param {string} language 语言代码或 'auto'。
   * @returns {boolean} 是否支持。
   */
  function modelSupportsLanguage(model, language) {
    if (!model) return false;
    if (language === 'auto') return MULTILINGUAL_MODEL_KINDS.has(model.kind);
    return [language, 'all'].some((code) => (model.languages || []).includes(code));
  }

  /** 可选的整句识别模型，按清单的 refined_priority 排序（退役模型不参与）。
   *
   * 排序规则只在 models.json 里定义一次，后端 refined_models_in_priority_order 读同一字段：
   * 两端顺序不一致时，同一个语言在「声明的默认没装」的情况下会选出不同的回退模型。
   * @param {object[]} catalog 模型清单。@returns {object[]} 可选模型（新数组）。
   */
  function selectableRefinedModels(catalog) {
    return (catalog || [])
      .filter((model) => (model.stages || []).includes('refined') && !model.retired)
      .sort(
        (first, second) =>
          (first.refined_priority ?? DEFAULT_REFINED_PRIORITY)
          - (second.refined_priority ?? DEFAULT_REFINED_PRIORITY),
      );
  }

  /** 该语言可用（含未安装）的整句识别模型。@returns {object[]} */
  function refinedModelsForLanguage(catalog, language) {
    return selectableRefinedModels(catalog).filter((model) =>
      modelSupportsLanguage(model, language || 'auto'));
  }

  /** 清单声明的该语言默认识别模型 id；没有声明则回落到第一个支持该语言的模型。
   * @returns {string|undefined} 模型 id。
   */
  function declaredDefaultModelId(catalog, language) {
    const candidates = selectableRefinedModels(catalog);
    const declared = candidates.find((model) =>
      (model.default_for_languages || []).includes(language));
    if (declared) return declared.id;
    return candidates.find((model) => modelSupportsLanguage(model, language || 'auto'))?.id;
  }

  /** 该语言最终用哪个识别模型：用户偏好 → 清单默认 → 首个已安装的同语言模型。
   *
   * 第 ③ 步是必需的：首次准备时用户只装了部分模型，没有它，中文用户第一次开会会被要求
   * 再下载 842 MB 的 FunASR Nano——而后端在同一条路径上会回落到已安装的模型，两端因此
   * 对同一个语言给出不同答案。
   * @param {object} options catalog / language / installed / preferredId / fallbackId。
   * @returns {string} 模型 id。
   */
  function defaultRefinedModelId({ catalog, language, installed, preferredId, fallbackId }) {
    const isInstalled = (modelId) => Boolean(installed && installed.has(modelId));
    // ① 用户偏好优先，且**即便尚未安装也照样返回**：偏好只在准备页显式改选时写入，
    // 用「已安装回退」把它盖掉等于静默丢弃用户的选择；用户仍可在下拉里改回去。
    const preferredModel = preferredId
      ? (catalog || []).find((model) => model.id === preferredId)
      : null;
    if (preferredModel && !preferredModel.retired && modelSupportsLanguage(preferredModel, language)) {
      return preferredId;
    }
    // ② 清单声明的默认；没装时才回退到已安装的同语言模型（见函数头注释第 ③ 步）。
    const declared = declaredDefaultModelId(catalog, language) || fallbackId;
    if (!declared) return undefined;
    if (isInstalled(declared)) return declared;
    const fallback = refinedModelsForLanguage(catalog, language)
      .find((model) => isInstalled(model.id));
    return fallback?.id || declared;
  }

  /** 组装识别模型下拉选项：未安装的把体积写进标签，让用户知道选了会触发下载。
   *
   * 第三项是该语言的推荐角标，口径与首启页一致（都取清单声明的默认）。
   * @param {object} options catalog / language / installed / downloadWord / recommendedWord /
   *   formatSize / fallbackId。
   * @returns {Array<[string, string, string]>} [值, 文案, 角标]。
   */
  function refinedModelOptions({
    catalog, language, installed, downloadWord = '', recommendedWord = '',
    formatSize = (bytes) => String(bytes || 0), fallbackId,
  }) {
    const isInstalled = (modelId) => Boolean(installed && installed.has(modelId));
    const recommendedId = declaredDefaultModelId(catalog, language);
    return refinedModelsForLanguage(catalog, language).map((model) => [
      model.id,
      isInstalled(model.id)
        ? model.name
        : `${model.name} · ${downloadWord} ${formatSize(model.size_bytes || 0)}`,
      model.id === recommendedId ? recommendedWord : '',
    ]);
  }

  /** 模型库要展示的模型：退役模型一律不显示。
   *
   * 退役意味着产品已不再提供它（不再出现在首启选型页、不再参与默认模型推导）。清单里保留
   * 条目仍然必要——历史会议的 refined_model_id 要能解析——但显示出来只会让用户把淘汰的
   * 模型重新下回来。
   * @param {object[]} catalog 模型清单。@returns {object[]} 可展示模型。
   */
  function visibleModels(catalog) {
    return (catalog || []).filter((model) => !model.retired);
  }

  /** 该模型在模型库里属于哪一组。
   *
   * 映射必须显式：按前缀匹配会让 `speaker-segmentation` 同时命中说话人分离与声纹两组，
   * 把分割模型归错组。
   * @param {object} model 清单项。@param {object} stageGroups stage → 分组键。@returns {string|undefined}
   */
  function modelLibraryGroup(model, stageGroups) {
    for (const stage of model.stages || []) {
      const group = stageGroups[stage];
      if (group) return group;
    }
    return undefined;
  }

  /** 模型库一行的「下载 / 占用 / 内存」摘要。
   *
   * 归档体积与磁盘占用差距不小（Whisper 1.07 GB → 1.71 GB），只报一个会误导；内存下限是
   * 本地推理最容易踩的坑，也一并写出来。
   * @param {object} model 清单项。@param {object} words 三个词条。@param {Function} formatSize。
   * @returns {string} 摘要文本。
   */
  function modelSizeSummary(model, words, formatSize) {
    const parts = [`${words.download} ${formatSize(model.size_bytes || 0)}`];
    if (model.disk_size_bytes) parts.push(`${words.disk} ${formatSize(model.disk_size_bytes)}`);
    if (model.memory_floor_bytes) parts.push(`${words.memory} ${formatSize(model.memory_floor_bytes)}`);
    return parts.join(' · ');
  }

  window.BreviaModelSelection = {
    DEFAULT_REFINED_PRIORITY,
    LOCALES,
    MULTILINGUAL_MODEL_KINDS,
    declaredDefaultModelId,
    defaultRefinedModelId,
    modelLibraryGroup,
    modelSizeSummary,
    modelSupportsLanguage,
    refinedModelOptions,
    refinedModelsForLanguage,
    selectableRefinedModels,
    visibleModels,
  };
})();
