// The width from which Pastries is a SPLIT (the days as a list on the left, the chosen day on the
// right) instead of a strip of days above the day. 1000px because the lab tablet (SM-T550) is
// 1024px wide held sideways; held upright (768px) it gets the strip, like a phone.
//
// ⚠️ THE STYLESHEETS SAY THE SAME NUMBER IN THEIR OWN MEDIA QUERIES (a media query cannot read a
// constant), and split.spec.ts fails if they stop agreeing. This one only feeds the attributes
// that must match the layout, such as the days' aria-orientation.
export const SPLIT_QUERY = '(min-width: 1000px)';
