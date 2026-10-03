"""The review fixes of 3 Oct 2026: the editable type column, documents with no SDI id, a second invoice in one
file, file names never shown raw, the salt of a no-VAT key, and the egg count. Invented data only."""
import hashlib
import json
import unittest

from openpyxl import load_workbook

import classify
import fatturapa
import invoice_import
import products
import workbook
from tests.helpers import TempDirCase, invoice_xml, write_invoice
from tests.test_export import JsonCase
from tests.test_workbook import BAGS, COLA, FLOUR, SUGAR

KEY_FLOUR = "IT00000000001|code:F00-25"


class TypeColumnTest(JsonCase):
    def test_the_type_column_is_editable_and_named_tipo(self):
        self.assertEqual(workbook.H_TYPE, "Tipo")
        self.assertIn(workbook.H_TYPE, workbook.EDITABLE)

    def test_only_ingredients_reach_the_file_and_the_rest_is_listed_with_its_reason(self):
        self.add([FLOUR, BAGS, COLA])
        self.run_main("workbook")
        for part in ("code:F00-25", "name:buste", "name:coca"):
            self.edit(part, **{workbook.H_ACTION: "importa"})
        code, output, data = self.make_json()
        self.assertEqual(code, 0, output)
        self.assertEqual([i["key"] for i in data["ingredients"]], [KEY_FLOUR])
        self.assertIn("packaging e rivendita non si importano per ora", output)
        self.assertIn("Righe lasciate fuori: 2", output)

    def test_a_corrected_type_is_obeyed_both_ways(self):
        self.add([FLOUR, BAGS])
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa", workbook.H_TYPE: "rivendita"})
        self.edit("name:buste", **{workbook.H_ACTION: "importa", workbook.H_TYPE: "Ingrediente",
                                   workbook.H_PRICE_UNIT: "kg", workbook.H_WEIGHT: "1 kg"})
        code, output, data = self.make_json()
        self.assertEqual(code, 0, output)
        self.assertEqual([i["key"] for i in data["ingredients"]], ["IT00000000001|name:buste plastica"])
        self.assertIn("packaging e rivendita non si importano per ora", output)

    def test_a_cleared_type_means_as_proposed_and_an_unknown_one_is_listed(self):
        self.add([FLOUR, BAGS, SUGAR])
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa", workbook.H_TYPE: None})
        self.edit("name:buste", **{workbook.H_ACTION: "importa", workbook.H_TYPE: "boh"})
        self.edit("name:zucchero", **{workbook.H_ACTION: "importa", workbook.H_TYPE: "ingrediente"})
        _, output, data = self.make_json()
        self.assertEqual(sorted(i["key"] for i in data["ingredients"]),
                         sorted([KEY_FLOUR, "IT00000000001|name:zucchero sacchi da kg 25"]))
        self.assertIn("tipo non riconosciuto: «boh»", output)

    def test_the_type_you_typed_survives_the_next_run(self):
        self.add([FLOUR, BAGS])
        self.run_main("workbook")
        self.edit("name:buste", **{workbook.H_TYPE: "ingrediente"})
        self.run_main("workbook")
        self.assertEqual(self.rows()["IT00000000001|name:buste plastica"][workbook.H_TYPE], "ingrediente")
        self.assertEqual(self.rows()[KEY_FLOUR][workbook.H_TYPE], "ingrediente")

    def test_the_type_has_a_pick_list_in_the_sheet(self):
        self.add([FLOUR])
        self.run_main("workbook")
        wb = load_workbook(self.xlsx)
        formulas = {dv.formula1 for dv in wb["Prodotti"].data_validations.dataValidation}
        wb.close()
        self.assertIn('"ingrediente,packaging,rivendita"', formulas)


class NoSdiIdTest(TempDirCase):
    def test_a_document_without_an_sdi_id_is_excluded_and_listed_never_given_a_file_name_id(self):
        write_invoice(self.fatture, "no-metadata", invoice_xml([FLOUR]))   # no _MT file: no SDI id
        self.add([SUGAR])
        catalogue = self.catalogue()
        self.assertEqual({p.supplier_key for p in catalogue.products.values()}, {"IT00000000001"})
        self.assertEqual(len(catalogue.products), 1, "only the invoice that has an SDI id is read")
        (doc_row,) = [e for e in catalogue.excluded if e.level == "documento"]
        self.assertEqual(doc_row.reason, "manca l'identificativo SDI")
        points = [p for product in catalogue.products.values()
                  for p in products.evaluate(product, products.propose_params(product, catalogue.config), catalogue).points]
        self.assertTrue(points)
        for point in points:
            self.assertRegex(point.invoice_id, r"^[0-9]+$", "an invoice id is the SDI id, digits only")

    def test_it_shows_in_the_documents_sheet_as_excluded(self):
        write_invoice(self.fatture, "no-metadata", invoice_xml([FLOUR]))
        catalogue = self.catalogue()
        self.assertEqual(list(catalogue.doc_status.values()), ["esclusa: manca l'identificativo SDI"])


class SecondInvoiceInOneFileTest(TempDirCase):
    def two_bodies(self):
        first = invoice_xml([FLOUR], number="1", date="2026-09-01")
        second = invoice_xml([FLOUR], number="2", date="2026-09-05")
        body = second[second.index("<FatturaElettronicaBody>"):second.index("</p:FatturaElettronica>")]
        return first.replace("</p:FatturaElettronica>", body + "</p:FatturaElettronica>")

    def test_line_numbers_are_pushed_up_per_body_so_ids_stay_unique_digits_and_short(self):
        write_invoice(self.fatture, "two-in-one", self.two_bodies(), sdi="9000000001")
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(len(load.documents), 2)
        self.assertEqual(load.duplicates, 0, "the second invoice is not a duplicate of the first")
        self.assertEqual([[ln.number for ln in d.lines] for d in load.documents], [[1], [100001]])
        catalogue = self.catalogue()
        _, product = self.only_product(catalogue)
        points = products.evaluate(product, products.propose_params(product, catalogue.config), catalogue).points
        self.assertEqual([(p.invoice_id, p.line) for p in points], [("9000000001", 1), ("9000000001", 100001)])
        self.assertEqual(len({(p.invoice_id, p.line) for p in points}), 2)
        for p in points:
            self.assertLessEqual(p.line, 999999)

    def test_a_file_with_too_many_invoices_is_listed_not_read(self):
        first = invoice_xml([FLOUR])
        body = first[first.index("<FatturaElettronicaBody>"):first.index("</p:FatturaElettronica>")]
        write_invoice(self.fatture, "huge", first.replace("</p:FatturaElettronica>", body * 9 + "</p:FatturaElettronica>"),
                      sdi="9000000002")
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(load.documents, [])
        self.assertEqual([s.name for s in load.skipped], ["huge.xml"])
        self.assertIn("più di 9", load.skipped[0].reason)


class FileNamesTest(JsonCase):
    TAX_CODE = "RSSMRA80A01H501U"   # invented: the classic textbook example

    def test_a_skipped_file_is_never_printed_with_a_personal_tax_code(self):
        (self.fatture / f"IT{self.TAX_CODE}_00001.xml").write_text("<a><b></a>", encoding="utf-8")
        self.add([FLOUR])
        code, output = self.run_main("workbook")
        self.assertEqual(code, 0, output)
        self.assertIn("Saltato IT***_00001.xml", output)
        self.assertNotIn(self.TAX_CODE, output)

    def test_the_same_in_the_json_run_and_for_a_broken_zip(self):
        (self.fatture / f"{self.TAX_CODE}.zip").write_bytes(b"not a zip")
        self.add([FLOUR])
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa"})
        code, output, _ = self.make_json()
        self.assertEqual(code, 0, output)
        self.assertIn("Saltato ***.zip", output)
        self.assertNotIn(self.TAX_CODE, output)

    def test_a_file_too_big_inside_a_zip_is_listed_redacted(self):
        original = fatturapa.MAX_XML_BYTES
        fatturapa.MAX_XML_BYTES = 10
        self.addCleanup(setattr, fatturapa, "MAX_XML_BYTES", original)
        self.zip_of("a.zip", {f"IT{self.TAX_CODE}_1.xml": "<x>0123456789</x>"})
        (self.fatture / f"IT{self.TAX_CODE}_2.xml").write_text("<x>0123456789</x>", encoding="utf-8")
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(sorted(s.name for s in load.skipped), ["IT***_1.xml", "IT***_2.xml"])
        self.assertEqual(fatturapa.redact_file_name("nothing personal.xml"), "nothing personal.xml")


class NoVatSaltTest(JsonCase):
    TAX_CODE = "RSSMRA80A01H501U"

    def add_sole_trader(self):
        self.add([FLOUR], name="Mario Rossi", vat="", tax_code=self.TAX_CODE, base=f"{self.TAX_CODE}_00001")

    def test_a_missing_salt_is_generated_added_to_config_and_said_once(self):
        (self.base / "config.json").write_text(
            json.dumps({"excludedSuppliers": {"IT00000000099": "utenze"}, "eggWeightG": 52}), encoding="utf-8")
        self.add_sole_trader()
        code, output = self.run_main("workbook")
        self.assertEqual(code, 0, output)
        saved = json.loads((self.base / "config.json").read_text(encoding="utf-8"))
        self.assertRegex(saved["novatSalt"], r"^[0-9a-f]{32}$")
        self.assertEqual(saved["excludedSuppliers"], {"IT00000000099": "utenze"}, "the other keys stay")
        self.assertEqual(saved["eggWeightG"], 52)
        self.assertEqual(output.count("novatSalt"), 1, "said once")
        salt = saved["novatSalt"]
        _, second = self.run_main("workbook")
        self.assertNotIn("novatSalt", second, "not said again")
        self.assertEqual(json.loads((self.base / "config.json").read_text(encoding="utf-8"))["novatSalt"], salt)
        self.assertFalse((self.base / "config.json.tmp").exists())

    def test_with_no_config_file_at_all_one_is_created(self):
        self.add_sole_trader()
        self.run_main("workbook")
        saved = json.loads((self.base / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(list(saved), ["novatSalt"])

    def test_the_key_is_the_salted_hash_and_stays_the_same_between_runs(self):
        self.add_sole_trader()
        self.run_main("workbook")
        salt = json.loads((self.base / "config.json").read_text(encoding="utf-8"))["novatSalt"]
        expected = "NOVAT:" + hashlib.sha256((salt + self.TAX_CODE).encode()).hexdigest()[:12]
        unsalted = "NOVAT:" + hashlib.sha256(self.TAX_CODE.encode()).hexdigest()[:12]
        keys = {k.split("|")[0] for k in self.rows()}
        self.assertEqual(keys, {expected})
        self.assertNotEqual(expected, unsalted, "an unsalted hash of a tax code could be reversed by trying them all")
        self.run_main("workbook")
        self.assertEqual({k.split("|")[0] for k in self.rows()}, {expected})

    def test_two_salts_give_two_keys_and_the_tax_code_still_never_appears(self):
        self.assertNotEqual(fatturapa.no_vat_key(self.TAX_CODE, "", "aaaa"), fatturapa.no_vat_key(self.TAX_CODE, "", "bbbb"))
        self.assertEqual(fatturapa.no_vat_key(self.TAX_CODE, "", "aaaa"), fatturapa.no_vat_key(f" {self.TAX_CODE.lower()} ", "x", "aaaa"))
        self.add_sole_trader()
        self.run_main("workbook")
        self.edit("code:F00-25", **{workbook.H_ACTION: "importa"})
        code, output, data = self.make_json()
        self.assertEqual(code, 0, output)
        self.assertNotIn(self.TAX_CODE, json.dumps(data))

    def test_a_bad_salt_is_a_friendly_stop(self):
        (self.base / "config.json").write_text('{"novatSalt": 12}', encoding="utf-8")
        self.add([FLOUR])
        code, output = self.run_main("workbook")
        self.assertEqual(code, 1)
        self.assertIn("novatSalt", output)

    def test_the_example_config_documents_the_key(self):
        example = json.loads((invoice_import.HERE / "config.example.json").read_text(encoding="utf-8"))
        self.assertIn("novatSalt", example)
        self.assertEqual(products.load_config(invoice_import.HERE / "config.example.json").novat_salt, example["novatSalt"])


class EggCountTest(unittest.TestCase):
    def test_trays_of_trays_are_multiplied(self):
        self.assertEqual(classify.eggs_per_pack("UOVA 6 X 10 UOVA"), 60)
        self.assertEqual(classify.eggs_per_pack("UOVA CAT. M 6x10 UOVA"), 60)
        self.assertEqual(classify.eggs_per_pack("UOVA 2 * 15 UOVA"), 30)

    def test_the_plain_ways_to_say_it_still_work(self):
        self.assertEqual(classify.eggs_per_pack("UOVA FRESCHE DA 30 UOVA"), 30)
        self.assertEqual(classify.eggs_per_pack("UOVA CAT. M X30"), 30)
        self.assertEqual(classify.eggs_per_pack("30 UOVA CAT. M"), 30)
        self.assertIsNone(classify.eggs_per_pack("UOVA CAT. M"))


class EggCountEndToEndTest(JsonCase):
    def test_the_pack_count_in_the_file_is_sixty(self):
        self.add([{"desc": "UOVA FRESCHE 6 X 10 UOVA", "qty": 2, "unit": "CT", "total": 72}])
        self.run_main("workbook")
        (key,) = self.rows()
        self.assertEqual(self.rows()[key][workbook.H_COUNT], 60)
        self.edit("name:uova", **{workbook.H_ACTION: "importa"})
        _, output, data = self.make_json()
        item = data["ingredients"][0]
        self.assertEqual((item["priceUnit"], item["packCount"], item["packUnit"]), ("pcs", 60, "uovo"))


if __name__ == "__main__":
    unittest.main()
