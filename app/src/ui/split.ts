// The width from which a section is a SPLIT (a list on the left, the chosen item on the right)
// instead of one pane at a time. 1000px because the lab tablet (SM-T550) is 1024px wide held
// sideways; held upright (768px) it gets the phone's layout. Pastries (the days) and the Stocktake
// (the products) are split this way, and the sections after them will be.
//
// ⚠️ THE STYLESHEETS SAY THE SAME NUMBER IN THEIR OWN MEDIA QUERIES (a media query cannot read a
// constant), and split.spec.ts fails if they stop agreeing. This one only feeds the attributes
// that must match the layout, such as the days' aria-orientation, and the choice between pushing an
// address and replacing it.
export const SPLIT_QUERY = '(min-width: 1000px)';
