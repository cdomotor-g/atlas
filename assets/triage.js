/* Atlas — weighing every open issue and blocker against the others: how much it matters, what
   it costs, and when it could be done. Plain sums, no page: assets/atlas.js draws the Priorities
   view with them, and test/check.mjs checks them. docs/priorities.md says how it weighs, in words.
   In the page this is window.AtlasTriage; in Node, require() it. */
(function (root) {
'use strict';

// What the Atlas assumes until the owner says otherwise (in the page, or "triage" in
// data/registry.json). Weights say how much each part counts; 0 leaves it out.
const DEFAULTS = {
  weights: { importance: 2, opportunity: 1, urgency: 1, cost: 1 },
  yourHoursADay: 1,      // your own hours a day on this work, every day
  agentsAtOnce: 2,       // agent sessions working side by side
  agentHoursADay: 6,     // hours of work an agent session gets through in a day
  yourHour: 60,          // what an hour of your time is worth, in dollars
  agentHour: 5,          // what an hour of agent time costs you, in dollars (0 on a flat plan)
  unknownPurchase: 50,   // a purchase with no price written down, in dollars
};
const LIMITS = {
  yourHoursADay: [0.25, 12], agentsAtOnce: [1, 10], agentHoursADay: [1, 24],
  yourHour: [0, 1000], agentHour: [0, 500], unknownPurchase: [0, 100000],
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x)) ? x : (typeof x === 'string' && x.trim() !== '' && Number.isFinite(+x)) ? +x : d;

/** The settings in force: the defaults, then each layer given (registry, then this browser). */
function settings(...layers) {
  const out = { ...DEFAULTS, weights: { ...DEFAULTS.weights } };
  for (const s of layers) {
    if (!s || typeof s !== 'object') continue;
    for (const k of Object.keys(LIMITS)) if (k in s) out[k] = clamp(num(s[k], out[k]), ...LIMITS[k]);
    for (const k of Object.keys(DEFAULTS.weights)) if (s.weights && k in s.weights) out.weights[k] = clamp(num(s.weights[k], out.weights[k]), 0, 5);
  }
  out.agentsAtOnce = Math.round(out.agentsAtOnce);
  return out;
}

// ------------------------------------------------------------------ dates
const DAY = 864e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => new Date(iso + 'T00:00:00Z');
const between = (a, b) => Math.round((day(b) - day(a)) / DAY);
const plus = (iso, n) => new Date(day(iso).getTime() + Math.round(n) * DAY).toISOString().slice(0, 10);
const okIso = iso => !isNaN(day(iso)) && day(iso).toISOString().slice(0, 10) === iso;

/** The dates a line of text names ("before 25 Nov", "2026-11-25", "on 3 December 2026"), as
    YYYY-MM-DD. The same reading as datesIn in tools/brief.mjs: keep them in step. */
function datesIn(text, today) {
  const out = [];
  for (const m of String(text).matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) if (okIso(m[0])) out.push(m[0]);
  const months = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?(?:\s+(\d{4}))?/gi;
  for (const m of String(text).matchAll(months)) {
    const mm = String(MON.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()) + 1).padStart(2, '0'), dd = m[1].padStart(2, '0');
    const y = +(m[3] || today.slice(0, 4));
    let iso = `${y}-${mm}-${dd}`;
    if (!m[3] && between(iso, today) > 180) iso = `${y + 1}-${mm}-${dd}`;
    if (okIso(iso)) out.push(iso);
  }
  return out;
}
/** The first date from today on (within a year) that a text names: a deadline, as far as words go.
    A date already gone is usually history ("stuck on the 23 July extract"), not a deadline. */
function deadlineIn(text, today) {
  return datesIn(text, today).filter(d => { const n = between(today, d); return n >= 0 && n <= 365; }).sort()[0] || null;
}

// ------------------------------------------------------------------ how much the repository matters (1–5)
const PHASE_WEIGHT = { live: 4, beta: 4, building: 3, idea: 2, maintenance: 2, archived: 1 };
const PHASE_WORDS = { live: 'in use', beta: 'in use, still settling', building: 'being built', idea: 'an idea', maintenance: 'kept working, no new features', archived: 'archived' };
/** A first guess from the map: its phase, one more when four or more repositories rely on it
    (live, a copy, a protocol or a release — not a citation), one less when nothing even cites it. */
function repoGuess({ phase, relyOn = 0, cited = 0 } = {}) {
  let v = PHASE_WEIGHT[phase] ?? 3;
  const why = [PHASE_WORDS[phase] || 'no phase given'];
  if (relyOn >= 4) { v += 1; why.push(`${relyOn} repositories rely on it`); }
  else if (!relyOn && !cited) { v -= 1; why.push('nothing else relies on it'); }
  else if (relyOn) why.push(`${relyOn} repositor${relyOn === 1 ? 'y relies' : 'ies rely'} on it`);
  return { v: clamp(v, 1, 5), why: why.join('; ') };
}

// ------------------------------------------------------------------ how bad it is if it's left (1–5)
const SEV_LABEL = [
  [5, /^(p0|critical|urgent|security|sev(?:erity)?[ :_-]*(?:1|critical))$/i],
  [4, /^(p1|bug|regression|high|sev(?:erity)?[ :_-]*(?:2|high))$/i],
  [3, /^(p2|medium|sev(?:erity)?[ :_-]*(?:3|medium))$/i],
  [2, /^(p3|low|enhancement|nice[ -]to[ -]have|sev(?:erity)?[ :_-]*(?:4|low))$/i],
  [1, /^(p4|someday|wishlist)$/i],
];
const SEV_WORDS = [
  [5, /\b(security|vulnerab\w*|leak(?:s|ed|ing)?|privacy|data loss|los(?:e|es|ing|t) (?:data|readings|records)|outage|(?:is|goes|went) down)\b/i, 'it is about security, privacy, lost data or an outage'],
  [4, /\b(broken|breaks?|fail(?:s|ed|ing|ure)?|crash(?:es|ed|ing)?|wrong|bugs?|regression|stop(?:s|ped)? \w+ing|dropp(?:ing|ed|s)|stuck|run(?:s|ning)? (?:short|out))\b/i, 'something is broken, failing or running out'],
  [2, /^(maybe|idea|explore|consider)\b|\b(follow[- ]?ups?|polish|suggest(?:ed|ions)?|nice[- ]to[- ]have|tidy)\b/i, 'it reads as a nice-to-have'],
];
/** A first guess from labels, then from what kind of blocker it is, then from the words of its title. */
function severityGuess({ text = '', labels = [], source = null } = {}) {
  for (const l of labels || []) for (const [v, re] of SEV_LABEL) if (re.test(String(l).trim())) return { v, why: `labelled “${l}”` };
  if (source === 'ci') return { v: 4, why: 'a check is failing' };
  for (const [v, re, why] of SEV_WORDS) { const m = String(text).match(re); if (m) return { v, why: `${why} (“${m[0]}”)` }; }
  if (source === 'drift') return { v: 3, why: 'it has fallen behind something it copies or follows' };
  if (source === 'stale') return { v: 2, why: 'the map is out of date about it' };
  return { v: 3, why: 'ordinary work: nothing in it says broken or nice-to-have' };
}

// ------------------------------------------------------------------ what doing it opens up (0–5)
/** From how much clearing it frees (counting what the blockers behind it hold up), and one more
    when another repository waits on it too. */
function opportunityOf(frees = 0, others = 0) {
  const v = frees >= 8 ? 5 : frees >= 5 ? 4 : frees >= 3 ? 3 : Math.max(0, frees);
  return clamp(v + (others > 0 ? 1 : 0), 0, 5);
}

// ------------------------------------------------------------------ how soon it is needed (0–5)
/** A deadline close by counts most; being on its repository's Now (or Next) list, and having
    held other work up for a month or more, add to it. */
function urgencyOf({ due = null, today, planned = null, waited = 0 } = {}) {
  let v = 0; const why = []; let daysLeft = null;
  if (due) {
    daysLeft = between(today, due);
    v += daysLeft <= 2 ? 5 : daysLeft <= 7 ? 4 : daysLeft <= 14 ? 3 : daysLeft <= 30 ? 2 : daysLeft <= 90 ? 1 : 0;
    why.push(daysLeft < 0 ? `was due ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago` : daysLeft === 0 ? 'due today' : `due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`);
  }
  if (planned === 'now') { v += 2; why.push('on its repository’s Now list'); }
  else if (planned === 'next') { v += 1; why.push('on its repository’s Next list'); }
  if (waited >= 90) { v += 2; why.push(`it has held work up for ${waited} days`); }
  else if (waited >= 30) { v += 1; why.push(`it has held work up for ${waited} days`); }
  return { v: clamp(v, 0, 5), why, daysLeft };
}

// ------------------------------------------------------------------ size and cost
/** Minutes from words: "10 min", "1–2 hours", "an afternoon", "Low". The reading of minutesOf in
    assets/atlas.js and tools/brief.mjs, plus "2h", "1.5 hours" and "3 days" for the triage line. */
function minutesOf(e) {
  const s = String(e || '').toLowerCase().trim(); let m;
  if (!s) return null;
  if ((m = s.match(/(\d+)\s*[–-]\s*(\d+)\s*h/))) return (+m[1] + +m[2]) * 30;
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*h(?:ou)?rs?\b/)) || (m = s.match(/^(\d+(?:\.\d+)?)\s*h$/))) return +m[1] * 60;
  if ((m = s.match(/(\d+)\s*min/))) return +m[1];
  if ((m = s.match(/(\d+)\s*days?\b/))) return +m[1] * 480;
  if (/\b(an|one) hour\b|\bsitting\b/.test(s)) return 60;
  if (/afternoon|morning|half a day/.test(s)) return 240;
  if (/\bdays?\b|\bweeks?\b|\bforums?\b|\btrip\b/.test(s)) return 480;
  if (s === 'low') return 30;
  if (/^med/.test(s)) return 120;
  if (s === 'high') return 480;
  if (/\bnone\b/.test(s)) return 0;
  return null;
}
// An issue's [Model/Effort] tag says how hard an agent has to think, which goes roughly with how
// long the job is: hours of agent work.
const TAG_HOURS = { Low: 0.5, Med: 1.5, High: 3, XHigh: 6, Max: 10 };

/** The largest amount of money a text names ("US$22", "A$566 inc GST", "$1,200", "$5 a month"). */
function moneyIn(text) {
  let best = null;
  for (const m of String(text || '').matchAll(/(?:\b(?:US|AU|A|NZ))?\$\s?(\d[\d,]*(?:\.\d+)?)(\s*k\b)?(\s*(?:\/|an?|per)\s*(?:month|mo)\b)?/gi)) {
    const amount = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    if (Number.isFinite(amount) && (!best || amount > best.amount)) best = { amount, text: m[0].trim(), monthly: !!m[3] };
  }
  return best;
}
const SPEND = /\b(buy|order|pay|spend|purchase|upgrade|subscribe)\b/i;

/** What it costs you: your own time, agent time and money, each in hours and in dollars.
    who: "human" (you do it), "computer" (an agent at your computer while you approve — about
    half its time is yours), or "agent" (a few minutes of yours to hand it over and check it). */
function costOf({ hours = 1, who = 'agent', money = 0 } = {}, s = DEFAULTS) {
  const h = Math.max(hours, 1 / 12);
  const your = who === 'human' ? h : who === 'computer' ? Math.max(1 / 6, h * 0.5) : h <= 1 ? 1 / 6 : h <= 4 ? 1 / 4 : 1 / 2;
  const agent = who === 'human' ? 0 : h;
  const parts = { your: your * s.yourHour, agent: agent * s.agentHour, money: Math.max(0, money || 0) };
  return { hours: h, yourHours: your, agentHours: agent, parts, total: parts.your + parts.agent + parts.money };
}

// ------------------------------------------------------------------ the score
/** Importance (0–100) from the four parts, each 0–5 — the repository and how bad it is count
    together, multiplied, so a bad problem in a repository that matters little can rank below a
    smaller one where it matters most — and "best next": importance for what it costs. The cost
    weight says how hard cost holds a thing back (0: not at all). */
function scoreOf({ repo = 3, severity = 3, opportunity = 0, urgency = 0, cost = 0 } = {}, s = DEFAULTS) {
  const w = s.weights;
  const raw = { importance: w.importance * repo * severity / 5, opportunity: w.opportunity * opportunity, urgency: w.urgency * urgency };
  const k = 100 / (5 * ((w.importance + w.opportunity + w.urgency) || 1));
  const parts = { importance: raw.importance * k, opportunity: raw.opportunity * k, urgency: raw.urgency * k };
  const worth = parts.importance + parts.opportunity + parts.urgency;
  const size = 1 + Math.log2(1 + Math.max(0, cost) / 15);
  return { worth, parts, size, best: worth / Math.pow(size, w.cost) };
}

// ------------------------------------------------------------------ a plan in time
/** Lays the work out in time, in the order given: yours (and your computer's) one after another at
    your hours a day; agent work side by side, as many at once as you run, each to the session
    free first. Nothing starts before what it waits for (`after`) is done. Sets start and finish,
    in days from now, on each item, and `agent` (which session) on agent work. */
function schedule(items, s = DEFAULTS) {
  const set = new Set(items), done = new Set();
  let you = 0;
  const agents = Array.from({ length: Math.max(1, s.agentsAtOnce | 0) }, () => 0);
  const left = items.slice();
  while (left.length) {
    let k = left.findIndex(it => (it.after || []).every(p => done.has(p) || !set.has(p)));
    if (k < 0) k = 0; // waiting on each other in a ring: take the first
    const it = left.splice(k, 1)[0];
    const ready = Math.max(0, ...(it.after || []).filter(p => done.has(p)).map(p => p.finish));
    if (it.who === 'human' || it.who === 'computer') {
      it.start = Math.max(you, ready); it.finish = it.start + it.yourHours / s.yourHoursADay; you = it.finish; it.agent = null;
    } else {
      let a = 0; for (let j = 1; j < agents.length; j++) if (agents[j] < agents[a]) a = j;
      it.start = Math.max(agents[a], ready); it.finish = it.start + it.agentHours / s.agentHoursADay; agents[a] = it.finish; it.agent = a;
    }
    done.add(it);
  }
  return items;
}

/** Round steps for an axis from 0 to at least max: about n of them, the last at or past max. */
function ticks(max, n = 5) {
  if (!(max > 0)) return [0, 1];
  const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= raw);
  const top = Math.ceil(max / step - 1e-9) * step, out = [];
  for (let k = 0; k * step <= top * 1.0001; k++) out.push(+(k * step).toFixed(6));
  return out;
}

/** "Atlas triage: severity 4 · due 2026-11-25 · effort 2h · cost $40" — the line an issue can carry
    to say how it weighs, for the owner or the agent who knows. Each part is optional. */
function triageLine(t) {
  const p = [];
  if (t.severity) p.push(`severity ${t.severity}`);
  if (Number.isFinite(t.opportunity)) p.push(`opens ${t.opportunity}`);
  if (t.due) p.push(`due ${t.due}`);
  if (Number.isFinite(t.hours)) p.push(`effort ${t.hours < 1 ? `${Math.round(t.hours * 60)} min` : `${+t.hours.toFixed(1)}h`}`);
  if (Number.isFinite(t.money)) p.push(`cost $${Math.round(t.money)}`);
  return p.length ? `Atlas triage: ${p.join(' · ')}` : '';
}

const api = { DEFAULTS, LIMITS, settings, datesIn, deadlineIn, between, plus, repoGuess, PHASE_WORDS, severityGuess, opportunityOf, urgencyOf, minutesOf, TAG_HOURS, moneyIn, SPEND, costOf, scoreOf, schedule, ticks, triageLine };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.AtlasTriage = api;
})(typeof window !== 'undefined' ? window : globalThis);
