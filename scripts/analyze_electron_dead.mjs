#!/usr/bin/env node
// Dead-name analysis for electron/ files (analysis only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = ['main.js', 'main-logic.js', 'preload.js'].map((f) => path.join(__dirname, '..', 'electron', f));

const body = new Map();
const decls = new Map();

const DECL_RE = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const CONST_RE = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/g;
const CLASS_RE = /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)\b/g;
const MODULE_RE = /(?:^|\n)\s*module\.exports\.([A-Za-z_$][\w$]*)\s*=/g;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  body.set(file, text);
  for (const re of [DECL_RE, CONST_RE, CLASS_RE, MODULE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      if (!decls.has(name)) decls.set(name, []);
      decls.get(name).push(path.basename(file));
    }
  }
}

function countOccurrences(name) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  let total = 0;
  for (const file of files) {
    let m;
    while ((m = re.exec(body.get(file)))) total++;
  }
  return total;
}

let found = 0;
for (const [name, sites] of [...decls.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const total = countOccurrences(name);
  const usage = total - sites.length;
  if (usage === 0) {
    console.log(`${name}\tdeclared in ${sites.join(', ')}\toccurs ${total}x total`);
    found++;
  }
}
console.log(`\n${found} dead-name candidates`);
