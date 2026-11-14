const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

function writeNativeFeed(artifact, feed, platform) {
  if (fs.statSync(artifact).size > 512 * 1024 ** 2)
    throw new Error('Native update exceeds the 512 MiB client limit');
  const signature = fs.readFileSync(artifact + '.sig', 'utf8').trim();
  const keyId = (text) => {
    const record = Buffer.from(
      Buffer.from(text, 'base64').toString().split('\n')[1] || '',
      'base64',
    );
    if (record.length < 10) throw new Error('Invalid native update key or signature');
    return record.subarray(2, 10);
  };
  if (!keyId(signature).equals(keyId(process.env.BREVIA_NATIVE_UPDATE_PUBKEY)))
    throw new Error('Updater public key and signature differ');
  const url = `https://github.com/zerolovesea/Brevia/releases/download/v${version}/${path.basename(artifact)}`;
  fs.writeFileSync(
    feed,
    JSON.stringify(
      {
        version,
        pub_date: new Date().toISOString(),
        platforms: { [platform]: { signature, url } },
      },
      null,
      2,
    ) + '\n',
  );
}
module.exports = { writeNativeFeed };
