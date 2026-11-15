# The image label's fonts

The image label with the logo (`shared/src/label-image-layout.ts`) is drawn in the faces the owner's own script used, so
the paper comes out the same: DejaVu Sans for the ingredients, DejaVu Sans Bold for the allergen words and the date
line, Liberation Sans Bold for the title. They are loaded only by the label screen.

| File | Family name here | Made from | Bytes | sha256 |
|---|---|---|---|---|
| `label-sans.woff2` | Mise Label Sans (Book) | `DejaVuSans.ttf` 2.37 | 26 824 | `122e36c9ef26dd2d2f434d447e4fa6cc94c22a7c8d5f628c287d6e0b93e8838e` |
| `label-sans-bold.woff2` | Mise Label Sans (Bold) | `DejaVuSans-Bold.ttf` 2.37 | 25 084 | `c608999908e9956a73c17dfe1c8f784e80a752404aa6c0cb69d9e92341518262` |
| `label-title.woff2` | Mise Label Title (Bold) | `LiberationSans-Bold.ttf` 2.1.5 | 24 656 | `e9b54dde87f0e5c6ead1f6115853867d52d799347cc5dbd4de6f08f4a567e7c8` |

## Where they come from

| Source | Official release | sha256 of the download | sha256 of the font used |
|---|---|---|---|
| DejaVu 2.37 | github.com/dejavu-fonts/dejavu-fonts, release `version_2_37`, `dejavu-fonts-ttf-2.37.zip` | `7576310b219e04159d35ff61dd4a4ec4cdba4f35c00e002a136f00e96a908b0a` | `DejaVuSans.ttf` `7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954`; `DejaVuSans-Bold.ttf` `e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724` |
| Liberation 2.1.5 | github.com/liberationfonts/liberation-fonts, release `2.1.5`, `liberation-fonts-ttf-2.1.5.tar.gz` | `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0` | `LiberationSans-Bold.ttf` `788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173` |

## How they were made

Subset with fontTools 4.60.1 (WOFF2 through brotlicffi), timestamps not recalculated so a rebuild is byte-identical,
by `algprobe/label-golden/build_fonts.py` (outside the repo, next to the golden harness). Kept: U+0020–007E,
U+00A0–017F, U+2010–2027, U+2030, U+2039, U+203A, U+20AC, U+2122 (Liberation has no U+2011, U+2023–2025, U+2027). The
same script writes `shared/src/fixtures/label-image-metrics.json` — every advance at every size the layout uses, the
kerning pairs and the ascents — and checks the kerning sums against Pillow on every pair at every size, so the layout
measures under Node exactly as the script measured with Pillow. A character outside the subset is refused by the label
screen, never drawn in a fallback face.

## Licences

- **DejaVu** — Bitstream Vera licence (DejaVu's own changes are public domain): `LICENSE-DejaVu.txt`. A modified copy
  may not carry the name «Bitstream» or «Vera»; that is why the subsets are renamed.
- **Liberation** — SIL Open Font License 1.1, Reserved Font Name «Liberation»: `LICENSE-Liberation.txt`. A modified
  copy (a subset is one) may not use the reserved name; hence «Mise Label Title».

Changing a font, its version or the subset means rebuilding the metrics with the same script, and the golden specs
(`label-image-fonts.spec.ts`, `label-image-layout.spec.ts`) say whether the label still measures like the original.
