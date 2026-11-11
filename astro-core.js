/*
 * astro-core.js — расчёт Солнца, Луны, Асцендента и домов для интерактива «3 точки».
 * Зависимости: astronomy-engine (MIT), moment + moment-timezone (MIT, данные IANA tzdb),
 *              @photostructure/tz-lookup (CC0).
 * Работает и в браузере (window.AstroCore), и в Node (module.exports) — для тестов.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('astronomy-engine'), require('moment-timezone'), require('@photostructure/tz-lookup'));
  } else {
    root.AstroCore = factory(root.Astronomy, root.moment, root.tzlookup);
  }
})(typeof self !== 'undefined' ? self : this, function (Astronomy, moment, tzlookup) {
  'use strict';

  var SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
    'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
  var SIGNS_RU = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева',
    'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];

  // ===== НАСТРОЙКИ (как в «Хроносе») =====
  var SETTINGS = {
    houseSystem: 'placidus',
    highLatitudeSystem: 'equal_asc',  // равнодомная от Асцендента
    highLatitudeThreshold: 61.75,     // 61°45′ с. ш., включительно
    // Южные широты: поведение не согласовано. Временное решение — зеркально.
    southernRule: 'mirror'
  };

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function norm(x) { x %= 360; return x < 0 ? x + 360 : x; }
  function signIndex(lon) { return Math.floor(norm(lon) / 30) % 12; }

  // ===== ПОЛОЖЕНИЯ =====
  function sunLon(date) { return norm(Astronomy.SunPosition(date).elon); }
  function moonLon(date) { return norm(Astronomy.EclipticGeoMoon(date).lon); }

  // RAMC и истинный наклон эклиптики
  function ramcAndEps(date, lonDeg) {
    var t = Astronomy.MakeTime(date);
    var gast = Astronomy.SiderealTime(t);        // часы
    var eps = Astronomy.e_tilt(t).tobl;          // градусы, истинный наклон
    return { ramc: norm(gast * 15 + lonDeg), eps: eps };
  }

  function mcFrom(ramc, eps) {
    var r = ramc * D2R, e = eps * D2R;
    return norm(Math.atan2(Math.sin(r), Math.cos(r) * Math.cos(e)) * R2D);
  }

  function ascFrom(ramc, eps, lat) {
    var r = ramc * D2R, e = eps * D2R, f = lat * D2R;
    var asc = norm(Math.atan2(Math.cos(r), -(Math.sin(r) * Math.cos(e) + Math.tan(f) * Math.sin(e))) * R2D);
    // За полярным кругом формула может дать противоположную точку.
    // Соглашение Swiss Ephemeris: Асцендент лежит в пределах 180° после MC.
    // ПРОВЕРИТЬ по «Хроносу» на картах севернее 66°33′ (Мурманск, Норильск, Воркута).
    var mc = mcFrom(ramc, eps);
    if (norm(asc - mc) > 180) asc = norm(asc + 180);
    return asc;
  }

  function ascendant(date, lat, lon) {
    var p = ramcAndEps(date, lon);
    return ascFrom(p.ramc, p.eps, lat);
  }

  // ===== ДОМА =====
  function chooseHouseSystem(lat) {
    // Сравниваем фактическую широту, без округления.
    if (lat >= SETTINGS.highLatitudeThreshold) return SETTINGS.highLatitudeSystem;
    if (SETTINGS.southernRule === 'mirror' && lat <= -SETTINGS.highLatitudeThreshold) return SETTINGS.highLatitudeSystem;
    return SETTINGS.houseSystem;
  }

  function equalHouses(asc) {
    var c = [];
    for (var i = 0; i < 12; i++) c.push(norm(asc + i * 30));
    return c;
  }

  // Плацидус: итерация по полудуговым соотношениям. Возвращает null, если расчёт невозможен.
  function placidusHouses(ramc, eps, lat) {
    var e = eps * D2R, f = lat * D2R;
    function cuspFor(offsetDeg, frac, above) {
      // offsetDeg: смещение RA от RAMC для начального приближения
      var ra = norm(ramc + offsetDeg) * D2R;
      for (var k = 0; k < 100; k++) {
        var lam = Math.atan2(Math.sin(ra), Math.cos(ra) * Math.cos(e));
        var dec = Math.asin(Math.sin(e) * Math.sin(lam));
        var x = Math.tan(f) * Math.tan(dec);
        if (Math.abs(x) >= 1) return null;
        var ad = Math.asin(x); // асцензионная разность
        var next = above
          ? ramc * D2R + frac * (Math.PI / 2 + ad)        // дуга над горизонтом (11, 12)
          : ramc * D2R + Math.PI - frac * (Math.PI / 2 - ad); // 2, 3 — от IC
        // приводим к ближайшему
        var diff = Math.atan2(Math.sin(next - ra), Math.cos(next - ra));
        ra = ra + diff;
        if (Math.abs(diff) < 1e-12) break;
      }
      var l = Math.atan2(Math.sin(ra), Math.cos(ra) * Math.cos(e));
      return norm(l * R2D);
    }
    var asc = ascFrom(ramc, eps, lat);
    var mc = mcFrom(ramc, eps);
    var c11 = cuspFor(30, 1 / 3, true);
    var c12 = cuspFor(60, 2 / 3, true);
    var c2 = cuspFor(120, 2 / 3, false);
    var c3 = cuspFor(150, 1 / 3, false);
    if ([c11, c12, c2, c3].some(function (v) { return v === null || isNaN(v); })) return null;
    return [asc, c2, c3, norm(mc + 180), norm(c11 + 180), norm(c12 + 180),
      norm(asc + 180), norm(c2 + 180), norm(c3 + 180), mc, c11, c12];
  }

  function houses(date, lat, lon) {
    var p = ramcAndEps(date, lon);
    var system = chooseHouseSystem(lat);
    var asc = ascFrom(p.ramc, p.eps, lat);
    var cusps;
    if (system === 'placidus') {
      cusps = placidusHouses(p.ramc, p.eps, lat);
      if (!cusps) {
        // Порфирий запрещён. Ошибка, а не подмена системы.
        return { ok: false, system: system, error: 'placidus_failed' };
      }
    } else {
      cusps = equalHouses(asc);
    }
    return { ok: true, system: system, asc: asc, mc: mcFrom(p.ramc, p.eps), cusps: cusps };
  }

  // ===== ЧАСОВЫЕ ПОЯСА =====
  function zoneFor(lat, lon) { return tzlookup(lat, lon); }

  // Перевод местного времени в UTC с обработкой несуществующего и повторяющегося времени.
  // parts: {y, m(1-12), d, h, min}. offsetOverrideMin — ручное смещение от UTC в минутах.
  function localToUtc(parts, zone, offsetOverrideMin) {
    var wallMs = Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.min);
    if (typeof offsetOverrideMin === 'number') {
      return { status: 'ok', candidates: [{ utc: new Date(wallMs - offsetOverrideMin * 60000), offset: offsetOverrideMin, abbr: '' }] };
    }
    var z = moment.tz.zone(zone);
    if (!z) return { status: 'error', error: 'unknown_zone' };
    // Возможные смещения в окрестности ±2 суток
    var offsets = {};
    for (var dh = -48; dh <= 48; dh += 1) {
      var t = wallMs + dh * 3600000;
      offsets[-z.utcOffset(t)] = true; // moment: utcOffset возвращает минуты «UTC − местное»
    }
    var cands = [];
    Object.keys(offsets).forEach(function (k) {
      var off = Number(k);
      var utc = wallMs - off * 60000;
      if (-z.utcOffset(utc) === off) cands.push({ utc: new Date(utc), offset: off, abbr: z.abbr(utc) });
    });
    cands.sort(function (a, b) { return a.utc - b.utc; });
    if (cands.length === 0) return { status: 'nonexistent', candidates: [] };
    if (cands.length > 1) return { status: 'ambiguous', candidates: cands };
    return { status: 'ok', candidates: cands };
  }

  function isDst(zone, utc) {
    // Летнее время: смещение больше, чем минимальное смещение зоны в том же году.
    var z = moment.tz.zone(zone);
    var y = utc.getUTCFullYear();
    var jan = -z.utcOffset(Date.UTC(y, 0, 1)), jul = -z.utcOffset(Date.UTC(y, 6, 1));
    var cur = -z.utcOffset(utc.getTime());
    return jan !== jul && cur === Math.max(jan, jul);
  }

  // ===== ПОИСК МОМЕНТА СМЕНЫ ЗНАКА =====
  function findIngress(fn, t0, t1) {
    // Бинарный поиск момента, когда fn меняет знак между t0 и t1 (Date)
    var s0 = signIndex(fn(t0));
    var a = t0.getTime(), b = t1.getTime();
    while (b - a > 1000) {
      var m = (a + b) / 2;
      if (signIndex(fn(new Date(m))) === s0) a = m; else b = m;
    }
    return new Date(b);
  }

  // Знаки на интервале: [{sign, from, to}]
  function signsOverInterval(fn, t0, t1, stepMin) {
    var res = [];
    var step = stepMin * 60000;
    var cur = signIndex(fn(t0)), start = t0;
    for (var t = t0.getTime() + step; ; t += step) {
      var tt = new Date(Math.min(t, t1.getTime()));
      var s = signIndex(fn(tt));
      if (s !== cur) {
        var ing = findIngress(fn, new Date(tt.getTime() - step), tt);
        res.push({ sign: SIGNS[cur], from: start, to: ing });
        cur = s; start = ing;
      }
      if (tt.getTime() >= t1.getTime()) break;
    }
    res.push({ sign: SIGNS[cur], from: start, to: t1 });
    return res;
  }

  // ===== ГЛАВНАЯ ФУНКЦИЯ =====
  /*
   * input: { y, m, d, h, min, timeKnown, lat, lon, zone, offsetOverrideMin }
   * Возвращает { status, sun, moon, asc, notes, meta }
   */
  function compute(input) {
    var zone = input.zone || zoneFor(input.lat, input.lon);
    var out = { zone: zone, notes: [] };

    if (input.timeKnown) {
      var conv = localToUtc(input, zone, input.offsetOverrideMin);
      out.timeStatus = conv.status;
      if (conv.status === 'nonexistent' || conv.status === 'error') { out.status = conv.status; return out; }
      var variants = conv.candidates.map(function (c) {
        var s = sunLon(c.utc), mo = moonLon(c.utc), as = ascendant(c.utc, input.lat, input.lon);
        return { utc: c.utc, offset: c.offset, abbr: c.abbr, dst: typeof input.offsetOverrideMin === 'number' ? null : isDst(zone, c.utc),
          sunLon: s, moonLon: mo, ascLon: as, sun: SIGNS[signIndex(s)], moon: SIGNS[signIndex(mo)], asc: SIGNS[signIndex(as)],
          houses: houses(c.utc, input.lat, input.lon) };
      });
      out.variants = variants;
      var v0 = variants[0];
      ['sun', 'moon', 'asc'].forEach(function (k) {
        var same = variants.every(function (v) { return v[k] === v0[k]; });
        out[k] = same ? { sign: v0[k], certain: true } : { sign: null, certain: false, options: variants.map(function (v) { return v[k]; }) };
      });
      // Асцендент у границы знака (ближе 1°)
      if (out.asc.certain) {
        var deg = norm(v0.ascLon) % 30;
        if (deg < 1 || deg > 29) out.notes.push('asc_near_cusp');
      }
      out.status = conv.status === 'ambiguous' ? 'ambiguous' : 'ok';
      return out;
    }

    // Время неизвестно: весь местный день 00:00–23:59
    var startConv = localToUtc({ y: input.y, m: input.m, d: input.d, h: 0, min: 0 }, zone, input.offsetOverrideMin);
    var endConv = localToUtc({ y: input.y, m: input.m, d: input.d, h: 23, min: 59 }, zone, input.offsetOverrideMin);
    var t0 = startConv.candidates.length ? startConv.candidates[0].utc
      : new Date(Date.UTC(input.y, input.m - 1, input.d, 0, 0) - 14 * 3600000); // запас, если полночь не существует
    var t1 = endConv.candidates.length ? endConv.candidates[endConv.candidates.length - 1].utc
      : new Date(Date.UTC(input.y, input.m - 1, input.d, 23, 59) + 14 * 3600000);

    var sunSeg = signsOverInterval(sunLon, t0, t1, 60);
    var moonSeg = signsOverInterval(moonLon, t0, t1, 20);
    out.sun = sunSeg.length === 1 ? { sign: sunSeg[0].sign, certain: true } : { sign: null, certain: false, segments: sunSeg };
    out.moon = moonSeg.length === 1 ? { sign: moonSeg[0].sign, certain: true } : { sign: null, certain: false, segments: moonSeg };
    out.asc = { sign: null, certain: false, reason: 'time_unknown' };
    out.status = 'ok';
    out.interval = { from: t0, to: t1 };
    return out;
  }

  // Форматирование местного времени момента
  function formatLocal(date, zone, offsetOverrideMin) {
    if (typeof offsetOverrideMin === 'number') {
      var d = new Date(date.getTime() + offsetOverrideMin * 60000);
      return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    }
    return moment(date).tz(zone).format('HH:mm');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function formatOffset(min) {
    var s = min >= 0 ? '+' : '−';
    var a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    return 'UTC' + s + h + (m ? ':' + pad(m) : '');
  }

  function formatDMS(v, pos, neg) {
    var a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60 + 1e-9);
    return d + '°' + pad(m) + '′ ' + (v >= 0 ? pos : neg);
  }

  return {
    SIGNS: SIGNS, SIGNS_RU: SIGNS_RU, SETTINGS: SETTINGS,
    sunLon: sunLon, moonLon: moonLon, ascendant: ascendant,
    houses: houses, chooseHouseSystem: chooseHouseSystem, placidusHouses: placidusHouses,
    zoneFor: zoneFor, localToUtc: localToUtc, compute: compute,
    formatLocal: formatLocal, formatOffset: formatOffset, formatDMS: formatDMS,
    tzdbVersion: moment.tz.dataVersion
  };
});
