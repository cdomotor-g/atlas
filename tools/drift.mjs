#!/usr/bin/env node
// The check every repository on the Atlas can run on itself (through the reusable
// workflow .github/workflows/drift.yml in cdomotor-g/atlas):
//
//   1. atlas.json is valid — the schema, and every id it names is on the Atlas;
//   2. for each `consumes` entry, has the provider changed what is watched since this
//      repository last caught up? (drift — forward propagation, as code);
//   3. where the entry says `drift_issue: true`, keep one issue open in this repository
//      while it is behind, and close it with a comment once it has caught up.
//
//   node tools/drift.mjs --manifest path/to/atlas.json [--repo owner/name] [--issues] [--dry-run]
//
// Exits 1 only when atlas.json is invalid. Drift is reported, never a failure.

import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ROOT, github, validate, crossCheck, drift } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes(k);

const manifestPath = resolve(opt('--manifest', 'atlas.json'));
const here = dirname(manifestPath);
const gh = github(process.env.GITHUB_TOKEN || '');
const registry = JSON.parse(readFileSync(join(ROOT, 'data/registry.json'), 'utf8'));
const byId = new Map(registry.repos.map(r => [r.id, r]));
const summary = [];
const say = s => { console.log(s); summary.push(s); };

let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
catch (e) { console.error(`atlas.json: ${e.message}`); process.exit(1); }

const repo = opt('--repo', process.env.GITHUB_REPOSITORY || manifest.repo);
const problems = [...validate(manifest), ...crossCheck(manifest, new Set(byId.keys()))];
if (byId.has(manifest.id) && byId.get(manifest.id).repo.toLowerCase() !== repo.toLowerCase())
  problems.push(`id "${manifest.id}" belongs to ${byId.get(manifest.id).repo} on the Atlas, not ${repo}`);
if (!byId.has(manifest.id)) problems.push(`id "${manifest.id}" is not in the Atlas registry (cdomotor-g/atlas data/registry.json) — add it there`);

say(`## Atlas check — ${manifest.name || repo}`);
if (problems.length) {
  say(`\n❌ atlas.json has ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) say(`- ${p}`);
} else say('\n✅ atlas.json is valid.');

const results = [];
for (const c of manifest.consumes || []) {
  const prov = byId.get(c.from);
  if (!prov) continue;
  const meta = await gh.req(`/repos/${prov.repo}`).catch(() => null);
  const d = await drift(gh, {
    consumerRepo: repo, providerRepo: prov.repo, providerBranch: meta?.default_branch || 'main', entry: c,
    readConsumerFile: async p => { try { return readFileSync(join(here, p), 'utf8'); } catch { return null; } },
  });
  results.push({ c, prov, d });
}

if (results.length) {
  say('\n| From | What | State | |\n|---|---|---|---|');
  const icon = { behind: '🟠 behind', current: '🟢 current', unknown: '⚪ unknown', untracked: '· live / untracked' };
  for (const { c, prov, d } of results) say(`| ${prov.repo.split('/')[1]} | ${c.what.replace(/\|/g, '/')} | ${icon[d.state]} | ${d.note.replace(/\|/g, '/')} |`);
}

// Issues: one per drifting entry that asks for it, found again by a marker in its body.
if (flag('--issues') && !problems.length) {
  const open = [];
  for (let page = 1; page <= 3; page++) {
    const list = await gh.req(`/repos/${repo}/issues?state=open&per_page=100&page=${page}`) || [];
    open.push(...list);
    if (list.length < 100) break;
  }
  for (const { c, prov, d } of results) {
    if (!c.drift_issue) continue;
    const marker = `<!-- atlas-drift:${manifest.id}:${c.id} -->`;
    const existing = open.find(i => (i.body || '').includes(marker));
    if (d.state === 'behind') {
      const pname = prov.repo.split('/')[1];
      const changed = d.since?.version ? `released ${d.since.latest} (this repository names ${d.since.version})`
        : d.files?.length ? `changed ${d.files.slice(0, 3).map(f => f.split('/').pop()).join(', ')}${d.files.length > 3 ? ` and ${d.files.length - 3} more` : ''}`
        : `changed what ${c.id} watches`;
      const title = `[Standalone] [Sonnet5/Med] Upstream moved: ${pname} ${changed}`.slice(0, 200);
      const lines = [
        'Recommended: Sonnet5 / Med — catch this repository up with an upstream change, then run its checks.',
        '',
        marker,
        `**${prov.repo}** has changed what this repository takes from it: ${c.what}`,
        '',
        `- How it is taken: **${c.how}**${c.into ? ` into \`${c.into}\`` : ''}`,
        `- Where this repository last caught up: ${d.since?.commit ? `\`${d.since.commit.slice(0, 7)}\`` : d.since?.version ? `version ${d.since.version}` : d.since?.date || '—'}`,
        `- ${d.note}`,
        '',
        ...(d.commits?.length ? ['Upstream changes to watched files:', '', ...d.commits.slice(0, 15).map(x => `- [\`${x.sha}\`](${x.url}) ${x.date.slice(0, 10)} — ${x.msg}`), ''] : []),
        ...(d.files?.length ? ['Watched files that changed:', '', ...d.files.slice(0, 20).map(f => `- \`${f}\``), ''] : []),
        '**What to do**', '', c.on_change || 'Bring this repository in line with the provider, then update the pin in atlas.json.', '',
        'This issue was opened by the Atlas drift check (`.github/workflows/atlas.yml`) and closes itself once the pin catches up. Map: https://cdomotor-g.github.io/atlas/',
      ];
      const body = lines.join('\n');
      if (flag('--dry-run')) { say(`\n(dry run) would ${existing ? 'update' : 'open'}: ${title}`); continue; }
      if (existing) {
        if (existing.body !== body) await gh.req(`/repos/${repo}/issues/${existing.number}`, { method: 'PATCH', body: { body } });
        say(`\nUpdated #${existing.number}: ${title}`);
      } else {
        const made = await gh.req(`/repos/${repo}/issues`, { method: 'POST', body: { title, body } });
        say(`\nOpened #${made.number}: ${title}`);
      }
    } else if (d.state === 'current' && existing) {
      if (flag('--dry-run')) { say(`\n(dry run) would close #${existing.number}`); continue; }
      await gh.req(`/repos/${repo}/issues/${existing.number}/comments`, { method: 'POST', body: { body: `Caught up: ${d.note} Closed by the Atlas drift check.\n\n---\n_Generated by the Atlas drift check_` } });
      await gh.req(`/repos/${repo}/issues/${existing.number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
      say(`\nClosed #${existing.number}: caught up.`);
    }
  }
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
process.exit(problems.length ? 1 : 0);
