(() => {
  const languageCodes = ['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru'];
  const localeTags = { zh: 'zh-CN', en: 'en-US', es: 'es-ES', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', ru: 'ru-RU' };
  const slogans = {
    zh: ['每一场对话，都留有依据。', '让重要讨论，不再散落。', '从声音开始，留下清晰结论。', '记录发生的事，推进接下来的事。', '把会议留在掌控之中。'],
    en: ['Every conversation leaves a traceable record.', 'Keep important discussions in one place.', 'Start with sound. End with clear decisions.', 'Record what happened. Move the work forward.', 'Keep every meeting within reach.'],
    es: ['Cada conversación conserva un registro verificable.', 'Mantén las conversaciones importantes en un solo lugar.', 'Empieza con la voz. Termina con decisiones claras.', 'Registra lo que ocurrió. Haz avanzar el trabajo.', 'Mantén cada reunión bajo control.'],
    ja: ['すべての会話に、確かな記録を。', '大切な議論を、一か所に。', '音声から始め、明確な決定へ。', '起きたことを記録し、仕事を前へ進める。', 'すべての会議を手の届く場所に。'],
    ko: ['모든 대화에 추적 가능한 기록을 남깁니다.', '중요한 논의를 한곳에 모으세요.', '소리로 시작해 명확한 결정으로 마무리하세요.', '일어난 일을 기록하고 업무를 앞으로 나아가게 하세요.', '모든 회의를 가까이 두세요.'],
    fr: ['Chaque conversation laisse une trace vérifiable.', 'Gardez les discussions importantes au même endroit.', 'Commencez par le son. Terminez par des décisions claires.', 'Consignez ce qui s’est passé. Faites avancer le travail.', 'Gardez chaque réunion à portée de main.'],
    de: ['Jedes Gespräch hinterlässt eine nachvollziehbare Aufzeichnung.', 'Halten Sie wichtige Gespräche an einem Ort fest.', 'Mit Ton beginnen. Mit klaren Entscheidungen enden.', 'Dokumentieren Sie das Geschehene und bringen Sie die Arbeit voran.', 'Behalten Sie jede Besprechung im Blick.'],
    ru: ['Каждый разговор оставляет проверяемую запись.', 'Храните важные обсуждения в одном месте.', 'Начните со звука. Завершите ясными решениями.', 'Записывайте произошедшее и двигайте работу вперёд.', 'Держите каждую встречу под рукой.']
  };
  const trashCopy = {
    zh: { slogan: '删除的会议将在 30 天后永久清理。', back: '← 返回会议库', purge: '永久删除' },
    en: { slogan: 'Deleted meetings are permanently removed after 30 days.', back: '← Back to library', purge: 'Delete permanently' },
    es: { slogan: 'Las reuniones eliminadas se borran permanentemente después de 30 días.', back: '← Volver a la biblioteca', purge: 'Eliminar definitivamente' },
    ja: { slogan: '削除した会議は30日後に完全に消去されます。', back: '← ライブラリに戻る', purge: '完全に削除' },
    ko: { slogan: '삭제된 회의는 30일 후 영구적으로 삭제됩니다.', back: '← 라이브러리로 돌아가기', purge: '영구 삭제' },
    fr: { slogan: 'Les réunions supprimées sont effacées définitivement après 30 jours.', back: '← Retour à la bibliothèque', purge: 'Supprimer définitivement' },
    de: { slogan: 'Gelöschte Besprechungen werden nach 30 Tagen endgültig entfernt.', back: '← Zurück zur Bibliothek', purge: 'Endgültig löschen' },
    ru: { slogan: 'Удалённые встречи безвозвратно удаляются через 30 дней.', back: '← Вернуться в библиотеку', purge: 'Удалить навсегда' }
  };
  const defaultMeetingNames = { zh: '会议', en: 'Meeting', es: 'Reunión', ja: '会議', ko: '회의', fr: 'Réunion', de: 'Meeting', ru: 'Встреча' };
  const selectionOverview = {
    zh: (count) => `已选择 ${count} 个会议`, en: (count) => `${count} meeting${count === 1 ? '' : 's'} selected`, es: (count) => `${count} ${count === 1 ? 'reunión seleccionada' : 'reuniones seleccionadas'}`,
    ja: (count) => `${count} 件の会議を選択中`, ko: (count) => `회의 ${count}개 선택됨`, fr: (count) => `${count} réunion${count === 1 ? '' : 's'} sélectionnée${count === 1 ? '' : 's'}`, de: (count) => `${count} Besprechung${count === 1 ? '' : 'en'} ausgewählt`, ru: (count) => `Выбрано встреч: ${count}`
  };

  window.BreviaI18n = {
    languageCodes,
    localeTag: (locale) => localeTags[locale] || localeTags.en,
    languageName: (locale, code) => new Intl.DisplayNames([locale], { type: 'language' }).of(code),
    languageOptions: (locale, translate, includeAuto = false) => [[includeAuto ? 'auto' : '', translate(includeAuto ? '自动检测' : '不需要翻译')], ...languageCodes.map((code) => [code, new Intl.DisplayNames([locale], { type: 'language' }).of(code)])],
    defaultMeetingTitle: (locale, date = new Date()) => `${defaultMeetingNames[locale] || defaultMeetingNames.en} ${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`,
    selectionOverview: (locale, count) => (selectionOverview[locale] || selectionOverview.en)(count),
    slogans,
    trashCopy: (locale) => trashCopy[locale] || trashCopy.en,
  };
})();
