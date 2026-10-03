import unittest

import fatturapa
from products import Config
from tests.helpers import TempDirCase, copy_fixtures, invoice_xml, metadata_xml

LINE = {"desc": "FARINA TIPO 00 KG 25", "qty": 25, "unit": "KG", "total": 14.25}


class NamespaceStylesTest(TempDirCase):
    def test_the_three_namespace_styles_and_their_metadata_files(self):
        copy_fixtures(self.fatture)
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(len(load.documents), 3)
        by_vat = {d.vat_number: d for d in load.documents}
        ns3 = by_vat["IT00000000001"]
        self.assertEqual(ns3.supplier_name, "FORNITORE ESEMPIO SRL")
        self.assertEqual(ns3.sdi_id, "18000000001")
        self.assertEqual(ns3.reception_date, "2026-09-01")
        self.assertEqual(ns3.date, "2026-08-31")
        self.assertEqual(ns3.lines[0].article_code, "F00-25")
        self.assertEqual(ns3.lines[0].quantity, 25.0)
        self.assertEqual(by_vat["IT00000000002"].number, "55/A")
        self.assertEqual(by_vat["IT00000000002"].sdi_id, "18000000002")
        self.assertEqual(by_vat["IT00000000003"].doc_type, "TD24")

    def test_metadata_files_are_never_read_as_invoices(self):
        copy_fixtures(self.fatture)
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(load.other_xml, 0)
        self.assertEqual(load.skipped, [])
        self.assertEqual(sorted(d.file for d in load.documents), ["invoice_default", "invoice_ns3", "invoice_p"])


class ZipTest(TempDirCase):
    def test_zip_of_fixtures_is_read_without_extracting(self):
        copy_fixtures(self.tmp / "src")
        files = {f.name: f.read_text(encoding="utf-8") for f in (self.tmp / "src").glob("*.xml")}
        files["invoice_ns3.pdf"] = "not read"
        files["signed.xml.p7m"] = "skipped"
        self.zip_of("archive.zip", files)
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(len(load.documents), 3)
        self.assertEqual(load.p7m_count, 1)
        self.assertEqual({p.name for p in self.fatture.iterdir()}, {"archive.zip"})

    def test_same_invoice_in_two_zips_counts_once(self):
        xml = invoice_xml([LINE])
        member = {"a.xml": xml, "a_MT_001.xml": metadata_xml("111")}
        self.zip_of("one.zip", member)
        # the second archive names the file differently: only the SDI id says it is the same
        self.zip_of("two.zip", {"renamed.xml": xml, "renamed_MT_001.xml": metadata_xml("111")})
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(len(load.documents), 1)
        self.assertEqual(load.duplicates, 1)

    def test_without_an_sdi_id_the_file_name_deduplicates(self):
        xml = invoice_xml([LINE])
        self.zip_of("one.zip", {"same.xml": xml})
        self.zip_of("two.zip", {"same.xml": xml})
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(len(load.documents), 1)
        self.assertEqual(load.documents[0].doc_id, "same")

    def test_a_broken_zip_and_broken_xml_are_reported_not_fatal(self):
        (self.fatture / "broken.zip").write_bytes(b"not a zip")
        (self.fatture / "broken.xml").write_text("<a><b></a>", encoding="utf-8")
        self.add([LINE])
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(len(load.documents), 1)
        self.assertEqual({s.name for s in load.skipped}, {"broken.zip", "broken.xml"})

    def test_a_dtd_is_refused(self):
        evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><FatturaElettronica>&a;</FatturaElettronica>'
        (self.fatture / "evil.xml").write_text(evil, encoding="utf-8")
        load = fatturapa.load_invoices(self.fatture)
        self.assertEqual(load.documents, [])
        self.assertEqual(load.skipped[0].name, "evil.xml")

    def test_missing_folder_gives_an_empty_result(self):
        load = fatturapa.load_invoices(self.tmp / "nowhere")
        self.assertEqual(load.documents, [])


class DocumentTypesTest(TempDirCase):
    def test_credit_note_is_excluded_and_listed(self):
        self.add([LINE], doc_type="TD04", number="9")
        self.add([LINE], date="2026-09-02", number="2")
        catalogue = self.catalogue()
        self.assertEqual(len(catalogue.products), 1)
        docs = [e for e in catalogue.excluded if e.level == "documento"]
        self.assertEqual([e.reason for e in docs], ["tipo documento TD04"])
        self.assertEqual(docs[0].number, "9")

    def test_td24_and_td25_are_kept(self):
        self.add([LINE], doc_type="TD24")
        self.add([LINE], doc_type="TD25", date="2026-09-02")
        self.assertEqual([e for e in self.catalogue().excluded if e.level == "documento"], [])


class SupplierIdentityTest(TempDirCase):
    def test_same_vat_two_spellings_is_one_supplier_with_the_latest_name(self):
        self.add([LINE], name="FORNITORE ESEMPIO SRL", date="2026-09-01")
        self.add([LINE], name="Fornitore Esempio S.r.l.", date="2026-09-05", vat="00000000001")
        catalogue = self.catalogue()
        self.assertEqual(list(catalogue.suppliers), ["IT00000000001"])
        self.assertEqual(catalogue.suppliers["IT00000000001"].name, "Fornitore Esempio S.r.l.")
        self.assertEqual(len(catalogue.products), 1)

    def test_similar_names_with_different_vats_are_two_suppliers(self):
        self.add([LINE], name="FORNITORE ESEMPIO SRL", vat="00000000001")
        self.add([LINE], name="FORNITORE ESEMPIO SRL", vat="00000000002")
        catalogue = self.catalogue()
        self.assertEqual(sorted(catalogue.suppliers), ["IT00000000001", "IT00000000002"])
        self.assertEqual(len(catalogue.products), 2)

    def test_vat_with_spaces_and_lower_case_is_normalised(self):
        self.assertEqual(fatturapa.normalise_vat("it", " 0000 0000 001"), "IT00000000001")

    def test_supplier_without_vat_gets_a_hashed_key_and_the_tax_code_never_appears(self):
        tax_code = "RSSMRA80A01H501U"
        self.add([LINE], name="Mario Rossi", vat="", tax_code=tax_code, base=f"{tax_code}_00001")
        catalogue = self.catalogue()
        (key,) = catalogue.suppliers
        self.assertRegex(key, r"^NOVAT:[0-9a-f]{12}$")
        self.assertEqual(catalogue.suppliers[key].vat_number, "")
        # the file name began with the tax code: it is blanked wherever the file is shown
        doc = catalogue.documents[0]
        self.assertNotIn(tax_code.lower(), doc.file.lower())
        everything = repr(catalogue.documents) + repr(catalogue.products) + repr(catalogue.suppliers)
        self.assertNotIn(tax_code, everything)
        self.assertNotIn(tax_code.lower(), everything.lower())

    def test_a_personal_tax_code_in_a_file_name_is_blanked_even_when_there_is_a_vat_number(self):
        tax_code = "RSSMRA80A01H501U"  # invented: the classic textbook example
        self.add([LINE], vat="00000000001", base=f"IT{tax_code}_00007")
        (doc,) = self.catalogue().documents
        self.assertEqual(doc.file, "IT***_00007")
        self.assertNotIn(tax_code, doc.doc_id)

    def test_no_vat_key_is_stable_per_tax_code(self):
        self.assertEqual(fatturapa.no_vat_key("ABC", "x"), fatturapa.no_vat_key(" abc ", "other name"))
        self.assertNotEqual(fatturapa.no_vat_key("ABC", ""), fatturapa.no_vat_key("ABD", ""))


class ExcludedSupplierTest(TempDirCase):
    def test_configured_supplier_is_excluded_with_its_reason(self):
        self.add([LINE], vat="00000000099", name="UTENZE ESEMPIO SPA")
        self.add([LINE], vat="00000000001")
        catalogue = self.catalogue(Config({"IT00000000099": "utenze"}))
        self.assertEqual(list(catalogue.suppliers.values())[0].key, "IT00000000099")
        self.assertEqual({p.supplier_key for p in catalogue.products.values()}, {"IT00000000001"})
        (doc_row,) = [e for e in catalogue.excluded if e.level == "documento"]
        self.assertIn("utenze", doc_row.reason)


if __name__ == "__main__":
    unittest.main()
