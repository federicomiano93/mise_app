// The one place Settings reloads the page. A screen that changes what EVERY screen reads (the venue's language) cannot repaint them
// all — a reload is honest and takes a moment (the current app's language.js says the same). It is an object, not a bare function, so a
// spec can see the reload without the page going away: `vi.spyOn(pageReload, 'reload')`.
export const pageReload = {
  reload(): void {
    window.location.reload();
  },
};
