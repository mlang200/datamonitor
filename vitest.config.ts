import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: path.resolve(__dirname),
    include: [
      'server/**/*.test.ts',
      'client/**/*.test.ts',
      'client/**/*.test.tsx',
    ],
    environmentMatchGlobs: [
      ['client/**/*.test.tsx', 'jsdom'],
    ],
  },
});
