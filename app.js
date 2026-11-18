/* Nutrition Log — single-file app. Data lives in localStorage and syncs to one
   secret GitHub Gist, so the trainer's view-only link always shows the latest log. */
(() => {
  'use strict';

  // ---------- constants ----------
  const STORE_KEY = 'nl.data.v1';
  const LOCAL_KEY = 'nl.local.v1';      // device-only: token, gist id, trainer phone, role
  const GIST_FILE = 'nutrition-log.json';
  const MEALS = [
    { id: 'breakfast', en: 'Breakfast', id_: 'Sarapan' },
    { id: 'lunch', en: 'Lunch', id_: 'Makan siang' },
    { id: 'dinner', en: 'Dinner', id_: 'Makan malam' },
    { id: 'snack', en: 'Snacks', id_: 'Snack' },
  ];
  // Starter list: approximate values from common nutrition tables. Edit to match your labels/portions.
  const STARTER_FOODS = [
    ['Nasi putih', '100 g, ≈½ piring', 130, 2.7, 28, 0.3],
    ['Nasi merah', '100 g', 110, 2.6, 23, 0.9],
    ['Dada ayam panggang', '100 g', 165, 31, 0, 3.6],
    ['Telur rebus', '1 butir', 78, 6.3, 0.6, 5.3],
    ['Putih telur', '1 butir', 17, 3.6, 0.2, 0.1],
    ['Tempe', '100 g', 192, 20, 7.6, 11],
    ['Tahu', '100 g', 76, 8, 1.9, 4.8],
    ['Daging sapi tanpa lemak', '100 g', 217, 26, 0, 12],
    ['Ikan fillet (dori/kakap)', '100 g', 100, 20, 0, 2],
    ['Whey protein', '1 scoop (30 g)', 120, 24, 3, 1.5],
    ['Oatmeal', '40 g', 150, 5, 27, 2.5],
    ['Pisang', '1 buah sedang', 105, 1.3, 27, 0.4],
    ['Ubi rebus', '100 g', 86, 1.6, 20, 0.1],
    ['Kentang rebus', '100 g', 87, 1.9, 20, 0.1],
    ['Alpukat', '½ buah, 100 g', 160, 2, 9, 15],
    ['Sayur tumis', '1 mangkuk', 80, 3, 8, 4],
    ['Susu UHT full cream', '250 ml', 150, 8, 12, 8],
    ['Greek yogurt plain', '150 g', 145, 15, 6, 6],
    ['Indomie goreng', '1 bungkus', 380, 8, 54, 15],
    ['Kopi susu gula aren', '1 gelas', 200, 4, 30, 7],
  ];
  const DEFAULT_TARGETS = { kcal: 0, p: 0, c: 0, f: 0 };

  // ---------- tiny helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const r0 = (n) => Math.round(n);
  const r1 = (n) => Math.round(n * 10) / 10;
  const now = () => Date.now();
  const dateKey = (d) => { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${dd}`; };
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
  const todayKey = () => dateKey(new Date());
  const fmtNum = (n, lang) => r0(n).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US');
  const fmtDate = (k, lang, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => parseKey(k).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-GB', opts);
  const kcalFromMacros = (p, c, f) => 4 * p + 4 * c + 9 * f;

  // ---------- state ----------
  function freshData() {
    return {
      version: 1,
      targets: { ...DEFAULT_TARGETS }, targetsUpdatedAt: 0,
      foods: STARTER_FOODS.map(([name, unit, kcal, p, c, f]) => ({ id: uid(), name, unit, kcal, p, c, f })),
      foodsUpdatedAt: 0,
      days: {},
    };
  }
  function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { toast('Could not save on this device: ' + e.message); } }

  let data = load(STORE_KEY, null) || freshData();
  let local = load(LOCAL_KEY, {}) || {};
  local = { gistId: '', token: '', trainerPhone: '', lang: 'id', includeLink: true, viewGistId: '', ...local };

  const ui = { tab: 'today', date: todayKey(), foodQuery: '' };
  const viewer = { on: false, gistId: '' };

  // ---------- routing via hash ----------
  // #view=<gistId>  → trainer view-only
  // #setup=<gistId> → owner connects this device to the gist
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('view')) { viewer.on = true; viewer.gistId = h.get('view'); local.viewGistId = viewer.gistId; save(LOCAL_KEY, local); }
    else if (h.get('setup')) {
      local.gistId = h.get('setup'); save(LOCAL_KEY, local);
      history.replaceState(null, '', location.pathname);
      ui.tab = 'settings';
      setTimeout(() => toast('Linked to your log. Paste your access token to start syncing.'), 300);
    }
  }

  // ---------- day helpers ----------
  function getDay(k) { return data.days[k] || { entries: [], weight: '', note: '', updatedAt: 0 }; }
  function putDay(k, day) { day.updatedAt = now(); data.days[k] = day; persist(); }
  function totals(day) {
    return day.entries.reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, c: t.c + e.c, f: t.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  }
  function hasData(day) { return day.entries.length > 0 || day.weight || day.note; }

  // ---------- persistence + sync ----------
  let pushTimer = null;
  function persist() {
    save(STORE_KEY, data);
    if (canSync()) { clearTimeout(pushTimer); setSync('Saving…'); pushTimer = setTimeout(push, 1200); }
    else setSync(local.gistId ? 'Saved on phone only' : '');
  }
  const canSync = () => !viewer.on && local.gistId && local.token;

  function setSync(text, err = false) { const el = $('#sync'); el.textContent = text; el.classList.toggle('err', err); }

  async function fetchGist(id, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(id)}`, { headers, cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'Log not found (check the link)' : res.status === 401 ? 'Token rejected' : res.status === 403 ? 'GitHub rate limit, try again soon' : `GitHub error ${res.status}`);
    const g = await res.json();
    const file = g.files && g.files[GIST_FILE];
    if (!file) return null;
    let text = file.content;
    if (file.truncated) text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
    return text ? JSON.parse(text) : null;
  }

  function merge(remote) {
    if (!remote || typeof remote !== 'object') return false;
    let changed = false;
    if ((remote.targetsUpdatedAt || 0) > (data.targetsUpdatedAt || 0)) { data.targets = remote.targets; data.targetsUpdatedAt = remote.targetsUpdatedAt; changed = true; }
    if ((remote.foodsUpdatedAt || 0) > (data.foodsUpdatedAt || 0)) { data.foods = remote.foods; data.foodsUpdatedAt = remote.foodsUpdatedAt; changed = true; }
    for (const [k, d] of Object.entries(remote.days || {})) {
      if (!data.days[k] || (d.updatedAt || 0) > (data.days[k].updatedAt || 0)) { data.days[k] = d; changed = true; }
    }
    return changed;
  }

  async function pull() {
    if (viewer.on) {
      setSync('Loading…');
      try {
        const remote = await fetchGist(viewer.gistId, '');
        data = remote ? { ...freshData(), ...remote } : freshData();
        setSync('Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (e) { setSync(e.message, true); }
      render();
      return;
    }
    if (!local.gistId || !local.token) { setSync(local.gistId ? 'Saved on phone only' : ''); return; }
    setSync('Syncing…');
    try {
      const remote = await fetchGist(local.gistId, local.token);
      const changed = merge(remote);
      save(STORE_KEY, data);
      if (changed) render();
      await push(); // make sure anything only on this phone reaches the trainer link
    } catch (e) { setSync(navigator.onLine ? e.message : 'Offline · saved on phone', !navigator.onLine ? false : true); }
  }

  let pushing = false, pushAgain = false;
  async function push() {
    if (!canSync()) return;
    if (pushing) { pushAgain = true; return; }
    pushing = true;
    setSync('Saving…');
    try {
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(local.gistId)}`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${local.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(data) } } }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'Token rejected' : res.status === 404 ? 'Log not found (check token has gist access)' : `GitHub error ${res.status}`);
      setSync('Synced ✓');
    } catch (e) {
      setSync(navigator.onLine ? 'Sync failed: ' + e.message : 'Offline · saved on phone', navigator.onLine);
    } finally {
      pushing = false;
      if (pushAgain) { pushAgain = false; push(); }
    }
  }

  // ---------- UI: toast ----------
  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800); }

  // ---------- render ----------
  const ICON = {
    left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  };

  function render() {
    document.body.classList.toggle('viewer', viewer.on);
    $('#viewer-banner').hidden = !viewer.on;
    for (const b of document.querySelectorAll('#tabs button')) {
      if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    const app = $('#app');
    if (ui.tab === 'today') app.innerHTML = viewDay();
    else if (ui.tab === 'week') app.innerHTML = viewWeek();
    else if (ui.tab === 'foods') app.innerHTML = viewFoods();
    else app.innerHTML = viewSettings();
  }

  function macroBar(cls, label, val, target) {
    const pct = target ? Math.min(100, (val / target) * 100) : 0;
    const over = target && val > target * 1.05;
    return `<div class="macro ${cls}">
      <div class="name">${label}</div>
      <div class="val">${r0(val)}${target ? ` / ${r0(target)}` : ''} g</div>
      <div class="bar ${over ? 'over' : ''}" role="img" aria-label="${label} ${r0(val)} of ${r0(target)} grams"><span style="width:${pct}%"></span></div>
    </div>`;
  }

  function viewDay() {
    const k = ui.date, day = getDay(k), t = totals(day), tg = data.targets;
    const isToday = k === todayKey();
    const kcalPct = tg.kcal ? Math.min(100, (t.kcal / tg.kcal) * 100) : 0;
    const leftK = tg.kcal - t.kcal;
    const meals = MEALS.map((m) => {
      const es = day.entries.filter((e) => e.meal === m.id);
      const mk = es.reduce((s, e) => s + e.kcal, 0);
      if (viewer.on && !es.length) return '';
      return `<section class="meal" aria-labelledby="m-${m.id}">
        <div class="meal-head"><h3 id="m-${m.id}">${m.en}</h3><span class="sum">${es.length ? fmtNum(mk) + ' kcal' : ''}</span></div>
        ${es.length ? `<ul class="entries">${es.map((e) => `
          <li class="entry">
            <div class="info"><div class="nm">${esc(e.name)} <span class="muted">× ${r1(e.qty)}</span></div>
            <div class="mac">${esc(e.unit || '')}${e.unit ? ' · ' : ''}P ${r0(e.p)} · C ${r0(e.c)} · F ${r0(e.f)}</div></div>
            <span class="kc">${fmtNum(e.kcal)}</span>
            ${viewer.on ? '' : `<button class="icon-btn" data-act="edit-entry" data-id="${e.id}" aria-label="Edit ${esc(e.name)}">${ICON.edit}</button>`}
          </li>`).join('')}</ul>` : ''}
        ${viewer.on ? '' : `<button class="add-btn" data-act="add" data-meal="${m.id}">${ICON.plus} Add to ${m.en.toLowerCase()}</button>`}
      </section>`;
    }).join('');

    const noTargets = !tg.kcal;
    return `
    <div class="card datebar">
      <button class="icon-btn" data-act="prev" aria-label="Previous day">${ICON.left}</button>
      <div class="label"><strong>${isToday ? 'Today' : fmtDate(k, 'en', { weekday: 'long' })}</strong>
        <input type="date" id="pick-date" value="${k}" max="${todayKey()}" aria-label="Pick a date"></div>
      <button class="icon-btn" data-act="next" aria-label="Next day" ${isToday ? 'disabled' : ''}>${ICON.right}</button>
    </div>

    <section class="card" aria-label="Daily totals">
      <div class="kcal-row">
        <div class="kcal-big">${fmtNum(t.kcal)} <small>${tg.kcal ? '/ ' + fmtNum(tg.kcal) + ' kcal' : 'kcal'}</small></div>
        ${tg.kcal ? `<div class="left ${leftK < 0 ? 'over' : ''}">${leftK < 0 ? fmtNum(-leftK) + ' over' : fmtNum(leftK) + ' left'}</div>` : ''}
      </div>
      <div class="bar ${tg.kcal && t.kcal > tg.kcal ? 'over' : ''}"><span style="width:${kcalPct}%"></span></div>
      <div class="macros">
        ${macroBar('p', 'Protein', t.p, tg.p)}
        ${macroBar('c', 'Carbs', t.c, tg.c)}
        ${macroBar('f', 'Fat', t.f, tg.f)}
      </div>
      ${noTargets && !viewer.on ? `<p class="small muted" style="margin:12px 0 0">No targets yet. Add your trainer's numbers in <button class="btn ghost small" style="min-height:32px;padding:0 4px;color:var(--primary)" data-act="goto-settings">Settings</button>.</p>` : ''}
    </section>

    <section class="card" aria-label="Meals">
      ${meals || '<p class="empty-state">Nothing logged on this day.</p>'}
    </section>

    <section class="card stack" aria-label="Weight and notes">
      ${viewer.on ? `
        <div><strong>Body weight:</strong> ${day.weight ? esc(day.weight) + ' kg' : '<span class="muted">not logged</span>'}</div>
        ${day.note ? `<div><strong>Notes</strong><div class="note-text">${esc(day.note)}</div></div>` : ''}
      ` : `
        <div class="grid2">
          <div class="field"><label for="weight">Body weight (kg)</label>
            <input id="weight" type="text" inputmode="decimal" value="${esc(day.weight)}" placeholder="e.g. 72.4"></div>
          <div></div>
        </div>
        <div class="field"><label for="note">Notes for your trainer</label>
          <textarea id="note" placeholder="Hunger, energy, training day, cheat meal…">${esc(day.note)}</textarea></div>
      `}
    </section>

    ${viewer.on ? '' : `
    <section class="card stack" aria-label="Share">
      <h2>Send to trainer</h2>
      <div class="btn-row">
        <button class="btn wa" data-act="share-day">${ICON.wa} Send this day</button>
        <button class="btn" data-act="share-week">${ICON.wa} Send last 7 days</button>
      </div>
    </section>`}
    `;
  }

  function weekKeys(endKey) { const ks = []; for (let i = 6; i >= 0; i--) ks.push(addDays(endKey, -i)); return ks; }

  function weekStats(endKey) {
    const ks = weekKeys(endKey);
    const rows = ks.map((k) => { const d = getDay(k); return { k, d, t: totals(d), logged: d.entries.length > 0 }; });
    const logged = rows.filter((r) => r.logged);
    const n = logged.length || 1;
    const avg = logged.reduce((a, r) => ({ kcal: a.kcal + r.t.kcal / n, p: a.p + r.t.p / n, c: a.c + r.t.c / n, f: a.f + r.t.f / n }), { kcal: 0, p: 0, c: 0, f: 0 });
    const weights = rows.filter((r) => num(r.d.weight) > 0).map((r) => ({ k: r.k, w: num(r.d.weight) }));
    return { rows, logged: logged.length, avg, weights };
  }

  function viewWeek() {
    const end = ui.date, tg = data.targets;
    const { rows, logged, avg, weights } = weekStats(end);
    const maxK = Math.max(tg.kcal || 0, ...rows.map((r) => r.t.kcal), 1) * 1.1;
    const over = (v, t) => t && v > t * 1.05;
    const wChange = weights.length >= 2 ? weights[weights.length - 1].w - weights[0].w : null;
    return `
    <div class="card datebar">
      <button class="icon-btn" data-act="prev7" aria-label="Previous week">${ICON.left}</button>
      <div class="label"><strong>${fmtDate(rows[0].k, 'en', { day: 'numeric', month: 'short' })} – ${fmtDate(end, 'en', { day: 'numeric', month: 'short' })}</strong>
        <span class="small muted">${logged} of 7 days logged</span></div>
      <button class="icon-btn" data-act="next7" aria-label="Next week" ${end >= todayKey() ? 'disabled' : ''}>${ICON.right}</button>
    </div>

    <section class="card">
      <div class="card-head"><h2>Calories per day</h2></div>
      <div class="chart" role="img" aria-label="Calories per day for the week">
        ${tg.kcal ? `<div class="target" style="bottom:${(tg.kcal / maxK) * 100}%"></div>` : ''}
        ${rows.map((r) => `<div class="col ${over(r.t.kcal, tg.kcal) ? 'over' : ''}"><span style="height:${(r.t.kcal / maxK) * 100}%"></span></div>`).join('')}
      </div>
      <div class="chart-labels">${rows.map((r) => `<span>${fmtDate(r.k, 'en', { weekday: 'narrow' })}<br>${parseKey(r.k).getDate()}</span>`).join('')}</div>
      <div class="legend" style="margin-top:8px"><span><i></i>Within target</span><span><i class="ov"></i>Over target</span>${tg.kcal ? '<span><i class="tg"></i>Target</span>' : ''}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Daily totals</h2></div>
      <div class="scroll-x">
      <table class="week-table">
        <thead><tr><th scope="col">Day</th><th scope="col">kcal</th><th scope="col">Protein</th><th scope="col">Carbs</th><th scope="col">Fat</th><th scope="col">Weight</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr class="${r.logged ? '' : 'empty'}">
            <td><button class="daylink" data-act="open-day" data-k="${r.k}">${fmtDate(r.k, 'en', { weekday: 'short', day: 'numeric' })}</button></td>
            <td class="${over(r.t.kcal, tg.kcal) ? 'over' : ''}">${r.logged ? fmtNum(r.t.kcal) : '–'}</td>
            <td>${r.logged ? r0(r.t.p) : '–'}</td>
            <td class="${over(r.t.c, tg.c) ? 'over' : ''}">${r.logged ? r0(r.t.c) : '–'}</td>
            <td class="${over(r.t.f, tg.f) ? 'over' : ''}">${r.logged ? r0(r.t.f) : '–'}</td>
            <td>${r.d.weight ? esc(r.d.weight) : '–'}</td></tr>`).join('')}
          <tr class="avg"><td>Average</td><td>${logged ? fmtNum(avg.kcal) : '–'}</td><td>${logged ? r0(avg.p) : '–'}</td><td>${logged ? r0(avg.c) : '–'}</td><td>${logged ? r0(avg.f) : '–'}</td><td></td></tr>
          ${tg.kcal ? `<tr class="avg"><td class="muted">Target</td><td class="muted">${fmtNum(tg.kcal)}</td><td class="muted">${r0(tg.p)}</td><td class="muted">${r0(tg.c)}</td><td class="muted">${r0(tg.f)}</td><td></td></tr>` : ''}
        </tbody>
      </table></div>
      <p class="small muted" style="margin:8px 0 0">Average counts only days with food logged.${wChange !== null ? ` Weight change this week: <strong>${wChange > 0 ? '+' : ''}${r1(wChange)} kg</strong>.` : ''}</p>
    </section>

    ${viewer.on ? '' : `<section class="card"><button class="btn wa" style="width:100%" data-act="share-week">${ICON.wa} Send this week to trainer</button></section>`}
    `;
  }

  function foodRow(f, act) {
    return `<li><button type="button" class="food-item" data-act="${act}" data-id="${f.id}">
      <div class="info"><div class="nm">${esc(f.name)}</div>
      <div class="mac">${esc(f.unit)} · P ${r1(f.p)} · C ${r1(f.c)} · F ${r1(f.f)}</div></div>
      <strong>${r0(f.kcal)}</strong><span class="small muted">kcal</span></button></li>`;
  }
  const filteredFoods = (q) => { q = q.trim().toLowerCase(); const list = [...data.foods].sort((a, b) => a.name.localeCompare(b.name)); return q ? list.filter((f) => f.name.toLowerCase().includes(q)) : list; };

  function viewFoods() {
    const list = filteredFoods(ui.foodQuery);
    return `
    <section class="card">
      <div class="card-head"><h2>My foods</h2><button class="btn primary" data-act="new-food">${ICON.plus} New food</button></div>
      <p class="small muted" style="margin:0 0 12px">Your quick-add list. Starter values are approximate, so adjust them to your real portions or packaging labels. Changing a food here doesn't change days you've already logged.</p>
      <input type="search" class="search" id="food-q" placeholder="Search foods" aria-label="Search foods" value="${esc(ui.foodQuery)}">
      <ul class="food-list" id="food-list">${list.map((f) => foodRow(f, 'edit-food')).join('') || '<li class="empty-state">No foods match.</li>'}</ul>
    </section>`;
  }

  function viewSettings() {
    const tg = data.targets;
    const linked = local.gistId && local.token;
    const viewLink = local.gistId ? trainerLink() : '';
    return `
    <section class="card stack">
      <h2>Daily targets</h2>
      <p class="small muted" style="margin:0">Use the numbers your trainer gives you. Leave calories blank to work it out from the macros (4 kcal per g of protein and carbs, 9 per g of fat).</p>
      <div class="grid4">
        <div class="field"><label for="t-kcal">kcal</label><input id="t-kcal" type="number" inputmode="numeric" min="0" value="${tg.kcal || ''}"></div>
        <div class="field"><label for="t-p">Protein g</label><input id="t-p" type="number" inputmode="numeric" min="0" value="${tg.p || ''}"></div>
        <div class="field"><label for="t-c">Carbs g</label><input id="t-c" type="number" inputmode="numeric" min="0" value="${tg.c || ''}"></div>
        <div class="field"><label for="t-f">Fat g</label><input id="t-f" type="number" inputmode="numeric" min="0" value="${tg.f || ''}"></div>
      </div>
      <button class="btn primary" data-act="save-targets">Save targets</button>
    </section>

    <section class="card stack">
      <h2>Trainer</h2>
      <div class="field"><label for="tr-phone">Trainer's WhatsApp number</label>
        <input id="tr-phone" type="tel" inputmode="tel" placeholder="e.g. 0812 3456 7890" value="${esc(local.trainerPhone)}">
        <span class="hint">Optional. Leave blank to pick the chat in WhatsApp each time. Kept on this phone only.</span></div>
      <div class="field"><label for="lang">Summary language</label>
        <select id="lang"><option value="id" ${local.lang === 'id' ? 'selected' : ''}>Bahasa Indonesia</option><option value="en" ${local.lang === 'en' ? 'selected' : ''}>English</option></select></div>
      <label class="check"><input type="checkbox" id="inc-link" ${local.includeLink ? 'checked' : ''}> Add the view-only link to WhatsApp messages</label>
      <button class="btn primary" data-act="save-trainer">Save</button>
      <div class="field"><span style="font-size:.875rem;font-weight:600">Trainer's view-only link</span>
        ${viewLink ? `<code>${esc(viewLink)}</code>
          <div class="btn-row"><button class="btn" data-act="copy-link">${ICON.link} Copy link</button><button class="btn wa" data-act="send-link">${ICON.wa} Send link</button></div>
          <span class="hint">Anyone with this link can see your log (not edit it). It isn't listed or searchable anywhere.</span>`
        : '<span class="hint">Appears after sync is connected below.</span>'}</div>
    </section>

    <section class="card stack">
      <h2>Sync</h2>
      <p class="small muted" style="margin:0">Status: <strong>${linked ? 'Connected' : local.gistId ? 'Needs access token' : 'Not connected'}</strong>. Your log is always saved on this phone. Sync copies it online so the trainer link stays up to date.</p>
      <div class="field"><label for="gist">Log ID</label><input id="gist" type="text" autocomplete="off" spellcheck="false" value="${esc(local.gistId)}"></div>
      <div class="field"><label for="token">GitHub access token</label><input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="${local.token ? 'Saved (hidden). Paste to replace' : 'ghp_…'}">
        <span class="hint">Classic token with only the <b>gist</b> permission. Stored on this phone only, never in the shared log.</span></div>
      <div class="btn-row"><button class="btn primary" data-act="save-sync">Connect &amp; sync</button>${linked ? '<button class="btn danger" data-act="disconnect">Disconnect this phone</button>' : ''}</div>
    </section>

    <section class="card stack">
      <h2>Backup</h2>
      <div class="btn-row"><button class="btn" data-act="export">Download backup</button>
        <label class="btn" for="import-file" style="cursor:pointer">Restore backup</label><input type="file" id="import-file" accept="application/json" hidden></div>
    </section>`;
  }

  // ---------- sheet (add / edit entry, edit food) ----------
  const sheet = $('#sheet'), sheetForm = $('#sheet-form');
  function openSheet(html, onReady) {
    sheetForm.onclick = null; sheetForm.oninput = null;
    sheetForm.innerHTML = html;
    if (!sheet.open) sheet.showModal();
    onReady && onReady();
  }
  function closeSheet() { if (sheet.open) sheet.close(); }
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

  function sheetHead(title) { return `<div class="sheet-head"><h2 id="sheet-title">${title}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close">${ICON.x}</button></div>`; }

  function pickFood(meal) {
    const mealName = MEALS.find((m) => m.id === meal).en;
    const listHtml = (q) => filteredFoods(q).map((f) => foodRow(f, 'pick')).join('') || '<li class="empty-state">No match. Use “Other food”.</li>';
    openSheet(`${sheetHead('Add to ' + mealName.toLowerCase())}
      <input type="search" id="pick-q" placeholder="Search your foods" aria-label="Search your foods" autocomplete="off">
      <ul class="food-list" id="pick-list">${listHtml('')}</ul>
      <button type="button" class="btn" data-act="custom">${ICON.plus} Other food (type the numbers)</button>`, () => {
      const q = $('#pick-q');
      q.addEventListener('input', () => { $('#pick-list').innerHTML = listHtml(q.value); });
      sheetForm.onclick = (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'pick') entryForm({ meal, food: data.foods.find((f) => f.id === b.dataset.id) });
        if (b.dataset.act === 'custom') entryForm({ meal, food: null, prefill: q.value });
        if (b.dataset.act === 'close') closeSheet();
      };
    });
  }

  // Entry form. food = quick-add food (per-serving macros); entry = existing entry being edited.
  function entryForm({ meal, food, entry, prefill }) {
    const custom = !food && !entry?.perUnit;
    const base = food ? { name: food.name, unit: food.unit, kcal: food.kcal, p: food.p, c: food.c, f: food.f }
      : entry?.perUnit ? entry.perUnit : null;
    const qty = entry ? entry.qty : 1;
    const title = entry ? 'Edit entry' : 'Add ' + (base ? base.name : 'food');
    openSheet(`${sheetHead(esc(title))}
      ${base ? `<p class="small muted" style="margin:0">1 serving = ${esc(base.unit)} · ${r0(base.kcal)} kcal</p>
        <div class="field"><label for="qty">Servings</label>
          <div class="qty"><button type="button" class="icon-btn" data-act="dec" aria-label="Less">−</button>
          <input id="qty" type="text" inputmode="decimal" value="${qty}">
          <button type="button" class="icon-btn" data-act="inc" aria-label="More">+</button></div></div>`
      : `<div class="field"><label for="c-name">Food</label><input id="c-name" type="text" required value="${esc(entry?.name ?? prefill ?? '')}" placeholder="e.g. Nasi padang ayam bakar"></div>
        <div class="field"><label for="c-unit">Portion (optional)</label><input id="c-unit" type="text" value="${esc(entry?.unit ?? '')}" placeholder="e.g. 1 porsi"></div>
        <div class="grid4">
          <div class="field"><label for="c-p">Protein g</label><input id="c-p" type="text" inputmode="decimal" value="${entry ? r1(entry.p) : ''}"></div>
          <div class="field"><label for="c-c">Carbs g</label><input id="c-c" type="text" inputmode="decimal" value="${entry ? r1(entry.c) : ''}"></div>
          <div class="field"><label for="c-f">Fat g</label><input id="c-f" type="text" inputmode="decimal" value="${entry ? r1(entry.f) : ''}"></div>
          <div class="field"><label for="c-k">kcal</label><input id="c-k" type="text" inputmode="decimal" value="${entry ? r0(entry.kcal) : ''}" placeholder="auto"></div>
        </div>
        ${entry ? '' : '<label class="check"><input type="checkbox" id="c-save" checked> Also save to my foods for next time</label>'}`}
      <div class="field"><label for="e-meal">Meal</label><select id="e-meal">${MEALS.map((m) => `<option value="${m.id}" ${m.id === (entry?.meal || meal) ? 'selected' : ''}>${m.en}</option>`).join('')}</select></div>
      <div class="preview" id="preview"></div>
      <div class="btn-row">
        ${entry ? '<button type="button" class="btn danger" data-act="del">Remove</button>' : ''}
        <button type="button" class="btn primary" data-act="ok">${entry ? 'Save' : 'Add'}</button>
      </div>`, () => {
      const read = () => {
        if (base) { const q = Math.max(0, num($('#qty').value)); return { name: base.name, unit: base.unit, qty: q, kcal: base.kcal * q, p: base.p * q, c: base.c * q, f: base.f * q, perUnit: base }; }
        const p = num($('#c-p').value), c = num($('#c-c').value), f = num($('#c-f').value);
        const k = $('#c-k').value.trim() ? num($('#c-k').value) : kcalFromMacros(p, c, f);
        return { name: $('#c-name').value.trim(), unit: $('#c-unit').value.trim(), qty: 1, kcal: k, p, c, f, perUnit: null };
      };
      const upd = () => { const v = read(); $('#preview').innerHTML = `<strong>${fmtNum(v.kcal)} kcal</strong> · Protein ${r0(v.p)} g · Carbs ${r0(v.c)} g · Fat ${r0(v.f)} g`; };
      sheetForm.oninput = upd; upd();
      sheetForm.onclick = (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'close') return closeSheet();
        if (act === 'inc' || act === 'dec') { const q = num($('#qty').value); $('#qty').value = r1(Math.max(0.5, q + (act === 'inc' ? 0.5 : -0.5))); upd(); return; }
        const day = getDay(ui.date);
        if (act === 'del') { day.entries = day.entries.filter((x) => x.id !== entry.id); putDay(ui.date, day); closeSheet(); render(); toast('Removed'); return; }
        if (act === 'ok') {
          const v = read();
          if (!base && !v.name) { $('#c-name').focus(); toast('Type the food name'); return; }
          if (v.qty <= 0) { toast('Servings must be more than 0'); return; }
          const rec = { id: entry?.id || uid(), meal: $('#e-meal').value, name: v.name, unit: v.unit, qty: r1(v.qty), kcal: r1(v.kcal), p: r1(v.p), c: r1(v.c), f: r1(v.f), perUnit: v.perUnit };
          if (entry) day.entries = day.entries.map((x) => (x.id === entry.id ? rec : x)); else day.entries.push(rec);
          if (!base && !entry && $('#c-save')?.checked) {
            data.foods.push({ id: uid(), name: v.name, unit: v.unit || '1 porsi', kcal: r1(v.kcal), p: r1(v.p), c: r1(v.c), f: r1(v.f) });
            data.foodsUpdatedAt = now();
          }
          putDay(ui.date, day); closeSheet(); render(); toast(entry ? 'Saved' : 'Added');
        }
      };
    });
  }

  function foodForm(food) {
    openSheet(`${sheetHead(food ? 'Edit food' : 'New food')}
      <div class="field"><label for="f-name">Name</label><input id="f-name" type="text" value="${esc(food?.name || '')}" placeholder="e.g. Nasi goreng kampung"></div>
      <div class="field"><label for="f-unit">One serving is</label><input id="f-unit" type="text" value="${esc(food?.unit || '')}" placeholder="e.g. 1 piring, 100 g, 1 scoop"></div>
      <div class="grid4">
        <div class="field"><label for="f-p">Protein g</label><input id="f-p" type="text" inputmode="decimal" value="${food ? food.p : ''}"></div>
        <div class="field"><label for="f-c">Carbs g</label><input id="f-c" type="text" inputmode="decimal" value="${food ? food.c : ''}"></div>
        <div class="field"><label for="f-f">Fat g</label><input id="f-f" type="text" inputmode="decimal" value="${food ? food.f : ''}"></div>
        <div class="field"><label for="f-k">kcal</label><input id="f-k" type="text" inputmode="decimal" value="${food ? food.kcal : ''}" placeholder="auto"></div>
      </div>
      <p class="small muted" style="margin:0">Leave kcal blank to work it out from the macros.</p>
      <div class="btn-row">${food ? '<button type="button" class="btn danger" data-act="del">Delete</button>' : ''}<button type="button" class="btn primary" data-act="ok">Save</button></div>`, () => {
      sheetForm.oninput = null;
      sheetForm.onclick = (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'close') return closeSheet();
        if (b.dataset.act === 'del') { data.foods = data.foods.filter((x) => x.id !== food.id); data.foodsUpdatedAt = now(); persist(); closeSheet(); render(); toast('Deleted'); return; }
        if (b.dataset.act === 'ok') {
          const name = $('#f-name').value.trim(); if (!name) { $('#f-name').focus(); toast('Type a name'); return; }
          const p = num($('#f-p').value), c = num($('#f-c').value), f = num($('#f-f').value);
          const kcal = $('#f-k').value.trim() ? num($('#f-k').value) : r0(kcalFromMacros(p, c, f));
          const rec = { id: food?.id || uid(), name, unit: $('#f-unit').value.trim() || '1 porsi', kcal, p, c, f };
          data.foods = food ? data.foods.map((x) => (x.id === food.id ? rec : x)) : [...data.foods, rec];
          data.foodsUpdatedAt = now(); persist(); closeSheet(); render(); toast('Saved');
        }
      };
    });
  }

  // ---------- WhatsApp summaries ----------
  function trainerLink() { return `${location.origin}${location.pathname}#view=${local.gistId}`; }
  function L(en, id) { return local.lang === 'id' ? id : en; }

  const qtyTxt = (q) => r1(q).toLocaleString(local.lang === 'id' ? 'id-ID' : 'en-US');
  function daySummary(k) {
    const lang = local.lang, day = getDay(k), t = totals(day), tg = data.targets;
    const g = (v, tv) => `${r0(v)}${tv ? '/' + r0(tv) : ''}g`;
    const lines = [`*${L('Nutrition log', 'Log nutrisi')} – ${fmtDate(k, lang)}*`];
    lines.push(`Total: ${fmtNum(t.kcal, lang)}${tg.kcal ? ' / ' + fmtNum(tg.kcal, lang) : ''} ${L('kcal', 'kkal')}`);
    lines.push(`${L('Protein', 'Protein')} ${g(t.p, tg.p)} · ${L('Carbs', 'Karbo')} ${g(t.c, tg.c)} · ${L('Fat', 'Lemak')} ${g(t.f, tg.f)}`);
    if (day.weight) lines.push(`${L('Weight', 'Berat')}: ${day.weight} kg`);
    for (const m of MEALS) {
      const es = day.entries.filter((e) => e.meal === m.id); if (!es.length) continue;
      lines.push('', `*${L(m.en, m.id_)}*`);
      for (const e of es) lines.push(`- ${e.name}${e.unit ? ', ' + (e.qty !== 1 ? qtyTxt(e.qty) + ' × ' : '') + e.unit : e.qty !== 1 ? ' ×' + qtyTxt(e.qty) : ''}: ${fmtNum(e.kcal, lang)} ${L('kcal', 'kkal')}, P${r0(e.p)} ${L('C', 'K')}${r0(e.c)} ${L('F', 'L')}${r0(e.f)}`);
    }
    if (!day.entries.length) lines.push('', L('(No food logged)', '(Belum ada makanan dicatat)'));
    if (day.note) lines.push('', `${L('Notes', 'Catatan')}: ${day.note}`);
    if (local.includeLink && local.gistId) lines.push('', `${L('Full log', 'Log lengkap')}: ${trainerLink()}`);
    return lines.join('\n');
  }

  function weekSummary(endKey) {
    const lang = local.lang, tg = data.targets, { rows, logged, avg, weights } = weekStats(endKey);
    const lines = [`*${L('Nutrition log, 7 days', 'Log nutrisi 7 hari')} (${fmtDate(rows[0].k, lang, { day: 'numeric', month: 'short' })} – ${fmtDate(endKey, lang, { day: 'numeric', month: 'short', year: 'numeric' })})*`, ''];
    for (const r of rows) {
      const head = fmtDate(r.k, lang, { weekday: 'short', day: 'numeric', month: 'short' });
      lines.push(r.logged ? `${head}: ${fmtNum(r.t.kcal, lang)} kkal · P${r0(r.t.p)} ${L('C', 'K')}${r0(r.t.c)} ${L('F', 'L')}${r0(r.t.f)}${r.d.weight ? ' · ' + r.d.weight + ' kg' : ''}`
        : `${head}: ${L('not logged', 'tidak dicatat')}${r.d.weight ? ' · ' + r.d.weight + ' kg' : ''}`);
    }
    lines.push('', `*${L('Average', 'Rata-rata')}* (${logged} ${L('days', 'hari')}): ${fmtNum(avg.kcal, lang)} kkal · P${r0(avg.p)} ${L('C', 'K')}${r0(avg.c)} ${L('F', 'L')}${r0(avg.f)}`);
    if (tg.kcal) lines.push(`${L('Target', 'Target')}: ${fmtNum(tg.kcal, lang)} kkal · P${r0(tg.p)} ${L('C', 'K')}${r0(tg.c)} ${L('F', 'L')}${r0(tg.f)}`);
    if (weights.length >= 2) { const d = weights[weights.length - 1].w - weights[0].w; lines.push(`${L('Weight', 'Berat')}: ${weights[0].w} → ${weights[weights.length - 1].w} kg (${d > 0 ? '+' : ''}${r1(d)} kg)`); }
    if (lang === 'en') for (let i = 0; i < lines.length; i++) lines[i] = lines[i].replace(/kkal/g, 'kcal');
    if (local.includeLink && local.gistId) lines.push('', `${L('Full log', 'Log lengkap')}: ${trainerLink()}`);
    return lines.join('\n');
  }

  function waNumber(raw) { let d = String(raw || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '62' + d.slice(1); return d; }
  function openWhatsApp(text) {
    const n = waNumber(local.trainerPhone);
    const url = `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  }

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('#tabs button');
    if (tabBtn) { ui.tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const b = e.target.closest('#app [data-act]'); if (!b) return;
    const act = b.dataset.act;
    switch (act) {
      case 'prev': ui.date = addDays(ui.date, -1); render(); break;
      case 'next': if (ui.date < todayKey()) { ui.date = addDays(ui.date, 1); render(); } break;
      case 'prev7': ui.date = addDays(ui.date, -7); render(); break;
      case 'next7': { const n = addDays(ui.date, 7); ui.date = n > todayKey() ? todayKey() : n; render(); break; }
      case 'open-day': ui.date = b.dataset.k; ui.tab = 'today'; render(); window.scrollTo(0, 0); break;
      case 'goto-settings': ui.tab = 'settings'; render(); break;
      case 'add': pickFood(b.dataset.meal); break;
      case 'edit-entry': { const en = getDay(ui.date).entries.find((x) => x.id === b.dataset.id); if (en) entryForm({ meal: en.meal, entry: en }); break; }
      case 'share-day': openWhatsApp(daySummary(ui.date)); break;
      case 'share-week': openWhatsApp(weekSummary(ui.date)); break;
      case 'new-food': foodForm(null); break;
      case 'edit-food': foodForm(data.foods.find((f) => f.id === b.dataset.id)); break;
      case 'save-targets': {
        const p = num($('#t-p').value), c = num($('#t-c').value), f = num($('#t-f').value);
        const kcal = $('#t-kcal').value.trim() ? num($('#t-kcal').value) : r0(kcalFromMacros(p, c, f));
        data.targets = { kcal, p, c, f }; data.targetsUpdatedAt = now(); persist(); render(); toast('Targets saved'); break;
      }
      case 'save-trainer':
        local.trainerPhone = $('#tr-phone').value.trim(); local.lang = $('#lang').value; local.includeLink = $('#inc-link').checked;
        save(LOCAL_KEY, local); toast('Saved'); break;
      case 'copy-link':
        try { await navigator.clipboard.writeText(trainerLink()); toast('Link copied'); } catch { toast('Copy failed. Press and hold the link to copy it'); }
        break;
      case 'send-link':
        openWhatsApp(L(`Here's my nutrition log (view only, always up to date): ${trainerLink()}`, `Ini log nutrisi saya (hanya lihat, selalu update): ${trainerLink()}`)); break;
      case 'save-sync': {
        const gid = $('#gist').value.trim().replace(/^.*\//, ''); const tok = $('#token').value.trim();
        if (!gid) { toast('Paste the log ID first'); break; }
        local.gistId = gid; if (tok) local.token = tok; save(LOCAL_KEY, local);
        if (!local.token) { toast('Paste your access token'); render(); break; }
        await pull(); render(); toast($('#sync').classList.contains('err') ? 'Could not connect. See the status at the top' : 'Connected'); break;
      }
      case 'disconnect':
        if (confirm('Disconnect this phone from sync? Your log stays saved on this phone.')) { local.token = ''; save(LOCAL_KEY, local); setSync('Saved on phone only'); render(); }
        break;
      case 'export': {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `nutrition-log-${todayKey()}.json`; a.click(); URL.revokeObjectURL(a.href); break;
      }
    }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'pick-date' && t.value) { ui.date = t.value > todayKey() ? todayKey() : t.value; render(); }
    if (t.id === 'import-file' && t.files[0]) {
      try {
        const incoming = JSON.parse(await t.files[0].text());
        if (!incoming || typeof incoming.days !== 'object') throw new Error('not a Nutrition Log backup');
        if (!confirm('Replace everything on this phone with this backup?')) return;
        data = { ...freshData(), ...incoming, targetsUpdatedAt: now(), foodsUpdatedAt: now() };
        for (const d of Object.values(data.days)) d.updatedAt = now();
        persist(); render(); toast('Backup restored');
      } catch (err) { toast('Could not read file: ' + err.message); }
    }
  });

  // Weight + notes save as you type.
  let typeTimer;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'food-q') { ui.foodQuery = t.value; $('#food-list').innerHTML = filteredFoods(t.value).map((f) => foodRow(f, 'edit-food')).join('') || '<li class="empty-state">No foods match.</li>'; return; }
    if (t.id === 'weight' || t.id === 'note') {
      clearTimeout(typeTimer);
      const k = ui.date, weight = $('#weight').value.trim().replace(',', '.'), note = $('#note').value;
      typeTimer = setTimeout(() => { const day = getDay(k); day.weight = weight; day.note = note; putDay(k, day); }, 600);
    }
  });

  // Re-sync when coming back to the app.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('online', () => pull());
  window.addEventListener('hashchange', () => { readHash(); render(); pull(); });

  // ---------- boot ----------
  if (!viewer.on && local.viewGistId && !location.hash && !local.gistId && !localStorage.getItem(STORE_KEY)) {
    // A trainer reopening the app from their home screen without the hash.
    location.hash = 'view=' + local.viewGistId;
  }
  readHash();
  render();
  pull();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // Expose for tests only.
  window.__nl = { daySummary, weekSummary, get data() { return data; } };
})();
