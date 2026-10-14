// Made-up recipes for the export tests. The repo is public: never a real recipe name here.

export const SIX = {
  name: 'Impasto di prova',
  trays: 0,
  totalG: 24000,
  rows: [
    { name: 'Farina di prova', grams: 14400.4 },
    { name: 'Acqua', grams: 8640.5 },
    { name: 'Sale', grams: 288.25 },
    { name: 'Lievito', grams: 72.5 },
    { name: 'Olio di prova', grams: 480 },
    { name: 'Malto', grams: 118.4 },
  ],
};

export const TRAYS = { ...SIX, name: 'Pizza di prova', trays: 3, totalG: 9000 };

export const LONG_ROW = {
  ...SIX,
  rows: [...SIX.rows, { name: 'Confettura di ciliegie della prova lunghissima', grams: 1500 }],
};

export const SIXTY = {
  name: 'Ricetta enorme di prova',
  trays: 0,
  totalG: 60000,
  rows: Array.from({ length: 60 }, (_, i) => ({ name: `Ingrediente di prova numero ${i + 1}`, grams: 100 + i * 7.3 })),
};

export const AWKWARD_NAME = {
  name: '  Focaccia: più/meno *prova*?  ',
  trays: 0,
  totalG: 1000,
  rows: [{ name: 'Farina «tipo 00» — è ’buona’', grams: 1000 }],
};

// Rows in their own unit, as the Recipe catalogue draws them. 500 ml + 2 kg + 250 g = 2750 g.
export const MIXED = {
  name: 'Crema di prova',
  trays: 0,
  totalG: 2750,
  rows: [
    { name: 'Latte di prova', value: 500, unit: 'ml', factor: 1 },
    { name: 'Farina di prova', value: 2, unit: 'kg', factor: 1000 },
    { name: 'Uova di prova', value: 3, unit: 'pz', factor: 0 },
    { name: 'Zucchero di prova', value: 250, unit: 'g', factor: 1 },
    { name: 'Sale di prova', value: null, unit: 'q.b.', factor: 0 },
  ],
};

// Each row rounds in its own unit on screen: 920 g of oil and of water each read «1 kg», while the
// Total says 1841 g. The formula over the rows (1 kg + 1 kg + 1 g = 2001 g) would not round to it.
export const MIXED_DRIFT = {
  name: 'Salsa di prova',
  trays: 0,
  totalG: 1841,
  rows: [
    { name: 'Olio di prova', value: 1, unit: 'kg', factor: 1000 },
    { name: 'Acqua di prova', value: 1, unit: 'kg', factor: 1000 },
    { name: 'Pepe di prova', value: 1, unit: 'g', factor: 1 },
  ],
};

export const ONLY_PIECES = {
  name: 'Decori di prova',
  trays: 0,
  totalG: 0,
  rows: [
    { name: 'Fragole di prova', value: 12, unit: 'pz', factor: 0 },
    { name: 'Sale di prova', value: null, unit: 'q.b.', factor: 0 },
  ],
};
