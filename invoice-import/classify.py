"""Reading an invoice line's description: product key, proposed type, package size.

Everything here is a PROPOSAL. The owner overrides any of it in the workbook, so a
rule that is wrong costs one edited cell, not a wrong price in the database.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

# ── product key ───────────────────────────────────────────────────────────────


def normalise_name(description: str) -> str:
    """NFD, accents stripped, lower case, `{lot/expiry}` removed, leading `*` removed,
    punctuation -> space, spaces collapsed. The key must survive the supplier changing
    the lot text on every delivery."""
    s = re.sub(r"\{.*?\}", " ", description or "")
    s = s.strip().lstrip("*")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[\W_]+", " ", s).strip()


def product_key(supplier_key: str, article_code: str, description: str) -> str:
    code = (article_code or "").strip()
    if code:
        return f"{supplier_key}|code:{code}"
    return f"{supplier_key}|name:{normalise_name(description)}"


# ── line classification ───────────────────────────────────────────────────────

# Lines that carry information, not goods (offer, lot, delivery note, stamp duty note…).
NOISE_RE = re.compile(
    r"^\*?(offerta|lotto|ordine|ddt|rif\.|consegna|riga ausiliaria|cassa num|\*\*|\.|\*i suddetti"
    r"|contributo ambientale)|non disponibile|assolve gli obblighi",
    re.I,
)
COSTS_RE = re.compile(r"^\W*(spese|incasso|trasporto|imposta di bollo)\b", re.I)
DISCOUNT_RE = re.compile(r"^\W*(sconto|abbuono|ribasso)\b", re.I)

# Checked BEFORE packaging: "ZUCCHERO SACCHI DA KG 25" is sugar in sacks, not a sack.
FOOD_RE = re.compile(
    r"\b(zucchero|farina|semola|sale|lievito|burro|margarina|strutto|olio|uova|uovo|latte|panna"
    r"|cacao|cioccolato|miele|mandorl\w*|nocciol\w*|pistacch\w*|noci|uvetta|canditi|marmellata"
    r"|confettura|crema|ricotta|mascarpone|formaggio|mozzarella"
    # Ready-made food: «patate padellate» is not a pan, «cornetto fantasia» is not a Fanta.
    r"|patate|cornett[oi]|panzerott\w*|pasticciott\w*|treccia|trecce)\b",
    re.I,
)
# Only bar and shelf goods sold as they are are resale (5 Oct 2026, from the first real import).
# Ready-made FOOD (frozen croissants, panzerotti, sliced potatoes) is proposed as an ingredient,
# because food cost and the order lists need it (owner's decision, 1 Nov 2026); a keyword list of
# article prefixes let identical goods land on both sides. Looked at before FOOD_RE because the
# food word is often only the filling.
READY_RE = re.compile(
    r"\byog\.|yogurt|kefir|dolcificante|capsul|\bcaps\b|caff\S*\s*cialde",
    re.I,
)
PACKAGING_RE = re.compile(
    r"sh\. ml|b\.sch|grattugia|flacone|posate|asciugamano|vasch\.caldo|rotolo|buste|carta |carta$"
    r"|sacch|cont\. plastica|fogli pol|pellicola|stagnola|vaschette|box +pizza|velina|bicch|tappo"
    r"|bobina|laccetti|black nitro|carta forno|staccante"
    # Not food at all — tools, clothing, cleaning, shop bags (5 Oct 2026, from the first real
    # import). Never imported, like packaging. Food words are checked first, so «olio … ml10»
    # or «zucchero … bustina» never land here.
    # Mise 2 (14 Nov 2026) splits this part, down to the end of the pattern, from packaging: there it is
    # the line type «altro» (shared/src/invoice-zip/keywords.ts NONFOOD_RE), imported as an item of kind
    # 'other'. Here it stays packaging; keywords.spec.ts reads the two halves together against this list.
    r"|alluminio|grembiul|palett|coprivassoi|carte pizzo|shopper|\bborsa\b|\bbags\b|caraffa"
    r"|coppetta|anticalcare|detersiv|sgrassa|igienizz|candeggin|pennello|asciugaman|organza"
    r"|spolett|pentol|padell|\bpadel\b|guanti"
    # A potato peeler (the word «patate» no longer catches it as resale).
    r"|pelapatate"
    # Cleaning goods given free: the app now creates a product received only free with no price.
    r"|lavastovigl|micronizzator",
    re.I,
)
# Beverages are bought to be sold: resale, whatever the liquid.
BEVERAGE_RE = re.compile(
    r"coca cola|\bacqua\b|birra|redbull|succo|\bthe\b|fanta|sprite|lemonsoda|aranciata|chinotto"
    # Soft drinks proposed as ingredients on a real invoice (14 Nov 2026: «LIMONATA TOM LATTINA CL 33X24»,
    # «TONICA SCHWEPPES LEMON CL 18X24»), and their kin.
    r"|limonata|tonica|gassosa|spuma|cedrata|ginger"
    r"|prosecco|\bvino\b",
    re.I,
)


def is_unattributed_discount(description: str, quantity: float | None, total: float | None) -> bool:
    """A discount that names no product cannot be shared out among the products."""
    if total is None or total >= 0:
        return False
    if not quantity:
        return True
    return bool(DISCOUNT_RE.search(description or ""))


def classify(description: str, quantity: float | None, total: float | None) -> tuple[str, str]:
    """('excluded', reason) for a line that is not goods, else (type, '').

    type is `ingrediente`, `packaging` or `rivendita`.
    """
    d = (description or "").strip()
    low = d.lower()
    if not d or NOISE_RE.search(low):
        return "excluded", "riga informativa"
    if not quantity and not (total or 0):
        return "excluded", "riga informativa"
    if COSTS_RE.search(low):
        return "excluded", "spese/trasporto"
    if READY_RE.search(low):
        return "rivendita", ""
    if FOOD_RE.search(low):
        return "ingrediente", ""
    if PACKAGING_RE.search(low):
        return "packaging", ""
    if BEVERAGE_RE.search(low):
        return "rivendita", ""
    return "ingrediente", ""


# ── package size from the description ────────────────────────────────────────

_NUM = r"(\d+(?:[.,]\d+)?)"


@dataclass(frozen=True)
class PackInfo:
    """ONE package's size, and how many packages the invoiced unit holds (None = one)."""

    size: float
    unit: str  # 'g' | 'kg' | 'ml' | 'l'
    count: int | None = None


def _f(s: str) -> float:
    return float(s.replace(",", "."))


def _count_after(d: str) -> int | None:
    """«(X12PZ)» after a size: twelve packages in the unit."""
    m = re.search(r"\bX\s*(\d+)\s*(?:PZ|PEZZI|NR)\b", d)
    return int(m.group(1)) if m and int(m.group(1)) > 1 else None


def _counts_pieces_in_carton(before: str, size_kg: float, count: int) -> bool:
    """«35/40gr 2Kg* 55pz»: the piece weight is written too, and 55 pieces of 35–40 g ARE the
    2 kg, so the 55 counts pieces in one carton, not cartons (real invoice, 1 Nov 2026: read as
    110 kg, a believable-looking 0.13 €/kg)."""
    m = re.search(r"(?<![\d/.,])(\d+)(?:\s*/\s*(\d+))?\s*GR?\b", before)
    if not m:
        return False
    low = int(m.group(1))
    high = int(m.group(2)) if m.group(2) else low
    grams = (low + high) / 2 * count
    return abs(grams - size_kg * 1000) <= size_kg * 1000 * 0.15


# A bare K is a kilo only in the shape "2,5k* 4pz", as older invoices of one supplier write it: never in a code.
_BARE_K = r"K(?=\s*\*\s*\d+\s*PZ)"


def _with_fractions(description: str) -> str:
    """"1/2KG", "1/4 KG": a fraction of a unit. Without this the "2KG" inside "1/2KG" reads as
    a 2 kg pack — four times the real half kilo (real invoice, 3 Oct 2026)."""
    return re.sub(r"(?<![\d/])(\d)\s*/\s*(\d)(?=\s*(?:(?:KG|GR|G|LT|L|ML)\b|" + _BARE_K + "))",
                  lambda m: str(round(int(m.group(1)) / int(m.group(2)), 3)), (description or "").upper())


_P_KG_X = _NUM + r"\s*(KG|" + _BARE_K + r"|GR|G)\.?\s*[*X]\s*(\d+)(?!\d)"


def parse_pack(description: str) -> PackInfo | None:
    d = _with_fractions(description)

    # "2,5kg* 4pz", "85gr* 50pz", "2,5 KG X 4", "1kgx6", "7gx80"
    m = re.search(_P_KG_X, d)
    if m:
        size, count = _f(m.group(1)), int(m.group(3))
        kilos = m.group(2).startswith("K")
        if kilos and _counts_pieces_in_carton(d[: m.start()], size, count):
            return PackInfo(size, "kg", None)
        return PackInfo(size, "kg" if kilos else "g", count)
    # "PZ.50 GR.85": pieces first, then grams each
    m = re.search(r"\bPZ\.?\s*(\d+)\s*GR\.?\s*(\d+)", d)
    if m:
        return PackInfo(float(m.group(2)), "g", int(m.group(1)))
    # Unit FIRST, then size x count: "ML10X102" is 102 portions of 10 ml, "GR25X40" 40 of 25 g,
    # "KG1X10" ten of 1 kg. The unit must not be the tail of a longer word.
    m = re.search(r"(?<![A-Z])(ML|CL|LT|L|GR|G|KG)\s*\.?\s*" + _NUM + r"\s*[X×*]\s*(\d+)(?!\d)", d)
    if m:
        unit, size, count = m.group(1), _f(m.group(2)), int(m.group(3))
        if unit == "KG":
            return PackInfo(size, "kg", count)
        if unit in ("GR", "G"):
            return PackInfo(size, "g", count)
        if unit == "ML":
            return PackInfo(size, "ml", count)
        if unit == "CL":
            return PackInfo(size * 10, "ml", count)
        return PackInfo(size, "l", count)
    # "kg 2,5 x 4", "KG.2,5X4"
    m = re.search(r"\bKG\.?\s*" + _NUM + r"\s*X\s*(\d+)(?!\d)", d)
    if m:
        return PackInfo(_f(m.group(1)), "kg", int(m.group(2)))
    # "gr.70x6" (not when "PZ" is there: that is a count in front of something else)
    m = re.search(r"\bGR?\.?\s*(\d+)\s*X\s*(\d+)(?!\d)", d)
    if m and "PZ" not in d:
        return PackInfo(float(m.group(1)), "g", int(m.group(2)))
    # "2000x4g": two thousand sachets of 4 g, 8 kg. Read as one 4 g pack the sugar cost 4,032 €/kg and was
    # refused (real invoices, 5 Nov 2026). Grams only — in «22x50 Kg.0,500» the 22x50 is a roll in cm.
    m = re.search(r"(?<![\d.,/])(\d+)\s*[X×]\s*" + _NUM + r"\s*(?:GR?|G)\b", d)
    if m and int(m.group(1)) > 1:
        return PackInfo(_f(m.group(2)), "g", int(m.group(1)))
    # "KG 25", "2,5KG"
    m = re.search(r"\bKG\.?\s*" + _NUM + r"|" + _NUM + r"\s*KG\b", d)
    if m:
        return PackInfo(_f(m.group(1) or m.group(2)), "kg", _count_after(d))
    # "GR.250", "G.1000", "GR 250", "G 570" (three or four digits: «G 5» is not a weight)
    m = re.search(r"\b(?:GR?|G)\.\s*(\d+)\b|\bGR\s+(\d+)\b|\bG\s+(\d{3,4})\b", d)
    if m:
        return PackInfo(float(m.group(1) or m.group(2) or m.group(3)), "g", _count_after(d))
    # "500 g", "100G"
    m = re.search(_NUM + r"\s*(?:GR?|G)\b", d)
    if m:
        return PackInfo(_f(m.group(1)), "g", _count_after(d))
    # "LT 1", "1L", "5 LT"
    m = re.search(r"\bLT\.?\s*" + _NUM + r"|" + _NUM + r"\s*(?:LT|L)\b", d)
    if m:
        return PackInfo(_f(m.group(1) or m.group(2)), "l")
    # "ML 500", "500 ml"
    m = re.search(r"\bML\.?\s*(\d+)|(\d+)\s*ML\b", d)
    if m:
        return PackInfo(float(m.group(1) or m.group(2)), "ml")
    m = re.search(r"(\d+)\s*CL\b", d)
    if m:
        return PackInfo(float(m.group(1)) * 10, "ml")
    return None


# ⚠️ A PRODUCT COUNTED IN PIECES IS PRICED PER PIECE (his rule, 5 Nov 2026): a cornetto, a panzerotto, an arancino,
# a graffa carries its price per piece with the piece weight beside it (0.464 €/pz, 85 g), never «5.46 €/kg of
# 50 bags». Goods sold by weight stay per kilo. The description tells them apart: the count is written AS PIECES
# («85gr* 50pz», «PZ.50 GR.85», «GR.85X50P») and one piece weighs at most MAX_PIECE_G grams. A count without «pz»
# («G 100X3», «gr.60X6», «2000x4g») is packs of goods used by weight; a size in kilos («2,5kg* 4pz», «KG.2.5X4») is
# a bag, not a piece; «G 570 (X12PZ)» is a box. The carton whose pieces add up to its weight («35/40gr 2Kg* 55pz»)
# is pieces too, each the carton's weight shared out (36.4 g), so its price per kilo does not move.
MAX_PIECE_G = 500


@dataclass(frozen=True)
class Pieces:
    count: int
    size: float  # grams of one piece


def pieces_of(description: str) -> Pieces | None:
    d = _with_fractions(description)
    marked = {int(m.group(1) or m.group(2))
              for m in re.finditer(r"(?<![\d.,])(\d+)\s*(?:PZ|PEZZI|P)\b|\bPZ\.?\s*(\d+)", d)}
    marked = {n for n in marked if n > 1}
    if not marked:
        return None
    info = parse_pack(description)
    if not info:
        return None
    if info.unit == "g" and info.count in marked and 0 < info.size <= MAX_PIECE_G:
        return Pieces(info.count, info.size)
    if info.unit != "kg" or info.count is not None:
        return None
    m = re.search(_P_KG_X, d)
    if not m or not m.group(2).startswith("K"):
        return None
    count = int(m.group(3))
    size = float(Decimal(repr(_f(m.group(1)) * 1000 / count)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
    carton = _counts_pieces_in_carton(d[: m.start()], _f(m.group(1)), count)
    return Pieces(count, size) if carton and count in marked and 0 < size <= MAX_PIECE_G else None


def format_number(x: float) -> str:
    return f"{x:.6f}".rstrip("0").rstrip(".")


def format_pack_size(size: float, unit: str) -> str:
    """The `weight` string the ingredient card stores: dot decimal, g/kg/ml/l."""
    return f"{format_number(size)} {unit}"


_WEIGHT_TEXT_RE = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(kg|kgm|g|gr|grammi|l|lt|litri|litro|ml|cl)\.?\s*$", re.I)


def parse_pack_text(text: str) -> tuple[float, str] | None:
    """«2,5 kg», «250g», «1 l», «500 ml» typed by hand -> (2.5, 'kg'), None if unreadable."""
    m = _WEIGHT_TEXT_RE.match(str(text or ""))
    if not m:
        return None
    value = _f(m.group(1))
    unit = m.group(2).lower()
    if unit in ("kg", "kgm"):
        unit = "kg"
    elif unit in ("g", "gr", "grammi"):
        unit = "g"
    elif unit in ("l", "lt", "litri", "litro"):
        unit = "l"
    elif unit == "cl":
        value, unit = value * 10, "ml"
    if value <= 0:
        return None
    return value, unit


# ── eggs ─────────────────────────────────────────────────────────────────────


def is_egg(description: str) -> bool:
    return bool(re.search(r"\bUOV[AO]\b", (description or "").upper()))


def eggs_per_pack(description: str) -> int | None:
    """«DA 30 UOVA», «30 UOVA», «X30», «30 PZ» -> 30; «6 X 10 UOVA» (six trays of ten) -> 60;
    None when the invoice does not say."""
    d = (description or "").upper()
    m = re.search(r"\b(\d+)\s*[X*]\s*(\d+)\s*UOV[AO]\b", d)
    if m and int(m.group(1)) >= 1 and int(m.group(2)) >= 1:
        return int(m.group(1)) * int(m.group(2))
    for pattern in (
        r"\bDA\s+(\d+)\s+UOV[AO]\b",
        r"\b(\d+)\s*UOV[AO]\b",
        r"\bX\s*(\d+)(?!\d)",
        r"\b(\d+)\s*(?:PZ|PEZZI)\b",
    ):
        m = re.search(pattern, d)
        if m and int(m.group(1)) >= 1:
            return int(m.group(1))
    return None


# ── proposed card fields ─────────────────────────────────────────────────────

PACK_WORDS = (
    (r"\bSACC(?:O|HI)\b", "sacco"),
    (r"\bBUST[AE]\b", "busta"),
    (r"\bCARTON[EI]\b", "cartone"),
    (r"\bLATTA\b", "latta"),
    (r"\bSECCHI[O]?\b", "secchio"),
    (r"\bBOTTIGLI[AE]\b", "bottiglia"),
    (r"\bVASETT[OI]\b", "vasetto"),
    (r"\bBARATTOL[OI]\b", "barattolo"),
    (r"\bSCATOL[AE]\b", "scatola"),
    (r"\bVASCHETT[AE]\b", "vaschetta"),
)


def pack_word(description: str) -> str:
    d = (description or "").upper()
    for pattern, word in PACK_WORDS:
        if re.search(pattern, d):
            return word
    return ""


_N = r"\d+(?:[.,]\d+)?"
_CLEAN_RES = [re.compile(p, re.I) for p in (
    r"\bPZ\.?\s*\d+\s*GR?\.?\s*\d+",
    # "35/40gr", "4X2,5k*": what stands in front of the size goes with it.
    rf"\b(?:DA\s+)?(?:\d+\s*[/X]\s*)?{_N}\s*(?:(?:KG|GR|G|LT|L|ML|CL)\b|K(?=\s*\*))\.?(?:\s*[*X]\s*\d+(?!\d)(?:\s*(?:PZ|NR|PEZZI)\b)?)?",
    rf"\b(?:DA\s+)?(?:KG|GR?|LT|ML|CL)\.?\s*{_N}(?:\s*X\s*{_N})?(?!\d)",
    r"\b(?:DA\s+)?\d+\s*(?:PZ|NR|PEZZI)\b",
    r"\bPZ\.?\s*\d+\b",
    r"\bDA\s+\d+\s+(?=UOV)",
)]
_PACK_NOISE_RE = re.compile(
    r"\b(?:SACCO|SACCHI|BUSTA|BUSTE|CARTONE|CARTONI|LATTA|SECCHIO|SECCHI|BOTTIGLIA|BOTTIGLIE"
    r"|VASETTO|VASETTI|BARATTOLO|SCATOLA|VASCHETTA|CONFEZIONE|CONF|CF|CT)\b\.?",
    re.I,
)
_DANGLING_RE = re.compile(r"(?:^|\s)(?:DA|IN|DI|CON|X)\s*$", re.I)


def clean_name(description: str, article_code: str = "") -> str:
    """The proposed «Nome in Mise»: sizes, pack words, codes and lot text taken away,
    only the first letter in capitals."""
    original = re.sub(r"\s+", " ", re.sub(r"\{.*?\}", " ", description or "")).strip().lstrip("*").strip()
    s = original
    for rx in _CLEAN_RES:
        s = rx.sub(" ", s)
    # «SACCHI DA KG 25»: the pack word is a detail of the delivery. Without a size next to
    # it the word is the product itself («BUSTE PLASTICA») and must stay.
    if s != original:
        s = _PACK_NOISE_RE.sub(" ", s)
    code = (article_code or "").strip()
    if code:
        s = re.sub(r"(?<!\w)" + re.escape(code) + r"(?!\w)", " ", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" \t-.,;:*/")
    while True:
        trimmed = _DANGLING_RE.sub("", s).strip(" \t-.,;:*/")
        if trimmed == s:
            break
        s = trimmed
    s = s or original
    s = s.lower()
    return s[:1].upper() + s[1:]
