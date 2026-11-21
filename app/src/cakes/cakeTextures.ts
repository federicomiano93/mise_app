// cakeTextures.ts — the surfaces of the realistic cake, PAINTED ON A CANVAS (no image file, no data: URL, nothing from the network, so the
// content-security policy has nothing to say): a sponge with pores, a cream with spatula strokes and vanilla specks. Ported from the
// approved mockup (docs/mockups/cakes-rework/realistic-cake.html).
//
// ⚠️ Made ONCE per look and reused: every texture is cached under its key for as long as the scene lives, and `sweep()` frees the ones the
// last build did not ask for (a cake that changes look does not keep the old textures on the graphics card). Never more than 512 px.
// Like cake3dScene.ts, three arrives as an argument (threeParts.ts); only types are imported.

import type * as T from 'three';
import type { Three } from './cake3dScene';

// A repeatable random, so the same cake looks the same every time (and a rebuild does not make the pores jump).
export function rng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function spongePaint(base: string, seed: number): Paint {
  return (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // The pores (dark) and the crumb (light).
    for (let i = 0; i < 2600; i += 1) {
      g.fillStyle = `rgba(0,0,0,${String(0.1 + r() * 0.16)})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 0.8 + r() * 3.2, 0.6 + r() * 2.2, r() * 3, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 1400; i += 1) {
      g.fillStyle = `rgba(255,250,235,${String(0.08 + r() * 0.12)})`;
      g.beginPath();
      g.arc(r() * w, r() * h, 0.6 + r() * 1.8, 0, 7);
      g.fill();
    }
  };
}

function creamPaint(base: string, seed: number, specks: boolean, strokes: boolean): Paint {
  return (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i += 1) {
      g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${String(r() * 0.05)})` : `rgba(255,255,255,${String(r() * 0.07)})`;
      g.beginPath();
      g.arc(r() * w, r() * h, 1 + r() * 5, 0, 7);
      g.fill();
    }
    if (strokes) {
      // Spatula strokes.
      for (let i = 0; i < 70; i += 1) {
        const y = r() * h;
        const len = 80 + r() * 260;
        const x = r() * w;
        g.strokeStyle = r() < 0.5 ? `rgba(0,0,0,${String(0.012 + r() * 0.022)})` : `rgba(255,255,255,${String(0.05 + r() * 0.08)})`;
        g.lineWidth = 2 + r() * 6;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + len / 3, y + (r() - 0.5) * 14, x + (2 * len) / 3, y + (r() - 0.5) * 14, x + len, y + (r() - 0.5) * 8);
        g.stroke();
      }
    }
    if (specks) {
      // Vanilla.
      for (let i = 0; i < 180; i += 1) {
        g.fillStyle = 'rgba(40,25,15,0.55)';
        g.beginPath();
        g.arc(r() * w, r() * h, 0.5 + r() * 0.9, 0, 7);
        g.fill();
      }
    }
  };
}

// The colour map and the bump map of one surface (the same picture, read twice).
export interface SurfaceTextures { map: T.CanvasTexture; bump: T.CanvasTexture }

export interface CakeTextures {
  // A sponge (or a soaked sponge) of this colour; a cream; the coating's textured cream. `across` and `down` are how many times the picture
  // repeats over the surface (the side of a cylinder wants it to repeat around).
  sponge: (colour: string, across?: number, down?: number) => SurfaceTextures;
  cream: (colour: string, specks: boolean, across?: number, down?: number) => SurfaceTextures;
  coat: (colour: string, across?: number, down?: number) => SurfaceTextures;
  // Frees every texture the build that is ending did not ask for, then starts counting a new build.
  sweep: () => void;
  dispose: () => void;
}

export function createTextures(lib: Three): CakeTextures {
  const cache = new Map<string, { textures: SurfaceTextures; used: boolean }>();
  // One picture serves every repeat of it (the side of a layer and its top use the same sponge).
  const paintings = new Map<string, { canvas: HTMLCanvasElement; used: boolean }>();

  const painting = (key: string, width: number, height: number, paint: Paint): HTMLCanvasElement => {
    const found = paintings.get(key);
    if (found) { found.used = true; return found.canvas; }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context) paint(context, width, height);
    paintings.set(key, { canvas, used: true });
    return canvas;
  };

  const make = (key: string, width: number, height: number, across: number, down: number, paint: Paint): SurfaceTextures => {
    const id = `${key}|${String(across)}|${String(down)}`;
    const found = cache.get(id);
    if (found) { found.used = true; painting(key, width, height, paint); return found.textures; }
    const canvas = painting(key, width, height, paint);
    const map = new lib.CanvasTexture(canvas);
    map.colorSpace = lib.SRGBColorSpace;
    const bump = new lib.CanvasTexture(canvas);
    for (const texture of [map, bump]) {
      texture.wrapS = lib.RepeatWrapping;
      texture.wrapT = lib.RepeatWrapping;
      texture.repeat.set(across, down);
      texture.anisotropy = 8;
    }
    const textures = { map, bump };
    cache.set(id, { textures, used: true });
    return textures;
  };

  return {
    sponge: (colour, across = 1, down = 1) => make(`sponge|${colour}`, 512, 128, across, down, spongePaint(colour, 7)),
    cream: (colour, specks, across = 1, down = 1) => make(`cream|${colour}|${String(specks)}`, 512, 64, across, down, creamPaint(colour, 3, specks, false)),
    coat: (colour, across = 3, down = 2) => make(`coat|${colour}`, 512, 256, across, down, creamPaint(colour, 5, false, true)),
    sweep() {
      for (const [id, entry] of cache) {
        if (entry.used) { entry.used = false; continue; }
        entry.textures.map.dispose();
        entry.textures.bump.dispose();
        cache.delete(id);
      }
      for (const [key, entry] of paintings) {
        if (entry.used) entry.used = false;
        else paintings.delete(key);
      }
    },
    dispose() {
      for (const entry of cache.values()) { entry.textures.map.dispose(); entry.textures.bump.dispose(); }
      cache.clear();
      paintings.clear();
    },
  };
}
