(() => {
  const supported = new Set(['zh', 'en', 'es', 'ja', 'ko', 'fr', 'de', 'ru']);
  const systemLocale = () => {
    const code = navigator.language?.split('-')[0];
    return supported.has(code) ? code : 'en';
  };
  let pendingDownloads = new Set();
  let trackingDownloads = false;
  window.BreviaOnboarding = {
    isFirstLaunch: () => !localStorage.getItem('brevia-onboarding-complete'),
    systemLocale,
    defaultMeetingLanguages: (locale) => [locale],
    start(showLanguage) { if (this.isFirstLaunch()) showLanguage(systemLocale()); },
    complete() { localStorage.setItem('brevia-onboarding-complete', 'true'); },
    beginDownloads(ids) { pendingDownloads = new Set(ids); trackingDownloads = pendingDownloads.size > 0; },
    modelReady(id) {
      if (!trackingDownloads || !pendingDownloads.delete(id)) return false;
      if (pendingDownloads.size) return false;
      trackingDownloads = false;
      return true;
    },
  };
})();
