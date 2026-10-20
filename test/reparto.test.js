// Pruebas del motor de reparto de Cádiz (mapa/reparto.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../mapa/reparto.js");
const base = require("../mapa/data/cadiz-base.json");

// Media de varias semillas, para no depender de un día con suerte
function media(condiciones, campo, familia = "total", n = 12) {
  let s = 0;
  for (let seed = 1; seed <= n; seed++) s += R.simular(base, condiciones, { seed }).kpis[familia][campo];
  return s / n;
}

test("no se pierde ningún paquete: en cada zona, paquetes = entregados + fallidos + devueltos", () => {
  for (const e of R.ESCENARIOS) {
    const r = R.simular(base, e.condiciones, { seed: 3 });
    for (const z of r.zonas) {
      assert.equal(z.paquetes, z.entregados + z.fallidos + z.rts, `${e.id} ${z.id}`);
      assert.equal(z.rts, z.rtsTiempo + z.rtsInundacion + z.rtsIncomunicada, `${e.id} ${z.id}`);
    }
    const sumRutas = r.rutas.reduce((a, x) => a + x.paquetes, 0);
    assert.ok(Math.abs(sumRutas - r.kpis.total.paquetes) <= r.rutas.length, "los paquetes de las rutas cuadran con los de las zonas");
  }
});

test("la misma semilla da el mismo turno", () => {
  const a = R.simular(base, { lluvia: 0.6, inundacion: 0.5 }, { seed: 9 });
  const b = R.simular(base, { lluvia: 0.6, inundacion: 0.5 }, { seed: 9 });
  assert.deepEqual(a.kpis, b.kpis);
  assert.deepEqual(a.cortados, b.cortados);
});

test("un día normal sale como en DS Flow: 120 rutas, 26.000 paquetes y casi todo entregado", () => {
  const r = R.simular(base, {}, { seed: 1 });
  assert.equal(r.kpis.EQX1.rutas, 20);
  assert.equal(r.kpis.DQX1.rutas, 100);
  assert.ok(Math.abs(r.kpis.total.paquetes - 26000) < 50);
  assert.equal(r.cortados.length, 0);
  assert.ok(media({}, "tasaEntrega", "DQX1") > 0.97);
  assert.ok(media({}, "tasaEntrega", "EQX1") > 0.96);
});

test("las rutas EQX1 salen antes que las DQX1 y todas vuelven dentro de la jornada", () => {
  const r = R.simular(base, {}, { seed: 2 });
  const salida = (f) => r.rutas.filter((x) => x.familia === f).map((x) => x.salida);
  assert.ok(Math.max(...salida("EQX1")) < Math.min(...salida("DQX1")));
  for (const x of r.rutas) assert.ok(x.vuelta <= x.salida - R.P.carga + R.P.jornada + 90, `${x.id} vuelve a las ${R.reloj(x.vuelta)}`);
});

test("la lluvia, la inundación, la huelga y el retraso empeoran la entrega", () => {
  const normal = media({}, "tasaEntrega");
  for (const c of [{ lluvia: 0.9 }, { lluvia: 1, inundacion: 0.8 }, { huelga: 0.35 }, { retraso: 75 }, { volumen: 1.5 }]) {
    assert.ok(media(c, "tasaEntrega") < normal - 0.01, JSON.stringify(c));
  }
});

test("el Campo de Gibraltar no es de la estación: lo reparte otra de Málaga", () => {
  const cdg = ["Algeciras", "La Línea de la Concepción", "San Roque", "Los Barrios", "Tarifa"];
  assert.ok(base.zonas.every((z) => !cdg.includes(z.municipio)));
  assert.ok(base.carreteras.every((t) => !cdg.includes(t.desde) && !cdg.includes(t.hasta)));
  assert.equal(base.otra_estacion.zona, "Campo de Gibraltar");
  assert.ok(base.contexto["Campo de Gibraltar"]);
  assert.ok(base.zonas.filter((z) => z.rutas === "EQX1").every((z) => z.comarca === "Sierra de Cádiz"));
});

test("la inundación corta tramos inundables y deja paquetes sin acceso", () => {
  const r = R.simular(base, { lluvia: 1, inundacion: 1 }, { seed: 4 });
  assert.ok(r.cortados.length > 0);
  const inundables = new Set(base.carreteras.filter((t) => t.inundable).map((t) => t.id));
  r.cortados.forEach((id) => assert.ok(inundables.has(id)));
  assert.ok(r.kpis.total.rtsInundacion > 0);
});

test("la huelga quita furgonetas y el refuerzo las añade", () => {
  assert.equal(R.simular(base, { huelga: 0.5 }, { seed: 1 }).kpis.total.rutas, 60);
  assert.equal(R.simular(base, { refuerzo: 0.25 }, { seed: 1 }).kpis.total.rutas, 150);
  assert.ok(media({ volumen: 1.5, refuerzo: 0.3 }, "tasaEntrega") > media({ volumen: 1.5 }, "tasaEntrega"));
});

test("se puede simular una sola familia de rutas", () => {
  const r = R.simular(base, {}, { seed: 1, familias: ["DQX1"] });
  assert.ok(r.rutas.every((x) => x.familia === "DQX1"));
  assert.ok(r.zonas.filter((z) => z.rutas === "EQX1").every((z) => z.paquetes === 0));
});

test("la flota: cada ruta acaba sin problemas o con un motivo, y se sabe si faltan o sobran furgonetas", () => {
  for (const e of R.ESCENARIOS) {
    const f = R.simular(base, e.condiciones, { seed: 4 }).kpis.total.flota;
    assert.equal(f.aTiempo + f.conProblemas, f.rutas, e.id);
    assert.equal(f.porTiempo + f.porAgua, f.conProblemas, e.id);
    assert.ok(!(f.faltan > 0 && f.sobran > 0), `${e.id}: no pueden faltar y sobrar a la vez`);
  }
  const normal = R.simular(base, {}, { seed: 4 }).kpis.total.flota;
  assert.equal(normal.faltan, 0, "en un día normal no faltan furgonetas");
  const huelga = R.simular(base, { huelga: 0.35 }, { seed: 4 }).kpis.total.flota;
  assert.equal(huelga.sinConductor, 42, "el 35% de 120 rutas se queda sin conductor");
  assert.ok(huelga.faltan > 10, "con huelga faltan furgonetas");
  const flood = R.simular(base, { lluvia: 1, inundacion: 0.8 }, { seed: 4 }).kpis.total.flota;
  assert.ok(flood.porAgua > 0, "con flash flood hay rutas frenadas por el agua");
  const poco = R.simular(base, { volumen: 0.6 }, { seed: 4 }).kpis.total.flota;
  assert.ok(poco.sobran >= 10, "con poco volumen sobran furgonetas");
});

test("con los retrasos de DS Flow, cada oleada sale a su hora", () => {
  const retrasos = [0, 0, 20, 0, 0, 45];
  const r = R.simular(base, {}, { seed: 2, retrasos });
  for (const x of r.rutas) assert.equal(x.salida, x.oleada + retrasos[x.ola] + R.P.carga, x.id);
  assert.deepEqual(R.OLEADAS, ["06:30", "06:45", "07:00", "07:15", "07:30", "07:45"]);
  assert.ok(r.rutas.filter((x) => x.familia === "EQX1").every((x) => x.ola === 0), "EQX1 sale en la primera oleada");
});
