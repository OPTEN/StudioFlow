import zlib from 'node:zlib';

/**
 * A small ZIP writer and reader for the transfer specs (E2E-XFER-*): files are stored unless a spec asks to deflate them
 * (the ZIP bomb), the reader follows the central directory and inflates what the export deflated. No dependency; nothing
 * here is meant for large files.
 */

function crc32(data: Buffer): number {
  const native = (zlib as unknown as { crc32?: (value: Buffer) => number }).crc32;
  if (native) return native(data) >>> 0;
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  /** Name as stored; not checked, so `../x` and `/x` are possible on purpose. */
  name: string;
  data: Buffer;
  /** Deflate the file (a small ZIP that unpacks to something huge is the "ZIP bomb"); default: stored. */
  deflate?: boolean;
}

/** A ZIP file with the files in the given order, stored or (with `deflate`) compressed. */
export function makeZip(files: readonly ZipFile[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const method = file.deflate ? 8 : 0;
    const body = file.deflate ? zlib.deflateRawSync(file.data) : file.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}

/** The files of a ZIP file by the central directory (stored or deflated). */
export function readZip(archive: Buffer): ZipFile[] {
  let end = archive.length - 22;
  while (end >= 0 && archive.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP file: no end of central directory');
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const files: ZipFile[] = [];
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('broken central directory');
    const method = archive.readUInt16LE(cursor + 10);
    const compressed = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const local = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const dataStart = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const raw = archive.subarray(dataStart, dataStart + compressed);
    files.push({ name, data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
