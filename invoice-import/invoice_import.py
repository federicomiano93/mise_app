"""Supplier e-invoices (FatturaPA) -> decisions workbook -> import file for Mise.

    python invoice_import.py workbook [--base DIR]
    python invoice_import.py json [--base DIR]

See README.md. Everything runs on this computer; nothing is sent anywhere and nothing
is written to the database. Real invoices and what is made from them must stay OUTSIDE
the repository (it is public), so the script refuses to write inside one.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

from export import build_import, write_json
from fatturapa import load_invoices
from products import ConfigError, build_catalogue, ensure_novat_salt, load_config
from workbook import WorkbookError, WorkbookLocked, read_products_sheet, write_workbook

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
WORKBOOK_NAME = "fatture_ingredienti_mise.xlsx"
EXIT_REFUSED = 2
EXIT_PROBLEM = 1


class RefusedPath(Exception):
    pass


def default_base() -> Path:
    return REPO_ROOT.parent / "import-fatture"


def ensure_outside_repository(*paths: Path) -> None:
    """Refuse any output inside this repository, or inside any git working tree: a file
    saved there is one careless `git add` away from being published."""
    root = REPO_ROOT.resolve()
    for path in paths:
        resolved = path.resolve()
        if resolved == root or root in resolved.parents:
            raise RefusedPath(str(resolved))
        for parent in resolved.parents:
            if (parent / ".git").exists():
                raise RefusedPath(str(resolved))


def _print_load(load, out) -> None:
    out(f"Fatture lette: {len(load.documents)} (doppioni ignorati: {load.duplicates})")
    if load.p7m_count:
        out(f"File .p7m saltati: {load.p7m_count} (servono le fatture in XML)")
    for skipped in load.skipped:
        out(f"Saltato {skipped.name}: {skipped.reason}")


def _print_excluded(catalogue, out) -> None:
    reasons: dict[str, int] = {}
    for item in catalogue.excluded:
        if item.level == "documento":
            reasons[item.reason] = reasons.get(item.reason, 0) + 1
    for reason, count in sorted(reasons.items()):
        out(f"Fatture escluse ({reason}): {count}")
    lines = sum(1 for item in catalogue.excluded if item.level == "riga")
    if lines:
        out(f"Righe escluse (informative, spese, sconti): {lines} (vedi il foglio Esclusi)")


def _prepare_config(base: Path, out):
    """config.json, with its novatSalt: created (and said so, once) when it is missing."""
    path = base / "config.json"
    config = load_config(path)
    if ensure_novat_salt(path, config):
        out("Ho aggiunto «novatSalt» a config.json: rende anonime le chiavi dei fornitori senza P.IVA. "
            "Non cancellarla e non cambiarla, o le decisioni su quei fornitori andranno perse.")
    return config


def run_workbook(base: Path, now: datetime, out=print) -> int:
    fatture = base / "fatture"
    path = base / WORKBOOK_NAME
    ensure_outside_repository(path)
    if not fatture.is_dir():
        out(f"Non trovo la cartella delle fatture: {fatture}")
        return EXIT_PROBLEM
    config = _prepare_config(base, out)
    load = load_invoices(fatture, config.novat_salt)
    _print_load(load, out)
    if not load.documents:
        out("Nessuna fattura trovata: non scrivo nulla.")
        return EXIT_PROBLEM
    catalogue = build_catalogue(load, config)
    summary = write_workbook(path, catalogue, now)
    _print_excluded(catalogue, out)
    out(f"Documenti nel foglio: {summary['documents']}")
    out(f"Prodotti: {summary['products']}")
    for kind, count in sorted(summary["byType"].items()):
        out(f"  {kind}: {count}")
    out("Affidabilità:")
    for level in ("alta", "media", "da verificare"):
        out(f"  {level}: {summary['byReliability'].get(level, 0)}")
    out(f"Decisioni riportate dal foglio precedente: {summary['carriedOver']}")
    out(f"Foglio scritto: {path}")
    return 0


def run_json(base: Path, now: datetime, out=print) -> int:
    fatture = base / "fatture"
    path = base / WORKBOOK_NAME
    target = base / f"mise-import-{now.strftime('%Y-%m-%d')}.json"
    ensure_outside_repository(target)
    if not path.is_file():
        out(f"Non trovo il foglio {path.name}: prima esegui «python invoice_import.py workbook».")
        return EXIT_PROBLEM
    config = _prepare_config(base, out)
    sheet_rows = read_products_sheet(path)
    load = load_invoices(fatture, config.novat_salt)
    _print_load(load, out)
    catalogue = build_catalogue(load, config)
    document, left_out, stats = build_import(catalogue, sheet_rows, now)
    if not document["ingredients"]:
        out("Nessun prodotto da importare: segna «importa» nella colonna Azione e riprova. Non scrivo nulla.")
        for item in left_out:
            out(f"  Escluso: {item.supplier} - {item.name}: {item.reason}")
        return EXIT_PROBLEM
    write_json(target, document)
    out(f"Righe segnate: {stats['marked']}")
    out(f"Ingredienti nel file: {stats['ingredients']} ({stats['suppliers']} fornitori, {stats['prices']} prezzi)")
    if left_out:
        out(f"Righe lasciate fuori: {len(left_out)}")
        for item in left_out:
            out(f"  {item.supplier} - {item.name}: {item.reason}")
    out(f"File scritto: {target}")
    return 0


def main(argv: list[str] | None = None, now: datetime | None = None, out=print) -> int:
    parser = argparse.ArgumentParser(prog="invoice_import.py", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("workbook", "scrive il foglio delle decisioni"), ("json", "scrive il file da importare")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--base", type=Path, default=None, help="cartella di lavoro (default: ../import-fatture)")
    args = parser.parse_args(argv)
    base = (args.base or default_base()).resolve()
    now = now or datetime.now().astimezone()
    try:
        if args.command == "workbook":
            return run_workbook(base, now, out)
        return run_json(base, now, out)
    except RefusedPath as exc:
        out(f"RIFIUTATO: non scrivo dentro il repository ({exc}). Le fatture vere restano fuori da qui: "
            "usa la cartella import-fatture accanto al repository.")
        return EXIT_REFUSED
    except WorkbookLocked:
        out("Il foglio è aperto in Excel. Chiudi il file in Excel e riprova.")
        return EXIT_PROBLEM
    except (WorkbookError, ConfigError) as exc:
        out(str(exc))
        return EXIT_PROBLEM


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
