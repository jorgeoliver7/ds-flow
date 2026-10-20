// Modelo de IA del mapa: predice al instante lo que daría el motor de reparto con
// unas condiciones, zona a zona, y explica qué condición pesa más. Los árboles se
// entrenan con mapa/tools/entrenar_modelo.py y llegan en mapa/data/modelo.json.
(function (root) {
  "use strict";
  const DSReparto = typeof module !== "undefined" && module.exports ? require("./reparto.js") : root.DSReparto;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // Suma de árboles en preorden: a la izquierda (n + 1) si x[f] <= t, si no al hijo derecho r
  function predecir(m, x) {
    let s = m.base;
    for (const a of m.arboles) {
      let n = 0;
      while (a.f[n] !== -1) n = x[a.f[n]] <= a.t[n] ? n + 1 : a.r[n];
      s += a.t[n];
    }
    return s;
  }

  function crear(base, modelo) {
    const prep = DSReparto.preparar(base);
    const rasgosZona = base.zonas.map((z) => DSReparto.rasgosZona(base, z));
    // paquetes de cada zona en un día normal (lo mismo que reparte el motor, sin el ruido del día)
    const sumPesos = prep.zonas.reduce((a, zp) => a + zp.peso, 0);
    const peso = new Map(prep.zonas.map((zp) => [zp.z.id, (DSReparto.P.paquetes * zp.peso) / sumPesos]));
    const dia = (c) => DSReparto.RASGOS_DIA.map((k) => (c[k] == null ? DSReparto.NORMAL[k] : c[k]));

    // Predicción por zona: tasa de entrega esperada, la de un día malo (p10) y fallidos
    function zonas(condiciones, opts = {}) {
      const c = { ...DSReparto.NORMAL, ...condiciones }, d = dia(c);
      const familias = opts.familias || Object.keys(DSReparto.P.familias);
      const zs = base.zonas.map((z, i) => {
        const x = rasgosZona[i].concat(d);
        const entrega = clamp01(predecir(modelo.modelos.entrega, x));
        const activa = familias.includes(z.rutas);
        return {
          id: z.id, rutas: z.rutas, activa,
          paquetes: activa ? Math.round(peso.get(z.id) * c.volumen) : 0,
          entrega,
          p10: Math.min(entrega, clamp01(predecir(modelo.modelos.entrega_p10, x))),
          fallidos: clamp01(predecir(modelo.modelos.fallidos, x)),
        };
      });
      zs.dia = d;  // para el día malo de cada familia en resumen()
      return zs;
    }

    // Agregado por familia: tasas ponderadas por paquetes. El día malo de una familia
    // sale de su propio modelo (los días malos de sus zonas no caen todos a la vez).
    function resumen(zs) {
      const out = {};
      const activas = new Set(zs.filter((z) => z.activa).map((z) => z.rutas));
      const diaMalo = (fam) => {
        // con una sola familia en juego, el total es esa familia
        const f = fam === "total" && activas.size === 1 ? [...activas][0] : fam;
        return predecir(modelo.dia_malo, zs.dia.concat([f === "EQX1" ? 1 : 0, f === "total" ? 1 : 0]));  // margen (negativo)
      };
      for (const fam of ["total", ...Object.keys(DSReparto.P.familias)]) {
        const sel = zs.filter((z) => z.activa && (fam === "total" || z.rutas === fam));
        const paq = sel.reduce((a, z) => a + z.paquetes, 0);
        const m = (k) => (paq ? sel.reduce((a, z) => a + z[k] * z.paquetes, 0) / paq : 0);
        const entrega = m("entrega");
        const p10 = paq && zs.dia ? clamp01(entrega + Math.min(0, diaMalo(fam))) : m("p10");
        out[fam] = { paquetes: paq, entrega, p10, fallidos: m("fallidos"), noEntregados: Math.round(paq * (1 - entrega)) };
      }
      return out;
    }

    // Valores de Shapley sobre las condiciones del día: cuánto aporta cada una a la
    // diferencia de tasa de entrega con un día normal. Se prueban todas las combinaciones
    // (2^6 = 64) y se cachea cada una.
    function explicar(condiciones, opts = {}) {
      const c = { ...DSReparto.NORMAL, ...condiciones };
      const claves = DSReparto.RASGOS_DIA.filter((k) => c[k] !== DSReparto.NORMAL[k]);
      const familia = opts.familia || "total";
      const cache = new Map();
      const valor = (mask) => {
        if (!cache.has(mask)) {
          const sub = { ...DSReparto.NORMAL };
          claves.forEach((k, j) => { if (mask & (1 << j)) sub[k] = c[k]; });
          // el volumen pesa las zonas igual en todas las combinaciones: se usan los paquetes reales
          const zs = zonas(sub, opts).map((z, i) => ({ ...z, paquetes: real[i].paquetes }));
          cache.set(mask, resumen(zs)[familia].entrega);
        }
        return cache.get(mask);
      };
      const real = zonas(c, opts);
      const n = claves.length, fact = [1];
      for (let i = 1; i <= n; i++) fact[i] = fact[i - 1] * i;
      const aportes = claves.map((k, j) => {
        let phi = 0;
        for (let mask = 0; mask < 1 << n; mask++) {
          if (mask & (1 << j)) continue;
          const s = popcount(mask);
          phi += ((fact[s] * fact[n - s - 1]) / fact[n]) * (valor(mask | (1 << j)) - valor(mask));
        }
        return { condicion: k, aporte: phi };
      });
      return { normal: valor(0), escenario: valor((1 << n) - 1), aportes: aportes.sort((a, b) => a.aporte - b.aporte) };
    }

    return { zonas, resumen, explicar, metricas: modelo.metricas };
  }

  function popcount(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }

  const api = { crear, predecir };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSModelo = api;
})(typeof window !== "undefined" ? window : globalThis);
