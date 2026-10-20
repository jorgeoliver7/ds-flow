// Interfaz del mapa de reparto de Cádiz: mapa de calor en Canvas, panel de
// condiciones, previsión de la IA con su explicación y el turno de reparto simulado,
// con las furgonetas saliendo de la estación, repartiendo por las calles y volviendo.
(function () {
  "use strict";
  const R = window.DSReparto, M = window.DSModelo;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n0 = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const pct = (v, d = 1) => (v * 100).toFixed(d).replace(".", ",") + "%";
  const pts = (v) => (v > 0 ? "+" : "") + (v * 100).toFixed(1).replace(".", ",");
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const FAMS = ["DQX1", "EQX1"];
  const NOMBRE_COND = { volumen: "Volumen", lluvia: "Lluvia", inundacion: "Flash flood", huelga: "Huelga", refuerzo: "Refuerzo", retraso: "Retraso de salida" };
  const CORTOS = {
    "Jerez de la Frontera": "Jerez", "El Puerto de Santa María": "El Puerto", "Chiclana de la Frontera": "Chiclana", "Sanlúcar de Barrameda": "Sanlúcar",
    "Arcos de la Frontera": "Arcos", "Vejer de la Frontera": "Vejer", "Medina Sidonia": "Medina",
  };
  const ETIQUETAS = ["Jerez de la Frontera", "Cádiz", "San Fernando", "El Puerto de Santa María", "Chiclana de la Frontera", "Sanlúcar de Barrameda",
    "Arcos de la Frontera", "Ubrique", "Olvera", "Medina Sidonia", "Vejer de la Frontera", "Grazalema", "Barbate"];
  // en pantallas estrechas, solo los que no se pisan
  const ETIQUETAS_SM = ["Jerez de la Frontera", "Cádiz", "Sanlúcar de Barrameda", "Arcos de la Frontera", "Ubrique", "Olvera", "Vejer de la Frontera"];

  const METRICAS = {
    ia: [
      { id: "entrega", nombre: "Entrega prevista", escala: "entrega" },
      { id: "p10", nombre: "Entrega en un día malo (p10)", escala: "entrega" },
      { id: "fallidos", nombre: "Entregas fallidas", escala: "fallo" },
      { id: "densidad", nombre: "Paquetes por km²", escala: "densidad" },
      { id: "acceso", nombre: "Minutos desde la estación", escala: "minutos" },
      { id: "riesgo", nombre: "Riesgo de inundación", escala: "riesgo" },
    ],
    dia: [
      { id: "avance", nombre: "Entregado hasta ahora", escala: "avance" },
      { id: "acceso", nombre: "Minutos desde la estación hoy", escala: "minutos" },
      { id: "riesgo", nombre: "Riesgo de inundación", escala: "riesgo" },
    ],
  };

  const st = {
    base: null, ia: null, modo: "ia", fam: "todas", metrica: "entrega", cond: { ...R.NORMAL }, escenario: "normal",
    pred: null, res: null, sel: null, hover: null, dia: null, t: 390, simulando: false, semilla: 1, velocidad: 15, ruta: null, retrasos: null, calles: [], zoom: 1, foco: null, siguiendo: false,
    paths: [], proj: null, w: 0, h: 0, dpr: 1, desde: null,
  };
  const familias = () => (st.fam === "todas" ? FAMS : [st.fam]);

  // ── Colores ──────────────────────────────────────────
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function hex(c) {
    const m = c.replace("#", "");
    const f = m.length === 3 ? m.split("").map((x) => x + x).join("") : m;
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  }
  const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
  const rgb = (c, a = 1) => (a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  function rampa(stops, v) {
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    }
    return stops[stops.length - 1][1];
  }
  let PAL = null;
  function paleta() {
    const ok = hex(css("--ds-ok")), warn = hex(css("--ds-warn")), bad = hex(css("--ds-bad")), zona = hex(css("--ds-zone")), floor = hex(css("--ds-floor"));
    const acc = hex(css("--ds-accent")), azul = hex(css("--ds-c")), fondo = hex(css("--ds-bg"));
    // el peor tramo de la escala, siempre más oscuro que el rojo (en tema claro, mezclar con el fondo lo aclararía)
    const oscuro = document.documentElement.dataset.theme === "light" ? mix(bad, [58, 22, 18], 0.45) : mix(bad, fondo, 0.45);
    PAL = {
      ok, warn, bad, zona, floor, acc, azul, fg: css("--ds-fg"), muted: css("--ds-fg-muted"), line: css("--ds-line"), a: css("--ds-a"), c: css("--ds-c"),
      escalas: {
        entrega: { stops: [[0.5, oscuro], [0.75, bad], [0.9, warn], [0.97, ok], [1, ok]], min: 0.5, max: 1, fmt: (v) => pct(v, 0) },
        fallo: { stops: [[0, ok], [0.03, warn], [0.07, bad]], min: 0, max: 0.07, fmt: (v) => pct(v, 0) },
        densidad: { stops: [[-1, mix(zona, acc, 0.08)], [1, mix(zona, acc, 0.45)], [3, acc]], min: -1, max: 3, fmt: (v) => (10 ** v >= 1 ? n0(10 ** v) : (10 ** v).toFixed(1).replace(".", ",")), log: true },
        minutos: { stops: [[0, mix(zona, acc, 0.06)], [60, mix(zona, acc, 0.5)], [150, acc]], min: 0, max: 150, fmt: (v) => Math.round(v) + " min" },
        riesgo: { stops: [[0, mix(zona, azul, 0.05)], [1, mix(zona, azul, 0.3)], [2, mix(zona, azul, 0.6)], [3, azul]], min: 0, max: 3, fmt: (v) => ["ninguno", "bajo", "medio", "alto"][Math.round(v)] },
        avance: { stops: [[0, mix(zona, ok, 0.04)], [0.5, mix(zona, ok, 0.45)], [1, ok]], min: 0, max: 1, fmt: (v) => pct(v, 0) },
      },
    };
  }

  // ── Datos por zona según la métrica ──────────────────
  function valorZona(i) {
    const z = st.base.zonas[i], p = st.pred[i], m = st.metrica;
    if (!familias().includes(z.rutas)) return null;
    if (m === "entrega" || m === "p10" || m === "fallidos") return p[m];
    if (m === "densidad") return Math.log10(Math.max(p.paquetes, 0.1) / Math.max(z.area_km2, 0.05));
    if (m === "riesgo") return z.riesgo_inundacion;
    if (m === "acceso") return st.modo === "dia" && st.dia ? st.dia.res.zonas[i].accesoMin : z.acceso.min;
    if (m === "avance") { const a = st.dia && st.dia.avance[i]; return a && a.paquetes ? a.entregados / a.paquetes : null; }
    return null;
  }
  const escala = () => PAL.escalas[(METRICAS[st.modo].find((m) => m.id === st.metrica) || METRICAS[st.modo][0]).escala];

  // ── Proyección y dibujo ─────────────────────────────
  const BB = { minX: -6.5, maxX: -5.05, minY: 35.98, maxY: 37.02 }, KX = Math.cos((36.5 * Math.PI) / 180);
  function medir() {
    const cv = $("mp-map"), w = cv.parentElement.clientWidth;
    const gw = (BB.maxX - BB.minX) * KX, gh = BB.maxY - BB.minY;
    const h = Math.round(Math.min(w * (gh / gw), Math.max(360, window.innerHeight * 0.8)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.height = h + "px";
    const pad = 10, s = Math.min((w - 2 * pad) / gw, (h - 2 * pad) / gh);
    st.w = w; st.h = h; st.dpr = dpr;
    st.fit = { s, ox: (w - gw * s) / 2, oy: (h - gh * s) / 2 };
    st.escalaPx = s;
    vista();
  }
  // La vista: la provincia entera o, con zoom, centrada en un punto (st.foco). Las zonas se
  // vuelven a proyectar en cada cambio: son ~3.000 vértices, cuesta menos que un fotograma.
  function vista() {
    const z = st.zoom, s = st.fit.s * z;
    let ox = st.fit.ox, oy = st.fit.oy;
    if (z > 1 && st.foco) {
      const lon = clamp(st.foco[0], BB.minX, BB.maxX), lat = clamp(st.foco[1], BB.minY, BB.maxY);
      ox = st.w / 2 - (lon - BB.minX) * KX * s; oy = st.h / 2 - (BB.maxY - lat) * s;
    }
    st.proj = (lon, lat) => [ox + (lon - BB.minX) * KX * s, oy + (BB.maxY - lat) * s];
    st.inv = (x, y) => [(x - ox) / (KX * s) + BB.minX, BB.maxY - (y - oy) / s];
    const path = (polys) => {
      const p = new Path2D();
      for (const poly of polys) for (const ring of poly) {
        ring.forEach(([x, y], k) => { const [px, py] = st.proj(x, y); k ? p.lineTo(px, py) : p.moveTo(px, py); });
        p.closePath();
      }
      return p;
    };
    st.paths = st.base.zonas.map((z) => path(z.geometria));
    st.contexto = Object.entries(st.base.contexto).map(([k, g]) => ({ nombre: k, path: path(g), g }));
    // el Campo de Gibraltar lo reparte otra estación: se dibuja rayado y no es una zona nuestra
    st.otra = st.contexto.find((c) => c.nombre === st.base.otra_estacion.zona);
    st.provincia = path(st.base.provincia);
    $("mp-map").style.touchAction = z > 1 ? "none" : "manipulation";
  }
  // Acercar o alejar dejando quieto el punto de la pantalla (x, y)
  function zoomEn(z, x = st.w / 2, y = st.h / 2) {
    const p = st.inv(x, y);
    st.zoom = clamp(z, 1, 24);
    const s = st.fit.s * st.zoom;
    st.foco = st.zoom > 1 ? [p[0] - (x - st.w / 2) / (KX * s), p[1] + (y - st.h / 2) / s] : null;
    vista(); dibujar();
  }

  // Con zoom, el callejero de cada zona: la cuadrícula por la que se mueven las furgonetas
  function calles(ctx) {
    if (st.zoom < 3) return;
    const [x0, y1] = st.inv(0, 0), [x1, y0] = st.inv(st.w, st.h);
    ctx.save();
    ctx.lineWidth = 1; ctx.strokeStyle = rgb(PAL.floor, Math.min(0.55, (st.zoom - 2) * 0.12));
    st.base.zonas.forEach((z, i) => {
      const c = callejero(i), [minX, maxX, minY, maxY] = c.bb;
      if (maxX < x0 || minX > x1 || maxY < y0 || minY > y1) return;
      const esq = [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY]].map(c.aUV);
      const u0 = Math.min(...esq.map((q) => q[0])), u1 = Math.max(...esq.map((q) => q[0]));
      const v0 = Math.min(...esq.map((q) => q[1])), v1 = Math.max(...esq.map((q) => q[1]));
      if ((u1 - u0) / c.b + (v1 - v0) / c.b > 900) return;
      ctx.save(); ctx.clip(st.paths[i]);
      // en el campo, las calles solo alrededor del pueblo: el resto es carretera y campo
      const nucleo = { rural: 0.45, periurbana: 0.65 }[c.z.clase];
      if (nucleo) {
        const [cx, cy] = st.proj(c.z.centro[0], c.z.centro[1]);
        ctx.beginPath(); ctx.arc(cx, cy, nucleo * Math.max((maxX - minX) * KX, maxY - minY) * st.fit.s * st.zoom, 0, 7); ctx.clip();
      }
      ctx.beginPath();
      for (let u = Math.ceil(u0 / c.b) * c.b; u <= u1; u += c.b) trazo(ctx, [c.aLL([u, v0]), c.aLL([u, v1])]);
      for (let v = Math.ceil(v0 / c.b) * c.b; v <= v1; v += c.b) trazo(ctx, [c.aLL([u0, v]), c.aLL([u1, v])]);
      ctx.stroke(); ctx.restore();
    });
    ctx.restore();
  }

  function dibujar() {
    if (!st.base) return;
    if (st.siguiendo) seguir();
    const cv = $("mp-map"), ctx = cv.getContext("2d");
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.fillStyle = rgb(PAL.floor);
    ctx.fillRect(0, 0, st.w, st.h);
    // alrededores
    ctx.fillStyle = rgb(mix(PAL.zona, PAL.floor, 0.35));
    ctx.strokeStyle = PAL.line; ctx.lineWidth = 1;
    for (const c of st.contexto) { ctx.fill(c.path, "evenodd"); ctx.stroke(c.path); }
    if (st.otra) {
      ctx.save(); ctx.clip(st.otra.path, "evenodd");
      ctx.strokeStyle = PAL.line; ctx.lineWidth = 1; ctx.beginPath();
      for (let d = -st.h; d < st.w; d += 7) { ctx.moveTo(d, st.h); ctx.lineTo(d + st.h, 0); }
      ctx.stroke(); ctx.restore();
      if (st.hover === "otra") { ctx.strokeStyle = PAL.muted; ctx.lineWidth = 1.6; ctx.stroke(st.otra.path); }
    }
    ctx.font = `500 ${clamp(st.escalaPx * 0.022, 12, 16)}px DM Sans, sans-serif`;
    ctx.fillStyle = PAL.muted; ctx.textAlign = "center";
    const etiquetas = { Sevilla: [-5.75, 37.0], "Málaga": [-5.22, 36.6], Marruecos: [-5.55, 35.99], Gibraltar: [-5.3, 36.1] };
    for (const [k, [x, y]] of Object.entries(etiquetas)) { const [px, py] = st.proj(x, y); ctx.fillText(k, px, py); }

    // zonas
    const E = escala();
    st.base.zonas.forEach((z, i) => {
      const v = valorZona(i);
      ctx.fillStyle = v == null ? rgb(mix(PAL.zona, PAL.floor, 0.2)) : rgb(rampa(E.stops, v));
      ctx.fill(st.paths[i]);
    });
    calles(ctx);
    ctx.strokeStyle = rgb(PAL.floor); ctx.lineWidth = 0.6;
    st.paths.forEach((p) => ctx.stroke(p));
    ctx.strokeStyle = PAL.muted; ctx.lineWidth = 1.2; ctx.stroke(st.provincia);

    carreteras(ctx);
    if (st.modo === "dia" && st.dia) furgonetas(ctx);

    // rótulo del Campo de Gibraltar, encima de las zonas para que no lo tapen
    if (st.otra) {
      const [px, py] = st.proj(-5.43, 36.27);
      ctx.textAlign = "center";
      ctx.font = `500 ${clamp(st.escalaPx * 0.02, 11, 15)}px DM Sans, sans-serif`;
      halo(ctx, st.base.otra_estacion.zona, px, py, PAL.muted);
      ctx.font = `400 ${clamp(st.escalaPx * 0.016, 10, 12.5)}px DM Sans, sans-serif`;
      halo(ctx, st.w < 560 ? `estación de ${st.base.otra_estacion.estacion}` : `lo reparte la estación de ${st.base.otra_estacion.estacion}`, px, py + clamp(st.escalaPx * 0.024, 12, 17), PAL.muted);
    }

    // estación y pueblos
    ctx.font = `500 ${clamp(st.escalaPx * 0.019, 11, 13.5)}px DM Sans, sans-serif`;
    ctx.textAlign = "left";
    for (const m of st.base.municipios) {
      if (!(st.w < 560 ? ETIQUETAS_SM : ETIQUETAS).includes(m.nombre)) continue;
      const [x, y] = st.proj(m.pueblo[0], m.pueblo[1]);
      ctx.fillStyle = PAL.fg; ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill();
      halo(ctx, CORTOS[m.nombre] || m.nombre, x + 5, y - 4);
    }
    const e = st.base.estacion, [ex, ey] = st.proj(e.lon, e.lat);
    ctx.fillStyle = PAL.fg; ctx.strokeStyle = rgb(PAL.floor); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(ex - 7, ey - 7, 14, 14, 3); ctx.fill(); ctx.stroke();
    ctx.font = `600 ${clamp(st.escalaPx * 0.021, 12, 15)}px DM Sans, sans-serif`;
    halo(ctx, "Estación", ex + 11, ey + 4);

    // zona elegida o bajo el ratón
    for (const [i, w] of [[st.sel, 2.4], [st.hover, 1.6]]) {
      if (i == null || i === "otra") continue;
      ctx.strokeStyle = PAL.fg; ctx.lineWidth = w; ctx.stroke(st.paths[i]);
    }
  }

  function halo(ctx, txt, x, y, color = PAL.fg) {
    ctx.lineWidth = 3; ctx.strokeStyle = rgb(PAL.floor, 0.75); ctx.lineJoin = "round";
    ctx.strokeText(txt, x, y); ctx.fillStyle = color; ctx.fillText(txt, x, y);
  }

  function carreteras(ctx) {
    const cortados = new Set(st.modo === "dia" && st.dia ? st.dia.res.cortados : []);
    const inund = st.cond.inundacion;
    for (const t of st.base.carreteras) {
      const [[x1, y1], [x2, y2]] = t.coords;
      const [a, b] = [st.proj(x1, y1), st.proj(x2, y2)];
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      if (cortados.has(t.id)) {
        ctx.strokeStyle = rgb(PAL.bad); ctx.lineWidth = 3.4; ctx.stroke();
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        ctx.lineWidth = 2.4; ctx.beginPath();
        ctx.moveTo(mx - 5, my - 5); ctx.lineTo(mx + 5, my + 5); ctx.moveTo(mx + 5, my - 5); ctx.lineTo(mx - 5, my + 5); ctx.stroke();
        continue;
      }
      ctx.strokeStyle = rgb(mix(PAL.floor, hex(PAL.fg.startsWith("#") ? PAL.fg : "#888888"), 0.55), 0.8);
      ctx.lineWidth = t.tipo === "autovia" ? 2.2 : t.tipo === "sierra" ? 1 : 1.4;
      if (t.tipo === "sierra") ctx.setLineDash([4, 3]);
      ctx.stroke();
      // en la previsión, los tramos que se pueden cortar con la inundación de hoy
      if (st.modo === "ia" && inund > 0 && t.inundable) {
        const p = R.P.corteTramo * Math.pow(inund, 1.5) * (t.tipo === "autovia" ? R.P.corteAutovia : 1);
        ctx.setLineDash([5, 4]); ctx.strokeStyle = rgb(PAL.azul, 0.35 + Math.min(0.65, p * 1.5)); ctx.lineWidth = 1.5 + p * 5;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  // ── El turno simulado ───────────────────────────────
  function km(a, b) {
    const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
  // Polilínea con sus distancias acumuladas, para recorrerla a velocidad constante
  function linea(p) {
    const acum = [0];
    for (let i = 1; i < p.length; i++) acum.push(acum[i - 1] + km(p[i - 1], p[i]));
    return { p, acum, total: acum[acum.length - 1] };
  }
  // Desde la estación siguiendo los tramos (cada tramo se orienta según el nodo en que estamos)
  function polilinea(tramos, fin) {
    const T = st.tramos, e = st.base.estacion;
    let nodo = e.id;
    const p = [[e.lon, e.lat]];
    for (const id of tramos) {
      const t = T[id];
      if (t.desde === nodo) { p.push(t.coords[1]); nodo = t.hasta; } else { p.push(t.coords[0]); nodo = t.desde; }
    }
    if (fin) p.push(fin);
    return linea(p);
  }
  function punto(pl, f) {
    if (pl.total <= 0) return pl.p[pl.p.length - 1];
    const d = clamp(f, 0, 1) * pl.total;
    let i = 1;
    while (i < pl.acum.length - 1 && pl.acum[i] < d) i++;
    const k = (d - pl.acum[i - 1]) / Math.max(1e-9, pl.acum[i] - pl.acum[i - 1]);
    return [pl.p[i - 1][0] + (pl.p[i][0] - pl.p[i - 1][0]) * k, pl.p[i - 1][1] + (pl.p[i][1] - pl.p[i - 1][1]) * k];
  }
  // Los vértices recorridos hasta la fracción f, para pintar el rastro
  function tramoHasta(pl, f) {
    const d = clamp(f, 0, 1) * pl.total, out = [pl.p[0]];
    for (let i = 1; i < pl.p.length && pl.acum[i] < d; i++) out.push(pl.p[i]);
    out.push(punto(pl, f));
    return out;
  }

  // ¿Está el punto dentro de la zona? (par-impar sobre todos sus anillos)
  function dentro(geo, x, y) {
    let c = false;
    for (const poly of geo) for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
    }
    return c;
  }
  // Cada zona tiene su callejero: una cuadrícula girada con manzanas del tamaño de su tipo
  const MANZANA = { urbana: 0.0022, periurbana: 0.0038, rural: 0.007 };
  function callejero(i) {
    if (st.calles[i]) return st.calles[i];
    const z = st.base.zonas[i];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const poly of z.geometria) for (const [x, y] of poly[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    let h = 0; for (const ch of z.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const ang = ((h % 90) * Math.PI) / 180;
    // de lon/lat a coordenadas de la cuadrícula (u, v) y vuelta
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const aUV = ([x, y]) => { const X = x * KX, Y = y; return [X * ca + Y * sa, -X * sa + Y * ca]; };
    const aLL = ([u, v]) => { const X = u * ca - v * sa, Y = u * sa + v * ca; return [X / KX, Y]; };
    st.calles[i] = { z, geo: z.geometria, bb: [minX, maxX, minY, maxY], b: MANZANA[z.clase] || 0.004, aUV, aLL };
    return st.calles[i];
  }
  // Paradas dentro de la zona, alrededor de donde vive la gente, en los cruces de su callejero
  function paradas(i, n, rand) {
    const c = callejero(i), [minX, maxX, minY, maxY] = c.bb, cen = c.z.centro;
    const sx = (maxX - minX) / (c.z.clase === "rural" ? 5 : 3.5), sy = (maxY - minY) / (c.z.clase === "rural" ? 5 : 3.5);
    const gauss = () => (rand() + rand() + rand() - 1.5) * 1.4;
    const out = [];
    for (let k = 0; k < n; k++) {
      let p = null;
      for (let tries = 0; tries < 25 && !p; tries++) {
        const [u, v] = c.aUV([cen[0] + gauss() * sx, cen[1] + gauss() * sy]);
        const q = c.aLL([Math.round(u / c.b) * c.b, Math.round(v / c.b) * c.b]);
        if (dentro(c.geo, q[0], q[1])) p = q;
      }
      out.push(p || cen);
    }
    return out;
  }
  // De una parada a otra por las calles: en escalera por la cuadrícula, sin salir de la zona
  function porCalles(i, a, b, rand) {
    const c = callejero(i), A = c.aUV(a), B = c.aUV(b);
    const du = B[0] - A[0], dv = B[1] - A[1];
    const pasos = clamp(Math.round(Math.max(Math.abs(du), Math.abs(dv)) / (3 * c.b)), 1, 3);
    const ok = (pts) => pts.every((p, k) => k === 0 || [0.25, 0.5, 0.75, 1].every((f) => {
      const q = [pts[k - 1][0] + (p[0] - pts[k - 1][0]) * f, pts[k - 1][1] + (p[1] - pts[k - 1][1]) * f];
      return dentro(c.geo, q[0], q[1]);
    }));
    for (const primeroU of rand() < 0.5 ? [true, false] : [false, true]) {
      const uv = [A];
      let u = A[0], v = A[1];
      for (let k = 0; k < pasos; k++) {
        // las esquinas, en los cruces del callejero
        const nu = Math.round((A[0] + (du * (k + 1)) / pasos) / c.b) * c.b, nv = Math.round((A[1] + (dv * (k + 1)) / pasos) / c.b) * c.b;
        if (primeroU) { u = nu; uv.push([u, v]); v = nv; uv.push([u, v]); }
        else { v = nv; uv.push([u, v]); u = nu; uv.push([u, v]); }
      }
      const pts = uv.map(c.aLL);
      pts[pts.length - 1] = b;
      if (ok(pts)) return pts;
    }
    return [a, b];
  }

  // Simula el turno y prepara la animación: cada furgoneta va de la estación a su primera
  // parada, recorre sus zonas parada a parada por las calles y vuelve a la estación
  function simularTurno() {
    // las oleadas salen como salieron en DS Flow, mientras no se toque el retraso a mano
    const retrasos = st.retrasos && st.desde && st.cond.retraso === st.desde.cond.retraso ? st.retrasos : null;
    const res = R.simular(st.base, st.cond, { seed: st.semilla, familias: familias(), retrasos });
    const rutas = res.rutas.map((r, k) => {
      const rand = R.rng(st.semilla * 1000 + k + 1);
      const partes = r.partes.map((p) => {
        const i = st.idx.get(p.zona);
        // una parada visible cada ~10 minutos de reparto
        const n = clamp(Math.round((p.fin - p.inicio) / 10), 1, 30);
        const ps = paradas(i, n, rand);
        // ordenadas por vecino más próximo, como haría el conductor
        const orden = [ps.shift()];
        while (ps.length) {
          const u = orden[orden.length - 1];
          let best = 0;
          ps.forEach((q, j) => { if (km(u, q) < km(u, ps[best])) best = j; });
          orden.push(ps.splice(best, 1)[0]);
        }
        const tramos = orden.map((q, j) => linea(j ? porCalles(i, orden[j - 1], q, rand) : [q]));
        return { ...p, i, paradas: orden, tramos };
      });
      const primera = partes.length ? partes[0].paradas[0] : st.base.zonas[st.idx.get(r.zonas[0])].centro;
      const ultimaP = partes.length ? partes[partes.length - 1] : null;
      const ultima = ultimaP ? ultimaP.paradas[ultimaP.paradas.length - 1] : primera;
      const vuelta = polilinea(r.caminoVuelta, ultima);
      // la vuelta se recorre al revés
      vuelta.p.reverse(); const tot = vuelta.total; vuelta.acum = vuelta.acum.map((x) => tot - x).reverse();
      return { r, k, partes, ida: polilinea(r.camino, primera), vuelta };
    });
    const fin = Math.max(...res.rutas.map((r) => r.vuelta || 0), 900);
    st.dia = { res, rutas, inicio: Math.min(...res.rutas.map((r) => r.oleada), 390) - 15, fin: Math.min(1260, Math.ceil(fin / 10) * 10), avance: [] };
    st.dia.curva = curvaFlota(st.dia);
    st.t = st.dia.inicio;
    if (st.ruta && !res.rutas.some((r) => r.id === st.ruta)) st.ruta = null;
    $("mp-time").min = Math.round(st.t); $("mp-time").max = st.dia.fin;
    $("mp-time").value = Math.round(st.t); $("mp-clock").textContent = R.reloj(st.t);
    avanzar();
  }

  // Estado de cada zona y de la flota a la hora st.t
  function avanzar() {
    const D = st.dia, t = st.t, idx = st.idx;
    const av = st.base.zonas.map((z, i) => ({ paquetes: D.res.zonas[i].paquetes, entregados: 0, fallidos: 0, rts: 0 }));
    const flota = { estacion: 0, calle: 0, vuelta: 0, pendiente: 0 };
    for (const { r } of D.rutas) {
      if (t < r.oleada) flota.pendiente++;
      else if (t < r.salida) flota.estacion++;
      else if (t < r.vuelta) flota.calle++;
      else flota.vuelta++;
      for (const p of r.partes) {
        const f = p.fin > p.inicio ? clamp((t - p.inicio) / (p.fin - p.inicio), 0, 1) : t >= p.inicio ? 1 : 0;
        const a = av[idx.get(p.zona)];
        a.entregados += p.entregados * f; a.fallidos += p.fallidos * f;
        if (t >= r.inicioVuelta) a.rts += p.rts;
      }
    }
    // lo incomunicado se sabe desde el principio
    D.res.zonas.forEach((z, i) => { av[i].rts += z.rtsIncomunicada; });
    D.avance = av;
    D.calle = flota.calle;
    D.flota = flota;
  }

  // Furgonetas en la estación, en la calle y de vuelta, cada 5 minutos (para la gráfica de la flota)
  function curvaFlota(D) {
    const out = [];
    for (let t = D.inicio; t <= D.fin; t += 5) {
      const c = { t, estacion: 0, calle: 0, vuelta: 0 };
      for (const { r } of D.rutas) {
        if (t < r.oleada) continue;
        if (t < r.salida) c.estacion++; else if (t < r.vuelta) c.calle++; else c.vuelta++;
      }
      out.push(c);
    }
    return out;
  }

  // Dónde está una furgoneta a la hora t y qué hace
  function posicion(v, t) {
    const r = v.r;
    if (t < r.salida) return { estado: "carga" };
    if (t >= r.vuelta) return { estado: "fuera" };
    if (t < r.llegada) return { estado: "ida", pos: punto(v.ida, (t - r.salida) / Math.max(1, r.llegada - r.salida)) };
    if (t >= r.inicioVuelta) return { estado: "vuelta", pos: punto(v.vuelta, (t - r.inicioVuelta) / Math.max(1, r.vuelta - r.inicioVuelta)) };
    let k = v.partes.findIndex((p) => t < p.fin);
    if (k < 0) k = v.partes.length - 1;
    const p = v.partes[k];
    if (t < p.inicio && k > 0) {
      // de una zona a la siguiente
      const prev = v.partes[k - 1], a = prev.paradas[prev.paradas.length - 1], b = p.paradas[0];
      const f = (t - prev.fin) / Math.max(1, p.inicio - prev.fin);
      return { estado: "ruta", pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] };
    }
    // en reparto: cada parada es un hueco de tiempo; en el primer 55% conduce hasta ella, el resto entrega
    const n = p.paradas.length, f = p.fin > p.inicio ? clamp((t - p.inicio) / (p.fin - p.inicio), 0, 0.9999) : 0.9999;
    const j = Math.floor(f * n), g = f * n - j;
    const conduce = j > 0 && g < 0.55;
    return { estado: conduce ? "ruta" : "parada", pos: conduce ? punto(p.tramos[j], g / 0.55) : p.paradas[j], parte: k, parada: j, g: conduce ? g / 0.55 : 1 };
  }

  function trazo(ctx, pts) {
    pts.forEach(([x, y], k) => { const [px, py] = st.proj(x, y); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  }

  function furgonetas(ctx) {
    const D = st.dia, t = st.t, cols = { DQX1: PAL.a, EQX1: PAL.c };
    const e = st.base.estacion, [ex, ey] = st.proj(e.lon, e.lat);
    const sel = st.ruta ? D.rutas.find((v) => v.r.id === st.ruta) : null;
    // el rastro de lo recorrido hoy en sus zonas: las calles por las que ya ha pasado
    ctx.lineWidth = 1; ctx.lineJoin = "round";
    const pos = new Map();
    for (const v of D.rutas) {
      const s = posicion(v, t);
      pos.set(v, s);
      if (!v.partes.length || t < v.r.llegada) continue;
      ctx.strokeStyle = rgb(hex(cols[v.r.familia]), sel && sel !== v ? 0.12 : 0.32);
      ctx.beginPath();
      v.partes.forEach((p, k) => {
        if (t < p.inicio) return;
        if (s.parte === k) {
          const j = s.parada;
          for (let m = 1; m < j; m++) trazo(ctx, p.tramos[m].p);
          if (j > 0) trazo(ctx, s.estado === "ruta" ? tramoHasta(p.tramos[j], s.g) : p.tramos[j].p);
        } else p.tramos.forEach((pl, m) => m && trazo(ctx, pl.p));
      });
      ctx.stroke();
    }
    // la ruta elegida, entera: ida, sus zonas y vuelta
    if (sel) {
      ctx.save();
      ctx.strokeStyle = rgb(hex(PAL.fg.startsWith("#") ? PAL.fg : "#888888"), 0.7); ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]);
      ctx.beginPath(); trazo(ctx, sel.ida.p);
      sel.partes.forEach((p) => p.tramos.forEach((pl) => trazo(ctx, pl.p)));
      trazo(ctx, sel.vuelta.p); ctx.stroke();
      ctx.restore();
    }
    // en la estación, cargando: un punto por furgoneta en su plaza
    const cargando = D.rutas.filter((v) => t >= v.r.oleada && t < v.r.salida);
    cargando.forEach((v, k) => {
      const col = k % 10, fila = Math.floor(k / 10);
      const x = ex + 12 + col * 5, y = ey - 12 - fila * 5;
      ctx.fillStyle = cols[v.r.familia]; ctx.fillRect(x, y, 3.6, 3.6);
    });
    // en la calle
    for (const v of D.rutas) {
      const s = pos.get(v);
      if (!s.pos) continue;
      const [x, y] = st.proj(s.pos[0], s.pos[1]);
      const elegida = sel === v, rr = elegida ? 6 : 3.6;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 7);
      if (s.estado === "vuelta") {
        // de vuelta: hueca
        ctx.fillStyle = rgb(PAL.floor); ctx.fill();
        ctx.lineWidth = 1.8; ctx.strokeStyle = cols[v.r.familia]; ctx.stroke();
      } else {
        ctx.fillStyle = cols[v.r.familia]; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = rgb(PAL.floor); ctx.stroke();
        if (s.estado === "parada") { ctx.beginPath(); ctx.arc(x, y, rr + 2.6, 0, 7); ctx.lineWidth = 1; ctx.strokeStyle = cols[v.r.familia]; ctx.stroke(); }
      }
      if (elegida) {
        ctx.font = `600 12px DM Sans, sans-serif`; ctx.textAlign = "left";
        halo(ctx, v.r.id, x + 9, y - 7);
      }
    }
    // cuántas cargan y cuántas han vuelto
    const F = D.flota, partes = [];
    if (F.estacion) partes.push(`${F.estacion} cargando`);
    if (F.vuelta) partes.push(`${F.vuelta} de vuelta`);
    if (partes.length) {
      ctx.font = `500 ${clamp(st.escalaPx * 0.017, 10.5, 12.5)}px DM Sans, sans-serif`; ctx.textAlign = "left";
      halo(ctx, partes.join(" · "), ex + 11, ey + 20, PAL.muted);
    }
  }

  // Elegir una furgoneta: el mapa se acerca y la sigue por sus calles
  function elegirRuta(id) {
    st.ruta = id;
    if (id) { st.siguiendo = true; if (st.zoom < 8) st.zoom = 8; }
    else st.siguiendo = false;
    pintarFlota(); dibujar();
  }
  function seguir() {
    const v = st.ruta && st.dia && st.dia.rutas.find((x) => x.r.id === st.ruta);
    if (!v) { st.siguiendo = false; return; }
    const s = posicion(v, st.t), e = st.base.estacion;
    st.foco = s.pos || [e.lon, e.lat];
    vista();
  }

  // La furgoneta más cercana a un punto del mapa (para elegirla con un clic)
  function furgonetaEn(x, y) {
    if (st.modo !== "dia" || !st.dia) return null;
    let best = null, dmin = 10;
    for (const v of st.dia.rutas) {
      const s = posicion(v, st.t);
      if (!s.pos) continue;
      const [px, py] = st.proj(s.pos[0], s.pos[1]), d = Math.hypot(px - x, py - y);
      if (d < dmin) { dmin = d; best = v.r.id; }
    }
    return best;
  }

  // ── Previsión de la IA ──────────────────────────────
  function prever() {
    st.pred = st.ia.zonas(st.cond, { familias: familias() });
    st.res = st.ia.resumen(st.pred);
    st.why = st.ia.explicar(st.cond, { familias: familias(), familia: st.fam === "todas" ? "total" : st.fam });
  }

  // ── Panel ───────────────────────────────────────────
  function clase(v) { return v >= 0.97 ? "is-ok" : v >= 0.9 ? "is-warn" : "is-bad"; }
  function kpi(nombre, valor, sub, cls = "") {
    return `<div class="ds-kpi"><span>${nombre}</span><strong class="${cls}">${valor}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
  }
  function rutasPlan(fams) {
    return fams.reduce((a, f) => a + Math.round(R.P.familias[f].rutas * (1 + st.cond.refuerzo) * (1 - st.cond.huelga)), 0);
  }

  function pintarPanel() {
    const key = st.fam === "todas" ? "total" : st.fam;
    if (st.modo === "ia") {
      const r = st.res[key];
      $("mp-kpis").innerHTML = [
        kpi("Paquetes", n0(r.paquetes), `${rutasPlan(familias())} rutas`),
        kpi("Entrega prevista", pct(r.entrega), "por la IA", clase(r.entrega)),
        kpi("Día malo", pct(r.p10), "9 de cada 10 salen mejor", clase(r.p10)),
        kpi("Sin entregar", n0(r.noEntregados), "vuelven o fallan"),
        kpi("Fallidas", pct(r.fallidos), "cliente ausente, sin acceso"),
        kpi("Rutas", String(rutasPlan(familias())), st.cond.huelga ? `${Math.round(st.cond.huelga * 100)}% sin conductor` : st.cond.refuerzo ? "con refuerzo" : "como en DS Flow"),
      ].join("");
    } else {
      const D = st.dia, av = D.avance, s = (k) => av.reduce((a, z) => a + z[k], 0);
      const paq = s("paquetes"), ent = s("entregados"), fin = st.t >= D.fin - 1;
      const iaR = st.res[key];
      $("mp-kpis").innerHTML = [
        kpi("Hora", R.reloj(st.t), fin ? "turno terminado" : `${D.calle} furgonetas en la calle`),
        kpi("Entregados", n0(ent), `${pct(paq ? ent / paq : 0)} de ${n0(paq)}`, fin ? clase(ent / paq) : ""),
        kpi("Fallidos", n0(s("fallidos")), "se reintentan mañana"),
        kpi("Devueltos", n0(s("rts")), "vuelven a la estación"),
        kpi("Tramos cortados", String(D.res.cortados.length), D.res.cortados.length ? "por el flash flood" : "carreteras abiertas", D.res.cortados.length ? "is-bad" : ""),
        kpi("La IA preveía", pct(iaR.entrega), fin ? `hoy ${pct(paq ? ent / paq : 0)}` : "al acabar el turno"),
      ].join("");
    }
    // barras por familia (siempre con la previsión)
    $("mp-fams").innerHTML = FAMS.map((f) => {
      const r = st.res[f];
      if (!r || !r.paquetes) return "";
      const col = rgb(rampa(PAL.escalas.entrega.stops, r.entrega)), col10 = rgb(rampa(PAL.escalas.entrega.stops, r.p10));
      const w = (v) => clamp((v - 0.5) / 0.5, 0, 1) * 100;
      return `<div class="mp-fam"><b>${f}</b><div class="mp-track" title="Entrega prevista y día malo"><i style="width:${w(r.entrega)}%;background:${col}"></i><i class="mp-p10" style="width:${w(r.p10)}%;background:${col10}"></i></div><span>${pct(r.entrega)} · ${n0(r.paquetes)} paq</span></div>`;
    }).join("");
    pintarFlota();
    pintarPorQue();
    pintarRecos();
    pintarZona();
    pintarLeyenda();
  }

  // ── La flota: cómo salen, cómo vuelven y cómo les ha ido ──
  const ESTADO = { carga: "cargando en la estación", ida: "de camino a su primera zona", ruta: "conduciendo por su zona", parada: "entregando", vuelta: "volviendo a la estación", fuera: "de vuelta en la estación" };
  function pintarFlota() {
    const card = $("mp-fleet-card");
    card.hidden = st.modo !== "dia" || !st.dia;
    if (card.hidden) return;
    const D = st.dia, F = D.flota, t = st.t, total = D.rutas.length, K = D.res.kpis.total, fl = K.flota;
    const seg = (n, cls, txt) => (n ? `<i class="${cls}" style="flex:${n}" title="${n} ${txt}"></i>` : "");
    const barra = `<div class="mp-fleet-bar">${seg(F.pendiente, "is-wait", "aún sin oleada")}${seg(F.estacion, "is-load", "cargando")}${seg(F.calle, "is-out", "en la calle")}${seg(F.vuelta, "is-back", "de vuelta")}${seg(fl.sinConductor, "is-off", "sin conductor")}</div>
      <div class="mp-fleet-keys"><span><i class="is-load"></i>Cargando ${F.estacion}</span><span><i class="is-out"></i>En la calle ${F.calle}</span><span><i class="is-back"></i>De vuelta ${F.vuelta}</span>${fl.sinConductor ? `<span><i class="is-off"></i>Sin conductor ${fl.sinConductor}</span>` : ""}</div>`;
    // la flota a lo largo del turno: salen por oleadas y vuelven por la tarde
    const W = 300, H = 64, x = (m) => ((m - D.inicio) / (D.fin - D.inicio)) * W, y = (n) => H - (n / total) * (H - 4);
    const area = (k) => `M0,${H} ` + D.curva.map((c) => `L${x(c.t).toFixed(1)},${y(c[k]).toFixed(1)}`).join(" ") + ` L${W},${H} Z`;
    const lineaV = "M" + D.curva.map((c) => `${x(c.t).toFixed(1)},${y(c.vuelta).toFixed(1)}`).join(" L");
    const horas = [];
    for (let h = Math.ceil(D.inicio / 120) * 120; h < D.fin; h += 120) horas.push(h);
    const grafica = `<div class="mp-fleet-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Furgonetas en la calle y de vuelta a lo largo del turno">
      <path d="${area("calle")}" class="is-out"/><path d="${area("estacion")}" class="is-load"/><path d="${lineaV}" class="is-back-line" vector-effect="non-scaling-stroke"/>
      <line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="0" y2="${H}" class="is-now" vector-effect="non-scaling-stroke"/></svg>
      <div class="mp-fleet-axis">${horas.map((h) => `<span style="left:${((h - D.inicio) / (D.fin - D.inicio)) * 100}%">${R.reloj(h)}</span>`).join("")}</div></div>`;

    // cómo le ha ido a cada conductor: se sabe cuando vuelve
    const vueltas = D.rutas.filter((v) => t >= v.r.vuelta).map((v) => v.r);
    const malas = vueltas.filter((r) => r.sobrecargada).sort((a, b) => b.rts - a.rts);
    const media = (arr, f) => (arr.length ? arr.reduce((a, r) => a + f(r), 0) / arr.length : 0);
    const hh = (min) => { const m = Math.round(min); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
    const terminado = F.vuelta === total;
    const kp = vueltas.length ? `<div class="ds-kpis mp-kpis mp-fleet-kpis">${[
      kpi("Sin problemas", String(vueltas.length - malas.length), `de ${vueltas.length} que han vuelto`, malas.length ? "" : "is-ok"),
      kpi("Con problemas", String(malas.length), malas.length ? `${malas.filter((r) => r.motivo === "tiempo").length} sin tiempo · ${malas.filter((r) => r.motivo === "agua").length} por el agua` : "ninguna ruta", malas.length ? (malas.length > 0.15 * vueltas.length ? "is-bad" : "is-warn") : ""),
      kpi("Jornada media", hh(media(vueltas, (r) => r.horas * 60)), `de un bloque de ${R.P.jornada / 60} h`),
      kpi("Paquetes por ruta", n0(media(vueltas, (r) => r.paquetes)), `${n0(media(vueltas, (r) => r.entregados))} entregados`),
      kpi("Km por ruta", n0(media(vueltas, (r) => r.km)), "ida, reparto y vuelta"),
      kpi(terminado ? "Última en volver" : "Margen medio", terminado ? R.reloj(Math.max(...vueltas.map((r) => r.vuelta))) : hh(Math.max(0, media(vueltas, (r) => r.holgura))), terminado ? `margen medio ${hh(Math.max(0, media(vueltas, (r) => r.holgura)))}` : "antes de su límite"),
    ].join("")}</div>` : `<p class="mp-muted">Ninguna furgoneta ha vuelto todavía: cómo le ha ido a cada conductor se sabe cuando vuelve a la estación.</p>`;

    // ¿sobraron o faltaron furgonetas? Al terminar el turno
    let veredicto = "";
    if (terminado) {
      const agua = K.rtsInundacion + K.rtsIncomunicada, frases = [];
      if (fl.faltan > 0) frases.push(["bad", `Faltaron unas <b>${fl.faltan} furgonetas</b>: ${n0(K.rtsTiempo)} paquetes volvieron a la estación porque no dio tiempo.`]);
      else if (fl.sobran > 0) frases.push(["ok", `Sobraron unas <b>${fl.sobran} furgonetas</b>: las rutas volvieron con más margen del que se planifica (${Math.round(R.P.jornada * (1 - R.P.planificada))} min).`]);
      else frases.push(["ok", "Furgonetas justas: todas las rutas acabaron y volvieron con el margen normal."]);
      if (agua > 0) frases.push(["bad", `${n0(agua)} paquetes volvieron por el agua (zonas inundadas o sin acceso): eso no lo arregla otra furgoneta.`]);
      if (fl.sinConductor > 0) frases.push(["warn", `${fl.sinConductor} conductores no salieron por la huelga; sus paquetes se repartieron entre los que sí salieron.`]);
      veredicto = `<ul class="ds-alerts mp-fleet-verdict">${frases.map(([k, f]) => `<li class="${k === "ok" ? "" : "is-" + k}">${f}</li>`).join("")}</ul>`;
    }
    // las peores, una por municipio para que se vea dónde está el problema
    const peores = [], vistos = new Set();
    for (const r of malas) { const m = municipios(r)[0]; if (!vistos.has(m)) { vistos.add(m); peores.push(r); } if (peores.length === 5) break; }
    const lista = malas.length ? `<div class="mp-fleet-list"><h5>Rutas con problemas <small>toca una para seguirla en el mapa</small></h5>${peores.map((r) =>
      `<button data-ruta="${r.id}" aria-pressed="${st.ruta === r.id}"><b>${r.id}</b><span>${esc(municipios(r)[0])}</span><span>${n0(r.rts)} vuelven · ${r.motivo === "agua" ? "por el agua" : "sin tiempo"}</span></button>`).join("")}</div>` : "";
    $("mp-fleet-sub").textContent = terminado ? "turno terminado" : `${R.reloj(t)} · ${total} rutas`;
    $("mp-fleet").innerHTML = barra + grafica + kp + veredicto + lista + pintarRuta();
  }
  function municipios(r) { return [...new Set(r.zonas.map((id) => st.base.zonas[st.idx.get(id)].municipio))].map((m) => CORTOS[m] || m); }
  // La ruta elegida, por dentro
  function pintarRuta() {
    const v = st.ruta && st.dia.rutas.find((x) => x.r.id === st.ruta);
    if (!v) return `<p class="mp-muted mp-fleet-hint">Toca una furgoneta en el mapa para seguir su ruta.</p>`;
    const r = v.r, s = posicion(v, st.t), vuelta = st.t >= r.vuelta, retraso = Math.round(r.salida - R.P.carga - r.oleada);
    const filas = [
      ["Ahora", st.t < r.oleada ? "esperando su oleada" : ESTADO[s.estado]], ["Oleada", `${r.ola + 1} · ${R.reloj(r.oleada)}`],
      ["Salida", `${R.reloj(r.salida)}${retraso > 0 ? ` (${retraso} min tarde)` : ""}`], ["Zonas", municipios(r).join(", ")],
      ["Paquetes", n0(r.paquetes)], ["Primera entrega", R.reloj(r.llegada)],
    ];
    if (vuelta) filas.push(["Entregados", n0(r.entregados)], ["Fallidos", n0(r.fallidos)], ["Vuelven", r.rts ? `${n0(r.rts)} (${r.rtsAgua >= r.rtsTiempo ? "el agua" : "sin tiempo"})` : "0"],
      ["Km", n0(r.km)], ["Vuelta", `${R.reloj(r.vuelta)} · límite ${R.reloj(r.limite)}`]);
    else filas.push(["Límite de vuelta", R.reloj(r.limite)]);
    return `<div class="mp-zone mp-fleet-route"><h5>${r.id} <small>${r.familia}</small><button class="ds-icon" data-ruta="" aria-label="Dejar de seguir la ruta">×</button></h5><dl>${filas.map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join("")}</dl></div>`;
  }

  function pintarPorQue() {
    const w = st.why;
    if (!w.aportes.length) {
      $("mp-why").innerHTML = `<p class="mp-muted">Día normal: la IA prevé un ${pct(w.escenario)} de entrega. Mueve las condiciones para ver qué resta cada una.</p>`;
      $("mp-why-sub").textContent = "frente a un día normal";
      return;
    }
    const max = Math.max(0.02, ...w.aportes.map((a) => Math.abs(a.aporte)));
    $("mp-why-sub").textContent = `${pct(w.normal)} → ${pct(w.escenario)}`;
    $("mp-why").innerHTML = w.aportes.map((a) => {
      const k = (Math.abs(a.aporte) / max) * 50, neg = a.aporte < 0;
      const style = neg ? `right:50%;width:${k}%;background:${rgb(PAL.bad)}` : `left:50%;width:${k}%;background:${rgb(PAL.ok)}`;
      return `<div class="mp-why-row"><span>${NOMBRE_COND[a.condicion]}</span><div class="mp-track"><i style="${style}"></i></div><output>${pts(a.aporte)}</output></div>`;
    }).join("") + `<p class="mp-muted">Puntos de entrega que suma o resta cada condición (valores de Shapley sobre el modelo).</p>`;
  }

  function pintarRecos() {
    const recos = [], c = st.cond, key = st.fam === "todas" ? "total" : st.fam;
    const prev = (cc) => st.ia.resumen(st.ia.zonas(cc, { familias: familias() }))[key];
    const r = st.res[key];
    if (r.entrega >= 0.97) recos.push(["ok", `Día tranquilo: la IA prevé un ${pct(r.entrega)} de entrega y un día malo del ${pct(r.p10)}. No hace falta reforzar.`]);
    if (r.entrega < 0.95 && c.refuerzo < 0.3) {
      let objetivo = null;
      for (let x = c.refuerzo; x <= 0.3001; x += 0.01) {
        if (prev({ ...c, refuerzo: x }).entrega >= 0.95) { objetivo = x; break; }
      }
      const extra = (x) => Math.round(familias().reduce((a, f) => a + R.P.familias[f].rutas, 0) * (x - c.refuerzo) * (1 - c.huelga));
      if (objetivo != null) recos.push(["warn", `Con ${extra(objetivo)} furgonetas de refuerzo la entrega prevista sube al 95%.`]);
      else {
        const tope = prev({ ...c, refuerzo: 0.3 });
        const causas = [];
        if (c.inundacion > 0.2) causas.push("las carreteras cortadas");
        if (c.huelga > 0.1) causas.push(`los ${Math.round(familias().reduce((a, f) => a + R.P.familias[f].rutas, 0) * c.huelga)} conductores que no salen`);
        recos.push(["bad", `Ni con ${extra(0.3)} furgonetas más se llega al 95% (se quedaría en el ${pct(tope.entrega)})${causas.length ? `: el problema no son las furgonetas, son ${causas.join(" y ")}` : ""}.`]);
      }
    }
    if (c.retraso > 0) {
      const sin = prev({ ...c, retraso: 0 });
      recos.push([sin.entrega - r.entrega > 0.01 ? "warn" : "ok", `El retraso de salida de la estación (${Math.round(c.retraso)} min) cuesta ${pts(sin.entrega - r.entrega).replace("+", "")} puntos: unos ${n0((sin.entrega - r.entrega) * r.paquetes)} paquetes. Se gana en el sort de <a href="../">DS Flow</a>.`]);
    }
    if (c.inundacion > 0) {
      // las cinco zonas con peor día malo, agrupadas por municipio
      const porMuni = new Map();
      for (const z of st.pred.filter((z) => z.activa).sort((a, b) => a.p10 - b.p10).slice(0, 5)) {
        const zz = st.base.zonas[st.idx.get(z.id)];
        if (!porMuni.has(zz.municipio)) porMuni.set(zz.municipio, []);
        porMuni.get(zz.municipio).push(zz.cp);
      }
      const peores = [...porMuni].map(([m, cps]) => `${m} (${cps.join(", ")})`);
      recos.push(["bad", `Zonas más expuestas al flash flood: ${peores.join(", ")}. Conviene avisar a los clientes y no cargar ahí paquetes con hora.`]);
    }
    if (st.fam === "todas" && st.res.EQX1.paquetes && st.res.DQX1.paquetes && st.res.EQX1.entrega < st.res.DQX1.entrega - 0.04) {
      recos.push(["warn", `EQX1 sufre más (${pct(st.res.EQX1.entrega)} frente a ${pct(st.res.DQX1.entrega)}): sus rutas pasan más de una hora en carretera antes de la primera entrega.`]);
    }
    $("mp-reco").innerHTML = recos.map(([k, t]) => `<li class="${k === "ok" ? "" : "is-" + k}">${t}</li>`).join("");
  }

  function pintarZona() {
    const i = st.sel != null ? st.sel : st.hover === "otra" ? null : st.hover;
    if (i == null) { $("mp-zone").innerHTML = `<p class="mp-muted">Elige una zona para ver su detalle.</p>`; return; }
    const z = st.base.zonas[i], p = st.pred[i];
    const filas = [
      ["Rutas", z.rutas], ["Comarca", z.comarca], ["Población (est.)", n0(z.poblacion)], ["Superficie", `${z.area_km2.toFixed(1).replace(".", ",")} km²`],
      ["Paquetes del día", n0(p.paquetes)], ["Entrega prevista", pct(p.entrega)], ["Día malo (p10)", pct(p.p10)], ["Fallidas", pct(p.fallidos)],
      ["Desde la estación", `${z.acceso.min} min · ${Math.round(z.acceso.km)} km`], ["Riesgo de inundación", ["ninguno", "bajo", "medio", "alto"][z.riesgo_inundacion]],
      ["Lluvia habitual", `×${String(z.lluvia_relativa).replace(".", ",")}`],
    ];
    if (st.modo === "dia" && st.dia) {
      const a = st.dia.avance[i], d = st.dia.res.zonas[i];
      filas.push(["Entregados hoy", `${n0(a.entregados)} de ${n0(a.paquetes)}`], ["Devueltos", n0(a.rts)], ["Furgonetas", String(d.furgonetas)],
        ["Hoy desde la estación", d.accesoMin == null ? "incomunicada" : `${d.accesoMin} min`]);
    }
    if (!familias().includes(z.rutas)) filas.splice(4, 4, ["Hoy", `no se juegan las rutas ${z.rutas}`]);
    $("mp-zone").innerHTML = `<h5>${esc(z.municipio)} <small>${z.cp}</small></h5><dl>${filas.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }

  function pintarLeyenda() {
    const E = escala(), m = METRICAS[st.modo].find((x) => x.id === st.metrica);
    const n = 8, stops = Array.from({ length: n + 1 }, (_, k) => E.min + ((E.max - E.min) * k) / n);
    const grad = `linear-gradient(90deg, ${stops.map((v) => rgb(rampa(E.stops, v))).join(", ")})`;
    const extra = st.modo === "dia"
      ? `<span><i class="mp-van" style="background:${PAL.a}"></i>DQX1</span><span><i class="mp-van" style="background:${PAL.c}"></i>EQX1</span><span><i class="mp-van mp-van--stop"></i>Entregando</span><span><i class="mp-van mp-van--back"></i>Volviendo</span><span><i class="mp-cut"></i>Tramo cortado</span>`
      : st.cond.inundacion > 0 ? `<span><i class="mp-flood"></i>Riesgo de corte (más grueso, más probable)</span>` : "";
    $("mp-legend").innerHTML = `<span>${m.nombre}</span><span class="mp-ramp-lbl">${E.fmt(E.min)}</span><i class="mp-ramp" style="background:${grad}"></i><span class="mp-ramp-lbl">${E.fmt(E.max)}</span><span>■ Estación</span><span><i class="mp-otra"></i>${esc(st.base.otra_estacion.zona)}: otra estación</span>${extra}`;
  }

  // ── Controles ───────────────────────────────────────
  function pintarControles() {
    $("mp-scenarios").innerHTML = R.ESCENARIOS.map((e) => `<button data-esc="${e.id}" aria-pressed="${e.id === st.escenario}">${esc(e.nombre)}</button>`).join("");
    $("mp-sliders").innerHTML = R.CONDICIONES.map((c) => `
      <div class="mp-slider${st.cond[c.id] !== R.NORMAL[c.id] ? " is-on" : ""}" data-c="${c.id}">
        <label for="mp-c-${c.id}">${c.nombre}</label><output id="mp-o-${c.id}">${c.formato(st.cond[c.id])}</output>
        <input type="range" id="mp-c-${c.id}" min="${c.min}" max="${c.max}" step="${c.paso}" value="${st.cond[c.id]}">
      </div>`).join("");
    $("mp-metric").innerHTML = METRICAS[st.modo].map((m) => `<option value="${m.id}"${m.id === st.metrica ? " selected" : ""}>${m.nombre}</option>`).join("");
  }

  function actualizar(opts = {}) {
    prever();
    if (st.modo === "dia" && !opts.mantenerDia) { simularTurno(); }
    pintarPanel();
    dibujar();
  }

  function ponerEscenario(id) {
    const e = R.ESCENARIOS.find((x) => x.id === id);
    st.escenario = e.id; st.cond = { ...R.NORMAL, ...e.condiciones };
    if (st.desde && st.desde.cond) st.cond = { ...st.cond, volumen: st.desde.cond.volumen, retraso: Math.max(st.cond.retraso, st.desde.cond.retraso) };
    st.simulando = false; pintarControles(); actualizar(); botonSimular();
  }

  function ponerModo(modo) {
    st.modo = modo;
    st.ruta = null; st.siguiendo = false;
    document.querySelectorAll(".mp-seg [data-mode]").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.mode === modo)));
    st.metrica = METRICAS[st.modo][0].id;
    $("mp-day").hidden = st.modo !== "dia";
    st.simulando = st.modo === "dia";
    pintarControles(); actualizar(); botonSimular();
  }

  function enlazar() {
    $("mp-scenarios").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-esc]"); if (b) ponerEscenario(b.dataset.esc);
    });
    $("mp-sliders").addEventListener("input", (ev) => {
      const inp = ev.target; if (inp.type !== "range") return;
      const id = inp.id.replace("mp-c-", ""), c = R.CONDICIONES.find((x) => x.id === id);
      st.cond[id] = +inp.value;
      $("mp-o-" + id).textContent = c.formato(st.cond[id]);
      inp.parentElement.classList.toggle("is-on", st.cond[id] !== R.NORMAL[id]);
      st.escenario = null;
      document.querySelectorAll("#mp-scenarios button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      st.simulando = false; botonSimular();
      actualizar();
    });
    document.querySelectorAll(".mp-seg [data-mode]").forEach((b) => b.addEventListener("click", () => ponerModo(b.dataset.mode)));
    $("mp-tour").addEventListener("click", () => (tour.active ? tour.stop() : tour.start()));
    $("mp-fam").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-fam]"); if (!b) return;
      st.fam = b.dataset.fam;
      document.querySelectorAll("#mp-fam button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      actualizar();
    });
    $("mp-fleet").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-ruta]"); if (!b) return;
      elegirRuta(b.dataset.ruta && b.dataset.ruta !== st.ruta ? b.dataset.ruta : null);
    });
    $("mp-metric").addEventListener("change", (ev) => { st.metrica = ev.target.value; pintarLeyenda(); dibujar(); });
    $("mp-play").addEventListener("click", () => {
      if (!st.simulando && st.t >= st.dia.fin - 1) { st.t = +$("mp-time").min; avanzar(); }
      st.simulando = !st.simulando; botonSimular();
    });
    $("mp-other").addEventListener("click", () => { st.semilla++; simularTurno(); st.simulando = true; botonSimular(); pintarPanel(); dibujar(); });
    $("mp-speed").addEventListener("change", (ev) => { st.velocidad = +ev.target.value; });
    $("mp-time").addEventListener("input", (ev) => { st.t = +ev.target.value; st.simulando = false; botonSimular(); $("mp-clock").textContent = R.reloj(st.t); avanzar(); pintarPanel(); dibujar(); });
    $("ds-theme").addEventListener("click", () => {
      const t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem("a-theme", t); } catch (e) { /* sin almacenamiento */ }
      $("ds-theme").textContent = t === "light" ? "☾" : "☀";
      paleta(); pintarPanel(); dibujar();
    });

    const cv = $("mp-map");
    const zonaEn = (ev) => {
      const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) * st.dpr, y = (ev.clientY - r.top) * st.dpr;
      const ctx = cv.getContext("2d");
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      for (let i = 0; i < st.paths.length; i++) if (ctx.isPointInPath(st.paths[i], x, y)) return i;
      if (st.otra && ctx.isPointInPath(st.otra.path, x, y, "evenodd")) return "otra";
      return null;
    };
    const furgonetaBajo = (ev) => { const r = cv.getBoundingClientRect(); return furgonetaEn(ev.clientX - r.left, ev.clientY - r.top); };
    cv.addEventListener("mousemove", (ev) => {
      const tip = $("mp-tip"), fid = furgonetaBajo(ev);
      cv.style.cursor = fid ? "pointer" : "";
      if (fid) {
        const v = st.dia.rutas.find((x) => x.r.id === fid), s = posicion(v, st.t);
        tip.innerHTML = `<b>${fid}</b><span>${esc(municipios(v.r).join(", "))}</span><br>${ESTADO[s.estado]} · ${n0(v.r.paquetes)} paquetes`;
        const r = cv.getBoundingClientRect();
        tip.hidden = false;
        tip.style.left = Math.min(ev.clientX - r.left + 14, st.w - tip.offsetWidth - 8) + "px";
        tip.style.top = Math.min(ev.clientY - r.top + 14, st.h - tip.offsetHeight - 8) + "px";
        return;
      }
      const i = zonaEn(ev);
      if (i !== st.hover) { st.hover = i; pintarZona(); dibujar(); }
      if (i == null) { tip.hidden = true; return; }
      if (i === "otra") {
        const o = st.base.otra_estacion;
        tip.innerHTML = `<b>${esc(o.zona)}</b><span>Lo reparte una estación de ${esc(o.estacion)}, no la nuestra.</span>`;
      } else {
        const z = st.base.zonas[i], v = valorZona(i), E = escala(), m = METRICAS[st.modo].find((x) => x.id === st.metrica);
        tip.innerHTML = `<b>${esc(z.municipio)}</b><span>${z.cp} · rutas ${z.rutas}</span><br>${m.nombre}: <b style="display:inline">${v == null ? "—" : E.fmt(v)}</b>`;
      }
      const r = cv.getBoundingClientRect();
      tip.hidden = false;
      const x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
      tip.style.left = Math.min(x, st.w - tip.offsetWidth - 8) + "px";
      tip.style.top = Math.min(y, st.h - tip.offsetHeight - 8) + "px";
    });
    cv.addEventListener("mouseleave", () => { st.hover = null; $("mp-tip").hidden = true; pintarZona(); dibujar(); });
    cv.addEventListener("click", (ev) => {
      const fid = furgonetaBajo(ev);
      if (st.arrastre) { st.arrastre = false; return; }
      if (fid) { elegirRuta(fid === st.ruta ? null : fid); return; }
      const i = zonaEn(ev);
      st.sel = i === st.sel || i === "otra" ? null : i; pintarZona(); dibujar();
    });
    // zoom: botones, doble clic, pellizco del trackpad (Ctrl + rueda) y arrastrar para moverse
    $("mp-zoom-in").addEventListener("click", () => zoomEn(st.zoom * 2));
    $("mp-zoom-out").addEventListener("click", () => { st.siguiendo = false; zoomEn(st.zoom / 2); });
    $("mp-zoom-fit").addEventListener("click", () => { st.siguiendo = false; zoomEn(1); });
    cv.addEventListener("dblclick", (ev) => { const r = cv.getBoundingClientRect(); st.siguiendo = false; zoomEn(st.zoom * 2, ev.clientX - r.left, ev.clientY - r.top); });
    cv.addEventListener("wheel", (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      const r = cv.getBoundingClientRect();
      st.siguiendo = false;
      zoomEn(st.zoom * Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });
    let arr = null;
    cv.addEventListener("pointerdown", (ev) => { if (st.zoom > 1) arr = { x: ev.clientX, y: ev.clientY, foco: (st.foco || st.inv(st.w / 2, st.h / 2)).slice(), mov: false }; });
    window.addEventListener("pointermove", (ev) => {
      if (!arr) return;
      const dx = ev.clientX - arr.x, dy = ev.clientY - arr.y;
      if (!arr.mov && Math.hypot(dx, dy) < 5) return;
      arr.mov = true; st.siguiendo = false;
      const s = st.fit.s * st.zoom;
      st.foco = [arr.foco[0] - dx / (KX * s), arr.foco[1] + dy / s];
      vista(); dibujar();
    });
    window.addEventListener("pointerup", () => { if (arr && arr.mov) st.arrastre = true; arr = null; });
    let resize = null;
    window.addEventListener("resize", () => { clearTimeout(resize); resize = setTimeout(() => { medir(); dibujar(); }, 120); });
  }

  function botonSimular() {
    $("mp-play").textContent = st.simulando ? "❚❚ Pausa" : "▶ Simular";
    $("mp-play").setAttribute("aria-pressed", String(st.simulando));
  }

  // El bucle: el reloj del día avanza st.velocidad minutos por segundo
  let antes = null;
  function bucle(ahora) {
    if (antes != null && st.simulando && st.modo === "dia" && st.dia) {
      st.t = Math.min(st.dia.fin, st.t + ((ahora - antes) / 1000) * st.velocidad);
      if (st.t >= st.dia.fin) { st.simulando = false; botonSimular(); }
      $("mp-time").value = Math.round(st.t);
      $("mp-clock").textContent = R.reloj(st.t);
      avanzar(); pintarPanel(); dibujar();
    }
    antes = ahora;
    requestAnimationFrame(bucle);
    if (new URLSearchParams(location.search).get("tour") === "1") tour.start();
  }

  // ── Viene de DS Flow: ?desde=dsflow&turno=...&paquetes=...&retraso=... ──
  function leerUrl() {
    const q = new URLSearchParams(location.search);
    const num = (k) => (q.has(k) && q.get(k) !== "" && isFinite(+q.get(k)) ? +q.get(k) : null);
    for (const c of R.CONDICIONES) { const v = num(c.id); if (v != null) st.cond[c.id] = clamp(v, c.min, c.max); }
    const esc0 = q.get("escenario");
    if (esc0) { const e = R.ESCENARIOS.find((x) => x.id === esc0); if (e) { st.escenario = e.id; st.cond = { ...st.cond, ...e.condiciones }; } }
    // retraso de cada oleada tal como salió en DS Flow (minutos, separados por comas)
    if (q.get("oleadas")) {
      const r = q.get("oleadas").split(",").map((x) => (x !== "" && isFinite(+x) ? clamp(+x, 0, 120) : null));
      if (r.length === R.OLEADAS.length) st.retrasos = r;
    }
    const paq = num("paquetes");
    if (paq != null) st.cond.volumen = clamp(paq / R.P.paquetes, 0.5, 1.8);
    if (q.get("desde") === "dsflow") {
      st.escenario = null;
      st.desde = { cond: { volumen: st.cond.volumen, retraso: st.cond.retraso } };
      const turno = q.get("turno") || "DS Flow";
      const partes = [];
      if (paq != null) partes.push(`salieron ${n0(paq)} paquetes en furgoneta${paq / R.P.paquetes < 0.5 ? ` (el mapa empieza en ${n0(R.P.paquetes * 0.5)})` : ""}`);
      const tarde = (st.retrasos || []).map((r, k) => [k + 1, r]).filter(([, r]) => r > 0);
      partes.push(tarde.length ? `${tarde.length === 1 ? "la oleada" : "las oleadas"} ${tarde.map(([k, r]) => `${k} (${Math.round(r)} min)`).join(", ")} salieron tarde`
        : st.cond.retraso > 0 ? `las oleadas salieron con ${Math.round(st.cond.retraso)} min de retraso de media` : "las oleadas salieron a su hora");
      const roll = num("rollover");
      if (roll) partes.push(`${n0(roll)} paquetes se quedaron en la estación`);
      $("mp-from").innerHTML = `Viene del turno <b>${esc(turno)}</b> de <a href="../">DS Flow</a>: ${partes.join(", ")}. Aquí salen las furgonetas a la hora en que las despachó la estación; añade lluvia, flash flood o huelga para ver qué pasaría.`;
      $("mp-from").hidden = false;
    }
    if (q.get("modo") === "dia") { st.modo = "dia"; st.metrica = METRICAS.dia[0].id; }
  }

  // ── Tour guiado (los pasos están en tour-mapa.js; el motor del tour es el de DS Flow) ──
  const tour = DSTour.create({
    escenario: ponerEscenario,
    modo: (m) => { if (st.modo !== m) ponerModo(m); },
    res: () => st.res,
    porQue: () => st.ia.explicar(st.cond, { familias: familias() }),
    peorZona: () => {
      const i = st.pred.reduce((b, z, k) => (z.activa && (b == null || z.p10 < st.pred[b].p10) ? k : b), null);
      st.sel = i; pintarZona(); dibujar();
      return { ...st.base.zonas[i], p10: st.pred[i].p10 };
    },
    otra: () => st.base.otra_estacion,
    // el turno ya terminado, para enseñar cómo le ha ido a la flota
    alFinal: () => { st.simulando = false; botonSimular(); st.t = st.dia.fin; $("mp-time").value = st.t; $("mp-clock").textContent = R.reloj(st.t); avanzar(); pintarPanel(); dibujar(); },
    flota: () => st.dia.res.kpis.total.flota,
    dsflow: () => { location.href = document.querySelector(".ds-back").href; },
    pct: (v) => pct(v),
  }, DSMapaTour.STEPS);

  async function iniciar() {
    $("ds-theme").textContent = document.documentElement.dataset.theme === "light" ? "☾" : "☀";
    try {
      const [base, modelo] = await Promise.all([
        fetch("data/cadiz-base.json").then((r) => r.json()),
        fetch("data/modelo.json").then((r) => r.json()),
      ]);
      st.base = base;
      st.ia = M.crear(base, modelo);
      st.tramos = Object.fromEntries(base.carreteras.map((t) => [t.id, t]));
      st.idx = new Map(base.zonas.map((z, i) => [z.id, i]));
    } catch (e) {
      $("mp-loading").textContent = "No se pudo cargar el mapa. Si lo abres como archivo, sírvelo con python3 -m http.server.";
      return;
    }
    leerUrl();
    paleta();
    medir();
    pintarControles();
    enlazar();
    if (st.modo === "dia") {
      document.querySelectorAll(".mp-seg [data-mode]").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.mode === "dia")));
      $("mp-day").hidden = false; st.simulando = true;
    }
    actualizar();
    botonSimular();
    $("mp-loading").hidden = true;
    requestAnimationFrame(bucle);
  }

  iniciar();
})();
