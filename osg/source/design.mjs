import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = (name) => path.join(root, name);
const image = (name) =>
  `data:${name.endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${readFileSync(file(name)).toString('base64')}`;
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const logo = image('screenshots/brevia-logo.png');
mkdirSync(file('screenshots/desktop'), { recursive: true });

// 依照现有桌面界面重绘，会议内容为虚构示例。
function desktop(language, pairing = false, mic = false) {
  const c = (zh, en) => (language === 'zh' ? zh : en);
  const svg = [];
  const rect = (x, y, w, h, fill = '#fff', r = 0, stroke = 'none') =>
    svg.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`,
    );
  const txt = (x, y, s, size = 25, weight = 400, color = '#222') =>
    svg.push(
      `<text x="${x}" y="${y}" font-family="PingFang SC,Helvetica Neue,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${escape(s)}</text>`,
    );
  rect(0, 0, 1600, 1000, '#fff', 24);
  rect(0, 0, 1600, 48, '#fafafa');
  rect(0, 48, 84, 952, '#fafafa');
  ['#ff6058', '#ffbd2e', '#28c840'].forEach((fill, i) =>
    svg.push(`<circle cx="${25 + i * 25}" cy="24" r="7" fill="${fill}"/>`),
  );
  txt(755, 31, 'Brevia', 19, 600, '#555');
  svg.push(`<image href="${logo}" x="18" y="82" width="48" height="48"/>`);
  ['＋', '↥', '▤', '⌕'].forEach((s, i) => txt(29, 201 + i * 72, s, 34));
  txt(30, 921, '▯', 32);
  txt(28, 974, '⚙', 29);
  if (pairing) {
    rect(84, 48, 230, 952, '#fff', 0, '#e5e5e5');
    txt(112, 118, c('设置', 'Settings'), 30, 700);
    [
      c('通用', 'General'),
      c('模型库', 'Models'),
      c('AI 功能', 'AI features'),
      c('进阶设置', 'Advanced'),
      c('声纹管理', 'Voice profiles'),
      c('设备连接', 'Devices'),
      c('存储与隐私', 'Storage & privacy'),
    ].forEach((s, i) => {
      if (i === 5) rect(100, 172 + i * 69, 198, 54, '#f1f1f1', 12);
      txt(120, 208 + i * 69, s, 24, i === 5 ? 600 : 400);
    });
    txt(356, 123, c('设备连接', 'Device connection'), 44, 700);
    txt(
      356,
      171,
      c(
        '把手机变成随身录音助手，让对话回到电脑整理。',
        'Record on your phone. Continue on your computer.',
      ),
      23,
      400,
      '#666',
    );
    rect(356, 207, 1188, 2, '#e7e7e7');
    txt(356, 262, c('手机连接服务', 'Phone connection service'), 29, 600);
    rect(915, 232, 66, 34, '#222', 17);
    svg.push('<circle cx="964" cy="249" r="13" fill="white"/>');
    txt(1001, 259, c('已开启', 'Enabled'), 24);
    rect(356, 306, 566, 455, '#fff', 14, '#dedede');
    rect(950, 306, 594, 455, '#fff', 14, '#dedede');
    rect(530, 358, 45, 76, 'none', 8, '#222');
    rect(708, 360, 87, 60, 'none', 6, '#222');
    rect(696, 429, 112, 5, '#222', 2);
    txt(622, 402, '···', 36);
    txt(478, 510, c('连接你的手机', 'Connect your iPhone'), 30, 600);
    txt(
      412,
      562,
      c('扫码或输入配对码，然后在电脑确认。', 'Pair by QR code or PIN, then approve.'),
      22,
      400,
      '#666',
    );
    rect(491, 612, 292, 62, '#222', 12);
    txt(541, 652, c('连接新设备', 'Connect device'), 26, 600, '#fff');
    txt(980, 361, c('已信任设备', 'Trusted devices'), 30, 600);
    rect(991, 412, 43, 74, 'none', 8, '#333');
    txt(1059, 443, 'iPhone 15 Pro', 26, 600);
    txt(1059, 481, c('已连接 · 此电脑', 'Connected to this computer'), 21, 400, '#38845c');
    txt(356, 831, c('连接后你可以', 'Once connected'), 27, 600);
    txt(356, 890, c('手机录音与实时转写', 'Record & transcribe'), 25, 600);
    txt(833, 890, c('上传离线录音', 'Upload offline audio'), 25, 600);
    txt(1250, 890, c('电脑调用手机', 'Use phone mic'), 25, 600);
  } else {
    txt(124, 126, c('设计周会', 'Design review'), 42, 700);
    svg.push('<circle cx="134" cy="169" r="7" fill="#ff3b30"/>');
    txt(155, 178, c('正在录制', 'Recording'), 24, 500, '#e33d31');
    txt(301, 178, '12:36', 24, 500, '#666');
    txt(416, 178, c('✓ 已保存', '✓ Saved'), 24, 400, '#666');
    rect(124, 216, 644, 653, '#fff', 14, '#dedede');
    rect(788, 216, 748, 653, '#fff', 14, '#dedede');
    txt(151, 268, c('我的笔记', 'My notes'), 28, 600);
    txt(592, 268, c('AI 笔记 开', 'AI notes on'), 20, 400, '#666');
    txt(817, 268, c('实时转写', 'Live transcript'), 28, 600);
    txt(151, 356, c('本周决定', 'Decisions'), 30, 650);
    txt(151, 410, c('• 周五发布新的引导页面。', '• Ship the new onboarding on Friday.'), 23);
    txt(151, 510, c('下一步', 'Next steps'), 30, 650);
    txt(151, 564, c('• 完成文案核对。', '• Review the copy.'), 23);
    txt(151, 615, c('• 准备下一轮用户访谈。', '• Prepare the next round of interviews.'), 23);
    [
      ['00:00', c('我们先看一下这周的设计进展。', 'Let’s review this week’s design progress.')],
      ['00:12', c('新的引导页面已经准备好了。', 'The new onboarding is ready.')],
      [
        '00:18',
        c('计划周五发布，然后安排用户访谈。', 'Ship it on Friday, then plan user interviews.'),
      ],
    ].forEach(([time, line], i) => {
      txt(817, 345 + i * 145, time, 20, 400, '#777');
      txt(817, 390 + i * 145, line, 23);
      rect(817, 433 + i * 145, 686, 1, '#e4e4e4');
    });
    rect(124, 908, 1412, 1, '#ddd');
    [13, 22, 31, 18, 27, 14].forEach((h, i) => rect(131 + i * 9, 954 - h / 2, 4, h, '#777', 2));
    txt(
      205,
      962,
      mic
        ? c('iPhone 15 Pro · 手机麦克风', 'iPhone 15 Pro · Phone microphone')
        : c('手机录音 · 已连接', 'Phone recording · Connected'),
      24,
      500,
      '#555',
    );
    rect(1087, 927, 128, 57, '#f6f6f6', 11, '#ddd');
    txt(1110, 964, c('Ⅱ 暂停', 'Ⅱ Pause'), 23);
    rect(1230, 927, 112, 57, '#fff', 11, '#ddd');
    txt(1252, 964, c('重点', 'Mark'), 23);
    rect(1357, 927, 179, 57, '#fff', 11, '#f19a95');
    txt(1375, 964, c('□ 结束会议', '□ End meeting'), 22, 500, '#ed3e31');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">${svg.join('')}</svg>`;
}
for (const lang of ['zh', 'en'])
  for (const [name, pair, mic] of [
    ['live', false, false],
    ['pairing', true, false],
    ['mic', false, true],
  ])
    writeFileSync(file(`screenshots/desktop/${lang}-${name}.svg`), desktop(lang, pair, mic));

const ink = '#222222',
  red = '#EE4439',
  muted = '#66635F',
  font = 'Noto Sans SC';
const text = (
  content,
  x,
  y,
  width,
  height,
  fontSize = 14,
  color = ink,
  weight = 'normal',
  name = content,
) => ({
  type: 'text',
  content,
  x,
  y,
  width,
  height,
  fontSize,
  color,
  fontFamily: font,
  fontWeight: weight,
  lineHeight: 1.16,
  letterSpacing: 0,
  name,
});
const shape = (x, y, width, height, fillColor, borderRadius = 0) => ({
  type: 'shape',
  subType: 'rectangle',
  x,
  y,
  width,
  height,
  fillColor,
  borderRadius,
  strokeWidth: 0,
});
const phone = (lang, shot, x, y, width, rotation = 0) => ({
  type: 'device',
  subType: 'iphone-17-pro-max',
  x,
  y,
  width,
  height: width * 2.17,
  rotation,
  screenshotSrc: image(`screenshots/${lang}/${shot}.png`),
  screenshotObjectFit: 'contain',
  frameColor: '#2a2b2d',
  notchColor: '#101112',
  styleType: 'normal',
  name: `phone-${shot}`,
  shadow: { x: 0, y: 20, blur: 42, color: 'rgba(25,20,15,0.15)' },
});
const laptop = (lang, shot, x, y, width, rotation = 0) => ({
  type: 'device',
  subType: 'macbook',
  x,
  y,
  width,
  height: width * 0.67,
  rotation,
  screenshotSrc: image(`screenshots/desktop/${lang}-${shot}.svg`),
  screenshotObjectFit: 'contain',
  styleType: 'normal',
  frameColor: '#414244',
  name: `desktop-${shot}`,
  shadow: { x: 0, y: 22, blur: 40, color: 'rgba(25,20,15,0.12)' },
});
const copy = {
  zh: [
    ['随身录音。\n电脑接力。', '声音留在手边，文字回到眼前。', '手机录音 → 电脑识别 → 手机查看'],
    ['两台设备，\n一次连接。', '扫码或输入配对码，在电脑确认即可。', '首次配对需在同一局域网'],
    [
      '手机负责录。\n电脑负责识别。',
      '识别在自己的电脑运行，转写实时回到手机。',
      '需电脑在线，并安装语音识别模型',
    ],
    [
      '你的手机，\n也是电脑的麦克风。',
      '电脑发起会议，手机采集音频。\n逐字稿与笔记留在电脑。',
      '电脑控制会议 · 手机保留录音',
    ],
    [
      '先录下来。\n稍后再转写。',
      '离线也能录音，连接后由你确认上传。',
      '选择电脑 → 确认上传 → 电脑识别',
    ],
  ],
  en: [
    [
      'Record anywhere.\nTranscribe on desktop.',
      'Capture on iPhone. Turn speech into text with your computer.',
      'Phone audio → Desktop recognition → Text on iPhone',
    ],
    [
      'Two devices.\nOne connection.',
      'Scan a QR code or enter a PIN, then approve on your computer.',
      'First-time pairing requires the same local network',
    ],
    [
      'Your phone records.\nYour computer transcribes.',
      'Recognition runs on your computer. Text comes back to iPhone.',
      'Requires an online computer and a speech model',
    ],
    [
      'Your phone.\nYour desktop microphone.',
      'Start on your computer. Capture audio on iPhone.\nTranscripts and notes stay on your computer.',
      'Control on desktop · Keep audio on iPhone',
    ],
    [
      'Record now.\nTranscribe later.',
      'No connection? Keep recording. Choose when to upload.',
      'Choose a computer → Confirm upload → Transcribe',
    ],
  ],
};
const backgrounds = ['#F2EEE8', '#F6F5F2', '#191B1E', '#E8ECE7', '#F5E9E3'];
const names = [
  '01-record-and-transcribe',
  '02-pair-devices',
  '03-live-transcription',
  '04-phone-as-desktop-mic',
  '05-offline-and-upload',
];
const calls = [];
for (const lang of ['zh', 'en'])
  for (let i = 0; i < 5; i++) {
    const en = lang === 'en',
      dark = i === 2,
      color = dark ? '#F8F7F3' : ink,
      subdued = dark ? '#BDBFBE' : muted;
    const [headline, subtitle, footer] = copy[lang][i];
    const elements = [
      text('BREVIA', 84, 92, 650, 78, 16, color, 'bold', 'wordmark'),
      shape(84, 194, 52, 7, red, 4),
      text(`0${i + 1} / 05`, 1070, 100, 180, 60, 11, subdued, 'normal', 'sequence'),
      text(
        headline,
        82,
        260,
        1160,
        410,
        en ? ([0, 2, 3].includes(i) ? 28 : 35) : i === 3 ? 34 : 42,
        color,
        'bold',
        'headline',
      ),
      text(subtitle, 88, 728, 1152, 195, en ? 14 : 15, subdued, 'normal', 'subtitle'),
    ];
    if (i === 0) {
      elements.push(
        shape(538, 1030, 730, 730, '#E5DCD2', 365),
        phone(lang, '03-live', 417, 970, 710, 4),
        laptop(lang, 'live', 64, 1955, 1030, -3),
        text(
          en ? 'RECORD ON IPHONE' : '手机随手录',
          80,
          1135,
          330,
          en ? 140 : 80,
          en ? 11 : 13,
          muted,
          'bold',
          'capture-label',
        ),
        text(
          en ? 'TRANSCRIBE\nON YOUR COMPUTER' : '电脑本地识别',
          90,
          en ? 1755 : 1835,
          330,
          140,
          en ? 10 : 13,
          ink,
          'bold',
          'desktop-label',
        ),
      );
    }
    if (i === 1) {
      elements.push(
        shape(65, 1090, 1180, 1180, '#E8E4DC', 590),
        laptop(lang, 'pairing', 35, 1080, 1010, -4),
        phone(lang, '02-connection', 664, 1435, 555, 4),
        text(
          en ? 'SCAN OR ENTER A PIN' : '扫码或输入配对码',
          90,
          2210,
          550,
          110,
          en ? 11 : 14,
          ink,
          'bold',
          'pairing-label',
        ),
        text(
          en
            ? 'Approve on your computer.\nYour devices are now paired.'
            : '电脑确认后，\n建立你的设备连接。',
          90,
          2355,
          530,
          160,
          12,
          muted,
          'normal',
          'pairing-detail',
        ),
      );
    }
    if (i === 2) {
      elements.push(
        shape(560, 1120, 730, 730, '#2C3033', 365),
        phone(lang, '03-live', 100, 998, 740, -3),
        laptop(lang, 'live', 615, 1770, 630, 3),
        text(
          en ? 'AUDIO IN.\nTEXT BACK.' : '边录音，\n边看转写。',
          835,
          1160,
          385,
          235,
          en ? 17 : 19,
          '#F8F7F3',
          'bold',
          'live-label',
        ),
      );
    }
    if (i === 3) {
      elements.push(
        shape(80, 1045, 1150, 1150, '#D8E1D7', 575),
        laptop(lang, 'mic', 65, 1080, 1190, -2),
        phone(lang, '06-desktop-mic', 728, 1570, 500, 5),
        text(
          en ? 'PUT YOUR PHONE\nCLOSER TO THE CONVERSATION.' : '把手机，\n放到对话更近处。',
          87,
          2250,
          615,
          185,
          en ? 12 : 19,
          ink,
          'bold',
          'mic-label',
        ),
        text(
          en
            ? 'Select iPhone as the recording source\nin the desktop app.'
            : '在电脑端选择手机作为录音来源。',
          90,
          2495,
          590,
          180,
          11,
          muted,
          'normal',
          'mic-detail',
        ),
      );
    }
    if (i === 4) {
      elements.push(
        shape(90, 1030, 1125, 1125, '#EAD6CD', 562),
        text(
          en ? '01  RECORD OFFLINE' : '01  先离线录音',
          85,
          973,
          620,
          85,
          12,
          ink,
          'bold',
          'offline-label',
        ),
        phone(lang, '05-offline', 70, 1110, 600, -3),
        text(
          en ? '02  UPLOAD WHEN READY' : '02  确认后上传',
          670,
          1310,
          610,
          85,
          12,
          ink,
          'bold',
          'upload-label',
        ),
        phone(lang, '07-upload', 696, 1450, 550, 3),
        text(
          en ? 'Your recording stays\non your iPhone.' : '原始录音，\n保留在手机。',
          95,
          2510,
          580,
          135,
          13,
          muted,
          'normal',
          'offline-detail',
        ),
      );
    }
    elements.push(
      shape(88, 2740, 1138, 2, dark ? '#424548' : '#CEC8C0'),
      text(footer, 90, 2770, 1140, 75, en ? 9 : 11, subdued, 'normal', 'footer'),
    );
    assert(elements.some((e) => e.type === 'device' && e.subType === 'iphone-17-pro-max'));
    calls.push(
      {
        tool: 'create_artboard',
        args: {
          name: `${lang}-${names[i]}`,
          width: 1320,
          height: 2868,
          backgroundColor: backgrounds[i],
        },
      },
      { tool: 'add_elements', args: { elements } },
    );
  }
assert.equal(calls.filter((c) => c.tool === 'create_artboard').length, 10);
// 使用工具实际导出的原生工程结构，避开 CLI 0.1.34 编辑后保存画板的兼容问题。
const projectData = [];
for (let i = 0; i < calls.length; i += 2) {
  const board = calls[i].args;
  const id = `brevia-${board.name}`;
  const elements = calls[i + 1].args.elements.map((input, index) => {
    const { x, y, width, height, subType, ...rest } = input;
    const element = {
      ...rest,
      id: `${id}-${index}`,
      position: { x, y },
      size: { width, height },
      rotation: rest.rotation ?? 0,
      scale: 1,
    };
    if (element.type === 'shape') element.shapeType = subType;
    if (element.type === 'device') {
      element.deviceType = subType;
      element.screenshotRect = { left: 0, top: 0, width: 100, height: 100 };
      element.naturalScreenshotWidth = subType === 'macbook' ? 1600 : 1560;
      element.naturalScreenshotHeight = subType === 'macbook' ? 1000 : 3376;
    }
    if (element.type === 'text') element.textAlign = 'left';
    return element;
  });
  projectData.push({
    id,
    name: board.name,
    position: { x: 15 + (i / 2) * 450, y: 15 },
    size: { width: 1320, height: 2868 },
    backgroundColor: board.backgroundColor,
    backgroundType: 'solid',
    zoom: 1,
    elements,
  });
}
assert.equal(projectData.length, 10);
writeFileSync(
  file('project.json'),
  JSON.stringify(
    {
      id: 'brevia-ios-1.0.1-store',
      name: 'Brevia · iOS 1.0.1 · 中文 & English',
      description:
        'Five feature stories in Chinese and English. Production Flutter widgets with fictional content; desktop UI redrawn from the current application.',
      category: 'screenshots',
      timestamp: new Date().toISOString(),
      projectData,
    },
    null,
    2,
  ),
);
console.log('Wrote 10 editable Open Screenshot Generator artboards.');
