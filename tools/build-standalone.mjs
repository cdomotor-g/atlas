#!/usr/bin/env node
// Writes one self-contained HTML file — the page, its CSS and script, data/map.json and
// every logo inlined — for opening offline or sharing as a single file:
//   node tools/build-standalone.mjs [out.html]      (default dist/atlas.html)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { ROOT } from './lib.mjs';

const out = process.argv[2] || join(ROOT, 'dist/atlas.html');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const dataUri = p => `data:${mime[extname(p)]};base64,${readFileSync(join(ROOT, p)).toString('base64')}`;

const map = JSON.parse(read('data/map.json'));
for (const r of map.repos) if (r.logo) r.logo = dataUri(r.logo);
const atlasLogo = dataUri('assets/logos/atlas.svg');

let html = read('index.html')
  .replace('<link rel="stylesheet" href="assets/atlas.css">', () => `<style>\n${read('assets/atlas.css')}\n</style>`)
  .replace('<script src="assets/atlas.js"></script>', () => `<script>window.ATLAS_DATA = ${JSON.stringify(map).replace(/</g, '\\u003c')};</script>\n<script>\n${read('assets/atlas.js')}\n</script>`)
  .replaceAll('assets/logos/atlas.svg', atlasLogo);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${Math.round(html.length / 1024)} KB)`);
