#!/usr/bin/env node
// The Atlas's own checks — about a second, no dependencies, no network:
//   node test/check.mjs
// registry entries are complete and their logos exist; every fallback file is a valid
// atlas.json; the page's scripts parse; map.json (when present) only names known ids and
// gives every link its own id.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, validate, crossCheck, parseTitle, watchMatches, blockerMark, linkFor } from '../tools/lib.mjs';

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const json = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const reg = json('data/registry.json');
const ids = new Set(reg.repos.map(r => r.id));
const groups = new Set(reg.groups.map(g => g.id));
check(ids.size === reg.repos.length, 'registry: duplicate id');
for (const r of reg.repos) {
  check(/^[a-z0-9][a-z0-9-]*$/.test(r.id), `registry ${r.id}: bad id`);
  check(/^[\w.-]+\/[\w.-]+$/.test(r.repo), `registry ${r.id}: bad repo`);
  check(groups.has(r.group), `registry ${r.id}: unknown group ${r.group}`);
  check(Number.isFinite(r.x) && Number.isFinite(r.y), `registry ${r.id}: x/y missing`);
  // The upright arrangement is all or nothing: one repository without it and phones
  // fall back to the wide map.
  if (reg.repos.some(x => 'tall' in x)) check(Array.isArray(r.tall) && r.tall.length === 2 && r.tall.every(Number.isFinite), `registry ${r.id}: tall [x, y] missing`);
  check(r.logo && existsSync(join(ROOT, r.logo)), `registry ${r.id}: logo ${r.logo} missing`);
}

for (const f of existsSync(join(ROOT, 'data/fallback')) ? readdirSync(join(ROOT, 'data/fallback')) : []) {
  if (!f.endsWith('.json')) continue;
  const m = json(`data/fallback/${f}`);
  const errs = [...validate(m), ...crossCheck(m, ids)];
  check(!errs.length, `fallback ${f}: ${errs.join('; ')}`);
  check(m.id === f.replace(/\.json$/, ''), `fallback ${f}: id is ${m.id}`);
  check(ids.has(m.id), `fallback ${f}: ${m.id} is not in the registry`);
}

for (const f of ['assets/atlas.js', 'tools/lib.mjs', 'tools/collect.mjs', 'tools/drift.mjs', 'tools/build-standalone.mjs']) {
  try { execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' }); }
  catch (e) { fails.push(`${f}: ${e.stderr.toString().split('\n').slice(0, 4).join(' ')}`); }
}
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const [, src] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) check(existsSync(join(ROOT, src)), `index.html: ${src} missing`);

if (existsSync(join(ROOT, 'data/map.json'))) {
  const map = json('data/map.json');
  for (const l of map.links) check(ids.has(l.from) && ids.has(l.to), `map.json: link ${l.id} names an unknown repo`);
  // Each link's id is `<consumer>:<entry id>`, so the page finds the right one. A map.json
  // written before links carried `entry` has only entry ids, which repeat: the next collect
  // rewrites it (and the page makes the same ids from it meanwhile).
  if (map.links.every(l => 'entry' in l)) {
    const seen = new Set();
    for (const l of map.links) {
      check(l.id === `${l.to}:${l.entry}`, `map.json: link ${l.id} should be ${l.to}:${l.entry}`);
      check(!seen.has(l.id), `map.json: link id ${l.id} is used twice`);
      seen.add(l.id);
    }
  }
}

// Two consumers with the same `consumes` entry id get links of their own.
const entry = { id: 'station-table', from: 'flood-net', what: 'x', how: 'copy' };
const [v3, v1] = [linkFor('quansheng-v3', entry, {}), linkFor('quansheng-v1', entry, {})];
check(v3.id === 'quansheng-v3:station-table' && v1.id === 'quansheng-v1:station-table', 'linkFor: id is <consumer>:<entry id>');
check(v3.entry === 'station-table' && v3.from === 'flood-net' && v3.to === 'quansheng-v3' && v3.what === 'x', 'linkFor: keeps the entry');

// The title parser and the watch matcher, on the cases that matter.
const t = parseTitle('[Sub-issue of #42] [Sonnet5/Med] Fix flaky login test');
check(t.structure === 'sub' && t.parent === 42 && t.model === 'Sonnet5' && t.effort === 'Med' && t.title === 'Fix flaky login test', 'parseTitle: sub-issue');
check(parseTitle('[Standalone] [Human] Confirm CORS').human === true, 'parseTitle: human');
{ const c = parseTitle('[Standalone] [Human] [Computer] Switch on the Azure provider'); check(c.human && c.computer && c.title === 'Switch on the Azure provider', 'parseTitle: computer'); }
check(parseTitle('[Human] Fit the capacitor').computer === false, 'parseTitle: human, not computer');
check(parseTitle('[Epic] Big thing').structure === 'epic', 'parseTitle: epic');
check(parseTitle('No tags here').title === 'No tags here', 'parseTitle: untagged');
check(watchMatches(['db/migrations/*ingest*'], 'db/migrations/0010_ingest_http.sql'), 'watch: glob');
check(!watchMatches(['db/migrations/*ingest*'], 'db/migrations/0011_other.sql'), 'watch: glob miss');
check(watchMatches(['agent/vendor/'], 'agent/vendor/meganet/SOURCE'), 'watch: directory');
check(watchMatches(['serial*.js'], 'serial-gps.js') && !watchMatches(['serial*.js'], 'docs/serial-gps.js'), 'watch: root glob');
check(blockerMark('Atlas blocker: rpi-alert/bench-first-run\n\n**Blocked:** …') === 'rpi-alert/bench-first-run', 'blockerMark: first line');
check(blockerMark('Some text\r\nAtlas blocker: Flood-Net/237\r\n') === 'flood-net/237', 'blockerMark: later line, CRLF, case');
check(blockerMark('See the Atlas blocker: rpi-alert/x in the notes') === null, 'blockerMark: only a line of its own');

if (fails.length) { console.error(`✗ ${fails.length} problem${fails.length === 1 ? '' : 's'}:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log(`✓ registry (${reg.repos.length}), fallbacks, scripts, page links, link ids, parsers, blocker tags`);
