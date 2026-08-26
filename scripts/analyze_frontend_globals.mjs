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
const files = [
  'index.html', 'floating-caption.html',
  'backend-client.js', 'ui-data.js', 'i18n.js', 'i18n-data.js', 'ui-components.js',
  'workspaces.js', 'app-meetings.js', 'app-meeting-detail.js', 'onboarding.js',
  'audio-processor.js', 'app.js', 'floating-caption.js',
].filter((f) => fs.existsSync(path.join(ROOT, f)));

// Collect declaration lines per file per name.
const decls = new Map(); // name -> [{file, line}]
const body = new Map();  // file -> text

const DECL_RE = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const CONST_RE = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/g;
const CLASS_RE = /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)\b/g;
const WINDOW_RE = /(?:^|\n)\s*window\.([A-Za-z_$][\w$]*)\s*=/g;

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
