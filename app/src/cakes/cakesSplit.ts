// The width from which Cakes is a SPLIT (the list on the left, the chosen cake or the reference grams on the right) instead of one
// level at a time. 1280px, not Food cost's 1000: a cake's editor is two columns of its own (the parts and a 380px side), which need
// room — so the lab tablet held sideways (1024) and a phone get one level at a time, with Back in the bar.
//
// ⚠️ THE STYLESHEET SAYS THE SAME NUMBER IN ITS OWN MEDIA QUERY (a media query cannot read a constant): cakesSplit.spec.ts fails
// when CakesSection.module.css stops agreeing.
export const CAKES_SPLIT_QUERY = '(min-width: 1280px)';
