"""From invoice lines to one net price per base unit (kg, l or piece).

The price is what the goods REALLY cost: the total of every line of the product on the
invoice divided by everything delivered. A free-goods line (same article, total 0)
therefore lowers the price, which is the point.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from classify import PackInfo
from fatturapa import Line

# Invoiced unit -> (dimension, factor to the base unit). Anything not listed is a
# count of pieces or packages and needs a package weight from somewhere else.
WEIGHT_UNITS = {
    "KG": ("kg", 1.0), "KGM": ("kg", 1.0), "KGS": ("kg", 1.0),
    "KILOGRAMMI": ("kg", 1.0), "KILOGRAMMO": ("kg", 1.0),
    "GR": ("kg", 0.001), "G": ("kg", 0.001), "GRAMMI": ("kg", 0.001),
    "QL": ("kg", 100.0), "QLI": ("kg", 100.0), "QUINTALI": ("kg", 100.0), "QUINTALE": ("kg", 100.0),
    "LT": ("l", 1.0), "L": ("l", 1.0), "LITRI": ("l", 1.0), "LITRO": ("l", 1.0),
    "ML": ("l", 0.001), "CL": ("l", 0.01),
}
PIECES = "pc"

# Pack size units -> (dimension, factor)
PACK_UNITS = {"kg": ("kg", 1.0), "g": ("kg", 0.001), "l": ("l", 1.0), "ml": ("l", 0.001)}

# A price outside these bounds is almost certainly a misread weight or pack, never a real price.
KG_L_PRICE_RANGE = (0.05, 300.0)
PIECE_PRICE_RANGE = (0.01, 50.0)
# What one egg can plausibly cost, used to tell «the quantity counts eggs» from «counts packs».
EGG_PRICE_RANGE = (0.05, 0.90)
OUT_OF_SCALE_NOTE = "prezzo fuori scala: controlla peso e confezione"
EGG_UNCLEAR_NOTE = "uova: non è chiaro se la quantità conta uova o confezioni"

RELIABILITY_ORDER = {"alta": 0, "media": 1, "da verificare": 2}
DISCOUNT_NOTE = "sconto su riga separata non attribuibile"


def unit_class(raw_unit: str) -> tuple[str, float]:
    u = re.sub(r"[\s.]+", "", (raw_unit or "").upper())
    return WEIGHT_UNITS.get(u, (PIECES, 1.0))


def round_half_up(x: float, places: int) -> float:
    q = Decimal(1).scaleb(-places)
    return float(Decimal(repr(x)).quantize(q, rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class Params:
    """What the workbook row says about the package. The owner may have corrected it."""

    price_unit: str | None = None  # 'kg' | 'l' | 'pcs'
    pack: PackInfo | None = None  # ONE package; `count` is not used here
    pack_count: int | None = None
    egg: bool = False
    egg_weight_kg: float = 0.05

    def pack_base(self) -> tuple[float, str] | None:
        if not self.pack:
            return None
        dim, factor = PACK_UNITS[self.pack.unit]
        return self.pack.size * factor, dim


@dataclass
class Computed:
    price: float | None  # net per base unit, unrounded
    qty: float | None  # in the base unit
    reliability: str
    note: str
    unit_weight_kg: float | None = None
    vat_rate: float | None = None


def unit_weight_kg(params: Params) -> float | None:
    """Weight of ONE piece, required whenever a price is per piece."""
    if params.egg:
        return params.egg_weight_kg
    base = params.pack_base()
    if base and base[1] == "kg":
        return base[0]
    return None


def compute_document(lines: list[Line], params: Params, discount_flag: bool = False) -> Computed:
    """One product on one invoice -> its price, quantity and how far to trust them."""
    ordered = sorted(lines, key=lambda ln: ln.number)
    first = ordered[0]
    cls, _ = unit_class(first.unit)
    same = [ln for ln in ordered if unit_class(ln.unit)[0] == cls]
    mixed = len(same) != len(ordered)
    vat = first.vat_rate

    total = sum((ln.total or 0.0) for ln in same)
    pieces = sum((ln.quantity or 0.0) for ln in same)

    def fail(note: str) -> Computed:
        # Already "da verificare": the reason it has no price is the useful note.
        return Computed(None, None, "da verificare", note, vat_rate=vat)

    if params.price_unit is None:
        return fail("nessun peso in fattura" if cls == PIECES else "manca l'unità prezzo")

    if cls != PIECES:
        base_qty = sum((ln.quantity or 0.0) * unit_class(ln.unit)[1] for ln in same)
        if base_qty <= 0:
            return fail("quantità zero o negativa")
        if total <= 0:
            return fail("importo zero o negativo")
        if params.price_unit != cls:
            return fail("unità prezzo diversa dall'unità in fattura")
        price = total / base_qty
        reliability = "alta"
        note = "fatturato a peso" if cls == "kg" else "fatturato a volume"
        return _finish(Computed(price, base_qty, reliability, note, vat_rate=vat), mixed, discount_flag,
                       params.price_unit)

    # Invoiced by pieces or packages: the weight has to come from elsewhere.
    if pieces <= 0:
        return fail("quantità zero o negativa")
    if total <= 0:
        return fail("importo zero o negativo")
    count = params.pack_count or 1

    if params.price_unit == "pcs":
        weight = unit_weight_kg(params)
        if weight is None:
            return fail("manca il peso del singolo pezzo")
        if params.egg:
            note = "uova: peso di un uovo dalla configurazione"
            if params.pack_count is None:
                note += "; numero di uova per confezione non indicato, contato 1"
                qty, reliability = pieces, "media"
            else:
                # The «X 30» may be applied twice: some invoices count eggs in the quantity, others
                # count packs. Take the reading whose price per egg is a believable egg price.
                price_if_eggs = total / pieces
                price_if_packs = total / (pieces * count)
                eggs_ok = _in_range(price_if_eggs, EGG_PRICE_RANGE)
                packs_ok = _in_range(price_if_packs, EGG_PRICE_RANGE)
                reliability = "media"
                if eggs_ok and not packs_ok:
                    qty = pieces
                    note += "; la quantità conta uova"
                else:
                    qty = pieces * count
                    if eggs_ok == packs_ok:
                        reliability, note = "da verificare", EGG_UNCLEAR_NOTE
            result = Computed(total / qty, qty, reliability, note, unit_weight_kg=weight, vat_rate=vat)
        else:
            qty = pieces * count
            result = Computed(total / qty, qty, "media", "peso del pezzo letto dalla descrizione o dal foglio",
                              unit_weight_kg=weight, vat_rate=vat)
        return _finish(result, mixed, discount_flag, params.price_unit)

    base = params.pack_base()
    if base is None:
        return fail("nessun peso in fattura")
    size, dim = base
    if dim != params.price_unit:
        return fail("unità prezzo e peso confezione non coerenti")
    qty = pieces * size * count
    return _finish(
        Computed(total / qty, qty, "media", "peso letto dalla descrizione o indicato nel foglio", vat_rate=vat),
        mixed,
        discount_flag,
        params.price_unit,
    )


def _in_range(value: float, bounds: tuple[float, float]) -> bool:
    return bounds[0] <= value <= bounds[1]


def _finish(result: Computed, mixed: bool, discount_flag: bool, price_unit: str | None = None) -> Computed:
    if mixed:
        result.reliability = "da verificare"
        result.note = "unità di misura diverse sulla stessa fattura"
    if discount_flag:
        result.reliability = "da verificare"
        result.note = DISCOUNT_NOTE
    # ⚠️ NO ABSURD PRICE MAY LOOK RELIABLE: a price per kg/l or per piece outside any believable
    # range is a misread weight or pack count, so it can never stay «alta» or «media».
    if result.price is not None and price_unit is not None:
        bounds = PIECE_PRICE_RANGE if price_unit == "pcs" else KG_L_PRICE_RANGE
        if not _in_range(result.price, bounds):
            result.reliability = "da verificare"
            result.note = OUT_OF_SCALE_NOTE
    return result


def worse(a: str, b: str) -> str:
    return a if RELIABILITY_ORDER[a] >= RELIABILITY_ORDER[b] else b
