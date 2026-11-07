// v1.4.5 reads Electron update manifests from the root of the ModelScope mirror.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const version = pkg.version;
// Leave the mirror's migration release in place when publishing later native releases.
if (version !== '2.0.0' && version !== '2.0.1') process.exit(0);
const input = path.resolve(process.argv[2]);
const output = process.argv[3] ? path.resolve(process.argv[3]) : path.dirname(input);
const mac = path.basename(input) === 'Brevia.app';
if (mac && version !== '2.0.0') process.exit(0);
let asset = input;
if (mac) {
  const plist = path.join(input, 'Contents/Info.plist');
  const bundleValue = (key) =>
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print ' + key, plist], {
      encoding: 'utf8',
    }).trim();
  if (
    bundleValue('CFBundleShortVersionString') !== version ||
    bundleValue('CFBundleExecutable') !== 'Brevia'
  )
    throw new Error('Unexpected macOS bundle version or executable name for the v1.4.5 update');
  await access(
    path.join(input, 'Contents/Frameworks/Squirrel.framework/Resources/ShipIt'),
    constants.X_OK,
  );
  // ShipIt applies the designated requirement embedded in the official v1.4.5 app.
  execFileSync('codesign', [
    '--verify',
    '--deep',
    '--strict',
    '-R=identifier "com.brevia.app" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "4M64879BBM"',
    input,
  ]);
  // ShipIt clears quarantine attributes while replacing the bundle.
  const readOnly = execFileSync(
    'find',
    [input, '!', '-type', 'l', '!', '-perm', '-0200', '-print', '-quit'],
    { encoding: 'utf8' },
  ).trim();
  if (readOnly) throw new Error('ShipIt cannot update read-only bundle entry: ' + readOnly);
  asset = path.join(output, `Brevia-${version}-arm64-mac.zip`);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', input, asset]);
} else if (
  path.basename(input) !== `Brevia-${version}-x64-setup.exe` ||
  path.dirname(input) !== output
) {
  throw new Error('Expected the packaged Windows installer beside its update manifest');
}
const hash = createHash('sha512');
for await (const chunk of createReadStream(asset)) hash.update(chunk);
const file = {
  url: path.basename(asset),
  sha512: hash.digest('base64'),
  size: (await stat(asset)).size,
  ...(!mac && { isAdminRightsRequired: true }),
};
if (!file.size) throw new Error('Empty update artifact: ' + asset);
// JSON is valid YAML and safely quotes filenames and hashes for the old js-yaml parser.
await writeFile(
  path.join(output, mac ? 'latest-mac.yml' : 'latest.yml'),
  JSON.stringify(
    {
      version,
      files: [file],
      path: file.url,
      sha512: file.sha512,
      releaseDate: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
