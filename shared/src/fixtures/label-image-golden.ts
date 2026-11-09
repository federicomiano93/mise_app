// The golden file of the image label, recorded from the owner's genera_etichetta.py on a FAKE corpus by
// algprobe/label-golden/harness.py (outside the repository). Read by the image label's specs.

import goldenText from './label-image-golden.json?raw';
import type { LabelFont } from '../label-image-layout';
import type { CheckIssue } from '../label-text-check';

export interface GoldenText { x: number; y: number; text: string; font: LabelFont; px: number }
export interface GoldenProduct {
  id: string;
  title: string;
  ingredients: string;
  // The script's defects this product shows on purpose ('a' bold, 'b' malto, 'c' ORZO elsewhere).
  defects: string[];
  check: { errors: CheckIssue[]; warnings: CheckIssue[] };
  layout: { lines: number; endY: number; tooLong: boolean; texts: GoldenText[] };
  widths: Record<string, number>;
  zplHead: string;
}
export interface Golden { header: [string, string]; logo: { width: number; height: number }; products: GoldenProduct[] }

export const golden: Golden = JSON.parse(goldenText) as Golden;
