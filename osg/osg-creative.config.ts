import { fileURLToPath } from 'node:url';

export default {
  name: 'Brevia creative assets',
  project: fileURLToPath(new URL('./project-creative.json', import.meta.url)),
  out: fileURLToPath(new URL('./out/creative', import.meta.url)),
  formats: ['as-is'],
  store: 'appstore',
};
