// Shared by tools/collect.mjs (builds the map) and tools/drift.mjs (the check each
// repository runs on itself). Node 20+, no dependencies.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'schema/atlas.schema.json'), 'utf8'));

// ---------------------------------------------------------------- GitHub

export function github(token) {
  let calls = 0;
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'cdomotor-g-atlas',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  async function req(path, { method = 'GET', body, allow404 = true } = {}) {
    calls++;
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const res = await fetch(url, { method, headers: body ? { ...headers, 'content-type': 'application/json' } : headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 404 && allow404) return null;
    if (res.status === 204) return {};
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // A file's text at a ref. Public repositories come from raw.githubusercontent.com
  // (no API call); with a token, private ones come through the contents API.
  async function file(repo, path, ref = 'HEAD') {
    const raw = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'user-agent': headers['user-agent'] } });
    if (raw.ok) return raw.text();
    if (!token) return null;
    const meta = await req(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`).catch(() => null);
    if (!meta || !meta.content) return null;
    return Buffer.from(meta.content, 'base64').toString('utf8');
  }

  return { req, file, get calls() { return calls; } };
}

// ---------------------------------------------------------------- atlas.json checks

// A small JSON Schema reader for the subset atlas.schema.json uses: type, required,
// properties, additionalProperties:false, enum, const, pattern, maxLength, items,
// oneOf and local $ref. Returns a list of "path: problem" strings, empty when valid.
export function validate(doc, schema = SCHEMA, root = SCHEMA, path = '$') {
  const errs = [];
  if (schema.$ref) return validate(doc, resolveRef(root, schema.$ref), root, path);
  if (schema.oneOf) {
    const ok = schema.oneOf.filter(s => validate(doc, s, root, path).length === 0);
    if (ok.length !== 1) errs.push(`${path}: must match exactly one of ${schema.oneOf.length} shapes (matched ${ok.length})`);
    return errs;
  }
  if (schema.const !== undefined && doc !== schema.const) errs.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(doc)) errs.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = doc === null ? 'null' : Array.isArray(doc) ? 'array' : typeof doc;
    if (!types.includes(actual) && !(actual === 'number' && types.includes('integer'))) {
      errs.push(`${path}: must be ${types.join(' or ')}, is ${actual}`);
      return errs;
    }
  }
  if (typeof doc === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(doc)) errs.push(`${path}: "${doc}" does not match ${schema.pattern}`);
    if (schema.maxLength && doc.length > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength} characters`);
  }
  if (Array.isArray(doc) && schema.items) doc.forEach((v, i) => errs.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    for (const k of schema.required || []) if (!(k in doc)) errs.push(`${path}: missing "${k}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(doc)) {
      if (props[k]) errs.push(...validate(v, props[k], root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unknown key "${k}"`);
      else if (typeof schema.additionalProperties === 'object') errs.push(...validate(v, schema.additionalProperties, root, `${path}.${k}`));
    }
  }
  return errs;
}

function resolveRef(root, ref) {
  return ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
}

// Checks beyond the schema: ids unique, references point at something real.
export function crossCheck(manifest, knownIds) {
  const errs = [];
  const seen = new Set();
  for (const key of ['components', 'provides', 'consumes']) {
    for (const item of manifest[key] || []) {
      const id = `${key}:${item.id}`;
      if (seen.has(id)) errs.push(`${key}: id "${item.id}" is used twice`);
      seen.add(id);
    }
  }
  const comps = new Set((manifest.components || []).map(c => c.id));
  for (const p of manifest.provides || []) if (p.component && !comps.has(p.component)) errs.push(`provides "${p.id}": component "${p.component}" is not in components`);
  for (const c of manifest.consumes || []) {
    if (knownIds && !knownIds.has(c.from)) errs.push(`consumes "${c.id}": "${c.from}" is not on the Atlas`);
    if (c.from === manifest.id) errs.push(`consumes "${c.id}": a repository cannot consume itself`);
    if (c.into && !comps.has(c.into)) errs.push(`consumes "${c.id}": into "${c.into}" is not in components`);
    for (const p of ['since']) if (c[p]?.pattern) { try { new RegExp(c[p].pattern); } catch (e) { errs.push(`consumes "${c.id}": bad pattern: ${e.message}`); } }
  }
  for (const a of manifest.asks || []) if (knownIds && !knownIds.has(a.to)) errs.push(`asks: "${a.to}" is not on the Atlas`);
  return errs;
}

// ---------------------------------------------------------------- issue titles

// "[Sub-issue of #42] [Sonnet5/Med] Fix flaky test" →
// { structure: 'sub', parent: 42, model: 'Sonnet5', effort: 'Med', human: false, title: 'Fix flaky test' }
export function parseTitle(raw) {
  const out = { structure: null, parent: null, model: null, effort: null, human: false, title: raw };
  let rest = raw;
  for (;;) {
    const m = rest.match(/^\s*\[([^\]]+)\]\s*/);
    if (!m) break;
    const tag = m[1].trim();
    let t;
    if (/^standalone$/i.test(tag)) out.structure = 'standalone';
    else if (/^epic$/i.test(tag)) out.structure = 'epic';
    else if ((t = tag.match(/^sub-?issue of #(\d+)$/i))) { out.structure = 'sub'; out.parent = +t[1]; }
    else if (/^human$/i.test(tag)) out.human = true;
    else if ((t = tag.match(/^([A-Za-z]+[0-9.]*)\s*\/\s*(Low|Med|Medium|High|XHigh|Max)$/i))) { out.model = t[1]; out.effort = t[2].replace(/^medium$/i, 'Med'); }
    else break;
    rest = rest.slice(m[0].length);
  }
  out.title = rest.trim() || raw;
  return out;
}

// ---------------------------------------------------------------- watch paths

export function watchMatches(watch, file) {
  return (watch || []).some(w => {
    if (w.endsWith('/')) return file.startsWith(w);
    if (w.includes('*')) {
      const re = new RegExp('^' + w.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
      return re.test(file);
    }
    return file === w || file.startsWith(w + '/');
  });
}


// ---------------------------------------------------------------- drift

const cmpVersion = (a, b) => {
  const pa = a.split(/[.-]/).map(n => parseInt(n, 10) || 0), pb = b.split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

// Where `consumer` stands against `provider` for one `consumes` entry.
// Returns { state, since, behind, commits[], files[], note }:
//   state: current | behind | unknown | untracked
// The catch-up point is a commit (pinned in a file, or literal), a version, or a review
// date (resolved to the provider's last commit on or before that day). Everything after
// it is compared file by file against `watch`.
export async function drift(gh, { consumerRepo, consumerRef = 'HEAD', providerRepo, entry, providerBranch, readConsumerFile }) {
  const readHere = readConsumerFile || (p => gh.file(consumerRepo, p, consumerRef));
  const out = { state: 'untracked', since: null, behind: 0, commits: [], files: [], note: '' };
  const s = entry.since;
  const branch = providerBranch || 'main';
  if (!s) {
    out.note = entry.how === 'live' ? 'Read live: always the current version, so watch for breaking changes.' : 'No catch-up point recorded.';
    return out;
  }
  try {
    if (s.version) {
      const text = await readHere(s.version.file);
      const m = text && text.match(new RegExp(s.version.pattern));
      const rel = await gh.req(`/repos/${providerRepo}/releases/latest`);
      if (!m) return { ...out, state: 'unknown', note: `Pattern not found in ${s.version.file}.` };
      if (!rel) return { ...out, state: 'unknown', since: { version: m[1] }, note: 'The provider has no release yet.' };
      const latest = rel.tag_name.replace(/^v/i, '');
      out.since = { version: m[1], latest, url: rel.html_url };
      const d = cmpVersion(m[1], latest);
      out.state = d < 0 ? 'behind' : 'current';
      out.note = d < 0 ? `Says ${m[1]}; the latest release is ${latest}.` : `Says ${m[1]}, the latest release.`;
      return out;
    }

    let base = s.commit || null;
    if (s.file) {
      const text = await readHere(s.file);
      const m = text && text.match(new RegExp(s.pattern));
      if (!m) return { ...out, state: 'unknown', note: `Pin pattern not found in ${s.file}.` };
      base = m[1];
    }
    if (s.date) {
      const list = await gh.req(`/repos/${providerRepo}/commits?sha=${encodeURIComponent(branch)}&per_page=1&until=${encodeURIComponent(s.date + 'T23:59:59Z')}`);
      if (!list || !list.length) return { ...out, state: 'unknown', since: { date: s.date }, note: `No commit in ${providerRepo} on or before ${s.date}.` };
      base = list[0].sha;
    }
    if (!base) return out;

    const cmp = await gh.req(`/repos/${providerRepo}/compare/${base}...${encodeURIComponent(branch)}`);
    out.since = s.date ? { date: s.date, commit: base } : { commit: base };
    if (!cmp) return { ...out, state: 'unknown', note: `Commit ${base.slice(0, 7)} is not in ${providerRepo}.` };
    out.since.commitDate = cmp.base_commit?.commit?.committer?.date;
    const sinceTxt = s.date ? `it was last reviewed (${s.date})` : base.slice(0, 7);
    if (!cmp.ahead_by) {
      out.state = 'current'; out.note = 'Up to date with upstream.';
      return out;
    }
    const ahead = new Map((cmp.commits || []).map(c => [c.sha, c]));
    const watch = entry.watch && entry.watch.length ? entry.watch : null;
    const changed = new Set(), hits = new Map();
    const after = encodeURIComponent(out.since.commitDate || '');
    // Plain paths: ask the commits API directly (exact, and not capped like compare's file list).
    // Patterns: match compare's file list, then ask per matched file.
    const paths = new Set();
    for (const w of watch || []) {
      if (w.includes('*')) for (const f of cmp.files || []) { if (watchMatches([w], f.filename)) paths.add(f.filename); }
      else paths.add(w.replace(/\/$/, ''));
    }
    if (!watch) for (const f of (cmp.files || []).slice(0, 10)) paths.add(f.filename);
    for (const p of [...paths].slice(0, 16)) {
      const list = await gh.req(`/repos/${providerRepo}/commits?sha=${encodeURIComponent(branch)}&per_page=50&since=${after}&path=${encodeURIComponent(p)}`) || [];
      for (const c of list) if (ahead.has(c.sha)) { hits.set(c.sha, c); changed.add(p); }
    }
    out.files = [...changed];
    out.commits = [...hits.values()].map(slimCommit).sort((a, b) => b.date.localeCompare(a.date));
    out.behind = out.commits.length;
    if (out.behind) {
      out.state = 'behind';
      out.note = `${out.behind} upstream change${out.behind === 1 ? '' : 's'} to watched files since ${sinceTxt}.`;
    } else {
      out.state = 'current';
      out.note = `${cmp.ahead_by} newer commit${cmp.ahead_by === 1 ? '' : 's'} upstream since ${sinceTxt}, none to watched files.`;
    }
    return out;
  } catch (e) {
    return { ...out, state: 'unknown', note: e.message.slice(0, 160) };
  }
}

export function slimCommit(c) {
  return {
    sha: c.sha.slice(0, 7),
    date: c.commit?.committer?.date || c.commit?.author?.date || '',
    msg: (c.commit?.message || '').split('\n')[0].slice(0, 140),
    url: c.html_url,
  };
}
