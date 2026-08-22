import { readFileSync, writeFileSync } from 'node:fs';

const tag = process.env.VERSION;
if (!/^v\d+(?:\.\d+)+$/.test(tag || '')) throw new Error('VERSION must be a release tag such as v1.1.2');

const version = tag.slice(1);
const updates = [
  ['website/index-zh.html', 'https://modelscope.cn/models/zyaztec/brevia-release/resolve/master'],
  ['website/index-en.html', `https://github.com/zerolovesea/Brevia/releases/download/${tag}`],
];

for (const [file, baseUrl] of updates) {
  const macUrl = `${baseUrl}/Brevia-${version}-arm64.dmg`;
  const windowsUrl = `${baseUrl}/Brevia-${version}-x64-setup.exe`;
  let html = readFileSync(file, 'utf8')
    .replace(/href="[^"]*Brevia-[^"]*-arm64\.dmg"/, `href="${macUrl}"`)
    .replace(/href="[^"]*Brevia-[^"]*-x64-setup\.exe"/, `href="${windowsUrl}"`)
    .replace(/(<[^>]*data-release-version[^>]*>)[^<]*(<\/)/g, `$1${tag}$2`);
  if (!html.includes(macUrl) || !html.includes(windowsUrl) || !html.includes(`>${tag}<`)) {
    throw new Error(`Could not update all release links in ${file}`);
  }
  writeFileSync(file, html);
}
