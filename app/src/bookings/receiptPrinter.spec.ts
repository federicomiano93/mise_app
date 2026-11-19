import { describe, expect, it, vi } from 'vitest';
import { isPrinterHost } from './printerHost';
import {
  BIG_COLUMNS, COLUMNS, nonFiscalXml, plainText, printerUrl, readAnswer, readPrinterSetting, sendToPrinter, testPage, wrapLines, writePrinterSetting,
} from './receiptPrinter';

// Bookings step 3: a slip straight to the Epson FP-81 II RT, as a NON-FISCAL document of its own XML protocol. ⚠️ Fake text only.

const memory = () => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
};

describe('the printer\'s address', () => {
  it('is a private network address, each part 0–255, with an optional port', () => {
    for (const ok of ['192.168.1.50', '10.0.0.7', '172.16.0.1', '172.31.255.254', '192.168.1.50:8443']) expect(isPrinterHost(ok), ok).toBe(true);
    for (const bad of ['8.8.8.8', '172.32.0.1', '192.168.1.256', 'printer.local', '192.168.1', '192.168.1.50:0', '192.168.1.50:70000', 'https://192.168.1.50', '', '192.168.001.050', '010.0.0.7', '192.168.1.50:08443']) {
      expect(isPrinterHost(bad), bad).toBe(false);
    }
  });

  it('is kept on this device, and a blocked storage is no printer rather than a broken screen', () => {
    const storage = memory();
    expect(readPrinterSetting(storage)).toBeNull();
    expect(writePrinterSetting({ host: ' 192.168.1.50 ', plain: true }, storage)).toBe(true);
    expect(readPrinterSetting(storage)).toEqual({ host: '192.168.1.50', plain: true });
    expect(writePrinterSetting({ host: 'evil.test', plain: false }, storage)).toBe(false);
    expect(writePrinterSetting(null, storage)).toBe(true);
    expect(readPrinterSetting(storage)).toBeNull();
    const blocked = { getItem: () => { throw new Error('blocked'); } };
    expect(readPrinterSetting(blocked)).toBeNull();
    expect(writePrinterSetting({ host: '192.168.1.50', plain: false }, null)).toBe(false);
  });
});

describe('the document sent', () => {
  it('is ONE non-fiscal document: begin, a printNormal per line, end — nothing fiscal', () => {
    const xml = nonFiscalXml([{ text: 'Panificio Prova', style: 'bold' }, { text: '', style: 'normal' }, { text: 'Riga & <prova> "x"', style: 'normal' }]);
    expect(xml).toContain('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">');
    expect(xml).toMatch(/<printerNonFiscal>\n<beginNonFiscal operator="1" \/>\n/);
    expect(xml).toContain('<printNormal operator="1" font="2" data="Panificio Prova" />');
    expect(xml).toContain('<printNormal operator="1" font="1" data=" " />');
    expect(xml).toContain('data="Riga &amp; &lt;prova&gt; &quot;x&quot;"');
    expect(xml).toMatch(/<endNonFiscal operator="1" \/>\n<\/printerNonFiscal>/);
    expect(xml).not.toMatch(/printerFiscalReceipt|printRecItem|printRecTotal|printerFiscalReport/);
  });

  it('wraps a long line at the paper\'s width, on spaces', () => {
    const lines = wrapLines([{ text: 'Torta di compleanno con scritta «Auguri Sofia» e candeline colorate', style: 'normal' }]);
    expect(lines.every(l => l.text.length <= COLUMNS)).toBe(true);
    expect(lines.map(l => l.text).join(' ')).toBe('Torta di compleanno con scritta «Auguri Sofia» e candeline colorate');
    expect(wrapLines([{ text: 'x'.repeat(100), style: 'bold' }]).map(l => l.text.length)).toEqual([42, 42, 16]);
  });

  it('⚠️ keeps the spaces that put a price against the right edge, and sends the money\'s no-break space as a plain one', () => {
    const xml = nonFiscalXml([{ text: `Totale${' '.repeat(29)}42,50\u00a0€`, style: 'normal' }]);
    expect(xml).toContain(`data="Totale${' '.repeat(29)}42,50 €"`);
    expect(nonFiscalXml([{ text: '3,50\u00a0€', style: 'normal' }], { plain: true })).toContain('data="3,50 EUR"');
  });

  it('drops the control characters a pasted note can carry, which XML does not allow', () => {
    expect(nonFiscalXml([{ text: 'Torta\u0007 al\u001b cioccolato', style: 'normal' }])).toContain('data="Torta al cioccolato"');
  });

  it('writes plain letters when asked, for a printer that prints accents and € wrong', () => {
    expect(plainText('Città, perché, più — 3,50 € «Sì»')).toBe('Citta\', perche\', piu\' - 3,50 EUR "Si\'"');
    expect(plainText('£3.50 Façade Niño Straße')).toBe('GBP3.50 Facade Nino Strasse');
    const xml = nonFiscalXml([{ text: 'Caffè 1,20 €', style: 'normal' }], { plain: true });
    expect(xml).toContain('data="Caffe&apos; 1,20 EUR"');
  });

  it('a double-size line (bookings rebuild step 4) is font 4 and wraps at half the width', () => {
    const xml = nonFiscalXml([{ text: 'senza cipolla e senza acciughe', style: 'big' }]);
    expect(xml).toContain('<printNormal operator="1" font="4" data="senza cipolla e senza" />');
    expect(xml).toContain('<printNormal operator="1" font="4" data="acciughe" />');
    expect(BIG_COLUMNS).toBe(COLUMNS / 2);
    expect(plainText('2 × Scacciata')).toBe('2 x Scacciata');
  });

  it('the test page shows bold, double size, accents and €, and a ruler of the full width', () => {
    const page = testPage({ title: 'MISE', bold: 'Bold', big: 'Big', accents: 'àè €', when: 'now' });
    expect(page.find(l => l.style === 'bold' && l.text === 'Bold')).toBeTruthy();
    // Font 4, which both slips use since bookings rebuild step 4: tried on the test print first.
    expect(page.find(l => l.style === 'big' && l.text === 'Big')).toBeTruthy();
    expect(page.some(l => l.text === 'àè €')).toBe(true);
    expect(page.some(l => l.text.length === COLUMNS && /^\d+$/.test(l.text))).toBe(true);
  });
});

describe('sending it', () => {
  const setting = { host: '192.168.1.50', plain: false };
  const answer = (body: string) => vi.fn(async () => new Response(body));

  it('posts to the printer over https and reads its answer', async () => {
    const fetchImpl = answer('<response success="true" code="" status="2"></response>');
    expect(await sendToPrinter(setting, [{ text: 'x', style: 'normal' }], fetchImpl)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(printerUrl('192.168.1.50'));
    expect(url).toMatch(/^https:\/\/192\.168\.1\.50\/cgi-bin\/fpmate\.cgi\?/);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('a printer that says no, with its code', async () => {
    expect(await sendToPrinter(setting, [], answer('<response success="false" code="PRINTER ERROR" status="0" />'))).toEqual({ ok: false, kind: 'refused', code: '' });
    expect(await sendToPrinter(setting, [], answer('<response success="false" code="EPTR_REC_EMPTY" status="0" />'))).toEqual({ ok: false, kind: 'refused', code: 'EPTR_REC_EMPTY' });
    expect(readAnswer('garbage')).toEqual({ ok: false, kind: 'refused', code: '' });
  });

  it('a printer that cannot be reached, or does not answer in time, or none set', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refused = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await sendToPrinter(setting, [], refused)).toEqual({ ok: false, kind: 'unreachable' });
    const never = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
    }));
    expect(await sendToPrinter(setting, [], never as unknown as typeof fetch, 10)).toEqual({ ok: false, kind: 'timeout' });
    expect(await sendToPrinter(null, [], refused)).toEqual({ ok: false, kind: 'no-printer' });
  });
});
