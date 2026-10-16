import { fileURLToPath } from 'node:url';

export default {
  name: 'Brevia',
  project: fileURLToPath(new URL('./project.json', import.meta.url)),
  out: fileURLToPath(new URL('./out/1320x2868', import.meta.url)),
  screenshots: fileURLToPath(new URL('./screenshots/zh', import.meta.url)),
  formats: ['as-is'],
  store: 'appstore',
};
