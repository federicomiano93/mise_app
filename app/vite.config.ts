import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { miseVersion } from './build-version.ts';

// The address the app is served under is given at build time (`vite build --base=/mise2/`
// on the preview), so the same source serves the preview path today and /mise_app/ at the
// switch. Locally (`npm run dev`) it is the root.
export default defineConfig({
  plugins: [react()],
  // The release stamp the telemetry carries (src/telemetry/version.ts). Computed once, when the
  // config loads; Vitest reads this same file, so specs see the same constant.
  define: {
    __MISE2_VERSION__: JSON.stringify(miseVersion()),
  },
  resolve: {
    // One React for the app AND for anything it links from ../shared: two copies would
    // break hooks with no error at build time.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    // Explicit, not Vite's moving default: the SM-T550 runs Chrome 119 and iPhones must
    // work from Safari 16.4. Anything newer than these is rewritten at build time
    // (CSS nesting, for one, needs Chrome 120).
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    cssTarget: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    // Firestore's lazy chunk is ~554 KB by itself and expected (session/firebaseBackend.ts): the
    // default 500 KB warning would print on every build and hide a real one.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // The libraries in chunks of their own (step 2c). A release of Mise 2 changes its own
        // code far more often than React or Firebase: kept apart, a phone on 4G re-downloads the
        // ~67 KB that changed, not the whole megabyte, and the browser can keep the libraries'
        // compiled code. Firestore is not listed: it is loaded on first use
        // (session/firebaseBackend.ts) and Vite already gives it a chunk of its own.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](react-aria-components|react-aria|react-stately|@react-aria|@react-stately|@react-types|@internationalized|@swc)[\\/]/.test(id)) return 'react-aria';
          if (/[\\/]node_modules[\\/](react-router|@remix-run|cookie-es)[\\/]/.test(id)) return 'router';
          if (/[\\/]node_modules[\\/]@firebase[\\/](app|auth|component|logger|util)[\\/]|[\\/]node_modules[\\/]firebase[\\/](app|auth)[\\/]/.test(id)) return 'firebase-auth';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    // *.spec.*, never *.test.*: see shared/vitest.config.ts.
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['src/testing/setup.ts'],
    // Vitest replaces every CSS file with an empty string unless told otherwise — `?raw`
    // included — so src/css-modules.spec.ts would be handed empty text: its var(--x) check would
    // pass with nothing to look at, and only its class check and its «tokens.css is not empty»
    // guards would notice. It reads the files as `?raw` text, so those are processed.
    //
    // ⚠️ ONLY THOSE. Applied to a screen, the real stylesheets make jsdom honour the
    // phone-side `display: none` of the rail and the top bar (jsdom ignores the media query
    // that shows them), so the accessibility tree a spec queries would no longer contain the
    // rail. A module imported normally is a proxy that returns each class name, and the specs
    // see the same DOM at any width.
    css: { include: [/\.css\?raw$/] },
  },
});
