import { crc32, inflateRawSync } from "node:zlib";

// Reads a zip's regular files from its central directory. Stored and deflate entries only.
// Refuses encrypted, zip64 and multi-disk archives. Never trusts the sizes the zip declares:
// each inflate stops at `fileLimit` and the running total at `totalLimit`.

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function endRecord(buffer) {
  const floor = Math.max(0, buffer.length - 22 - 0xffff);
  for (let at = buffer.length - 22; at >= floor; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD) return at;
  }
  throw fail("This file is not a zip.");
}

export function readZip(buffer, { fileLimit, totalLimit, maxEntries }) {
  if (buffer.length < 22) throw fail("This file is not a zip.");
  const end = endRecord(buffer);
  if (end >= 20 && buffer.readUInt32LE(end - 20) === ZIP64_LOCATOR) throw fail("Zip64 archives aren't supported. Zip the folder again with a standard zip tool.");
  if (buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0) throw fail("Multi-part zips aren't supported.");
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  const offset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw fail("Zip64 archives aren't supported. Zip the folder again with a standard zip tool.");
  // Folder and __MACOSX entries don't count as files, but Finder adds about two per file, so allow 4x before reading.
  if (count > maxEntries * 4) throw fail(`The zip has ${count} entries. The limit is ${maxEntries} files.`);
  if (offset + size > end) throw fail("The zip is damaged.");

  const files = [];
  const skipped = [];
  let total = 0;
  let at = offset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== CENTRAL) throw fail("The zip is damaged.");
    const madeBy = buffer.readUInt16LE(at + 4) >> 8;
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const packed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const attributes = buffer.readUInt32LE(at + 38);
    const local = buffer.readUInt32LE(at + 42);
    const rawName = buffer.subarray(at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    let path;
    try {
      path = utf8.decode(rawName);
    } catch {
      path = rawName.toString("latin1");
    }
    if (flags & 0x1) throw fail("Encrypted zips aren't supported.");
    if (packed === 0xffffffff || local === 0xffffffff) throw fail("Zip64 archives aren't supported. Zip the folder again with a standard zip tool.");
    if (path.endsWith("/") || path.startsWith("__MACOSX/")) continue;
    if (files.length + skipped.length >= maxEntries) throw fail(`The zip has more than ${maxEntries} files.`);
    // Unix zips keep the file type in the high 16 bits. Anything but a regular file (a symlink, a device) is dropped.
    const type = madeBy === 3 ? (attributes >>> 16) & 0o170000 : 0;
    if (type && type !== 0o100000) {
      skipped.push({ path, reason: type === 0o120000 ? "Symbolic link" : "Not a regular file" });
      continue;
    }
    if (method !== 0 && method !== 8) {
      skipped.push({ path, reason: `Compression method ${method} isn't supported` });
      continue;
    }
    if (local + 30 > end || buffer.readUInt32LE(local) !== LOCAL) throw fail("The zip is damaged.");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + packed > end) throw fail("The zip is damaged.");
    const data = buffer.subarray(start, start + packed);
    let bytes;
    if (method === 0) {
      bytes = data;
      if (bytes.length > fileLimit) {
        skipped.push({ path, reason: "File over 4 MB" });
        continue;
      }
    } else {
      try {
        bytes = inflateRawSync(data, { maxOutputLength: fileLimit });
      } catch (error) {
        if (error.code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) {
          skipped.push({ path, reason: "File over 4 MB" });
          continue;
        }
        throw fail("The zip is damaged.");
      }
    }
    if (crc32(bytes) !== crc) throw fail("The zip is damaged.");
    total += bytes.length;
    if (total > totalLimit) throw fail("The zip is over 60 MB unpacked.");
    files.push({ path, bytes: Buffer.from(bytes) });
  }
  return { files, skipped };
}
