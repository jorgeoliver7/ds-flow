// Pruebas del modelo de IA del mapa (mapa/modelo.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../mapa/reparto.js");
const M = require("../mapa/modelo.js");
const base = require("../mapa/data/cadiz-base.json");
const modelo = require("../mapa/data/modelo.json");

const IA = M.crear(base, modelo);

test("el navegador predice lo mismo que el modelo entrenado en Python", () => {
  for (const v of modelo.verificacion) {
    for (const n of Object.keys(modelo.modelos)) {
      assert.ok(Math.abs(M.predecir(modelo.modelos[n], v.x) - v[n]) < 1e-4, n);
    }
  }
  for (const v of modelo.verificacion_dia_malo) assert.ok(Math.abs(M.predecir(modelo.dia_malo, v.x) - v.margen) < 1e-4, "dia_malo");
});

test("las predicciones son tasas y el día malo nunca sale mejor que el esperado", () => {
  for (const e of R.ESCENARIOS) {
    for (const z of IA.zonas(e.condiciones)) {
      for (const k of ["entrega", "p10", "fallidos"]) assert.ok(z[k] >= 0 && z[k] <= 1, `${e.id} ${z.id} ${k}`);
      assert.ok(z.p10 <= z.entrega);
    }
  }
});

test("por familia de rutas, el modelo se acerca a la media de muchos días jugados con el motor", () => {
  for (const e of R.ESCENARIOS) {
    const ia = IA.resumen(IA.zonas(e.condiciones));
    // la Sierra (EQX1) son pocas rutas y un corte en la A-382 la deja casi entera sin acceso: hacen falta muchos días
    const mc = { DQX1: 0, EQX1: 0 }, n = 40;
    for (let s = 1; s <= n; s++) {
      const r = R.simular(base, e.condiciones, { seed: 100 + s });
      mc.DQX1 += r.kpis.DQX1.tasaEntrega / n; mc.EQX1 += r.kpis.EQX1.tasaEntrega / n;
    }
    for (const f of ["DQX1", "EQX1"]) assert.ok(Math.abs(ia[f].entrega - mc[f]) < 0.05, `${e.id} ${f}: IA ${ia[f].entrega} motor ${mc[f]}`);
  }
});

test("la explicación reparte toda la diferencia con un día normal entre las condiciones", () => {
  const c = { volumen: 1.45, refuerzo: 0.2, lluvia: 0.8, inundacion: 0.4 };
  const ex = IA.explicar(c);
  const suma = ex.aportes.reduce((a, x) => a + x.aporte, 0);
  assert.ok(Math.abs(suma - (ex.escenario - ex.normal)) < 1e-9);
  assert.equal(ex.aportes.length, 4);
  assert.ok(ex.aportes.find((a) => a.condicion === "refuerzo").aporte > 0, "el refuerzo ayuda");
  assert.ok(ex.aportes.find((a) => a.condicion === "lluvia").aporte < 0, "la lluvia resta");
  assert.equal(IA.explicar({}).aportes.length, 0);
});

test("la huelga y la inundación bajan la entrega que predice el modelo", () => {
  const normal = IA.resumen(IA.zonas({})).total.entrega;
  assert.ok(IA.resumen(IA.zonas({ huelga: 0.4 })).total.entrega < normal - 0.05);
  assert.ok(IA.resumen(IA.zonas({ lluvia: 1, inundacion: 0.8 })).total.entrega < normal - 0.05);
});
