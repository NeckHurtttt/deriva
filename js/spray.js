// Reglas para decidir si conviene pulverizar hora por hora.
// Basadas en recomendaciones de buenas prácticas de aplicación (viento, delta T, inversión térmica,
// lluvia antes del tiempo de lavado, temperatura). Son orientativas: manda la etiqueta del producto.

// Temperatura de bulbo húmedo (Stull 2011), °C
export function wetBulb(T, RH) {
  return T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH) - Math.atan(RH - 1.676331)
    + 0.00391838 * RH ** 1.5 * Math.atan(0.023101 * RH) - 4.686035;
}
export const deltaT = (T, RH) => T - wetBulb(T, RH);

export const PRODUCTS = {
  herbicida: { name: 'Herbicida sistémico (glifosato…)', rainfast: 6, maxT: 32, hormonal: false },
  contacto: { name: 'Herbicida de contacto (paraquat…)', rainfast: 1, maxT: 32, hormonal: false },
  hormonal: { name: 'Herbicida hormonal (2,4-D, dicamba…)', rainfast: 6, maxT: 28, hormonal: true },
  fungicida: { name: 'Fungicida', rainfast: 2, maxT: 32, hormonal: false },
  insecticida: { name: 'Insecticida', rainfast: 2, maxT: 32, hormonal: false },
};
export const METHODS = {
  terrestre: { name: 'Pulverizadora terrestre', windMax: 15, windStop: 20 },
  dron: { name: 'Dron', windMax: 12, windStop: 16 },
};

const LV = { go: 0, caution: 1, no: 2 };
const worse = (a, b) => (LV[a] >= LV[b] ? a : b);

/**
 * Evalúa una hora.
 * h: { t, T, RH, wind, gust, pop (prob. lluvia %), rain (mm), cloud (%), isDay }
 * ahead: lista de horas siguientes (para la lluvia dentro del tiempo de lavado)
 */
export function evalHour(h, ahead, product = PRODUCTS.herbicida, method = METHODS.terrestre) {
  const reasons = []; let level = 'go';
  const add = (lv, code, txt) => { level = worse(level, lv); reasons.push({ lv, code, txt }); };
  const dT = deltaT(h.T, h.RH);

  // Viento
  if (h.wind < 3) {
    const inversion = !h.isDay || (h.cloud < 40 && h.wind < 2);
    if (inversion) add('no', 'inversion', `Casi sin viento (${h.wind.toFixed(0)} km/h) ${h.isDay ? 'y cielo despejado' : 'de noche'}: riesgo de inversión térmica, la nube de gotas queda flotando y se va lejos`);
    else add('caution', 'calma', `Muy poco viento (${h.wind.toFixed(0)} km/h): revisa si hay inversión (humo que no sube)`);
  } else if (h.wind > method.windStop) add('no', 'viento', `Viento fuerte (${h.wind.toFixed(0)} km/h): deriva segura`);
  else if (h.wind > method.windMax) add('caution', 'viento', `Viento de ${h.wind.toFixed(0)} km/h: usa gota gruesa y baja la barra`);
  if (h.gust > method.windStop + 20) add('no', 'rafaga', `Ráfagas de ${h.gust.toFixed(0)} km/h`);
  else if (h.gust > method.windStop + 10) add('caution', 'rafaga', `Ráfagas de ${h.gust.toFixed(0)} km/h`);

  // Delta T (evaporación de la gota)
  if (dT > 10) add('no', 'deltaT', `Delta T ${dT.toFixed(1)}: aire muy seco, la gota se evapora antes de llegar`);
  else if (dT > 8) add('caution', 'deltaT', `Delta T ${dT.toFixed(1)}: aire seco, usa gota más gruesa`);
  else if (dT < 2) add('caution', 'deltaT', `Delta T ${dT.toFixed(1)}: aire muy húmedo, la gota fina queda suspendida`);

  // Temperatura
  if (h.T > product.maxT) add('no', 'calor', `${h.T.toFixed(0)} °C: ${product.hormonal ? 'el hormonal se volatiliza y daña cultivos vecinos' : 'mucha evaporación y planta estresada'}`);
  else if (h.T > product.maxT - 3) add('caution', 'calor', `${h.T.toFixed(0)} °C: cerca del límite`);
  if (product.hormonal && h.wind < 3) add('no', 'hormonal', 'Hormonal sin viento: no aplicar (deriva por vapor)');

  // Lluvia ahora y dentro del tiempo de lavado
  const win = [h, ...ahead.slice(0, Math.max(0, product.rainfast - 1))];
  const rainMm = win.reduce((a, x) => a + (x.rain || 0), 0);
  const popMax = Math.max(...win.map((x) => x.pop ?? 0));
  if (h.rain >= 0.2) add('no', 'lluvia', `Está lloviendo (${h.rain.toFixed(1)} mm)`);
  else if (rainMm >= 1 || popMax >= 60) add('no', 'lavado', `Lluvia probable en las próximas ${product.rainfast} h (${popMax} %): lavaría el producto`);
  else if (popMax >= 30) add('caution', 'lavado', `${popMax} % de probabilidad de lluvia en las próximas ${product.rainfast} h`);

  if (level === 'go') reasons.push({ lv: 'go', code: 'ok', txt: `Viento ${h.wind.toFixed(0)} km/h, Delta T ${dT.toFixed(1)}, ${h.T.toFixed(0)} °C y sin lluvia cerca` });
  return { level, reasons, dT };
}

export function evaluate(hours, product, method) {
  return hours.map((h, k) => ({ ...h, ...evalHour(h, hours.slice(k + 1), product, method) }));
}

// Ventanas de horas seguidas en verde (o verde+amarillo) de al menos `need` horas
export function windows(evals, need = 3, allowCaution = false) {
  const ok = (e) => e.level === 'go' || (allowCaution && e.level === 'caution');
  const out = []; let start = null;
  evals.forEach((e, k) => {
    if (ok(e) && start === null) start = k;
    if ((!ok(e) || k === evals.length - 1) && start !== null) {
      const end = ok(e) ? k : k - 1;
      if (end - start + 1 >= need) {
        const seg = evals.slice(start, end + 1);
        out.push({ start, end, hours: end - start + 1, from: seg[0].t, to: seg.at(-1).t,
          greens: seg.filter((x) => x.level === 'go').length, windAvg: seg.reduce((a, x) => a + x.wind, 0) / seg.length });
      }
      start = null;
    }
  });
  return out.sort((a, b) => b.greens - a.greens || b.hours - a.hours);
}

// Convierte la respuesta de Open-Meteo al formato de horas
export function fromOpenMeteo(json) {
  const h = json.hourly;
  return h.time.map((t, k) => ({
    t, T: h.temperature_2m[k], RH: h.relative_humidity_2m[k], wind: h.wind_speed_10m[k], gust: h.wind_gusts_10m[k],
    dir: h.wind_direction_10m?.[k] ?? null, pop: h.precipitation_probability?.[k] ?? 0, rain: h.precipitation[k] ?? 0,
    cloud: h.cloud_cover?.[k] ?? 50, isDay: h.is_day ? !!h.is_day[k] : (+t.slice(11, 13) >= 7 && +t.slice(11, 13) < 19),
  }));
}
export function forecastUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3), timezone: 'auto', forecast_days: '4', wind_speed_unit: 'kmh',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,is_day',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}
