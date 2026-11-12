import * as S from './spray.js';

const $ = (s) => document.querySelector(s);
const PLACES = [
  { id: 'montero', name: 'Montero', lat: -17.34, lon: -63.25 },
  { id: 'okinawa', name: 'Okinawa Uno', lat: -17.22, lon: -62.89 },
  { id: 'pailon', name: 'Pailón', lat: -17.66, lon: -62.72 },
  { id: 'sanjulian', name: 'San Julián', lat: -16.9, lon: -62.62 },
  { id: 'cabezas', name: 'Cabezas', lat: -18.79, lon: -63.4 },
];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const LABEL = { go: 'BUENA', caution: 'CON CUIDADO', no: 'NO APLICAR' };

const state = { place: PLACES[0], product: 'herbicida', method: 'terrestre', need: 3, hours: null, evals: null, sel: null, demo: false };

const dayName = (t) => DIAS[new Date(t.slice(0, 10) + 'T12:00').getDay()];
const hh = (t) => t.slice(11, 16);
const nowKey = () => {
  // hora local del lugar (la API devuelve horas en su zona); usamos la del navegador como aproximación
  const d = new Date(); const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
};

async function load() {
  $('#now').innerHTML = '<p class="loading">Cargando pronóstico…</p>';
  try {
    const r = await fetch(S.forecastUrl(state.place.lat, state.place.lon));
    if (!r.ok) throw new Error(r.status);
    state.hours = S.fromOpenMeteo(await r.json()); state.demo = false;
  } catch {
    const r = await fetch('data/demo.json'); state.hours = S.fromOpenMeteo(await r.json()); state.demo = true;
  }
  compute();
}

function compute() {
  if (!state.hours) return;
  state.evals = S.evaluate(state.hours, S.PRODUCTS[state.product], S.METHODS[state.method]);
  const k = nowKey();
  let i = state.evals.findIndex((e) => e.t === k);
  if (i < 0) i = state.evals.findIndex((e) => e.t > k);
  state.nowIdx = i < 0 ? 0 : i;
  if (state.sel === null || state.sel < state.nowIdx) state.sel = state.nowIdx;
  render(); save();
}

function render() {
  const E = state.evals, n = E[state.nowIdx];
  const future = E.slice(state.nowIdx);
  const wins = S.windows(future, state.need, $('#caution').checked);
  const nextGood = future.findIndex((e, k) => k > 0 && e.level === 'go');
  // ---- ahora ----
  const nextTxt = n.level === 'go' ? '' : nextGood > 0 ? `Próxima hora buena: <b>${dayName(future[nextGood].t)} ${hh(future[nextGood].t)}</b>` : 'No hay horas verdes en los próximos días.';
  const best = wins[0];
  const msg = `Deriva · ${state.place.name}: ahora ${LABEL[n.level]}${best ? `. Mejor ventana: ${dayName(best.from)} ${hh(best.from)}–${hh(best.to)} (${best.hours} h)` : ''}. ${location.href}`;
  $('#now').innerHTML = `<div class="light ${n.level}">${LABEL[n.level]}<small>${hh(n.t)}</small></div>
    <div><h2>${n.level === 'go' ? 'Puedes aplicar ahora' : n.level === 'caution' ? 'Puedes, pero con cuidado' : 'Mejor no aplicar ahora'}</h2>
    <div class="place">${state.place.name} · ${S.PRODUCTS[state.product].name} · ${S.METHODS[state.method].name}${state.demo ? ' · <b>sin internet: pronóstico guardado</b>' : ''}</div>
    <ul class="reasons">${n.reasons.map((r) => `<li class="${r.lv}">${r.txt}</li>`).join('')}</ul>
    <div class="stats"><span>💨 ${n.wind.toFixed(0)} km/h</span><span>🌬️ ráfagas ${n.gust.toFixed(0)}</span><span>🌡️ ${n.T.toFixed(0)} °C</span><span>💧 HR ${n.RH} %</span><span>Δ T ${n.dT.toFixed(1)}</span><span>🌧️ ${n.pop} %</span></div>
    <div class="next">${nextTxt}</div>
    <a class="wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Avisar por WhatsApp</a></div>`;
  // ---- grilla ----
  const days = [...new Set(E.map((e) => e.t.slice(0, 10)))];
  let g = '<div class="hgrid"><div></div>' + Array.from({ length: 24 }, (_, h) => `<div class="hd">${h}</div>`).join('');
  for (const d of days) {
    g += `<div class="day">${dayName(d + 'T12')}<br><small>${d.slice(8)}/${d.slice(5, 7)}</small></div>`;
    for (let h = 0; h < 24; h++) {
      const idx = E.findIndex((e) => e.t === `${d}T${String(h).padStart(2, '0')}:00`);
      if (idx < 0) { g += '<div class="cell empty"></div>'; continue; }
      const e = E[idx];
      g += `<button class="cell ${e.level} ${idx < state.nowIdx ? 'past' : ''} ${idx === state.sel ? 'sel' : ''}" data-i="${idx}" title="${dayName(e.t)} ${hh(e.t)} · ${LABEL[e.level]}" aria-label="${dayName(e.t)} ${hh(e.t)}: ${LABEL[e.level]}">${Math.round(e.wind)}</button>`;
    }
  }
  $('#grid').innerHTML = g + '</div>';
  const s = E[state.sel];
  $('#detail').innerHTML = `<b>${dayName(s.t)} ${hh(s.t)} · ${LABEL[s.level]}</b> — 💨 ${s.wind.toFixed(0)} km/h (ráfagas ${s.gust.toFixed(0)}) · 🌡️ ${s.T.toFixed(0)} °C · Δ T ${s.dT.toFixed(1)} · 🌧️ ${s.pop} %<br>${s.reasons.map((r) => r.txt).join(' · ')}<br><small>El número de cada casilla es el viento en km/h.</small>`;
  // ---- ventanas ----
  $('#windows').innerHTML = wins.length ? wins.slice(0, 6).map((w) => `<div class="win ${w.greens < w.hours ? 'c' : ''}"><div class="when">${dayName(w.from)} ${hh(w.from)} – ${hh(w.to)}</div>
      <div class="d">${w.hours} h seguidas · ${w.greens} en verde · viento medio ${w.windAvg.toFixed(0)} km/h</div></div>`).join('')
    : `<p class="empty-msg">No hay ${state.need} horas seguidas ${$('#caution').checked ? 'buenas o con cuidado' : 'en verde'} en los próximos días. Prueba con menos horas o incluye las amarillas.</p>`;
}

// ---------- enlace ----------
function save() {
  const p = new URLSearchParams({ lat: state.place.lat, lon: state.place.lon, n: state.place.name, p: state.product, m: state.method, h: state.need });
  history.replaceState(null, '', '#' + p);
}
function restore() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has('lat')) state.place = PLACES.find((x) => x.name === p.get('n')) || { id: 'custom', name: p.get('n') || 'Mi lote', lat: +p.get('lat'), lon: +p.get('lon') };
  if (S.PRODUCTS[p.get('p')]) state.product = p.get('p');
  if (S.METHODS[p.get('m')]) state.method = p.get('m');
  if (+p.get('h') >= 1) state.need = +p.get('h');
}

function renderSetup() {
  $('#places').innerHTML = PLACES.map((x) => `<button type="button" class="chip ${x.id === state.place.id ? 'on' : ''}" data-id="${x.id}">${x.name}</button>`).join('')
    + (state.place.id === 'custom' ? `<button type="button" class="chip on">${state.place.name}</button>` : '');
  $('#product').innerHTML = Object.entries(S.PRODUCTS).map(([k, v]) => `<option value="${k}" ${k === state.product ? 'selected' : ''}>${v.name} · lavado ${v.rainfast} h</option>`).join('');
  $('#method').innerHTML = Object.entries(S.METHODS).map(([k, v]) => `<option value="${k}" ${k === state.method ? 'selected' : ''}>${v.name}</option>`).join('');
  $('#need').value = state.need;
}

$('#places').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (!b) return; state.place = PLACES.find((x) => x.id === b.dataset.id); state.sel = null; renderSetup(); load(); });
$('#gps').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  $('#gps').textContent = '📍 Buscando…';
  navigator.geolocation.getCurrentPosition((pos) => {
    state.place = { id: 'custom', name: 'Mi lote', lat: pos.coords.latitude, lon: pos.coords.longitude };
    $('#gps').textContent = '📍 Usar mi ubicación'; state.sel = null; renderSetup(); load();
  }, () => { $('#gps').textContent = '📍 Sin permiso de ubicación'; });
});
$('#product').addEventListener('change', (e) => { state.product = e.target.value; compute(); });
$('#method').addEventListener('change', (e) => { state.method = e.target.value; compute(); });
$('#need').addEventListener('change', (e) => { state.need = Math.max(1, Math.min(12, +e.target.value || 1)); compute(); });
$('#caution').addEventListener('change', render);
$('#grid').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b || b.classList.contains('past')) return; state.sel = +b.dataset.i; render(); });

restore(); renderSetup(); load();
window.deriva = { state, load, compute };
