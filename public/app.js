// Dashboard controller. One fetch of /api/summary renders everything; every
// edit re-fetches, so the stats never drift from the data.

(function () {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let showAllRuns = false;

  const api = async (method, url, body) => {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
  };

  async function load() {
    state = await api('GET', '/api/summary');
    render();
  }

  // --- Rendering ------------------------------------------------------------------

  function render() {
    const { members, runs, stats, canEdit, editingEnabled } = state;
    document.querySelectorAll('.edit-only').forEach((n) => n.classList.toggle('d-none', !canEdit));
    $('unlockBtn').classList.toggle('d-none', canEdit || !editingEnabled);
    $('lockBtn').classList.toggle('d-none', !canEdit);
    $('noEditBanner').classList.toggle('d-none', editingEnabled);
    $('emptyState').classList.toggle('d-none', runs.length > 0);
    $('content').classList.toggle('d-none', runs.length === 0);
    $('asOf').textContent = `${stats.today.slice(0, 4)} · ${members.length} runner${members.length === 1 ? '' : 's'} · updated ${fmtDate(stats.today)}`;
    const sel = $('runMember');
    sel.innerHTML = members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    renderMemberList();
    if (runs.length === 0) return;

    const f = stats.family;
    $('statKmYear').textContent = fmt(f.year.km);
    $('statKmMonth').textContent = `${fmt(f.month.km)} km this month`;
    $('statRunsYear').textContent = f.year.runs;
    $('statRunsMonth').textContent = `${f.month.runs} this month`;
    $('statTimeYear').textContent = (f.year.durationSec / 3600).toFixed(1);
    $('statPaceYear').textContent = f.year.paceSecPerKm ? `avg pace ${pace(f.year.paceSecPerKm)}` : 'no timed runs yet';
    $('statKmAll').textContent = fmt(f.total.km);
    $('statRunsAll').textContent = `${f.total.runs} runs in total`;

    Charts.legend($('monthlyLegend'), stats.monthly.series);
    Charts.monthlyBars($('monthlyChart'), stats.monthly);
    renderMonthlyTable(stats.monthly);
    Charts.legend($('cumLegend'), stats.cumulativeYear.series);
    Charts.cumulativeLines($('cumChart'), stats.cumulativeYear);

    $('memberRows').innerHTML = stats.perMember.map((p) => `
      <tr>
        <td>${dot(p.colorSlot)}${esc(p.name)}</td>
        <td class="num">${fmt(p.year.km)}</td>
        <td class="num">${p.year.runs}</td>
        <td class="num">${p.year.paceSecPerKm ? pace(p.year.paceSecPerKm) : '—'}</td>
        <td class="num">${p.longest ? `${fmt(p.longest.distanceKm)} km` : '—'}</td>
        <td class="num">${p.weekStreak ? `${p.weekStreak} wk` : '—'}</td>
      </tr>`).join('');

    renderRecords(stats.records);

    const filter = $('logFilter');
    const current = filter.value;
    filter.innerHTML = '<option value="">Everyone</option>' + members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    filter.value = members.some((m) => m.id === current) ? current : '';
    renderRuns();
  }

  function renderMonthlyTable(monthly) {
    const head = monthly.months.map((mo) => `<th class="num">${new Date(mo + '-15').toLocaleString(undefined, { month: 'short' })}</th>`).join('');
    const rows = monthly.series.map((s) => `<tr><td>${dot(s.colorSlot)}${esc(s.name)}</td>${s.km.map((v) => `<td class="num">${v ? fmt(v) : '·'}</td>`).join('')}</tr>`).join('');
    $('monthlyTable').innerHTML = `<table class="table table-sm mb-0"><thead><tr><th>Runner</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderRecords(r) {
    const nameOf = (h) => (h ? esc(h.name) : '—');
    const rows = [
      ['Most km this year', r.mostKmYear ? `${fmt(r.mostKmYear.value)} km` : '—', r.mostKmYear],
      ['Most runs this year', r.mostRunsYear ? r.mostRunsYear.value : '—', r.mostRunsYear],
      ['Longest run', r.longestRun ? `${fmt(r.longestRun.value.distanceKm)} km · ${fmtDate(r.longestRun.value.date)}` : '—', r.longestRun],
      ['Longest week streak', r.longestStreak ? `${r.longestStreak.value} weeks` : '—', r.longestStreak],
      ...r.bests.map((b) => [
        `Fastest ${b.label}`,
        b.holder ? `${dur(b.holder.value.durationSec)} · ${pace(b.holder.value.durationSec / b.holder.value.distanceKm)}` : '—',
        b.holder,
      ]),
    ];
    $('records').innerHTML = rows.map(([label, val, holder]) => `
      <div class="record-row">
        <span>${label}<br><span class="text-muted small">${nameOf(holder)}</span></span>
        <span class="val">${val}</span>
      </div>`).join('');
  }

  function renderRuns() {
    const { runs, members, canEdit } = state;
    const byId = new Map(members.map((m) => [m.id, m]));
    const who = $('logFilter').value;
    const list = runs.filter((r) => !who || r.memberId === who);
    const shown = showAllRuns ? list : list.slice(0, 25);
    $('moreWrap').classList.toggle('d-none', showAllRuns || list.length <= 25);
    $('moreBtn').textContent = `Show all ${list.length} runs`;
    $('runRows').innerHTML = shown.length
      ? shown.map((r) => {
          const m = byId.get(r.memberId);
          return `<tr data-id="${r.id}">
            <td class="text-nowrap">${fmtDate(r.date)}</td>
            <td class="text-nowrap">${m ? dot(m.colorSlot) + esc(m.name) : '?'}</td>
            <td class="num">${fmt(r.distanceKm)}</td>
            <td class="num">${r.durationSec ? dur(r.durationSec) : '—'}</td>
            <td class="num">${r.durationSec ? pace(r.durationSec / r.distanceKm) : '—'}</td>
            <td>${esc(r.notes)}${r.source !== 'manual' ? ` <span class="tag tag-${r.source}">${r.source.replace('_', ' ')}</span>` : ''}</td>
            <td class="text-end">${canEdit ? `<button class="btn btn-link btn-sm p-0 edit-run">Edit</button>` : ''}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="7" class="text-muted">No runs yet.</td></tr>';
  }

  function renderMemberList() {
    const { members, stats } = state;
    const runsOf = new Map(stats.perMember.map((p) => [p.memberId, p.total.runs]));
    $('memberList').innerHTML = members.length
      ? members.map((m) => `
        <li class="list-group-item d-flex align-items-center justify-content-between gap-2" data-id="${m.id}">
          <span>${dot(m.colorSlot)}${esc(m.name)} <span class="text-muted small">· ${runsOf.get(m.id) || 0} runs</span></span>
          <span class="text-nowrap">
            <button class="btn btn-link btn-sm p-0 me-2 rename-member">Rename</button>
            <button class="btn btn-link btn-sm p-0 text-danger remove-member">Remove</button>
          </span>
        </li>`).join('')
      : '<li class="list-group-item text-muted">No runners yet.</li>';
  }

  // --- Interactions -----------------------------------------------------------------

  const modal = (id) => bootstrap.Modal.getOrCreateInstance($(id));
  const showError = (id, msg) => { const n = $(id); n.textContent = msg || ''; n.classList.toggle('d-none', !msg); };

  $('unlockBtn').addEventListener('click', () => { showError('unlockError'); $('password').value = ''; modal('unlockModal').show(); });
  $('unlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/unlock', { password: $('password').value });
      modal('unlockModal').hide();
      await load();
    } catch (err) { showError('unlockError', err.message); }
  });
  $('lockBtn').addEventListener('click', async () => { await api('POST', '/api/lock'); await load(); });

  $('addRunBtn').addEventListener('click', () => openRun(null));
  $('runRows').addEventListener('click', (e) => {
    if (!e.target.classList.contains('edit-run')) return;
    const id = e.target.closest('tr').dataset.id;
    openRun(state.runs.find((r) => r.id === id));
  });

  function openRun(run) {
    showError('runError');
    $('runModalTitle').textContent = run ? 'Edit run' : 'Log a run';
    $('runId').value = run?.id || '';
    $('runMember').value = run?.memberId || $('logFilter').value || state.members[0]?.id || '';
    $('runDate').value = run?.date || state.stats.today;
    $('runKm').value = run?.distanceKm ?? '';
    const s = run?.durationSec;
    $('runH').value = s ? Math.floor(s / 3600) : '';
    $('runM').value = s ? Math.floor((s % 3600) / 60) : '';
    $('runS').value = s ? s % 60 : '';
    $('runNotes').value = run?.notes || '';
    $('runDeleteBtn').classList.toggle('d-none', !run);
    modal('runModal').show();
    setTimeout(() => $(run ? 'runKm' : 'runKm').focus(), 300);
  }

  $('runForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const h = Number($('runH').value || 0), m = Number($('runM').value || 0), s = Number($('runS').value || 0);
    const durationSec = h || m || s ? h * 3600 + m * 60 + s : null;
    const body = {
      memberId: $('runMember').value,
      date: $('runDate').value,
      distanceKm: $('runKm').value,
      durationSec,
      notes: $('runNotes').value,
    };
    try {
      const id = $('runId').value;
      await (id ? api('PUT', `/api/runs/${id}`, body) : api('POST', '/api/runs', body));
      modal('runModal').hide();
      await load();
    } catch (err) { showError('runError', err.message); }
  });

  $('runDeleteBtn').addEventListener('click', async () => {
    const id = $('runId').value;
    if (!id || !confirm('Delete this run?')) return;
    try {
      await api('DELETE', `/api/runs/${id}`);
      modal('runModal').hide();
      await load();
    } catch (err) { showError('runError', err.message); }
  });

  $('membersBtn').addEventListener('click', () => { showError('memberError'); modal('membersModal').show(); });
  $('memberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/members', { name: $('memberName').value });
      $('memberName').value = '';
      await load();
    } catch (err) { showError('memberError', err.message); }
  });
  $('memberList').addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const member = state.members.find((m) => m.id === li.dataset.id);
    try {
      if (e.target.classList.contains('rename-member')) {
        const name = prompt('New name', member.name);
        if (name && name.trim() && name.trim() !== member.name) await api('PUT', `/api/members/${member.id}`, { name });
      } else if (e.target.classList.contains('remove-member')) {
        if (!confirm(`Remove ${member.name} and all their runs?`)) return;
        await api('DELETE', `/api/members/${member.id}`);
      } else return;
      await load();
    } catch (err) { showError('memberError', err.message); }
  });

  $('logFilter').addEventListener('change', () => { showAllRuns = false; renderRuns(); });
  $('moreBtn').addEventListener('click', () => { showAllRuns = true; renderRuns(); });
  $('monthlyTableToggle').addEventListener('click', () => {
    const table = $('monthlyTable'), chart = $('monthlyChart');
    const showTable = table.classList.contains('d-none');
    table.classList.toggle('d-none', !showTable);
    chart.classList.toggle('d-none', showTable);
    $('monthlyTableToggle').textContent = showTable ? 'Show chart' : 'Show table';
  });

  // --- Formatting -------------------------------------------------------------------

  function fmt(v) { return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }); }
  function fmtDate(s) { return new Date(s + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function dur(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }
  function pace(secPerKm) {
    const sec = Math.round(secPerKm);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /km`;
  }
  function dot(slot) { return `<span class="dot" style="background:${Charts.color(slot)}"></span>`; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  load().catch((err) => { document.body.insertAdjacentHTML('afterbegin', `<div class="lock-banner">Could not load: ${esc(err.message)}</div>`); });
})();
