#!/usr/bin/env node
// Points a repository at the shared instructions in this repository's shared/ folder, so every
// session in it loads the rules all of the owner's repositories share:
//   node tools/shared.mjs <repository folder>...           write them in
//   node tools/shared.mjs --check <repository folder>...   list the folders that differ (exit 1 if any)
// In each folder:
//   - CLAUDE.md, and AGENTS.md where there is one, get a short section between the shared
//     markers saying where the rules live. It replaces an earlier copy of that section, the
//     run-summary block this repository used to copy out, or an older "## Run summary"
//     section; failing those, it goes at the end.
//   - .claude/settings.json gets the start-up hooks (SessionStart) that download
//     shared/instructions.md, and shared/on-the-atlas.md where the folder has an atlas.json,
//     into every session. Its other settings are kept.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RAW = 'https://raw.githubusercontent.com/cdomotor-g/atlas/main/shared/';
export const PAGE = 'https://github.com/cdomotor-g/atlas/blob/main/shared/';
export const FILES = { all: 'instructions.md', atlas: 'on-the-atlas.md' };
export const LIMIT = 9500; // a hook's output past 10,000 characters reaches the agent only as a preview
export const START = '<!-- shared:start';
export const END = '<!-- shared:end -->';
const OLD_START = '<!-- run-summary:start', OLD_END = '<!-- run-summary:end -->';

/** The section CLAUDE.md and AGENTS.md carry, markers included. */
export function section(onAtlas) {
  const it = onAtlas ? 'them' : 'it';
  return [
    `${START} · written by tools/shared.mjs in cdomotor-g/atlas; the rules themselves live in its shared/ folder -->`,
    '## Shared instructions — loaded from the Atlas',
    `The rules every one of my repositories shares live in one file in the Atlas: how to end a run (the run summary), pushing to \`main\`, plain words, private data, who clears what, and issue titles — <${PAGE}${FILES.all}>.` +
      (onAtlas ? ` This repository is on the Atlas map, so <${PAGE}${FILES.atlas}> holds as well.` : ''),
    `\`.claude/settings.json\` loads ${it} when a session starts. If ${onAtlas ? 'they are' : 'it is'} not in front of you, fetch ${it} before you reply (\`curl -fsS ${RAW}${FILES.all}\`${onAtlas ? `, and the same for \`${FILES.atlas}\`` : ''}) and follow ${it}. Where this file says something different, this file wins.`,
    END,
  ].join('\n');
}

/** One start-up hook: print a shared file, or say where to read it when the download fails. */
export function hook(file) {
  const what = file === FILES.all ? 'the shared instructions' : 'the shared instructions for repositories on the Atlas';
  return {
    type: 'command',
    timeout: 20,
    command: `curl -fsS --max-time 15 ${RAW}${file} || echo 'Could not download ${what} when this session started. Before you reply, read ${PAGE}${file} and follow it.'`,
  };
}

/** settings.json text with the shared hooks in, last among the SessionStart groups; other settings kept. */
export function settings(text, onAtlas) {
  const s = text && text.trim() ? JSON.parse(text) : {};
  s.hooks = s.hooks || {};
  const groups = (s.hooks.SessionStart || [])
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !String(h.command || '').includes(RAW)) }))
    .filter(g => g.hooks.length);
  groups.push({ hooks: [hook(FILES.all), ...(onAtlas ? [hook(FILES.atlas)] : [])] });
  s.hooks.SessionStart = groups;
  return JSON.stringify(s, null, 2) + '\n';
}

// An older "## Run summary" section with no markers: up to the next "## " heading outside a code block.
function oldSection(text) {
  let pos = 0, start = -1, fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && line.startsWith('## ')) {
      if (start >= 0) return { a: start, b: pos };
      if (/^## Run summary\b/i.test(line)) start = pos;
    }
    pos += line.length + 1;
  }
  return start >= 0 ? { a: start, b: text.length } : null;
}

/** An instruction file's text with the shared section in. */
export function apply(text, block) {
  for (const [s, e] of [[START, END], [OLD_START, OLD_END]]) {
    const a = text.indexOf(s), b = text.indexOf(e);
    if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + e.length);
  }
  const old = oldSection(text);
  if (old) {
    const rest = text.slice(old.b);
    return text.slice(0, old.a) + block + (rest ? '\n\n' + rest : '\n');
  }
  return text.replace(/\s*$/, '\n\n') + block + '\n';
}

/** What the tool would write in a repository folder: [{ path, before, after }]. */
export function plan(dir) {
  const onAtlas = existsSync(join(dir, 'atlas.json'));
  const block = section(onAtlas);
  const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  const out = [];
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    const path = join(dir, f), before = read(path);
    if (before === null && f === 'AGENTS.md') continue;
    out.push({ path, before, after: before === null ? `# Instructions for Claude Code\n\n${block}\n` : apply(before, block) });
  }
  const path = join(dir, '.claude', 'settings.json'), before = read(path);
  out.push({ path, before, after: settings(before, onAtlas) });
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const dirs = args.filter(a => a !== '--check');
  if (!dirs.length) { console.error('usage: node tools/shared.mjs [--check] <repository folder>...'); process.exit(2); }
  let off = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) { console.log(`- ${dir}: no such folder, skipped`); continue; }
    const changed = plan(dir).filter(c => c.after !== c.before);
    if (!changed.length) { console.log(`✓ ${dir}`); continue; }
    off++;
    if (check) { console.log(`✗ ${dir}: ${changed.map(c => relative(dir, c.path)).join(', ')} differ`); continue; }
    for (const c of changed) {
      if (c.path.endsWith('settings.json')) mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(c.path, c.after);
    }
    console.log(`→ ${dir}: ${changed.map(c => relative(dir, c.path)).join(', ')} written`);
  }
  if (check && off) process.exit(1);
}
