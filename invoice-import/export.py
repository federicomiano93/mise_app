"""The import file: what the marked workbook rows, recomputed, say to Mise.

The shape is a contract with js/orders/invoice-import-model.js (see README.md).
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from classify import format_pack_size
from pricing import PIECES, round_half_up, unit_class
from products import (
    EGG_PACK_WORD, TYPE_ORDER, Catalogue, evaluate, params_from_cells, propose_name, propose_params, vat_of,
)
from workbook import (
    H_ACTION, H_BRAND, H_CATEGORY, H_COUNT, H_KEY, H_NAME, H_PACK, H_PRICE_UNIT, H_SUPPLIER, H_TYPE, H_WEIGHT,
)

# The import is for INGREDIENTS only. Packaging and resale are told apart in the workbook (column «Tipo»)
# so the owner sees what the program took them for, but they are not imported for now.
IMPORTED_TYPE = "ingrediente"
NOT_IMPORTED_REASON = "packaging e rivendita non si importano per ora"

FORMAT = "mise-invoice-import"
VERSION = 1


@dataclass
class LeftOut:
    supplier: str
    name: str
    reason: str


def parse_action(value) -> tuple[str, str]:
    """('import'|'merge'|'skip'|'unknown', merge target)."""
    text = str(value if value is not None else "").strip()
    low = text.lower()
    if low in ("", "scarta"):
        return "skip", ""
    if low == "importa":
        return "import", ""
    m = re.match(r"^unisci\s+(?:con|a)\s+(\S.*)$", text, re.I | re.S)
    if m:
        return "merge", m.group(1).strip()
    return "unknown", ""


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def build_import(catalogue: Catalogue, sheet_rows: list[dict], now: datetime) -> tuple[dict, list[LeftOut], dict]:
    ingredients = []
    left_out: list[LeftOut] = []
    seen: set[str] = set()
    marked = 0

    for row in sheet_rows:
        action, merge_with = parse_action(row.get(H_ACTION))
        if action == "skip":
            continue
        key = row[H_KEY]
        shown_supplier = _text(row.get(H_SUPPLIER))
        shown_name = _text(row.get(H_NAME)) or key
        marked += 1
        if action == "unknown":
            left_out.append(LeftOut(shown_supplier, shown_name, f"azione non riconosciuta: «{_text(row.get(H_ACTION))}»"))
            continue
        product = catalogue.products.get(key)
        if product is None:
            left_out.append(LeftOut(shown_supplier, shown_name, "prodotto non trovato nelle fatture (chiave cambiata?)"))
            continue
        if key in seen:
            left_out.append(LeftOut(shown_supplier, shown_name, "riga ripetuta nel foglio"))
            continue
        seen.add(key)

        # The owner may have corrected the proposed type; a cleared cell means «as proposed».
        kind = _text(row.get(H_TYPE)).lower() or product.type
        if kind not in TYPE_ORDER:
            left_out.append(LeftOut(shown_supplier, shown_name, f"tipo non riconosciuto: «{_text(row.get(H_TYPE))}»"))
            continue
        if kind != IMPORTED_TYPE:
            left_out.append(LeftOut(shown_supplier, shown_name, NOT_IMPORTED_REASON))
            continue

        proposal = propose_params(product, catalogue.config)
        params, problems = params_from_cells(row.get(H_PRICE_UNIT), row.get(H_WEIGHT), row.get(H_COUNT), proposal)
        if problems:
            left_out.append(LeftOut(shown_supplier, shown_name, "; ".join(problems)))
            continue
        invoiced_by_pieces = unit_class(product.latest.lines[0].unit)[0] == PIECES
        if params.price_unit is None:
            reason = ("fatturato a pezzi: servono Unità prezzo e Peso confezione" if invoiced_by_pieces
                      else "manca l'unità prezzo")
            left_out.append(LeftOut(shown_supplier, shown_name, reason))
            continue
        if invoiced_by_pieces and params.price_unit in ("kg", "l") and params.pack is None:
            left_out.append(LeftOut(shown_supplier, shown_name,
                                    "fatturato a pezzi e manca il peso della confezione"))
            continue
        ev = evaluate(product, params, catalogue)
        if not ev.points:
            reason = ev.results[-1][1].note if ev.results else "nessun prezzo calcolabile"
            left_out.append(LeftOut(shown_supplier, shown_name, reason))
            continue

        ingredients.append({
            "key": product.key,
            "supplierKey": product.supplier_key,
            "mergeWith": merge_with,
            "name": _text(row.get(H_NAME)) or propose_name(product),
            "brand": _text(row.get(H_BRAND)),
            "category": _text(row.get(H_CATEGORY)),
            "supplierCode": product.code,
            "weight": format_pack_size(params.pack.size, params.pack.unit) if params.pack else "",
            # An emptied «Confezione» cell on an egg tray still needs the egg word (see
            # propose_pack_word), or the app names the 30 eggs «bags».
            "packUnit": _text(row.get(H_PACK)) or (EGG_PACK_WORD if params.egg and params.pack_count else ""),
            "packCount": params.pack_count,
            "priceUnit": params.price_unit,
            "unitWeightKg": (
                round_half_up(ev.unit_weight_kg, 6) if params.price_unit == "pcs" and ev.unit_weight_kg else None
            ),
            "vatRate": vat_of(product.latest.lines[0].vat_rate),
            "prices": [
                {"invoiceId": p.invoice_id, "line": p.line, "invoiceDate": p.date,
                 "pricePerUnit": p.price, "qty": p.qty}
                for p in ev.points
            ],
        })

    ingredients.sort(key=lambda i: i["key"])
    used = sorted({i["supplierKey"] for i in ingredients})
    suppliers = [
        {"key": k, "vatNumber": catalogue.suppliers[k].vat_number, "name": catalogue.suppliers[k].name}
        for k in used
    ]
    document = {
        "format": FORMAT,
        "version": VERSION,
        "generatedAt": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "suppliers": suppliers,
        "ingredients": ingredients,
    }
    stats = {
        "marked": marked,
        "ingredients": len(ingredients),
        "suppliers": len(suppliers),
        "prices": sum(len(i["prices"]) for i in ingredients),
        "leftOut": len(left_out),
    }
    return document, left_out, stats


def write_json(path: Path, document: dict) -> None:
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()
