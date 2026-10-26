(function () {
  'use strict';
  const $app = document.getElementById('app'), $toast = document.getElementById('toast');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} } };
  const rid = p => p + Math.random().toString(36).slice(2, 10);
  function toast(t) { $toast.textContent = t; $toast.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $toast.hidden = true, 2800); }
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // ?ai=real|fail switches this browser session (kept for the tab)
  const qai = new URLSearchParams(location.search).get('ai');
  if (qai === 'real' || qai === 'fail') ss.set('askhr.ai', qai); else if (qai === 'mock') ss.set('askhr.ai', null);
  const AI = ss.get('askhr.ai') || '';
  async function api(method, url, body, token) {
    const h = { 'content-type': 'application/json' };
    if (AI) h['x-ai-mode'] = AI; if (token) h.authorization = 'Bearer ' + token;
    const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Request failed'); e.status = r.status; e.code = j.error && j.error.code; throw e; }
    return j;
  }
  const brand = sub => `<div class="brand-lockup"><span class="brand-mark" aria-hidden="true">✦</span><div><strong>Ask HR</strong><small>${esc(sub)}</small></div></div>`;
  const isHR = location.pathname.replace(/\/$/, '') === '/hr';
  isHR ? hrApp() : employeeApp();

  /* ================= Employee ================= */
  async function employeeApp() {
    let cfg = { company: 'Half Scale Inc.', handbook_version: '', mode: 'mock', faq: [] };
    try { cfg = await api('GET', '/api/config'); } catch (e) {}
    let sid = ls.get('askhr.session_id'); if (!sid) { sid = rid('s_'); ls.set('askhr.session_id', sid); }
    let name = ls.get('askhr.name', null);
    let msgs = []; try { msgs = JSON.parse(ls.get('askhr.chat.v1', '[]')) || []; } catch (e) {}
    let busy = false, sheetFrom = null, lastQ = null;
    const save = () => ls.set('askhr.chat.v1', JSON.stringify(msgs.slice(-60)));

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    if (name === null) return entry();
    chat();

    function entry() {
      $app.innerHTML = `<div class="center-screen"><div class="card"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true">✦</span><div><strong>Ask HR</strong><small>${esc(cfg.company)}</small></div></div>
        <h1>Answers from your handbook, right when you need them.</h1><p class="muted">Ask about leave, work arrangements, pay or benefits. If it needs a person, we’ll bring HR in.</p>
        <form id="f"><label class="lbl" for="nm">What should HR call you? <span class="muted" style="font-weight:500">(optional)</span></label>
        <input id="nm" class="field" placeholder="Your name" autocomplete="name" maxlength="60">
        <button class="btn primary block" type="submit">Continue →</button></form>
        <div style="text-align:center;margin-top:6px"><button class="linkbtn" id="anon" type="button">Continue as Anonymous</button></div>
        <p class="muted" style="border-top:1px solid var(--line);margin:18px 0 0;padding-top:14px;font-size:14px">HR staff? <a href="/hr" style="color:var(--teal);font-weight:800">Sign in to the inbox</a></p></div></div>`;
      const go = v => { name = v || 'Anonymous'; ls.set('askhr.name', name); chat(); };
      document.getElementById('f').onsubmit = e => { e.preventDefault(); go(document.getElementById('nm').value.trim()); };
      document.getElementById('anon').onclick = () => go('');
    }

    function chat() {
      const pill = cfg.mode === 'mock' ? '<span class="pill">Demo mode</span>' : cfg.mode === 'real' ? '<span class="pill real">Live AI</span>' : '<span class="pill fail">Test: AI failing</span>';
      $app.innerHTML = `<div class="chat" id="chat"><header class="chat-header">${brand(cfg.company)}<button class="quiet" id="new">New chat</button></header>
        <div class="chat-scroll" id="scroll"><div id="list" aria-live="polite" aria-relevant="additions"></div></div>
        <div class="composer-wrap"><form class="composer" id="form"><label class="sr-only" for="q">Ask a policy question</label>
        <textarea id="q" rows="1" maxlength="500" placeholder="Ask a policy question" enterkeyhint="send"></textarea>
        <button class="send" id="send" aria-label="Send" type="submit">↑</button></form>
        <div class="foot">Based on handbook v${esc(cfg.handbook_version)}${pill}</div></div></div>`;
      const $q = document.getElementById('q'), $form = document.getElementById('form');
      $form.onsubmit = e => { e.preventDefault(); submit($q.value); };
      $q.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit($q.value); } };
      $q.oninput = () => { $q.style.height = '46px'; $q.style.height = Math.min($q.scrollHeight, 120) + 'px'; };
      document.getElementById('new').onclick = () => { msgs = []; save(); render(); $q.focus(); };
      render(); poll(); clearInterval(chat.t); chat.t = setInterval(poll, 20000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    }

    function citeBtns(cs) { return cs && cs.length ? `<div class="cites">${cs.map(c => `<button class="cite" data-pid="${esc(c.id)}">${esc(c.id)} · ${esc(c.title)} ↗</button>`).join('')}</div>` : ''; }
    function msgHtml(m) {
      if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
      if (m.kind === 'answer') return `<article class="msg answer"><div class="kicker">✦ ASK HR</div><p>${md(m.text)}</p><div class="src-label">SOURCES</div>${citeBtns(m.citations)}<p class="disclaimer">Based on the handbook. For your own case, ask HR.</p></article>`;
      if (m.kind === 'offtopic') return `<div class="msg offtopic">${esc(m.text)}</div>`;
      if (m.kind === 'error') return `<div class="msg error" role="alert"><strong>Something went wrong.</strong><span>${esc(m.text)}</span><button data-retry="1">Retry</button></div>`;
      if (m.kind === 'handoff') {
        const sens = m.reason === 'sensitive';
        if (m.status === 'closed') return `<article class="handoff replied ${sens ? 'sens' : ''}"><div class="slabel">${m.hr_reply ? '✓ HR REPLIED' : '✓ CLOSED'} · ${esc(m.handoff_id)}</div>${m.hr_reply ? `<p class="reply-quote">${esc(m.hr_reply)}</p>` : '<p>HR has closed this question.</p>'}</article>`;
        return `<article class="handoff ${sens ? 'sens' : ''}">${sens ? '<div class="slabel">⚐ SENSITIVE MATTER</div>' : ''}<h3>${sens ? 'That sounds serious.' : 'I’ve passed this to HR.'}</h3><p>${esc(m.text)}</p>${citeBtns(m.citations)}<div class="hmeta"><strong>Ref ${esc(m.handoff_id)}</strong><span>● Waiting for HR</span></div><p style="font-size:13px;margin:6px 0 0">${m.reason === 'personal_data' ? 'They’ll reply here.' : 'They’ll reply here when they can.'}</p></article>`;
      }
      return `<div class="msg answer">${esc(m.text)}</div>`;
    }
    function render() {
      const list = document.getElementById('list'); if (!list) return;
      let h = '';
      if (!msgs.length) h += `<div class="greet"><span class="brand-mark" aria-hidden="true">✦</span><h2>Hi${name && name !== 'Anonymous' ? ', ' + esc(name) : ''}, I’m Ask HR.</h2><p>I answer from the handbook and show you the source. If it needs a person, I’ll pass it to HR.</p>
        <p class="chips-label">TRY A COMMON QUESTION</p><div class="chips">${cfg.faq.map(f => `<button data-faq="${esc(f.question)}">${esc(f.question)} <span aria-hidden="true">↗</span></button>`).join('')}</div></div>`;
      h += msgs.map(msgHtml).join('');
      if (busy) h += '<div class="typing" role="status"><i></i><i></i><i></i><span>Checking the handbook…</span></div>';
      list.innerHTML = h;
      list.querySelectorAll('[data-faq]').forEach(b => b.onclick = () => submit(b.dataset.faq));
      list.querySelectorAll('[data-pid]').forEach(b => b.onclick = () => openSheet(b.dataset.pid, b));
      list.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => { msgs = msgs.filter(m => m.kind !== 'error'); save(); if (lastQ) { const q = lastQ; msgs = msgs.filter((m, i) => !(i === msgs.length - 1 && m.role === 'user' && m.text === q)); submit(q); } });
      const sc = document.getElementById('scroll'); sc.scrollTop = sc.scrollHeight;
    }

    async function submit(text) {
      text = (text || '').trim(); if (!text || busy) return;
      if (text.length > 500) return toast('Please keep questions under 500 characters.');
      const $q = document.getElementById('q'); $q.value = ''; $q.style.height = '46px';
      const history = msgs.filter(m => m.kind !== 'error' && (m.role === 'user' || m.kind === 'answer' || m.kind === 'handoff' || m.kind === 'offtopic')).slice(-4).map(m => ({ role: m.role, text: m.text }));
      msgs.push({ id: rid('m'), role: 'user', kind: 'text', text, ts: new Date().toISOString() }); lastQ = text; busy = true; save(); render();
      try {
        const r = await api('POST', '/api/ask', { question: text, history, name, session_id: sid });
        const kind = r.type === 'answer' ? 'answer' : r.type === 'handoff' ? 'handoff' : 'offtopic';
        msgs.push({ id: rid('m'), role: 'assistant', kind, text: r.text, citations: r.citations, reason: r.reason, handoff_id: r.handoff_id, status: 'open', ts: new Date().toISOString() });
      } catch (e) {
        const text2 = e.code === 'rate_limited' ? e.message : e.code === 'invalid_question' ? e.message : e.message || 'I couldn’t check the handbook. Your question hasn’t been sent to HR.';
        msgs.push({ id: rid('m'), role: 'assistant', kind: 'error', text: text2, ts: new Date().toISOString() });
      }
      busy = false; save(); render(); const q2 = document.getElementById('q'); if (q2) q2.focus();
    }

    async function poll() {
      let changed = false;
      for (const m of msgs.filter(m => m.kind === 'handoff' && m.status !== 'closed' && m.handoff_id)) {
        try {
          const r = await fetch(`/api/handoffs/${encodeURIComponent(m.handoff_id)}?session_id=${encodeURIComponent(sid)}`, { cache: 'no-store' });
          if (!r.ok) continue; const j = await r.json();
          if (j.status === 'closed') { m.status = 'closed'; m.hr_reply = j.hr_reply; changed = true; }
        } catch (e) {}
      }
      if (changed) { save(); render(); }
    }

    async function openSheet(id, trigger) {
      closeSheet(true); sheetFrom = trigger;
      const wrap = document.getElementById('chat');
      wrap.insertAdjacentHTML('beforeend', `<div class="scrim" id="scrim"></div><aside class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="Policy source"><div class="handle"></div><button class="x" id="sx" aria-label="Close source">×</button><div id="sbody"><p class="muted">Loading…</p></div></aside>`);
      document.getElementById('scrim').onclick = () => closeSheet(); document.getElementById('sx').onclick = () => closeSheet();
      document.getElementById('sx').focus();
      try {
        const p = await api('GET', '/api/policies/' + encodeURIComponent(id));
        document.getElementById('sbody').innerHTML = `<div class="sid">${esc(p.id)}</div><h2>${esc(p.title)}</h2><p class="upd">Last updated ${esc(p.last_updated)} · Handbook v${esc(p.handbook_version)}</p><hr><div class="body">${esc(p.body)}</div>`;
      } catch (e) { document.getElementById('sbody').innerHTML = '<p class="err">Couldn’t load this policy.</p>'; }
    }
    function closeSheet(quiet) {
      const s = document.getElementById('sheet'); if (s) { s.remove(); document.getElementById('scrim').remove(); }
      if (!quiet && sheetFrom && document.contains(sheetFrom)) sheetFrom.focus(); else if (!quiet) { const q = document.getElementById('q'); q && q.focus(); }
    }
  }

  /* ================= HR ================= */
  function hrApp() {
    let token = ss.get('askhr.hr'), tab = 'open', data = { items: [], counts: { open: 0, closed: 0 } }, sel = null, detailOpen = false, confirming = false, sending = false;
    token ? load(true) : signin();

    function signin(err) {
      $app.innerHTML = `<div class="center-screen"><div class="card" style="width:min(100%,440px)"><div class="brand-lockup"><span class="brand-mark" aria-hidden="true">✦</span><div><strong>Ask HR</strong><small>HR workspace</small></div></div>
        <div class="eyebrow" style="margin-top:22px">HR inbox</div><h1>Welcome back, Carla.</h1><p class="muted">Enter the shared HR PIN to view employee questions.</p>
        <form id="f"><label class="lbl" for="pin">HR PIN</label><input id="pin" class="field" type="password" autocomplete="current-password" required>
        <p class="err" id="e" role="alert" ${err ? '' : 'hidden'}>${esc(err || '')}</p><button class="btn primary block" type="submit">Sign in →</button></form>
        <div style="text-align:center;margin-top:8px"><a class="linkbtn" style="display:inline-flex;align-items:center" href="/">← Back to Ask HR</a></div></div></div>`;
      document.getElementById('pin').focus();
      document.getElementById('f').onsubmit = async e => {
        e.preventDefault();
        try { const r = await api('POST', '/api/hr/login', { pin: document.getElementById('pin').value }); token = r.token; ss.set('askhr.hr', token); load(true); }
        catch (x) { signin('The PIN didn’t match. Please try again.'); }
      };
    }

    async function load(first) {
      try {
        const [o, c] = await Promise.all([api('GET', '/api/hr/handoffs?status=open', null, token), api('GET', '/api/hr/handoffs?status=closed', null, token)]);
        data = { open: o.items, closed: c.items, counts: o.counts };
      } catch (e) { if (e.status === 401) { token = null; ss.set('askhr.hr', null); return signin(); } if (first) toast('Couldn’t load the inbox.'); return; }
      if (sel && !(data.open.concat(data.closed)).find(h => h.id === sel)) sel = null;
      if (!sel && window.innerWidth >= 1024 && data[tab].length) sel = data[tab][0].id;
      if (!document.getElementById('hr-list') || first) shell();
      paint();
    }

    function shell() {
      $app.innerHTML = `<div class="hr"><header class="hr-header">${brand('HR inbox · Half Scale Inc.')}<div class="hr-actions"><button class="ghost" id="reset">↻ Reset demo data</button><button class="ghost" id="out">Sign out</button></div></header>
        <div class="hr-body" id="body"><section class="list" aria-label="Inbox"><div class="tabs" role="tablist"><button class="tab" role="tab" id="t-open" data-t="open"></button><button class="tab" role="tab" id="t-closed" data-t="closed"></button></div><div id="hr-list"></div></section><section class="detail" id="detail" aria-live="polite"></section></div></div>`;
      document.querySelectorAll('.tab').forEach(b => b.onclick = () => { tab = b.dataset.t; sel = null; detailOpen = false; if (window.innerWidth >= 1024 && data[tab].length) sel = data[tab][0].id; paint(); });
      document.getElementById('out').onclick = () => { token = null; ss.set('askhr.hr', null); signin(); };
      document.getElementById('reset').onclick = async () => {
        if (!confirm('Reset demo data? This clears all tickets and restores the 4 seed items.')) return;
        try { await api('POST', '/api/hr/reset-demo', null, token); sel = null; detailOpen = false; tab = 'open'; await load(); toast('Demo data reset'); } catch (e) { toast('Reset failed'); }
      };
      clearInterval(shell.t); shell.t = setInterval(() => { if (!sending && !document.activeElement.matches('textarea')) load(); }, 30000);
    }

    function paint() {
      document.getElementById('t-open').innerHTML = `Open <span class="count">${data.counts.open}</span>`;
      document.getElementById('t-closed').innerHTML = `Closed <span class="count">${data.counts.closed}</span>`;
      document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.t === tab));
      const items = data[tab];
      document.getElementById('hr-list').innerHTML = items.length ? items.map(h => `<button class="row" data-id="${esc(h.id)}" ${h.id === sel ? 'aria-current="true"' : ''}><div style="min-width:0;flex:1"><div class="rtop"><strong>${h.sensitive ? '⚐ ' : ''}${esc(h.id)}</strong>${h.sensitive ? '<span class="badge sens">Sensitive</span>' : `<span class="badge">${h.reason === 'personal_data' ? 'Personal data' : 'Not in handbook'}</span>`}</div><p>${esc(h.question)}</p><small>${esc(h.employee_name)} · ${ago(h.created_at)} · ${h.status === 'open' ? '● Open' : '✓ Closed'}</small></div></button>`).join('')
        : `<div class="empty"><span class="ok">✓</span><strong>${tab === 'open' ? 'Nothing waiting.' : 'Nothing closed yet.'}</strong>${tab === 'open' ? 'All caught up.' : ''}</div>`;
      document.querySelectorAll('.row').forEach(b => b.onclick = () => { sel = b.dataset.id; detailOpen = true; confirming = false; paint(); });
      document.getElementById('body').classList.toggle('detail-open', detailOpen && !!sel);
      detail();
    }

    function detail() {
      const el = document.getElementById('detail'), h = data.open.concat(data.closed).find(x => x.id === sel);
      if (!h) { el.innerHTML = '<div class="empty"><strong>Select a question</strong>to read it and reply.</div>'; return; }
      const prev = (el.querySelector('textarea') || {}).value || '';
      const ctx = (h.context || []).length ? h.context.map(c => `<div class="ctx"><b>${c.role === 'user' ? esc(h.employee_name) : 'Ask HR'}</b><p>${esc(c.text).replace(/\*\*/g, '')}</p></div>`).join('') : '<p class="muted">No earlier messages.</p>';
      el.innerHTML = `<button class="linkbtn back" id="back">← Inbox</button><div class="eyebrow">${h.status === 'open' ? 'Open question' : 'Closed'}</div>
        <h1>${esc(h.id)} ${h.sensitive ? '<span class="badge sens">⚐ Sensitive</span>' : `<span class="badge">${h.reason === 'personal_data' ? 'Personal data' : 'Not in handbook'}</span>`}</h1>
        <p class="muted" style="margin:0">${esc(h.employee_name)} · ${ago(h.created_at)} (${esc(new Date(h.created_at).toLocaleString())})</p>
        <h2>Question</h2><blockquote>“${esc(h.question)}”</blockquote>
        <h2>Conversation before handoff <span style="font-weight:500">${(h.context || []).length} messages</span></h2>${ctx}
        ${h.status === 'open' ? `<div class="reply"><h2>Your reply <span style="font-weight:500">· required to close</span></h2><label class="sr-only" for="reply">Your reply</label><textarea id="reply" class="field" placeholder="Write a reply to ${esc(h.employee_name)}…" maxlength="2000">${esc(prev)}</textarea>
          <div class="actions">${confirming ? '<span class="muted" style="align-self:center">Close with no reply?</span><button class="btn" id="cancel">Cancel</button><button class="btn" id="confirm">Yes, close</button>' : '<button class="btn" id="noreply">Close without reply</button>'}<button class="btn primary" id="send" disabled>Send reply &amp; close →</button></div></div>`
          : `<h2>HR reply · closed ${ago(h.closed_at)}</h2><div class="readonly">${h.hr_reply ? esc(h.hr_reply) : '<span class="muted">Closed without a reply.</span>'}</div>`}`;
      const back = document.getElementById('back'); back.onclick = () => { detailOpen = false; paint(); };
      if (h.status !== 'open') return;
      const ta = document.getElementById('reply'), send = document.getElementById('send');
      ta.oninput = () => send.disabled = !ta.value.trim() || sending; send.disabled = !ta.value.trim();
      send.onclick = () => close(h, { reply: ta.value.trim() });
      const nr = document.getElementById('noreply'); if (nr) nr.onclick = () => { confirming = true; detail(); };
      const cf = document.getElementById('confirm'); if (cf) cf.onclick = () => close(h, { reply: '', no_reply: true });
      const cn = document.getElementById('cancel'); if (cn) cn.onclick = () => { confirming = false; detail(); };
    }

    async function close(h, body) {
      if (sending) return; sending = true;
      document.querySelectorAll('.actions button').forEach(b => b.disabled = true);
      try { await api('POST', `/api/hr/handoffs/${encodeURIComponent(h.id)}/close`, body, token); confirming = false; toast(h.id + ' closed'); sel = null; detailOpen = false; sending = false; await load(); }
      catch (e) { sending = false; toast(e.message || 'Could not close'); detail(); }
    }
  }
})();
