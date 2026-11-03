#!/usr/bin/env node
// Builds data/map.json — everything the Atlas page draws — from:
//   data/registry.json            which repositories, where they sit, which zone
//   <repo>/atlas.json             what each says about itself (or data/fallback/<id>.json)
//   the GitHub API                commits, open issues, releases, CI, and drift on every link
//
// Run by .github/workflows/collect.yml every few hours. Locally:
//   GITHUB_TOKEN=… node tools/collect.mjs            (works without a token, slowly: 60 calls an hour)
// ATLAS_TOKEN, when set, is used instead and may read private repositories; for those
// the map shows counts only, never issue titles or commit messages.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, github, validate, crossCheck, parseTitle, drift, slimCommit, blockerMark } from './lib.mjs';

const token = process.env.ATLAS_TOKEN || process.env.GITHUB_TOKEN || '';
const gh = github(token);
const registry = JSON.parse(readFileSync(join(ROOT, 'data/registry.json'), 'utf8'));
const ids = new Set(registry.repos.map(r => r.id));
const log = (...a) => console.error(...a);

// --local <dir>: read each atlas.json (and pin files) from clones under <dir> — named
// like the repository, or under <dir>/<owner>/ — before GitHub. For testing drafts.
const localArg = process.argv.indexOf('--local');
const localDir = localArg > 0 ? process.argv[localArg + 1] : null;
function localPath(r, file) {
  if (!localDir) return null;
  const name = r.repo.split('/')[1];
  for (const d of [join(localDir, name), join(localDir, r.repo)]) if (existsSync(join(d, file))) return join(d, file);
  return null;
}

async function manifestFor(r, branch) {
  // 1. atlas.json in the repository  2. on its Pages site (private repos with public sites)  3. the Atlas's fallback copy
  const lp = localPath(r, 'atlas.json');
  let text = lp ? readFileSync(lp, 'utf8') : await gh.file(r.repo, 'atlas.json', branch).catch(() => null);
  let source = 'repo';
  if (!text && r.pages) {
    const res = await fetch(new URL('atlas.json', r.pages)).catch(() => null);
    if (res && res.ok) { text = await res.text(); source = 'pages'; }
  }
  if (!text) {
    const fb = join(ROOT, 'data/fallback', `${r.id}.json`);
    if (existsSync(fb)) { text = readFileSync(fb, 'utf8'); source = 'fallback'; }
  }
  if (!text) return { manifest: null, source: 'none', problems: ['No atlas.json in the repository and no fallback in the Atlas.'] };
  try {
    const manifest = JSON.parse(text);
    const problems = [...validate(manifest), ...crossCheck(manifest, ids)];
    if (manifest.id !== r.id) problems.push(`id is "${manifest.id}", the registry calls it "${r.id}"`);
    return { manifest, source, problems };
  } catch (e) {
    return { manifest: null, source, problems: [`atlas.json is not valid JSON: ${e.message}`] };
  }
}

// The opening of an issue body as plain text: what a [Human] issue asks of the owner.
function excerpt(body) {
  if (!body) return '';
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n').filter(l => !/^\s*Recommended:/i.test(l) && !/^\s*#{1,6}\s/.test(l) && !/^\s*[-*_]{3,}\s*$/.test(l) && !/^\s*```/.test(l))
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]+/g, '')
    .replace(/\s+/g, ' ').trim();
  return text.length > 360 ? text.slice(0, 357).replace(/\s+\S*$/, '') + '…' : text;
}

async function collectRepo(r) {
  log(`· ${r.repo}`);
  const meta = await gh.req(`/repos/${r.repo}`).catch(() => null);
  const visible = !!meta;
  const isPrivate = r.private || meta?.private || false;
  const branch = meta?.default_branch || 'main';
  const { manifest, source, problems } = await manifestFor(r, branch);

  const out = {
    ...r,
    name: manifest?.name || r.repo.split('/')[1],
    private: isPrivate,
    visible,
    branch,
    manifest,
    manifestSource: source,
    problems,
    gh: meta ? {
      description: meta.description, archived: meta.archived, pushed: meta.pushed_at,
      homepage: meta.homepage || null, language: meta.language, url: meta.html_url,
    } : { url: `https://github.com/${r.repo}` },
    commits: [], issues: [], issueCount: null, release: null, ci: [], version: null,
  };
  if (!visible) return out;

  const [commits, release, runs] = await Promise.all([
    gh.req(`/repos/${r.repo}/commits?per_page=12`).catch(() => []),
    gh.req(`/repos/${r.repo}/releases/latest`).catch(() => null),
    gh.req(`/repos/${r.repo}/actions/runs?branch=${branch}&per_page=40`).catch(() => null),
  ]);

  // Issues: every open one (not pull requests), with the tags parsed out of its title.
  const issues = [];
  for (let page = 1; page <= 5; page++) {
    const list = await gh.req(`/repos/${r.repo}/issues?state=open&per_page=100&page=${page}`).catch(() => null);
    if (!list || !list.length) break;
    for (const i of list) if (!i.pull_request) issues.push(i);
    if (list.length < 100) break;
  }
  out.issueCount = issues.length;
  out.lastCommit = commits?.[0] ? { date: commits[0].commit.committer.date } : null;
  if (release) out.release = { tag: release.tag_name, date: release.published_at, url: release.html_url };

  if (!isPrivate) {
    out.commits = (commits || []).map(slimCommit);
    out.issues = issues.map(i => {
      const t = parseTitle(i.title);
      const mentions = [...new Set([...(i.body || '').matchAll(/cdomotor-g\/([A-Za-z0-9_.-]+)/gi)].map(m => m[1].toLowerCase()))];
      const blocker = blockerMark(i.body);
      return {
        n: i.number, raw: i.title, ...t, url: i.html_url, updated: i.updated_at, created: i.created_at,
        comments: i.comments, labels: i.labels.map(l => l.name), mentions,
        ...(t.human ? { excerpt: excerpt(i.body) } : {}),
        ...(blocker ? { blocker } : {}),
      };
    });
    if (runs?.workflow_runs) {
      const latest = new Map();
      for (const run of runs.workflow_runs) if (!latest.has(run.name)) latest.set(run.name, run);
      out.ci = [...latest.values()].map(run => ({
        name: run.name, status: run.status, conclusion: run.conclusion, url: run.html_url, date: run.updated_at, event: run.event,
      }));
    }
  } else {
    out.lastCommit = commits?.[0] ? { date: commits[0].commit.committer.date } : null;
  }

  // Version: the manifest says where it is written down; else the latest release.
  const v = manifest?.version;
  if (v?.file && v.pattern) {
    const text = await gh.file(r.repo, v.file, branch).catch(() => null);
    const m = text && text.match(new RegExp(v.pattern));
    if (m) out.version = m[1];
  }
  if (!out.version && release && /\d/.test(release.tag_name)) out.version = release.tag_name.replace(/^v/i, '');
  return out;
}

const repos = [];
for (const r of registry.repos) repos.push(await collectRepo(r));
const byId = new Map(repos.map(r => [r.id, r]));

// Links: one per `consumes` entry, with drift worked out against the provider.
const links = [];
for (const consumer of repos) {
  for (const c of consumer.manifest?.consumes || []) {
    const provider = byId.get(c.from);
    if (!provider) continue;
    log(`  ↳ ${c.from} → ${consumer.id} (${c.id})`);
    const d = (consumer.visible && provider.visible)
      ? await drift(gh, { consumerRepo: consumer.repo, consumerRef: consumer.branch, providerRepo: provider.repo, providerBranch: provider.branch, entry: c,
          readConsumerFile: localDir ? async p => { const f = localPath(consumer, p); return f ? readFileSync(f, 'utf8') : gh.file(consumer.repo, p, consumer.branch); } : undefined })
      : { state: 'unknown', note: 'The Atlas could not read one end (a private repository, or one its token cannot reach).' };
    if (provider.private || consumer.private) d.commits = (d.commits || []).map(x => ({ sha: x.sha, date: x.date, msg: provider.private ? '(private)' : x.msg, url: provider.private ? null : x.url }));
    links.push({ id: `${consumer.id}:${c.id}`, from: c.from, to: consumer.id, ...c, drift: d });
  }
}

// Back propagation: open issues in one repository that name another.
const repoNameToId = new Map(repos.map(r => [r.repo.split('/')[1].toLowerCase(), r.id]));
const crossIssues = [];
for (const r of repos) for (const i of r.issues) for (const m of i.mentions) {
  const other = repoNameToId.get(m);
  if (other && other !== r.id) crossIssues.push({ in: r.id, about: other, n: i.n, title: i.title, url: i.url });
}

const asks = [];
for (const r of repos) for (const a of r.manifest?.asks || []) asks.push({ from: r.id, ...a });

const body = { owner: registry.owner, groups: registry.groups, repos, links, crossIssues, asks };
const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
const path = join(ROOT, 'data/map.json');
const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
if (previous?.hash === hash && !process.argv.includes('--force')) {
  log(`unchanged (${hash}); ${gh.calls} API calls`);
} else {
  writeFileSync(path, JSON.stringify({ generated: new Date().toISOString(), hash, ...body }, null, 1) + '\n');
  const behind = links.filter(l => l.drift.state === 'behind').length;
  const problems = repos.reduce((n, r) => n + r.problems.length, 0);
  log(`wrote data/map.json: ${repos.length} repos, ${links.length} links (${behind} behind), ${problems} manifest problems; ${gh.calls} API calls`);
}
