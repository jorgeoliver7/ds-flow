// Pruebas del motor: se ejecutan con `npm test` (node --test)
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../layout.js");
const DSEngine = require("../engine.js");

// Avanza la simulación en pasos de 3 segundos simulados, como hace el navegador
function run(E, minutes, check) {
  const end = E.S.t + minutes;
  while (E.S.t < end) { E.step(0.05); if (check) check(E); }
}
const shift = (opts) => { const E = DSEngine.create(L, opts); run(E, 700); return E; };

test("no se pierde ningún paquete: recibidos = en planta + despachados", () => {
  const E = DSEngine.create(L, { seed: 3 });
  let i = 0;
  run(E, 700, (E) => {
    if (i++ % 50) return;
    assert.equal(E.S.received, E.inPlantCount() + E.S.dispatched);
  });
  assert.equal(E.S.received, E.inPlantCount() + E.S.dispatched);
});

test("la misma semilla da la misma partida", () => {
  const a = DSEngine.create(L, { seed: 11 }), b = DSEngine.create(L, { seed: 11 });
  run(a, 300); run(b, 300);
  assert.equal(a.S.received, b.S.received);
  assert.equal(a.S.sorted, b.S.sorted);
  assert.deepEqual([...a.S.pkgs.keys()].slice(0, 50), [...b.S.pkgs.keys()].slice(0, 50));
});

test("el turno del plan se completa: llega todo el volumen y salen todas las rutas", () => {
  const E = shift({ seed: 7 });
  const S = E.S;
  assert.equal(S.received, S.plan.volume);
  assert.ok(S.over, "el turno termina");
  assert.equal(S.routesOut, S.routes.length);
  assert.ok(S.sortDoneAt <= S.plan.cutoff, "con la plantilla base el sort acaba antes del corte");
  assert.equal(E.metrics().rollover, 0);
});

test("la previsión de fin del sort se acerca a la hora real", () => {
  const E = DSEngine.create(L, { seed: 7 });
  run(E, 120);
  const predicted = E.forecast().sortEnd;
  run(E, 580);
  assert.ok(Math.abs(predicted - E.S.sortDoneAt) < 30, `previsto ${predicted}, real ${E.S.sortDoneAt}`);
});

test("con menos gente en stow el sort acaba más tarde", () => {
  const base = shift({ seed: 5 });
  const short = DSEngine.create(L, { seed: 5 });
  short.S.staff.stow = 7;
  run(short, 700);
  assert.ok(short.S.sortDoneAt > base.S.sortDoneAt + 30);
  assert.ok(short.S.sortDoneAt > short.S.plan.cutoff, "y se pasa del corte");
});

test("el planificador prevé un sort más temprano con más gente y más tarde con menos", () => {
  const E = DSEngine.create(L, { seed: 7 });
  run(E, 90);
  const now = E.forecast().sortEnd;
  const more = E.forecast({ ...E.S.staff, stow: E.S.staff.stow + 4, induct: E.S.staff.induct + 1 }).sortEnd;
  const less = E.forecast({ ...E.S.staff, stow: E.S.staff.stow - 4 }).sortEnd;
  // con más gente no puede acabar antes de que llegue el último camión, así que puede quedarse igual
  assert.ok(more <= now && now < less, `${more} <= ${now} < ${less}`);
  // y no cambia la plantilla real hasta que se aplica
  assert.equal(E.S.staff.stow, L.stow.staff);
});

test("métricas por proceso, horas trabajadas y tiempo de ciclo", () => {
  const E = shift({ seed: 7 });
  const m = E.metrics();
  assert.deepEqual(m.processes.map((p) => p.key), ["receive", "induct", "stow", "pick"]);
  assert.ok(m.laborHours > 50 && m.laborHours < 250, `horas ${m.laborHours}`);
  assert.ok(m.pph > 0);
  for (const c of m.cycle) assert.ok(c.min > 0, c.key);
  assert.ok(m.waves.every((w) => w.done));
});
