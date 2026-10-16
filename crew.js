// Plantilla con nombre: cada persona del turno con un ID inventado, sus habilidades y su rendimiento.
// El motor sigue trabajando con cuántas personas hay en cada proceso (S.staff); este módulo decide
// quiénes son, reparte entre ellas lo que hace cada proceso y lleva sus métricas.
// Todos los nombres e IDs son inventados.
(function (root) {
  "use strict";

  const PROCS = ["receive", "induct", "stow", "pick", "ps", "dock", "yard"];
  // los marshals no clasifican paquetes: no tienen objetivo de UPH ni entran en las medias de rendimiento
  const MARSHALS = ["dock", "yard"];
  const NAMES = ["Lucía", "Javier", "Marta", "Antonio", "Carmen", "David", "Rocío", "Manuel", "Laura", "Francisco", "Elena", "Sergio",
    "Paula", "Alejandro", "Inés", "Pablo", "Nuria", "Daniel", "Cristina", "Raúl", "Sara", "Iván", "Alba", "Jesús", "Irene", "Adrián",
    "Noelia", "Rubén", "Patricia", "Álvaro", "Silvia", "Miguel", "Andrea", "Fernando", "Lorena", "Óscar", "Beatriz", "Hugo", "Celia",
    "Mario", "Eva", "Diego", "Raquel", "Jorge", "Pilar", "Víctor", "Natalia", "Samuel", "Julia", "Rafael", "Ana", "Gonzalo", "Marina", "Ismael",
    "Teresa", "Luis", "Rosa", "Carlos", "Sonia", "Alberto", "Claudia", "Enrique", "Lidia", "Ricardo", "Esther", "Joaquín", "Aitana", "Marcos",
    "Yolanda", "Héctor", "Susana", "Nicolás", "Olga", "Emilio", "Vanesa", "Tomás", "Miriam", "Andrés", "Lola", "Germán"];
  // trabajar en un proceso que no es el tuyo cuesta: con formación rinde algo menos, sin ella bastante menos
  const SECONDARY = 0.9, UNTRAINED = 0.75;

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Equipos del turno: el de noche hace el sort, el de mañana el pick. La tarde lo hace todo con un equipo pequeño.
  // base: personas por proceso que hay normalmente; extra: gente formada que se puede llamar (horas extra, otro turno)
  // marshals: el dock marshall es del equipo de noche (recibe los camiones) y el yard marshall del de mañana (oleadas)
  function teams(L, evening) {
    const b = { receive: L.receive.staff, induct: L.induct.staff, stow: L.stow.staff, ps: L.problem.staff };
    if (evening) return [{ team: "tarde", base: { receive: 1, induct: 1, stow: 3, pick: 3, ps: 1 }, extra: { stow: 1, pick: 1 }, marshals: { dock: 1, yard: 1 }, marshalExtra: {} }];
    return [
      { team: "noche", base: b, extra: { receive: 1, induct: 2, stow: 5, ps: 1 }, marshals: { dock: 1 }, marshalExtra: { dock: 1 } },
      { team: "mañana", base: { pick: L.pick.staff }, extra: { pick: 6 }, marshals: { yard: 1 }, marshalExtra: { yard: 1 } },
    ];
  }

  // La misma estación tiene siempre la misma gente: la semilla es fija, no la del escenario
  function roster(L, evening) {
    const rand = rng(evening ? 4242 : 2024);
    const used = new Set(), out = [];
    const id = () => { let x; do x = "E-" + String(1000 + Math.floor(rand() * 9000)); while (used.has(x)); used.add(x); return x; };
    const names = NAMES.slice();
    const SORTING = PROCS.filter((p) => !MARSHALS.includes(p));
    for (const t of teams(L, evening)) {
      for (const [group, counts] of [["base", t.base], ["extra", t.extra]]) {
        for (const k of SORTING) for (let i = 0; i < (counts[k] || 0); i++) {
          // antigüedad en meses: los nuevos van algo más lentos y fallan algo más
          const tenure = Math.max(1, Math.round(rand() ** 1.6 * 60));
          const speed = 0.86 + Math.min(tenure, 24) / 24 * 0.14 + (rand() - 0.5) * 0.16;
          const care = Math.max(0.4, Math.min(2.2, (1.35 - Math.min(tenure, 30) / 30 * 0.6) * (0.6 + rand() * 0.8)));
          // formación cruzada: uno o dos procesos más del mismo equipo
          const others = SORTING.filter((p) => p !== k && (t.team === "noche" ? p !== "pick" : t.team === "mañana" ? p === "ps" || p === "stow" : true));
          const skills = [k];
          for (const p of others) if (rand() < 0.35) skills.push(p);
          const n = names.splice(Math.floor(rand() * names.length), 1)[0] || "Persona";
          out.push({ id: id(), name: `${n} ${String.fromCharCode(65 + Math.floor(rand() * 26))}.`, team: t.team, primary: k, skills, tenure, speed, care, bench: group === "extra" });
        }
      }
    }
    // Marshals, con su propia semilla para que el resto de la plantilla siga siendo la misma gente.
    // Suelen ser veteranos; algunos compañeros del mismo equipo también están formados para cubrirlos.
    const rm = rng(evening ? 4343 : 2125);
    for (const t of teams(L, evening)) {
      for (const [group, counts] of [["base", t.marshals], ["extra", t.marshalExtra]]) {
        for (const k of MARSHALS) for (let i = 0; i < (counts[k] || 0); i++) {
          const tenure = 18 + Math.round(rm() * 42);
          const n = names.splice(Math.floor(rm() * names.length), 1)[0] || "Persona";
          let x; do x = "E-" + String(1000 + Math.floor(rm() * 9000)); while (used.has(x)); used.add(x);
          out.push({ id: x, name: `${n} ${String.fromCharCode(65 + Math.floor(rm() * 26))}.`, team: t.team, primary: k, skills: [k], tenure,
            speed: 0.95 + rm() * 0.1, care: 0.6 + rm() * 0.4, bench: group === "extra" });
        }
      }
      for (const k of MARSHALS) if (t.marshals[k]) for (const e of out) if (e.team === t.team && !MARSHALS.includes(e.primary) && e.tenure >= 12 && rm() < 0.2) e.skills.push(k);
    }
    // la plantilla base de cada proceso rinde de media al 100%: así el equipo habitual da el ritmo de layout.js
    for (const k of PROCS) {
      const g = out.filter((e) => e.primary === k && !e.bench);
      const m = g.reduce((s, e) => s + e.speed, 0) / (g.length || 1);
      for (const e of g) e.speed = +(e.speed / m).toFixed(3);
    }
    for (const e of out) e.speed = +e.speed.toFixed(3);
    return out;
  }

  // E: motor ya creado (necesita S, L, log y clock)
  function create(L, S, opts) {
    opts = opts || {};
    const evening = L.shiftStart >= 12 * 60 && L.shiftStart < 20 * 60;
    const rand = rng((opts.seed || 7) * 7919 + 13);
    const people = roster(L, evening).map((e) => ({
      ...e, proc: null, since: null, units: {}, minutes: {}, missorts: 0, moves: [],
    }));
    const byProc = {}; for (const k of PROCS) byProc[k] = [];
    let temps = 0;
    const teamOf = (k) => (evening ? "tarde" : k === "pick" || k === "yard" ? "mañana" : "noche");
    const eff = (e, k) => e.speed * (e.primary === k ? 1 : e.skills.includes(k) ? SECONDARY : UNTRAINED);

    function assign(e, k, why) {
      const from = e.proc;
      if (from) byProc[from].splice(byProc[from].indexOf(e), 1);
      e.proc = k; e.since = S.t;
      if (k) byProc[k].push(e);
      if (why === "start") return;
      // salir de un proceso y entrar en otro en el mismo momento es un solo cambio
      const last = e.moves[e.moves.length - 1];
      if (last && last.t === S.t && last.to === null) last.to = k;
      else e.moves.push({ t: S.t, from, to: k });
    }
    // quién entra en un proceso: primero quien acaba de salir de otro y sabe hacerlo, luego su equipo habitual,
    // después los formados y, si no queda nadie, alguien sin formación o un temporal de ETT
    function candidate(k, released) {
      const free = people.filter((e) => !e.proc && e.team === teamOf(k));
      const score = (e) => (released.includes(e) && e.skills.includes(k) ? 0 : 10) + (e.primary === k ? 0 : e.skills.includes(k) ? 3 : 6) + (e.bench ? 1 : 0);
      free.sort((a, b) => score(a) - score(b) || people.indexOf(a) - people.indexOf(b));
      if (free.length) return free[0];
      temps++;
      const t = { id: "T-" + String(temps).padStart(2, "0"), name: `Temporal ${temps}`, team: teamOf(k), primary: k, skills: [k], tenure: 0, speed: 0.8, care: 1.6, bench: true, temp: true,
        proc: null, since: null, units: {}, minutes: {}, missorts: 0, moves: [] };
      people.push(t);
      return t;
    }

    // Registro de cambios de proceso del turno, para la actividad y la pestaña de plantilla
    const moves = [];
    // Ajusta quién trabaja en cada proceso a lo que dice S.staff. Devuelve los cambios hechos.
    function sync(why, target) {
      target = target || S.staff;
      const released = [], touched = new Set();
      for (const k of PROCS) {
        // sale primero quien sabe hacer un proceso al que le falta gente (es un cambio de puesto),
        // luego quien no es de ese proceso y, entre iguales, quien entró el último
        const need = PROCS.filter((x) => byProc[x].length < (target[x] || 0));
        const useful = (e) => need.some((x) => e.skills.includes(x));
        while (byProc[k].length > (target[k] || 0)) {
          const e = byProc[k].slice().sort((a, b) => useful(b) - useful(a) || (a.primary === k) - (b.primary === k) || b.since - a.since)[0];
          assign(e, null, why); released.push(e); touched.add(e);
        }
      }
      for (const k of PROCS) {
        while (byProc[k].length < (target[k] || 0)) { const e = candidate(k, released); assign(e, k, why); touched.add(e); }
      }
      if (why === "start" || why === "preview") return [...touched];
      const changes = [...touched].map((e) => ({ t: S.t, id: e.id, name: e.name, ...e.moves[e.moves.length - 1] }));
      moves.push(...changes);
      return changes;
    }
    // Mover a una persona concreta (desde la pestaña de plantilla): cambia también el recuento del proceso
    function move(e, k) {
      if (e.proc === k) return null;
      if (e.proc) S.staff[e.proc]--;
      if (k) S.staff[k]++;
      assign(e, k, "manual");
      const c = { t: S.t, id: e.id, name: e.name, ...e.moves[e.moves.length - 1] };
      moves.push(c);
      return c;
    }
    sync("start");

    // Qué pasaría con otro reparto, sin cambiar nada: quién entraría y saldría de cada proceso
    // y a qué ritmo iría cada equipo. Se aplica el mismo criterio que al cambiar la plantilla de verdad
    // y luego se deshace todo.
    function preview(target) {
      const saved = people.map((e) => [e, e.proc, e.since, e.moves.length]), was = new Map(saved.map((x) => [x[0], x[1]]));
      const n = people.length, t0 = temps, m0 = moves.length;
      const before = {}; for (const k of PROCS) before[k] = byProc[k].slice();
      try {
        sync("preview", target);
        const factors = {}; for (const k of PROCS) factors[k] = factor(k);
        const joins = [], leaves = [];
        for (const k of PROCS) {
          for (const e of byProc[k]) if (!before[k].includes(e)) joins.push({ id: e.id, name: e.name, to: k, from: was.get(e) || null, eff: eff(e, k), temp: !!e.temp, trained: e.skills.includes(k) });
          for (const e of before[k]) if (!byProc[k].includes(e)) leaves.push({ id: e.id, name: e.name, from: k, eff: eff(e, k) });
        }
        return { factors, joins, leaves };
      } finally {
        for (const [e, proc, since, ml] of saved) { e.proc = proc; e.since = since; e.moves.length = ml; }
        people.length = n; temps = t0; moves.length = m0;
        for (const k of PROCS) { byProc[k].length = 0; byProc[k].push(...before[k]); }
      }
    }

    // Ritmo medio del equipo de un proceso (1 = el equipo habitual)
    function factor(k) {
      const g = byProc[k];
      // redondeado a milésimas: el equipo habitual da exactamente 1 y la partida no cambia por decimales
      return g.length ? Math.round((g.reduce((s, e) => s + eff(e, k), 0) / g.length) * 1000) / 1000 : 1;
    }

    // Quién hace la siguiente unidad: al azar, con más probabilidad quien va más rápido
    function pick(k, weight) {
      const g = byProc[k]; if (!g || !g.length) return null;
      let tot = 0; for (const e of g) tot += weight(e);
      let x = rand() * tot;
      for (const e of g) { x -= weight(e); if (x <= 0) return e; }
      return g[g.length - 1];
    }
    function work(k, n) {
      const e = pick(k, (e) => eff(e, k));
      if (e) e.units[k] = (e.units[k] || 0) + (n || 1);
      return e;
    }
    // El missort se atribuye a un stower, con más probabilidad a quien es menos cuidadoso
    function missort() {
      const e = pick("stow", (e) => eff(e, "stow") * e.care * (e.primary === "stow" ? 1 : 1.5));
      if (e) e.missorts++;
      return e;
    }
    function tick(active, dt) {
      for (const k of PROCS) if (active[k]) for (const e of byProc[k]) e.minutes[k] = (e.minutes[k] || 0) + dt;
    }

    // Métricas por persona. targets: UPH objetivo por proceso.
    // La UPH es por hora fichada, así que las esperas del proceso bajan a todo el equipo por igual: para saber
    // quién va bien o mal se compara cada persona con la media de su proceso (vs equipo), no solo con el objetivo.
    function stats(targets) {
      const team = {};
      for (const k of PROCS) {
        let u = 0, m = 0;
        for (const e of people) if ((e.minutes[k] || 0) > 15) { u += e.units[k] || 0; m += e.minutes[k]; }
        team[k] = m ? u / (m / 60) : null;
      }
      return people.map((e) => {
        const procs = PROCS.filter((k) => e.minutes[k] > 0 || e.units[k] > 0).map((k) => {
          const h = (e.minutes[k] || 0) / 60, u = e.units[k] || 0, uph = h > 0.25 ? u / h : null;
          const counts = k !== "ps" && !MARSHALS.includes(k);
          return { key: k, hours: h, units: u, uph, target: targets[k], ratio: uph != null && counts ? uph / targets[k] : null,
            vsTeam: uph != null && team[k] ? uph / team[k] : null };
        });
        const hours = procs.reduce((s, p) => s + p.hours, 0), units = procs.reduce((s, p) => s + p.units, 0);
        // medias ponderadas por las horas en cada proceso (problem solve no tiene objetivo por unidades)
        const wavg = (f) => {
          const r = procs.filter((p) => p[f] != null && p.key !== "ps" && !MARSHALS.includes(p.key)), h = r.reduce((s, p) => s + p.hours, 0);
          return h > 0.25 ? r.reduce((s, p) => s + p[f] * p.hours, 0) / h : null;
        };
        const ratio = wavg("ratio"), vsTeam = wavg("vsTeam");
        const stowed = e.units.stow || 0;
        const missortRate = stowed >= 50 ? e.missorts / stowed : null;
        return {
          id: e.id, name: e.name, team: e.team, primary: e.primary, skills: e.skills, tenure: e.tenure, temp: !!e.temp, bench: e.bench,
          proc: e.proc, since: e.since, hours, units, ratio, vsTeam, missorts: e.missorts, missortRate, procs, moves: e.moves.slice(),
          // avisos para el responsable: por debajo del 90% de su equipo, o missort claramente por encima del 0,5% objetivo con volumen suficiente
          flag: missortRate != null && stowed >= 500 && missortRate > 0.006 ? "quality" : vsTeam != null && vsTeam < 0.9 ? "low" : vsTeam != null && vsTeam >= 1.08 ? "top" : null,
        };
      });
    }

    return { people, byProc, sync, move, factor, work, missort, tick, stats, moves, eff, teamOf, preview };
  }

  const api = { create, roster, PROCS, MARSHALS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSCrew = api;
})(typeof window !== "undefined" ? window : globalThis);
