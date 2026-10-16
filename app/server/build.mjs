// Собирает папку selfhost/: страницы (public/) и сервер одним файлом (server.mjs).
// Запуск: npm run selfhost:build
import { fileURLToPath } from 'node:url';
import { build as buildServer } from 'esbuild';
import { build as buildPages } from 'vite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await buildPages({ configFile: here('./vite.config.ts'), logLevel: 'warn' });
await buildServer({
  entryPoints: [here('./main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: here('../selfhost/server.mjs'),
  alias: { '@appdeploy/sdk': here('./sdk.ts') },
  // Необязательные ускорители библиотеки ws — без них всё работает.
  external: ['bufferutil', 'utf-8-validate'],
  // ws написан на CommonJS: даём ему require внутри ES-модуля.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log('Готово: selfhost/server.mjs и selfhost/public/');
