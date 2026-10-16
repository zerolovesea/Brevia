import config from './osg.config';
import { fileURLToPath } from 'node:url';

export default {
  ...config,
  project: fileURLToPath(new URL('./project-medium.json', import.meta.url)),
  out: fileURLToPath(new URL('./out/1206x2622', import.meta.url)),
  formats: ['as-is'],
};
