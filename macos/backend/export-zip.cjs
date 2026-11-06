const fs = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createDeflateRaw } = require('node:zlib');

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}
function put64(buffer, offset, value) {
  buffer.writeBigUInt64LE(BigInt(value), offset);
}
// ZIP64 的尺寸字段全部保留，录音超过 4 GiB 时仍能流式导出；只缓存中央目录。
async function writeZip(destination, entries, checkpoint = async () => {}) {
  const fd = fs.openSync(destination, 'w'),
    records = [];
  let position = 0;
  const write = (bytes) => {
    for (let offset = 0; offset < bytes.length; )
      offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    position += bytes.length;
  };
  try {
    for (const entry of entries) {
      await checkpoint();
      const name = Buffer.from(entry.name, 'utf8');
      if (!name.length || name.length > 65535 || name.includes(0))
        throw new Error('Invalid ZIP filename');
      const offset = position,
        local = Buffer.alloc(50);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(45, 4);
      local.writeUInt16LE(0x808, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(33, 12);
      local.writeUInt32LE(0xffffffff, 18);
      local.writeUInt32LE(0xffffffff, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(20, 28);
      local.writeUInt16LE(1, 30);
      local.writeUInt16LE(16, 32);
      write(local.subarray(0, 30));
      write(name);
      write(local.subarray(30));
      let crc = 0xffffffff,
        size = 0;
      const start = position,
        input = entry.path
          ? fs.createReadStream(entry.path, { highWaterMark: 1024 * 1024 })
          : Readable.from([Buffer.from(entry.data)]);
      const check = new Transform({
        transform(chunk, encoding, callback) {
          Promise.resolve()
            .then(checkpoint)
            .then(() => {
              crc = crcUpdate(crc, chunk);
              size += chunk.length;
              callback(null, chunk);
            }, callback);
        },
      });
      const deflater = createDeflateRaw();
      const pumping = pipeline(input, check, deflater);
      // 立即挂接拒绝处理，取消和读取失败不会变成未处理的 Promise 拒绝。
      pumping.catch(() => {});
      try {
        for await (const chunk of deflater) write(chunk);
        await pumping;
      } catch (error) {
        input.destroy();
        check.destroy();
        deflater.destroy();
        await pumping.catch(() => {});
        throw error;
      }
      const compressed = position - start,
        checksum = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(24);
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(checksum, 4);
      put64(descriptor, 8, compressed);
      put64(descriptor, 16, size);
      write(descriptor);
      records.push({ name, offset, size, compressed, checksum });
    }
    const directoryOffset = position;
    for (const record of records) {
      const central = Buffer.alloc(46),
        extra = Buffer.alloc(28);
      central.writeUInt32LE(0x02014b50);
      central.writeUInt16LE(45, 4);
      central.writeUInt16LE(45, 6);
      central.writeUInt16LE(0x808, 8);
      central.writeUInt16LE(8, 10);
      central.writeUInt16LE(33, 14);
      central.writeUInt32LE(record.checksum, 16);
      central.writeUInt32LE(0xffffffff, 20);
      central.writeUInt32LE(0xffffffff, 24);
      central.writeUInt16LE(record.name.length, 28);
      central.writeUInt16LE(extra.length, 30);
      central.writeUInt32LE(0xffffffff, 42);
      extra.writeUInt16LE(1);
      extra.writeUInt16LE(24, 2);
      put64(extra, 4, record.size);
      put64(extra, 12, record.compressed);
      put64(extra, 20, record.offset);
      write(central);
      write(record.name);
      write(extra);
    }
    const directorySize = position - directoryOffset,
      endOffset = position,
      end = Buffer.alloc(56);
    end.writeUInt32LE(0x06064b50);
    put64(end, 4, 44);
    end.writeUInt16LE(45, 12);
    end.writeUInt16LE(45, 14);
    put64(end, 24, records.length);
    put64(end, 32, records.length);
    put64(end, 40, directorySize);
    put64(end, 48, directoryOffset);
    write(end);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50);
    put64(locator, 8, endOffset);
    locator.writeUInt32LE(1, 16);
    write(locator);
    const legacy = Buffer.alloc(22);
    legacy.writeUInt32LE(0x06054b50);
    legacy.writeUInt16LE(65535, 8);
    legacy.writeUInt16LE(65535, 10);
    legacy.writeUInt32LE(0xffffffff, 12);
    legacy.writeUInt32LE(0xffffffff, 16);
    write(legacy);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
module.exports = { writeZip };
