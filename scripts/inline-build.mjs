// Post-build step: inline the bundled JS and CSS into dist/index.html so the
// game also runs when the file is opened directly (file://), where browsers
// refuse to load external module scripts.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const assets = join(dist, 'assets');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

for (const file of readdirSync(assets)) {
  const code = readFileSync(join(assets, file), 'utf8');
  if (file.endsWith('.js')) {
    const tag = new RegExp(`<script[^>]*src="\\./assets/${file.replace('.', '\\.')}"[^>]*></script>`);
    // Escape any closing script tags inside the bundle.
    html = html.replace(tag, () => `<script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script>`);
  } else if (file.endsWith('.css')) {
    const tag = new RegExp(`<link[^>]*href="\\./assets/${file.replace('.', '\\.')}"[^>]*>`);
    html = html.replace(tag, () => `<style>${code}</style>`);
  }
}
writeFileSync(join(dist, 'index.html'), html);
console.log('Inlined assets into dist/index.html (' + (html.length / 1024).toFixed(0) + ' KB) - it can be opened directly from disk.');
