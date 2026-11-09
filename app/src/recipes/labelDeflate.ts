import type { Deflate, Inflate } from '@mise/shared/zpl-z64';

// The compression of an image label's job (Z64 wants zlib), from the browser itself: no library. CompressionStream
// arrived in Chrome 80, so the lab tablet's Chrome 101 has it; a browser without it is told apart by a feature check, and
// the screen says so instead of failing in the middle of a print.

async function through(bytes: Uint8Array, stream: ReadableWritablePair<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = await new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }).pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

// 'deflate' IS THE ZLIB FORMAT (two-byte header, Adler-32 at the end), which is what Zebra's Z64 expects; 'deflate-raw'
// would be refused by the printer.
export const browserDeflate: Deflate = async bytes => {
  if (typeof CompressionStream !== 'function') throw new Error('no-compression');
  return through(bytes, new CompressionStream('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
};

// The reverse: for specs and drivers that read a job back.
export const browserInflate: Inflate = async bytes => {
  if (typeof DecompressionStream !== 'function') throw new Error('no-compression');
  return through(bytes, new DecompressionStream('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
};
