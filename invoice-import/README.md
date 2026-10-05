# Mise invoice import — the local script

> **The app now reads the zip itself.** In «Importa da fatture» the owner picks the zip(s)
> downloaded from the Agenzia delle Entrate (or loose .xml files) and the app does what this
> script does — no Python, no Excel (`js/orders/invoice-zip/`; what the owner decides is
> remembered per product and per supplier in `invoice-decisions`). **This script is kept as
> a fallback**, and its `.json` file is still accepted by the same screen; the contract below
> is unchanged.

Turns the supplier e-invoices (FatturaPA XML, as downloaded from the Agenzia delle
Entrate portal) into a file the **«Import from invoices»** screen of Mise can read.

It runs on the owner's computer, never in the app and never on a server. It writes
**nothing** to the database: every write is done later by the app, signed in, through
the same rules as the forms.

```
invoices (.zip / .xml)  ──►  workbook (.xlsx)  ──►  you fill «Azione»  ──►  import file (.json)  ──►  Mise
         python invoice_import.py workbook                 python invoice_import.py json
```

⚠️ **Real invoices, the workbook and the import file NEVER go in this repository.**
The repository is public and everything in it is served by GitHub Pages. They live in
the workspace folder beside it, `..\import-fatture\` (the script's default), and the
script refuses to write inside the repository. The tests use invented invoices only
(`tests/fixtures/`), with invented names and VAT numbers.

## Why Python

The Mise app and its other tools are plain JavaScript with no dependencies. This one is
Python because it needs three things Node does not have built in and the app must never
hand-roll: reading zip archives, parsing XML, and reading/writing Excel. Python has the
first two in its standard library; Excel needs **one** library, `openpyxl`, pinned in
`requirements.txt`.

## Running it

Python 3.11 or newer, then once: `python -m pip install -r requirements.txt`.

1. `python invoice_import.py workbook` — reads every `.zip` and `.xml` in
   `..\import-fatture\fatture\`, and writes `..\import-fatture\fatture_ingredienti_mise.xlsx`
   (the previous one is kept as a dated copy first). The decisions already in the
   previous workbook are carried over, so each month you only fill the new rows.
2. Open the workbook and fill the **Azione** column (see the legend on the first rows).
3. `python invoice_import.py json` — writes `..\import-fatture\mise-import-YYYY-MM-DD.json`
   from the rows you marked, and prints the rows it could not include and why.
4. In Mise: Suppliers → «Import from invoices» → pick that file.

Local settings (suppliers to leave out because they sell services, the weight of one
egg) live in `..\import-fatture\config.json`, not here: they are business data.
`config.example.json` shows the shape. The file also holds `novatSalt`, a random secret the
script creates by itself (and says so, once) the first time it is missing: it salts the key of
a supplier without a VAT number. Never delete or change it: every such supplier would get a
new key and its decisions in the workbook would be lost.

## The import file — the contract with the app

The app (`js/orders/invoice-import-model.js`) refuses a file whose `format` or
`version` it does not know. Change this shape only together with the app and both
test suites.

```json
{
  "format": "mise-invoice-import",
  "version": 1,
  "generatedAt": "2026-10-03T10:00:00Z",
  "suppliers": [
    { "key": "IT00000000001", "vatNumber": "IT00000000001", "name": "FORNITORE ESEMPIO SRL" }
  ],
  "ingredients": [
    {
      "key": "IT00000000001|code:F00-25",
      "supplierKey": "IT00000000001",
      "mergeWith": "",
      "name": "Farina tipo 00",
      "brand": "",
      "category": "",
      "supplierCode": "F00-25",
      "weight": "25 kg",
      "packUnit": "sacco",
      "packCount": null,
      "priceUnit": "kg",
      "unitWeightKg": null,
      "vatRate": 4,
      "prices": [
        { "invoiceId": "18000000001", "line": 5, "invoiceDate": "2026-08-31",
          "pricePerUnit": 0.57, "qty": 25 }
      ]
    }
  ]
}
```

- `suppliers[].key` is the normalised VAT number (`IdPaese` + `IdCodice`, upper case,
  no spaces). The tax code (codice fiscale) is used only to tell suppliers apart when a
  VAT number is missing, and is **never** written to this file: such a supplier gets the
  key `NOVAT:<first 12 hex characters of the SHA-256 of novatSalt + the tax code>` and
  `vatNumber: ""`, and the app matches it by name only. (Salted because a tax code has so
  little entropy that a plain hash could be reversed by trying them all.)
- `ingredients[].key` is `<supplier key>|code:<article code>` when the invoice gives an
  article code, else `<supplier key>|name:<normalised description>`. It is stable from
  one month to the next, which is what carries the decisions over.
- `mergeWith` is the name of an ingredient already in Mise («unisci con …»), or `''`.
- `priceUnit` is `kg`, `l` or `pcs`. Litres are kept as litres (Mise reads 1 l as 1 kg,
  as it does for prices typed by hand). `pcs` (eggs) always carries `unitWeightKg`.
- `pricePerUnit` is **net of VAT**, per `priceUnit`, computed from what the invoice line
  really cost (line total ÷ quantity, so discounts and free goods on a separate line are
  included). One entry per invoice per product: lines of the same product on the same
  invoice are added together, and `line` is the first of them.
- **Sanity rules on the price** (`pricing.py`): a price per kg/l below 0.05 or above 300, or per
  piece below 0.01 or above 50, is always «da verificare» («prezzo fuori scala»), never «alta» or
  «media». For eggs with a per-pack count N, both readings of the quantity (counts eggs / counts
  packs) are tried and the one giving 0.05–0.90 € per egg wins; if both or neither do, packs are
  assumed and the product is «da verificare». The chosen reading also sets `qty`.
- `vatRate` is the line's rate if it is one of 0/4/5/10/20/22, else `null`.
- `weight` is ONE package (`"2.5 kg"`), `packCount` how many packages a carton holds
  (`null` = sold singly), exactly as the ingredient card stores them.
- Only rows marked «importa» or «unisci con …» are written, and only when they have a
  price, a unit and, where needed, a weight. Everything else is listed by the script,
  never silently dropped.
- **Only ingredients are imported.** The workbook's yellow column «Tipo» (`ingrediente`,
  `packaging`, `rivendita`) holds what the script took each product for; correct it if it
  is wrong. A row whose Tipo is not «ingrediente» is listed with the reason «packaging e
  rivendita non si importano per ora» and left out of the file.
- `invoiceId` is the invoice's SDI id (digits only). An invoice with no SDI id is excluded
  and listed («manca l'identificativo SDI»), never given an id made from its file name.
  When one file holds several invoices, the lines of the second are numbered from 100001,
  the third from 200001 and so on, so `invoiceId` + `line` stays unique (at most 9
  invoices per file).
- File names are never printed or written to a sheet raw: anything shaped like a personal
  tax code is replaced by `***` (the SDI names a sole trader's file after the tax code).

## Tests

From the repository root: `python -m unittest discover -s invoice-import/tests -t invoice-import`.
They use invented invoices only (built in a temporary folder, plus the few files in
`tests/fixtures/`) and run in CI (`.github/workflows/test.yml`, job `test`).
