// 静态出现位置是组件声明清单，不冒充运行时按钮数量；动态实例继承同一规则。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rules = {
  control: {
    states: ['default', 'hover', 'pressed', 'focus', 'disabled'],
    motion: '颜色120ms；按下80ms；离散主控件缩放，行与卡片不缩放；释放180ms',
    reduced: '保留颜色与焦点，移除缩放和弹性',
  },
  navigation: {
    states: ['default', 'hover', 'pressed', 'focus', 'selected', 'disabled'],
    motion: '同级/桌面页内正文即时交接；父子280/180ms且不淡空正文；指示180ms；系统路由保持原生',
    reduced: '直接切换，保留选择、返回手势、焦点和草稿',
  },
  field: {
    states: ['empty', 'focused', 'editing', 'valid', 'error', 'disabled'],
    motion: '边界120ms；输入和验证即时；错误原位出现，不摇晃、不移动光标',
    reduced: '状态文字和边界直接更新',
  },
  choice: {
    states: ['unchecked', 'checked', 'focus', 'disabled'],
    motion: '选中底/滑块120–180ms；真实选择当帧更新',
    reduced: '选中态直接就位',
  },
  range: {
    states: ['idle', 'dragging', 'focus', 'disabled'],
    motion: '跟手直接更新；真实进度最多120ms插值，不编造进度',
    reduced: '手柄与真实百分比直接更新',
  },
  disclosure: {
    states: ['closed', 'open', 'hover', 'pressed', 'focus'],
    motion: '菜单160/100ms；正文披露直接布局，内容120ms接手',
    reduced: '直接展开或关闭，不延迟操作',
  },
  external: {
    states: ['default', 'hover', 'pressed', 'focus'],
    motion: '链接120ms颜色/透明度；外部导航由系统负责',
    reduced: '保留文字和焦点，无空间动画',
  },
  drag: {
    states: ['idle', 'pressed', 'dragging', 'released', 'cancelled', 'disabled'],
    motion: '拖动零延迟跟手；松开140ms吸附；取消回原位，删除仍需原有确认',
    reduced: '继续跟手；松开直接就位',
  },
  native: {
    states: ['default', 'hover', 'pressed', 'focus', 'selected', 'disabled'],
    motion: '沿用Material/Cupertino的触控、选择与系统手势；主题共享Token',
    reduced: '遵从系统减少动画，保留原生语义与返回',
  },
};
function filesIn(directory, extension) {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      if (['assets', 'vendor', 'build', 'test'].includes(name)) return [];
      return statSync(path).isDirectory()
        ? filesIn(path, extension)
        : extension.test(name) && !/^test[-.]/.test(name)
          ? [path]
          : [];
    });
}
function scan(source, file) {
  const dart = file.endsWith('.dart');
  const pattern = dart
    ? /\b([A-Z]\w*(?:Button|ButtonFormField|ButtonMenu)|IconButton|InkWell|GestureDetector|ListTile|Switch(?:ListTile)?|Checkbox(?:ListTile)?|Radio(?:ListTile)?|Slider|RangeSlider|TextField|TextFormField|SegmentedButton|NavigationBar|NavigationDestination|PopupMenuButton|PopupMenuItem|DropdownMenuItem)(?:\.\w+)?(?:<[^>\n]*>)?\s*\(/g
    : /<([a-z][\w-]*)\b|document\.createElement\(['"](button|a|input|textarea|select|summary)['"]\)|\b[\w.]+\.setAttribute\(['"]role['"],\s*['"](button|slider|checkbox|radio|switch|tab)['"]\)|\b[\w.]+\.setAttribute\(['"](contenteditable)['"],\s*['"]true['"]\)/g;
  const items = [];
  for (const match of source.matchAll(pattern)) {
    if (dart && /\.styleFrom\s*\(/.test(match[0])) continue;
    const prefix = source.slice(0, match.index);
    const line = prefix.split('\n').length;
    const boundary =
      dart || match[2] || match[3] || match[4]
        ? source.indexOf('\n', match.index)
        : source.indexOf('>', match.index);
    const markup = source.slice(match.index, boundary < 0 ? match.index + 200 : boundary + 1);
    const type = match[1] || match[2] || match[3] || match[4];
    if (
      !dart &&
      !match[3] &&
      !match[4] &&
      !['button', 'a', 'input', 'textarea', 'select', 'summary'].includes(type) &&
      !/(?:role=["'](?:button|slider|checkbox|radio|switch|tab)["']|tabindex=["']0["']|contenteditable=["']true["'])/.test(
        markup,
      )
    )
      continue;
    if (!dart && type === 'input' && /type=["']hidden["']/.test(markup)) continue;
    let rule = 'control';
    if (/PopupMenuItem|DropdownMenuItem|NotificationButton/.test(type)) rule = 'native';
    else if (/GestureDetector/.test(type)) rule = 'drag';
    else if (
      /TextField|TextFormField/.test(type) ||
      ['textarea', 'select', 'contenteditable'].includes(type) ||
      /contenteditable=["']true["']/.test(markup)
    )
      rule = 'field';
    else if (type === 'input')
      rule = /type=["']range/.test(markup)
        ? 'range'
        : /type=["'](?:checkbox|radio)/.test(markup)
          ? 'choice'
          : 'field';
    else if (
      /Switch|Checkbox|Radio|Segmented/.test(type) ||
      /^(checkbox|radio|switch)$/.test(type) ||
      /role=["'](?:checkbox|radio|switch)["']/.test(markup)
    )
      rule = 'choice';
    else if (/Slider|^slider$/.test(type) || /role=["']slider["']/.test(markup)) rule = 'range';
    else if (
      /data-(?:view|detail-tab|settings-modal|ai-settings-tab|workspace-id|meeting-index)|NavigationBar|NavigationDestination/.test(
        markup + type,
      )
    )
      rule = 'navigation';
    else if (type === 'summary' || /PopupMenu/.test(type)) rule = 'disclosure';
    else if (type === 'a') rule = /href=["']#/.test(markup) ? 'navigation' : 'external';
    else if (/InkWell|ListTile|Dropdown/.test(type)) rule = 'native';
    items.push({ file, line, type, rule });
  }
  return items;
}
assert.equal(
  scan(
    '<button data-view="home">x</button><input type="hidden"><summary>x</summary>',
    'sample.html',
  ).length,
  2,
);
assert.deepEqual(
  scan('<button data-view="home">x</button><input type="range">', 'sample.html').map((i) => i.rule),
  ['navigation', 'range'],
);
assert.deepEqual(
  scan('IconButton(onPressed: x); TextField(); GestureDetector();', 'sample.dart').map(
    (i) => i.rule,
  ),
  ['control', 'field', 'drag'],
);
assert.equal(
  scan('IconButton.styleFrom(); IconButton.filled(onPressed: x);', 'sample.dart').length,
  1,
);
assert.equal(scan('NotificationButton(id: "pause");', 'sample.dart')[0].rule, 'native');
assert.equal(scan("card.setAttribute('role', 'button');", 'sample.js')[0].rule, 'control');
assert.equal(scan("editor.setAttribute('contenteditable', 'true');", 'sample.js')[0].rule, 'field');
assert.equal(
  scan("const button = document.createElement('button');", 'sample.js')[0].type,
  'button',
);
assert.deepEqual(
  scan(
    '<article tabindex="0" data-meeting-index="0"></article><div role="slider" tabindex="0"></div><span role="checkbox" aria-disabled="true"></span><div>静态</div>',
    'sample.html',
  ).map((item) => item.rule),
  ['navigation', 'range', 'choice'],
);
const files = [
  ...filesIn(join(root, 'frontend'), /\.(js|html)$/),
  ...filesIn(join(root, 'mobile/lib'), /\.dart$/),
  ...filesIn(join(root, 'website'), /\.(js|html)$/),
];
const controls = files.flatMap((file) =>
  scan(readFileSync(file, 'utf8'), relative(root, file).replaceAll('\\', '/')),
);
assert.ok(controls.length > 300, '扫描范围异常缩小');
for (const item of controls) assert.ok(rules[item.rule], `${item.file}:${item.line} 缺少动效规则`);
console.log(
  `Motion inventory: ${controls.length} control declarations, ${new Set(controls.map((c) => c.file)).size} files, ${Object.keys(rules).length} explicit rules; no unassigned controls.`,
);
