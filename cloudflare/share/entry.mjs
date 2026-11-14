import { DurableObject } from 'cloudflare:workers';
export { default } from './worker.mjs';

export class ShareViews extends DurableObject {
  async increment(expiresAt) {
    if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= Date.now())
      throw new Error('Expired');
    return this.ctx.storage.transaction(async (storage) => {
      const views = ((await storage.get('views')) || 0) + 1;
      await storage.put('views', views);
      await storage.setAlarm(expiresAt * 1000);
      return views;
    });
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
