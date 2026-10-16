import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const original = JSON.parse(readFileSync(new URL('../project.json', import.meta.url), 'utf8'));
const headerImage = `data:image/png;base64,${readFileSync(new URL('../screenshots/header-sound-to-text-safe.png', import.meta.url)).toString('base64')}`;
const boards = [];

for (const language of ['zh', 'en']) {
  const source = original.projectData.find(
    (board) => board.name === `${language}-01-record-and-transcribe`,
  );
  assert(source);
  for (const placement of ['header', 'search']) {
    const header = placement === 'header';
    const id = `brevia-${language}-${placement}`;
    const elements = [];
    const add = (element, name, x, y, width, height) => {
      const copy = structuredClone(element);
      Object.assign(copy, {
        id: `${id}-${name}`,
        name,
        position: { x, y },
        size: { width, height },
        rotation: 0,
      });
      elements.push(copy);
      return copy;
    };
    const text = (name, content, x, y, width, height, fontSize, color = '#222222') => {
      const element = add(
        source.elements.find((item) => item.name === 'wordmark'),
        name,
        x,
        y,
        width,
        height,
      );
      Object.assign(element, { content, fontSize, color });
      return element;
    };
    const shape = (name, x, y, width, height, color, radius = 0) => {
      const element = add(
        source.elements.find((item) => item.type === 'shape'),
        name,
        x,
        y,
        width,
        height,
      );
      Object.assign(element, { fillColor: color, borderRadius: radius });
      return element;
    };
    const device = (type, x, y, width) => {
      const template = source.elements.find((item) => item.deviceType === type);
      assert(template);
      return add(template, type, x, y, width, width * (type === 'macbook' ? 0.67 : 2.17));
    };

    if (header) {
      elements.push({
        id: `${id}-scene`,
        type: 'image',
        name: 'sound-to-text-scene',
        position: { x: 0, y: 0 },
        size: { width: 3840, height: 1646 },
        rotation: 0,
        scale: 1,
        imageSrc: headerImage,
        imageAlt: 'Sound flows from a phone recording into a document on a computer.',
        objectFit: 'cover',
        borderRadius: 0,
      });
      text(
        'headline',
        language === 'zh'
          ? '随身录音，电脑接力。'
          : 'Record anywhere.\nTranscribe on your computer.',
        720,
        225,
        2400,
        330,
        language === 'zh' ? 44 : 30,
      ).textAlign = 'center';
    } else {
      shape('quiet-disc', 1240, 820, 1790, 1510, '#E5DCD2', 755);
      text('wordmark', 'BREVIA', 420, 300, 1100, 100, 23);
      shape('accent', 420, 450, 100, 10, '#EE4439', 5);
      text(
        'headline',
        language === 'zh'
          ? '手机录音，电脑转写。'
          : 'Your phone records.\nYour computer transcribes.',
        415,
        535,
        3070,
        language === 'zh' ? 320 : 450,
        language === 'zh' ? 68 : 54,
      );
      device('macbook', 1370, 1110, 2030);
      device('iphone-17-pro-max', 540, 1000, 610);
      // 波形连接录音端与识别端，不暗示手机本地识别。
      [18, 30, 52, 76, 42, 28, 60, 88, 54, 34, 18].forEach((height, index) => {
        shape(`wave-${index}`, 1165 + index * 15, 1635 - height / 2, 6, height, '#EE4439', 3);
      });
    }

    const size = { width: 3840, height: header ? 1646 : 2560 };
    for (const element of elements) {
      const { x, y } = element.position;
      assert(x >= 0 && y >= 0);
      assert(x + element.size.width <= size.width, element.name);
      assert(y + element.size.height <= size.height, element.name);
    }
    boards.push({
      id,
      name: `${language}-${placement}${header ? '-final' : ''}`,
      position: { x: boards.length * 4000, y: 0 },
      size,
      backgroundColor: '#F2EEE8',
      backgroundType: 'solid',
      zoom: 1,
      elements,
    });
  }
}

assert.equal(boards.length, 4);
writeFileSync(
  new URL('../project-creative.json', import.meta.url),
  JSON.stringify(
    {
      id: 'brevia-ios-1.0.1-creative',
      name: 'Brevia · Header & Search · 中文 & English',
      description:
        'Native editable creative assets using the existing Brevia screenshot design and device content.',
      category: 'screenshots',
      timestamp: new Date().toISOString(),
      projectData: boards,
    },
    null,
    2,
  ),
);
console.log('Created four editable header and search artboards.');
