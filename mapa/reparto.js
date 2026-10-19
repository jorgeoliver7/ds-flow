// Motor del reparto en la provincia de Cádiz: lo que pasa después de la estación.
// Con la base geográfica (mapa/data/cadiz-base.json) y unas condiciones (volumen,
// lluvia, inundación, huelga...) planifica las rutas DQX1 y EQX1 del día y las
// juega en la calle. No toca el DOM, así que se prueba en Node (ver test/).
(function (root) {
  "use strict";

  // Generador pseudoaleatorio con semilla (mulberry32), el mismo que el de la estación
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Ruido multiplicativo centrado en 1 (aprox. lognormal)
  const ruido = (rand, sigma) => Math.exp(sigma * (rand() + rand() + rand() - 1.5) * 2);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Parámetros del reparto. Valores de ejemplo, redondeados y verosímiles: no son
  // datos de ninguna empresa.
  const P = {
    // lo que sale de la estación de DS Flow en una noche normal: 120 rutas, 80 EQX1
    // (pasillos A y B, oleadas de 06:30 a 07:15) y 40 DQX1 (pasillo C, 07:30 y 07:45)
    paquetes: 26000,
    familias: {
      EQX1: { rutas: 80, oleadas: ["06:30", "06:45", "07:00", "07:15"] },
      DQX1: { rutas: 40, oleadas: ["07:30", "07:45"] },
    },
    carga: 10,             // minutos desde la oleada hasta que la furgoneta arranca
    jornada: 600,          // bloque del conductor: de su oleada a volver a la estación (10 h),
                           // así que si la estación sale tarde, el retraso se come la jornada
    planificada: 0.85,     // las rutas se planifican para usar este tanto de la jornada
    // por tipo de zona: paquetes por parada, minutos por parada (bajar, entregar,
    // volver), velocidad entre paradas, peso de compra online y fallos de entrega
    zona: {
      urbana:     { pps: 1.5, servicio: 2.0, kmh: 18, compra: 1.0, fallo: 0.015 },
      periurbana: { pps: 1.3, servicio: 1.7, kmh: 28, compra: 1.05, fallo: 0.018 },
      rural:      { pps: 1.15, servicio: 1.5, kmh: 40, compra: 0.85, fallo: 0.025 },
    },
    // velocidad por tipo de vía y cuánto la frena la lluvia fuerte
    vias: {
      autovia:  { kmh: 100, lluvia: 0.12 },
      nacional: { kmh: 70, lluvia: 0.15 },
      comarcal: { kmh: 60, lluvia: 0.18 },
      sierra:   { kmh: 45, lluvia: 0.22 },
    },
    saltoKmh: 50,          // entre dos zonas de la misma ruta
    rodeoSalto: 1.3,
    lluviaParada: 0.15,    // con lluvia fuerte cada parada tarda un 15% más
    lluviaFallo: 0.02,     // y fallan más entregas
    corteTramo: 0.4,       // probabilidad de corte de un tramo inundable con inundación máxima
    corteAutovia: 0.35,    // las autovías van elevadas: se cortan mucho menos
    zonaInundada: 0.3,     // parte de una zona de riesgo alto que queda sin acceso con inundación máxima
    coste: { hora: 20, km: 0.28 },  // conductor y furgoneta, de ejemplo
    co2km: 0.2,            // kg de CO2 por km de furgoneta diésel
  };

  // Condiciones del día. Todas a cero (o a 1 el volumen) es un día normal.
  const NORMAL = { volumen: 1, lluvia: 0, inundacion: 0, huelga: 0, refuerzo: 0, retraso: 0 };
  const CONDICIONES = [
    { id: "volumen", nombre: "Volumen", min: 0.5, max: 1.8, paso: 0.05, formato: (v) => `${Math.round(v * 100)}%` },
    { id: "lluvia", nombre: "Lluvia", min: 0, max: 1, paso: 0.05, formato: (v) => (v < 0.05 ? "sin lluvia" : v < 0.4 ? "débil" : v < 0.75 ? "moderada" : "fuerte") },
    { id: "inundacion", nombre: "Flash flood", min: 0, max: 1, paso: 0.05, formato: (v) => (v < 0.05 ? "no" : `${Math.round(v * 100)}%`) },
    { id: "huelga", nombre: "Huelga de repartidores", min: 0, max: 0.6, paso: 0.05, formato: (v) => `${Math.round(v * 100)}% sin salir` },
    { id: "refuerzo", nombre: "Furgonetas de refuerzo", min: 0, max: 0.3, paso: 0.05, formato: (v) => `+${Math.round(v * 100)}%` },
    { id: "retraso", nombre: "Retraso de salida", min: 0, max: 120, paso: 5, formato: (v) => `${Math.round(v)} min` },
  ];
  const ESCENARIOS = [
    { id: "normal", nombre: "Día normal", condiciones: {} },
    { id: "lluvia", nombre: "Lluvia fuerte", condiciones: { lluvia: 0.9 } },
    { id: "flood", nombre: "Flash flood", condiciones: { lluvia: 1, inundacion: 0.8 } },
    { id: "huelga", nombre: "Huelga", condiciones: { huelga: 0.35 } },
    { id: "blackfriday", nombre: "Black Friday", condiciones: { volumen: 1.45, refuerzo: 0.2 } },
    { id: "tormenta-bf", nombre: "Black Friday con temporal", condiciones: { volumen: 1.45, refuerzo: 0.2, lluvia: 0.8, inundacion: 0.4 } },
    { id: "retraso", nombre: "La estación sale tarde", condiciones: { retraso: 75 } },
  ];

  const hhmm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const reloj = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

  function km(a, b) {
    const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }

  // Índices que no cambian con las condiciones: se calculan una vez por base
  function preparar(base) {
    if (base._prep) return base._prep;
    const est = base.estacion, nodoEst = est.id;
    const munis = new Map(base.municipios.map((m) => [m.nombre, m]));
    const lluviaRel = new Map();
    base.zonas.forEach((z) => lluviaRel.set(z.municipio, z.lluvia_relativa));
    // los nodos que no son municipios (estación, pueblos de paso) toman la lluvia de su vecino
    const vecinos = new Map();
    const add = (n, t) => { if (!vecinos.has(n)) vecinos.set(n, []); vecinos.get(n).push(t); };
    base.carreteras.forEach((t) => { add(t.desde, t); add(t.hasta, t); });
    const lluviaNodo = (n) => lluviaRel.get(n) ?? Math.max(...vecinos.get(n).map((t) => lluviaRel.get(t.desde === n ? t.hasta : t.desde) ?? 1));
    const tramos = base.carreteras.map((t) => ({ ...t, lluviaRel: (lluviaNodo(t.desde) + lluviaNodo(t.hasta)) / 2 }));
    const centroEst = [est.lon, est.lat];
    const zonas = base.zonas.map((z, i) => {
      const tipo = P.zona[z.clase];
      const pueblo = munis.get(z.municipio).pueblo;
      const dx = (z.centro[0] - centroEst[0]) * Math.cos((est.lat * Math.PI) / 180), dy = z.centro[1] - centroEst[1];
      return {
        i, z, tipo, pueblo,
        angulo: Math.atan2(dy, dx),
        localKm: km(pueblo, z.centro) * 1.35,
        peso: z.poblacion * tipo.compra,
      };
    });
    const comarcas = [...new Set(base.zonas.map((z) => z.comarca))];
    base._prep = { est, nodoEst, centroEst, tramos, zonas, comarcas, nodos: [...vecinos.keys()] };
    return base._prep;
  }

  // Camino más rápido desde la estación (Dijkstra) con los tramos cortados fuera
  function caminos(prep, minutosTramo, cortados) {
    const ady = new Map();
    prep.tramos.forEach((t, k) => {
      if (cortados.has(t.id)) return;
      for (const [a, b] of [[t.desde, t.hasta], [t.hasta, t.desde]]) {
        if (!ady.has(a)) ady.set(a, []);
        ady.get(a).push([b, k]);
      }
    });
    const mejor = new Map([[prep.nodoEst, { min: 0, km: 0, tramos: [] }]]);
    const cola = [[0, prep.nodoEst]];
    while (cola.length) {
      cola.sort((a, b) => a[0] - b[0]);
      const [t, n] = cola.shift();
      if (t > mejor.get(n).min) continue;
      for (const [m, k] of ady.get(n) || []) {
        const nt = t + minutosTramo[k];
        if (!mejor.has(m) || nt < mejor.get(m).min) {
          mejor.set(m, { min: nt, km: mejor.get(n).km + prep.tramos[k].km, tramos: [...mejor.get(n).tramos, prep.tramos[k].id] });
          cola.push([nt, m]);
        }
      }
    }
    return mejor;
  }

  // Minutos de calle de una parte de zona: paradas por tiempo de parada más el
  // recorrido entre paradas (aprox. del viajante: 0,75·√(n·A))
  function minutosPorParada(zp, area, paradas, lluvia) {
    if (paradas <= 0) return 0;
    const drive = (0.75 * Math.sqrt(area / paradas)) / (zp.tipo.kmh * (1 - 0.15 * lluvia)) * 60;
    return zp.tipo.servicio * (1 + P.lluviaParada * lluvia) + drive;
  }

  // Planificación por barrido: se ordenan las zonas por ángulo desde la estación y
  // se cortan en rutas que caben en la jornada planificada, contando la ida y la
  // vuelta. Con n rutas, busca la carga por ruta que las reparte todas.
  function planificar(prep, familia, paquetesZona, n, accesoNormal) {
    const zs = prep.zonas.filter((zp) => zp.z.rutas === familia && paquetesZona[zp.i] > 0)
      .sort((a, b) => a.angulo - b.angulo || a.z.acceso.min - b.z.acceso.min);
    if (!zs.length || n <= 0) return [];
    const trabajo = zs.map((zp) => {
      const paradas = paquetesZona[zp.i] / zp.tipo.pps;
      return paradas * minutosPorParada(zp, zp.z.area_km2, paradas, 0);
    });
    const corta = (jornada) => {
      const rutas = [];
      let actual = null;
      zs.forEach((zp, k) => {
        let resto = 1;
        while (resto > 1e-9) {
          if (!actual) {
            const ida = accesoNormal(zp);
            actual = { partes: [], libre: Math.max(30, jornada - 2 * ida) };
            rutas.push(actual);
          }
          const necesita = trabajo[k] * resto;
          if (necesita <= actual.libre + 1e-9) {
            actual.partes.push({ zp, frac: resto, desde: 1 - resto });
            actual.libre -= necesita;
            resto = 0;
          } else {
            const frac = actual.libre / trabajo[k];
            if (frac > 0.02) { actual.partes.push({ zp, frac, desde: 1 - resto }); resto -= frac; }
            actual = null;
          }
        }
      });
      return rutas;
    };
    // la jornada planificada que da exactamente n rutas (búsqueda binaria)
    let lo = 60, hi = 5000;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (corta(mid).length > n) lo = mid; else hi = mid;
    }
    const rutas = corta(hi);
    return rutas.map((r, k) => ({ familia, n: k + 1, partes: r.partes, plan: hi }));
  }

  // Juega un día de reparto. opts: { seed, familias: ["DQX1","EQX1"], paquetes, rutas: { EQX1, DQX1 } }
  function simular(base, condiciones, opts = {}) {
    const C = { ...NORMAL, ...condiciones };
    const prep = preparar(base);
    const rand = rng(opts.seed == null ? 1 : opts.seed);
    const familias = opts.familias || Object.keys(P.familias);
    const totalPaq = (opts.paquetes || P.paquetes) * C.volumen;

    // 1. Tiempo del día: lluvia local por comarca (las tormentas no caen igual en todas partes)
    const lluviaComarca = new Map(prep.comarcas.map((c) => [c, ruido(rand, 0.25)]));
    const lluviaZona = (zp) => clamp(C.lluvia * Math.pow(zp.z.lluvia_relativa, 0.6) * lluviaComarca.get(zp.z.comarca), 0, 1.3);
    const lluviaTramo = (t) => clamp(Math.max(C.lluvia, C.inundacion) * Math.pow(t.lluviaRel, 0.6), 0, 1.3);

    // 2. Carreteras: velocidad con lluvia y tramos cortados por la inundación
    const cortados = new Set();
    prep.tramos.forEach((t) => {
      const p = P.corteTramo * Math.pow(C.inundacion, 1.5) * Math.min(1.4, t.lluviaRel) * (t.tipo === "autovia" ? P.corteAutovia : 1);
      if (t.inundable && C.inundacion > 0 && rand() < p) cortados.add(t.id);
    });
    const minTramo = prep.tramos.map((t) => {
      const v = P.vias[t.tipo];
      return (t.km / (v.kmh * (1 - v.lluvia * lluviaTramo(t)))) * 60;
    });
    const minNormal = prep.tramos.map((t) => (t.km / P.vias[t.tipo].kmh) * 60);
    const hoy = caminos(prep, minTramo, cortados);
    const normal = caminos(prep, minNormal, new Set());
    const localMin = (zp, lluvia) => {
      const urb = Math.min(zp.localKm, 3);
      return (urb / (25 * (1 - 0.15 * lluvia)) + (zp.localKm - urb) / (55 * (1 - 0.18 * lluvia))) * 60;
    };
    const accesoNormal = (zp) => normal.get(zp.z.municipio).min + localMin(zp, 0);

    // 3. Paquetes por zona: el volumen de cada familia repartido por población y compra online
    const paquetesZona = new Array(prep.zonas.length).fill(0);
    const totalRutas = Object.values(P.familias).reduce((s, f) => s + f.rutas, 0);
    for (const fam of Object.keys(P.familias)) {
      const zs = prep.zonas.filter((zp) => zp.z.rutas === fam);
      const pesos = zs.map((zp) => zp.peso * ruido(rand, 0.05));
      const sum = pesos.reduce((a, b) => a + b, 0);
      const famPaq = (totalPaq * P.familias[fam].rutas) / totalRutas;
      zs.forEach((zp, k) => (paquetesZona[zp.i] = Math.round((famPaq * pesos[k]) / sum)));
    }

    // 4. Planificación y reparto, familia a familia
    const rutas = [];
    const zonas = prep.zonas.map((zp) => ({
      id: zp.z.id, rutas: zp.z.rutas, paquetes: familias.includes(zp.z.rutas) ? paquetesZona[zp.i] : 0,
      entregados: 0, fallidos: 0, rts: 0, rtsTiempo: 0, rtsInundacion: 0, rtsIncomunicada: 0,
      furgonetas: 0, ultima: null, lluvia: 0, accesoMin: null,
    }));
    zonas.forEach((r, i) => {
      const zp = prep.zonas[i];
      r.lluvia = +lluviaZona(zp).toFixed(2);
      const h = hoy.get(zp.z.municipio);
      r.accesoMin = h ? Math.round(h.min + localMin(zp, r.lluvia)) : null;
    });
    // parte de cada zona de riesgo alto que el agua deja sin acceso hoy
    const inundada = prep.zonas.map((zp) =>
      C.inundacion > 0 && zp.z.riesgo_inundacion >= 2
        ? clamp(P.zonaInundada * C.inundacion * Math.pow(zp.z.riesgo_inundacion / 3, 2) * (0.5 + rand()), 0, 0.9) : 0);

    for (const fam of familias) {
      const F = P.familias[fam];
      const n = Math.max(0, Math.round(F.rutas * (1 + C.refuerzo) * (1 - C.huelga)));
      const plan = planificar(prep, fam, paquetesZona, n, accesoNormal);
      // si no hay furgonetas para la familia, todo vuelve a la estación
      if (!plan.length) prep.zonas.forEach((zp, i) => { if (zp.z.rutas === fam) { zonas[i].rts += zonas[i].paquetes; zonas[i].rtsTiempo += zonas[i].paquetes; } });
      plan.forEach((ruta, k) => {
        const oleada = hhmm(F.oleadas[Math.min(F.oleadas.length - 1, Math.floor((k * F.oleadas.length) / plan.length))]);
        const salida = oleada + C.retraso + P.carga;
        const limite = oleada + P.jornada;
        const ritmo = ruido(rand, 0.08);  // el día de este conductor
        let t = salida, kmRuta = 0, pos = null, ultima = null;
        const res = { id: `${fam}-${String(ruta.n).padStart(3, "0")}`, familia: fam, salida, zonas: [], camino: [], paquetes: 0, entregados: 0, fallidos: 0, rts: 0 };
        const primera = ruta.partes[0].zp;
        const ida = hoy.get(primera.z.municipio);
        if (ida) { t += ida.min + localMin(primera, lluviaZona(primera)); kmRuta += ida.km + primera.localKm; res.camino = ida.tramos; }
        for (const { zp, frac, desde } of ruta.partes) {
          const zr = zonas[zp.i];
          // por fracción acumulada, para que las partes de una zona sumen justo sus paquetes
          const paq = Math.round(paquetesZona[zp.i] * Math.min(1, desde + frac)) - Math.round(paquetesZona[zp.i] * desde);
          res.zonas.push(zp.z.id); res.paquetes += paq; zr.furgonetas += 1;
          const acceso = hoy.get(zp.z.municipio);
          if (!acceso || !ida) { zr.rts += paq; zr.rtsIncomunicada += paq; res.rts += paq; continue; }
          const lluvia = lluviaZona(zp);
          if (pos) { const d = km(pos, zp.z.centro) * P.rodeoSalto; kmRuta += d; t += (d / (P.saltoKmh * (1 - 0.18 * lluvia))) * 60; }
          pos = zp.z.centro;
          const rtsInund = Math.round(paq * inundada[zp.i]);
          const resto = paq - rtsInund;
          const paradas = resto / zp.tipo.pps;
          const area = zp.z.area_km2 * frac;
          const porParada = minutosPorParada(zp, area, paradas, lluvia) * ritmo;
          // la vuelta: desde esta zona a la estación, con las carreteras de hoy
          const vuelta = acceso.min + localMin(zp, lluvia);
          const caben = porParada > 0 ? Math.max(0, (limite - vuelta - t) / porParada) : paradas;
          const hechas = Math.min(paradas, caben);
          const intentados = paradas > 0 ? Math.round((resto * hechas) / paradas) : 0;
          const pFallo = clamp((zp.tipo.fallo + P.lluviaFallo * lluvia + 0.03 * C.inundacion * (zp.z.riesgo_inundacion / 3)) * ruido(rand, 0.2), 0, 0.5);
          const fallidos = Math.round(intentados * pFallo);
          t += hechas * porParada;
          kmRuta += 0.75 * Math.sqrt(Math.max(hechas, 0) * area) * 1.3;
          if (hechas > 0) ultima = t;
          zr.entregados += intentados - fallidos; zr.fallidos += fallidos;
          zr.rts += resto - intentados + rtsInund; zr.rtsTiempo += resto - intentados; zr.rtsInundacion += rtsInund;
          if (hechas > 0) zr.ultima = Math.max(zr.ultima || 0, t);
          res.entregados += intentados - fallidos; res.fallidos += fallidos; res.rts += resto - intentados + rtsInund;
        }
        const ultimaZona = ruta.partes[ruta.partes.length - 1].zp;
        const vuelta = hoy.get(ultimaZona.z.municipio);
        if (vuelta && ida) { t += vuelta.min + localMin(ultimaZona, lluviaZona(ultimaZona)); kmRuta += vuelta.km + ultimaZona.localKm; }
        res.vuelta = t; res.ultima = ultima; res.km = +kmRuta.toFixed(1);
        res.horas = (t - salida) / 60;
        res.sobrecargada = res.rts > 0.02 * res.paquetes;
        rutas.push(res);
      });
    }

    // 5. Métricas del día, en total y por familia
    const resumen = (zs, rs) => {
      const s = (k, arr = zs) => arr.reduce((a, x) => a + x[k], 0);
      const paq = s("paquetes"), km = s("km", rs), horas = s("horas", rs);
      return {
        paquetes: paq, entregados: s("entregados"), fallidos: s("fallidos"), rts: s("rts"),
        rtsTiempo: s("rtsTiempo"), rtsInundacion: s("rtsInundacion"), rtsIncomunicada: s("rtsIncomunicada"),
        tasaEntrega: paq ? s("entregados") / paq : 1,
        rutas: rs.length, sobrecargadas: rs.filter((r) => r.sobrecargada).length,
        km: Math.round(km), horas: +horas.toFixed(1),
        coste: Math.round(horas * P.coste.hora + km * P.coste.km),
        costePaquete: s("entregados") ? +((horas * P.coste.hora + km * P.coste.km) / s("entregados")).toFixed(2) : null,
        co2: Math.round(km * P.co2km),
        ultimaMedia: rs.filter((r) => r.ultima).length ? rs.filter((r) => r.ultima).reduce((a, r) => a + r.ultima, 0) / rs.filter((r) => r.ultima).length : null,
      };
    };
    const kpis = { total: resumen(zonas.filter((z) => familias.includes(z.rutas)), rutas) };
    familias.forEach((f) => (kpis[f] = resumen(zonas.filter((z) => z.rutas === f), rutas.filter((r) => r.familia === f))));
    return { condiciones: C, zonas, rutas, cortados: [...cortados], kpis };
  }

  // Rasgos de una zona para el modelo: lo que no cambia con el día
  const RASGOS_ZONA = ["acceso_min", "acceso_km", "log_densidad", "log_area", "poblacion_k", "riesgo", "lluvia_rel", "tramos_inundables", "eqx1"];
  function rasgosZona(base, z) {
    const inund = new Set(base.carreteras.filter((t) => t.inundable).map((t) => t.id));
    return [
      z.acceso.min, z.acceso.km, Math.log10(Math.max(z.densidad, 1)), Math.log10(Math.max(z.area_km2, 0.05)),
      z.poblacion / 1000, z.riesgo_inundacion, z.lluvia_relativa,
      z.acceso.tramos.filter((t) => inund.has(t)).length, z.rutas === "EQX1" ? 1 : 0,
    ];
  }
  const RASGOS_DIA = ["volumen", "lluvia", "inundacion", "huelga", "refuerzo", "retraso"];

  const api = { P, NORMAL, CONDICIONES, ESCENARIOS, RASGOS_ZONA, RASGOS_DIA, rng, preparar, simular, rasgosZona, reloj, hhmm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSReparto = api;
})(typeof window !== "undefined" ? window : globalThis);
