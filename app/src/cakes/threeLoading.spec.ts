// @vitest-environment node
//
// three.js is ~0.5 MB: it must load only when a cake editor shows the 3D view, never with the app. Pinned here:
// nothing in app/src imports it statically (the build then gives it a chunk of its own, which the worker leaves out
// of the precache: shell/worker.spec.ts).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// The specifiers that name the library or its addons.
const THREE = String.raw`['"]three(?:/[^'"]*)?['"]`;

describe('three.js stays out of the app’s own code', () => {
  it('⚠️ no file in app/src imports three statically (type-only imports are erased and fine)', () => {
    const files = sources(src);
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (new RegExp(String.raw`(?:^|\n)\s*(?:import(?!\s+type\b)|export(?!\s+type\b))\b[^;]*?\bfrom\s*${THREE}`).test(text)) offenders.push(file);
      if (new RegExp(String.raw`(?:^|\n)\s*import\s*${THREE}`).test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the guard itself catches a static import and lets a dynamic one and a type import through', () => {
    const flagged = (text: string) => new RegExp(String.raw`(?:^|\n)\s*(?:import(?!\s+type\b)|export(?!\s+type\b))\b[^;]*?\bfrom\s*${THREE}`).test(text)
      || new RegExp(String.raw`(?:^|\n)\s*import\s*${THREE}`).test(text);
    expect(flagged(`import * as THREE from 'three';`)).toBe(true);
    expect(flagged(`import { OrbitControls } from 'three/addons/controls/OrbitControls.js';`)).toBe(true);
    expect(flagged(`import 'three';`)).toBe(true);
    expect(flagged(`import {\n  Mesh,\n} from "three";`)).toBe(true);
    expect(flagged(`import type * as THREE from 'three';`)).toBe(false);
    expect(flagged(`const lib = await import('three');`)).toBe(false);
  });
});
