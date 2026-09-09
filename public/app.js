// Familiens Løbeklub — the whole UI. One state object, one render() that
// rebuilds the screen from templates, event delegation on data-* attributes.
// No transitions: state changes are instant, as in the design.
//
// The server computes every figure (see src/stats.js); this file only picks
// the period, decides adjusted vs raw ranking, and formats.

(function () {
  const app = document.getElementById('app');
  const PERIODS = [
    { key: 'week', label: 'UGE' },
    { key: 'month', label: 'MÅNED' },
    { key: 'year', label: 'ÅR' },
    { key: 'all', label: 'SIDEN STARTEN' },
  ];
  const TABS = [
    { key: 'board', label: 'TAVLEN', title: 'Stillingen' },
    { key: 'log', label: 'LOG TUR', title: 'Log en tur' },
    { key: 'me', label: 'MIG', title: 'Løber' },
    { key: 'family', label: 'FAMILIEN', title: 'Familien' },
  ];
  const TITLES = { recap: 'Ugens resultat', nudges: 'Beskeder', setup: 'Justering' };
  const SHARE_FILLS = ['fill-s0', 'fill-s1', 'fill-s2', 'fill-s3', 'fill-s4', 'fill-s5', 'fill-s6', 'fill-s7'];

  let S = null; // server state: /api/state
  let F = null; // family + login tiles: /api/family
  const st = {
    screen: 'board', period: 'week', adjusted: true,
    viewed: null, rival: null,
    dist: 6.0, mins: 34, day: 'today', pickDate: '', feel: 'ok',
    toast: '', error: '', busy: false,
    loginPick: null, pin: '',
    draftAdjust: null, // { memberId: value } while on the Justering screen
    editing: null, // 'dist' | 'mins' while a value on Log tur is being typed
    editMember: null, // member id whose details are open on Justering
    addMember: false,
    confirmDelete: null, // activity id awaiting "JA, SLET" on Mig
    allRuns: false, // the run list on Mig is cut to the latest few by default
  };

  // --- API ------------------------------------------------------------------------

  async function api(method, url, body) {
    const res = await fetch(url, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `${res.status}`), { status: res.status });
    return data;
  }

  async function boot() {
    // An importer that posts runs can send the browser back with ?import=<count>.
    const q = new URLSearchParams(location.search);
    if (q.has('import')) {
      const count = Number(q.get('import'));
      st.toast = count > 0 ? `IMPORTERET · ${count} ${count === 1 ? 'NY TUR' : 'NYE TURE'} FRA APPLE SUNDHED` : 'IMPORTERET · INGEN NYE TURE — ALT VAR ALLEREDE MED';
      history.replaceState(null, '', location.pathname);
    }
    F = await api('GET', '/api/family');
    try {
      S = await api('GET', '/api/state');
      st.screen = 'board';
    } catch (e) {
      if (e.status !== 401) throw e;
      st.screen = 'login';
    }
    afterState();
    render();
  }

  function afterState() {
    if (!S) return;
    if (!st.viewed || !S.members.some((m) => m.id === st.viewed)) st.viewed = S.me.id;
    if (!st.rival || st.rival === st.viewed || !S.members.some((m) => m.id === st.rival)) st.rival = defaultRival(st.viewed);
  }

  function defaultRival(id) {
    // The closest competitor on this period's board, else anyone but yourself.
    const rows = ranked();
    const i = rows.findIndex((r) => r.memberId === id);
    const cand = rows[i - 1] || rows[i + 1] || rows.find((r) => r.memberId !== id);
    return cand ? cand.memberId : null;
  }

  // --- Derived ------------------------------------------------------------------------

  const member = (id) => S.members.find((m) => m.id === id);
  const memberStats = (id) => S.stats.members.find((m) => m.memberId === id);
  const periodLabel = () => S.stats.periodLabels[st.period];

  // Rows for the current period, ordered by the active mode. score = the ranked number.
  function ranked() {
    const p = S.stats.periods[st.period];
    const rows = (st.adjusted ? p.rows : p.rowsRaw).map((r) => ({ ...r, score: st.adjusted ? r.points : r.km }));
    return rows;
  }

  // --- Formatting -----------------------------------------------------------------------

  function n(v, dec) {
    const d = dec === undefined ? (Math.abs(v) >= 100 ? 0 : 1) : dec;
    return Number(v).toFixed(d).replace('.', ',');
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const up = (s) => esc(String(s).toUpperCase());
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  function fmtDate(iso) {
    const d = new Date(iso + 'T12:00:00');
    return `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  }
  // Distance keeps two decimals only when they are used: 6 → "6,0", 6.23 → "6,23".
  function kmStr(v) { return n(v, Math.round(v * 100) % 10 === 0 ? 1 : 2); }
  // Minutes with seconds when present: 34 → "34", 34.33 → "34:20".
  function minStr(m) {
    const total = Math.round(m * 60);
    const sec = total % 60;
    return sec ? `${Math.floor(total / 60)}:${String(sec).padStart(2, '0')}` : String(Math.round(m));
  }
  // Accepts "6,23", "6.23"; and for time "34", "34,5", "34:20", "1:02:15".
  function parseKm(text) {
    const v = Number(String(text).trim().replace(',', '.'));
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  }
  function parseMinutes(text) {
    const t = String(text).trim().replace(',', '.');
    if (!t) return null;
    if (t.includes(':')) {
      const parts = t.split(':').map(Number);
      if (parts.some((x) => !Number.isFinite(x) || x < 0)) return null;
      const [h, m, sec] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
      const total = h * 60 + m + sec / 60;
      return total > 0 ? Math.round(total * 100) / 100 : null;
    }
    const v = Number(t);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  }
  function paceStr(mins, km) {
    const s = (mins * 60) / Math.max(km, 0.1);
    return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  }
  function shiftDate(iso, days) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // --- Render ---------------------------------------------------------------------------

  function render() {
    const chrome = st.screen !== 'recap' && st.screen !== 'login';
    app.className = st.screen === 'recap' ? 'recap' : '';
    const tab = TABS.find((t) => t.key === st.screen);
    const title = tab ? tab.title : TITLES[st.screen] || 'Stillingen';
    const body = { board, log, me, family, recap, nudges, setup, login }[st.screen]();
    app.innerHTML = `
      ${chrome ? `<div class="hdr">
        <div><div class="kicker">${esc(S?.family || F.name)}</div><div class="title">${esc(title)}</div></div>
        <button class="btn-msgs" data-go="nudges">BESKEDER ${S.nudges.length}</button>
      </div>` : ''}
      <div class="scroll">${body}</div>
      ${chrome ? `<nav class="tabs">${TABS.map((t) => `<button class="${t.key === st.screen ? 'on' : ''}" data-go="${t.key}">${t.label}</button>`).join('')}</nav>` : ''}`;
    if (st.screen === 'login') { const i = app.querySelector('#pinInput'); if (i && st.loginPick) i.focus(); }
    if (st.screen === 'log' && st.day === 'pick') { const i = app.querySelector('#pickDate'); if (i && !st.pickDate) i.focus(); }
    if (st.screen === 'log' && st.editing) { const i = app.querySelector('#distInput, #minsInput'); if (i) { i.focus(); i.select(); } }
    if (st.screen === 'setup' && (st.editMember || st.addMember)) { const i = app.querySelector('.mform input'); if (i && !i.value) i.focus(); }
  }

  function toast() {
    return st.toast ? `<div class="toast num"><span>${esc(st.toast)}</span><button data-act="clearToast">OK</button></div>` : '';
  }

  // 1. Tavlen
  function board() {
    const rows = ranked();
    const top = rows[0]?.score || 0;
    const p = S.stats.periods[st.period];
    const lead = rows[0];
    const unit = st.adjusted ? 'POINT' : 'KM';
    const empty = !lead || lead.score === 0;
    return `
      <div class="seg">${PERIODS.map((x) => `<button class="${x.key === st.period ? 'on' : ''}" data-period="${x.key}">${x.label}</button>`).join('')}</div>
      ${toast()}
      <div class="hero">
        <div class="top"><span>FØRENDE · ${esc(periodLabel())}</span><span>${st.adjusted ? 'JUSTERET' : 'RÅ KM'}</span></div>
        ${empty
          ? `<div class="name">Ingen<br>endnu</div><div class="taunt">Tavlen er tom for ${esc(periodLabel().toLowerCase())}. Første tur tager førstepladsen.</div>`
          : `<div class="name">${up(lead.name)}</div>
             <div class="score num"><b>${n(lead.score)}</b><span>${st.adjusted ? `POINT · ${n(lead.km)} KM I VIRKELIGHEDEN` : `KM · ${n(lead.points)} POINT JUSTERET`}</span></div>
             <div class="taunt">${esc(S.stats.taunts[st.period])}</div>`}
      </div>
      <div class="mode">
        <button class="toggle" data-act="toggleMode">SKIFT TIL ${st.adjusted ? 'RÅ KM' : 'JUSTERET'}</button>
        <button class="recap-link" data-go="recap">UGENS RESULTAT →</button>
      </div>
      ${rows.map((r, i) => {
        const isLead = i === 0 && r.score > 0;
        const gap = isLead ? 'FØRER' : r.score === 0 ? 'ingen ture' : `−${n(top - r.score)} ${unit.toLowerCase()}`;
        const pct = top > 0 ? Math.max(4, (r.score / top) * 100).toFixed(1) : 4;
        const fill = isLead ? 'fill-red' : r.memberId === S.me.id ? 'fill-me' : 'fill-rest';
        return `<button class="row" data-open="${r.memberId}">
          <div class="line">
            <span class="tile ${isLead ? 'lead' : ''} num">${String(i + 1).padStart(2, '0')}</span>
            <span class="who"><span class="n">${esc(r.name)}</span><span class="m num">${esc(r.tag)} · ${n(r.km)} km · ${r.runs} ${r.runs === 1 ? 'tur' : 'ture'} · ×${n(r.adjustment, 2)}</span></span>
            <span class="sc num"><b>${n(r.score)}</b><span>${esc(gap)}</span></span>
          </div>
          <div class="track"><div class="${fill}" style="width:${pct}%"></div></div>
        </button>`;
      }).join('')}
      <div class="board-foot">
        <button data-go="setup">${st.adjusted ? 'Point = rigtige km × aldersjustering.' : 'Rå kilometer. De voksne vinder. Chokerende.'} Sæt justering →</button>
        <span class="num">${n(p.familyKm)} km som familie</span>
      </div>`;
  }

  // 2. Log tur
  function log() {
    const me = S.me;
    const today = S.stats.today;
    const days = [{ k: 'today', l: 'I DAG' }, { k: 'yest', l: 'I GÅR' }, { k: 'pick', l: 'VÆLG DATO' }];
    const feels = [{ k: 'let', l: 'LET' }, { k: 'ok', l: 'OK' }, { k: 'haard', l: 'HÅRD' }];
    return `
      <div class="sec tight"><div class="label">LØBER</div><div class="runner">${esc(me.name)}</div><div class="runner-note num">${esc(me.tag)} · justering ×${n(me.adjustment, 2)}</div></div>
      <div class="sec"><div class="label">AFSTAND</div>
        <div class="stepper"><button data-act="dist" data-d="-0.5" aria-label="Mindre">–</button>
          <div class="val num">${st.editing === 'dist'
            ? `<input class="big edit" id="distInput" inputmode="decimal" value="${kmStr(st.dist)}" aria-label="Kilometer">`
            : `<button class="big tap" id="distVal" data-edit="dist" title="Tryk for at skrive">${kmStr(st.dist)}</button>`}<span class="unit">KM</span></div>
          <button class="plus" data-act="dist" data-d="0.5" aria-label="Mere">+</button></div>
        <div class="pts-note num">= ${n(st.dist * me.adjustment, 1)} POINT MED DIN JUSTERING</div>
        <div class="type-hint">Tryk på tallet for at skrive det præcist, fx 6,23.</div>
      </div>
      <div class="sec"><div class="label">TID</div>
        <div class="stepper small"><button data-act="mins" data-d="-5" aria-label="Mindre">–</button>
          <div class="val num">${st.editing === 'mins'
            ? `<input class="mid edit" id="minsInput" inputmode="numeric" value="${minStr(st.mins)}" aria-label="Minutter">`
            : `<button class="mid tap" id="minsVal" data-edit="mins" title="Tryk for at skrive">${minStr(st.mins)}</button>`}<span class="unit">MIN</span></div>
          <button class="plus" data-act="mins" data-d="5" aria-label="Mere">+</button></div>
        <div class="pace-note num">TEMPO ${paceStr(st.mins, st.dist)} / KM</div>
        <div class="type-hint">Tryk på tallet for at skrive, fx 34:20.</div>
      </div>
      <div class="sec"><div class="label">HVORNÅR</div>
        <div class="seg three">${days.map((d) => `<button class="${d.k === st.day ? 'on' : ''}" data-day="${d.k}">${d.l}</button>`).join('')}</div>
        ${st.day === 'pick' ? `<input class="date-input" type="date" id="pickDate" max="${today}" value="${esc(st.pickDate)}">` : ''}
      </div>
      <div class="sec"><div class="label">HVORDAN VAR DEN</div>
        <div class="seg three">${feels.map((f) => `<button class="${f.k === st.feel ? 'on' : ''}" data-feel="${f.k}">${f.l}</button>`).join('')}</div>
      </div>
      <div class="stack">
        <button class="btn-block primary save" data-act="save" ${st.busy ? 'disabled' : ''}>GEM TUREN →</button>
        ${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}
        <div class="note">Hele familien får en besked i samme sekund du gemmer. Taster du forkert, kan du slette turen igen under MIG.</div>
      </div>`;
  }


  // 3. Mig
  function me() {
    const v = member(st.viewed);
    const ms = memberStats(v.id);
    const rows = ranked();
    const row = rows.find((r) => r.memberId === v.id);
    const rank = rows.findIndex((r) => r.memberId === v.id) + 1;
    const rival = member(st.rival);
    const rrow = rows.find((r) => r.memberId === st.rival) || { points: 0, km: 0, runs: 0, avgKm: 0 };
    const maxDay = Math.max(1, ...ms.week7.map((d) => d.km));
    const defs = [
      { label: 'POINT', a: row.points, b: rrow.points, f: (x) => n(x) },
      { label: 'RIGTIGE KM', a: row.km, b: rrow.km, f: (x) => n(x) },
      { label: 'TURE', a: row.runs, b: rrow.runs, f: (x) => String(x) },
      { label: 'SNIT / TUR', a: row.avgKm, b: rrow.avgKm, f: (x) => n(x, 1) },
    ];
    const wins = defs.filter((d) => d.a >= d.b).length;
    const isMe = v.id === S.me.id;
    const pr = S.stats.periods[st.period];
    const imported = S.activities.filter((a) => a.memberId === v.id && a.source === 'apple_health' && a.date >= pr.from && a.date <= pr.to).length;
    return `
      <div class="chips">${S.members.map((m) => `<button class="${m.id === st.viewed ? 'on' : ''}" data-view="${m.id}">${up(m.name)}</button>`).join('')}</div>
      ${toast()}
      <div class="sec">
        <div class="me-head">
          <div><div class="n">${esc(v.name)}</div><div class="t num">${up(v.tag)} · JUSTERING ×${n(v.adjustment, 2)}</div></div>
          <div class="badge"><div class="l">PLADS</div><div class="v num">${rank}</div></div>
        </div>
      </div>
      <div class="grid2">
        <div><div class="l">POINT · ${esc(periodLabel())}</div><div class="v num">${n(row.points)}</div><div class="s num">${n(row.km)} rigtige km</div></div>
        <div><div class="l">TURE LOGGET</div><div class="v num">${row.runs}</div><div class="s num">${row.runs ? `${n(row.avgKm, 1)} km i snit${imported ? ` · ${imported} fra Sundhed` : ''}` : 'ingen endnu'}</div></div>
        <div><div class="l">LÆNGSTE NOGENSINDE</div><div class="v num">${ms.longest ? `${n(ms.longest.km, 1)} km` : '—'}</div><div class="s">${ms.longest ? esc(fmtDate(ms.longest.date)) : 'første tur venter'}</div></div>
        <div><div class="l">AKTIV STIME</div><div class="v num">${ms.weekStreak} ${ms.weekStreak === 1 ? 'uge' : 'uger'}</div><div class="s">uger med mindst én tur</div></div>
      </div>
      <div class="sec tight"><div class="label">SIDSTE 7 DAGE · KM</div>
        <div class="bars7">${ms.week7.map((d) => `<div><div class="${d.km === 0 ? 'fill-n300' : d.km === maxDay ? 'fill-red' : 'fill-ink'}" style="height:${Math.max(3, (d.km / maxDay) * 100).toFixed(0)}%"></div><div class="d">${d.day}</div></div>`).join('')}</div>
      </div>
      ${runList(v)}
      <div class="sec tight">
        <div class="label-row"><span class="label">EN MOD EN · ${esc(periodLabel())}</span><span class="verdict">${isMe ? 'DU' : up(v.name)} ${wins >= 3 ? `VINDER ${wins}/4` : `TABER ${4 - wins}/4`}</span></div>
        <div class="rivals">${S.members.filter((m) => m.id !== v.id).map((m) => `<button class="${m.id === st.rival ? 'on' : ''}" data-rival="${m.id}">MOD ${up(m.name)}</button>`).join('')}</div>
        <div class="h2h">${defs.map((d) => {
          const mx = Math.max(d.a, d.b) || 1;
          return `<div><div class="lbl num"><span>${d.f(d.a)}</span><span>${d.label}</span><span>${d.f(d.b)}</span></div>
            <div class="pair"><div><div class="${d.a >= d.b ? 'fill-ink' : 'fill-n500'}" style="width:${((d.a / mx) * 100).toFixed(0)}%"></div></div>
            <div><div class="${d.b > d.a ? 'fill-red' : 'fill-n500'}" style="width:${((d.b / mx) * 100).toFixed(0)}%"></div></div></div></div>`;
        }).join('')}</div>
      </div>
      <div class="stack">
        <button class="btn-block" data-go="setup">SÆT JUSTERING PR. MEDLEM →</button>
        <button class="btn-block" data-act="logout">SKIFT FAMILIEMEDLEM →</button>
      </div>`;
  }

  // Every logged run, newest first, so a mistake can be taken off the board
  // again. You may delete your own; an admin may delete anyone's.
  const RUNS_SHOWN = 6;
  function runList(v) {
    const isMe = v.id === S.me.id;
    const mine = S.activities.filter((a) => a.memberId === v.id);
    const canDelete = isMe || S.me.isAdmin;
    const shown = st.allRuns ? mine : mine.slice(0, RUNS_SHOWN);
    return `<div class="sec tight runs">
      <div class="label-row"><span class="label">LOGGEDE TURE</span>${mine.length && canDelete ? '<span class="hint">TASTET FORKERT? SLET DEN</span>' : ''}</div>
      ${mine.length === 0
        ? `<div class="note" style="margin-top:11px">${isMe ? 'Du har ikke logget en tur endnu.' : `${esc(v.name)} har ikke logget en tur endnu.`}</div>`
        : `<div class="list">${shown.map((a) => runRow(a, canDelete)).join('')}</div>`}
      ${st.error && st.confirmDelete === null ? `<div class="err">${esc(st.error)}</div>` : ''}
      ${mine.length > RUNS_SHOWN ? `<button class="more" data-act="moreRuns">${st.allRuns ? 'VIS KUN DE SENESTE' : `VIS ALLE ${mine.length} TURE`}</button>` : ''}
    </div>`;
  }

  function runRow(a, canDelete) {
    const confirming = st.confirmDelete === a.id;
    const meta = [
      `${kmStr(a.km)} km`,
      a.minutes ? `${minStr(a.minutes)} min · ${paceStr(a.minutes, a.km)}/km` : null,
      a.source === 'apple_health' ? 'fra Sundhed' : null,
    ].filter(Boolean).join(' · ');
    return `<div class="r${confirming ? ' confirming' : ''}">
      <div class="line">
        <span class="who"><span class="d num">${up(fmtDate(a.date))}</span><span class="m num">${esc(meta)}</span></span>
        <span class="pt num"><b>${n(a.points)}</b><span>point</span></span>
        ${canDelete ? `<button class="rm" data-delrun="${esc(a.id)}" ${confirming ? 'disabled' : ''}>SLET</button>` : ''}
      </div>
      ${confirming ? `<div class="conf">
        <span>Slet turen? Den forsvinder fra tavlen og fra pointene.</span>
        <span class="acts"><button class="yes" data-delyes="${esc(a.id)}" ${st.busy ? 'disabled' : ''}>JA, SLET</button><button class="no" data-act="cancelDelete">BEHOLD</button></span>
        ${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}
      </div>` : ''}
    </div>`;
  }

  // 4. Familien
  function family() {
    const p = S.stats.periods[st.period];
    const rows = p.rows; // shares are raw km, listed in points order like the design
    const total = p.familyKm;
    const count = S.members.length;
    const fam = S.stats.family;
    const holder = fam.longestRun ? member(fam.longestRun.memberId) : null;
    return `
      <div class="sec">
        <div class="label">${esc(periodLabel())} · ${count === 5 ? 'ALLE FEM' : `ALLE ${count}`}</div>
        <div class="family-total num"><b>${n(total)}</b><span>KM SAMMEN</span></div>
        <div class="share">${total ? rows.map((r, i) => r.km > 0 ? `<div class="${SHARE_FILLS[i % SHARE_FILLS.length]}" style="width:${((r.km / total) * 100).toFixed(1)}%"></div>` : '').join('') : '<div style="flex:1"></div>'}</div>
        <div class="legend">${rows.map((r, i) => `<span class="num"><i class="${SHARE_FILLS[i % SHARE_FILLS.length]}"></i>${up(r.name)} ${total ? ((r.km / total) * 100).toFixed(0) : 0} %</span>`).join('')}</div>
      </div>
      <div class="grid2 family">
        <div><div class="l">TURE ${esc(periodLabel())}</div><div class="v num">${p.familyRuns}</div><div class="s">fordelt på ${count}</div></div>
        <div><div class="l">SNIT PR. PERSON</div><div class="v num">${n(total / Math.max(1, count))}</div><div class="s">km, ujusteret</div></div>
        <div><div class="l">STØRSTE UGE</div><div class="v num">${fam.biggestWeek ? n(fam.biggestWeek.km) : '—'}</div><div class="s">${fam.biggestWeek ? `uge ${fam.biggestWeek.isoWeek} · km som familie` : 'ingen ture endnu'}</div></div>
        <div><div class="l">LÆNGSTE TUR</div><div class="v num">${fam.longestRun ? n(fam.longestRun.km, 1) : '—'}</div><div class="s">${fam.longestRun ? `${esc(holder?.name || '')} · ${esc(fmtDate(fam.longestRun.date))}` : 'venter på den første'}</div></div>
      </div>
      <div class="sec tight"><div class="label">MEDALJESKABET · VUNDNE UGER</div>
        <div style="margin-top:12px">${S.stats.medals.map((m) => `<div class="medal"><span class="n">${esc(m.name)}</span><span class="pips">${Array.from({ length: Math.min(m.weeks, 8) }, (_, i) => `<i class="${i < 3 ? 'fill-red' : 'fill-ink'}"></i>`).join('')}</span><span class="c num">${m.weeks}</span></div>`).join('')}</div>
      </div>
      <div class="family-foot">Ugen nulstilles mandag kl. 00:00. Måned og år kører videre som løbende totaler, så en dårlig uge kan man overleve — en dårlig september kan man ikke.</div>`;
  }

  // 5. Ugens resultat
  function recap() {
    const r = S.stats.recap;
    const w = r.winnerId ? member(r.winnerId) : null;
    return `<div class="poster">
      <div class="kick">UGE ${r.isoWeek} · ${r.closed ? 'LUKKET SØNDAG 23:59' : 'LUKKER SØNDAG 23:59'}</div>
      <div class="head">
        <div class="is">${r.closed ? 'UGENS VINDER ER' : 'UGENS VINDER BLIVER'}</div>
        <div class="winner">${r.empty ? 'Ingen<br>endnu' : up(w.name)}</div>
        ${r.empty ? '' : `<div class="score num"><b>${n(r.rows[0].points)}</b><span>POINT · ${n(r.margin)} POINT FORAN</span></div>`}
      </div>
      <div class="taunt">${r.empty ? 'Ingen har løbet denne uge. Det er en invitation.' : esc(r.taunt)}</div>
      <div class="rows num">${r.rows.map((x, i) => `<div class="r"><span class="rk">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(x.name)}</span><span class="raw">${n(x.km)} KM</span><span class="pt">${n(x.points)}</span></div>`).join('')}</div>
      <div class="stack">
        <button class="btn-block white" data-act="share">SEND PRALERIET TIL FAMILIECHATTEN →</button>
        <button class="btn-block ghost-white" data-go="board">TILBAGE TIL TAVLEN</button>
      </div>
    </div>`;
  }

  // 6. Beskeder
  function nudges() {
    const prefs = [
      { key: 'overtaken', label: 'Sig til, når nogen overhaler mig' },
      { key: 'sunday', label: 'Søndagens resultat og ugeplakat' },
      { key: 'everyRun', label: 'Hver eneste tur, nogen logger' },
    ];
    const stripe = { accent: 'fill-red', ink: 'fill-ink', neutral: 'fill-n500', time: 'fill-ink' };
    return `
      <div class="sec copy">Beskederne er hele motoren. Hold dem drilske, men fair.</div>
      ${S.nudges.length ? S.nudges.map((x) => `<div class="nudge">
          <span class="stripe ${stripe[x.style] || 'fill-ink'}"></span>
          <span class="body"><span class="meta"><span>${esc(x.kind)}</span><span>${esc(x.time)}</span></span><span class="txt">${esc(x.text)}</span></span>
          <button class="rm" data-dismiss="${esc(x.id)}">FJERN</button>
        </div>`).join('')
        : '<div class="sec copy" style="border-bottom:1px solid var(--color-divider)">Ingen beskeder lige nu. Løb en tur, så kommer der nogle.</div>'}
      <div class="prefs"><div class="label">SEND MIG</div>
        ${prefs.map((p) => `<button class="pref" data-pref="${p.key}"><span>${p.label}</span><span class="switch ${S.prefs[p.key] ? 'on' : ''}"><i></i></span></button>`).join('')}
      </div>
      <div class="stack"><button class="btn-block" data-go="board">TILBAGE TIL TAVLEN</button></div>`;
  }

  // 7. Justering
  function setup() {
    const admin = S.me.isAdmin;
    const draft = st.draftAdjust || {};
    const adminName = S.members.find((m) => m.isAdmin)?.name || 'en voksen';
    return `
      <div class="sec copy" style="padding:14px 16px">Justeringen ganges på hver kilometer. ×1,00 er voksen-basis. Forslagene er sat efter alder — I kan altid selv skrue.
        <div><span class="adm" style="display:inline-block">${admin ? 'DU ER ADMIN — DU KAN ÆNDRE ALLES' : `KUN DIN EGEN — SPØRG ${up(adminName)}`}</span></div>
      </div>
      ${S.members.map((m) => {
        const editable = admin || m.id === S.me.id;
        const v = draft[m.id] ?? m.adjustment;
        return `<div class="frow ${m.id === S.me.id ? 'me' : ''}" data-member="${m.id}">
          <div class="line">
            <span class="who"><span class="n">${esc(m.name)}</span><span class="h num">${esc(m.ageHint)} · Forslag ${n(m.suggestion, 2)}</span></span>
            <button class="st" data-adj="${m.id}" data-d="-0.05" ${editable ? '' : 'disabled'} aria-label="Lavere">–</button>
            <span class="v num">×${n(v, 2)}</span>
            <button class="st" data-adj="${m.id}" data-d="0.05" ${editable ? '' : 'disabled'} aria-label="Højere">+</button>
          </div>
          <div class="track"><div class="${m.id === S.me.id ? 'fill-red' : 'fill-ink'}" style="width:${(((v - 1) / 2) * 100).toFixed(0)}%"></div></div>
          <div class="foot"><span class="ex num">10 km = ${n(10 * v, 1)} point</span><span>${admin ? `<button class="reset ink" data-editmember="${m.id}">${st.editMember === m.id ? 'LUK' : 'REDIGÉR'}</button>` : ''}<button class="reset" data-reset="${m.id}" ${editable ? '' : 'disabled'}>NULSTIL</button></span></div>
          ${st.editMember === m.id ? memberForm(m) : ''}
        </div>`;
      }).join('')}
      ${admin ? `<div class="sec tight">${st.addMember ? memberForm(null) : `<button class="btn-block" data-act="addMember">+ TILFØJ MEDLEM</button>`}</div>` : ''}
      <div class="stack">
        <button class="btn-block" data-act="resetAll">NULSTIL ALLE TIL FORSLAG</button>
        <button class="btn-block primary" data-act="saveAdjust" ${st.busy ? 'disabled' : ''}>GEM OG SE TAVLEN →</button>
        ${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}
        <div class="note">Ændringer gælder fra næste tur — gamle ture står med den justering, de blev logget med.</div>
      </div>`;
  }

  // Inline member form on Justering (admin only). m = null → add.
  function memberForm(m) {
    const isMe = m && m.id === S.me.id;
    return `<form class="mform" data-member-form="${m ? esc(m.id) : ''}">
      <div class="mgrid">
        <label><span>NAVN</span><input name="name" value="${esc(m?.name || '')}" maxlength="40" autocomplete="off" required></label>
        <label><span>ALDER</span><input name="age" inputmode="numeric" value="${m?.age ?? ''}" maxlength="3" placeholder="fx 8"></label>
        <label><span>ROLLE <i>(valgfri)</i></span><input name="role" value="${esc(m?.role || '')}" maxlength="20" placeholder="Far, Mor, Mormor…"></label>
        <label><span>INITIALER</span><input name="initials" value="${esc(m?.initials || '')}" maxlength="2" placeholder="auto"></label>
      </div>
      <div class="note num" style="margin-top:8px">Forslag til justering følger alderen: under 18 får et tillæg, voksne står på ×1,00. Justeringen selv sætter du med – og + ovenfor.</div>
      <div class="mactions">
        <button type="button" class="btn-block primary small" data-act="${m ? 'saveMember' : 'createMember'}" ${st.busy ? 'disabled' : ''}>${m ? 'GEM' : 'TILFØJ →'}</button>
        <button type="button" class="btn-block small" data-act="cancelMember">ANNULLER</button>
        ${m && !isMe ? `<button type="button" class="reset danger" data-removemember="${esc(m.id)}">FJERN MEDLEM OG ALLE TURE</button>` : ''}
      </div>
      ${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}
    </form>`;
  }

  // 8. Login
  function login() {
    const boxes = [0, 1, 2, 3].map((i) => `<span class="box ${i === st.pin.length && st.loginPick ? 'active' : ''}">${i < st.pin.length ? '•' : ''}</span>`).join('');
    return `<div class="login">
      <div class="poster-head">
        <div class="kick">STIFTET ${F.founded} · ${F.members.length} MEDLEMMER</div>
        <div class="club">Familiens<br>Løbe<br>Klub</div>
        <div class="promise">Én tavle. Alles kilometer, justeret efter alder, så ingen kan gemme sig bag sin fødselsdag.</div>
      </div>
      <div class="label who-label">HVEM LØBER?</div>
      <div class="tiles">
        ${F.members.map((m) => `<button class="${m.id === st.loginPick ? 'on' : ''}" data-pick="${m.id}"><span class="ini">${esc(m.initials)}</span><span class="nm">${esc(m.name)}</span><span class="tg">${esc(m.tag)}</span></button>`).join('')}
        <div class="explain">Tryk på et navn og tast familiens 4-cifrede kode én gang. Det er hele login.</div>
      </div>
      <div class="pin">
        <div class="label">FAMILIEKODE</div>
        <div class="boxes">${boxes}<input id="pinInput" type="tel" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]*" value="${esc(st.pin)}" aria-label="Familiekode" ${st.loginPick ? '' : 'disabled'}></div>
        ${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}
        <div class="invite">${F.loginEnabled ? 'Nyt medlem? Den, der oprettede klubben, tilføjer dig — ingen mail, intet kodeord.' : 'Familiekoden er ikke sat op på serveren endnu.'}</div>
      </div>
    </div>`;
  }

  // --- Events -------------------------------------------------------------------------------

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    try {
      if (d.go) {
        st.error = '';
        st.confirmDelete = null;
        if (d.go !== 'board') st.toast = '';
        if (d.go === 'me') { st.viewed = S.me.id; st.rival = defaultRival(S.me.id); st.allRuns = false; }
        if (d.go === 'setup') { st.draftAdjust = {}; st.editMember = null; st.addMember = false; }
        st.screen = d.go;
        render();
        // Someone else may have logged since we last looked — the board is live.
        if (d.go !== 'log') refresh().catch(() => {});
        return;
      }
      if (d.period) { st.period = d.period; return render(); }
      if (d.act === 'toggleMode') { st.adjusted = !st.adjusted; return render(); }
      if (d.act === 'clearToast') { st.toast = ''; return render(); }
      if (d.open) { st.viewed = d.open; st.rival = defaultRival(d.open); st.screen = 'me'; st.allRuns = false; st.confirmDelete = null; return render(); }
      if (d.view) { st.viewed = d.view; if (st.rival === d.view) st.rival = defaultRival(d.view); st.allRuns = false; st.confirmDelete = null; st.error = ''; return render(); }
      if (d.delrun) { st.confirmDelete = d.delrun; st.error = ''; return render(); }
      if (d.act === 'cancelDelete') { st.confirmDelete = null; st.error = ''; return render(); }
      if (d.delyes) return deleteRun(d.delyes);
      if (d.act === 'moreRuns') { st.allRuns = !st.allRuns; return render(); }
      if (d.rival) { st.rival = d.rival; return render(); }
      if (d.act === 'dist') { st.editing = null; st.dist = Math.max(0.5, +(st.dist + Number(d.d)).toFixed(2)); return render(); }
      if (d.act === 'mins') { st.editing = null; st.mins = Math.max(1, +(st.mins + Number(d.d)).toFixed(2)); return render(); }
      if (d.edit) { st.editing = d.edit; return render(); }
      if (d.day) { st.day = d.day; st.error = ''; return render(); }
      if (d.feel) { st.feel = d.feel; return render(); }
      if (d.act === 'save') return saveRun();
      if (d.act === 'logout') { await api('POST', '/api/logout'); S = null; st.loginPick = null; st.pin = ''; st.error = ''; st.screen = 'login'; return render(); }
      if (d.dismiss) { await api('POST', `/api/nudges/${encodeURIComponent(d.dismiss)}/dismiss`); S.nudges = S.nudges.filter((x) => x.id !== d.dismiss); return render(); }
      if (d.pref) { const next = { [d.pref]: !S.prefs[d.pref] }; S.prefs = { ...S.prefs, ...next }; render(); const r = await api('PUT', '/api/me/prefs', next); S.prefs = r.prefs; return refresh(false); }
      if (d.adj) { const m = member(d.adj); const cur = (st.draftAdjust || {})[d.adj] ?? m.adjustment; st.draftAdjust = { ...st.draftAdjust, [d.adj]: Math.min(3, Math.max(1, +(cur + Number(d.d)).toFixed(2))) }; return render(); }
      if (d.reset) { const m = member(d.reset); st.draftAdjust = { ...st.draftAdjust, [d.reset]: m.suggestion }; return render(); }
      if (d.act === 'resetAll') { st.draftAdjust = Object.fromEntries(S.members.filter((m) => S.me.isAdmin || m.id === S.me.id).map((m) => [m.id, m.suggestion])); return render(); }
      if (d.act === 'saveAdjust') return saveAdjustments();
      if (d.editmember) { st.editMember = st.editMember === d.editmember ? null : d.editmember; st.addMember = false; st.error = ''; return render(); }
      if (d.act === 'addMember') { st.addMember = true; st.editMember = null; st.error = ''; return render(); }
      if (d.act === 'cancelMember') { st.addMember = false; st.editMember = null; st.error = ''; return render(); }
      if (d.act === 'saveMember' || d.act === 'createMember') return saveMember(b.closest('.mform'));
      if (d.removemember) return removeMember(d.removemember);
      if (d.act === 'share') return share();
      if (d.pick) { st.loginPick = d.pick; st.pin = ''; st.error = ''; return render(); }
    } catch (err) {
      st.error = err.message; st.busy = false; render();
    }
  });

  function commitEdit(input) {
    if (input.id === 'distInput') { const v = parseKm(input.value); if (v !== null) st.dist = Math.min(300, v); }
    if (input.id === 'minsInput') { const v = parseMinutes(input.value); if (v !== null) st.mins = Math.min(24 * 60, v); }
    st.editing = null;
    render();
  }
  app.addEventListener('focusout', (e) => { if (e.target.id === 'distInput' || e.target.id === 'minsInput') commitEdit(e.target); });
  app.addEventListener('keydown', (e) => {
    if ((e.target.id === 'distInput' || e.target.id === 'minsInput') && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); commitEdit(e.target); }
    if (e.target.closest?.('.mform') && e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.closest('.mform').querySelector('[data-act="saveMember"], [data-act="createMember"]')?.click(); }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'pinInput') {
      // Update the boxes in place: re-rendering the input mid-typing recreates it
      // with the caret at the start, so the digits would come out reversed.
      st.pin = e.target.value.replace(/\D/g, '').slice(0, 4);
      st.error = '';
      e.target.value = st.pin;
      app.querySelectorAll('.pin .box').forEach((box, i) => {
        box.textContent = i < st.pin.length ? '•' : '';
        box.classList.toggle('active', i === st.pin.length);
      });
      app.querySelector('.pin .err')?.remove();
      if (st.pin.length === 4) doLogin();
    }
    if (e.target.id === 'pickDate') st.pickDate = e.target.value;
  });

  async function doLogin() {
    try {
      await api('POST', '/api/login', { memberId: st.loginPick, pin: st.pin });
      S = await api('GET', '/api/state');
      st.viewed = null; st.rival = null; afterState();
      st.screen = 'board'; st.pin = ''; st.error = '';
      render();
    } catch (err) {
      st.pin = ''; st.error = err.message; render();
    }
  }

  async function saveRun() {
    const today = S.stats.today;
    const date = st.day === 'today' ? today : st.day === 'yest' ? shiftDate(today, -1) : st.pickDate;
    if (!date) { st.error = 'Vælg en dato.'; return render(); }
    st.busy = true; st.error = ''; render();
    try {
      const r = await api('POST', '/api/activities', { date, km: st.dist, minutes: st.mins, feel: st.feel });
      S = r.state; afterState();
      st.toast = `GEMT · +${kmStr(r.activity.km)} KM (${n(r.activity.points, 1)} POINT)`;
      st.screen = 'board'; st.period = 'week';
      st.dist = 6.0; st.mins = 34; st.day = 'today'; st.pickDate = ''; st.feel = 'ok';
    } catch (err) { st.error = err.message; }
    st.busy = false; render();
  }

  async function deleteRun(id) {
    const a = S.activities.find((x) => x.id === id);
    st.busy = true; st.error = ''; render();
    try {
      const r = await api('DELETE', `/api/activities/${encodeURIComponent(id)}`);
      S = r.state; afterState();
      st.confirmDelete = null;
      st.toast = `SLETTET · ${a ? `${kmStr(a.km)} KM ER VÆK FRA TAVLEN` : 'TUREN ER VÆK FRA TAVLEN'}`;
    } catch (err) { st.error = err.message; }
    st.busy = false; render();
  }

  function readMemberForm(form) {
    const f = new FormData(form);
    return { name: f.get('name'), age: String(f.get('age')).trim(), role: f.get('role'), ...(String(f.get('initials')).trim() ? { initials: f.get('initials') } : {}) };
  }

  async function saveMember(form) {
    const id = form.dataset.memberForm;
    const body = readMemberForm(form);
    st.busy = true; st.error = ''; render();
    try {
      if (id) await api('PUT', `/api/members/${encodeURIComponent(id)}`, body);
      else await api('POST', '/api/members', body);
      await refresh(false);
      st.editMember = null; st.addMember = false;
    } catch (err) { st.error = err.message; }
    st.busy = false; render();
  }

  async function removeMember(id) {
    const m = member(id);
    if (!confirm(`Fjern ${m.name} og alle ${m.name}s ture? Det kan ikke gøres om.`)) return;
    st.busy = true; st.error = ''; render();
    try {
      const r = await api('DELETE', `/api/members/${encodeURIComponent(id)}`);
      S = r.state; afterState();
      st.editMember = null;
    } catch (err) { st.error = err.message; }
    st.busy = false; render();
  }


  async function saveAdjustments() {
    const changes = Object.entries(st.draftAdjust || {}).filter(([id, v]) => member(id).adjustment !== v);
    st.busy = true; st.error = ''; render();
    try {
      for (const [id, v] of changes) await api('PUT', `/api/members/${encodeURIComponent(id)}/adjustment`, { adjustment: v });
      await refresh(false);
      st.draftAdjust = null; st.screen = 'board';
    } catch (err) { st.error = err.message; }
    st.busy = false; render();
  }

  async function share() {
    const r = S.stats.recap;
    const w = r.winnerId ? member(r.winnerId) : null;
    const lines = [
      `UGE ${r.isoWeek} · ${S.family}`,
      w ? `Ugens vinder: ${w.name.toUpperCase()} — ${n(r.rows[0].points)} point, ${n(r.margin)} foran.` : 'Ingen løb i denne uge.',
      r.empty ? '' : r.taunt,
      '',
      ...r.rows.map((x, i) => `${i + 1}. ${x.name} · ${n(x.km)} km · ${n(x.points)} point`),
      '',
      location.origin,
    ].filter((l) => l !== null);
    const text = lines.join('\n');
    if (navigator.share) { try { await navigator.share({ text }); return; } catch { /* dismissed */ } }
    await navigator.clipboard?.writeText(text);
    st.toast = 'PRALERIET ER KOPIERET — SÆT DET IND I FAMILIECHATTEN';
    st.screen = 'board'; render();
  }

  async function refresh(rerender = true) {
    S = await api('GET', '/api/state'); afterState();
    if (rerender) render();
  }

  // Keep the board fresh when the tab comes back (someone else may have run).
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S && st.screen !== 'log') refresh().catch(() => {}); });

  boot().catch((err) => { app.innerHTML = `<div class="sec copy">Kunne ikke hente tavlen: ${esc(err.message)}</div>`; });
})();
