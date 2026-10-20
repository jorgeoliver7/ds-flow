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

test("no se pierde ningún paquete: recibidos = en planta + despachados + dados de baja", () => {
  const E = DSEngine.create(L, { seed: 3 });
  let i = 0;
  run(E, 700, (E) => {
    if (i++ % 50) return;
    assert.equal(E.S.received, E.inPlantCount() + E.S.dispatched + E.S.writtenOff);
  });
  assert.equal(E.S.received, E.inPlantCount() + E.S.dispatched + E.S.writtenOff);
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
  short.S.staff.stow = 11;
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
  assert.deepEqual(m.processes.map((p) => p.key), ["receive", "induct", "stow", "pick", "ps", "dock", "yard"]);
  assert.ok(m.laborHours > 100 && m.laborHours < 400, `horas ${m.laborHours}`);
  assert.ok(m.supportHours > 0 && m.supportHours < m.laborHours, `apoyo ${m.supportHours}`);
  assert.ok(m.pph > 0);
  for (const c of m.cycle) assert.ok(c.min > 0, c.key);
  assert.ok(m.waves.every((w) => w.done));
});

test("incidencias: los missorts se detectan en pick y se resuelven en problem solve", () => {
  const E = DSEngine.create(L, { seed: 7 });
  let seen = null, fixed = false;
  run(E, 700, (E) => {
    if (!seen) for (const p of E.S.pkgs.values()) if (p.missorted && p.where === "bag") { seen = p; break; }
    if (seen && !fixed && seen.hist.some((h) => h.msg.startsWith("Resuelto"))) fixed = true;
  });
  assert.ok(seen, "algún paquete cae en una saca equivocada");
  assert.ok(fixed, "y problem solve lo devuelve a su saca");
  const q = E.metrics().quality;
  assert.ok(q.missort > 0 && q.damaged > 0 && q.noLabel > 0, JSON.stringify(q));
  assert.ok(q.missortRate > 0 && q.missortRate < 0.02);
  assert.ok(q.dpmo > 1000 && q.dpmo < 20000, `dpmo ${q.dpmo}`);
  assert.equal(q.psOpen, 0, "al final no queda nada en problem solve");
  assert.ok(q.psAvg > 0);
});

test("con el conveyor parado no se induce nada", () => {
  const E = DSEngine.create(L, { seed: 7 });
  const ev = E.S.plan.events.find((e) => e.type === "conveyor");
  run(E, ev.at + 1 - E.S.t);
  assert.ok(E.S.conveyorDown);
  const queued = E.S.inductQ.length;
  run(E, ev.minutes - 2);
  const inducted = [...E.S.pkgs.values()].filter((p) => p.inductAt > ev.at + 0.1).length;
  assert.equal(inducted, 0);
  assert.ok(E.S.inductQ.length >= queued, "la cola de inducción crece");
  run(E, 3);
  assert.ok(!E.S.conveyorDown);
});

test("un camión que llega tarde retrasa el sort y se avisa", () => {
  const L2 = JSON.parse(JSON.stringify(L));
  L2.shift.events.push({ type: "truckLate", truck: "T-12", minutes: 90 });
  const logs = [];
  const base = shift({ seed: 7 }), late = DSEngine.create(L2, { seed: 7, hooks: { log: (m) => logs.push(m) } });
  run(late, 700);
  const pt = late.S.plan.trucks.find((x) => x.id === "T-12");
  assert.ok(pt.dockedAt >= pt.at + 90);
  assert.ok(late.S.sortDoneAt > base.S.sortDoneAt + 10, `${late.S.sortDoneAt} vs ${base.S.sortDoneAt}`);
  assert.ok(logs.some((m) => m.includes("T-12 viene con 90 min de retraso")));
});

test("cada escenario lleva a un informe distinto y coherente", () => {
  const SC = require("../scenarios.js"), R = require("../report.js");
  const out = {};
  for (const sc of SC.list) {
    const E = DSEngine.create(L, SC.options(L, sc.id));
    run(E, 760);
    assert.ok(E.S.over, sc.id + " termina");
    const r = R.build(E, sc);
    assert.equal(E.S.received, E.S.plan.volume, sc.id);
    out[sc.id] = { r, S: E.S };
    const csv = R.csv(r);
    assert.ok(csv.startsWith("﻿Sección;Métrica;Valor;Detalle"));
    assert.ok(csv.includes(sc.name));
  }
  // noche normal: todo a tiempo; pico: más volumen y peor; falta de personal: sort tarde; retraso: avisa del camión
  assert.ok(out.normal.r.good.some((g) => g.includes("antes del corte")));
  assert.equal(out.normal.S.routesLate, 0);
  assert.ok(out.pico.S.plan.volume > out.normal.S.plan.volume * 1.3);
  assert.ok(out.personal.S.sortDoneAt > out.personal.S.plan.cutoff);
  assert.ok(out.personal.r.bad.some((b) => b.includes("después del corte")));
  assert.ok(out.retraso.r.bad.some((b) => b.includes("T-12 llegó 60 min tarde")));
  // turno de tarde: poco volumen, otra hora de inicio y solo las rutas con paquetes
  assert.equal(out.pm.S.plan.volume, 500);
  assert.equal(DSEngine.clock({ shiftStart: 14 * 60 }, 0), "14:00");
  assert.equal(out.pm.r.kpis.find((k) => k[0] === "Rutas a tiempo")[1], "8/8");
  assert.ok(out.pm.S.sortDoneAt <= out.pm.S.plan.cutoff);
  // enlace al mapa de Cádiz: lleva los paquetes que salieron, el retraso medio de las oleadas y el rollover
  const u = new URL(R.mapaUrl(out.normal.r), "https://x/");
  assert.equal(u.pathname, "/mapa/");
  assert.equal(u.searchParams.get("desde"), "dsflow");
  assert.equal(u.searchParams.get("turno"), SC.list[0].name);
  assert.equal(+u.searchParams.get("paquetes"), out.normal.S.dispatched);
  assert.equal(+u.searchParams.get("retraso"), 0);
  assert.ok(out.personal.r.reparto.retraso > 0, "falta de personal: las oleadas salen tarde");
  const signature = (x) => JSON.stringify([x.r.kpis, x.r.bad]);
  assert.equal(new Set(Object.values(out).map(signature)).size, SC.list.length);
});

test("importar la plantilla CSV cambia la partida", () => {
  const fs = require("node:fs"), path = require("node:path");
  const I = require("../importcsv.js");
  const res = I.parse(fs.readFileSync(path.join(__dirname, "..", "ejemplo-turno.csv"), "utf8"), L);
  assert.ok(res.ok, res.errors.join(", "));
  assert.equal(res.shift.trucks.length, 12);
  assert.equal(res.shift.trucks[0].at, "01:00");
  assert.deepEqual(res.shift.waves.map((w) => w.at), ["06:20", "06:35", "06:50", "07:05", "07:20", "07:35"]);
  assert.equal(res.weights.length, 120);
  const E = DSEngine.create(L, { seed: 7, shift: res.shift, routeWeights: res.weights });
  run(E, 760);
  assert.equal(E.S.received, res.shift.trucks.reduce((s, t) => s + t.units, 0));
  assert.equal(E.S.routes[36].out, 0, "la ruta sin volumen no recibe paquetes");
  assert.equal(E.metrics().routesTotal, 114, "ni cuenta en el turno");
  assert.ok(E.S.over);
});

test("el CSV con errores se rechaza con mensajes claros", () => {
  const I = require("../importcsv.js");
  const bad = I.parse("tipo;id;hora;paquetes\ncamion;T-01;25:00;100\nruta;R999;;10\nfurgo;;;\n", L);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 4);
  assert.ok(bad.errors[0].includes("Línea 2"));
  assert.equal(I.parse("", L).ok, false);
  const comma = I.parse("tipo,id,hora,paquetes\ncamion,T-01,23:10,1.200\noleada,A,06:00,\n", L);
  assert.ok(comma.ok); assert.equal(comma.shift.trucks[0].units, 1200);
  // por pasillo: la segunda oleada del pasillo A conserva sus 15 min de separación
  assert.deepEqual(comma.shift.waves.slice(0, 2).map((w) => w.at), ["06:00", "06:15"]);
});

test("la plantilla mínima llega al corte y saca todas las oleadas", () => {
  const SC = require("../scenarios.js");
  const o = SC.options(L, "normal"), cp = DSEngine.create(L, o).S.crewPlan;
  assert.ok(cp.reachable);
  assert.ok(cp.sort >= 24 && cp.sort <= 34, `sort ${cp.sort}`);
  const E = DSEngine.create(L, { ...o, staff: cp.staff });
  run(E, 900);
  assert.ok(E.S.sortDoneAt <= E.S.plan.cutoff, "acaba antes del corte");
  assert.equal(E.metrics().routesLate, 0);
  // con tres personas menos en stow acaba bastante más tarde
  const E2 = DSEngine.create(L, { ...o, staff: { ...cp.staff, stow: cp.staff.stow - 3 } });
  run(E2, 900);
  assert.ok(E2.S.sortDoneAt > E.S.sortDoneAt + 20);
});

test("la recomendación en directo mueve gente al cuello de botella y adelanta el sort", () => {
  const SC = require("../scenarios.js");
  // gente de sobra en inducción y corta en stow
  const o = { ...SC.options(L, "normal"), staff: { induct: 7, stow: 15 } };
  const E = DSEngine.create(L, o);
  while (E.S.t < 30) E.step(0.1);
  const adv = E.advise();
  assert.ok(adv, "hay recomendación");
  assert.ok(adv.id.startsWith("move:"), adv.id);
  assert.ok(adv.staff.stow > E.S.staff.stow, "stow es el cuello de botella");
  const before = E.forecast().sortEnd;
  E.setStaff(adv.staff); E.step();
  assert.ok(E.forecast().sortEnd < before - 5);
  // con la estación sobrada no recomienda nada
  const N = DSEngine.create(L, SC.options(L, "normal"));
  while (N.S.t < 30) N.step(0.1);
  assert.equal(N.advise(), null);
});

test("plantilla con nombre: cada proceso tiene a sus personas y el trabajo se reparte entre ellas", () => {
  const SC = require("../scenarios.js");
  const E = DSEngine.create(L, SC.options(L, "normal")), S = E.S, crew = S.crew;
  for (const k of ["receive", "induct", "stow", "pick", "ps"]) assert.equal(crew.byProc[k].length, S.staff[k], k);
  // el equipo habitual rinde al 100%: la partida es la misma que sin plantilla con nombre
  const plain = DSEngine.create(L, { ...SC.options(L, "normal"), crew: false });
  run(E, 300); run(plain, 300);
  assert.equal(E.S.sorted, plain.S.sorted);
  const ids = new Set(crew.people.map((e) => e.id));
  assert.equal(ids.size, crew.people.length, "IDs únicos");
  const stats = crew.stats({ receive: 1400, induct: 1100, stow: 300, pick: 600, ps: 30 });
  const stowed = stats.reduce((s, e) => s + (e.procs.find((p) => p.key === "stow")?.units || 0), 0);
  assert.equal(stowed, S.totals.stow, "todo lo stoweado tiene a alguien detrás");
  // mover gente con el planificador cambia quién está en cada proceso y queda registrado
  S.staff.induct--; S.staff.stow++;
  E.step(0.05);
  assert.equal(crew.byProc.stow.length, S.staff.stow);
  const mv = crew.moves[crew.moves.length - 1];
  assert.equal(mv.from, "induct"); assert.equal(mv.to, "stow");
  // si no queda nadie en el equipo, entra un temporal
  S.staff.stow += 20; E.step(0.05);
  assert.ok(crew.byProc.stow.some((e) => e.temp));
});

test("simular el resto del turno repite la partida exacta hasta ahora, con las acciones del usuario", () => {
  const SC = require("../scenarios.js");
  const E = DSEngine.create(L, SC.options(L, "normal")), S = E.S;
  while (S.t < 60) E.step();
  E.setStaff({ ...S.staff, stow: 15, induct: 6 });
  while (S.t < 120) E.step();
  E.addTruck();
  E.moveWorker(S.crew.byProc.receive[0].id, "stow");
  while (S.t < 200) E.step();
  const at = S.steps;
  // sin cambios, la proyección es lo mismo que dejar correr la partida
  const p = DSEngine.project(E.spec.L, E.spec.opts, S.actions, at, null);
  while (!S.over && S.t < S.plan.end + 240) E.step();
  assert.deepEqual(p, E.summary());
});

test("la estimación al instante se acerca a la simulación completa", () => {
  const SC = require("../scenarios.js");
  const o = SC.options(L, "normal");
  for (const change of [{ receive: 3 }, { induct: 4 }, { stow: 15 }]) {
    const E = DSEngine.create(L, o);
    while (E.S.t < 30) E.step();
    const draft = { ...E.S.staff, ...change }, w = E.whatIf(draft);
    const real = DSEngine.project(E.spec.L, E.spec.opts, E.S.actions, E.S.steps, draft);
    assert.ok(Math.abs(w.then.sortEnd - real.sortEnd) < 15, `${JSON.stringify(change)}: previsto ${E.clock(w.then.sortEnd)}, real ${E.clock(real.sortEnd)}`);
    assert.ok(w.then.sortEnd > w.now.sortEnd + 20, "y se ve que empeora");
  }
  // la zona de carros cuenta: con una sola persona es ella la que marca el ritmo
  const E = DSEngine.create(L, o);
  assert.equal(E.bottleneck({ ...E.S.staff, receive: 1 }).key, "receive");
  // y la previsión dice quién entraría
  const w = E.whatIf({ ...E.S.staff, stow: E.S.staff.stow + 1 });
  assert.equal(w.joins.length, 1); assert.equal(w.joins[0].to, "stow");
});

test("sin dock marshall los camiones tardan más en atracar y lo recomienda", () => {
  const SC = require("../scenarios.js");
  const o = SC.options(L, "normal");
  const a = DSEngine.create(L, o), b = DSEngine.create(L, { ...o, staff: { dock: 0 } });
  run(a, 30); run(b, 30);
  const first = (E) => E.S.plan.trucks[0].dockedAt;
  assert.ok(first(a) >= L.docks.marshal.checkInMin && first(a) < first(b), `${first(a)} / ${first(b)}`);
  assert.ok(first(b) >= L.docks.marshal.selfCheckInMin);
  assert.equal(b.advise().id, "add:dock");
  assert.ok(b.forecast().sortEnd > a.forecast().sortEnd);
  // el check-in se apunta a la persona que hace de dock marshall
  assert.ok(a.S.crew.byProc.dock[0].units.dock >= 1);
});

test("sin yard marshall en las oleadas las furgonetas salen más tarde", () => {
  const SC = require("../scenarios.js");
  const o = SC.options(L, "normal");
  const a = shift(o), b = shift({ ...o, staff: { yard: 0 } });
  const wait = (E) => DSEngine.avg(E.S.routes.map((r) => r.departAt - r.wave.at));
  assert.ok(wait(b) > wait(a) + 3, `${wait(a)} / ${wait(b)}`);
  assert.ok(b.metrics().routesLate > a.metrics().routesLate);
  // el yard marshall solo cuenta horas durante las oleadas
  const yardH = a.S.procMin.yard / 60;
  assert.ok(yardH > 1 && yardH < 3, `yard ${yardH} h`);
});

test("high value: se marcan unos pocos paquetes, sin cambiar la partida, y todos salen en su furgoneta", () => {
  const SC = require("../scenarios.js");
  const o = SC.options(L, "normal");
  const E = shift(o), none = DSEngine.create({ ...L, highValue: { share: 0 } }, o);
  run(none, 700);
  const hv = E.S.hv;
  assert.ok(hv.length > 50 && hv.length < 180, `${hv.length} high value`);
  assert.ok(hv.every((p) => p.value >= L.highValue.min && p.value <= L.highValue.max));
  assert.equal(none.S.hv.length, 0);
  assert.equal(E.S.sortDoneAt, none.S.sortDoneAt, "marcarlos no cambia la partida");
  assert.equal(E.S.dispatched, none.S.dispatched);
  assert.ok(hv.every((p) => ["route", "delivered", "writtenoff"].includes(p.where)), "al final del turno no queda ninguno en la estación");
});

test("todos los archivos de la página llevan la misma versión, para que el navegador no mezcle código nuevo y antiguo", () => {
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "index.html"), "utf8");
  const local = [...html.matchAll(/(?:src|href)="([a-z-]+\.(?:js|css))(\?v=[^"]*)?"/g)];
  assert.ok(local.length >= 10);
  const versions = new Set(local.map((m) => m[2]));
  assert.equal(versions.size, 1, `versiones: ${[...versions].join(", ")}`);
  assert.ok([...versions][0], "con ?v=");
});

test("el equipo de noche para en el descanso y el sort sigue después", () => {
  const SC = require("../scenarios.js");
  const E = DSEngine.create(L, SC.options(L, "normal")), S = E.S;
  const [b] = S.plan.breaks;
  assert.equal(E.clock(b.from), "04:00"); assert.equal(E.clock(b.to), "04:30");
  assert.equal(E.clock(S.plan.sortStart), "01:00");
  while (S.t < S.plan.sortStart - 1) E.step();
  assert.equal(S.received, 0, "antes de la 01:00 no se descarga");
  while (S.t < b.from + 2) E.step();
  const stowed = S.stowed, f0 = E.forecast().sortEnd;
  while (S.t < b.to - 1) E.step();
  assert.ok(S.stowed - stowed < 20, "en el descanso no se hace stow (solo llega lo que ya iba de camino)");
  assert.ok(Math.abs(E.forecast().sortEnd - f0) < 8, "la previsión ya contaba con el descanso");
  assert.equal(E.planAt(b.to - 1), E.planAt(b.from), "el plan se queda plano");
  run(E, 900);
  assert.ok(S.sortDoneAt <= S.plan.cutoff, "y el sort acaba antes del corte");
});

test("comparar escenarios juega dos turnos enteros y calcula su coste", () => {
  const SC = require("../scenarios.js"), C = require("../compare.js"), R = require("../report.js");
  const o = SC.options(L, "personal");
  const a = C.run(L, o, "scenario"), b = C.run(L, o, "min");
  assert.ok(a.over && b.over);
  assert.ok(a.routesLate > 0 && b.routesLate === 0, "con la plantilla mínima salen todas a tiempo");
  assert.ok(b.staff.stow > a.staff.stow);
  const rows = C.rows(a, b, 20), cost = rows.find((r) => r.label === "Coste del turno");
  assert.equal(cost.va, a.laborHours * 20);
  assert.match(C.verdict(a, b, 20, ["A", "B"]), /^B cuesta .* que A: saca a tiempo \d+ rutas más/);
  // el informe también lleva el coste
  const E = DSEngine.create(L, o);
  run(E, 900);
  const k = R.build(E, SC.list[2], { hourly: 20 }).kpis.find((x) => x[0] === "Coste por paquete");
  assert.ok(k && /€$/.test(k[1]));
});

test("tarde: los camiones de antes de las 16:00 se quedan en la playa para la noche y el de las 16:00 sale a las 18:00", () => {
  const SC = require("../scenarios.js");
  const E = DSEngine.create(L, SC.options(L, "pm")), S = E.S;
  const hold = S.plan.trucks.filter((x) => x.hold), same = S.plan.trucks.filter((x) => !x.hold);
  assert.deepEqual(hold.map((x) => E.clock(x.at)), ["14:30", "15:30"]);
  assert.deepEqual(same.map((x) => E.clock(x.at)), ["16:00"]);
  let i = 0;
  run(E, 900, (E) => {
    if (i++ % 50) return;
    assert.equal(E.S.received, E.inPlantCount() + E.S.dispatched + E.S.writtenOff, "la carga de la noche se cuenta aparte");
  });
  const total = hold.reduce((s, x) => s + x.units, 0);
  assert.equal(S.held, total, "se descargan enteros");
  assert.equal(E.heldCount(), total, "y se quedan en carros en la playa");
  assert.equal(S.received, same[0].units, "solo se procesa el sameday");
  const held = [...S.pkgs.values()].filter((p) => p.hold);
  assert.ok(held.every((p) => p.where === "held" && !p.sorted && p.route == null), "ningún paquete de la noche se induce");
  assert.ok(S.sortDoneAt != null && S.sortDoneAt <= S.plan.cutoff, "el sameday acaba antes del corte");
  const m = E.metrics();
  assert.ok(m.routesOut > 0 && m.routesLate === 0, "todas las rutas de las 18:00 salen a tiempo");
  assert.equal(m.rollover, 0);
});

test("tras el sort, el equipo de noche sigue fichado hasta las 09:30 (rutas y paquetes perdidos)", () => {
  const SC = require("../scenarios.js");
  const E = shift(SC.options(L, "normal")), S = E.S, m = E.metrics();
  const n = S.staff.receive + S.staff.induct + S.staff.stow;
  const expect = (n * E.workBetween(S.sortDoneAt, S.plan.nightEnd)) / 60;
  assert.ok(Math.abs(m.supportHours - expect) < 1e-6, `${m.supportHours} / ${expect}`);
  assert.equal(E.clock(S.plan.nightEnd), "09:30");
});
