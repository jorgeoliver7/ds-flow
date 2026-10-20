// Interfaz del mapa de reparto de Cádiz: mapa de calor en Canvas, panel de
// condiciones, previsión de la IA con su explicación y el día jugado con las
// furgonetas en movimiento.
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
    "La Línea de la Concepción": "La Línea", "Arcos de la Frontera": "Arcos", "Vejer de la Frontera": "Vejer", "Medina Sidonia": "Medina",
  };
  const ETIQUETAS = ["Jerez de la Frontera", "Cádiz", "Algeciras", "San Fernando", "El Puerto de Santa María", "Chiclana de la Frontera", "Sanlúcar de Barrameda",
    "La Línea de la Concepción", "Arcos de la Frontera", "Ubrique", "Tarifa", "Olvera", "Medina Sidonia", "Vejer de la Frontera", "Grazalema"];
  // en pantallas estrechas, solo los que no se pisan
  const ETIQUETAS_SM = ["Jerez de la Frontera", "Cádiz", "Algeciras", "Sanlúcar de Barrameda", "Arcos de la Frontera", "Ubrique", "Tarifa", "Olvera", "Vejer de la Frontera"];

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
    pred: null, res: null, sel: null, hover: null, dia: null, t: 390, jugando: false, semilla: 1, velocidad: 15,
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
    const ox = (w - gw * s) / 2, oy = (h - gh * s) / 2;
    st.w = w; st.h = h; st.dpr = dpr;
    st.proj = (lon, lat) => [ox + (lon - BB.minX) * KX * s, oy + (BB.maxY - lat) * s];
    st.escalaPx = s;
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
    st.provincia = path(st.base.provincia);
  }

  function dibujar() {
    if (!st.base) return;
    const cv = $("mp-map"), ctx = cv.getContext("2d");
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.fillStyle = rgb(PAL.floor);
    ctx.fillRect(0, 0, st.w, st.h);
    // alrededores
    ctx.fillStyle = rgb(mix(PAL.zona, PAL.floor, 0.35));
    ctx.strokeStyle = PAL.line; ctx.lineWidth = 1;
    for (const c of st.contexto) { ctx.fill(c.path, "evenodd"); ctx.stroke(c.path); }
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
    ctx.strokeStyle = rgb(PAL.floor); ctx.lineWidth = 0.6;
    st.paths.forEach((p) => ctx.stroke(p));
    ctx.strokeStyle = PAL.muted; ctx.lineWidth = 1.2; ctx.stroke(st.provincia);

    carreteras(ctx);
    if (st.modo === "dia" && st.dia) furgonetas(ctx);

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
      if (i == null) continue;
      ctx.strokeStyle = PAL.fg; ctx.lineWidth = w; ctx.stroke(st.paths[i]);
    }
  }

  function halo(ctx, txt, x, y) {
    ctx.lineWidth = 3; ctx.strokeStyle = rgb(PAL.floor, 0.75); ctx.lineJoin = "round";
    ctx.strokeText(txt, x, y); ctx.fillStyle = PAL.fg; ctx.fillText(txt, x, y);
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

  // ── El día jugado ───────────────────────────────────
  function km(a, b) {
    const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
  // Polilínea desde la estación siguiendo los tramos (cada tramo se orienta según el nodo en que estamos)
  function polilinea(tramos, fin) {
    const T = st.tramos, e = st.base.estacion;
    let nodo = e.id;
    const p = [[e.lon, e.lat]];
    for (const id of tramos) {
      const t = T[id];
      if (t.desde === nodo) { p.push(t.coords[1]); nodo = t.hasta; } else { p.push(t.coords[0]); nodo = t.desde; }
    }
    if (fin) p.push(fin);
    const acum = [0];
    for (let i = 1; i < p.length; i++) acum.push(acum[i - 1] + km(p[i - 1], p[i]));
    return { p, acum, total: acum[acum.length - 1] };
  }
  function punto(pl, f) {
    if (pl.total <= 0) return pl.p[pl.p.length - 1];
    const d = clamp(f, 0, 1) * pl.total;
    let i = 1;
    while (i < pl.acum.length - 1 && pl.acum[i] < d) i++;
    const k = (d - pl.acum[i - 1]) / Math.max(1e-9, pl.acum[i] - pl.acum[i - 1]);
    return [pl.p[i - 1][0] + (pl.p[i][0] - pl.p[i - 1][0]) * k, pl.p[i - 1][1] + (pl.p[i][1] - pl.p[i - 1][1]) * k];
  }

  function jugarDia() {
    const res = R.simular(st.base, st.cond, { seed: st.semilla, familias: familias() });
    const centro = new Map(st.base.zonas.map((z) => [z.id, z.centro]));
    const rutas = res.rutas.map((r, k) => {
      const primera = r.partes.length ? centro.get(r.partes[0].zona) : centro.get(r.zonas[0]);
      const ultima = r.partes.length ? centro.get(r.partes[r.partes.length - 1].zona) : primera;
      const vuelta = polilinea(r.caminoVuelta, ultima);
      // la vuelta se recorre al revés
      vuelta.p.reverse(); const tot = vuelta.total; vuelta.acum = vuelta.acum.map((x) => tot - x).reverse();
      return { r, k, ida: polilinea(r.camino, primera), vuelta };
    });
    const fin = Math.max(...res.rutas.map((r) => r.vuelta || 0), 900);
    st.dia = { res, rutas, fin: Math.min(1260, Math.ceil(fin / 10) * 10), avance: [] };
    st.t = Math.min(...res.rutas.map((r) => r.salida), 400) - 10;
    $("mp-time").min = Math.round(st.t); $("mp-time").max = st.dia.fin;
    $("mp-time").value = Math.round(st.t); $("mp-clock").textContent = R.reloj(st.t);
    avanzar();
  }

  // Estado de cada zona y de cada furgoneta a la hora st.t
  function avanzar() {
    const D = st.dia, t = st.t, idx = st.idx;
    const av = st.base.zonas.map((z, i) => ({ paquetes: D.res.zonas[i].paquetes, entregados: 0, fallidos: 0, rts: 0 }));
    let calle = 0;
    for (const { r } of D.rutas) {
      if (t >= r.salida && t < r.vuelta) calle++;
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
    D.calle = calle;
  }

  function furgonetas(ctx) {
    const D = st.dia, t = st.t, cols = { DQX1: PAL.a, EQX1: PAL.c };
    const centro = new Map(st.base.zonas.map((z) => [z.id, z.centro]));
    for (const v of D.rutas) {
      const r = v.r;
      if (t < r.salida || t >= r.vuelta || !r.partes.length) continue;
      let pos;
      if (t < r.llegada) pos = punto(v.ida, (t - r.salida) / Math.max(1, r.llegada - r.salida));
      else if (t >= r.inicioVuelta) pos = punto(v.vuelta, (t - r.inicioVuelta) / Math.max(1, r.vuelta - r.inicioVuelta));
      else {
        // en reparto: da vueltas por su zona; entre dos zonas, va de una a otra
        let k = r.partes.findIndex((p) => t < p.fin);
        if (k < 0) k = r.partes.length - 1;
        const p = r.partes[k], c = centro.get(p.zona);
        if (t < p.inicio && k > 0) {
          const prev = r.partes[k - 1], c0 = centro.get(prev.zona), f = (t - prev.fin) / Math.max(1, p.inicio - prev.fin);
          pos = [c0[0] + (c[0] - c0[0]) * f, c0[1] + (c[1] - c0[1]) * f];
        } else {
          const ang = t / 9 + v.k * 2.4, rad = 0.012 + (v.k % 5) * 0.003;
          pos = [c[0] + Math.cos(ang) * rad, c[1] + Math.sin(ang) * rad * 0.8];
        }
      }
      const [x, y] = st.proj(pos[0], pos[1]);
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, 7);
      ctx.fillStyle = cols[r.familia]; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = rgb(PAL.floor); ctx.stroke();
    }
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
        kpi("Hora", R.reloj(st.t), fin ? "día terminado" : `${D.calle} furgonetas en la calle`),
        kpi("Entregados", n0(ent), `${pct(paq ? ent / paq : 0)} de ${n0(paq)}`, fin ? clase(ent / paq) : ""),
        kpi("Fallidos", n0(s("fallidos")), "se reintentan mañana"),
        kpi("Devueltos", n0(s("rts")), "vuelven a la estación"),
        kpi("Tramos cortados", String(D.res.cortados.length), D.res.cortados.length ? "por el flash flood" : "carreteras abiertas", D.res.cortados.length ? "is-bad" : ""),
        kpi("La IA preveía", pct(iaR.entrega), fin ? `hoy ${pct(paq ? ent / paq : 0)}` : "al acabar el día"),
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
    pintarPorQue();
    pintarRecos();
    pintarZona();
    pintarLeyenda();
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
      const peores = st.pred.filter((z) => z.activa).sort((a, b) => a.p10 - b.p10).slice(0, 3)
        .map((z) => { const zz = st.base.zonas[st.idx.get(z.id)]; return `${zz.municipio} (${zz.cp})`; });
      recos.push(["bad", `Zonas más expuestas al flash flood: ${peores.join(", ")}. Conviene avisar a los clientes y no cargar ahí paquetes con hora.`]);
    }
    if (st.fam === "todas" && st.res.EQX1.paquetes && st.res.DQX1.paquetes && st.res.EQX1.entrega < st.res.DQX1.entrega - 0.04) {
      recos.push(["warn", `EQX1 sufre más (${pct(st.res.EQX1.entrega)} frente a ${pct(st.res.DQX1.entrega)}): sus rutas pasan más de una hora en carretera antes de la primera entrega.`]);
    }
    $("mp-reco").innerHTML = recos.map(([k, t]) => `<li class="${k === "ok" ? "" : "is-" + k}">${t}</li>`).join("");
  }

  function pintarZona() {
    const i = st.sel != null ? st.sel : st.hover;
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
      ? `<span><i class="mp-van" style="background:${PAL.a}"></i>DQX1</span><span><i class="mp-van" style="background:${PAL.c}"></i>EQX1</span><span><i class="mp-cut"></i>Tramo cortado</span>`
      : st.cond.inundacion > 0 ? `<span><i class="mp-flood"></i>Riesgo de corte (más grueso, más probable)</span>` : "";
    $("mp-legend").innerHTML = `<span>${m.nombre}</span><span class="mp-ramp-lbl">${E.fmt(E.min)}</span><i class="mp-ramp" style="background:${grad}"></i><span class="mp-ramp-lbl">${E.fmt(E.max)}</span><span>■ Estación</span>${extra}`;
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
    if (st.modo === "dia" && !opts.mantenerDia) { jugarDia(); }
    pintarPanel();
    dibujar();
  }

  function enlazar() {
    $("mp-scenarios").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-esc]"); if (!b) return;
      const e = R.ESCENARIOS.find((x) => x.id === b.dataset.esc);
      st.escenario = e.id; st.cond = { ...R.NORMAL, ...e.condiciones };
      if (st.desde && st.desde.cond) st.cond = { ...st.cond, volumen: st.desde.cond.volumen, retraso: Math.max(st.cond.retraso, st.desde.cond.retraso) };
      st.jugando = false; pintarControles(); actualizar(); botonJugar();
    });
    $("mp-sliders").addEventListener("input", (ev) => {
      const inp = ev.target; if (inp.type !== "range") return;
      const id = inp.id.replace("mp-c-", ""), c = R.CONDICIONES.find((x) => x.id === id);
      st.cond[id] = +inp.value;
      $("mp-o-" + id).textContent = c.formato(st.cond[id]);
      inp.parentElement.classList.toggle("is-on", st.cond[id] !== R.NORMAL[id]);
      st.escenario = null;
      document.querySelectorAll("#mp-scenarios button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      st.jugando = false; botonJugar();
      actualizar();
    });
    document.querySelectorAll(".mp-seg [data-mode]").forEach((b) => b.addEventListener("click", () => {
      st.modo = b.dataset.mode;
      document.querySelectorAll(".mp-seg [data-mode]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      st.metrica = METRICAS[st.modo][0].id;
      $("mp-day").hidden = st.modo !== "dia";
      st.jugando = st.modo === "dia";
      pintarControles(); actualizar(); botonJugar();
    }));
    $("mp-fam").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-fam]"); if (!b) return;
      st.fam = b.dataset.fam;
      document.querySelectorAll("#mp-fam button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      actualizar();
    });
    $("mp-metric").addEventListener("change", (ev) => { st.metrica = ev.target.value; pintarLeyenda(); dibujar(); });
    $("mp-play").addEventListener("click", () => {
      if (!st.jugando && st.t >= st.dia.fin - 1) { st.t = +$("mp-time").min; avanzar(); }
      st.jugando = !st.jugando; botonJugar();
    });
    $("mp-other").addEventListener("click", () => { st.semilla++; jugarDia(); st.jugando = true; botonJugar(); pintarPanel(); dibujar(); });
    $("mp-speed").addEventListener("change", (ev) => { st.velocidad = +ev.target.value; });
    $("mp-time").addEventListener("input", (ev) => { st.t = +ev.target.value; st.jugando = false; botonJugar(); $("mp-clock").textContent = R.reloj(st.t); avanzar(); pintarPanel(); dibujar(); });
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
      return null;
    };
    cv.addEventListener("mousemove", (ev) => {
      const i = zonaEn(ev);
      if (i !== st.hover) { st.hover = i; pintarZona(); dibujar(); }
      const tip = $("mp-tip");
      if (i == null) { tip.hidden = true; return; }
      const z = st.base.zonas[i], v = valorZona(i), E = escala(), m = METRICAS[st.modo].find((x) => x.id === st.metrica);
      tip.innerHTML = `<b>${esc(z.municipio)}</b><span>${z.cp} · rutas ${z.rutas}</span><br>${m.nombre}: <b style="display:inline">${v == null ? "—" : E.fmt(v)}</b>`;
      const r = cv.getBoundingClientRect();
      tip.hidden = false;
      const x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
      tip.style.left = Math.min(x, st.w - tip.offsetWidth - 8) + "px";
      tip.style.top = Math.min(y, st.h - tip.offsetHeight - 8) + "px";
    });
    cv.addEventListener("mouseleave", () => { st.hover = null; $("mp-tip").hidden = true; pintarZona(); dibujar(); });
    cv.addEventListener("click", (ev) => { const i = zonaEn(ev); st.sel = i === st.sel ? null : i; pintarZona(); dibujar(); });
    let resize = null;
    window.addEventListener("resize", () => { clearTimeout(resize); resize = setTimeout(() => { medir(); dibujar(); }, 120); });
  }

  function botonJugar() {
    $("mp-play").textContent = st.jugando ? "❚❚ Pausa" : "▶ Jugar";
    $("mp-play").setAttribute("aria-pressed", String(st.jugando));
  }

  // El bucle: el reloj del día avanza st.velocidad minutos por segundo
  let antes = null;
  function bucle(ahora) {
    if (antes != null && st.jugando && st.modo === "dia" && st.dia) {
      st.t = Math.min(st.dia.fin, st.t + ((ahora - antes) / 1000) * st.velocidad);
      if (st.t >= st.dia.fin) { st.jugando = false; botonJugar(); }
      $("mp-time").value = Math.round(st.t);
      $("mp-clock").textContent = R.reloj(st.t);
      avanzar(); pintarPanel(); dibujar();
    }
    antes = ahora;
    requestAnimationFrame(bucle);
  }

  // ── Viene de DS Flow: ?desde=dsflow&turno=...&paquetes=...&retraso=... ──
  function leerUrl() {
    const q = new URLSearchParams(location.search);
    const num = (k) => (q.has(k) && q.get(k) !== "" && isFinite(+q.get(k)) ? +q.get(k) : null);
    for (const c of R.CONDICIONES) { const v = num(c.id); if (v != null) st.cond[c.id] = clamp(v, c.min, c.max); }
    const esc0 = q.get("escenario");
    if (esc0) { const e = R.ESCENARIOS.find((x) => x.id === esc0); if (e) { st.escenario = e.id; st.cond = { ...st.cond, ...e.condiciones }; } }
    const paq = num("paquetes");
    if (paq != null) st.cond.volumen = clamp(paq / R.P.paquetes, 0.5, 1.8);
    if (q.get("desde") === "dsflow") {
      st.escenario = null;
      st.desde = { cond: { volumen: st.cond.volumen, retraso: st.cond.retraso } };
      const turno = q.get("turno") || "DS Flow";
      const partes = [];
      if (paq != null) partes.push(`salieron ${n0(paq)} paquetes en furgoneta${paq / R.P.paquetes < 0.5 ? ` (el mapa empieza en ${n0(R.P.paquetes * 0.5)})` : ""}`);
      partes.push(st.cond.retraso > 0 ? `las oleadas salieron con ${Math.round(st.cond.retraso)} min de retraso de media` : "las oleadas salieron a su hora");
      const roll = num("rollover");
      if (roll) partes.push(`${n0(roll)} paquetes se quedaron en la estación`);
      $("mp-from").innerHTML = `Viene del turno <b>${esc(turno)}</b> de <a href="../">DS Flow</a>: ${partes.join(", ")}. Así sigue el día en la calle; añade lluvia, flash flood o huelga para ver qué pasaría.`;
      $("mp-from").hidden = false;
    }
    if (q.get("modo") === "dia") { st.modo = "dia"; st.metrica = METRICAS.dia[0].id; }
  }

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
      $("mp-day").hidden = false; st.jugando = true;
    }
    actualizar();
    botonJugar();
    $("mp-loading").hidden = true;
    requestAnimationFrame(bucle);
  }

  iniciar();
})();
