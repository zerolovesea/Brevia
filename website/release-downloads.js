fetch(`https://api.github.com/repos/zerolovesea/Brevia/releases/latest?${Date.now()}`, { cache: 'no-store' })
  .then((response) => response.ok && response.json())
  .then((release) => {
    if (!release) return;
    document.querySelectorAll('[data-release-asset]').forEach((link) => {
      const asset = release.assets.find((item) => item.name.endsWith(link.dataset.releaseAsset));
      if (asset) link.href = asset.browser_download_url;
    });
    if (release.tag_name) {
      document.querySelectorAll('[data-release-version]').forEach((el) => {
        el.textContent = release.tag_name;
      });
    }
  })
  .catch(() => {});
