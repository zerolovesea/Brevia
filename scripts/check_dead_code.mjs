#!/usr/bin/env node
// 死代码门禁：分析器出现发现或执行失败时阻止检查。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ANALYZERS = [
  { name: 'frontend', command: 'node', args: ['scripts/analyze_frontend_globals.mjs'] },
  { name: 'desktop', command: 'node', args: ['scripts/analyze_desktop_dead.mjs'] },
  { name: 'website', command: 'node', args: ['scripts/analyze_website_globals.mjs'] },
];

// 分析器的输出末尾有一句汇总（"N dead-... candidates" / "N dead-... names"）；
// 其余行才是逐个发现。只认发现行，避免把汇总本身当成发现。
// 分析器的汇总行有三种：dead-global / dead-name / write-only-global candidates。
const SUMMARY = /^\s*\d+ (?:dead-[a-z-]+|write-only-global) (candidates|names)\b/;

let failed = false;
for (const { name, command, args } of ANALYZERS) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  if (result.error) {
    console.error(`[dead-code] ${name}: 无法运行 ${command} — ${result.error.message}`);
    failed = true;
    continue;
  }
  // 只看 stdout 会把「分析器自己崩了」当成绿灯：崩掉的进程 stdout 为空，发现数自然是 0。
  // 必须同时要求退出码为 0，否则这个门禁在分析器坏掉时会静默失效。
  if (result.status !== 0) {
    failed = true;
    console.error(`[dead-code] ${name}: 分析器以退出码 ${result.status} 结束`);
    const detail = (result.stderr || result.stdout || '').trim();
    if (detail)
      console.error(
        detail
          .split('\n')
          .slice(-15)
          .map((line) => `  ${line}`)
          .join('\n'),
      );
    continue;
  }
  const findings = result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !SUMMARY.test(line));
  if (findings.length) {
    failed = true;
    console.error(`[dead-code] ${name}: ${findings.length} 条发现`);
    for (const line of findings) console.error(`  ${line}`);
  } else {
    console.log(`[dead-code] ${name}: ok`);
  }
}

if (failed) {
  console.error(
    '\n死代码门禁未通过。若某条发现是刻意保留的（例如供外部调用的协议入口），' +
      '应把它从分析器的判定范围里排除并写明理由，而不是留着一条绿灯的例外。',
  );
  process.exit(1);
}
console.log('dead-code gate passed');
