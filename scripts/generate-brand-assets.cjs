// 唯一源图为 frontend/assets/brevia-logo.svg；使用 Electron 自带的渲染器生成各端资源。
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = resolve(__dirname, '..');
const check = process.argv.includes('--check');
const temp = mkdtempSync(join(tmpdir(), 'brevia-brand-'));
app.setPath('userData', temp);
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  let win;
  try {
    const logo = readFileSync(join(root, 'frontend/assets/brevia-logo.svg'), 'utf8');
    assert.doesNotMatch(logo, /<text\b/, '品牌字形必须固定为路径');
    const group = (id) => {
      const match = logo.match(new RegExp(`<g id="${id}"[^>]*>[\\s\\S]*?</g>`));
      assert.ok(match, `缺少 ${id} 图形`);
      return match[0];
    };
    const svg = (viewBox, content) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Brevia">\n${content}\n</svg>\n`;
    const mark = svg('0 0 160 160', group('mark'));
    const wordmark = svg('216 40 289 82', group('wordmark'));
    const outputs = new Map();
    const add = (path, data) => outputs.set(path, Buffer.from(data));
    for (const path of [
      'frontend/assets/brevia-mark.svg',
      'electron/assets/icon.svg',
      'website/assets/brevia-mark.svg',
    ])
      add(path, mark);
    for (const path of ['website/assets/brevia-logo.svg', 'docs/assets/brevia-mark.svg'])
      add(path, logo);
    add('frontend/assets/brevia-wordmark.svg', wordmark);

    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<meta charset="utf-8">');
    const png = async (source, width, height = width) => {
      const data = await win.webContents.executeJavaScript(`(async () => {
        const image = new Image();
        image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`)};
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = ${width}; canvas.height = ${height};
        canvas.getContext('2d', { alpha: ${source !== mark} }).drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      let buffer = Buffer.from(data, 'base64');
      if (source === mark) {
        const converted = spawnSync('magick', ['png:-', '-alpha', 'off', '-strip', 'PNG24:-'], {
          input: buffer,
        });
        assert.equal(converted.status, 0, converted.error?.message || converted.stderr.toString());
        buffer = converted.stdout;
      }
      assert.deepEqual(nativeImage.createFromBuffer(buffer).getSize(), { width, height });
      if (source === mark) assert.equal(buffer[25], 2, '平台图标必须使用无透明通道的 RGB PNG');
      return buffer;
    };
    const trayMark = mark
      .replace(/<path fill="#26221e"[^>]*\/>/, '')
      .replaceAll('#fbfaf7', '#000000');
    add('electron/assets/trayTemplate.png', await png(trayMark, 32));
    const sizes = new Map();
    const icon = async (size) => {
      if (!sizes.has(size)) sizes.set(size, await png(mark, size));
      return sizes.get(size);
    };
    add('electron/assets/tray.png', await icon(32));
    add('mobile/assets/brevia-logo.png', await icon(192));
    add('mobile/assets/brevia-lockup.png', await png(logo, 606, 192));
    add(
      'mobile/assets/brevia-lockup-dark.png',
      await png(
        logo.replace('<g id="wordmark" fill="#26221e">', '<g id="wordmark" fill="#fbfaf7">'),
        606,
        192,
      ),
    );
    add('mobile/assets/brevia-wordmark.png', await png(wordmark, 867, 246));
    add('mobile/ios/Runner/Assets.xcassets/LaunchMark.imageset/launch-mark.png', await icon(192));
    const catalog = 'mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/';
    for (const image of JSON.parse(readFileSync(join(root, catalog, 'Contents.json'), 'utf8'))
      .images) {
      const size = Number(image.size.split('x')[0]) * Number(image.scale.replace('x', ''));
      add(catalog + image.filename, await icon(size));
    }
    for (const [density, size] of [
      ['mdpi', 48],
      ['hdpi', 72],
      ['xhdpi', 96],
      ['xxhdpi', 144],
      ['xxxhdpi', 192],
    ]) {
      add(`mobile/android/app/src/main/res/mipmap-${density}/ic_launcher.png`, await icon(size));
    }

    // ICO 和 ICNS 都直接封装 PNG，避免额外的图片工具或平台字体依赖。
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const directory = Buffer.alloc(6 + icoSizes.length * 16);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(icoSizes.length, 4);
    const icoImages = [];
    let offset = directory.length;
    for (const [index, size] of icoSizes.entries()) {
      const data = await icon(size);
      const entry = 6 + index * 16;
      directory[entry] = directory[entry + 1] = size % 256;
      directory.writeUInt16LE(1, entry + 4);
      directory.writeUInt16LE(32, entry + 6);
      directory.writeUInt32LE(data.length, entry + 8);
      directory.writeUInt32LE(offset, entry + 12);
      icoImages.push(data);
      offset += data.length;
    }
    const ico = Buffer.concat([directory, ...icoImages]);
    assert.equal(offset, ico.length);
    add('electron/assets/icon.ico', ico);
    const chunks = [];
    for (const [type, size] of [
      ['icp4', 16],
      ['icp5', 32],
      ['icp6', 64],
      ['ic07', 128],
      ['ic08', 256],
      ['ic09', 512],
      ['ic10', 1024],
    ]) {
      const data = await icon(size);
      const header = Buffer.alloc(8);
      header.write(type);
      header.writeUInt32BE(data.length + 8, 4);
      chunks.push(header, data);
    }
    const header = Buffer.alloc(8);
    header.write('icns');
    header.writeUInt32BE(8 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4);
    const icns = Buffer.concat([header, ...chunks]);
    assert.equal(header.readUInt32BE(4), icns.length);
    add('electron/assets/icon.icns', icns);

    for (const [path, data] of outputs) {
      const target = join(root, path);
      if (check) assert.ok(readFileSync(target).equals(data), `${path} 需要重新生成`);
      else writeFileSync(target, data);
    }
    console.log(`${check ? 'Verified' : 'Generated'} ${outputs.size} brand assets`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    win?.destroy();
    rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
