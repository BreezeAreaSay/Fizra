import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Сборка страниц для своего сервера: вместо платформенного клиента — server/client.ts.
export default defineConfig({
  root: here('..'),
  base: './',
  resolve: { alias: { '@appdeploy/client': here('./client.ts') } },
  build: { outDir: here('../selfhost/public'), emptyOutDir: true },
});
