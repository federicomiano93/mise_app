import { Fragment } from 'react';
import type { Ref } from 'react';
import { sheetModel } from '@mise/shared/label-sheet';
import './label-print.css';

// What a sheet is drawn from: a resolved label that could be laid out (the shared model's own type).
export type SheetSource = Parameters<typeof sheetModel>[0];

type Props = {
  resolved: SheetSource;
  // The size the text is drawn at, in millimetres: the fit loop redraws the same label a step smaller.
  fontMm?: number;
  ref?: Ref<HTMLDivElement>;
};

// The label as a piece of paper: exactly widthMm × heightMm, drawn from `sheetModel()`. The screen's preview and
// the host the printer receives are BOTH this component, at the same millimetre size, so they cannot disagree.
//
// ⚠️⚠️ ITS MARKUP IS THE CURRENT APP'S `buildSheet()`, BYTE FOR BYTE (LabelSheet.spec.tsx compares the two as
// outerHTML for the whole label corpus), and its class names are plain, unhashed globals: `lab-sheet`,
// `lab-sheet-block`, `lab-sheet-${role}`, `lab-sheet-ing`, `lab-sheet-ing--allergen`. label-print.css (imported
// here, for its side effect) styles them, and its @page rules and the `body > *:not(#labelPrint)` rule cannot
// work with a hashed name. No CSS module for this file, on purpose.
//
// ⚠️ NO STYLE ATTRIBUTE STRING AND NO <style> BLOCK — the page CSP is `style-src 'self'`. Every variable value
// (the paper, the margin, the font size, a block's scale and gap) goes through React's `style` prop, which sets
// it on the element through the CSSOM; everything fixed lives in label-print.css.
//
// ⚠️ THE SCALES AND THE GAPS COME FROM THE MODEL, never from the stylesheet: two copies of «the name is 1.35×»
// is two answers that can part, and the wrong one would be the printed one.
//
// ⚠️ THE PREVIEW SHOWS THE EMPHASIS THE PRINTER CAN ACTUALLY PRODUCE: on a printer with no bold inside a wrapped
// paragraph (a Zebra) the model emphasises by CAPITALS and sheetModel() marks no part as `allergen`, so there is
// no bold/underline class on the screen either.
export function LabelSheet({ resolved, fontMm, ref }: Props) {
  const sheet = sheetModel(resolved, fontMm ?? resolved.fontMm);
  const last = sheet.blocks.length - 1;
  return (
    <div
      ref={ref}
      className="lab-sheet"
      // ⚠️ Never machine-translated: the reason is on LabelCard.
      translate="no"
      style={{
        width: `${sheet.widthMm}mm`,
        height: `${sheet.heightMm}mm`,
        padding: `${sheet.paddingMm}mm`,
        fontSize: `${sheet.fontMm}mm`,
        lineHeight: String(sheet.lineHeight),
      }}
    >
      {sheet.blocks.map((block, index) => (
        <p
          key={index}
          className={`lab-sheet-block lab-sheet-${block.role}`}
          style={{
            fontSize: `${block.fontEm}em`,
            marginBottom: index < last ? `${block.gapEm}em` : '0',
          }}
        >
          {block.parts === null ? block.text : (
            <>
              {block.prefix}
              {block.parts.map((part, partIndex) => (
                <Fragment key={partIndex}>
                  {partIndex > 0 ? block.separator : null}
                  <span className={part.allergen ? 'lab-sheet-ing lab-sheet-ing--allergen' : 'lab-sheet-ing'}>{part.text}</span>
                </Fragment>
              ))}
              {block.closing}
            </>
          )}
        </p>
      ))}
    </div>
  );
}
