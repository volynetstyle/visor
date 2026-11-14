import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: '../app/src/main/assets/www',
    emptyOutDir: true,
    target: 'es2022',
  },
});
