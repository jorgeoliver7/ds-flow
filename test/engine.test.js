// Pruebas del motor: se ejecutan con `node --test`
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../layout.js");
const DSEngine = require("../engine.js");

// Avanza la simulación en pasos como hace el navegador
function run(E, minutes, check) {
  for (let t = 0; t < minutes; t += 0.05) { E.step(0.05); if (check) check(E); }
}

test("no se pierde ningún paquete: recibidos = en planta + despachados", () => {
  const E = DSEngine.create(L, { seed: 3 });
  run(E, 180, (E) => {
    const S = E.S;
    assert.equal(S.received, E.inPlantCount() + S.dispatched);
  });
  assert.ok(E.S.dispatched > 0, "alguna furgoneta ha salido");
});

test("la misma semilla da la misma partida", () => {
  const a = DSEngine.create(L, { seed: 11 }), b = DSEngine.create(L, { seed: 11 });
  run(a, 120); run(b, 120);
  assert.equal(a.S.received, b.S.received);
  assert.equal(a.S.stowed, b.S.stowed);
  assert.equal(a.S.dispatched, b.S.dispatched);
  assert.deepEqual([...a.S.pkgs.keys()].slice(0, 50), [...b.S.pkgs.keys()].slice(0, 50));
});

test("más personal de stow no reduce el ritmo de stow", () => {
  const base = DSEngine.create(L, { seed: 5 }), more = DSEngine.create(L, { seed: 5 });
  more.S.staff.stow = L.stow.staff * 2;
  run(base, 120); run(more, 120);
  assert.ok(more.S.stowed >= base.S.stowed);
});
