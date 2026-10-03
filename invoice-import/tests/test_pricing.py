import unittest

import products
from pricing import round_half_up, unit_class
from tests.helpers import TempDirCase


class UnitsTest(unittest.TestCase):
    def test_weight_and_volume_units(self):
        for raw in ("KG", "kg", "KGM", "KILOGRAMMI", "KG."):
            self.assertEqual(unit_class(raw), ("kg", 1.0), raw)
        for raw in ("GR", "G", "GRAMMI"):
            self.assertEqual(unit_class(raw), ("kg", 0.001), raw)
        for raw in ("QL", "QLI", "QUINTALI"):
            self.assertEqual(unit_class(raw), ("kg", 100.0), raw)
        for raw in ("LT", "L", "LITRI"):
            self.assertEqual(unit_class(raw), ("l", 1.0), raw)
        self.assertEqual(unit_class("ML"), ("l", 0.001))
        self.assertEqual(unit_class("CL"), ("l", 0.01))

    def test_everything_else_is_pieces(self):
        for raw in ("PZ", "NR", "N.", "CT", "CF", "CONF", "SC", "BT", "", None):
            self.assertEqual(unit_class(raw)[0], "pc", raw)

    def test_rounding_is_half_up(self):
        self.assertEqual(round_half_up(0.00005, 4), 0.0001)
        self.assertEqual(round_half_up(2.675, 2), 2.68)


class PricingCase(TempDirCase):
    def evaluate_only(self, config=None):
        catalogue, product = self.only_product(self.catalogue(config))
        params = products.propose_params(product, catalogue.config)
        return product, params, products.evaluate(product, params, catalogue)

    def price(self, evaluation):
        self.assertEqual(len(evaluation.points), 1, evaluation.note)
        return evaluation.points[0]


class WeightUnitsTest(PricingCase):
    def test_kg_spellings_all_give_price_per_kg(self):
        for unit in ("KG", "KGM", "KILOGRAMMI", "KILOGRAMMO"):
            with self.subTest(unit=unit):
                self.setUp()
                self.add([{"desc": "FARINA TIPO 00", "qty": 25, "unit": unit, "total": 14.25}])
                _, params, ev = self.evaluate_only()
                point = self.price(ev)
                self.assertEqual((point.price, point.qty, params.price_unit), (0.57, 25.0, "kg"))
                self.assertEqual(ev.reliability, "alta")

    def test_quintals_become_kilograms(self):
        self.add([{"desc": "FARINA", "qty": 1, "unit": "QL", "total": 57}])
        _, _, ev = self.evaluate_only()
        point = self.price(ev)
        self.assertEqual((point.price, point.qty), (0.57, 100.0))

    def test_grams_litres_and_millilitres(self):
        self.add([{"desc": "LIEVITO SECCO", "qty": 500, "unit": "GR", "total": 5}])
        _, params, ev = self.evaluate_only()
        self.assertEqual((self.price(ev).price, self.price(ev).qty, params.price_unit), (10.0, 0.5, "kg"))

    def test_litres_stay_litres(self):
        self.add([{"desc": "OLIO DI OLIVA", "qty": 10, "unit": "LT", "total": 50}])
        _, params, ev = self.evaluate_only()
        self.assertEqual((self.price(ev).price, params.price_unit), (5.0, "l"))
        self.assertEqual(ev.reliability, "alta")

    def test_millilitres(self):
        self.add([{"desc": "ESSENZA", "qty": 500, "unit": "ML", "total": 5}])
        _, params, ev = self.evaluate_only()
        self.assertEqual((self.price(ev).price, self.price(ev).qty, params.price_unit), (10.0, 0.5, "l"))


class PackagedGoodsTest(PricingCase):
    def test_kg_times_count_in_the_description(self):
        self.add([{"desc": "PASSATA kg 2,5 x 4", "qty": 3, "unit": "CT", "total": 60}])
        _, params, ev = self.evaluate_only()
        self.assertEqual(params.price_unit, "kg")
        self.assertEqual((params.pack.size, params.pack.unit, params.pack_count), (2.5, "kg", 4))
        point = self.price(ev)
        self.assertEqual((point.price, point.qty), (2.0, 30.0))  # 3 cartons x 4 x 2.5 kg
        self.assertEqual(ev.reliability, "media")

    def test_grams_in_packs(self):
        self.add([{"desc": "LIEVITO GR.250", "qty": 10, "unit": "PZ", "total": 25}])
        _, params, ev = self.evaluate_only()
        self.assertEqual((params.pack.size, params.pack.unit), (250, "g"))
        self.assertEqual((self.price(ev).price, self.price(ev).qty), (10.0, 2.5))

    def test_litres_in_bottles_stay_litres(self):
        self.add([{"desc": "OLIO LT 1", "qty": 6, "unit": "NR", "total": 30}])
        _, params, ev = self.evaluate_only()
        self.assertEqual(params.price_unit, "l")
        self.assertEqual((self.price(ev).price, self.price(ev).qty), (5.0, 6.0))

    def test_eggs_are_priced_per_egg(self):
        self.add([{"desc": "UOVA FRESCHE DA 30 UOVA", "qty": 2, "unit": "CT", "total": 36}])
        _, params, ev = self.evaluate_only(products.Config(egg_weight_g=50))
        self.assertEqual((params.price_unit, params.pack_count), ("pcs", 30))
        point = self.price(ev)
        self.assertEqual((point.price, point.qty), (0.6, 60.0))
        self.assertEqual(ev.unit_weight_kg, 0.05)
        self.assertEqual(ev.reliability, "media")

    def test_egg_weight_comes_from_the_config(self):
        self.add([{"desc": "UOVA DA 30 UOVA", "qty": 1, "unit": "CT", "total": 30}])
        _, _, ev = self.evaluate_only(products.Config(egg_weight_g=60))
        self.assertEqual(ev.unit_weight_kg, 0.06)

    def test_eggs_without_a_count_count_one_per_unit(self):
        self.add([{"desc": "UOVA CAT. M", "qty": 10, "unit": "PZ", "total": 3}])
        _, _, ev = self.evaluate_only()
        self.assertEqual(self.price(ev).price, 0.3)

    def test_pasta_with_egg_invoiced_by_kg_is_not_treated_as_eggs(self):
        self.add([{"desc": "PASTA ALL'UOVO", "qty": 2, "unit": "KG", "total": 10}])
        _, params, ev = self.evaluate_only()
        self.assertEqual((params.price_unit, params.egg, self.price(ev).price), ("kg", False, 5.0))

    def test_pieces_with_no_weight_need_checking_and_have_no_price(self):
        self.add([{"desc": "TEGLIA ALLUMINIO", "qty": 4, "unit": "PZ", "total": 20}])
        _, params, ev = self.evaluate_only()
        self.assertIsNone(params.price_unit)
        self.assertEqual(ev.points, [])
        self.assertEqual(ev.reliability, "da verificare")


class DocumentRulesTest(PricingCase):
    def test_free_goods_on_a_separate_line_lower_the_price(self):
        self.add([
            {"desc": "BURRO PANETTO", "code": "B1", "qty": 10, "unit": "KG", "total": 100},
            {"desc": "BURRO PANETTO OMAGGIO", "code": "B1", "qty": 1, "unit": "KG", "total": 0},
        ])
        _, _, ev = self.evaluate_only()
        point = self.price(ev)
        self.assertEqual((point.price, point.qty, point.line), (9.0909, 11.0, 1))

    def test_a_discount_line_that_names_no_product_flags_every_product_of_the_document(self):
        self.add([
            {"desc": "FARINA", "qty": 10, "unit": "KG", "total": 10},
            {"desc": "ZUCCHERO", "qty": 10, "unit": "KG", "total": 12},
            {"desc": "SCONTO", "total": -3},
        ])
        catalogue = self.catalogue()
        self.assertEqual(len(catalogue.products), 2)
        for product in catalogue.products.values():
            params = products.propose_params(product, catalogue.config)
            ev = products.evaluate(product, params, catalogue)
            self.assertEqual(ev.reliability, "da verificare")
            self.assertEqual(ev.note, "sconto su riga separata non attribuibile")
            self.assertEqual(len(ev.points), 1)
        self.assertIn("sconto su riga separata", [e.reason for e in catalogue.excluded if e.level == "riga"])

    def test_two_invoices_give_two_price_points_oldest_first(self):
        self.add([{"desc": "FARINA", "code": "F", "qty": 10, "unit": "KG", "total": 6}], date="2026-09-10")
        self.add([{"desc": "FARINA", "code": "F", "qty": 10, "unit": "KG", "total": 5}], date="2026-09-01")
        _, _, ev = self.evaluate_only()
        self.assertEqual([p.price for p in ev.points], [0.5, 0.6])
        self.assertEqual([p.date for p in ev.points], ["2026-09-01", "2026-09-10"])

    def test_zero_quantity_and_zero_total_need_checking(self):
        self.add([{"desc": "FARINA", "qty": 0, "unit": "KG", "total": 5}])
        _, _, ev = self.evaluate_only()
        self.assertEqual((ev.points, ev.reliability, ev.note), ([], "da verificare", "quantità zero o negativa"))

    def test_the_sugar_in_sacks_is_an_ingredient(self):
        self.add([{"desc": "ZUCCHERO SACCHI DA KG 25", "qty": 2, "unit": "PZ", "total": 50}])
        _, product = self.only_product()
        self.assertEqual(product.type, "ingrediente")

    def test_info_lines_and_costs_are_listed_as_excluded(self):
        self.add([
            {"desc": "FARINA", "qty": 1, "unit": "KG", "total": 1},
            {"desc": "LOTTO 1234"},
            {"desc": "SPESE DI TRASPORTO", "qty": 1, "total": 4},
        ])
        catalogue, _ = self.only_product()
        self.assertEqual(sorted(e.reason for e in catalogue.excluded),
                         ["riga informativa", "spese/trasporto"])

    def test_vat_rate_only_when_it_is_a_known_one(self):
        self.assertEqual(products.vat_of(22.0), 22)
        self.assertEqual(products.vat_of(4.0), 4)
        self.assertIsNone(products.vat_of(21.0))
        self.assertIsNone(products.vat_of(None))


if __name__ == "__main__":
    unittest.main()
