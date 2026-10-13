import { build } from 'esbuild';
import { mkdirSync, cpSync, existsSync } from 'node:fs';

mkdirSync('www/js', { recursive: true });
mkdirSync('www/css', { recursive: true });

await build({
  entryPoints: ['src-web/js/app.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'www/js/app.bundle.js',
  logLevel: 'info',
  sourcemap: false,
});

cpSync('src-web/index.html', 'www/index.html');
cpSync('src-web/css/app.css', 'www/css/app.css');
console.log('web assets built ->', existsSync('www/js/app.bundle.js') ? 'OK' : 'FAILED');
