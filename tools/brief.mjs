#!/usr/bin/env node
// The Atlas brief: the few things in the repositories that wait on the owner and are worth a
// nudge today — a date coming up, something new, a quick win, and one more of the rest in turn.
// A scheduled Claude session sends what it prints to the owner's phone on weekday mornings; docs/brief.md
// says how and why. Reads data/map.json only; prints the brief; changes nothing.
//   node tools/brief.mjs                     today, in Queensland
//   node tools/brief.mjs --date 2026-11-11
//   node tools/brief.mjs --map <file>        another map.json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => new Date(iso + 'T00:00:00Z');
const plus = (iso, n) => new Date(day(iso).getTime() + n * 864e5).toISOString().slice(0, 10);
const between = (a, b) => Math.round((day(b) - day(a)) / 864e5);
const cut = (s, n = 100) => s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
/** Today's date in Queensland (UTC+10, no daylight saving). */
export const todayHere = () => new Date(Date.now() + 10 * 36e5).toISOString().slice(0, 10);

// The same readings as assets/atlas.js (minutesOf, guessKind, asYou): keep them in step.
function minutesOf(e) {
  const s = String(e || '').toLowerCase().trim(); let m;
  if (!s) return null;
  if ((m = s.match(/(\d+)\s*[–-]\s*(\d+)\s*h/))) return (+m[1] + +m[2]) * 30;
  if ((m = s.match(/(\d+)\s*h(?:ou)?rs?\b/))) return +m[1] * 60;
  if ((m = s.match(/(\d+)\s*min/))) return +m[1];
  if (/\b(an|one) hour\b|\bsitting\b/.test(s)) return 60;
  if (/afternoon|morning|half a day/.test(s)) return 240;
  if (/\bdays?\b|\bweeks?\b|\bforums?\b|\btrip\b/.test(s)) return 480;
  if (s === 'low') return 30;
  if (/^med/.test(s)) return 120;
  if (s === 'high') return 480;
  if (/\bnone\b/.test(s)) return 0;
  return null;
}
const HANDS = /\b(sites?|bench|hardware|masts?|antennas?|technician|trial|install|commission|field)\b/i;
const MONEY = /\b(buy|order|pay|spend|purchase)\b/i;
const ACCESS = /\b(sign[- ]?in|switch(es)? on|settings?|secrets?|dashboard|auth|tokens?|credentials?|accounts?|DNS|rename|passwords?)\b/i;
const asYou = i => !!i.computer || (!/^(decide|choose|review|check|spot-check|maybe)\b/i.test(i.title) && ACCESS.test(i.title) && !HANDS.test(i.title) && !MONEY.test(i.title));

/** The dates a line of text names ("before 25 Nov", "2026-11-25", "on 3 December 2026"), as YYYY-MM-DD. */
export function datesIn(text, today) {
  const out = [], ok = iso => !isNaN(day(iso)) && day(iso).toISOString().slice(0, 10) === iso;
  for (const m of String(text).matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) if (ok(m[0])) out.push(m[0]);
  const months = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?(?:\s+(\d{4}))?/gi;
  for (const m of String(text).matchAll(months)) {
    const mm = String(MON.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()) + 1).padStart(2, '0'), dd = m[1].padStart(2, '0');
    const y = +(m[3] || today.slice(0, 4));
    // A date with no year is this year's, unless that was half a year ago: then it is next year's.
    let iso = `${y}-${mm}-${dd}`;
    if (!m[3] && between(iso, today) > 180) iso = `${y + 1}-${mm}-${dd}`;
    if (ok(iso)) out.push(iso);
  }
  return out;
}

/** Everything in the map that waits on the owner: their hands, money or say ("human"), or only their sign-in ("computer"). */
export function waiting(map) {
  const repos = map.repos || [];
  const byFull = new Map(repos.map(r => [r.repo.toLowerCase(), r]));
  const refOf = (s, r) => { const m = String(s || '').match(/^\s*(?:([\w.-]+\/[\w.-]+))?#(\d+)/); return m ? { full: m[1] || r.repo, n: +m[2] } : null; };
  // The collector keeps every open issue of a public repository, so one it doesn't have is closed.
  const closed = x => { const h = byFull.get(x.full.toLowerCase()); return !!h && !h.private && h.visible !== false && Array.isArray(h.issues) && !h.issues.some(i => i.n === x.n); };
  const covered = new Set(), found = [];
  for (const r of repos) for (const b of r.manifest?.status?.blocked || []) {
    for (const m of `${b.issue || ''} ${b.what}`.matchAll(/(?:^|[^\w/])#(\d+)/g)) covered.add(`${r.repo.toLowerCase()}#${m[1]}`);
    const iss = refOf(b.issue, r);
    if (iss) covered.add(`${iss.full.toLowerCase()}#${iss.n}`);
    if (b.on && b.on !== 'human' && b.on !== 'computer') continue;
    if (iss && closed(iss)) continue; // its issue is closed, so it is probably cleared
    const local = iss && iss.full.toLowerCase() === r.repo.toLowerCase();
    const rec = (b.options || []).find(o => o.recommended) || (b.options || [])[0];
    found.push({
      repo: r.name, home: !iss || local, key: iss ? `${iss.full.toLowerCase()}#${iss.n}` : `${r.id}/${b.id || b.what}`,
      tag: iss ? (local ? `#${iss.n}` : `${iss.full.split('/')[1]}#${iss.n}`) : '',
      title: bare(b.what, iss), who: b.on === 'computer' || b.kind === 'access' ? 'computer' : 'human',
      since: b.since || null, effort: rec?.effort || null, mins: minutesOf(rec?.effort), frees: (b.holds || []).length,
    });
  }
  // [Human] and [Computer] issues that no recorded blocker already stands for.
  for (const r of repos) for (const i of r.issues || []) {
    if (!(i.human || i.computer) || /^roadmap\b/i.test(i.title)) continue;
    const key = `${r.repo.toLowerCase()}#${i.n}`;
    if (covered.has(key)) continue;
    found.push({ repo: r.name, home: true, key, tag: `#${i.n}`, title: i.title, who: asYou(i) ? 'computer' : 'human',
      since: i.created?.slice(0, 10) || null, effort: null, mins: null, frees: (r.issues || []).filter(c => c.structure === 'sub' && c.parent === i.n).length });
  }
  // One issue seen from two repositories is one thing waiting: keep it where the issue lives.
  const seen = new Set();
  return found.sort((a, b) => b.home - a.home).filter(x => !seen.has(x.key) && seen.add(x.key));
}
// "#274 ElevenLabs credits…" reads "ElevenLabs credits…" beside its tag.
function bare(what, iss) {
  if (!iss) return String(what);
  const s = String(what).replace(new RegExp(`^\\s*(?:[\\w.-]+\\/[\\w.-]+)?#${iss.n}\\b(?:['’]s)?[:\\s—-]*`), '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const label = (iso, today) => iso === today ? 'Today' : iso === plus(today, 1) ? 'Tomorrow' : `${DOW[day(iso).getUTCDay()]} ${day(iso).getUTCDate()} ${MON[day(iso).getUTCMonth()]}`;
const ageWords = n => n < 21 ? `${n} day${n === 1 ? '' : 's'}` : n < 63 ? `${Math.round(n / 7)} weeks` : `${Math.round(n / 30.4)} months`;
// The weekday before this one (Friday, on a Monday): the last brief.
const lastWeekday = iso => { let d = plus(iso, -1); while ([0, 6].includes(day(d).getUTCDay())) d = plus(d, -1); return d; };
// Weekdays since 1970: one step a brief, so "in turn" goes through the whole list.
const weekdayNumber = iso => { const d = Math.round(day(iso) / 864e5) + 3, wk = Math.floor(d / 7); return wk * 5 + Math.min(d - wk * 7, 4); };

/** The brief, as it is pushed: at most eight lines and 600 characters, then where to see the rest. */
export function brief(map, today = todayHere()) {
  const all = waiting(map);
  if (!all.length) return 'Nothing in the repositories is waiting on you.';
  const lines = [], used = new Set();
  // Each line is a lead-in, the thing, and a size: only the thing is shortened to fit.
  const add = (x, head, tail = '') => { used.add(x.key); lines.push(`${head}${cut(line(x), 100 - head.length - tail.length)}${tail}`); };
  const left = () => all.filter(x => !used.has(x.key));
  const line = x => `${x.repo}${x.tag ? ' ' + x.tag : ':'} ${x.title}`;

  // 1. A date in the next fortnight, soonest first.
  const horizon = plus(today, 14);
  all.map(x => ({ x, due: datesIn(x.title, today).filter(d => d >= today && d <= horizon).sort()[0] })).filter(o => o.due)
    .sort((a, b) => a.due.localeCompare(b.due)).slice(0, 2).forEach(o => add(o.x, `📅 ${label(o.due, today)}: `));
  // 2. New on you since the last brief, newest first.
  const since = lastWeekday(today);
  left().filter(x => x.since && x.since >= since && x.since <= today).sort((a, b) => b.since.localeCompare(a.since)).slice(0, 3)
    .forEach(x => add(x, '🆕 '));
  // 3. Quick wins: the way through takes half an hour or less; the most it frees first.
  left().filter(x => x.mins !== null && x.mins <= 30).sort((a, b) => b.frees - a.frees || a.mins - b.mins).slice(0, 2)
    .forEach(x => add(x, '⚡ ', ` (${x.effort})`));
  // 4. One more of the rest, in turn, oldest first, so nothing sits forgotten.
  const rest = left().sort((a, b) => (a.since || '9').localeCompare(b.since || '9') || a.key.localeCompare(b.key));
  if (rest.length) { const x = rest[weekdayNumber(today) % rest.length]; add(x, `⏳ ${x.since ? `Waiting ${ageWords(between(x.since, today))}: ` : ''}`); }

  const you = all.filter(x => x.who === 'human').length, pc = all.length - you;
  let foot = `👉 ${all.length} in all (${you} for you, ${pc} at your computer): https://${map.owner || 'cdomotor-g'}.github.io/atlas/#blockers`;
  // The Collect workflow refreshes the map every three hours: a map two days old means it has stopped.
  const made = String(map.generated || '').slice(0, 10);
  if (made && between(made, today) >= 2) foot = `⚠️ The map was last refreshed ${ageWords(between(made, today))} ago, so this may be out of date.\n${foot}`;
  while (lines.length > 1 && [...lines, foot].join('\n').length > 600) lines.pop();
  return [...lines, foot].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const at = f => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
  const map = JSON.parse(readFileSync(at('--map') || join(ROOT, 'data/map.json'), 'utf8'));
  console.log(brief(map, at('--date') || todayHere()));
}
