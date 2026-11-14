import { mkdir, copyFile } from 'node:fs/promises';
const output = new URL('./public/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of [
  'styles.css',
  'design-layout.css',
  'desktop-shell.css',
  'desktop-workspace.css',
  'ui-components.js',
  'meeting-evidence.js',
  'app-utils.js',
  'i18n-data.js',
]) {
  await copyFile(new URL(`../../frontend/${file}`, import.meta.url), new URL(file, output));
}
for (const file of ['index.html', 'viewer.js', 'viewer.css'])
  await copyFile(new URL(file, import.meta.url), new URL(file, output));

for (const [source, target] of [
  ['website/assets/brevia-logo-handdrawn.svg', 'brevia-logo.svg'],
  ['website/assets/fonts/manrope.woff2', 'manrope.woff2'],
  ['website/assets/fonts/Manrope-OFL.txt', 'manrope-license.txt'],
  ['node_modules/marked/lib/marked.umd.js', 'marked.js'],
  ['node_modules/marked/LICENSE', 'marked-license.txt'],
  ['node_modules/dompurify/dist/purify.min.js', 'purify.js'],
  ['node_modules/dompurify/LICENSE', 'purify-license.txt'],
]) {
  await copyFile(new URL(`../../${source}`, import.meta.url), new URL(target, output));
}
await copyFile(
  new URL('../../website/assets/brevia-mark.svg', import.meta.url),
  new URL('brevia-mark.svg', output),
);
