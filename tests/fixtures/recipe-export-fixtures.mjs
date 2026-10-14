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
