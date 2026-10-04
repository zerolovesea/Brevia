// Run before signing: both frozen processes keep their own entry point/archive,
// but byte-identical runtime files can share one copy within the macOS app.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function deduplicateRuntime(runtime) {
  const worker = path.join(runtime, 'brevia-worker', '_internal');
  const helper = path.join(runtime, 'brevia-llama-helper', '_internal');
  let saved = 0;
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile()) {
        const original = path.join(worker, path.relative(helper, file));
        const target = await fs.lstat(original).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        const source = await fs.stat(file);
        if (!target?.isFile() || target.size !== source.size || target.mode !== source.mode) continue;
        const digest = async name => createHash('sha256').update(await fs.readFile(name)).digest('hex');
        if (await digest(file) !== await digest(original)) continue;
        await fs.unlink(file);
        await fs.symlink(path.relative(directory, original), file);
        saved += source.size;
      }
    }
  }
  await visit(helper);
  return saved;
}

async function prepareWindowsRuntime(runtime) {
  // The Windows worker embeds both entry modes. Remove old build leftovers
  // from the staged app only; the build/source directory is never mutated.
  await fs.access(path.join(runtime, 'brevia-worker', 'brevia-worker.exe'));
  await fs.rm(path.join(runtime, 'brevia-llama-helper'), { recursive: true, force: true });
  // DLL consumers never use C/C++ headers, import/static libraries or PDBs.
  // Scope pruning to these native packages; keep all DLLs and model assets.
  async function prune(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await prune(file);
      else if (entry.isFile() && /\.(lib|exp|pdb|a|h|hpp)$/i.test(entry.name)) await fs.unlink(file);
    }
  }
  for (const name of ['sherpa_onnx', 'llama_cpp']) {
    await prune(path.join(runtime, 'brevia-worker', '_internal', name));
  }
}

exports.default = async context => {
  if (context.electronPlatformName === 'win32') {
    await prepareWindowsRuntime(path.join(context.appOutDir, 'resources', 'backend', 'runtime'));
    return;
  }
  if (context.electronPlatformName !== 'darwin') return;
  const runtime = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`,
    'Contents', 'Resources', 'backend', 'runtime');
  const saved = await deduplicateRuntime(runtime);
  console.log(`Shared macOS Python runtime: saved ${(saved / 1024 / 1024).toFixed(1)} MiB`);
};
exports.deduplicateRuntime = deduplicateRuntime;

exports.prepareWindowsRuntime = prepareWindowsRuntime;
