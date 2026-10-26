// Persistence: one JSON document {counter, handoffs[]}. File by default; Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
const fs = require('fs'), path = require('path'), os = require('os');
const NOW = () => Date.now();
const ago = ms => new Date(NOW() - ms).toISOString();
const H = 3600e3;

function seed() {
  const mk = (n, name, question, reason, created, extra = {}) => ({
    id: 'Q-' + String(n).padStart(4, '0'), question, employee_name: name, session_id: 'seed',
    reason, sensitive: reason === 'sensitive', context: [], status: 'open', created_at: created,
    closed_at: null, hr_reply: null, ...extra });
  return { counter: 4, handoffs: [
    mk(1, 'Raj', 'How many days of paternity leave do I get?', 'not_covered', ago(26 * H)),
    mk(2, 'Mia', 'Is December 25 a holiday this year?', 'not_covered', ago(4 * H)),
    mk(3, 'Ana', 'My manager keeps shouting at me and I want to report him', 'sensitive', ago(2 * H),
      { context: [{ role: 'user', text: "I'm not sure what to do." }, { role: 'assistant', text: "That sounds serious. It's best handled by HR directly." }] }),
    mk(4, 'Leo', "What's my current leave balance?", 'personal_data', ago(30 * H),
      { status: 'closed', closed_at: ago(28 * H), hr_reply: 'Check your balance in the HR portal; if it looks wrong, message me.' }),
  ] };
}

const blobTok = process.env.BLOB_READ_WRITE_TOKEN;
const file = process.env.STATE_FILE || (process.env.VERCEL ? '/tmp/askhr-state.json' : path.join(__dirname, '..', 'data', 'state.json'));
let mem = null, blobUrl = null;

async function load() {
  if (blobTok) {
    try {
      if (!blobUrl) {
        const r = await fetch('https://blob.vercel-storage.com/?prefix=askhr-state&limit=1', { headers: { authorization: 'Bearer ' + blobTok } });
        const j = await r.json(); blobUrl = j.blobs && j.blobs[0] && j.blobs[0].url;
      }
      if (blobUrl) { const r = await fetch(blobUrl + '?v=' + NOW() + Math.random()); if (r.ok) return await r.json(); }
    } catch (e) { /* fall through to seed */ }
    return seed();
  }
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { mem = seed(); }
  return mem;
}
async function save(state) {
  if (blobTok) {
    const r = await fetch('https://blob.vercel-storage.com/askhr-state.json', { method: 'PUT',
      headers: { authorization: 'Bearer ' + blobTok, 'x-add-random-suffix': '0', 'x-allow-overwrite': '1',
        'x-cache-control-max-age': '60', 'content-type': 'application/json' }, body: JSON.stringify(state) });
    const j = await r.json(); if (j.url) blobUrl = j.url; return;
  }
  mem = state;
  try { fs.writeFileSync(file, JSON.stringify(state)); } catch (e) { /* read-only FS: memory only */ }
}

// serialize mutations within one process
let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(async () => { const s = await load(); const out = await fn(s); await save(s); return out; });
  chain = run.catch(() => {}); return run;
}
module.exports = { load, mutate, seed, save };
