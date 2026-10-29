// imageLabelData.ts — what the «with logo» image label reads from the venue's data, checked: which model the venue
// prints with and whether it is turned round (two keys of config/labels), and the logo (label-assets/logo). NEW IN
// MISE 2 (no original in js/).
//
// ⚠️ NOT IN normalizeLabelProfile. That normaliser is a byte-for-byte port of the current app's (label-template-model),
// and the current app has no image label; config/labels is a free Record in the store, so the two keys are read here.

import { CANVAS_H, LOGO_W } from '@mise/shared/label-image-layout';

export type LabelTemplate = 'standard' | 'logo';
export const LABEL_TEMPLATES: readonly LabelTemplate[] = ['standard', 'logo'];

export interface ImageLabelChoice {
  readonly template: LabelTemplate;
  // ^POI (turned round) or ^PON.
  readonly rotate180: boolean;
}

// ⚠️ ONLY THE TWO KNOWN WORDS COUNT, and anything else is the standard label: a model the app does not know would draw
// nothing. ⚠️ TURNED ROUND UNLESS SOMEBODY SAID OTHERWISE (`rotate180 !== false`): the owner's script prints ^POI because
// his printer's driver does, so the paper comes out as it does today until he says it should not.
export function imageLabelChoice(labelConfig: Readonly<Record<string, unknown>> | null | undefined): ImageLabelChoice {
  const template = labelConfig?.template === 'logo' ? 'logo' : 'standard';
  return { template, rotate180: labelConfig?.rotate180 !== false };
}

// The logo as label-assets/logo holds it: a PNG as a data address, already reduced to the width the label draws it at
// (LOGO_W canvas pixels, 330 dots), with its height.
export interface LabelLogo {
  readonly png: string;
  readonly width: number;
  readonly height: number;
}

// The rules' own bounds, repeated so a logo the database would refuse is never sent.
export const LOGO_PNG_MAX = 400000;
export const LOGO_PNG_PREFIX = 'data:image/png;base64,';

// A stored logo, or null for none — and for anything the rules would not have let in (a document written by hand, an
// older shape): a label drawn with half a logo is worse than a label that says the logo is missing.
export function asLabelLogo(data: unknown): LabelLogo | null {
  if (!data || typeof data !== 'object') return null;
  const held = data as Record<string, unknown>;
  const { png, width, height } = held;
  if (typeof png !== 'string' || !png.startsWith(LOGO_PNG_PREFIX) || png.length > LOGO_PNG_MAX) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(png.slice(LOGO_PNG_PREFIX.length))) return null;
  if (width !== LOGO_W) return null;
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > CANVAS_H) return null;
  return { png, width, height };
}
