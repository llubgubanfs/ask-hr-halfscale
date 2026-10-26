// Assistant module: sensitive pre-check -> mock lookup or real model -> validated output contract.
const fs = require('fs'), path = require('path');
const { handbook, policies, byId } = require('./handbook');

const SENSITIVE_RE = [
  /harass|bully|bullied|bullying|discriminat|\babus(e|ed|ive)\b|retaliat|molest|assault|\bwitness(ed)?\b/i,
  /\b(shout|shouts|shouting|yell|yells|yelling|scold\w*|humiliat\w*|threaten\w*)\b/i,
  /\b(report(ing)?) (him|her|them|my (boss|manager|supervisor|team ?lead|colleague|coworker))\b/i,
  /\bmy (boss|manager|supervisor|team ?lead|colleague|co-?worker)\b.*\b(keeps|is|was|told|made|won'?t|refuses|allowed|said|treats)\b/i,
  /what happened to\b|\bcase (of|against)\b|\bis (he|she) (allowed|going)/i,
  /\b(fired|terminat\w*|dismiss\w*|disciplin\w*|suspen(d|ded|sion)|show cause|laid off|retrench\w*|resign\w* (from|my)|(my|am i being) (resignation|termination))\b/i,
  /\b(will|can|could|would) (i|they|he|she) (be )?(fired|let go|terminated)\b/i,
  /\b(sue|lawyer|lawsuit|legal action|court|illegal|labor (code|department)|dole)\b/i,
  /pregnan|miscarr|cancer|depress|anxiety|mental health|suicid|burn ?out|panic|therap|diagnos|medical (condition|emergency)|family emergency|death in|passed away|\bsick (child|parent|mother|father)\b/i,
  /\b(my|our) (13th|salary|pay|payslip|overtime|holiday pay)\b.*\b(wrong|smaller|less|short|missing|incorrect|unfair|lower|not paid|underpaid|dispute)\b/i,
  /\b(smaller|less|lower|bigger|more)\b.*\b(than (my|his|her|a) (friend|colleague|coworker|co-worker|officemate)|than (others|everyone))/i,
  /friend'?s|underpaid|unpaid salary|wage (theft|dispute)|(my|a) pay dispute/i,
  /\b(scared|afraid|hopeless|desperate|can'?t cope|overwhelmed|stressed out|crying|unsafe|distress\w*)\b/i,
];
const PERSONAL_RE = [
  /\b(balance|remaining|left)\b.*\b(leave|credits?|vl|sl|days)\b|\b(leave|credits?|vl|sl)\b.*\b(balance|remaining)\b/i,
  /\bmy (current |exact |total )?(leave|vl|sl|credits?|salary|pay|payslip|13th|hmo|sss|philhealth|overtime|ot)\b.*\b(balance|how much|amount|total|left|remaining|is|are)\b/i,
  /\bhow (much|many)\b.*\b(do i have|have i|i have|is my|are my)\b/i,
  /\bhow much is my (salary|pay|13th|take.?home)\b|\bwhat('?s| is) my (salary|pay|rate|13th)\b/i,
  /\b(file|submit|apply|book) (a |my |me a )?(leave|vl|sl)\b.*\b(for me|please)\b/i,
];
const OFFTOPIC_RE = /\b(poem|poetry|joke|riddle|story|recipe|song|lyrics|weather|football|basketball|bitcoin|stocks?|translate|homework|code for|python|javascript)\b|ignore (all |your |the |any )?(previous |prior )?(rules|instructions|prompt)|system prompt|pretend (you|to)|you are now|jailbreak|\bwho (are|made) you\b|^(hi|hello|hey|thanks|thank you|ok|okay)[.! ]*$/i;

const norm = q => q.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function precheck(q) {
  if (SENSITIVE_RE.some(r => r.test(q))) return 'sensitive';
  if (PERSONAL_RE.some(r => r.test(q))) return 'personal_data';
  return null;
}
function isOfftopic(q) {
  const letters = (q.match(/[a-z]/gi) || []).length;
  if (letters < 3 || !/[aeiouy]/i.test(q) || /^(.)\1+$/.test(norm(q).replace(/ /g, ''))) return true;
  if (/^[a-z]{4,}$/i.test(q.trim()) && !/[aeiou]{1}/i.test(q)) return true;
  return OFFTOPIC_RE.test(q);
}

const REASON_TEXT = {
  not_covered: "I can't answer that from the handbook, so I've passed it to HR.",
  sensitive: "That sounds serious, and it's best handled by HR directly. I've passed this to Carla and she'll follow up.",
  personal_data: "I can't see personal records like balances or pay. I've passed your question to HR; you can also check the HR portal.",
};
const REPORT_RE = /harass|bully|bullied|bullying|discriminat|abus|retaliat|molest|assault|witness|shout|yell|scold|humiliat|threat|report/i;

function handoff(reason, question) {
  const cites = reason === 'sensitive' && REPORT_RE.test(question || '') && byId['HB-08'] ? ['HB-08'] : [];
  return { type: 'handoff', text: REASON_TEXT[reason] + (cites.length ? ' If you want to report it yourself, the handbook says to go to the HR Lead or use the confidential concern form.' : ''), citations: cites, reason };
}

// ---- Mock: fixed lookup; the 5 FAQ-seed questions (+ a few close variants) get canned, cited answers.
const MOCK = [
  { id: 'faq-wfh-holiday', all: [/work(ing)? from home|\bwfh\b/, /holiday/], cites: ['HB-04', 'HB-02'],
    text: "Yes, if you're scheduled to work that holiday, but you now need **your manager's approval** to work from home that day. Holiday pay rules (HB-02) apply the same whether you work from home or in the office." },
  { id: 'faq-wfh', all: [/work(ing)? from home|\bwfh\b/], cites: ['HB-04'],
    text: "If your role allows it, you can work from home **up to 2 days per week**. Book your WFH days in the WFH tracker by Friday for the following week; your team lead confirms them." },
  { id: 'faq-13th-formula', all: [/13th/, /formula|comput|calculat|how much|include|computed/], cites: ['HB-05'],
    text: "13th-month pay is **one-twelfth (1/12) of your total basic salary** earned during the year. Overtime, night differential, holiday premiums and allowances are not included." },
  { id: 'faq-13th', all: [/13th/], cites: ['HB-05'],
    text: "13th-month pay is released **on or before December 24**, usually together with the second December payroll." },
  { id: 'faq-grace', all: [/grace|late|tardy|tardiness|log ?in/], cites: ['HB-03'],
    text: "You get a **15-minute grace period** at the start of your shift. After that, it counts as tardiness and the late minutes are deducted from your pay." },
  { id: 'faq-hmo', all: [/hmo|dependent/], cites: ['HB-07'],
    text: "Submit the dependent form plus a marriage or birth certificate to HR during the **January open enrollment**, or within **30 days of a qualifying life event** (like marriage or birth). You can enroll up to 2 dependents. HMO is for regular employees." },
  { id: 'faq-leave', all: [/leave credits?|vacation|sick leave|\bvl\b|\bsl\b|leave days|how many leaves?|leaves do i/], none: [/paternity|maternity|solo parent|bereavement|parental|birthday|study|emergency/], cites: ['HB-01'],
    text: "Regular employees get **12 days of vacation leave and 10 days of sick leave per year**, accrued monthly. Probationary employees accrue credits too but can only use them after regularization." },
  { id: 'faq-holiday-pay', all: [/holiday pay|pay.*holiday|work(ing)? on a (regular )?holiday/], cites: ['HB-02'],
    text: "If you work on a regular holiday you get **200% of your daily rate** for the first 8 hours. On a special non-working day, working earns **130%**." },
];
function mockAnswer(q) {
  const s = norm(q);
  const hit = MOCK.find(m => m.all.every(r => r.test(s)) && !(m.none || []).some(r => r.test(s)));
  return hit ? { type: 'answer', text: hit.text, citations: hit.cites, reason: null } : handoff('not_covered', q);
}

// ---- Real: one OpenAI-compatible endpoint, whole handbook in the system prompt.
let sysPrompt;
function systemPrompt() {
  if (!sysPrompt) {
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'system.md'), 'utf8');
    const hbText = policies.map(p => `[${p.id}] ${p.title} (updated ${p.last_updated}${p.update_note ? ' — ' + p.update_note : ''})\n${p.body}`).join('\n\n');
    sysPrompt = tpl.replace('{{COMPANY}}', handbook.company).replace('{{HANDBOOK}}', hbText);
  }
  return sysPrompt;
}
async function realAnswer(q, history) {
  const base = (process.env.AI_BASE_URL || '').replace(/\/$/, ''), key = process.env.AI_API_KEY;
  if (!key || !base) throw new Error('no_key');
  const msgs = [{ role: 'system', content: systemPrompt() },
    ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.text).slice(0, 600) })),
    { role: 'user', content: q }];
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(base + '/chat/completions', { method: 'POST', signal: ctl.signal,
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.AI_MODEL, messages: msgs, temperature: 0, max_tokens: 1500, reasoning: { effort: 'low' }, response_format: { type: 'json_object' } }) });
    if (!r.ok) throw new Error('http_' + r.status);
    const j = await r.json();
    return parseModel(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, q);
  } finally { clearTimeout(t); }
}
function parseModel(raw, q) {
  let o;
  try { o = JSON.parse(String(raw).replace(/^```(?:json)?|```$/gm, '').trim()); } catch (e) { return handoff('not_covered', q); }
  return validate(o, q);
}

// ---- Server-enforced output contract (never trust the model).
function validate(o, q) {
  if (!o || typeof o !== 'object') return handoff('not_covered', q);
  const text = typeof o.text === 'string' ? o.text.trim().slice(0, 700) : '';
  const cites = [...new Set(Array.isArray(o.citations) ? o.citations.filter(c => typeof c === 'string' && byId[c]) : [])];
  if (o.type === 'offtopic') return { type: 'offtopic', text: "I can only help with Half Scale HR policy questions.", citations: [], reason: null };
  if (o.type === 'answer') {
    if (!text || !cites.length) return handoff('not_covered', q);
    return { type: 'answer', text, citations: cites, reason: null };
  }
  const reason = ['sensitive', 'personal_data', 'not_covered'].includes(o.reason) ? o.reason : 'not_covered';
  return handoff(reason, q);
}

function withNotes(r) {
  if (r.type !== 'answer') return r;
  const notes = r.citations.map(c => byId[c]).filter(p => p && p.update_note).map(p => `${p.id} was ${p.update_note}.`);
  return notes.length && !/updated today/i.test(r.text) ? { ...r, text: r.text + ' (' + notes.join(' ') + ')' } : r;
}
async function ask(a) { return withNotes(await ask0(a)); }
async function ask0({ question, history, mode }) {
  const pre = precheck(question);
  if (pre) return handoff(pre, question);
  if (mode === 'fail') throw new Error('forced_fail');
  if (mode === 'real') return realAnswer(question, history);
  if (isOfftopic(question)) return { type: 'offtopic', text: "I can only help with Half Scale HR policy questions.", citations: [], reason: null };
  const m = mockAnswer(question);
  if (m.type === 'handoff' && norm(question).split(' ').length === 1) return { type: 'offtopic', text: "I can only help with Half Scale HR policy questions.", citations: [], reason: null };
  return m;
}
module.exports = { ask, precheck, validate, norm, handoff, systemPrompt };
