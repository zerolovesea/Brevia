import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只给官网现有的可定位动画接上导出时钟，不重新绘制应用界面。
const root = fileURLToPath(new URL('../', import.meta.url));
const project = join(root, 'output/readme-gif-export');
const assets = join(root, 'docs/assets/showcase/desktop');
const scenes = {
  live: { query: 'scene=live', start: 0, duration: 12 },
  summary: { query: 'scene=summary', start: 0, duration: 12 },
  library: { query: 'scene=library', start: 0, duration: 12 },
  'phone-microphone': {
    query: 'scene=live&capture=microphone',
    start: 6.2,
    duration: 17,
  },
};
const [onlyScene, onlyLanguage] = process.argv.slice(2);
assert(!onlyScene || Object.hasOwn(scenes, onlyScene), 'Unknown scene');
assert(!onlyLanguage || ['zh', 'en'].includes(onlyLanguage), 'Unknown language');
mkdirSync(project, { recursive: true });
for (const name of ['frontend', 'website'])
  cpSync(join(root, name), join(project, name), { recursive: true });
const gsap = join(project, 'gsap.min.js');
// 固定版本并缓存官方分发文件，逐帧渲染时不访问外网。
try {
  readFileSync(gsap);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const response = await fetch('https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js');
  if (!response.ok) throw Error(`GSAP download: ${response.status}`);
  writeFileSync(gsap, await response.text());
}
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
for (const lang of onlyLanguage ? [onlyLanguage] : ['zh', 'en']) {
  mkdirSync(join(assets, lang), { recursive: true });
  for (const [name, { query, start, duration }] of Object.entries(scenes)) {
    if (onlyScene && name !== onlyScene) continue;
    writeFileSync(
      join(project, 'index.html'),
      `<!doctype html>
<html lang="${lang}">
<head><meta charset="UTF-8"><title>Brevia</title>
<script src="./gsap.min.js"></script>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:white}
#root{position:relative;width:100%;height:100%;overflow:hidden}
iframe{display:block;width:1280px;height:800px;border:0;transform:scale(2);transform-origin:top left}
</style></head>
<body><div id="root" data-composition-id="main" data-start="0"
  data-width="2560" data-height="1600" data-duration="${duration}">
<iframe title="Brevia" src="./website/product-motion.html?${query}&lang=${lang}&manual=1&version=v${version}"></iframe>
</div><script>
const frame=document.querySelector('iframe');
let registered=false;
function ready(){
  const player=frame.contentWindow.productMotion;
  if(!player||registered)return;
  registered=true;
  const clock={
    get position(){return 0},
    set position(seconds){
      player.seek((${start}+seconds)*1000);
      // 网页手动播放会暂停 CSS 入场动画；导出时显示控件完整终态。
      for(const animation of frame.contentDocument.getAnimations())
        if(Number.isFinite(animation.effect?.getComputedTiming().endTime))animation.finish();
    }
  };
  player.seek(${start}*1000);
  const tl=gsap.timeline({paused:true});
  tl.to(clock,{position:${duration},duration:${duration},ease:'none'});
  window.__timelines['main']=tl;
  window.__hfForceTimelineRebind?.();
}
frame.addEventListener('load',ready);
addEventListener('message',event=>{
  if(event.source===frame.contentWindow&&event.data?.type==='brevia-motion-ready')ready();
});
</script></body></html>`,
    );
    const output = join(assets, lang, `${name}.gif`);
    console.log(`Exporting ${lang}/${name} (${duration}s, 2560 × 1600)`);
    execFileSync(
      'npx',
      [
        '--yes',
        'hyperframes@0.8.167',
        'render',
        project,
        '--format',
        'gif',
        '--fps',
        '10',
        '--workers',
        '1',
        '--output',
        output,
      ],
      { stdio: 'inherit' },
    );
    const gif = readFileSync(output);
    assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
    assert.equal(gif.readUInt16LE(6), 2560);
    assert.equal(gif.readUInt16LE(8), 1600);
    assert(gif.length < 10 * 1024 * 1024, `${name}: GIF exceeds 10 MiB`);
    const { streams } = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'stream=nb_frames,duration', '-of', 'json', output],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(Number(streams[0].nb_frames), duration * 10, `${name}: incomplete GIF`);
    assert.equal(Number(streams[0].duration), duration, `${name}: incorrect GIF duration`);
  }
}
