const crypto = require('crypto');
const { handbook, byId, faq } = require('./handbook');
const store = require('./store');
const assistant = require('./assistant');

const SECRET = process.env.HR_SECRET || crypto.createHash('sha256').update('askhr|' + (process.env.HR_PIN || 'hr-demo') + '|' + (process.env.AI_API_KEY || '')).digest('hex');
const HR_PIN = () => process.env.HR_PIN || 'hr-demo';
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const makeToken = () => { const exp = Date.now() + 12 * 3600e3; return exp + '.' + sign('hr' + exp); };
function validToken(t) {
  if (typeof t !== 'string') return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign('hr' + exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const E = (s, c, m) => new HttpError(s, c, m);

// effective mode for a request: ?ai=fail|real (per session) else AI_MODE env (default mock)
function modeFor(ai) {
  if (ai === 'fail') return 'fail';
  if (ai === 'real') return 'real';
  return process.env.AI_MODE === 'real' ? 'real' : 'mock';
}

// in-memory (best effort on serverless) rate limit + answer cache
const hits = new Map(); const cache = new Map();
function rateLimit(sid) {
  const now = Date.now(), arr = (hits.get(sid) || []).filter(t => now - t < 3600e3);
  if (arr.length >= 20) throw E(429, 'rate_limited', "You've asked a lot of questions. Try again in a bit.");
  arr.push(now); hits.set(sid, arr);
  if (hits.size > 5000) hits.clear();
}

const cleanName = n => (typeof n === 'string' && n.trim() ? n.trim().replace(/\s+/g, ' ').slice(0, 60) : 'Anonymous');
const cleanHistory = h => (Array.isArray(h) ? h : []).filter(x => x && typeof x.text === 'string' && x.text.trim())
  .slice(-4).map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', text: x.text.slice(0, 600) }));
const citeObjs = ids => ids.map(id => ({ id, title: byId[id].title }));

async function ask(body, ai) {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) throw E(400, 'invalid_question', 'Please ask a question between 1 and 500 characters.');
  const sid = typeof body.session_id === 'string' && body.session_id ? body.session_id.slice(0, 80) : 'anon';
  rateLimit(sid);
  const mode = modeFor(ai), history = cleanHistory(body.history);
  let result;
  const key = mode + '|' + assistant.norm(question);
  const cacheable = mode === 'real' && !history.length;
  if (cacheable && cache.has(key)) result = cache.get(key);
  else {
    try { result = await assistant.ask({ question, history, mode }); }
    catch (e) { throw E(502, 'ai_unavailable', "I couldn't check the handbook just now. Your question hasn't been sent to HR."); }
    if (cacheable && result.type !== 'handoff') { if (cache.size > 500) cache.clear(); cache.set(key, result); }
  }
  let handoffId = null;
  if (result.type === 'handoff') {
    const ctx = history.slice(-4);
    const h = await store.mutate(async s => {
      s.counter = (s.counter || 0) + 1;
      const rec = { id: 'Q-' + String(s.counter).padStart(4, '0'), question, employee_name: cleanName(body.name), session_id: sid,
        reason: result.reason, sensitive: result.reason === 'sensitive', context: ctx, status: 'open',
        created_at: new Date().toISOString(), closed_at: null, hr_reply: null };
      s.handoffs.push(rec); return rec;
    });
    handoffId = h.id;
  }
  return { type: result.type, text: result.text, citations: citeObjs(result.citations), reason: result.reason, handoff_id: handoffId, mode };
}

const sortHr = (a, b) => (b.sensitive - a.sensitive) || (b.created_at > a.created_at ? 1 : -1);

async function route(method, path, q, body, headers, ai) {
  if (method === 'GET' && path === '/api/config')
    return { company: handbook.company, handbook_version: handbook.handbook_version, mode: modeFor(ai), faq };
  if (method === 'POST' && path === '/api/ask') return ask(body || {}, ai);
  let m;
  if (method === 'GET' && (m = path.match(/^\/api\/policies\/([\w-]+)$/))) {
    const p = byId[m[1].toUpperCase()]; if (!p) throw E(404, 'not_found', 'Policy not found');
    return { ...p, handbook_version: handbook.handbook_version };
  }
  if (method === 'GET' && (m = path.match(/^\/api\/handoffs\/(Q-\d+)$/))) {
    const s = await store.load(); const h = s.handoffs.find(x => x.id === m[1]);
    if (!h || !q.session_id || h.session_id !== q.session_id) throw E(404, 'not_found', 'Not found');
    return { id: h.id, status: h.status, hr_reply: h.hr_reply, closed_at: h.closed_at };
  }
  if (method === 'POST' && path === '/api/hr/login') {
    const pin = body && typeof body.pin === 'string' ? body.pin : '';
    const a = Buffer.from(sign(pin)), b = Buffer.from(sign(HR_PIN()));
    if (!crypto.timingSafeEqual(a, b)) throw E(401, 'unauthorized', 'The PIN didn’t match.');
    return { token: makeToken() };
  }
  if (path.startsWith('/api/hr/')) {
    const t = (headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!validToken(t)) throw E(401, 'unauthorized', 'Sign in required.');
    if (method === 'GET' && path === '/api/hr/handoffs') {
      const s = await store.load();
      const counts = { open: 0, closed: 0 }; s.handoffs.forEach(h => counts[h.status]++);
      let items = s.handoffs.slice();
      if (q.status === 'open' || q.status === 'closed') items = items.filter(h => h.status === q.status);
      items.sort(q.status === 'closed' ? (a, b) => ((b.closed_at || '') > (a.closed_at || '') ? 1 : -1) : sortHr);
      return { items, counts };
    }
    if (method === 'POST' && (m = path.match(/^\/api\/hr\/handoffs\/(Q-\d+)\/close$/))) {
      const reply = body && typeof body.reply === 'string' ? body.reply.trim().slice(0, 2000) : '';
      const noReply = body && body.no_reply === true;
      return store.mutate(async s => {
        const h = s.handoffs.find(x => x.id === m[1]); if (!h) throw E(404, 'not_found', 'Not found');
        if (h.status === 'closed') return h;
        if (!reply && !noReply) throw E(400, 'reply_required', 'Write a reply, or choose "Close without reply".');
        h.status = 'closed'; h.closed_at = new Date().toISOString(); h.hr_reply = reply || null; return h;
      });
    }
    if (method === 'POST' && path === '/api/hr/reset-demo') {
      await store.mutate(async s => { Object.assign(s, store.seed()); cache.clear(); hits.clear(); });
      return null;
    }
  }
  throw E(404, 'not_found', 'Unknown endpoint');
}

// Node http-style handler (used by server.js and the Vercel function)
module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const q = Object.fromEntries(url.searchParams);
  const ai = req.headers['x-ai-mode'] || q.ai || '';
  const send = (status, obj) => {
    res.statusCode = status;
    if (obj === null) return res.end();
    res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  try {
    let body = req.body;
    if (body === undefined && req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 50000) throw E(413, 'too_large', 'Request too large'); chunks.push(c); }
      const raw = Buffer.concat(chunks).toString('utf8');
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { throw E(400, 'bad_json', 'Invalid JSON'); }
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const out = await route(req.method, url.pathname.replace(/\/$/, ''), q, body, req.headers, ai);
    if (out === null) return send(204, null);
    send(200, out);
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: { code: e.code, message: e.message } });
    console.error('server error', e && e.message);
    send(500, { error: { code: 'server_error', message: 'Something went wrong.' } });
  }
};
module.exports.route = route;
