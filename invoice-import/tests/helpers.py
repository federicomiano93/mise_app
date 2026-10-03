"""Invented invoices for the tests. Every name, VAT number and price here is made up:
the repository is public, so a real invoice must never become a fixture."""
from __future__ import annotations

import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import fatturapa
import products

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def line_xml(n: int, spec: dict) -> str:
    qty, total = spec.get("qty"), spec.get("total")
    parts = [f"<NumeroLinea>{n}</NumeroLinea>"]
    if spec.get("code"):
        parts.append(f"<CodiceArticolo><CodiceTipo>X</CodiceTipo><CodiceValore>{escape(spec['code'])}</CodiceValore></CodiceArticolo>")
    parts.append(f"<Descrizione>{escape(spec['desc'])}</Descrizione>")
    if qty is not None:
        parts.append(f"<Quantita>{qty}</Quantita>")
    if spec.get("unit"):
        parts.append(f"<UnitaMisura>{spec['unit']}</UnitaMisura>")
    if qty and total is not None:
        parts.append(f"<PrezzoUnitario>{total / qty}</PrezzoUnitario>")
    if total is not None:
        parts.append(f"<PrezzoTotale>{total}</PrezzoTotale>")
    parts.append(f"<AliquotaIVA>{spec.get('vat', '4.00')}</AliquotaIVA>")
    return "<DettaglioLinee>" + "".join(parts) + "</DettaglioLinee>"


def invoice_xml(lines, name="FORNITORE ESEMPIO SRL", vat="00000000001", tax_code=None, doc_type="TD01",
                date="2026-09-01", number="1") -> str:
    ident = f"<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>{vat}</IdCodice></IdFiscaleIVA>" if vat else ""
    cf = f"<CodiceFiscale>{tax_code}</CodiceFiscale>" if tax_code else ""
    body = "".join(line_xml(i, spec) for i, spec in enumerate(lines, start=1))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">'
        f"<FatturaElettronicaHeader><CedentePrestatore><DatiAnagrafici>{ident}{cf}"
        f"<Anagrafica><Denominazione>{escape(name)}</Denominazione></Anagrafica></DatiAnagrafici>"
        "</CedentePrestatore></FatturaElettronicaHeader>"
        "<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento>"
        f"<TipoDocumento>{doc_type}</TipoDocumento><Data>{date}</Data><Numero>{number}</Numero>"
        "<ImportoTotaleDocumento>1.00</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali>"
        f"<DatiBeniServizi>{body}</DatiBeniServizi></FatturaElettronicaBody></p:FatturaElettronica>"
    )


def metadata_xml(sdi: str) -> str:
    return f'<?xml version="1.0"?><FileMetadati><IdentificativoSdI>{sdi}</IdentificativoSdI></FileMetadati>'


def write_invoice(folder: Path, base: str, xml: str, sdi: str | None = None) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{base}.xml").write_text(xml, encoding="utf-8")
    if sdi:
        (folder / f"{base}_MT_001.xml").write_text(metadata_xml(sdi), encoding="utf-8")


class TempDirCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name).resolve()
        self.base = self.tmp / "import-fatture"
        self.fatture = self.base / "fatture"
        self.fatture.mkdir(parents=True)
        self._counter = 0

    def add(self, lines, sdi=None, base=None, **kwargs) -> None:
        """Write one invented invoice as a loose file in the fatture folder."""
        self._counter += 1
        write_invoice(self.fatture, base or f"inv{self._counter:03d}", invoice_xml(lines, **kwargs),
                      sdi or f"9000{self._counter:06d}")

    def catalogue(self, config=None):
        load = fatturapa.load_invoices(self.fatture)
        return products.build_catalogue(load, config or products.Config())

    def only_product(self, catalogue=None):
        catalogue = catalogue or self.catalogue()
        self.assertEqual(len(catalogue.products), 1, list(catalogue.products))
        return catalogue, next(iter(catalogue.products.values()))

    def zip_of(self, name: str, files: dict[str, str]) -> Path:
        path = self.fatture / name
        with zipfile.ZipFile(path, "w") as zf:
            for member, content in files.items():
                zf.writestr(member, content)
        return path


def copy_fixtures(dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for f in FIXTURES.glob("*.xml"):
        shutil.copy(f, dest / f.name)
