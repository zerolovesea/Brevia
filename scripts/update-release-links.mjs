import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';

const tag = process.env.VERSION;
if (!/^v\d+(?:\.\d+)+$/.test(tag || ''))
  throw new Error('VERSION must be a release tag such as v1.1.2');

const version = tag.slice(1);
const updates = [
  ['website/index-zh.html', 'https://modelscope.cn/models/zyaztec/brevia-release/resolve/master'],
  ['website/index-en.html', `https://github.com/zerolovesea/Brevia/releases/download/${tag}`],
];

for (const [file, baseUrl] of updates) {
  let html = readFileSync(file, 'utf8').replace(/(data-release-version[^>]*>)[^<]*/, `$1${tag}`);
  for (const [key, filename] of Object.entries({
    macos: `Brevia-WebKit-${version}-arm64.dmg`,
    windows: `Brevia-${version}-x64-setup.exe`,
    'windows-cuda': `Brevia-${version}-x64-cuda-setup.exe`,
    'linux-cpu': `Brevia-${version}-amd64-cpu.deb`,
    'linux-cuda': `Brevia-${version}-amd64-cuda.deb`,
  })) {
    const bytes = statSync(`dist/${filename}`).size;
    const suffix = filename.slice(filename.indexOf(version) + version.length);
    const anchor = html
      .match(/<a\s[^>]*class="platform-link"[^>]*>/g)
      ?.find((entry) => entry.includes(suffix + '"'));
    if (!anchor || !html.includes(`data-size="${key}">`))
      throw new Error(`Missing ${key} download in ${file}`);
    html = html
      .replace(anchor, anchor.replace(/href="[^"]*"/, `href="${baseUrl}/${filename}"`))
      .replace(new RegExp(`(data-size="${key}">)[^<]*`), `$1${(bytes / 1e6).toFixed(1)} MB`);
  }
  writeFileSync(file, html);
}

const readmes = [
  'README.md',
  ...readdirSync('docs')
    .filter((name) => /^README\.[a-z]{2}(?:-[A-Z]{2})?\.md$/.test(name))
    .map((name) => `docs/${name}`),
];
for (const file of readmes) {
  const markdown = readFileSync(file, 'utf8')
    .replace(/<!-- native-release-pending -->[\s\S]*?<!-- \/native-release-pending -->\n\n/g, '')
    .replace(
      /https:\/\/(?:github\.com\/zerolovesea\/Brevia\/releases\/download\/v[\d.]+|modelscope\.cn\/models\/zyaztec\/brevia-release\/resolve\/master)\/Brevia-(?:WebKit-)?[\d.]+-(arm64\.dmg|x64-setup\.exe)/g,
      (url, suffix) =>
        `${url.slice(0, url.lastIndexOf('/Brevia-')).replace(/\/v[\d.]+$/, `/${tag}`)}/Brevia-${suffix === 'arm64.dmg' ? 'WebKit-' : ''}${version}-${suffix}`,
    );
  writeFileSync(file, markdown);
}
