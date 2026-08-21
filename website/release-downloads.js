const isChinaSite = document.documentElement.lang === 'zh-CN';
const modelscopeMirror = 'https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/';
const releaseSource = isChinaSite
  ? `${modelscopeMirror}release.json?${Date.now()}`
  : `https://api.github.com/repos/zerolovesea/Brevia/releases/latest?${Date.now()}`;

fetch(releaseSource, { cache: 'no-store' })
  .then((response) => response.ok && response.json())
  .then((release) => {
    if (!release) return;
    document.querySelectorAll('[data-release-asset]').forEach((link) => {
      const asset = release.assets.find((item) => (isChinaSite ? item : item.name).endsWith(link.dataset.releaseAsset));
      if (asset) link.href = isChinaSite
        ? `${modelscopeMirror}${encodeURIComponent(asset)}`
        : asset.browser_download_url;
    });
    const tag = isChinaSite ? release.tag : release.tag_name;
    if (tag) {
      document.querySelectorAll('[data-release-version]').forEach((el) => {
        el.textContent = tag;
      });
    }
  })
  .catch(() => {});
