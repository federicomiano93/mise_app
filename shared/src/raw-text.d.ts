// Vite's `?raw` import, for the specs that pin the spelling of something in a file of the current app
// (js/*.js, firestore.rules) as source text. shared/ has no Node types, so `readFileSync` is not available.
declare module '*?raw' {
  const text: string;
  export default text;
}
