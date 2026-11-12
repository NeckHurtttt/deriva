import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/spray.js';
const H = (o = {}) => ({ t: '2026-11-12T10:00', T: 25, RH: 60, wind: 8, gust: 14, pop: 0, rain: 0, cloud: 50, isDay: true, ...o });
const ev = (h, ahead = [], p = S.PRODUCTS.herbicida, m = S.METHODS.terrestre) => S.evalHour(h, ahead, p, m);

test('bulbo húmedo de Stull (20 °C, 50 % → 13,7 °C)', () => {
  assert.ok(Math.abs(S.wetBulb(20, 50) - 13.7) < 0.1);
  assert.ok(S.deltaT(30, 30) > 10 && S.deltaT(20, 95) < 1);
});
test('condición ideal = verde', () => { assert.equal(ev(H()).level, 'go'); });
test('viento fuerte y ráfagas', () => {
  assert.equal(ev(H({ wind: 25 })).level, 'no');
  assert.equal(ev(H({ wind: 17 })).level, 'caution');
  assert.equal(ev(H({ wind: 14 }), [], S.PRODUCTS.herbicida, S.METHODS.dron).level, 'caution');
  assert.equal(ev(H({ gust: 45 })).level, 'no');
});
test('inversión térmica: sin viento de noche = rojo', () => {
  assert.equal(ev(H({ wind: 1, isDay: false })).level, 'no');
  assert.equal(ev(H({ wind: 2.5, cloud: 90 })).level, 'caution');
});
test('delta T alto = aire seco', () => {
  assert.equal(ev(H({ T: 31, RH: 20 })).level, 'no');
});
test('hormonal: más sensible al calor', () => {
  assert.equal(ev(H({ T: 30, RH: 70 }), [], S.PRODUCTS.herbicida).level !== 'no', true);
  assert.equal(ev(H({ T: 30, RH: 70 }), [], S.PRODUCTS.hormonal).level, 'no');
});
test('lluvia dentro del tiempo de lavado', () => {
  const ahead = [H({ pop: 10 }), H({ pop: 80, rain: 3 })];
  assert.equal(ev(H(), ahead, S.PRODUCTS.herbicida).level, 'no');   // lavado 6 h: ve la lluvia
  assert.equal(ev(H(), ahead, S.PRODUCTS.contacto).level, 'go');    // lavado 1 h: no la ve
  assert.equal(ev(H({ rain: 1 })).level, 'no');
});
test('ventanas de horas seguidas', () => {
  const lv = ['go', 'go', 'go', 'no', 'go', 'go', 'caution', 'go'];
  const evals = lv.map((level, k) => ({ level, t: `2026-11-12T${String(k).padStart(2, '0')}:00`, wind: 8 }));
  assert.deepEqual(S.windows(evals, 3).map((w) => [w.start, w.end]), [[0, 2]]);
  assert.deepEqual(S.windows(evals, 3, true).map((w) => [w.start, w.end]).sort(), [[0, 2], [4, 7]]);
});
test('lee el formato de Open-Meteo', async () => {
  const { readFileSync } = await import('node:fs');
  const h = S.fromOpenMeteo(JSON.parse(readFileSync(new URL('../data/demo.json', import.meta.url))));
  assert.ok(h.length >= 72 && typeof h[0].wind === 'number' && typeof h[0].isDay === 'boolean');
});
