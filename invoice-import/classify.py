"""Reading an invoice line's description: product key, proposed type, package size.

Everything here is a PROPOSAL. The owner overrides any of it in the workbook, so a
rule that is wrong costs one edited cell, not a wrong price in the database.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

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
    r"|confettura|crema|ricotta|mascarpone|formaggio|mozzarella)\b",
    re.I,
)
# Ready-made goods bought to be sold as they are. Looked at before FOOD_RE because the
# food word is often only the filling («cornetto alla crema»).
READY_RE = re.compile(
    r"(?<!fecola di )patate|cornetto|panzerott|pasticciotto|treccia|sg\.cr|cr\.integrale|mini cr"
    r"|tm cr|tm-midi|cipolle fette",
    re.I,
)
PACKAGING_RE = re.compile(
    r"sh\. ml|b\.sch|grattugia|flacone|posate|asciugamano|vasch\.caldo|rotolo|buste|carta |carta$"
    r"|sacch|cont\. plastica|fogli pol|pellicola|stagnola|vaschette|box +pizza|velina|bicch|tappo"
    r"|bobina|laccetti|black nitro|carta forno|staccante",
    re.I,
)
# Beverages are bought to be sold: resale, whatever the liquid.
BEVERAGE_RE = re.compile(
    r"coca cola|\bacqua\b|birra|redbull|succo|\bthe\b|fanta|sprite|lemonsoda|aranciata|chinotto"
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


def parse_pack(description: str) -> PackInfo | None:
    d = (description or "").upper()

    # "2,5kg* 4pz", "85gr* 50pz", "2,5 KG X 4", "1kgx6", "7gx80"
    m = re.search(_NUM + r"\s*(KG|GR|G)\.?\s*[*X]\s*(\d+)(?!\d)", d)
    if m:
        return PackInfo(_f(m.group(1)), "kg" if m.group(2) == "KG" else "g", int(m.group(3)))
    # "PZ.50 GR.85": pieces first, then grams each
    m = re.search(r"\bPZ\.?\s*(\d+)\s*GR\.?\s*(\d+)", d)
    if m:
        return PackInfo(float(m.group(2)), "g", int(m.group(1)))
    # "kg 2,5 x 4", "KG.2,5X4"
    m = re.search(r"\bKG\.?\s*" + _NUM + r"\s*X\s*(\d+)(?!\d)", d)
    if m:
        return PackInfo(_f(m.group(1)), "kg", int(m.group(2)))
    # "gr.70x6" (not when "PZ" is there: that is a count in front of something else)
    m = re.search(r"\bGR?\.?\s*(\d+)\s*X\s*(\d+)(?!\d)", d)
    if m and "PZ" not in d:
        return PackInfo(float(m.group(1)), "g", int(m.group(2)))
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
    rf"\b(?:DA\s+)?{_N}\s*(?:KG|GR|G|LT|L|ML|CL)\b\.?(?:\s*[*X]\s*\d+(?!\d)(?:\s*(?:PZ|NR|PEZZI)\b)?)?",
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
