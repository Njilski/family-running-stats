// Two small hand-rolled SVG charts. No library: the shapes are simple enough
// and it keeps the page dependency-free and fast on a phone.
//
// Mark specs follow the dataviz conventions: bars ≤ 24px wide with a rounded
// data-end and a square baseline, 2px lines, ≥ 8px end dots ringed in the
// surface colour, hairline grid, text in text tokens (never the series colour).

(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const color = (slot) => `var(--series-${slot % 8})`;

  function niceMax(v) {
    if (v <= 0) return 10;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => n <= k);
    return step * p;
  }

  function tooltip(wrap) {
    let tip = wrap.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip d-none';
      wrap.appendChild(tip);
    }
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.classList.remove('d-none');
        const w = wrap.clientWidth;
        tip.style.left = `${Math.min(x + 12, w - tip.offsetWidth - 4)}px`;
        tip.style.top = `${y - tip.offsetHeight - 10}px`;
      },
      hide() { tip.classList.add('d-none'); },
    };
  }

  // Bars grouped by month, one bar per member. Zero months keep their slot so
  // a gap in the running shows as a gap.
  function monthlyBars(wrap, data) {
    wrap.innerHTML = '';
    const W = 640, H = 240, pad = { t: 12, r: 8, b: 28, l: 36 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Kilometres per month per runner' }, wrap);
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const max = niceMax(Math.max(0, ...data.series.flatMap((s) => s.km)));
    const y = (v) => pad.t + plotH - (v / max) * plotH;

    const grid = el('g', { class: 'grid' }, svg);
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, grid);
      el('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, grid).textContent = fmt(v);
    }
    el('line', { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: 'axis' }, el('g', { class: 'axis' }, svg));

    const months = data.months;
    const band = plotW / months.length;
    const n = Math.max(1, data.series.length);
    const gap = 2;
    const barW = Math.min(24, Math.max(3, (band * 0.7 - gap * (n - 1)) / n));
    const groupW = barW * n + gap * (n - 1);
    const tip = tooltip(wrap);

    months.forEach((mo, i) => {
      const x0 = pad.l + band * i + (band - groupW) / 2;
      const label = new Date(mo + '-15').toLocaleString(undefined, { month: 'short' });
      el('text', { x: pad.l + band * i + band / 2, y: H - 8, 'text-anchor': 'middle' }, svg).textContent =
        mo.endsWith('-01') || i === 0 ? `${label} ${mo.slice(2, 4)}` : label;
      data.series.forEach((s, j) => {
        const v = s.km[i];
        if (v <= 0) return;
        const x = x0 + j * (barW + gap);
        const top = y(v), h = y(0) - top;
        const r = Math.min(4, h / 2, barW / 2);
        // Rounded top corners, square bottom — drawn as a path so only the data end is rounded.
        const d = `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${y(0)} Z`;
        const bar = el('path', { d, fill: color(s.colorSlot), class: 'bar' }, svg);
        const hit = el('rect', { x: x - 1, y: pad.t, width: barW + 2, height: plotH, class: 'hit' }, svg);
        const show = (e) => {
          const pt = svgPoint(svg, wrap, x + barW / 2, top);
          tip.show(`<b>${esc(s.name)}</b> · ${label} ${mo.slice(0, 4)}<br>${fmt(v)} km`, pt.x, pt.y);
          bar.style.opacity = 0.8;
        };
        const hide = () => { tip.hide(); bar.style.opacity = 1; };
        hit.addEventListener('mouseenter', show);
        hit.addEventListener('mouseleave', hide);
        hit.addEventListener('click', show);
      });
    });
    wrap.addEventListener('mouseleave', tip.hide);
  }

  // Cumulative km, one line per member, direct end labels + legend.
  function cumulativeLines(wrap, data) {
    wrap.innerHTML = '';
    const W = 480, H = 240, pad = { t: 12, r: 64, b: 28, l: 36 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Cumulative kilometres this year per runner' }, wrap);
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const days = data.days;
    // Scale the x axis over the whole year so the line visibly "fills up" as the year goes.
    const yearDays = daysInYear(days[0].slice(0, 4));
    const max = niceMax(Math.max(0, ...data.series.map((s) => s.km[s.km.length - 1] || 0)));
    const x = (i) => pad.l + (i / (yearDays - 1)) * plotW;
    const y = (v) => pad.t + plotH - (v / max) * plotH;

    const grid = el('g', { class: 'grid' }, svg);
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, grid);
      el('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, grid).textContent = fmt(v);
    }
    for (let m = 0; m < 12; m += 2) {
      const d = new Date(Number(days[0].slice(0, 4)), m, 1);
      const idx = Math.round((d - new Date(Number(days[0].slice(0, 4)), 0, 1)) / 86400000);
      el('text', { x: x(idx), y: H - 8, 'text-anchor': 'start' }, svg).textContent = d.toLocaleString(undefined, { month: 'short' });
    }

    // Sort by final value so end labels can be spread apart when they collide.
    const ordered = [...data.series].sort((a, b) => b.km[b.km.length - 1] - a.km[a.km.length - 1]);
    const lastIdx = days.length - 1;
    let lastLabelY = -Infinity;
    ordered.forEach((s) => {
      const pts = s.km.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      el('polyline', { points: pts, stroke: color(s.colorSlot), class: 'line' }, svg);
      const ex = x(lastIdx), ey = y(s.km[lastIdx]);
      el('circle', { cx: ex, cy: ey, r: 4, fill: color(s.colorSlot), class: 'end-dot' }, svg);
      let ly = Math.max(ey + 4, lastLabelY + 14);
      lastLabelY = ly;
      const t = el('text', { x: ex + 8, y: ly, class: 'end-label' }, svg);
      t.textContent = `${firstName(s.name)} ${fmt(s.km[lastIdx])}`;
    });

    // Crosshair + tooltip over the whole plot.
    const tip = tooltip(wrap);
    const cross = el('line', { y1: pad.t, y2: pad.t + plotH, class: 'axis', style: 'display:none' }, svg);
    const hit = el('rect', { x: pad.l, y: pad.t, width: plotW, height: plotH, class: 'hit' }, svg);
    hit.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(lastIdx, Math.round(((sx - pad.l) / plotW) * (yearDays - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
      const rows = ordered.map((s) => `<span class="dot" style="background:${color(s.colorSlot)}"></span>${esc(s.name)} ${fmt(s.km[i])} km`).join('<br>');
      const pt = svgPoint(svg, wrap, x(i), pad.t + plotH / 2);
      tip.show(`<b>${fmtDate(days[i])}</b><br>${rows}`, pt.x, pt.y);
    });
    hit.addEventListener('mouseleave', () => { tip.hide(); cross.style.display = 'none'; });
  }

  function legend(container, series) {
    container.innerHTML = series
      .map((s) => `<span><span class="dot" style="background:${color(s.colorSlot)}"></span>${esc(s.name)}</span>`)
      .join('');
    container.classList.toggle('d-none', series.length < 2);
  }

  function svgPoint(svg, wrap, sx, sy) {
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    return { x: rect.left - wr.left + (sx / vb.width) * rect.width, y: rect.top - wr.top + (sy / vb.height) * rect.height };
  }
  function daysInYear(y) { return (Number(y) % 4 === 0 && Number(y) % 100 !== 0) || Number(y) % 400 === 0 ? 366 : 365; }
  function fmt(v) { return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }); }
  function fmtDate(s) { return new Date(s + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  function firstName(n) { return String(n).split(' ')[0]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  window.Charts = { monthlyBars, cumulativeLines, legend, color };
})();
