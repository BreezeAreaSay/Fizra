import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Сборка для локальной проверки: вместо платформенного клиента — заглушка.
export default defineConfig({
    root: here('..'),
    base: './',
    resolve: { alias: { '@appdeploy/client': here('./client-mock.ts') } },
    build: { outDir: here('./.dist'), emptyOutDir: true },
});
