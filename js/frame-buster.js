// Frame-buster (clickjacking) for install-guide.html, whose CSP allows no inline script. GitHub Pages sends no
// X-Frame-Options and a <meta> frame-ancestors is ignored, so a page shown inside another site's iframe hides itself
// and tries to take over the whole window. A classic script, ES5, first in <head>. order.html, reset-password.html and
// Mise 2's index.html carry the same lines in their own early script (tests/frame-buster.test.mjs pins all four).
if (window.top !== window.self) {
  document.documentElement.style.visibility = 'hidden';
  try { window.top.location = window.self.location; } catch (e) {}
}
