// 许可证随二进制交付；从固定来源复制原文，不携带完整第三方源码。
const fs = require('node:fs');
const path = require('node:path');
const [cache, destination] = process.argv.slice(2);
const checkouts = path.join(__dirname, '.build/checkouts');
function copy(directory, prefix = '') {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const source = path.join(directory, item.name);
    const name = prefix + item.name;
    if (item.isDirectory()) copy(source, name + '-');
    else if (/^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(item.name)) {
      fs.copyFileSync(source, path.join(destination, name));
    }
  }
}
copy(checkouts);
for (const source of ['miniaudio.h', 'stb_vorbis.c']) {
  const text = fs.readFileSync(path.join(cache, source), 'utf8');
  const marker = text.lastIndexOf('This software is available');
  if (marker < 0) throw new Error(`License not found: ${source}`);
  fs.writeFileSync(path.join(destination, source + '-LICENSE'), text.slice(marker));
}
