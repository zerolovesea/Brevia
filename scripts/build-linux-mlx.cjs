const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { download, run } = require('../windows/build.cjs');

const root = path.resolve(__dirname, '..');
const version = '0.32.4';
const wheels = {
  cpu: [
    'https://files.pythonhosted.org/packages/a4/0f/1f3e0d30ccae2f7e9cd270633f8fd79d470248c07be3d501cebf9271783f/mlx_cpu-0.32.4-py3-none-manylinux_2_35_x86_64.whl',
    '0e0a24fa2ce8b6b94d2e6a90604e8813aa8e29fcb918bb2aa01cfb6d133d8cee',
  ],
  cuda: [
    'https://files.pythonhosted.org/packages/10/fd/6dbc9de2976b632a4313c1a208fffe4d6c3d85971a6208ab08c2555491b4/mlx_cuda_12-0.32.4-py3-none-manylinux_2_35_x86_64.whl',
    'f385c7af7c1f63a9d6ce3e442e1c9ba881c881bcb45c6534ff8155b359da47e5',
  ],
};
const llama = 'b1b770d90d94cad9e9ea5b993bdbc383a522fb28';

async function main(backend) {
  assert.ok(backend === 'cpu' || backend === 'cuda', 'Specify cpu or cuda');
  assert.ok(process.platform === 'linux' && process.arch === 'x64', 'Build on Linux x86-64');
  const out = path.resolve(
    process.env.BREVIA_LINUX_MLX_OUT || path.join(root, 'dist/native-linux-mlx'),
  );
  const cache = path.join(out, 'build', version, backend);
  const headers = path.join(cache, 'llama.cpp-' + llama);
  const archive = path.join(cache, 'llama.tar.gz');
  await download(
    'https://codeload.github.com/ggml-org/llama.cpp/tar.gz/' + llama,
    archive,
    'ae8556670b17c25931cd39eb7c95617650eaf6091bbcff206750583ddde1acb4',
  );
  run('tar', ['-xf', archive, '-C', cache]);
  const wheel = path.join(cache, 'mlx.whl');
  await download(wheels[backend][0], wheel, wheels[backend][1]);
  const sdk = path.join(cache, 'sdk');
  fs.mkdirSync(sdk, { recursive: true });
  run('bsdtar', ['-xf', wheel, '-C', sdk]);
  const flavor = backend === 'cuda' ? 'mlx_cuda_12' : 'mlx_cpu';
  const prefix = path.join(sdk, 'mlx');
  const build = path.join(cache, 'cmake');
  run('cmake', [
    '-S',
    'inference/mlx',
    '-B',
    build,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_PREFIX_PATH=' + prefix,
    '-DJSON_INCLUDE_DIR=' + path.join(headers, 'vendor'),
    '-DBASE64_INCLUDE_DIR=' + path.join(headers, 'common'),
  ]);
  run('cmake', ['--build', build, '--parallel', '4']);

  const dest = path.join(out, backend);
  fs.mkdirSync(dest, { recursive: true });
  const binary = path.join(dest, 'brevia-mlx-cpp');
  const lib = path.join(dest, 'libmlx.so');
  fs.copyFileSync(path.join(build, 'brevia-mlx-cpp'), binary);
  fs.copyFileSync(path.join(prefix, 'lib/libmlx.so'), lib);
  run('patchelf', ['--set-rpath', '$ORIGIN', binary]);
  run('patchelf', ['--set-rpath', '$ORIGIN', lib]);
  const needed = (file) =>
    run('patchelf', ['--print-needed', file], { encoding: 'utf8', stdio: 'pipe' })
      .stdout.trim()
      .split('\n');
  // 使用发行版的多线程 OpenBLAS 替换 SDK 的参考 BLAS/LAPACK。
  const blas = needed(lib).filter((name) => /^lib(?:blas|lapack)-/.test(name));
  if (blas.length) {
    for (const name of blas) run('patchelf', ['--remove-needed', name, lib]);
    run('patchelf', ['--add-needed', 'libopenblas.so.0', lib]);
  }
  assert.ok(needed(binary).includes('libmlx.so'), 'Missing MLX linkage');
  assert.equal(needed(lib).includes('libcuda.so.1'), backend === 'cuda', 'Wrong MLX backend');
  const licenses = path.join(dest, 'licenses');
  fs.mkdirSync(licenses, { recursive: true });
  for (const [source, name] of [
    [path.join(root, 'inference/mlx/LICENSE-mlx-audio-swift'), 'mlx-audio-swift'],
    [path.join(build, '_deps/tokenizers-src/LICENSE'), 'tokenizers-cpp'],
    [path.join(sdk, flavor + '-' + version + '.dist-info/licenses/LICENSE'), 'mlx'],
    [path.join(headers, 'LICENSE'), 'llama.cpp'],
    [path.join(headers, 'common/base64.hpp'), 'base64'],
    [path.join(headers, 'vendor/nlohmann/json.hpp'), 'nlohmann-json'],
  ])
    fs.copyFileSync(source, path.join(licenses, name));
  if (backend === 'cpu') {
    const smoke = run(binary, [], {
      input: JSON.stringify({ id: 1, type: 'engine.check', payload: {} }) + '\n',
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
    });
    assert.deepEqual(JSON.parse(smoke.stdout), { id: 1, ok: true, result: { value: 5 } });
  }
}

main(process.argv[2]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
