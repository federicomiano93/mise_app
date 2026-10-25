// Z64 and the image label's job. The compression is handed in: here it is Node's own (the zlib format the browser's
// CompressionStream('deflate') also writes), so the round trip is real bytes through a real deflate and back.

import { describe, expect, test } from 'vitest';
import { toBitmap } from './label-image-raster';
import { base64Decode, base64Encode, crc16Xmodem, graphicField, imageLabelZpl, readZ64, z64Field } from './zpl-z64';
import type { Deflate, Inflate } from './zpl-z64';

// shared/ has no DOM or Node types; Node 18+ has the Compression Streams as globals.
declare const CompressionStream: new (format: string) => { readable: unknown; writable: unknown };
declare const DecompressionStream: new (format: string) => { readable: unknown; writable: unknown };
declare const Blob: new (parts: unknown[]) => { stream(): { pipeThrough(t: unknown): unknown } };
declare const Response: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
const through = (T: new (f: string) => unknown) => async (bytes: Uint8Array) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new T('deflate'))).arrayBuffer());
const deflate: Deflate = through(CompressionStream);
const inflate: Inflate = through(DecompressionStream);

// A label-sized picture: white, a black band and some speckle, deterministic.
function picture(): ReturnType<typeof toBitmap> {
  const w = 640, h = 480;
  const data = new Uint8Array(w * h).fill(255);
  let x = 7;
  for (let i = 0; i < data.length; i++) {
    if (i > w * 100 && i < w * 140) data[i] = 0;
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    if (x % 97 === 0) data[i] = 0;
  }
  return toBitmap({ width: w, height: h, data });
}

describe('Z64', () => {
  test('CRC-16/XMODEM: the standard check value', () => {
    expect(crc16Xmodem('123456789')).toBe('31C3');
    expect(crc16Xmodem('')).toBe('0000');
  });

  test('Base64 both ways, every padding', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const bytes = Uint8Array.from([...s].map(c => c.charCodeAt(0)));
      const enc = base64Encode(bytes);
      expect(enc).toBe(['', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy'][s.length]);
      expect([...(base64Decode(enc) ?? [])]).toEqual([...bytes]);
    }
    expect(base64Decode('not base64!')).toBeNull();
  });

  test('a label round trip: the field reads back to the very same dots, as the printer checks it', async () => {
    const b = picture();
    const field = await z64Field(b, deflate);
    expect(field).toMatch(/^:Z64:[A-Za-z0-9+/]+=*:[0-9A-F]{4}$/);
    expect([...(await readZ64(field, inflate) ?? [])]).toEqual([...b.bits]);
  });

  test('a damaged field is refused (wrong CRC, not Z64, broken data)', async () => {
    const field = await z64Field(picture(), deflate);
    const crc = field.slice(-4);
    expect(await readZ64(field.slice(0, -4) + (crc === '0000' ? '0001' : '0000'), inflate)).toBeNull();
    expect(await readZ64(':B64:AAAA:0000', inflate)).toBeNull();
    const junk = base64Encode(Uint8Array.from([1, 2, 3, 4]));
    expect(await readZ64(`:Z64:${junk}:${crc16Xmodem(junk)}`, inflate)).toBeNull();
  });

  test('the graphic field counts the uncompressed bytes twice, then the bytes per row (as Zebra’s designer writes)', async () => {
    expect(await graphicField(picture(), deflate)).toMatch(/^\^GFA,38400,38400,80,:Z64:.+\^FS$/);
  });
});

describe('the job', () => {
  test('the script’s lines, without its darkness: no tilde anywhere', async () => {
    const zpl = await imageLabelZpl(picture(), { copies: 3, rotate180: true }, deflate);
    const lines = zpl.trimEnd().split('\n');
    expect(lines.slice(0, 7)).toEqual(['^XA', '^PW640', '^LL480', '^LH0,0', '^POI', '^PR2', '^PQ3']);
    expect(lines[7]).toMatch(/^\^FO0,0\^GFA,/);
    expect(lines[8]).toBe('^XZ');
    expect(zpl).not.toContain('~');
  });

  test('turned round or not; copies brought into 1–99', async () => {
    const b = picture();
    expect(await imageLabelZpl(b, { copies: 1, rotate180: false }, deflate)).toContain('^PON');
    expect(await imageLabelZpl(b, { copies: 0, rotate180: true }, deflate)).toContain('^PQ1\n');
    expect(await imageLabelZpl(b, { copies: 500, rotate180: true }, deflate)).toContain('^PQ99\n');
    expect(await imageLabelZpl(b, { copies: Number.NaN, rotate180: true }, deflate)).toContain('^PQ1\n');
  });

  test('a busy label is far under the 77 000 characters of plain hex', async () => {
    const zpl = await imageLabelZpl(picture(), { copies: 1, rotate180: true }, deflate);
    expect(zpl.length).toBeLessThan(77000 / 2);
  });
});
