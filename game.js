/* 凍土キャンプ — kikan の暇つぶしゲーム（実生活連動）
   index.html のグローバル（sb, session, tasks, journal, health, TODAY, toast, esc, streakDays, addDays）を使う */
(() => {
  const B = {
    lumber:  { name: '伐採所',   icon: '🪵', out: 'wood', base: 14, cost: l => ({ wood: Math.round(40 * 1.6 ** l) }), desc: '木材を集める' },
    mine:    { name: '炭鉱',     icon: '⛏️', out: 'coal', base: 9,  cost: l => ({ wood: Math.round(60 * 1.6 ** l) }), desc: '石炭を掘る' },
    hunt:    { name: '狩猟小屋', icon: '🏹', out: 'food', base: 11, cost: l => ({ wood: Math.round(50 * 1.6 ** l), coal: Math.round(10 * 1.5 ** l) }), desc: '食料を獲る' },
    house:   { name: '小屋',     icon: '🏠', cost: l => ({ wood: Math.round(80 * 1.7 ** l), coal: Math.round(20 * 1.5 ** l) }), desc: '生存者の寝床。1段階で +2 人' },
    furnace: { name: '大暖炉',   icon: '🔥', cost: l => ({ wood: Math.round(100 * 1.8 ** l), coal: Math.round(40 * 1.6 ** l) }), desc: 'キャンプの温度。石炭を食う' },
  };
  const RES = { wood: ['木材', '🪵'], coal: ['石炭', '⚫'], food: ['食料', '🍖'] };
  const MAXLV = 12, OFFLINE_CAP_H = 12, STEP_H = 0.25;
  const DEF = () => ({ v: 1, t: Date.now(), res: { wood: 120, coal: 60, food: 50 }, b: { lumber: 1, mine: 1, hunt: 1, house: 1, furnace: 1 }, s: 2, morale: 70, lit: true, arr: 0, claimed: {}, log: [], total: { wood: 0, coal: 0, food: 0 }, lastExplore: 0, days: 0, lastDay: null });

  let st = null, loadedFor = null, saveTimer = null, tickTimer = null, dirty = false;

  const fmt = n => Math.floor(n).toLocaleString();
  const cap = s => 2 + 2 * s.b.house;
  const temp = (s, bliz) => (s.lit ? -20 + 10 * s.b.furnace : -25) - (bliz ? 12 : 0);
  const coalUse = (s, bliz) => (s.lit ? (2 + 1.5 * s.b.furnace) * (bliz ? 2 : 1) : 0);
  const foodUse = s => 1.5 * s.s;
  const hash = str => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const blizzardOf = (dateIso) => { const h = hash(dateIso + 'bliz'); const start = 2 + (h % 20); return { start, end: start + 3 }; };
  const sgHour = (ts) => { const d = new Date(ts + 8 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60; };
  const sgDate = (ts) => new Date(ts + 8 * 3600e3).toISOString().slice(0, 10);
  const blizActive = (ts) => { const bz = blizzardOf(sgDate(ts)); const h = sgHour(ts); return h >= bz.start && h < bz.end; };

  function lifeMult() {
    const streak = typeof streakDays === 'function' ? streakDays() : 0;
    const over = (window.tasks || []).filter(t => t.status !== 'done' && t.due_date && t.due_date < TODAY).length;
    return { streak: Math.min(0.2, streak * 0.02), over: Math.min(0.25, over * 0.05), overN: over, streakN: streak };
  }
  const mult = (s) => { const lm = lifeMult(); return (0.5 + s.morale / 200) * (1 + 0.08 * (s.s - 1)) * (1 + lm.streak - lm.over); };
  const rateOf = (s, k) => B[k].base * s.b[k] * mult(s);
  const log = (s, msg) => { s.log.unshift({ t: Date.now(), m: msg }); s.log = s.log.slice(0, 12); };

  function simulate(s, now) {
    let dt = Math.max(0, (now - s.t) / 3600e3);
    const skipped = Math.max(0, dt - OFFLINE_CAP_H); dt = Math.min(dt, OFFLINE_CAP_H);
    let cur = s.t + skipped * 3600e3, arrived = 0, died = false;
    while (dt > 1e-6) {
      const h = Math.min(STEP_H, dt); const bz = blizActive(cur);
      const use = coalUse(s, bz) * h;
      if (s.lit && s.res.coal < use) { s.lit = false; log(s, '石炭が尽きて暖炉が消えた'); }
      else if (s.lit) s.res.coal -= use;
      const m = mult(s);
      for (const k of ['lumber', 'mine', 'hunt']) { const v = B[k].base * s.b[k] * m * h; s.res[B[k].out] += v; s.total[B[k].out] += v; }
      const fu = foodUse(s) * h; const fed = s.res.food >= fu; s.res.food = Math.max(0, s.res.food - fu);
      const warm = temp(s, bz) >= 0;
      s.morale = Math.max(0, Math.min(100, s.morale + (warm && fed ? 3 : -4) * h));
      if (warm && fed && s.morale >= 50 && s.s < cap(s) && s.res.food >= 20) { s.arr += h; if (s.arr >= 3) { s.arr = 0; s.s++; arrived++; } } else s.arr = Math.max(0, s.arr - h * 0.5);
      cur += h * 3600e3; dt -= h;
    }
    if (arrived) log(s, `生存者が ${arrived} 人たどり着いた（${s.s} 人）`);
    s.t = now;
    const d = sgDate(now); if (s.lastDay !== d) { s.lastDay = d; s.days++; }
  }

  function credit() {
    if (!st) return;
    const s = st; const gains = [];
    const add = (k, v) => { s.res[k] += v; s.total[k] += v; };
    const since = addDays(TODAY, -3);
    for (const t of (window.tasks || [])) {
      if (t.status !== 'done' || !t.done_at) continue; const d = new Date(t.done_at); const iso = sgDate(d.getTime()); if (iso < since) continue;
      const key = 'task:' + t.id; if (s.claimed[key]) continue; s.claimed[key] = 1;
      const w = 20 + Math.round((t.est_min || 0) / 3); add('wood', w); add('food', 10); add('coal', 5);
      gains.push(`タスク「${t.title.slice(0, 14)}」→ 🪵${w} 🍖10 ⚫5`);
    }
    if ((window.journal || []).some(j => j.entry_date === TODAY) && !s.claimed['j:' + TODAY]) { s.claimed['j:' + TODAY] = 1; add('food', 30); gains.push('今日のジャーナル → 🍖30'); }
    const h = (window.health || []).find(x => x.date === TODAY);
    if (h) for (const k of ['sleep_h', 'condition', 'exercise']) {
      if (h[k] == null || h[k] === '') continue; const key = `h:${TODAY}:${k}`; if (s.claimed[key]) continue; s.claimed[key] = 1;
      add('coal', 10); let msg = `コンディション記録 → ⚫10`;
      if (k === 'exercise' && h[k] !== 'none') { s.morale = Math.min(100, s.morale + 10); msg += ' · 運動で士気 +10'; }
      gains.push(msg);
    }
    for (const k of Object.keys(s.claimed)) { const m = k.match(/^(j|h):(\d{4}-\d{2}-\d{2})/); if (m && m[2] < addDays(TODAY, -10)) delete s.claimed[k]; }
    for (const g of gains) log(s, g);
    if (gains.length) markDirty();
    return gains;
  }

  function markDirty() { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 1500); }
  async function save() {
    if (!st || !dirty || !window.session) return; dirty = false;
    const { error } = await sb.from('game_state').upsert({ user_id: session.user.id, state: st, updated_at: new Date().toISOString() });
    if (error) { dirty = true; console.error(error); }
  }
  async function load() {
    const uid = session?.user?.id; if (!uid || loadedFor === uid) return;
    const { data, error } = await sb.from('game_state').select('state').eq('user_id', uid).maybeSingle();
    if (error) { console.error(error); return; }
    st = (data && data.state && data.state.v) ? Object.assign(DEF(), data.state) : DEF();
    loadedFor = uid;
    if (!data) { log(st, '吹雪の中、2 人の生存者とキャンプを始めた'); markDirty(); }
    simulate(st, Date.now()); credit();
    if (!tickTimer) tickTimer = setInterval(() => { if (!st) return; simulate(st, Date.now()); markDirty(); if (isOpen()) render(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    render();
  }
  const isOpen = () => document.getElementById('tab-camp')?.dataset.on === '1';

  function canPay(cost) { return Object.entries(cost).every(([k, v]) => st.res[k] >= v); }
  function pay(cost) { for (const [k, v] of Object.entries(cost)) st.res[k] -= v; }
  const costTxt = cost => Object.entries(cost).map(([k, v]) => `${RES[k][1]}${fmt(v)}`).join(' ');

  window.campUpgrade = (k) => {
    simulate(st, Date.now()); const lv = st.b[k]; if (lv >= MAXLV) return;
    const cost = B[k].cost(lv); if (!canPay(cost)) { toast('資源が足りません'); return; }
    pay(cost); st.b[k]++; log(st, `${B[k].name}を Lv${st.b[k]} に強化`); markDirty(); render(); toast(`${B[k].name} Lv${st.b[k]}`);
  };
  window.campLight = () => {
    simulate(st, Date.now());
    if (st.lit) { st.lit = false; log(st, '暖炉を消して石炭を節約'); }
    else { if (st.res.coal < 10) { toast('石炭が 10 以上必要です'); return; } st.lit = true; log(st, '暖炉に火を入れた'); }
    markDirty(); render();
  };
  window.campExplore = () => {
    simulate(st, Date.now()); const now = Date.now(); const cd = 10 * 60e3;
    if (now - st.lastExplore < cd) { toast(`あと ${Math.ceil((cd - (now - st.lastExplore)) / 60e3)} 分で出発できます`); return; }
    st.lastExplore = now; const r = Math.random(); const k = r < 0.45 ? 'wood' : r < 0.75 ? 'food' : 'coal'; const v = Math.round((10 + Math.random() * 20) * (1 + st.s / 4));
    st.res[k] += v; st.total[k] += v; let msg = `探索で ${RES[k][1]}${v} を見つけた`;
    if (Math.random() < 0.12 && st.s < cap(st)) { st.s++; msg += '。凍えた生存者を連れ帰った'; }
    log(st, msg); markDirty(); render(); toast(msg);
  };

  function render() {
    const el = document.getElementById('camp'); if (!el || !st) return;
    const s = st; const now = Date.now(); const bz = blizActive(now), bzi = blizzardOf(sgDate(now)); const T = temp(s, bz); const lm = lifeMult();
    const use = coalUse(s, bz); const coalLeft = s.lit && use ? s.res.coal / use : null;
    const warm = T >= 0, hungry = s.res.food <= 0;
    const rate = k => (B[k].base * s.b[k] * mult(s));
    const netCoal = rate('mine') - use, netFood = rate('hunt') - foodUse(s);
    const status = !s.lit ? '🥶 暖炉が消えている' : bz ? '🌨️ 吹雪の中' : warm ? '🙂 落ち着いている' : '🥶 寒い';
    const warn = [];
    if (!s.lit) warn.push('暖炉が消えています。石炭を 10 以上ためて火を入れてください');
    if (s.lit && coalLeft !== null && coalLeft < 3) warn.push(`石炭があと ${coalLeft.toFixed(1)} 時間分`);
    if (hungry) warn.push('食料が尽きています。狩猟小屋を強化するか探索へ');
    if (!bz && sgHour(now) < bzi.start) warn.push(`今日の吹雪 ${bzi.start}:00–${bzi.end}:00（石炭の消費が 2 倍）`);
    const resTiles = Object.entries(RES).map(([k, [n, ic]]) => { const r = k === 'wood' ? rate('lumber') : k === 'coal' ? netCoal : netFood; return `<div class="ctile"><div class="ci">${ic}</div><div><div class="cv">${fmt(s.res[k])}</div><div class="cl">${n} <span class="${r < 0 ? 'neg' : ''}">${r >= 0 ? '+' : ''}${r.toFixed(1)}/h</span></div></div></div>`; }).join('');
    const blds = Object.entries(B).map(([k, b]) => { const lv = s.b[k]; const cost = b.cost(lv); const ok = canPay(cost); const info = b.out ? `${RES[b.out][1]} +${rate(k).toFixed(1)}/h` : k === 'house' ? `定員 ${cap(s)} 人` : `${T}℃ · ⚫${use.toFixed(1)}/h`;
      return `<div class="cb"><div class="ci">${b.icon}</div><div class="cbt"><div><b>${b.name}</b> <span class="muted">Lv${lv}</span></div><div class="muted">${info}</div></div>${lv >= MAXLV ? '<span class="chip ok">最大</span>' : `<button class="btn sm ${ok ? '' : 'flat'}" onclick="campUpgrade('${k}')" ${ok ? '' : 'disabled'}>強化 ${costTxt(cost)}</button>`}</div>`; }).join('');
    const expCd = Math.max(0, 10 * 60e3 - (now - s.lastExplore));
    const supply = [
      `タスク完了 → 🪵20+（所要時間分）🍖10 ⚫5`, `ジャーナル（1日1回）→ 🍖30`, `コンディション記録 → 項目ごとに ⚫10、運動で士気 +10`,
      `ジャーナル連続 ${lm.streakN} 日 → 生産 +${Math.round(lm.streak * 100)}%`, lm.overN ? `期限超過 ${lm.overN} 件 → 生産 −${Math.round(lm.over * 100)}%（片づけると戻る）` : '期限超過なし → 減産なし',
    ];
    el.innerHTML = `
      <div class="card ccard"><div class="chd"><div><b>凍土キャンプ</b><div class="muted">${s.days} 日目 · ${status}</div></div><div class="ctemp ${warm ? '' : 'cold'}">${T}℃</div></div>
        <div class="cstat"><span>👥 生存者 <b>${s.s}</b>/${cap(s)}</span><span>士気 <b>${Math.round(s.morale)}</b></span><span>生産 ×${mult(s).toFixed(2)}</span></div>
        <div class="tr"><i style="width:${s.morale}%"></i></div>
        ${warn.length ? `<div class="cwarn">${warn.map(esc).join('<br>')}</div>` : ''}
      </div>
      <div class="ctiles">${resTiles}</div>
      <div class="card ccard"><div class="chd"><b>🔥 大暖炉</b><button class="btn sm ${s.lit ? 'flat' : ''}" onclick="campLight()">${s.lit ? '消す' : '火を入れる'}</button></div>
        <div class="muted">${s.lit ? `燃焼中 · ⚫${use.toFixed(1)}/h · あと ${coalLeft > 99 ? '99+' : coalLeft.toFixed(1)} 時間分` : '消えている · 生存者の士気が下がる'}${bz ? ' · 🌨️ 吹雪で消費 2 倍' : ''}</div></div>
      <div class="card ccard"><div class="chd"><b>🏕️ 施設</b><span class="muted">強化は木材と石炭</span></div>${blds}</div>
      <div class="card ccard"><div class="chd"><b>🧭 探索</b><button class="btn sm" onclick="campExplore()" ${expCd ? 'disabled' : ''}>${expCd ? `あと ${Math.ceil(expCd / 60e3)} 分` : '出発する'}</button></div><div class="muted">10 分に 1 回。資源か、運がよければ生存者を見つける</div></div>
      <div class="card ccard"><div class="chd"><b>📦 供給（実生活連動）</b></div><ul class="clist">${supply.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card ccard"><div class="chd"><b>📜 記録</b><span class="muted">累計 🪵${fmt(s.total.wood)} ⚫${fmt(s.total.coal)} 🍖${fmt(s.total.food)}</span></div>${s.log.length ? s.log.map(l => `<div class="clog"><span class="muted">${new Date(l.t).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' })}</span>${esc(l.m)}</div>`).join('') : '<div class="muted">まだ何も起きていない</div>'}</div>`;
  }

  window.Game = {
    sync() { if (!st) { load(); return; } simulate(st, Date.now()); const g = credit(); if (isOpen()) render(); return g; },
    open() { if (!st) { load(); return; } simulate(st, Date.now()); credit(); render(); },
    save,
  };
})();
