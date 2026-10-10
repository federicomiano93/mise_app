import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // *.spec.ts, never *.test.*: the CURRENT app's suite is `node --test` at the repo root,
    // which discovers *.test.* files anywhere (TypeScript ones too on recent Node) and would
    // try to run these. tests/mise2-isolation.test.mjs pins it.
    include: ['src/**/*.spec.ts'],
  },
});
