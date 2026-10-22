import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ASSET_DIR } from './env';
import { exec } from './shell';

/** Test data of docs/testing.md 1.8: valid media (ffmpeg, with a byte-level fallback) and spoofed/hostile files. */

function crc32(buffer: Buffer): number {
  const fn = (zlib as unknown as { crc32?: (data: Buffer) => number }).crc32;
  if (fn) return fn(buffer) >>> 0;
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A valid RGB PNG of the given size filled with one colour (small sizes only). */
export function makePng(width: number, height: number, rgb: [number, number, number] = [30, 120, 220]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** A PNG header that claims a huge size but carries (almost) no data: the "decompression bomb" of the plan. */
export function makePngHeaderOnly(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Pads a buffer with zero bytes to exactly `size` bytes (trailing data is ignored by every decoder). */
export function padTo(buffer: Buffer, size: number): Buffer {
  if (buffer.length > size) throw new Error(`buffer (${buffer.length}) is already larger than ${size}`);
  return Buffer.concat([buffer, Buffer.alloc(size - buffer.length)]);
}

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

/** MP4 prefix: an `ftyp` box with the given major brand followed by a `free` box. Not playable, only for byte-level checks. */
export function makeFtyp(brand = 'isom'): Buffer {
  return Buffer.concat([
    box('ftyp', Buffer.concat([Buffer.from(brand, 'ascii'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41', 'ascii')])),
    box('free', Buffer.alloc(8)),
  ]);
}

/** EBML header with the given DocType (`webm` or `matroska`). */
export function makeEbml(docType: 'webm' | 'matroska'): Buffer {
  const doc = Buffer.concat([Buffer.from([0x42, 0x82, 0x80 | docType.length]), Buffer.from(docType, 'ascii')]);
  const header = Buffer.concat([Buffer.from([0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08]), doc]);
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | header.length]), header]);
}

export interface Sample {
  name: string;
  /** Name sent in the multipart part (may differ from the content, on purpose). */
  fileName: string;
  /** Content-Type sent by the client (may lie). */
  contentType: string;
  buffer: Buffer;
}

export interface SampleSet {
  tinyPng: Buffer;
  photoJpg: Buffer;
  photoWebp: Buffer;
  clipMp4: Buffer;
  clipWebm: Buffer;
  /** Spoofs and hostile files: all must be rejected (415) regardless of name and declared type. */
  spoofs: Sample[];
  /** Valid media with misleading metadata: must be accepted as what the bytes say. */
  disguisedValid: Sample[];
  /** Valid media carrying script-like trailers: accepted, but never served as anything else. */
  polyglots: Sample[];
}

let cache: SampleSet | undefined;

const WEBP_1X1 = Buffer.from('524946461a000000574542505650384c0d0000002f0000001007101111888888fe0700', 'hex');
const JPEG_1X1 = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffdb004300030202020202030202020303030304060404040404080606050609080a0a090809090a0c0f0c0a0b0e0b09090d110d0e0f101011100a0c12131210130f101010ffc9000b080001000101011100ffcc000600101005ffda0008010100003f00d2cf20ffd9',
  'hex',
);

async function ffmpeg(args: string[]): Promise<boolean> {
  try {
    const result = await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeoutMs: 60_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

/** Generates (once) and returns the sample set. Files are also written to .output/assets for browser tests. */
export async function generateSamples(): Promise<SampleSet> {
  if (cache) return cache;
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  const file = (name: string) => path.join(ASSET_DIR, name);
  const read = (name: string, fallback: Buffer): Buffer =>
    fs.existsSync(file(name)) && fs.statSync(file(name)).size > 0 ? fs.readFileSync(file(name)) : fallback;

  fs.writeFileSync(file('tiny.png'), makePng(1, 1));
  if (!fs.existsSync(file('photo.jpg'))) await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1', '-frames:v', '1', '-q:v', '4', file('photo.jpg')]);
  if (!fs.existsSync(file('photo.webp'))) {
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1', '-frames:v', '1', '-c:v', 'libwebp_anim', '-lossless', '0', file('photo.webp')]);
  }
  if (!fs.existsSync(file('clip.mp4'))) {
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-t', '3', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file('clip.mp4')]);
  }
  if (!fs.existsSync(file('clip.webm'))) {
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-t', '3', '-an', '-c:v', 'libvpx', '-b:v', '200k', file('clip.webm')]);
  }

  const tinyPng = makePng(1, 1);
  const photoJpg = read('photo.jpg', JPEG_1X1);
  const photoWebp = read('photo.webp', WEBP_1X1);
  const clipMp4 = read('clip.mp4', padTo(makeFtyp('isom'), 4096));
  const clipWebm = read('clip.webm', padTo(makeEbml('webm'), 4096));

  const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"><script>window.__xss=1</script></svg>');
  const html = Buffer.from('<!doctype html><html><body><script>window.__xss=1</script></body></html>');
  const spoofs: Sample[] = [
    { name: 'svg-as-png', fileName: 'svg-as-png.png', contentType: 'image/png', buffer: svg },
    { name: 'svg', fileName: 'image.svg', contentType: 'image/svg+xml', buffer: svg },
    {
      name: 'gif-as-png',
      fileName: 'gif-as-png.png',
      contentType: 'image/png',
      buffer: Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1'),
    },
    {
      name: 'gif-js-polyglot',
      fileName: 'poly.png',
      contentType: 'image/png',
      buffer: Buffer.concat([Buffer.from('GIF89a/*', 'latin1'), Buffer.alloc(16), Buffer.from('*/=1;window.__xss=1;', 'latin1')]),
    },
    {
      name: 'exe-as-png',
      fileName: 'exe-as-png.png',
      contentType: 'image/png',
      buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62, 0x90), Buffer.from('This program cannot be run in DOS mode.')]),
    },
    { name: 'html-as-png', fileName: 'html-as-png.png', contentType: 'image/png', buffer: html },
    { name: 'pdf', fileName: 'doc.pdf', contentType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1') },
    { name: 'zip', fileName: 'archive.zip', contentType: 'application/zip', buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]) },
    { name: 'bmp', fileName: 'image.bmp', contentType: 'image/bmp', buffer: Buffer.concat([Buffer.from('BM'), Buffer.alloc(60)]) },
    { name: 'heic-as-mp4', fileName: 'heic.mp4', contentType: 'video/mp4', buffer: padTo(makeFtyp('heic'), 256) },
    { name: 'avif-as-mp4', fileName: 'avif.mp4', contentType: 'video/mp4', buffer: padTo(makeFtyp('avif'), 256) },
    { name: 'quicktime-as-mp4', fileName: 'qt.mp4', contentType: 'video/mp4', buffer: padTo(makeFtyp('qt  '), 256) },
    { name: 'matroska-as-webm', fileName: 'mkv.webm', contentType: 'video/webm', buffer: padTo(makeEbml('matroska'), 256) },
    {
      name: 'wav-riff',
      fileName: 'sound.png',
      contentType: 'image/png',
      buffer: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]),
    },
    { name: 'empty', fileName: 'empty.png', contentType: 'image/png', buffer: Buffer.alloc(0) },
    { name: 'one-byte', fileName: 'one.png', contentType: 'image/png', buffer: Buffer.from([0x89]) },
    { name: 'truncated-png-signature', fileName: 'trunc.png', contentType: 'image/png', buffer: PNG_SIGNATURE.subarray(0, 5) },
    { name: 'text', fileName: 'notes.txt', contentType: 'text/plain', buffer: Buffer.from('hello') },
  ];

  const disguisedValid: Sample[] = [
    { name: 'png-as-octet-stream', fileName: 'tiny.png', contentType: 'application/octet-stream', buffer: tinyPng },
    { name: 'png-with-jpg-name', fileName: 'tiny.jpg', contentType: 'image/jpeg', buffer: tinyPng },
    { name: 'png-without-extension', fileName: 'tiny', contentType: 'image/png', buffer: tinyPng },
  ];

  const comment = Buffer.from('<script>window.__xss=1</script>');
  const commentSegment = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([(comment.length + 2) >> 8, (comment.length + 2) & 0xff]), comment]);
  const polyglots: Sample[] = [
    {
      name: 'png-with-js-trailer',
      fileName: 'png-with-js-trailer.png',
      contentType: 'image/png',
      buffer: Buffer.concat([tinyPng, Buffer.from('<script>window.__xss=1</script>')]),
    },
    {
      name: 'png-text-chunk-svg',
      fileName: 'png-text.png',
      contentType: 'image/png',
      buffer: Buffer.concat([tinyPng.subarray(0, 33), pngChunk('tEXt', Buffer.from('Comment\0<svg onload=window.__xss=1>')), tinyPng.subarray(33)]),
    },
    {
      name: 'jpeg-with-script-comment',
      fileName: 'jpeg-with-script-comment.jpg',
      contentType: 'image/jpeg',
      buffer: Buffer.concat([JPEG_1X1.subarray(0, 2), commentSegment, JPEG_1X1.subarray(2)]),
    },
  ];

  cache = { tinyPng, photoJpg, photoWebp, clipMp4, clipWebm, spoofs, disguisedValid, polyglots };
  return cache;
}
