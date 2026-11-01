// export-icon.js — the shapes the recipe export draws, in the app's icon convention (24×24 box,
// stroked 2px, currentColor). Pure data, like js/send-icon.js; svgElement() there turns them into
// an element. A download arrow for the button, a document for PDF, a table for Excel.

export const DOWNLOAD_PATHS = Object.freeze([
  'M12 3v12',
  'M7 10l5 5 5-5',
  'M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4',
]);

export const DOCUMENT_PATHS = Object.freeze([
  'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z',
  'M14 2v6h6',
  'M8 13h8',
  'M8 17h8',
]);

export const TABLE_PATHS = Object.freeze([
  'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z',
  'M3 9h18',
  'M3 15h18',
  'M9 3v18',
]);
