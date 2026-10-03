import unittest

from classify import (
    PackInfo, classify, clean_name, eggs_per_pack, format_pack_size, is_egg, is_unattributed_discount, normalise_name,
    pack_word, parse_pack, parse_pack_text, product_key,
)


class PackParsingTest(unittest.TestCase):
    def check(self, description, size, unit, count=None):
        self.assertEqual(parse_pack(description), PackInfo(size, unit, count), description)

    def test_unit_first_size_times_count(self):
        self.check("ML10X102 OLIO EVO MONODOSE", 10, "ml", 102)
        self.check("GR25X40 ZUCCHERO BUSTINE", 25, "g", 40)
        self.check("KG1X10 FARINA", 1, "kg", 10)
        self.check("CL 5 X 24 SCIROPPO", 50, "ml", 24)
        self.check("LT 1,5 x 6 ACETO", 1.5, "l", 6)

    def test_unit_first_does_not_match_inside_a_word(self):
        self.assertIsNone(parse_pack("BUSTE ML"))
        self.assertIsNone(parse_pack("DOLCE5X3"))

    def test_the_prototype_patterns(self):
        self.check("PASTA 2,5kg* 4pz", 2.5, "kg", 4)
        self.check("PASTA 85gr* 50pz", 85, "g", 50)
        self.check("PASTA PZ.50 GR.85", 85, "g", 50)
        self.check("BISCOTTI gr.70x6", 70, "g", 6)
        self.check("ZUCCHERO KG 25", 25, "kg")
        self.check("SEMOLA 2,5KG", 2.5, "kg")
        self.check("LIEVITO GR.250", 250, "g")
        self.check("SALE G.1000", 1000, "g")
        self.check("SALE GR 250", 250, "g")
        self.check("MANDORLE 500 g", 500, "g")
        self.check("OLIO LT 1", 1, "l")
        self.check("ACETO 1L", 1, "l")
        self.check("SCIROPPO ML 500", 500, "ml")

    def test_the_new_patterns(self):
        self.check("PASSATA kg 2,5 x 4", 2.5, "kg", 4)
        self.check("PASSATA KG.2,5X4", 2.5, "kg", 4)
        self.check("CAFFE GRANI 1kgx6", 1, "kg", 6)
        self.check("CAPSULE 7gx80", 7, "g", 80)
        self.check("POLVERE G 570 (X12PZ)", 570, "g", 12)
        self.assertIsNone(parse_pack("VITAMINA G 5"))

    def test_no_size_in_the_description(self):
        self.assertIsNone(parse_pack("BUSTE CARTA"))
        self.assertIsNone(parse_pack(""))

    def test_formatting_is_dot_decimal_and_has_no_trailing_zeros(self):
        self.assertEqual(format_pack_size(2.5, "kg"), "2.5 kg")
        self.assertEqual(format_pack_size(25.0, "kg"), "25 kg")
        self.assertEqual(format_pack_size(250, "g"), "250 g")

    def test_typed_weights(self):
        self.assertEqual(parse_pack_text("2,5 kg"), (2.5, "kg"))
        self.assertEqual(parse_pack_text("250g"), (250.0, "g"))
        self.assertEqual(parse_pack_text("1 l"), (1.0, "l"))
        self.assertEqual(parse_pack_text("500 ML"), (500.0, "ml"))
        self.assertIsNone(parse_pack_text("un sacco"))
        self.assertIsNone(parse_pack_text("0 kg"))
        self.assertIsNone(parse_pack_text(""))


class EggTest(unittest.TestCase):
    def test_count_in_the_description(self):
        self.assertTrue(is_egg("UOVA FRESCHE DA 30 UOVA"))
        self.assertEqual(eggs_per_pack("UOVA FRESCHE DA 30 UOVA"), 30)
        self.assertEqual(eggs_per_pack("30 UOVA CAT. M"), 30)
        self.assertEqual(eggs_per_pack("UOVA CAT. M X30"), 30)
        self.assertIsNone(eggs_per_pack("UOVA CAT. M"))
        self.assertFalse(is_egg("PASTA FRESCA"))


class ClassifyTest(unittest.TestCase):
    def kind(self, description, qty=1.0, total=5.0):
        return classify(description, qty, total)

    def test_sugar_in_sacks_is_an_ingredient_not_packaging(self):
        self.assertEqual(self.kind("ZUCCHERO SACCHI DA KG 25"), ("ingrediente", ""))

    def test_real_packaging_still_is_packaging(self):
        self.assertEqual(self.kind("SACCHETTI CARTA PANE")[0], "packaging")
        self.assertEqual(self.kind("BUSTE PLASTICA")[0], "packaging")
        self.assertEqual(self.kind("CARTA FORNO")[0], "packaging")

    def test_beverages_and_ready_made_are_resale(self):
        self.assertEqual(self.kind("ACQUA NATURALE 50 CL")[0], "rivendita")
        self.assertEqual(self.kind("COCA COLA LATTINA")[0], "rivendita")
        self.assertEqual(self.kind("CORNETTO ALLA CREMA")[0], "rivendita")
        self.assertEqual(self.kind("FECOLA DI PATATE")[0], "ingrediente")

    def test_noise_and_costs_are_excluded(self):
        self.assertEqual(classify("LOTTO 12345", None, None), ("excluded", "riga informativa"))
        self.assertEqual(classify("", 1, 5), ("excluded", "riga informativa"))
        self.assertEqual(classify("OFFERTA SPECIALE", 1, 5), ("excluded", "riga informativa"))
        self.assertEqual(classify("DESCRIZIONE QUALSIASI", 0, 0), ("excluded", "riga informativa"))
        self.assertEqual(classify("SPESE DI TRASPORTO", 1, 5), ("excluded", "spese/trasporto"))
        self.assertEqual(classify("INCASSO CONTRASSEGNO", 1, 5), ("excluded", "spese/trasporto"))

    def test_discount_line_without_product(self):
        self.assertTrue(is_unattributed_discount("SCONTO COMMERCIALE", None, -3.0))
        self.assertTrue(is_unattributed_discount("QUALCOSA", None, -3.0))
        self.assertFalse(is_unattributed_discount("FARINA", 5, -3.0))
        self.assertFalse(is_unattributed_discount("FARINA", None, 3.0))


class KeyAndNameTest(unittest.TestCase):
    def test_normalised_name(self):
        self.assertEqual(normalise_name("*Crème  brûlée {LOTTO 55 SCAD. 01/27}"), "creme brulee")
        self.assertEqual(normalise_name("FARINA T.00 / KG-25"), "farina t 00 kg 25")

    def test_key_prefers_the_article_code(self):
        self.assertEqual(product_key("IT1", "F00-25", "FARINA"), "IT1|code:F00-25")
        self.assertEqual(product_key("IT1", " ", "Farina {x}"), "IT1|name:farina")

    def test_lot_text_does_not_change_the_key(self):
        self.assertEqual(product_key("IT1", "", "BURRO {LOTTO 1}"), product_key("IT1", "", "BURRO {LOTTO 2}"))

    def test_proposed_name(self):
        self.assertEqual(clean_name("ZUCCHERO SACCHI DA KG 25"), "Zucchero")
        self.assertEqual(clean_name("FARINA TIPO 00 SACCO KG 25", "F00-25"), "Farina tipo 00")
        self.assertEqual(clean_name("*PASSATA 2,5kg* 4pz {LOTTO 7}"), "Passata")
        self.assertEqual(clean_name("OLIO EXTRA VERGINE LT 5"), "Olio extra vergine")
        self.assertEqual(clean_name("KG 25"), "Kg 25")

    def test_pack_word(self):
        self.assertEqual(pack_word("ZUCCHERO SACCHI DA KG 25"), "sacco")
        self.assertEqual(pack_word("PASSATA BUSTE"), "busta")
        self.assertEqual(pack_word("OLIO LATTA LT 5"), "latta")
        self.assertEqual(pack_word("LATTE INTERO"), "")
        self.assertEqual(pack_word("FARINA"), "")


if __name__ == "__main__":
    unittest.main()
