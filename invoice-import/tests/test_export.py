import json
import unittest
from datetime import datetime, timezone

import export
import invoice_import
import workbook
from tests.test_workbook import BAGS, FLOUR, NOW, SUGAR, WorkbookCase

EGGS = {"desc": "UOVA FRESCHE DA 30 UOVA", "qty": 2, "unit": "CT", "total": 36}
SPICE = {"desc": "SPEZIA MISTA", "qty": 4, "unit": "PZ", "total": 20}
KEY_FLOUR = "IT00000000001|code:F00-25"


class JsonCase(WorkbookCase):
    def make_json(self, now=NOW):
        code, output = self.run_main("json", now=now)
        path = self.base / f"mise-import-{now.strftime('%Y-%m-%d')}.json"
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        return code, output, data

    def ingredient(self, data, key_part):
        hits = [i for i in data["ingredients"] if key_part in i["key"]]
        self.assertEqual(len(hits), 1, key_part)
        return hits[0]


class ShapeTest(JsonCase):
    def test_only_marked_rows_are_written_in_the_agreed_shape(self):
        self.add([FLOUR, SUGAR, BAGS], name="FORNITORE ESEMPIO SRL")
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa", workbook.H_BRAND: "Marca Esempio"})
        self.edit("name:buste", **{workbook.H_ACTION: "scarta"})
        code, output, data = self.make_json()
        self.assertEqual(code, 0, output)
        self.assertEqual(data["format"], "mise-invoice-import")
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["generatedAt"], "2026-10-03T10:15:00Z")
        self.assertEqual(data["suppliers"], [
            {"key": "IT00000000001", "vatNumber": "IT00000000001", "name": "FORNITORE ESEMPIO SRL"}])
        self.assertEqual([i["key"] for i in data["ingredients"]], [KEY_FLOUR])
        flour = data["ingredients"][0]
        self.assertEqual(flour, {
            "key": KEY_FLOUR, "supplierKey": "IT00000000001", "mergeWith": "", "name": "Farina tipo 00",
            "brand": "Marca Esempio", "category": "", "supplierCode": "F00-25", "weight": "25 kg",
            "packUnit": "sacco", "packCount": None, "priceUnit": "kg", "unitWeightKg": None, "vatRate": 4,
            "prices": [{"invoiceId": "9000000001", "line": 1, "invoiceDate": "2026-09-01",
                        "pricePerUnit": 0.57, "qty": 25.0}],
        })

    def test_suppliers_are_only_the_referenced_ones(self):
        self.add([FLOUR], vat="00000000001", name="FORNITORE ESEMPIO SRL")
        self.add([SUGAR], vat="00000000002", name="ALTRO FORNITORE ESEMPIO SPA")
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa"})
        _, _, data = self.make_json()
        self.assertEqual([s["key"] for s in data["suppliers"]], ["IT00000000001"])

    def test_actions_are_trimmed_and_case_insensitive_and_merge_targets_are_kept(self):
        self.add([FLOUR, SUGAR, EGGS])
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "  IMPORTA "})
        self.edit("name:zucchero", **{workbook.H_ACTION: "Unisci con Zucchero semolato"})
        self.edit("name:uova", **{workbook.H_ACTION: "unisci a Uova fresche"})
        _, _, data = self.make_json()
        self.assertEqual(self.ingredient(data, "F00-25")["mergeWith"], "")
        self.assertEqual(self.ingredient(data, "zucchero")["mergeWith"], "Zucchero semolato")
        self.assertEqual(self.ingredient(data, "uova")["mergeWith"], "Uova fresche")

    def test_an_unrecognised_action_is_listed_never_silent(self):
        self.add([FLOUR, SUGAR])
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa"})
        self.edit("name:zucchero", **{workbook.H_ACTION: "forse"})
        _, output, data = self.make_json()
        self.assertEqual(len(data["ingredients"]), 1)
        self.assertIn("azione non riconosciuta", output)
        self.assertIn("forse", output)

    def test_nothing_marked_writes_nothing(self):
        self.add([FLOUR])
        self.run_main("workbook")
        code, output, data = self.make_json()
        self.assertEqual(code, 1)
        self.assertIsNone(data)
        self.assertIn("Non scrivo nulla", output)

    def test_parse_action(self):
        self.assertEqual(export.parse_action(None), ("skip", ""))
        self.assertEqual(export.parse_action("Scarta"), ("skip", ""))
        self.assertEqual(export.parse_action("importa"), ("import", ""))
        self.assertEqual(export.parse_action("unisci con  Farina 00 "), ("merge", "Farina 00"))
        self.assertEqual(export.parse_action("unisci a Farina"), ("merge", "Farina"))
        self.assertEqual(export.parse_action("unisci con"), ("unknown", ""))


class UnitsInTheFileTest(JsonCase):
    def test_eggs_are_pieces_with_the_configured_egg_weight(self):
        (self.base / "config.json").write_text('{"eggWeightG": 50}', encoding="utf-8")
        self.add([EGGS])
        self.run_main("workbook")
        self.edit("name:uova", **{workbook.H_ACTION: "importa"})
        _, _, data = self.make_json()
        eggs = self.ingredient(data, "uova")
        self.assertEqual((eggs["priceUnit"], eggs["unitWeightKg"], eggs["packCount"]), ("pcs", 0.05, 30))
        self.assertEqual(eggs["prices"][0]["pricePerUnit"], 0.6)
        self.assertEqual(eggs["prices"][0]["qty"], 60.0)
        self.assertEqual(eggs["weight"], "")
        # A tray of 30 is a carton of 30 eggs, never the app's default «busta».
        self.assertEqual(eggs["packUnit"], "uovo")

    def test_pz_typed_in_the_workbook_means_pcs(self):
        self.add([EGGS])
        self.run_main("workbook")
        self.edit("name:uova", **{workbook.H_ACTION: "importa", workbook.H_PRICE_UNIT: "pz"})
        _, _, data = self.make_json()
        self.assertEqual(self.ingredient(data, "uova")["priceUnit"], "pcs")

    def test_a_corrected_pack_count_recomputes_every_price(self):
        self.add([EGGS], date="2026-09-01")
        self.add([EGGS], date="2026-09-08")
        self.run_main("workbook")
        self.edit("name:uova", **{workbook.H_ACTION: "importa", workbook.H_COUNT: 15})
        _, _, data = self.make_json()
        prices = self.ingredient(data, "uova")["prices"]
        self.assertEqual([p["pricePerUnit"] for p in prices], [1.2, 1.2])
        self.assertEqual(self.ingredient(data, "uova")["packCount"], 15)

    def test_pack_of_packs_in_the_card_model(self):
        self.add([{"desc": "PASSATA kg 2,5 x 4", "qty": 3, "unit": "CT", "total": 60}])
        self.run_main("workbook")
        self.edit("name:passata", **{workbook.H_ACTION: "importa"})
        _, _, data = self.make_json()
        item = self.ingredient(data, "passata")
        self.assertEqual((item["weight"], item["packCount"], item["priceUnit"]), ("2.5 kg", 4, "kg"))
        self.assertEqual(item["prices"][0]["pricePerUnit"], 2.0)
        self.assertEqual(item["prices"][0]["qty"], 30.0)

    def test_litres_stay_litres(self):
        self.add([{"desc": "OLIO LT 1", "qty": 6, "unit": "NR", "total": 30}])
        self.run_main("workbook")
        self.edit("name:olio", **{workbook.H_ACTION: "importa"})
        _, _, data = self.make_json()
        item = self.ingredient(data, "olio")
        self.assertEqual((item["priceUnit"], item["weight"], item["unitWeightKg"]), ("l", "1 l", None))


class LeftOutTest(JsonCase):
    def test_a_pieces_line_with_no_weight_is_left_out_until_the_workbook_gives_one(self):
        self.add([FLOUR, SPICE])
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa"})
        self.edit("name:spezia", **{workbook.H_ACTION: "importa"})
        code, output, data = self.make_json()
        self.assertEqual([i["key"] for i in data["ingredients"]], [KEY_FLOUR])
        self.assertIn("Righe lasciate fuori: 1", output)
        self.assertIn("servono Unità prezzo e Peso confezione", output)

        self.edit("name:spezia", **{workbook.H_PRICE_UNIT: "kg"})
        _, output, data = self.make_json()
        self.assertEqual(len(data["ingredients"]), 1)
        self.assertIn("manca il peso della confezione", output)

        self.edit("name:spezia", **{workbook.H_WEIGHT: "250g"})
        _, output, data = self.make_json()
        self.assertEqual(len(data["ingredients"]), 2)
        spice = self.ingredient(data, "spezia")
        self.assertEqual((spice["weight"], spice["prices"][0]["pricePerUnit"], spice["prices"][0]["qty"]),
                         ("250 g", 20.0, 1.0))
        self.assertNotIn("Righe lasciate fuori", output)

    def test_an_unreadable_weight_is_listed(self):
        self.add([SPICE])
        self.run_main("workbook")
        self.edit("name:spezia", **{workbook.H_ACTION: "importa", workbook.H_PRICE_UNIT: "kg",
                                    workbook.H_WEIGHT: "un bel sacco"})
        code, output, data = self.make_json()
        self.assertEqual(code, 1)
        self.assertIn("peso confezione non leggibile", output)

    def test_a_row_whose_invoices_are_gone_is_listed(self):
        self.add([FLOUR])
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa"})
        for f in self.fatture.iterdir():
            f.unlink()
        self.add([SUGAR])
        code, output, data = self.make_json()
        self.assertEqual(code, 1)
        self.assertIn("prodotto non trovato", output)


class DeterminismTest(JsonCase):
    def test_same_inputs_give_the_same_file_apart_from_generated_at(self):
        self.add([FLOUR, SUGAR, EGGS], vat="00000000002", name="ALTRO FORNITORE ESEMPIO SPA", date="2026-09-03")
        self.add([{**FLOUR, "total": 15}, SUGAR], date="2026-09-10")
        self.add([FLOUR], vat="00000000001", date="2026-09-03", number="7")
        self.run_main("workbook")
        for part in ("code:F00-25", "name:zucchero", "name:uova"):
            for key in [k for k in self.rows() if part in k]:
                self.edit(key, **{workbook.H_ACTION: "importa"})
        _, _, first = self.make_json(NOW)
        later = datetime(2026, 10, 3, 18, 0, tzinfo=timezone.utc)
        _, _, second = self.make_json(later)
        self.assertNotEqual(first["generatedAt"], second["generatedAt"])
        first.pop("generatedAt")
        second.pop("generatedAt")
        self.assertEqual(first, second)
        self.assertEqual([i["key"] for i in first["ingredients"]], sorted(i["key"] for i in first["ingredients"]))
        self.assertEqual([s["key"] for s in first["suppliers"]], sorted(s["key"] for s in first["suppliers"]))
        for item in first["ingredients"]:
            order = [(p["invoiceDate"], p["invoiceId"], p["line"]) for p in item["prices"]]
            self.assertEqual(order, sorted(order))


class RefusalTest(JsonCase):
    def test_it_refuses_to_write_inside_the_repository(self):
        inside = invoice_import.REPO_ROOT / "never-created-by-a-test"
        for command in ("workbook", "json"):
            messages = []
            code = invoice_import.main([command, "--base", str(inside)], now=NOW, out=messages.append)
            self.assertEqual(code, 2, command)
            self.assertIn("RIFIUTATO", "\n".join(messages))
        self.assertFalse(inside.exists())

    def test_it_refuses_any_git_working_tree_not_just_this_one(self):
        other = self.tmp / "another-project"
        (other / ".git").mkdir(parents=True)
        with self.assertRaises(invoice_import.RefusedPath):
            invoice_import.ensure_outside_repository(other / "import-fatture" / "x.xlsx")

    def test_a_folder_outside_is_accepted(self):
        invoice_import.ensure_outside_repository(self.base / "x.xlsx")


class ConfigTest(JsonCase):
    def test_default_config_when_the_file_is_missing(self):
        import products
        cfg = products.load_config(self.base / "config.json")
        self.assertEqual((cfg.excluded_suppliers, cfg.egg_weight_g), ({}, 50.0))

    def test_example_config_is_valid_and_normalised(self):
        import products
        cfg = products.load_config(invoice_import.HERE / "config.example.json")
        self.assertEqual(cfg.excluded_suppliers, {"IT00000000099": "utenze"})
        self.assertEqual(cfg.egg_weight_g, 50.0)

    def test_bad_config_is_a_friendly_stop(self):
        (self.base / "config.json").write_text("{ not json", encoding="utf-8")
        self.add([FLOUR])
        code, output = self.run_main("workbook")
        self.assertEqual(code, 1)
        self.assertIn("config.json", output)

    def test_excluded_suppliers_do_not_reach_the_workbook(self):
        (self.base / "config.json").write_text(
            json.dumps({"excludedSuppliers": {"it 00000000099": "utenze"}}), encoding="utf-8")
        self.add([FLOUR], vat="00000000099", name="UTENZE ESEMPIO SPA")
        self.add([SUGAR])
        self.run_main("workbook")
        self.assertEqual([k for k in self.rows()], ["IT00000000001|name:zucchero sacchi da kg 25"])


if __name__ == "__main__":
    unittest.main()
