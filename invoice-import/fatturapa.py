"""Reads FatturaPA e-invoices (loose XML or zip archives of XML) into plain objects.

Nothing here writes anywhere. Archives are read in memory and never extracted, so a
hostile file name inside a zip cannot reach the disk.
"""
from __future__ import annotations

import hashlib
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from pathlib import Path, PurePosixPath

# Document types the import understands: TD01 an ordinary invoice, TD24 and TD25 DEFERRED
# invoices (fattura differita: the goods were delivered on the delivery notes of the month
# and invoiced together afterwards, which is how most suppliers of a bakery bill). They are
# kept ON PURPOSE. Anything else (a TD04 credit note, say) is listed as excluded, never
# silently dropped.
KEPT_TYPES = ("TD01", "TD24", "TD25")

# An import file's line number is at most 999999 (the app's rule). A second invoice inside
# one file gets the numbers of its lines pushed up by LINE_BLOCK per body, so a price point's
# id stays unique and the invoice id stays the file's own SDI id (digits only).
LINE_BLOCK = 100_000
MAX_BODIES = 9

# `<base>_MT_001.xml` (SDI metadata) and `<base>_PAD_MT_001.xml` (PEC reception date).
METADATA_RE = re.compile(r"^(?P<base>.+?)(?P<pad>_PAD)?_MT_\d+\.xml$", re.I)

# An e-invoice is a few hundred KB. A file far bigger than that is not one.
MAX_XML_BYTES = 30_000_000


@dataclass
class Line:
    number: int
    article_code: str
    description: str
    quantity: float | None
    unit: str
    unit_price: float | None
    total: float | None
    vat_rate: float | None
    natura: str
    has_discount: bool


@dataclass
class Document:
    file: str  # shown to the owner; a sole trader's tax code is blanked out of it
    # An id for THIS program only (dedupe, status): the SDI id, or the file's base name when there
    # is none, plus «-2», «-3» for further invoices in one file. It is never written to the import
    # file: a document with no SDI id is excluded, and the price points carry `sdi_id`.
    doc_id: str
    supplier_key: str
    supplier_name: str
    vat_number: str
    doc_type: str
    date: str
    number: str
    total: float | None
    sdi_id: str
    reception_date: str
    lines: list[Line] = field(default_factory=list)


@dataclass
class SkippedFile:
    name: str
    reason: str


@dataclass
class LoadResult:
    documents: list[Document] = field(default_factory=list)
    skipped: list[SkippedFile] = field(default_factory=list)
    p7m_count: int = 0
    duplicates: int = 0
    other_xml: int = 0


def strip_namespaces(root: ET.Element) -> ET.Element:
    """The same invoice arrives as `ns3:`, `p:` or default-namespace XML."""
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def parse_xml(data: bytes) -> ET.Element:
    data = data.lstrip()
    if len(data) > MAX_XML_BYTES:
        raise ValueError("file troppo grande")
    # ElementTree expands entities, so a crafted DOCTYPE could eat all the memory
    # ("billion laughs"). A FatturaPA never has a DTD: refuse any that does.
    if re.search(rb"<!\s*(DOCTYPE|ENTITY)", data, re.I):
        raise ValueError("DTD non ammessa in una fattura")
    return strip_namespaces(ET.fromstring(data))


def text(node: ET.Element | None, path: str) -> str:
    if node is None:
        return ""
    el = node.find(path)
    return el.text.strip() if el is not None and el.text else ""


def number(s: str) -> float | None:
    try:
        return float(s.replace(",", "."))
    except (AttributeError, ValueError):
        return None


def iso_date(s: str) -> str:
    """YYYY-MM-DD from an ISO date (with or without time/zone) or an e-mail date."""
    s = (s or "").strip()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    try:
        return parsedate_to_datetime(s).strftime("%Y-%m-%d")
    except (TypeError, ValueError, IndexError):
        return ""


def normalise_vat(country: str, code: str) -> str:
    return re.sub(r"\s+", "", f"{country}{code}").upper()


def no_vat_key(tax_code: str, fallback_name: str, salt: str = "") -> str:
    """Key of a supplier without a VAT number.

    Only a SALTED hash of the tax code leaves this function: the tax code of a sole trader is
    personal data, and a tax code has so little entropy that an unsalted hash could be
    reversed by trying every possibility. The salt (`novatSalt` in config.json) stays on
    this computer, so the key can only be recomputed here.
    """
    basis = re.sub(r"\s+", "", tax_code).upper() or re.sub(r"\s+", " ", fallback_name).strip().upper()
    return "NOVAT:" + hashlib.sha256((salt + basis).encode("utf-8")).hexdigest()[:12]


def _supplier(root: ET.Element, novat_salt: str = "") -> tuple[str, str, str, str]:
    """(key, name, vat number, tax code) of the invoice's supplier."""
    anag = root.find("FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici")
    name = text(anag, "Anagrafica/Denominazione") or " ".join(
        p for p in (text(anag, "Anagrafica/Nome"), text(anag, "Anagrafica/Cognome")) if p
    )
    name = re.sub(r"\s+", " ", name).strip()
    vat = normalise_vat(text(anag, "IdFiscaleIVA/IdPaese"), text(anag, "IdFiscaleIVA/IdCodice"))
    tax_code = text(anag, "CodiceFiscale")
    if vat:
        return vat, name, vat, tax_code
    return no_vat_key(tax_code, name, novat_salt), name, "", tax_code


def _lines(body: ET.Element, offset: int = 0) -> list[Line]:
    out = []
    for i, el in enumerate(body.findall("DatiBeniServizi/DettaglioLinee"), start=1):
        qty = number(text(el, "Quantita"))
        unit_price = number(text(el, "PrezzoUnitario"))
        total = number(text(el, "PrezzoTotale"))
        if total is None and qty is not None and unit_price is not None:
            total = qty * unit_price
        out.append(
            Line(
                number=offset + int(number(text(el, "NumeroLinea")) or i),
                article_code=text(el, "CodiceArticolo/CodiceValore"),
                description=re.sub(r"\s+", " ", text(el, "Descrizione")).strip(),
                quantity=qty,
                unit=text(el, "UnitaMisura"),
                unit_price=unit_price,
                total=total,
                vat_rate=number(text(el, "AliquotaIVA")),
                natura=text(el, "Natura"),
                has_discount=el.find("ScontoMaggiorazione") is not None,
            )
        )
    return out


PERSONAL_TAX_CODE_RE = re.compile(r"[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]", re.I)


def redact_file_name(name: str) -> str:
    """A file name as it may be shown: anything shaped like a personal tax code is blanked.
    EVERY file name that is printed or listed goes through here — the SDI names a file
    `IT<tax code>_<number>.xml`, and for a sole trader that is a person's tax code."""
    return PERSONAL_TAX_CODE_RE.sub("***", name)


def _redact(name: str, tax_code: str) -> str:
    """The SDI names a file `IT<tax code>_<number>.xml`: for a sole trader that is a
    person's tax code, personal data that must not reach the workbook. Blank the
    supplier's own tax code, and anything shaped like a personal one, whatever the VAT."""
    if tax_code:
        name = re.sub(re.escape(tax_code), "***", name, flags=re.I)
    return redact_file_name(name)


def parse_invoice(root: ET.Element, base: str, sdi_id: str, reception: str, novat_salt: str = "") -> list[Document]:
    key, name, vat, tax_code = _supplier(root, novat_salt)
    shown = _redact(base, tax_code)
    docs = []
    for i, body in enumerate(root.findall("FatturaElettronicaBody")):
        general = body.find("DatiGenerali/DatiGeneraliDocumento")
        doc_id = sdi_id or shown
        if i:
            doc_id = f"{doc_id}-{i + 1}"
        docs.append(
            Document(
                file=shown,
                doc_id=doc_id,
                supplier_key=key,
                supplier_name=name,
                vat_number=vat,
                doc_type=text(general, "TipoDocumento").upper(),
                date=iso_date(text(general, "Data")),
                number=text(general, "Numero"),
                total=number(text(general, "ImportoTotaleDocumento")),
                sdi_id=sdi_id,
                reception_date=iso_date(reception),
                lines=_lines(body, i * LINE_BLOCK),
            )
        )
    return docs


# A container is a folder of loose files or one zip: base file name -> file content.
# Archives are read completely and closed at once: an open zip keeps its file locked
# on Windows, and a few hundred small XML files cost nothing to hold.
Container = dict[str, bytes]


def _zip_container(path: Path, skipped: list[SkippedFile]) -> tuple[Container, int]:
    entries: Container = {}
    p7m = 0
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = PurePosixPath(info.filename.replace("\\", "/")).name
            low = name.lower()
            if low.endswith(".p7m"):
                p7m += 1
            elif low.endswith(".xml"):
                if info.file_size > MAX_XML_BYTES:
                    skipped.append(SkippedFile(redact_file_name(name), "file troppo grande"))
                else:
                    entries[name] = zf.read(info)
    return entries, p7m


def _folder_container(files: list[Path], skipped: list[SkippedFile]) -> tuple[Container, int]:
    entries: Container = {}
    p7m = 0
    for f in files:
        low = f.name.lower()
        if low.endswith(".p7m"):
            p7m += 1
        elif low.endswith(".xml"):
            if f.stat().st_size > MAX_XML_BYTES:
                skipped.append(SkippedFile(redact_file_name(f.name), "file troppo grande"))
            else:
                entries[f.name] = f.read_bytes()
    return entries, p7m


def _read_metadata(entries: Container) -> tuple[dict[str, str], dict[str, str]]:
    sdi: dict[str, str] = {}
    reception: dict[str, str] = {}
    for name, data in entries.items():
        m = METADATA_RE.match(name)
        if not m:
            continue
        try:
            root = parse_xml(data)
        except (ET.ParseError, ValueError):
            continue
        base = m.group("base")
        found_sdi = text(root, ".//IdentificativoSdI") or text(root, "IdentificativoSdI")
        found_pec = text(root, ".//PECEmailDate") or text(root, "PECEmailDate")
        if found_sdi:
            sdi.setdefault(base, found_sdi)
        if found_pec:
            reception.setdefault(base, found_pec)
    return sdi, reception


def load_invoices(fatture_dir: Path, novat_salt: str = "") -> LoadResult:
    result = LoadResult()
    containers: list[Container] = []
    if fatture_dir.is_dir():
        for zpath in sorted(fatture_dir.iterdir(), key=lambda p: p.name.lower()):
            if zpath.is_file() and zpath.suffix.lower() == ".zip":
                try:
                    entries, p7m = _zip_container(zpath, result.skipped)
                except zipfile.BadZipFile:
                    result.skipped.append(SkippedFile(redact_file_name(zpath.name), "archivio zip non leggibile"))
                    continue
                containers.append(entries)
                result.p7m_count += p7m
        loose = [p for p in sorted(fatture_dir.iterdir(), key=lambda p: p.name.lower())
                 if p.is_file() and p.suffix.lower() in (".xml", ".p7m")]
        if loose:
            entries, p7m = _folder_container(loose, result.skipped)
            containers.append(entries)
            result.p7m_count += p7m

    seen: set[str] = set()
    for entries in containers:
        sdi_ids, receptions = _read_metadata(entries)
        for name in sorted(entries):
            if METADATA_RE.match(name):
                continue
            base = name[:-4]
            try:
                root = parse_xml(entries[name])
            except (ET.ParseError, ValueError) as exc:
                result.skipped.append(SkippedFile(redact_file_name(name), f"XML non leggibile ({exc})"))
                continue
            if root.tag != "FatturaElettronica":
                result.other_xml += 1
                continue
            if len(root.findall("FatturaElettronicaBody")) > MAX_BODIES:
                result.skipped.append(SkippedFile(
                    redact_file_name(name), f"più di {MAX_BODIES} fatture nello stesso file"))
                continue
            for doc in parse_invoice(root, base, sdi_ids.get(base, ""), receptions.get(base, ""), novat_salt):
                # The same invoice is in several archives; the SDI id is what tells.
                dedupe_key = doc.doc_id
                if dedupe_key in seen:
                    result.duplicates += 1
                    continue
                seen.add(dedupe_key)
                result.documents.append(doc)
    return result
