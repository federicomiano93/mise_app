// zpl-z64.ts — an image label as a ZPL job: the dots compressed as Zebra's «Z64» and wrapped in the commands of the
// owner's own script. NEW IN MISE 2 (no original in js/).
//
// ⚠️ WHY Z64. The script sends the picture as plain hexadecimal: about 77 000 characters for one label. The print queue
// (print-jobs) refuses more than 20 000, in the rules AND in the agent, so that a job cannot be used to stuff a document.
// Z64 is Zebra's own compressed form of the same bytes — zlib (deflate with its two-byte header and Adler-32 check),
// then Base64, then a CRC — and a mostly white label shrinks to a few thousand characters.
//
// THE FORMAT (Zebra ZPL II Programming Guide, «B64 and Z64 Encoding»): `:Z64:<base64>:<crc>`, the CRC being «four
// hexadecimal digits calculated over the encoded data field». The guide does not name the CRC; it is CRC-16/XMODEM
// (polynomial 0x1021, start 0, not reflected, no final XOR), as every working encoder uses (zebrafy's crc.py is the
// reference read on 25 Oct 2026). The ^GF counts are written as Zebra's own designer writes them for Z64: the
// first two both the uncompressed size, the third the bytes per row.
//
// ⚠️ THE COMPRESSION ITSELF IS HANDED IN. shared/ has no DOM and no Node: the app passes the browser's
// CompressionStream('deflate') (zlib format, Chrome 80+, so the lab tablet's Chrome 101 has it), the specs pass Node's.
//
// ⚠️⚠️ NO TILDE, EVER. Darkness (~SD28 in the script) is a CONTROL command, and the queue refuses every ~ (a ~JR from a
// phone would reset the printer). The darkness belongs to the computer the printer hangs off: the agent's own settings
// (step 1b), never a job.

import type { Bitmap } from './label-image-raster';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Standard Base64 with padding (what Zebra calls MIME Base64, written on one line).
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64[n >> 18] as string + (B64[(n >> 12) & 63] as string) + (B64[(n >> 6) & 63] as string) + (B64[n & 63] as string);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += (B64[n >> 18] as string) + (B64[(n >> 12) & 63] as string) + '==';
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += (B64[n >> 18] as string) + (B64[(n >> 12) & 63] as string) + (B64[(n >> 6) & 63] as string) + '=';
  }
  return out;
}

// The reverse, for the round trip in the specs and for reading a job back. Null for text that is not Base64.
export function base64Decode(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = (B64.indexOf(text[i] as string) << 18) | (B64.indexOf(text[i + 1] as string) << 12)
      | ((text[i + 2] === '=' ? 0 : B64.indexOf(text[i + 2] as string)) << 6)
      | (text[i + 3] === '=' ? 0 : B64.indexOf(text[i + 3] as string));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// CRC-16/XMODEM over the characters of the Base64 text, as four upper-case hex digits.
export function crc16Xmodem(text: string): string {
  let crc = 0;
  for (let i = 0; i < text.length; i++) {
    crc ^= (text.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// What compresses: bytes in, zlib-format bytes out.
export type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>;
export type Inflate = (bytes: Uint8Array) => Promise<Uint8Array>;

// The ^GF data field for the dots.
export async function z64Field(bitmap: Bitmap, deflate: Deflate): Promise<string> {
  const b64 = base64Encode(await deflate(bitmap.bits));
  return `:Z64:${b64}:${crc16Xmodem(b64)}`;
}

// A whole graphic field: `^GFA,<total>,<total>,<bytes per row>,<data>^FS`.
export async function graphicField(bitmap: Bitmap, deflate: Deflate): Promise<string> {
  const total = bitmap.bytesPerRow * bitmap.height;
  return `^GFA,${total},${total},${bitmap.bytesPerRow},${await z64Field(bitmap, deflate)}^FS`;
}

// The most copies one job may ask for: the print queue's own limit (print-queue-model MAX_COPIES, 99).
export const MAX_IMAGE_COPIES = 99;

export interface ImageJobOptions {
  // How many labels: whole, 1 to 99 (anything else is brought into that range).
  readonly copies: number;
  // ^POI (turned round, what the owner's driver does) or ^PON.
  readonly rotate180: boolean;
}

// The whole job, line for line the script's, without its first line (~SD28, see the header):
//   ^XA ^PW640 ^LL480 ^LH0,0 ^POI|^PON ^PR2 ^PQn ^FO0,0^GFA… ^XZ
// ^PR2 is the slowest speed (2 inches a second), the owner's choice for a cleaner transfer.
export async function imageLabelZpl(bitmap: Bitmap, options: ImageJobOptions, deflate: Deflate): Promise<string> {
  const n = Math.floor(Number(options.copies));
  const copies = Number.isFinite(n) ? Math.min(MAX_IMAGE_COPIES, Math.max(1, n)) : 1;
  return [
    '^XA',
    `^PW${bitmap.width}`,
    `^LL${bitmap.height}`,
    '^LH0,0',
    options.rotate180 ? '^POI' : '^PON',
    '^PR2',
    `^PQ${copies}`,
    `^FO0,0${await graphicField(bitmap, deflate)}`,
    '^XZ',
  ].join('\n') + '\n';
}

// A Z64 field read back into its bytes, checking the CRC — what the printer does on arrival. Null when anything is off.
export async function readZ64(field: string, inflate: Inflate): Promise<Uint8Array | null> {
  const m = /^:Z64:([A-Za-z0-9+/=]*):([0-9A-F]{4})$/.exec(field);
  if (!m) return null;
  const b64 = m[1] as string;
  if (crc16Xmodem(b64) !== m[2]) return null;
  const packed = base64Decode(b64);
  if (packed === null) return null;
  try {
    return await inflate(packed);
  } catch {
    return null;
  }
}
