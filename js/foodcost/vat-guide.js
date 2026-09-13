// vat-guide.js — which products take which VAT rate, per country. PURE DATA, no imports.
//
// Federico, 13 Sep 2026: «la lista mostra i prodotti a cui corrispondono le varie aliquote
// … secondo la legge», for Italy AND the United Kingdom.
//
// ⚠️⚠️ A GUIDE, NOT A RULING, AND THE SCREEN SAYS SO FIRST. Which rate applies to one
// product turns on details no list can hold (is it eaten in? is it kept hot? is the
// chocolate a couple of dots or a coating?), so the screen opens with «your accountant
// confirms». What is here is the commonest cases a bakery, pastry shop or café meets.
//
// ⚠️ ONLY WHAT COULD BE TRACED TO THE LAW OR THE TAX AUTHORITY. The research behind this
// (13 Sep 2026) flagged some lines it could not confirm on an official site — chocolate
// «in confezioni di pregio», syrups, packaging sold on its own, margarine — and those were
// LEFT OUT rather than written down as fact. Add a line only with a source for it.
//
// ⚠️ THE WORDS FOLLOW THE VENUE'S COUNTRY, NOT THE SCREEN: they name foods, and every
// food word in this app does (v1.68.0). tests/foodcost-vat-guide.test.mjs guards the
// shape, the sources and that this file never reaches the interface dictionary.
//
// Rates are listed HIGHEST FIRST, the order of the VAT menu in foodcost-model.js.

export const VAT_GUIDE_BY_COUNTRY = Object.freeze({
  IT: Object.freeze({
    checkedOn: '2026-09-13',
    sources: Object.freeze([
      Object.freeze({
        title: 'DPR 633/1972, art. 16 e Tabella A (Normattiva)',
        url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:1972-10-26;633~art16',
      }),
      Object.freeze({
        title: 'Agenzia delle Entrate, Risposta n. 546/2021 — prodotti della panetteria',
        url: 'https://www.agenziaentrate.gov.it/portale/documents/20143/0/Risposta_546_16.08.2021.pdf/722b3fe9-5eea-93c3-a46e-8dee11bd1a87',
      }),
      Object.freeze({
        title: 'Agenzia delle Entrate, Risposta n. 412/2023 — cessione di pasti',
        url: 'https://www.agenziaentrate.gov.it/portale/documents/20143/5476626/Risposta+n.+412_2023.pdf/e85ca171-da27-7ab3-7aa2-4ac3c4436c9f',
      }),
      Object.freeze({
        title: 'FiscoOggi (Agenzia delle Entrate) — acqua da tavola in bottiglia',
        url: 'https://www.fiscooggi.it/portale/-/l-acqua-da-tavola-in-bottiglia-sconta-l-aliquota-iva-ordinaria',
      }),
    ]),
    rates: Object.freeze([
      Object.freeze({ rate: 22, items: Object.freeze([
        'Tutto ciò che la legge non mette al 4%, 5% o 10%',
        'Acqua minerale e da tavola in bottiglia',
        'Bibite analcoliche e succhi di frutta venduti da portare via',
        'Birra, vino e superalcolici venduti da portare via',
        'Caffè in grani o macinato, cialde e capsule',
      ]) }),
      Object.freeze({ rate: 10, items: Object.freeze([
        'Pasticceria, biscotteria e panetteria fine (cornetti, brioche, panettone), anche con cacao',
        'Pane con ingredienti che la legge non ammette al 4%',
        'Uova in guscio',
        'Yogurt e panna',
        'Zucchero e miele',
        'Marmellate, confetture e frutta candita',
        'Carne e pesce',
        'Piatti pronti e pasti cotti, anche da asporto o a domicilio',
        'Tutto ciò che si consuma sul posto al bar o al ristorante, bevande comprese',
      ]) }),
      Object.freeze({ rate: 5, items: Object.freeze([
        'Basilico, rosmarino e salvia freschi',
        'Tartufi freschi',
      ]) }),
      Object.freeze({ rate: 4, items: Object.freeze([
        'Pane e panetteria ordinaria, anche con grassi, zucchero, semi, erbe e spezie, ma senza miele, uova o formaggio',
        'Crackers e fette biscottate, alle stesse condizioni del pane',
        'Pasta',
        'Farine e semole',
        'Latte fresco, burro, formaggi e latticini',
        'Frutta e ortaggi freschi',
        'Olio d’oliva',
        'Pomodori pelati e conserve di pomodoro',
      ]) }),
    ]),
    notes: Object.freeze([
      'Consumo sul posto (bar, tavoli, ristorante): 10% su tutto, bevande comprese.',
      'Vendita da portare via: ogni prodotto ha la sua aliquota (pane 4%, cornetto 10%, bibita 22%).',
      'Piatti pronti e pasti cotti restano al 10% anche da asporto o a domicilio.',
    ]),
  }),

  GB: Object.freeze({
    checkedOn: '2026-09-13',
    sources: Object.freeze([
      Object.freeze({
        title: 'HMRC VAT Notice 701/14: Food products',
        url: 'https://www.gov.uk/guidance/food-products-and-vat-notice-70114',
      }),
      Object.freeze({
        title: 'HMRC VAT Notice 709/1: Catering, takeaway food',
        url: 'https://www.gov.uk/guidance/catering-takeaway-food-and-vat-notice-7091',
      }),
      Object.freeze({
        title: 'Value Added Tax Act 1994, Schedule 8, Group 1',
        url: 'https://www.legislation.gov.uk/ukpga/1994/23/schedule/8',
      }),
    ]),
    rates: Object.freeze([
      Object.freeze({ rate: 20, items: Object.freeze([
        'Anything eaten or drunk on your premises, outside seating included',
        'Hot takeaway food, and every hot takeaway drink',
        'Confectionery: sweets, chocolates, cereal bars',
        'Biscuits wholly or partly covered in chocolate',
        'Gingerbread figures with chocolate beyond small details such as eyes',
        'Ice cream and frozen yoghurt',
        'Crisps, and roasted or salted nuts',
        'Soft drinks, fruit juices and bottled water',
        'Beer, cider, wine and spirits',
      ]) }),
      Object.freeze({ rate: 5, items: Object.freeze([
        'No food or drink sold in a bakery or café takes 5% today',
      ]) }),
      Object.freeze({ rate: 0, items: Object.freeze([
        'Bread, rolls and pitta to take away',
        'Cakes, pastries, meringues and flapjacks, chocolate-covered cakes included',
        'Plain biscuits, and biscuits with chocolate chips baked in',
        'Sandwiches and other cold food to take away',
        'Fresh bread and pastries still warm from the oven, as long as they are not kept hot',
        'Flour, sugar, eggs, butter, milk and cheese',
        'Tea, coffee and cocoa sold to make at home',
      ]) }),
    ]),
    notes: Object.freeze([
      'Eaten on your premises is catering: 20%, even for food that is 0% in a shop.',
      'Cold takeaway keeps the food’s own rate; sold hot, it becomes 20%.',
      'Warm fresh bread is not hot food unless it is kept hot, or sold as hot.',
    ]),
  }),
});

// The guide for a venue's country. ⚠️ An unknown country gets the UK's — the same
// direction vatRatesFor() falls back in, so the menu and its guide always agree.
export function vatGuideFor(country) {
  return Object.prototype.hasOwnProperty.call(VAT_GUIDE_BY_COUNTRY, country)
    ? VAT_GUIDE_BY_COUNTRY[country]
    : VAT_GUIDE_BY_COUNTRY.GB;
}
