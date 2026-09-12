#!/usr/bin/env node
// Cross-file dead-global analysis for the classic-script frontend (analysis only).
// Frontend files share one global scope; a top-level name is a dead candidate when
// it never appears anywhere (other than its own declaration) across all frontend
// files AND the html entry points.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'frontend');
// 从文件系统派生，而不是维护一份手写清单：新增模块必须自动被覆盖。写死清单正是这个
// 仓库反复踩的坑（清单漂移），而且它已经造成过后果——app-state.js / app-utils.js /
// model-selection.js 加进来后没有被分析，脚本报「0 candidates」其实是假绿。
// 排除 test-ui.mjs：它不参与运行时全局作用域（但那道「加载顺序契约」门禁会读它列出的顺序）。
const files = fs
  .readdirSync(ROOT)
  .filter((name) => /\.(js|html)$/.test(name) && name !== 'test-ui.mjs')
  .filter((name) => fs.statSync(path.join(ROOT, name)).isFile())
  .sort();

// Collect declaration lines per file per name.
const decls = new Map(); // name -> [{file, line}]
const body = new Map();  // file -> text

const DECL_RE = /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const CONST_RE = /(?:^|\n)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/g;
const CLASS_RE = /(?:^|\n)class\s+([A-Za-z_$][\w$]*)\b/g;
const WINDOW_RE = /(?:^|\n)window\.([A-Za-z_$][\w$]*)\s*=/g;

function record(name, file, line) {
  if (!decls.has(name)) decls.set(name, []);
  decls.get(name).push({ file, line });
}

for (const file of files) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  body.set(file, text);
  const lines = text.split('\n');
  for (const [re] of [[DECL_RE], [CONST_RE], [CLASS_RE], [WINDOW_RE]]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      const lineNo = text.slice(0, m.index).split('\n').length;
      record(name, file, lineNo);
      // Only the first declaration of a name in a file counts as "the" declaration.
    }
  }
}

// Count total occurrences per name across all files + html.
function countOccurrences(name) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  let total = 0;
  for (const file of files) {
    const text = body.get(file);
    let m;
    while ((m = re.exec(text))) total++;
  }
  return total;
}

const report = [];
for (const [name, sites] of decls) {
  const total = countOccurrences(name);
  const declCount = sites.length;
  const usage = total - declCount;
  if (usage === 0) {
    report.push({ name, declCount, total, sites });
  }
}

report.sort((a, b) => a.name.localeCompare(b.name));
for (const item of report) {
  const where = item.sites.map((s) => `${path.basename(s.file)}:${s.line}`).join(', ');
  console.log(`${item.name}\tdeclared at ${where}\toccurs ${item.total}x total`);
}
console.log(`\n${report.length} dead-global candidates (0 usages outside declarations)`);

// ── 只写不读 ────────────────────────────────────────────────────────────────
//
// 上一步只发现"完全没有引用"的名字。还有一类更隐蔽的：**只被赋值、从未被读取**的状态。
// 实例：`installedModelNames` 有一整套读写函数（installModel / deleteInstalledModel /
// isModelInstalled），但唯一的读者是它自己——没有任何渲染或判断读它，等于维护着一个
// 谁也不看的集合。这类状态不会被"0 引用"发现，因为它确实被引用了。
//
// 判据：把名字的所有出现分成「读」与「写」。写是赋值左值（`x =`、`x +=`、`x++`）与
// 集合修改（`x.add(`、`x.delete(`、`x.set(`、`x.clear(`、`x.push(`）；其余算读。
// 只有写、没有读 → 报告。位于声明行的出现不算读（`let x = []`）。
const WRITE_ONLY_SKIP = new Set(['module', 'exports', 'window', 'document']);
const writeOnly = [];
for (const [name, sites] of decls) {
  if (WRITE_ONLY_SKIP.has(name)) continue;
  let reads = 0;
  let writes = 0;
  const nameRe = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g');
  for (const file of files) {
    const lines = body.get(file).split('\n');
    const declaredLines = new Set(
      sites.filter((site) => site.file === file).map((site) => site.line),
    );
    lines.forEach((line, index) => {
      if (declaredLines.has(index + 1)) return;
      for (const match of line.matchAll(nameRe)) {
        const after = line.slice(match.index + name.length).trimStart();
        const before = line.slice(0, match.index).trimEnd();
        // 注意 `===` / `==` / `!==` / `>=` / `<=` 是**比较**（读），不是赋值。
        const isAssign = /^(?:\+\+|--)|^(?:=(?!=)|\+=|-=|\*=|\/=|\?\?=|\|\|=|&&=)/.test(after.trimStart());
        const isMutation = /^\.(add|delete|set|clear|push|pop|shift|unshift|splice|sort)\s*\(/.test(after);
        const isDeclare = /^(const|let|var)$/.test(before.split(/[\s;({[,]+/).pop() || '');
        if (isDeclare) continue;
        if (isAssign || isMutation) writes += 1;
        else reads += 1;
      }
    });
  }
  if (writes > 0 && reads === 0) {
    const where = sites.map((site) => `${path.basename(site.file)}:${site.line}`).join(', ');
    writeOnly.push({ name, where, writes });
  }
}
writeOnly.sort((a, b) => a.name.localeCompare(b.name));
for (const item of writeOnly) {
  console.log(`${item.name}\tdeclared at ${item.where}\t${item.writes} write(s), 0 reads`);
}
console.log(`\n${writeOnly.length} write-only-global candidates (assigned but never read)`);
