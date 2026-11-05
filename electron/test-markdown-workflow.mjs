import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  open,
  readdir,
  stat,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import workflow from './markdown-workflow.js';

const { markdownTarget, syncMarkdown, serializeMarkdown, sendGroupSummary } = workflow;
const root = await mkdtemp(path.join(tmpdir(), 'brevia-workflow-'));
try {
  const vault = path.join(await realpath(root), 'vault');
  await mkdir(vault);
  const meeting = {
    id: randomUUID(),
    title: 'Planning',
    summary: { data: { markdown: 'First draft' } },
  };
  const recordings = path.join(root, 'recordings');
  await mkdir(path.join(recordings, meeting.id), { recursive: true });
  const noPicker = () => assert.fail('already chose a directory');
  const sync = (mode = 'sync', picker = noPicker, item = meeting) =>
    syncMarkdown(
      root,
      recordings,
      async () => {
        await stat(path.join(recordings, item.id));
        return item;
      },
      mode,
      picker,
    );
  assert.equal(await sync('sync', () => null), null);
  const foreign = path.join(vault, 'Planning.md');
  await writeFile(foreign, 'my existing note');
  const { path: file } = await sync('sync', () => vault);
  assert.equal(path.basename(file), 'Planning (2).md');
  assert.equal(await readFile(foreign, 'utf8'), 'my existing note');
  const note = await readFile(file, 'utf8');
  await writeFile(
    file,
    ('\uFEFF---\ntags: [team]\n---\n' + note + '\nMy follow-up\n').replace(/\n/g, '\r\n'),
  );
  meeting.title = 'Renamed';
  meeting.summary.data.markdown = 'Updated minutes\nSecond point';
  assert.equal((await sync()).path, file);
  const saved = await readFile(file, 'utf8');
  assert.ok(saved.startsWith('\uFEFF---\r\ntags: [team]\r\n---\r\n'));
  assert.ok(saved.includes('Updated minutes\r\nSecond point'));
  assert.ok(saved.endsWith('My follow-up\r\n'));
  assert.equal((await markdownTarget(root, recordings, meeting.id)).path, file);
  assert.deepEqual(
    (await Promise.all([sync(), sync()])).map((r) => r.status),
    ['saved', 'saved'],
  );
  // 模拟 Obsidian 在 Brevia 原子发布后，才通过先前打开的文件描述符落盘。
  const editor = await open(file, 'a');
  meeting.summary.data.markdown = 'Second edition';
  assert.equal((await sync()).status, 'saved');
  // A → B → A 再到 C，重复内容也可能属于不同的已打开文件。
  const secondEditor = await open(file, 'a');
  meeting.summary.data.markdown = 'Updated minutes\nSecond point';
  assert.equal((await sync()).status, 'saved');
  const thirdEditor = await open(file, 'a');
  meeting.summary.data.markdown = 'Third edition';
  assert.equal((await sync()).status, 'saved');
  for (const handle of [editor, secondEditor, thirdEditor])
    assert.ok((await handle.stat()).nlink > 0);
  await editor.write('Late handwritten line');
  const conflict = await sync();
  assert.equal(conflict.status, 'conflict');
  assert.ok((await readFile(conflict.recoveryPath, 'utf8')).endsWith('Late handwritten line'));
  await editor.write(' continued');
  await editor.close();
  assert.ok(
    (await readFile(conflict.recoveryPath, 'utf8')).endsWith('Late handwritten line continued'),
  );
  assert.ok((await readFile(file, 'utf8')).includes('Third edition'));
  for (const [handle, line] of [
    [secondEditor, 'Note in B'],
    [thirdEditor, 'Note in another A'],
  ]) {
    await handle.write(line);
    await handle.close();
    const changed = await sync();
    assert.equal(changed.status, 'conflict');
    assert.ok((await readFile(changed.recoveryPath, 'utf8')).endsWith(line));
  }
  for (const markdown of ['Third edition', 'Fourth edition']) {
    meeting.summary.data.markdown = markdown;
    assert.equal((await sync()).status, 'saved');
  }
  const sameLengthEditor = await open(file, 'r+');
  const originalBytes = await readFile(file);
  const position = originalBytes.indexOf('My follow-up');
  assert.ok(position >= 0);
  meeting.summary.data.markdown = 'Fifth edition';
  assert.equal((await sync()).status, 'saved');
  assert.equal((await sync()).status, 'saved');
  await sameLengthEditor.write(Buffer.from('My own notes'), 0, 12, position);
  await sameLengthEditor.close();
  const overwritten = await sync();
  assert.equal(overwritten.status, 'conflict');
  assert.equal((await stat(overwritten.recoveryPath)).size, originalBytes.length);
  assert.ok((await readFile(overwritten.recoveryPath, 'utf8')).includes('My own notes'));
  const history = path.join(
    vault,
    (await readdir(vault)).find((name) => name.startsWith('.brevia-')),
  );
  const backups = await readdir(history);
  assert.ok(backups.length >= 2, 'keep a named inode for every outstanding historical writer');
  assert.ok(backups.every((name) => name.endsWith('.previous')));
  // 兼容已有版本的文件名，同时覆盖“取走目标但还没发布”和“已发布但还没标记完成”。
  const legacy = backups[0].slice(0, 64);
  await rename(path.join(history, backups[0]), path.join(history, legacy + '.previous'));
  assert.equal((await sync()).status, 'saved');
  await rename(path.join(history, legacy + '.previous'), path.join(history, legacy + '.pending'));
  await rm(file);
  assert.equal((await sync()).status, 'saved');
  assert.ok((await readFile(file, 'utf8')).includes('My follow-up'));
  const prior = (await readdir(history))[0];
  const pending = path.join(history, prior.replace('.previous', '.pending'));
  await rename(path.join(history, prior), pending);
  const afterPublish = await readFile(file, 'utf8');
  assert.equal((await sync()).status, 'saved');
  assert.equal(await readFile(file, 'utf8'), afterPublish);
  // 外部新文件在替换期间抢占路径时，两份内容都必须可见。
  const another = (await readdir(history))[0];
  await rename(
    path.join(history, another),
    path.join(history, another.replace('.previous', '.pending')),
  );
  await writeFile(file, 'External file created during publication');
  const raced = await sync();
  assert.equal(raced.status, 'conflict');
  assert.ok((await readFile(raced.recoveryPath, 'utf8')).includes('My follow-up'));
  assert.equal(await readFile(file, 'utf8'), 'External file created during publication');
  await writeFile(file, saved.replace('Second point', 'My own edit'));
  assert.equal((await sync()).status, 'conflict');
  assert.equal(await readFile(file, 'utf8'), saved.replace('Second point', 'My own edit'));
  const copy = await sync('copy');
  assert.notEqual(copy.path, file);
  assert.equal((await sync()).path, copy.path);
  await rename(copy.path, copy.path + '.moved');
  assert.equal((await sync()).status, 'conflict');
  await symlink(foreign, copy.path);
  assert.equal((await sync()).status, 'conflict');
  assert.equal(await readFile(foreign, 'utf8'), 'my existing note');
  const item = { ...meeting, id: randomUUID(), title: '../../Unsafe' };
  await mkdir(path.join(recordings, item.id));
  const secondFile = (await sync('sync', noPicker, item)).path;
  assert.equal(path.dirname(secondFile), vault);
  const beforeDelete = await readFile(secondFile, 'utf8');
  const lateSync = serializeMarkdown(() => rm(path.join(recordings, item.id), { recursive: true }));
  await Promise.all([lateSync, assert.rejects(sync('sync', noPicker, item), { code: 'ENOENT' })]);
  assert.deepEqual(await markdownTarget(root, recordings, item.id), { directory: vault, path: '' });
  assert.equal(await readFile(secondFile, 'utf8'), beforeDelete);
  const beforeClear = await readFile(file, 'utf8');
  await serializeMarkdown(() => rm(recordings, { recursive: true }));
  assert.deepEqual(await markdownTarget(root, recordings, meeting.id), {
    directory: vault,
    path: '',
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'markdown-targets.json'), 'utf8')), {
    directory: vault,
  });
  assert.equal(await readFile(file, 'utf8'), beforeClear);
  const permit = 'https://open.feishu.cn/open-apis/bot/v2/hook/test';
  const noCall = () => assert.fail('unexpected webhook request');
  assert.equal(
    await sendGroupSummary(
      permit.replace('open.feishu.cn', 'open.feishu.cn.attacker.org'),
      'private',
      noCall,
    ),
    'address',
  );
  assert.equal(await sendGroupSummary(permit, '正'.repeat(7000), noCall), 'size');
  assert.equal(
    await sendGroupSummary(permit, 'summary', async (address, options) => {
      assert.equal(address, permit);
      assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), {
        msg_type: 'text',
        content: { text: 'summary' },
      });
      return { ok: true, json: async () => ({ code: 0 }) };
    }),
    'sent',
  );
  assert.equal(
    await sendGroupSummary(permit, 'summary', async () => ({
      ok: true,
      json: async () => ({ code: 19024 }),
    })),
    'failed',
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
console.log('Markdown workflow and explicit bot delivery checks passed.');
