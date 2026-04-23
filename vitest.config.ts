import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/lib/**/*.test.ts', 'src/lib/**/*.test.ts'],
    reporters: ['default'],
  },
});
