// The code of a screen could not be downloaded (a section's chunk, fetched when it is first opened).
//
// ⚠️ IT CANNOT BE FIXED BY DRAWING AGAIN. Both React.lazy and the browser remember a failed dynamic
// import for the life of the page: asking again rethrows the same failure at once, without going to
// the network. Only a new page load tries the download afresh. PartBoundary therefore answers
// «Reload» with a reload of the page when it caught one of these, and with a plain redraw
// otherwise (a bug in a screen may well be fixed by drawing it again).
export class ScreenLoadError extends Error {
  constructor(cause: unknown) {
    super('A screen could not be downloaded.', { cause });
    this.name = 'ScreenLoadError';
  }
}
