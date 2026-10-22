(() => {
  const { languageCodes, localeTags, slogans, trashCopy, defaultMeetingNames, selectionOverview } =
    window.BreviaLocaleData.localeHelpers;

  window.BreviaI18n = {
    languageCodes,
    localeTag: (locale) => localeTags[locale] || localeTags.en,
    languageName: (locale, code) => new Intl.DisplayNames([locale], { type: 'language' }).of(code),
    languageOptions: (locale, translate, includeAuto = false) => [
      [includeAuto ? 'auto' : '', translate(includeAuto ? '多语言混说' : '不需要翻译')],
      ...languageCodes.map((code) => [
        code,
        new Intl.DisplayNames([locale], { type: 'language' }).of(code),
      ]),
    ],
    defaultMeetingTitle: (locale, date = new Date()) =>
      `${defaultMeetingNames[locale] || defaultMeetingNames.en} ${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`,
    selectionOverview: (locale, count) =>
      (selectionOverview[locale] || selectionOverview.en)(count),
    slogans,
    trashCopy: (locale) => trashCopy[locale] || trashCopy.en,
    // 原始词条表。上面的访问器都带 `|| .en` 兜底：缺一门语言时静默回落英文。
    // 那对用户是安全的，但也意味着「漏翻译」在运行时**看不出来**——没有任何报错，
    // 只是某个语种的界面上冒出英文。所以完备性由 test-ui.mjs 的词条完备门禁直接检查
    // 这四张表，而不是靠访问器的返回值反推。
    // 反例：`defaultMeetingNames.de` 与 `en` 合法地相同（都是 "Meeting"），
    // 只看 `defaultMeetingTitle()` 的返回值无法区分「德语已定义」和「德语缺失、回落英文」。
    localeTables: { slogans, trashCopy, defaultMeetingNames, selectionOverview },
  };
})();
