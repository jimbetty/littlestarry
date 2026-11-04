(() => {
  const API = '/api/score';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE_NAME = { leader: '班长', deputy: '副班长', spec: '专责', peer: '互评' };

  let KEYS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2'];
  let MAX = { A1: 15, A2: 10, A3: 10, B1: 10, B2: 10, B3: 5, C1: 10, C2: 10, C3: 5, D1: 8, D2: 7 };
  let CANDIDATES = [], SPECS = [];
  let ym = ymNow(), locked = false, submitted = [];
  let bundle = null, canEdit = true, dirty = false;
  let adminPass = sessionStorage.getItem('score_admin') || '';
  let state = null; // 班长 only: { leader, deputy, specs:{}, peers:{} }

  function ymNow() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  const keyStoreId = (role, sub) => `score_key_${ym}_${role}_${sub}`;
  const blankItems = () => Object.fromEntries(KEYS.map((k) => [k, 0]));
  const blankBundle = () => Object.fromEntries(CANDIDATES.map((c) => [c, blankItems()]));
  const sum = (items) => KEYS.reduce((s, k) => s + Number(items?.[k] ?? 0), 0);
  const addItems = (a, b) => Object.fromEntries(KEYS.map((k) => [k, (a?.[k] ?? 0) + (b?.[k] ?? 0)]));
  const divItems = (a, d) => (d ? Object.fromEntries(KEYS.map((k) => [k, (a?.[k] ?? 0) / d])) : null);
  const fmt1 = (x) => (x === null || x === undefined ? '-' : Number(x).toFixed(1));
  const fmt2 = (x) => (x === null || x === undefined ? '-' : Number(x).toFixed(2));
  const who = () => { const role = $('role').value; return { role, sub: role === 'leader' || role === 'deputy' ? '' : $('subRole').value || '' }; };

  async function api(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || '网络出错了，请稍后再试'), { status: res.status });
    return data;
  }
  const admin = (body) => api('/admin', { method: 'POST', headers: { 'x-admin-pass': adminPass }, body: JSON.stringify({ ym, ...body }) });

  function note(text, tone) {
    const el = $('sheetNote');
    if (!text) { el.classList.add('hidden'); return; }
    const tones = { warn: 'bg-amber-50 text-amber-800 border-amber-100', info: 'bg-indigo-50 text-indigo-700 border-indigo-100', err: 'bg-red-50 text-red-700 border-red-100', ok: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
    el.className = 'px-6 py-3 text-sm border-b ' + (tones[tone] || tones.info);
    el.textContent = text;
  }

  /* ---------------- loading ---------------- */
  async function loadState() {
    const d = await api('/state?ym=' + ym);
    KEYS = d.keys || KEYS; MAX = d.max || MAX;
    CANDIDATES = d.roster.candidates || []; SPECS = d.roster.specs || [];
    locked = d.locked; submitted = d.submitted || [];
    $('candCount').textContent = CANDIDATES.length;
    renderProgress();
  }

  function renderSubRoleOptions() {
    const role = $('role').value, sub = $('subRole'), wrap = $('subRoleWrap');
    const prev = sub.value;
    if (role === 'leader' || role === 'deputy') { wrap.classList.add('hidden'); sub.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    $('subRoleLabel').textContent = role === 'spec' ? '专责' : '姓名';
    const opts = role === 'spec' ? SPECS : CANDIDATES;
    sub.innerHTML = opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    if (opts.includes(prev)) sub.value = prev;
  }

  async function loadMySheet() {
    dirty = false;
    if (!CANDIDATES.length) {
      bundle = {}; canEdit = false; renderScoreTable();
      note(adminPass ? '还没有名单，请在右侧「班长管理」里填好被评员工和专责。' : '班长还没有设置名单，请稍后再来。', 'warn');
      return;
    }
    const { role, sub } = who();
    if (role !== 'leader' && role !== 'deputy' && !sub) { bundle = blankBundle(); canEdit = false; renderScoreTable(); return; }
    const key = localStorage.getItem(keyStoreId(role, sub)) || '';
    try {
      const d = await api(`/sheet?ym=${ym}&role=${role}&sub=${encodeURIComponent(sub)}`, { headers: { 'x-edit-key': key } });
      if (!d.exists) { bundle = blankBundle(); canEdit = !locked; note(locked ? '本月已截止。' : '', 'warn'); }
      else if (d.mine) {
        bundle = Object.assign(blankBundle(), d.scores); canEdit = !locked;
        note(locked ? '本月已截止，你的评分已锁定。' : `你已在 ${new Date(d.updated_at).toLocaleString('zh-CN')} 提交，可以继续修改后再提交。`, locked ? 'warn' : 'ok');
      } else {
        bundle = blankBundle(); canEdit = false;
        note('这个身份已经提交过了。如果是你本人提交、现在换了设备，或者选错了身份，请找班长重置。', 'warn');
      }
    } catch (e) { bundle = blankBundle(); canEdit = false; note(e.message, 'err'); }
    renderScoreTable();
  }

  /* ---------------- score table ---------------- */
  function renderScoreTable() {
    const tbody = $('scoreTbody'); tbody.innerHTML = '';
    const { role, sub } = who();
    for (const cand of CANDIDATES) {
      bundle[cand] = bundle[cand] || blankItems();
      const tr = document.createElement('tr');
      tr.className = 'group transition-colors hover:bg-indigo-50/30';
      const left = document.createElement('td');
      left.className = 'p-4 font-semibold text-slate-700 sticky left-0 bg-white group-hover:bg-indigo-50 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]';
      left.innerHTML = `<div class="flex items-center gap-2"><div class="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">${esc(cand.charAt(0))}</div>${esc(cand)}</div>`;
      tr.appendChild(left);
      const isSelf = role === 'peer' && sub === cand;
      for (const k of KEYS) {
        const td = document.createElement('td'); td.className = 'p-2 text-center';
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = 0; inp.max = MAX[k]; inp.step = '0.5'; inp.inputMode = 'decimal';
        inp.value = bundle[cand][k] ?? 0;
        inp.className = 'w-16 py-1.5 text-center text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-sm disabled:bg-slate-50 disabled:text-slate-400';
        if (isSelf) { inp.value = 0; bundle[cand][k] = 0; inp.disabled = true; inp.className = 'w-16 py-1.5 text-center bg-slate-50 border-transparent text-slate-300 cursor-not-allowed rounded-lg'; }
        else if (!canEdit) inp.disabled = true;
        inp.addEventListener('input', function () {
          let v = parseFloat(this.value);
          if (isNaN(v)) v = 0;
          else { if (v > MAX[k]) { v = MAX[k]; this.value = v; } if (v < 0) { v = 0; this.value = 0; } }
          bundle[cand][k] = v; dirty = true;
          const cell = tr.querySelector('[data-total-cell]'); if (cell) cell.textContent = sum(bundle[cand]).toFixed(1);
          renderRoleTotals();
        });
        inp.addEventListener('blur', function () { if (this.value === '') { this.value = 0; bundle[cand][k] = 0; renderRoleTotals(); } });
        td.appendChild(inp); tr.appendChild(td);
      }
      const tdTotal = document.createElement('td');
      tdTotal.className = 'p-3 font-bold text-center text-indigo-900 sticky right-0 bg-white group-hover:bg-indigo-50 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)]';
      tdTotal.innerHTML = isSelf ? '<span class="text-slate-300 text-xl leading-none">×</span>' : `<span data-total-cell class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded-md text-xs">${sum(bundle[cand]).toFixed(1)}</span>`;
      tr.appendChild(tdTotal);
      tbody.appendChild(tr);
    }
    $('saveRole').disabled = !canEdit;
    $('saveRole').classList.toggle('opacity-50', !canEdit);
    renderRoleTotals();
  }

  function renderRoleTotals() {
    const { role, sub } = who();
    const rows = CANDIDATES.filter((c) => !(role === 'peer' && sub === c)).map((c) => ({ c, t: sum(bundle?.[c]) })).sort((a, b) => b.t - a.t);
    $('roleTotals').innerHTML = rows.length
      ? rows.map((r, i) => `<div class="flex justify-between items-center text-sm p-2 rounded-lg ${i === 0 ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-100' : 'hover:bg-slate-50'}"><span class="flex items-center gap-2"><span class="text-[10px] w-4 text-center text-slate-400">${i + 1}</span>${esc(r.c)}</span><span class="font-mono">${r.t.toFixed(1)}</span></div>`).join('')
      : '<div class="text-xs text-slate-400">暂无</div>';
  }

  async function submit() {
    if (!canEdit) return;
    const { role, sub } = who();
    const btn = $('saveRole'), orig = btn.innerHTML;
    btn.disabled = true;
    try {
      const key = localStorage.getItem(keyStoreId(role, sub)) || '';
      const d = await api('/sheet', { method: 'PUT', headers: { 'x-edit-key': key }, body: JSON.stringify({ ym, role, sub, scores: bundle }) });
      if (d.key) localStorage.setItem(keyStoreId(role, sub), d.key);
      dirty = false;
      btn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> 已提交';
      btn.classList.add('bg-emerald-600');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('bg-emerald-600'); }, 2000);
      note(`已提交（${new Date(d.updated_at).toLocaleString('zh-CN')}），之后在这台设备上还能修改。`, 'ok');
      await loadState();
      if (adminPass) await loadAll();
    } catch (e) { note(e.message, 'err'); if (e.status === 409 || e.status === 423) await loadMySheet(); }
    btn.disabled = !canEdit;
  }

  /* ---------------- progress (everyone sees who has submitted, never the scores) ---------------- */
  function renderProgress() {
    const has = (role, sub) => submitted.some((s) => s.role === role && s.sub === sub);
    const groups = [
      ['班长', [['leader', '', '班长']]],
      ['副班长', [['deputy', '', '副班长']]],
      ['专责', SPECS.map((s) => ['spec', s, s])],
      ['互评', CANDIDATES.map((c) => ['peer', c, c])],
    ];
    $('progress').innerHTML = groups.map(([g, list]) => {
      if (!list.length) return '';
      const done = list.filter(([r, s]) => has(r, s)).length;
      const chips = list.map(([r, s, label]) => {
        const ok = has(r, s);
        const reset = adminPass && ok ? `<button data-reset="${r}|${esc(s)}" class="ml-1 text-slate-400 hover:text-red-500" title="重置">×</button>` : '';
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}">${ok ? '✓ ' : ''}${esc(label)}${reset}</span>`;
      }).join(' ');
      return `<div><div class="flex justify-between text-xs text-slate-500 mb-1"><span>${g}</span><span>${done}/${list.length}</span></div><div class="flex flex-wrap gap-1">${chips}</div></div>`;
    }).join('<div class="h-2"></div>');
    $('lockNote').classList.toggle('hidden', !locked);
    const lb = $('lockMonth'); if (lb) lb.textContent = locked ? '重新开放本月' : '截止本月';
    const st = `状态：班长${has('leader', '') ? '✅' : '❌'} 副班${has('deputy', '') ? '✅' : '⚪'} 专责${submitted.filter((s) => s.role === 'spec').length}/${SPECS.length} 互评${submitted.filter((s) => s.role === 'peer').length}/${CANDIDATES.length}`;
    $('status').textContent = st;
  }

  /* ---------------- 班长 ---------------- */
  async function login() {
    const p = adminPass || prompt('请输入班长口令');
    if (!p) return;
    adminPass = p;
    try { await loadAll(); sessionStorage.setItem('score_admin', p); }
    catch (e) { adminPass = ''; sessionStorage.removeItem('score_admin'); alert(e.message); }
  }
  function logout() {
    adminPass = ''; state = null; sessionStorage.removeItem('score_admin');
    for (const id of ['adminPanel', 'exportCsv', 'clearMonth', 'rankBox']) $(id).classList.add('hidden');
    $('rankGate').classList.remove('hidden'); $('adminLogin').classList.remove('hidden');
    renderProgress();
  }
  async function loadAll() {
    const d = await admin({ action: 'all' });
    state = { leader: null, deputy: null, specs: {}, peers: {} };
    for (const s of d.sheets) {
      if (s.role === 'leader') state.leader = s.scores;
      else if (s.role === 'deputy') state.deputy = s.scores;
      else if (s.role === 'spec' && SPECS.includes(s.sub)) state.specs[s.sub] = s.scores;
      else if (s.role === 'peer' && CANDIDATES.includes(s.sub)) state.peers[s.sub] = s.scores;
    }
    for (const id of ['adminPanel', 'exportCsv', 'clearMonth', 'rankBox']) $(id).classList.remove('hidden');
    $('rankGate').classList.add('hidden'); $('adminLogin').classList.add('hidden');
    $('rosterCands').value = CANDIDATES.join('，'); $('rosterSpecs').value = SPECS.join('，');
    renderProgress(); renderResults();
  }

  function calcAggregates() {
    const { leader, deputy } = state;
    const specKeys = Object.keys(state.specs), peerKeys = Object.keys(state.peers);
    const enoughSpecs = specKeys.length >= 1, enoughPeers = peerKeys.length >= 3;
    const agg = {};
    for (const cand of CANDIDATES) {
      const leaderItems = leader ? leader[cand] || blankItems() : null;
      const deputyItems = deputy ? deputy[cand] || blankItems() : null;
      const leaderScore0 = leaderItems ? sum(leaderItems) : null;
      const deputyScore0 = deputyItems ? sum(deputyItems) : null;
      let leaderAvg = null;
      if (leaderScore0 !== null && deputyScore0 !== null) leaderAvg = (leaderScore0 + deputyScore0) / 2;
      else if (leaderScore0 !== null) leaderAvg = leaderScore0;
      let specAvg = null, specItemsAvg = null;
      if (enoughSpecs) {
        let acc = blankItems();
        for (const k of specKeys) acc = addItems(acc, state.specs[k][cand]);
        specItemsAvg = divItems(acc, specKeys.length); specAvg = sum(specItemsAvg);
      }
      let peerAvg = null, peerItemsAvg = null;
      if (enoughPeers) {
        const entries = peerKeys.filter((r) => r !== cand).map((r) => ({ items: state.peers[r]?.[cand] || blankItems(), total: sum(state.peers[r]?.[cand]) }));
        if (entries.length >= 3) {
          let maxIdx = 0; for (let i = 1; i < entries.length; i++) if (entries[i].total > entries[maxIdx].total) maxIdx = i;
          entries.splice(maxIdx, 1);
          let minIdx = 0; for (let i = 1; i < entries.length; i++) if (entries[i].total < entries[minIdx].total) minIdx = i;
          entries.splice(minIdx, 1);
          let acc = blankItems(); for (const e of entries) acc = addItems(acc, e.items);
          peerItemsAvg = divItems(acc, entries.length); peerAvg = sum(peerItemsAvg);
        }
      }
      let final = null;
      if (leaderAvg !== null && specAvg !== null && peerAvg !== null) final = leaderAvg * 0.4 + specAvg * 0.3 + peerAvg * 0.3;
      agg[cand] = { leaderAvg, leaderScore0, deputyScore0, leaderItems, deputyItems, specAvg, specItemsAvg, peerAvg, peerItemsAvg, final };
    }
    return { agg, specCount: specKeys.length, peerCount: peerKeys.length, leaderDone: !!leader };
  }

  function renderResults() {
    if (!state) return;
    const { agg, specCount, peerCount, leaderDone } = calcAggregates();
    const hint = [];
    if (!leaderDone) hint.push('班长未交');
    if (specCount < 1) hint.push(`专责缺${1 - specCount}`);
    if (peerCount < 3) hint.push(`互评缺${3 - peerCount}`);
    const hintEl = $('aggHint');
    hintEl.textContent = hint.length ? `缺失: ${hint.join(' ')}` : '数据完整，排名生效';
    hintEl.className = hint.length ? 'text-[10px] text-amber-400 mb-4 font-mono' : 'text-[10px] text-emerald-400 mb-4 font-mono';
    const arr = CANDIDATES.map((c) => ({ name: c, ...agg[c] })).sort((a, b) => (b.final ?? -1e9) - (a.final ?? -1e9));
    $('resultTbody').innerHTML = arr.map((r, idx) => {
      const rankColor = ['text-yellow-400', 'text-slate-300', 'text-amber-700'][idx] || 'text-slate-400';
      const rankIcon = ['🏆', '🥈', '🥉'][idx] || idx + 1;
      return `<tr class="hover:bg-slate-800/50 transition-colors"><td class="py-3 text-center font-bold ${rankColor}">${rankIcon}</td><td class="py-3 pl-2 font-medium text-slate-200">${esc(r.name)}</td><td class="py-3 text-right font-mono font-bold text-indigo-300">${fmt2(r.final)}</td></tr>`;
    }).join('');
  }

  const csvCell = (s) => { s = String(s ?? ''); return /[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  function exportCSV() {
    if (!state) return;
    const { agg } = calcAggregates();
    const arr = CANDIDATES.map((c) => ({ name: c, ...agg[c] })).sort((a, b) => (b.final ?? -1e9) - (a.final ?? -1e9));
    const head = ['排名', '员工', ...KEYS.map((k) => `班长_${k}`), '班长_总分', ...KEYS.map((k) => `副班_${k}`), '副班_总分', '管理均分', ...KEYS.map((k) => `专责_${k}`), '专责均分', ...KEYS.map((k) => `互评_${k}`), '互评均分', '最终得分'];
    const lines = [head.join(',')];
    arr.forEach((r, i) => {
      const cols = (it) => KEYS.map((k) => csvCell(it ? Number(it[k]).toFixed(1) : '-'));
      lines.push([i + 1, csvCell(r.name), ...cols(r.leaderItems), fmt1(r.leaderScore0), ...cols(r.deputyItems), fmt1(r.deputyScore0), fmt1(r.leaderAvg), ...cols(r.specItemsAvg), fmt1(r.specAvg), ...cols(r.peerItemsAvg), fmt1(r.peerAvg), fmt2(r.final)].join(','));
    });
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `绩效_${ym}_完整报表.csv`; a.click();
  }

  async function adminAct(body, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    try { await admin(body); await loadState(); await loadAll(); await loadMySheet(); }
    catch (e) { alert(e.message); if (e.status === 401) logout(); }
  }

  /* ---------------- wiring ---------------- */
  async function refresh() {
    try { await loadState(); } catch (e) { note(e.message, 'err'); return; }
    renderSubRoleOptions();
    if (adminPass) { try { await loadAll(); } catch (e) { logout(); } }
    await loadMySheet();
  }
  const guard = () => !dirty || confirm('当前的分数还没提交，确定切换吗？');

  $('month').value = ym;
  let lastRole = $('role').value, lastSub = '';
  $('role').addEventListener('change', () => { if (!guard()) { $('role').value = lastRole; return; } lastRole = $('role').value; renderSubRoleOptions(); lastSub = $('subRole').value; loadMySheet(); });
  $('subRole').addEventListener('change', () => { if (!guard()) { $('subRole').value = lastSub; return; } lastSub = $('subRole').value; loadMySheet(); });
  $('month').addEventListener('change', () => { if (!guard()) { $('month').value = ym; return; } ym = $('month').value || ymNow(); refresh(); });
  $('saveRole').addEventListener('click', submit);
  $('adminLogin').addEventListener('click', login);
  $('adminLogin2').addEventListener('click', login);
  $('adminLogout').addEventListener('click', logout);
  $('exportCsv').addEventListener('click', exportCSV);
  $('clearMonth').addEventListener('click', () => adminAct({ action: 'clear' }, `⚠️ 危险操作\n\n确定清空 ${ym} 所有人的评分吗？`));
  $('lockMonth').addEventListener('click', () => adminAct({ action: 'lock', locked: !locked }, locked ? '重新开放后大家可以继续修改，确定吗？' : '截止后所有人都不能再修改，确定吗？'));
  $('saveRoster').addEventListener('click', () => {
    const split = (s) => s.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
    adminAct({ action: 'roster', candidates: split($('rosterCands').value), specs: split($('rosterSpecs').value) });
  });
  $('progress').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reset]'); if (!b) return;
    const [role, sub] = b.dataset.reset.split('|');
    adminAct({ action: 'reset', role, sub }, `重置「${ROLE_NAME[role]}${sub ? ' · ' + sub : ''}」本月的评分？对方需要重新填写。`);
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  refresh();
})();
