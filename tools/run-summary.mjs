#!/usr/bin/env node
// Copies the run summary in docs/run-summary.md into agent instruction files, so every
// repository ends a run with the same report:
//   node tools/run-summary.mjs <file>...           write it into each file
//   node tools/run-summary.mjs --check <file>...   list the files whose copy differs (exit 1 if any)
// In each file it replaces what is between the run-summary markers; failing that, an older
// "## Run summary" section (up to the next "## " heading outside a code block); failing that,
// it adds the block at the end.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';

export const START = '<!-- run-summary:start';
export const END = '<!-- run-summary:end -->';

/** The block, markers included, as docs/run-summary.md has it. */
export function canonical() {
  const doc = readFileSync(join(ROOT, 'docs/run-summary.md'), 'utf8');
  const a = doc.indexOf(START), b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error('docs/run-summary.md: the run-summary markers are missing');
  return doc.slice(a, b + END.length);
}

/** Where a file's copy sits: { a, b, marked } or null when it has none. */
export function locate(text) {
  const a = text.indexOf(START), b = text.indexOf(END);
  if (a >= 0 && b > a) return { a, b: b + END.length, marked: true };
  let pos = 0, start = -1, fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && line.startsWith('## ')) {
      if (start >= 0) return { a: start, b: pos, marked: false };
      if (/^## Run summary\b/i.test(line)) start = pos;
    }
    pos += line.length + 1;
  }
  return start >= 0 ? { a: start, b: text.length, marked: false } : null;
}

/** The file's text with its copy brought into line with `block`. */
export function apply(text, block) {
  const at = locate(text);
  if (!at) return text.replace(/\s*$/, '\n\n') + block + '\n';
  const rest = text.slice(at.b);
  if (at.marked) return text.slice(0, at.a) + block + rest;
  return text.slice(0, at.a) + block + (rest ? '\n\n' + rest : '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const files = args.filter(f => f !== '--check');
  if (!files.length) { console.error('usage: node tools/run-summary.mjs [--check] <CLAUDE.md or AGENTS.md>...'); process.exit(2); }
  const block = canonical();
  let off = 0;
  for (const f of files) {
    if (!existsSync(f)) { console.log(`- ${f}: no such file, skipped`); continue; }
    const text = readFileSync(f, 'utf8');
    const next = apply(text, block);
    if (next === text) { console.log(`✓ ${f}`); continue; }
    off++;
    if (check) { console.log(`✗ ${f}: ${locate(text) ? 'differs' : 'has no run summary'}`); continue; }
    writeFileSync(f, next);
    console.log(`→ ${f}: written`);
  }
  if (check && off) process.exit(1);
}
