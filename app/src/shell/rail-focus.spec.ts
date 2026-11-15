import { describe, expect, it } from 'vitest';
import shellCss from './AppShell.module.css?raw';
import tokensCss from '../styles/tokens.css?raw';

// A focus indicator needs 3:1 against what it sits on (WCAG 1.4.11). The default ring is the
// accent colour, which is about 2.8:1 on the dark rail, so the rail's items use the light ink.
// jsdom cannot draw a ring, so this checks the two things that can silently regress: the rule
// is there, and the colours the tokens give it really do clear 3:1.

type Oklch = { l: number; c: number; h: number };

function token(name: string): Oklch {
  const match = new RegExp(`${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`).exec(tokensCss);
  if (!match) throw new Error(`${name} is not an opaque oklch() token in tokens.css`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

// OKLCH → linear sRGB (Björn Ottosson's matrices) → WCAG relative luminance.
function luminance({ l, c, h }: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const r = clamp(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
  const g = clamp(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
  const bl = clamp(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(first: Oklch, second: Oklch): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('the focus ring on the rail', () => {
  it('measures contrast the way WCAG does', () => {
    expect(contrast({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 })).toBeCloseTo(21, 0);
    expect(contrast({ l: 0.5, c: 0, h: 0 }, { l: 0.5, c: 0, h: 0 })).toBeCloseTo(1, 5);
  });

  it('is the light ink, set on the rail items', () => {
    expect(shellCss).toMatch(/\.railItem:focus-visible\s*\{[^}]*outline-color:\s*var\(--rail-ink-strong\)/);
  });

  it('clears 3:1 against the rail it sits on', () => {
    expect(contrast(token('--rail-ink-strong'), token('--rail'))).toBeGreaterThanOrEqual(3);
  });
});
