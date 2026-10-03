"""Groups invoice lines into products and works out what to propose for each.

A product is one supplier's article: the key is the supplier plus the article code,
or the normalised description when the invoice gives no code (see classify.py).
"""
from __future__ import annotations

import json
import os
import re
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from classify import (
    PackInfo, classify, clean_name, eggs_per_pack, is_egg, is_unattributed_discount, pack_word,
    parse_pack, parse_pack_text, product_key,
)
from fatturapa import KEPT_TYPES, Document, Line, LoadResult
from pricing import (
    PACK_UNITS, PIECES, Computed, Params, compute_document, round_half_up, unit_class, unit_weight_kg,
    worse,
)

DEFAULT_EGG_WEIGHT_G = 50.0
NO_SDI_REASON = "manca l'identificativo SDI"
VAT_RATES = (0, 4, 5, 10, 20, 22)
TYPE_ORDER = {"ingrediente": 0, "packaging": 1, "rivendita": 2}


class ConfigError(Exception):
    pass


@dataclass
class Config:
    excluded_suppliers: dict[str, str] = field(default_factory=dict)
    egg_weight_g: float = DEFAULT_EGG_WEIGHT_G
    # The secret that salts the key of a supplier without a VAT number (see fatturapa.no_vat_key).
    novat_salt: str = ""


def _normalise_key(key: str) -> str:
    return re.sub(r"\s+", "", str(key)).upper()


def load_config(path: Path) -> Config:
    """`config.json` is optional: it holds business data and lives outside the repo."""
    if not path.is_file():
        return Config()
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ConfigError(f"Non riesco a leggere {path.name}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{path.name} deve contenere un oggetto JSON.")
    excluded = raw.get("excludedSuppliers", {})
    if not isinstance(excluded, dict):
        raise ConfigError("excludedSuppliers deve essere un oggetto {P.IVA: motivo}.")
    egg = raw.get("eggWeightG", DEFAULT_EGG_WEIGHT_G)
    if isinstance(egg, bool) or not isinstance(egg, (int, float)) or egg <= 0:
        raise ConfigError("eggWeightG deve essere un numero maggiore di zero.")
    salt = raw.get("novatSalt", "")
    if not isinstance(salt, str):
        raise ConfigError("novatSalt deve essere un testo.")
    return Config({_normalise_key(k): str(v) for k, v in excluded.items()}, float(egg), salt.strip())


def ensure_novat_salt(path: Path, config: Config) -> bool:
    """Make sure `novatSalt` exists. When it does not, a random one (32 hex characters) is added
    to config.json — every other key kept as it is, the file replaced in one step — and True is
    returned so the caller can say so once. The salt must stay the same from one run to the next,
    or every supplier without a VAT number gets a new key and its decisions are lost."""
    if config.novat_salt:
        return False
    raw: dict = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as exc:
            raise ConfigError(f"Non riesco a leggere {path.name}: {exc}") from exc
        if isinstance(loaded, dict):
            raw = loaded
    salt = secrets.token_hex(16)
    raw["novatSalt"] = salt
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        raise ConfigError(f"Non riesco a scrivere {path.name}: {exc}") from exc
    finally:
        if tmp.exists():
            tmp.unlink()
    config.novat_salt = salt
    return True


# ── the catalogue ────────────────────────────────────────────────────────────


@dataclass
class Entry:
    """One product on one invoice."""

    doc: Document
    lines: list[Line]
    type: str


@dataclass
class Product:
    key: str
    supplier_key: str
    code: str
    entries: list[Entry] = field(default_factory=list)

    @property
    def latest(self) -> Entry:
        return self.entries[-1]

    @property
    def type(self) -> str:
        return self.latest.type

    @property
    def description(self) -> str:
        return self.latest.lines[0].description


@dataclass
class Supplier:
    key: str
    name: str
    vat_number: str


@dataclass
class Excluded:
    level: str  # 'documento' | 'riga'
    supplier: str
    vat_number: str
    number: str
    date: str
    line: int | None
    description: str
    reason: str
    file: str


@dataclass
class Catalogue:
    documents: list[Document]
    doc_status: dict[str, str]
    suppliers: dict[str, Supplier]
    products: dict[str, Product]
    excluded: list[Excluded]
    discount_docs: set[str]
    config: Config
    load: LoadResult


def doc_sort_key(doc: Document) -> tuple[str, str]:
    return doc.date, doc.doc_id


def build_catalogue(load: LoadResult, config: Config) -> Catalogue:
    documents = sorted(load.documents, key=doc_sort_key)
    suppliers: dict[str, Supplier] = {}
    products: dict[str, Product] = {}
    excluded: list[Excluded] = []
    doc_status: dict[str, str] = {}
    discount_docs: set[str] = set()

    for doc in documents:
        # Ascending by date, so the last spelling seen is the most recent one.
        suppliers[doc.supplier_key] = Supplier(doc.supplier_key, doc.supplier_name, doc.vat_number)

        def doc_row(reason: str, doc: Document = doc) -> None:
            doc_status[doc.doc_id] = "esclusa: " + reason
            excluded.append(Excluded("documento", doc.supplier_name, doc.vat_number, doc.number, doc.date,
                                     None, "", reason, doc.file))

        if doc.supplier_key in config.excluded_suppliers:
            doc_row("fornitore escluso (" + config.excluded_suppliers[doc.supplier_key] + ")")
            continue
        if doc.doc_type not in KEPT_TYPES:
            doc_row(f"tipo documento {doc.doc_type or '?'}")
            continue
        # ⚠️ NO SDI ID, NO PRICE: the id of a price in Mise is the invoice's SDI id and its line. A file
        # name is not an identity (the same invoice downloaded twice is named differently), so a
        # document without one is listed and kept out, never given a made-up id.
        if not doc.sdi_id:
            doc_row(NO_SDI_REASON)
            continue
        doc_status[doc.doc_id] = "inclusa"

        grouped: dict[str, list[Line]] = {}
        types: dict[str, str] = {}
        for line in doc.lines:
            def line_row(reason: str, line: Line = line, doc: Document = doc) -> None:
                excluded.append(Excluded("riga", doc.supplier_name, doc.vat_number, doc.number, doc.date,
                                         line.number, line.description, reason, doc.file))

            if is_unattributed_discount(line.description, line.quantity, line.total):
                discount_docs.add(doc.doc_id)
                line_row("sconto su riga separata")
                continue
            kind, reason = classify(line.description, line.quantity, line.total)
            if kind == "excluded":
                line_row(reason)
                continue
            key = product_key(doc.supplier_key, line.article_code, line.description)
            grouped.setdefault(key, []).append(line)
            types.setdefault(key, kind)
        for key, lines in grouped.items():
            product = products.setdefault(key, Product(key, doc.supplier_key, lines[0].article_code.strip()))
            product.entries.append(Entry(doc, lines, types[key]))

    return Catalogue(documents, doc_status, suppliers, products, excluded, discount_docs, config, load)


# ── proposals and evaluation ─────────────────────────────────────────────────


def propose_params(product: Product, config: Config) -> Params:
    """Price unit and package, read from the most recent invoice's description."""
    entry = product.latest
    egg_weight = config.egg_weight_g / 1000
    first = entry.lines[0]
    cls, _ = unit_class(first.unit)
    if cls == PIECES and any(is_egg(ln.description) for ln in entry.lines):
        n = next((eggs_per_pack(ln.description) for ln in entry.lines if eggs_per_pack(ln.description)), None)
        return Params("pcs", None, n if n and n > 1 else None, egg=True, egg_weight_kg=egg_weight)
    info = next((p for p in (parse_pack(ln.description) for ln in entry.lines) if p), None)
    pack_dim = PACK_UNITS[info.unit][0] if info else None
    if cls == PIECES:
        price_unit = pack_dim
    else:
        price_unit = cls
        if pack_dim != cls:
            info = None  # «LT 1» on a line invoiced in kg: not a package of this product
    pack = PackInfo(info.size, info.unit) if info else None
    count = info.count if info and info.count and info.count > 1 else None
    return Params(price_unit, pack, count, egg=False, egg_weight_kg=egg_weight)


def propose_name(product: Product) -> str:
    return clean_name(product.description, product.code)


EGG_PACK_WORD = "uovo"


def propose_pack_word(product: Product) -> str:
    # Eggs bought by the tray are a carton of N eggs in Mise («Cartone, contiene 30 × uovo»):
    # without a word the app would fall back to its default «busta», which reads as 30 bags.
    entry = product.latest
    cls, _ = unit_class(entry.lines[0].unit)
    if cls == PIECES and any(is_egg(ln.description) for ln in entry.lines):
        return EGG_PACK_WORD
    return pack_word(product.description)


@dataclass
class PricePoint:
    invoice_id: str
    line: int
    date: str
    price: float  # rounded, 4 decimals
    qty: float  # rounded, 3 decimals
    vat_rate: float | None


@dataclass
class Evaluation:
    results: list[tuple[Entry, Computed]]
    points: list[PricePoint]
    reliability: str
    note: str
    unit_weight_kg: float | None


def evaluate(product: Product, params: Params, catalogue: Catalogue, problems: list[str] | None = None) -> Evaluation:
    results: list[tuple[Entry, Computed]] = []
    points: list[PricePoint] = []
    for entry in product.entries:
        computed = compute_document(entry.lines, params, entry.doc.doc_id in catalogue.discount_docs)
        results.append((entry, computed))
        if computed.price is not None and computed.qty is not None:
            points.append(PricePoint(
                entry.doc.sdi_id,
                min(ln.number for ln in entry.lines),
                entry.doc.date,
                round_half_up(computed.price, 4),
                round_half_up(computed.qty, 3),
                computed.vat_rate,
            ))
    points.sort(key=lambda p: (p.date, p.invoice_id, p.line))
    worst, note = "alta", ""
    for _, computed in results:  # entries run oldest first, so a tie keeps the latest note
        if worse(computed.reliability, worst) == computed.reliability:
            worst, note = computed.reliability, computed.note
    if problems:
        worst, note = "da verificare", "; ".join(problems)
    return Evaluation(results, points, worst, note, unit_weight_kg(params) if params.price_unit == "pcs" else None)


def vat_of(value: float | None) -> int | None:
    """The line's rate if it is one Mise knows, else None («not stated», never 0)."""
    if value is None:
        return None
    return int(value) if int(value) == value and int(value) in VAT_RATES else None


# ── reading the workbook's cells back into Params ────────────────────────────

PRICE_UNIT_WORDS = {"kg": "kg", "l": "l", "lt": "l", "litri": "l", "litro": "l",
                    "pz": "pcs", "pcs": "pcs", "pezzi": "pcs", "pezzo": "pcs"}


def params_from_cells(unit_cell, weight_cell, count_cell, proposal: Params) -> tuple[Params, list[str]]:
    """Cells -> Params, plus anything in them that could not be read."""
    problems: list[str] = []
    unit_text = _cell_text(unit_cell).lower()
    price_unit = None
    if unit_text:
        price_unit = PRICE_UNIT_WORDS.get(unit_text)
        if price_unit is None:
            problems.append(f"unità prezzo non riconosciuta: «{_cell_text(unit_cell)}»")
    pack = None
    weight_text = _cell_text(weight_cell)
    if weight_text:
        parsed = parse_pack_text(weight_text)
        if parsed:
            pack = PackInfo(parsed[0], parsed[1])
        else:
            problems.append(f"peso confezione non leggibile: «{weight_text}»")
    count = None
    count_text = _cell_text(count_cell)
    if count_text:
        try:
            value = float(count_text.replace(",", "."))
            if value != int(value) or value < 1:
                raise ValueError
            count = int(value) if value > 1 else None
        except ValueError:
            problems.append(f"pezzi per cartone non leggibili: «{count_text}»")
    return Params(price_unit, pack, count, proposal.egg, proposal.egg_weight_kg), problems


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value == int(value):
        value = int(value)
    return str(value).strip()
