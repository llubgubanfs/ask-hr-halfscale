// Runs the spec fixtures (api-and-data §5) against mock mode. `node test/fixtures.test.js`
process.env.STATE_FILE = require('os').tmpdir() + '/askhr-test-' + process.pid + '.json';
const app = require('../lib/app'); const { faq } = require('../lib/handbook');
let fail = 0;
const ask = async (question, extra = {}) => { try { return await app.route('POST', '/api/ask', {}, { question, session_id: 't' + Math.random(), ...extra }, {}, extra.ai); } catch (e) { return { error: e.code }; } };
const check = (name, ok, got) => { if (!ok) { fail++; console.log('FAIL', name, JSON.stringify(got)); } else console.log('ok  ', name); };
(async () => {
  for (const f of faq) { const r = await ask(f.question); check(f.id, r.type === 'answer' && r.citations.some(c => c.id === f.policy_id), r); }
  const exp = [
    ['Can I bring my dog to the office?', 'handoff', 'not_covered'], ["What's my leave balance?", 'handoff', 'personal_data'],
    ['My manager keeps shouting at me and I want to report him', 'handoff', 'sensitive'], ['I think I\'m being discriminated against', 'handoff', 'sensitive'],
    ['Can I be terminated for being late 6 times?', 'handoff', 'sensitive'], ['Why is my 13th month smaller than my friend\'s?', 'handoff', 'sensitive'],
    ["I'm pregnant, what should I do?", 'handoff', 'sensitive'], ['How many days of paternity leave do I get?', 'handoff', 'not_covered'],
    ['Is December 25 a holiday this year?', 'handoff', 'not_covered'], ['What is the 13th month formula?', 'answer', null], ['write me a poem', 'offtopic', null], ['asdf', 'offtopic', null],
    ['Can I work from home on a holiday and also my manager harasses me', 'handoff', 'sensitive'] ];
  for (const [q, type, reason] of exp) { const r = await ask(q); check(q, r.type === type && (!reason || r.reason === reason) && (type !== 'handoff' || r.handoff_id) && (type === 'answer' || r.citations.every(c => c.id === 'HB-08')), r); }
  const r13 = await ask('What is the 13th month formula?'); check('13th→HB-05', r13.citations[0] && r13.citations[0].id === 'HB-05', r13);
  const poem = await ask('write me a poem'); check('offtopic no handoff', !poem.handoff_id, poem);
  check('501 chars', (await ask('a'.repeat(501))).error === 'invalid_question');
  check('?ai=fail → 502', (await ask('How many leave credits do I get?', { ai: 'fail' })).error === 'ai_unavailable');
  check('real w/o key → 502', (await ask('How many leave credits do I get?', { ai: 'real' })).error === 'ai_unavailable' || !!process.env.AI_API_KEY);
  const tok = (await app.route('POST', '/api/hr/login', {}, { pin: 'hr-demo' }, {})).token;
  const H = { authorization: 'Bearer ' + tok };
  const list = await app.route('GET', '/api/hr/handoffs', { status: 'open' }, null, H);
  check('sensitive first', list.items[0].sensitive === true, list.items[0]);
  const id = list.items[0].id;
  check('reply_required', await app.route('POST', `/api/hr/handoffs/${id}/close`, {}, { reply: '' }, H).catch(e => e.code) === 'reply_required');
  const c1 = await app.route('POST', `/api/hr/handoffs/${id}/close`, {}, { reply: 'ok' }, H), c2 = await app.route('POST', `/api/hr/handoffs/${id}/close`, {}, { reply: 'again' }, H);
  check('close idempotent', c1.status === 'closed' && c2.hr_reply === 'ok');
  check('unauth 401', await app.route('GET', '/api/hr/handoffs', {}, null, {}).catch(e => e.status) === 401);
  await app.route('POST', '/api/hr/reset-demo', {}, null, H);
  const after = await app.route('GET', '/api/hr/handoffs', {}, null, H); check('reset → 4 seed, 3 open', after.items.length === 4 && after.counts.open === 3, after.counts);
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
