import type { IngredientRowText, NeedTab, SemiTable } from './needModel';

// Every word the sheet carries, read by the caller BEFORE the sheet is handed to the print host: the host is its own React root,
// outside the app's tree, so it has no language of its own (and the sheet must come out in the language of the screen it was
// printed from).
export interface NeedSheetWords {
  title: string;
  colSemi: string;
  colReady: string;
  colLoss: string;
  colPrepare: string;
  colIngredient: string;
  colAmount: string;
  total: string;
  // The line under the table: what «Ready» and «To prepare» mean, or what the ingredient list is.
  foot: string;
  // «Added up over every tier», only for a cake with more than one.
  allTiers: string | null;
  // «Not opened: …», only on the ingredient list and only when there is something not opened.
  notOpened: string | null;
}

type Props = {
  tab: NeedTab;
  semi: SemiTable;
  ingredients: readonly IngredientRowText[];
  words: NeedSheetWords;
};

// The sheet the lab prints: the title, the table the person was looking at, and its footnotes. Plain classes from need-print.css (a
// global stylesheet), never tokens.
export function NeedPrintSheet({ tab, semi, ingredients, words }: Props) {
  return (
    <div className="need-sheet">
      <h1>{words.title}</h1>
      {tab === 'semi' ? (
        <table>
          <thead>
            <tr>
              <th>{words.colSemi}</th>
              <th className="need-r">{words.colReady}</th>
              <th className="need-r">{words.colLoss}</th>
              <th className="need-r">{words.colPrepare}</th>
            </tr>
          </thead>
          <tbody>
            {semi.rows.map(row => (
              <tr key={row.key}>
                <td><b>{row.name}</b></td>
                <td className="need-r">{row.ready}</td>
                <td className="need-r">{row.loss}</td>
                <td className="need-r"><b>{row.prepare}</b></td>
              </tr>
            ))}
            <tr className="need-total">
              <td>{words.total}</td>
              <td className="need-r">{semi.totalReady}</td>
              <td />
              <td className="need-r">{semi.totalPrepare}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{words.colIngredient}</th>
              <th className="need-r">{words.colAmount}</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map(row => (
              <tr key={row.key}>
                <td><b>{row.name}</b><small>{row.from}</small></td>
                <td className="need-r"><b>{row.amount}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {words.allTiers === null ? null : <p>{words.allTiers}</p>}
      {words.notOpened === null ? null : <p>{words.notOpened}</p>}
      <p>{words.foot}</p>
    </div>
  );
}
