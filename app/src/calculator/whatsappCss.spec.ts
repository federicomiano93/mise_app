import { describe, expect, it } from 'vitest';
import css from './WhatsappEditor.module.css?raw';

// What the stylesheet of the WhatsApp lists editor decides and jsdom cannot see (it applies no layout).
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const bodies: string[] = [];
  for (const [, selectors = '', body = ''] of withoutComments(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').map(s => s.trim()).includes(selector)) bodies.push(body);
  }
  if (bodies.length === 0) throw new Error(`${selector} not found`);
  return bodies.join(';');
}

const declaration = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

describe('the targets of the WhatsApp lists editor', () => {
  it.each([
    ['a card that opens something', '.open', 'min-height'],
    ['the delete / remove icon', '.del', 'min-height'],
    ['the delete / remove icon (width)', '.del', 'width'],
    ['a product the picker offers', '.pick', 'min-height'],
    ['the name box', '.input', 'min-height'],
    ['the prefill window box', '.select', 'min-height'],
  ])('%s is at least 48px', (_name, selector, property) => {
    expect(declaration(rule(selector), property)).toBe('var(--hit)');
  });

  it('the fields are 18px or more: a smaller field makes iOS zoom the page in', () => {
    expect(declaration(rule('.input'), 'font')).toContain('var(--fs-lg)');
    expect(declaration(rule('.select'), 'font')).toContain('var(--fs-lg)');
  });

  it('a name that cannot be left blank is marked in the danger colour (and by aria-invalid, not by colour alone)', () => {
    expect(declaration(rule('.invalid'), 'border-color')).toBe('var(--danger)');
  });

  it('nothing clips, so the bar above keeps sticking', () => {
    expect(css).not.toMatch(/overflow\s*:\s*(hidden|auto|scroll)/);
  });
});
