#!/usr/bin/env node
// The Atlas's own checks — about a second, no dependencies, no network:
//   node test/check.mjs
// registry entries are complete and their logos exist; every fallback file is a valid
// atlas.json; the page's scripts parse; map.json (when present) only names known ids and
// gives every link its own id.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, validate, crossCheck, parseTitle, watchMatches, blockerMark, triageMark, linkFor } from '../tools/lib.mjs';
import { section, apply, settings, hook, FILES, RAW, LIMIT } from '../tools/shared.mjs';
import { brief, waiting, datesIn, startHere } from '../tools/brief.mjs';

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
  // How much it matters now, for the Priorities view: left out, the Atlas guesses.
  if ('weight' in r) check(Number.isInteger(r.weight) && r.weight >= 1 && r.weight <= 5, `registry ${r.id}: weight must be a whole number from 1 to 5`);
}
if ('triage' in reg) {
  const known = ['weights', 'yourHoursADay', 'agentsAtOnce', 'agentHoursADay', 'yourHour', 'agentHour', 'unknownPurchase'];
  for (const k of Object.keys(reg.triage)) check(known.includes(k), `registry triage: unknown setting ${k}`);
  for (const k of known.slice(1)) if (k in reg.triage) check(Number.isFinite(reg.triage[k]) && reg.triage[k] >= 0, `registry triage: ${k} must be a number`);
  for (const [k, v] of Object.entries(reg.triage.weights || {})) check(['importance', 'opportunity', 'urgency', 'cost'].includes(k) && Number.isFinite(v) && v >= 0, `registry triage: weights.${k}`);
}

for (const f of existsSync(join(ROOT, 'data/fallback')) ? readdirSync(join(ROOT, 'data/fallback')) : []) {
  if (!f.endsWith('.json')) continue;
  const m = json(`data/fallback/${f}`);
  const errs = [...validate(m), ...crossCheck(m, ids)];
  check(!errs.length, `fallback ${f}: ${errs.join('; ')}`);
  check(m.id === f.replace(/\.json$/, ''), `fallback ${f}: id is ${m.id}`);
  check(ids.has(m.id), `fallback ${f}: ${m.id} is not in the registry`);
}

for (const f of ['assets/atlas.js', 'assets/triage.js', 'tools/lib.mjs', 'tools/collect.mjs', 'tools/drift.mjs', 'tools/build-standalone.mjs', 'tools/shared.mjs', 'tools/brief.mjs', 'tools/usage/snapshot.js']) {
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

// The Priorities view's sums (assets/triage.js) and the line an issue says how it weighs with.
{
  const T = createRequire(import.meta.url)('../assets/triage.js');
  const tri = triageMark('Recommended: Sonnet5 / Med\nAtlas triage: severity 4 · opens 2 · due 2026-11-25 · effort 2h · cost $1,200\n\nBody');
  check(JSON.stringify(tri) === JSON.stringify({ severity: 4, opportunity: 2, due: '2026-11-25', effort: '2h', cost: 1200 }), `triageMark: every part, got ${JSON.stringify(tri)}`);
  check(JSON.stringify(triageMark('**Atlas triage:** cost A$40, severity 5')) === JSON.stringify({ cost: 40, severity: 5 }), 'triageMark: bold, commas, any order');
  check(triageMark('No line here') === null && triageMark('Atlas triage: whatever') === null, 'triageMark: nothing to read');
  const s = T.settings({ yourHour: 80, weights: { cost: 0 } }, { agentsAtOnce: 3.4, yourHoursADay: 'x' });
  check(s.yourHour === 80 && s.weights.cost === 0 && s.weights.importance === 2 && s.agentsAtOnce === 3 && s.yourHoursADay === 1, 'triage: settings layer on the defaults');
  check(T.deadlineIn('credits run short before 25 Nov; stuck on the 23 July 2026 extract', '2026-11-08') === '2026-11-25', 'triage: a deadline is a date still to come');
  check(T.severityGuess({ text: 'Stop dropping ALERT2 self-reports' }).v === 4 && T.severityGuess({ text: 'Maybe: carrier outages' }).v === 2
    && T.severityGuess({ text: 'Finish the privacy clean-up' }).v === 5 && T.severityGuess({ text: 'Place a field photo' }).v === 3
    && T.severityGuess({ text: 'Maybe', labels: ['bug'] }).v === 4 && T.severityGuess({ source: 'ci' }).v === 4, 'triage: severity from labels, then words');
  check(T.repoGuess({ phase: 'live', relyOn: 5, cited: 7 }).v === 5 && T.repoGuess({ phase: 'maintenance', relyOn: 0, cited: 0 }).v === 1 && T.repoGuess({ phase: 'beta', relyOn: 1, cited: 2 }).v === 4, 'triage: repository weight guess');
  check(T.moneyIn('Creator for a month (US$22, 121,000 credits)').amount === 22 && T.moneyIn('A$566 inc GST or A$182').amount === 566 && T.moneyIn('about US$5 a month').monthly && !T.moneyIn('40,000 credits'), 'triage: money in words');
  check(T.minutesOf('2h') === 120 && T.minutesOf('1–2 hours') === 90 && T.minutesOf('3 days') === 1440 && T.minutesOf('an afternoon') === 240, 'triage: sizes in words');
  const you = T.costOf({ hours: 0.5, who: 'human' }), bot = T.costOf({ hours: 3, who: 'agent' }), pc = T.costOf({ hours: 1, who: 'computer', money: 10 });
  check(you.yourHours === 0.5 && you.agentHours === 0 && you.total === 30 && bot.yourHours === 0.25 && bot.total === 30 && pc.yourHours === 0.5 && pc.total === 45, 'triage: cost of your time, agent time and money');
  // The repository and how bad multiply: bad where it matters little ranks below smaller where it matters most.
  const lowRepoBad = T.scoreOf({ repo: 1, severity: 5 }), topRepoSmall = T.scoreOf({ repo: 5, severity: 2 });
  check(lowRepoBad.worth < topRepoSmall.worth && T.scoreOf({ repo: 5, severity: 5, opportunity: 5, urgency: 5 }).worth === 100, 'triage: importance is 0–100, repository times how bad');
  check(T.scoreOf({ repo: 4, severity: 4, cost: 5 }).best > T.scoreOf({ repo: 4, severity: 4, cost: 500 }).best
    && T.scoreOf({ repo: 4, severity: 4, cost: 5 }, T.settings({ weights: { cost: 0 } })).best === T.scoreOf({ repo: 4, severity: 4, cost: 500 }, T.settings({ weights: { cost: 0 } })).best, 'triage: best next weighs cost, unless cost counts 0');
  check(T.urgencyOf({ due: '2026-11-10', today: '2026-11-08', planned: 'now' }).v === 5 && T.urgencyOf({ today: '2026-11-08', waited: 40 }).v === 1 && T.opportunityOf(5, 1) === 5, 'triage: how soon, what it opens up');
  const a = { who: 'human', yourHours: 2 }, b = { who: 'agent', agentHours: 6, after: [a] }, c = { who: 'agent', agentHours: 3 }, d = { who: 'computer', yourHours: 1 };
  T.schedule([b, a, c, d], T.DEFAULTS);
  check(a.start === 0 && a.finish === 2 && b.start === 2 && b.finish === 3 && c.start === 0 && c.finish === 0.5 && d.start === 2 && d.finish === 3, 'triage: the plan in time — yours one after another, agents side by side, waiting first');
  check(T.ticks(37).join() === '0,10,20,30,40' && T.triageLine({ severity: 4, due: '2026-11-25', hours: 0.25, money: 40 }) === 'Atlas triage: severity 4 · due 2026-11-25 · effort 15 min · cost $40', 'triage: axis steps, the line written back');
  check(JSON.stringify(triageMark(T.triageLine({ severity: 2, opportunity: 0, due: '2027-01-02', hours: 3, money: 5 }))) === JSON.stringify({ severity: 2, opportunity: 0, due: '2027-01-02', effort: '3h', cost: 5 }), 'triage: the page writes the line the collector reads');
}

// The shared instructions every session in every repository loads (shared/, tools/shared.mjs):
// each file fits what a start-up hook can hand the agent, the Atlas's own files point at them
// as the tool writes it, and the tool replaces the old run-summary copies in place, once, and
// keeps a repository's other settings.
{
  for (const f of Object.values(FILES)) {
    const t = existsSync(join(ROOT, 'shared', f)) ? readFileSync(join(ROOT, 'shared', f), 'utf8') : '';
    check(t.length > 500 && t.length < LIMIT, `shared/${f}: ${t.length} characters; it must be under ${LIMIT} (a start-up hook's output past 10,000 reaches the agent only as a preview)`);
  }
  const all = readFileSync(join(ROOT, 'shared', FILES.all), 'utf8');
  check(all.includes('# 🏁 THIS RUN SUMMARY (Run N)') && all.includes('**You asked:**'), 'shared/instructions.md: the run summary is in it');
  const block = section(false), atlasBlock = section(true);
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    check(apply(text, block) === text, `${f}: its shared section differs from what node tools/shared.mjs . writes`);
  }
  const own = existsSync(join(ROOT, '.claude/settings.json')) ? readFileSync(join(ROOT, '.claude/settings.json'), 'utf8') : '';
  check(own && settings(own, false) === own, '.claude/settings.json: not what node tools/shared.mjs . writes');
  check(atlasBlock.includes(FILES.atlas) && !block.includes(FILES.atlas), 'shared: only a repository on the Atlas is pointed at on-the-atlas.md');
  check(hook(FILES.all).command.startsWith(`curl -fsS --max-time 15 ${RAW}instructions.md || echo '`) && !hook(FILES.all).command.slice(hook(FILES.all).command.indexOf("echo '") + 6, -1).includes("'"), 'shared: the hook command quotes cleanly');
  const marked = '# X\n\nintro\n\n<!-- run-summary:start · old -->\n## Run summary\n- old\n<!-- run-summary:end -->\n\n## Next\nkept\n';
  const once = apply(marked, block);
  check(once === `# X\n\nintro\n\n${block}\n\n## Next\nkept\n` && apply(once, block) === once, 'shared: replaces the old run-summary block in place, once');
  const old = '# X\n\n## Run summary — mark where it starts\n- old\n  ```\n  ## not a heading\n  ```\n\n## Next\nkept\n';
  check(apply(old, block) === `# X\n\n${block}\n\n## Next\nkept\n`, 'shared: replaces an older run-summary section');
  check(apply('# X\n', block) === `# X\n\n${block}\n`, 'shared: adds the section to a file without one');
  check(apply(apply(marked, block), atlasBlock) === apply(marked, atlasBlock), 'shared: rewrites its own section');
  const theirs = JSON.stringify({ permissions: { allow: ['x'] }, hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }] } });
  const merged = settings(theirs, true), m = JSON.parse(merged);
  check(m.permissions.allow[0] === 'x' && m.hooks.SessionStart.length === 2 && m.hooks.SessionStart[0].hooks[0].command === 'echo hi'
    && m.hooks.SessionStart[1].hooks.length === 2 && settings(merged, true) === merged, 'shared: settings keep their own hooks and permissions, and the shared hooks go in once');
  check(JSON.parse(settings(merged, false)).hooks.SessionStart[1].hooks.length === 1, 'shared: a repository off the Atlas loads only instructions.md');
}

// The weekday brief (tools/brief.mjs): dates read from words, a closed issue and agent work left
// out, one issue seen from two repositories counted once, and short enough for a phone.
{
  check(datesIn('renew on 25 Nov; stuck on the 23 July 2026 extract; 1 Decision; 31 Feb', '2026-11-05').join() === '2026-11-25,2026-07-23', 'brief: dates in words');
  check(datesIn('due 10 Jan', '2026-11-05').join() === '2027-01-10', 'brief: a date with no year is the next one');
  const map = { owner: 'o', repos: [
    { id: 'a', name: 'A', repo: 'o/a', issues: [{ n: 1, title: 'Choose 30 or 90 days', human: true, created: '2026-11-04T01:00:00Z' }, { n: 2, title: 'Pay it', human: false }],
      manifest: { status: { blocked: [
        { id: 'pay', what: '#2 pay before 9 Nov', on: 'human', kind: 'money', since: '2026-10-01', issue: '#2', options: [{ what: 'Pay', by: 'human', effort: '5 min', recommended: true }] },
        { id: 'gone', what: '#9 Done already', on: 'human', issue: '#9' },
        { id: 'bot', what: 'Agent work', on: 'agent' }] } } },
    { id: 'b', name: 'B', repo: 'o/b', manifest: { status: { blocked: [{ id: 'same', what: 'Waits on A', on: 'human', issue: 'o/a#2' }] } } }] };
  const w = waiting(map);
  check(w.length === 2 && w.some(x => x.tag === '#1') && w.some(x => x.tag === '#2' && x.repo === 'A'), 'brief: what waits on you, each once');
  const out = brief(map, '2026-11-05', null);
  check(out === '📅 Mon 9 Nov: A #2 Pay before 9 Nov\n🆕 A #1 Choose 30 or 90 days\n👉 2 in all (2 for you, 0 at your computer): https://o.github.io/atlas/#blockers', `brief: picks and order, got ${JSON.stringify(out)}`);
  // The Priorities view's pick goes first, and isn't said twice.
  const started = brief(map, '2026-11-05', { key: 'o/a#2', repo: 'A', tag: '#2', title: 'Pay before 9 Nov', yourMinutes: 4 });
  check(started.split('\n')[0] === '⭐ Start here: A #2 Pay before 9 Nov (5 min)' && !started.includes('📅'), `brief: the start pick first, once, got ${JSON.stringify(started)}`);
  const pick = startHere(map, '2026-11-05');
  check(pick && pick.title && pick.key && Number.isFinite(pick.yourMinutes), `brief: the page's own code picks with no page, got ${JSON.stringify(pick)}`);
  check(brief({ ...map, generated: '2026-11-01T00:00:00Z' }, '2026-11-05', null).includes('\n⚠️ The map was last refreshed 4 days ago'), 'brief: warns when the map is old');
  if (existsSync(join(ROOT, 'data/map.json'))) {
    const realPick = startHere(json('data/map.json'), '2026-11-05');
    check(realPick && realPick.title, 'brief: a start pick on today\'s map');
    const real = brief(json('data/map.json'), '2026-11-05');
    check(real.length <= 600 && real.split('\n').length <= 9, `brief: ${real.length} characters, ${real.split('\n').length} lines on today's map`);
  }
}

if (fails.length) { console.error(`✗ ${fails.length} problem${fails.length === 1 ? '' : 's'}:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log(`✓ registry (${reg.repos.length}), fallbacks, scripts, page links, link ids, parsers, blocker tags, priorities, shared instructions, brief`);
