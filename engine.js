// Motor de la simulación: estado, reglas y métricas de la estación. No toca el DOM,
// así que se puede ejecutar y probar en Node (ver test/).
(function (root) {
  "use strict";
  const DSCrew = typeof module !== "undefined" && module.exports ? require("./crew.js") : root.DSCrew;

  // Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma partida
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Geometría del plano (compartida con el render) ─────
  function geometry(L) {
    const D = L.docks, R = L.receive, ST = L.stow, P = L.pick, Y = L.yard;
    const LANE_LEFT = 112, LANE_GAP = 12;
    // cada pasillo tiene estanterías y cada estantería una balda por ruta
    const racks = ST.racksPerAisle || ST.routesPerAisle, shelves = ST.shelves || 1;
    const rackW = (ST.w - 24) / racks, shelfTop = shelves > 1 ? 28 : 38, shelfH = (ST.h - shelfTop - 6) / shelves;
    // carros de pick: una celda por ruta, en filas dentro de la franja de su pasillo
    const cartCols = shelves > 1 ? 4 : 2, cartRows = Math.ceil(ST.routesPerAisle / cartCols);
    const cartW = (P.w - 12) / cartCols, cartH = Math.min(25, (ST.h - 8) / cartRows);
    // plazas del yard: la mitad de columnas a cada lado del carril central
    const padCols = Y.padCols || 2, perSide = padCols / 2, padRows = Math.ceil(Y.pads / padCols);
    const g = {
      dockX: (i) => D.left + ((D.right - D.left) / D.count) * (i + 0.5),
      beltY: (a) => a.y + 20,
      bagRect(r) {
        const a = ST.aisles[r.aisle], rack = Math.floor(r.j / shelves), shelf = r.j % shelves;
        return { x: ST.x + 12 + rack * rackW + 3, y: a.y + shelfTop + shelf * shelfH + 1, w: rackW - 6, h: shelfH - 2 };
      },
      cartRect(r) {
        const a = ST.aisles[r.aisle], col = r.j % cartCols, row = Math.floor(r.j / cartCols);
        return { x: P.x + 6 + col * cartW + 1, y: a.y + 4 + row * cartH, w: cartW - 2, h: cartH - 2 };
      },
      padRect(i) {
        const side = i % 2, k = Math.floor(i / 2), col = k % perSide, row = Math.floor(k / perSide);
        const lane = 56, w = (Y.w - 24 - lane) / padCols, h = (Y.h - 80) / padRows;
        const x0 = side ? Y.x + Y.w - 12 - perSide * w : Y.x + 12;
        return { x: x0 + col * w + 2, y: Y.y + 40 + row * h, w: w - 4, h: h - 10 };
      },
      // carriles de la zona de carros: un grupo por bloque de pasillos, un carril por tamaño
      laneRect(l) {
        const gw = (R.w - LANE_LEFT - 8 - LANE_GAP * (R.groups.length - 1)) / R.groups.length;
        const lw = gw / R.classes.length;
        return { x: R.x + LANE_LEFT + l.gi * (gw + LANE_GAP) + l.ci * lw + 2, y: R.y + 26, w: lw - 4, h: R.h - 34 };
      },
      center: (z) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 }),
    };
    g.mid = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    g.bagCenter = (r) => g.mid(g.bagRect(r));
    g.cartCenter = (r) => g.mid(g.cartRect(r));
    g.padCenter = (i) => g.mid(g.padRect(i));
    g.laneCenter = (l) => { const r = g.laneRect(l); return { x: r.x + r.w / 2, y: r.y + 24 }; };
    return g;
  }

  // Posición de algo que recorre una polilínea
  function posOf(tr) {
    let d = tr.d;
    for (let i = 0; i < tr.segs.length; i++) {
      if (d <= tr.segs[i] || i === tr.segs.length - 1) {
        const f = tr.segs[i] ? Math.min(d / tr.segs[i], 1) : 1, a = tr.pts[i], b = tr.pts[i + 1];
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      d -= tr.segs[i];
    }
    return tr.pts[tr.pts.length - 1];
  }

  // "05:30" → minutos desde el inicio del turno. Hasta 2 h antes del inicio es el mismo turno (un camión que
  // llega antes de que entre el equipo); lo demás que cae antes del inicio es del día siguiente
  function toShift(hhmm, shiftStart) {
    const [h, m] = String(hhmm).split(":").map(Number);
    let t = h * 60 + m - shiftStart;
    if (t < -120) t += 1440;
    else if (t >= 1440 - 120) t -= 1440;
    return t;
  }

  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  // Paso fijo de la simulación (3 s simulados). Con paso fijo la misma partida se puede repetir exacta,
  // que es lo que usa project() para simular el resto del turno con otro reparto.
  const DT = 0.05;
  // Rendimiento real medio frente al nominal, medido con la simulación: el sort pierde algo en esperas y en
  // el reparto entre pasillos, y el pick en cambiar de ruta y de carro.
  // Inducción y carros pierden más porque trabajan a golpes, según llegan los carros.
  const FLOW = { receive: 0.88, induct: 0.87, stow: 0.95, ps: 1 }, PICK_FLOW = 0.95;
  const trim = (a, n) => { if (a.length > n) a.splice(0, a.length - n); };

  // opts: { seed, shift (sustituye a L.shift), staff (plantilla inicial), routeWeights (volumen por ruta), hooks: { log(msg, kind), fx(kind, data), now() } }
  function create(L, opts) {
    opts = opts || {};
    const spec = { L, opts: { ...opts, hooks: undefined } };
    // un turno puede empezar a otra hora (p. ej. el de tarde): el reloj de toda la partida se mueve con él
    const SH = opts.shift || L.shift;
    if (SH.start) { const [h, m] = SH.start.split(":").map(Number); L = { ...L, shiftStart: h * 60 + m }; }
    const hooks = Object.assign({ log() {}, fx() {}, now: () => 0 }, opts.hooks);
    const rand = rng(opts.seed == null ? 7 : opts.seed);
    // los high value salen de su propio generador: marcarlos no cambia el resto de la partida
    const hvRand = rng((opts.seed == null ? 7 : opts.seed) * 31 + 5), HV = L.highValue || { share: 0 };
    const D = L.docks, R = L.receive, I = L.induct, CV = L.conveyor, ST = L.stow, P = L.pick, Y = L.yard, PS = L.problem, Q = L.quality;
    // marshals: un plano sin ellos (p. ej. uno antiguo) funciona igual, con cero personas
    const DM = D.marshal || { staff: 0, checkInMin: 0, selfCheckInMin: 0, unloadNoMarshal: 1 };
    const YM = Y.marshal || { staff: 0, before: 15, parkNoMarshal: 1, loadNoMarshal: 1 };
    const geo = geometry(L);
    const at = (hhmm) => toShift(hhmm, L.shiftStart);

    // ── Estado ────────────────────────────────────────────
    const S = {
      t: 0, auto: true, over: false, endAt: null, sortDoneAt: null,
      pkgs: new Map(),
      trucks: [], vans: [], transit: [],
      inductQ: [], moves: [], nextCart: 1,
      acc: { induct: 0, pick: 0 },
      staff: { receive: R.staff, induct: I.staff, stow: ST.staff, pick: P.staff, ps: PS.staff, dock: DM.staff, yard: YM.staff, ...opts.staff },
      gate: [],                 // camiones en la puerta, esperando el check-in o un muelle libre
      noMarshal: { dock: 0, yard: 0 }, // minutos en los que hacía falta un marshal y no había
      steps: 0, actions: [],    // pasos dados y acciones del usuario, para poder repetir la partida
      totals: {}, procMin: {},  // paquetes y minutos-persona de cada proceso en todo el turno
      aisles: ST.aisles.map((a, i) => ({ ...a, idx: i, queue: [], acc: 0, done: 0 })),
      routes: [],
      received: 0, stowed: 0, sorted: 0, dispatched: 0, delivered: 0, routesOut: 0, routesLate: 0,
      deliveries: [],
      stowLog: [], dockToStow: [], vanTimes: [],
      history: [], lastMinute: 0,
      nextTruck: 101, nextVan: 1, waitLogged: {},
      // productividad real de cada proceso: varía alrededor de 1 durante el turno
      eff: { receive: 1, induct: 1, stow: 1, pick: 1, ps: 1 },
      flow: { receive: [], induct: [], stow: [], pick: [], load: [], ps: [], dock: [], yard: [] }, // unidades por minuto
      // calidad
      psQ: [], psAcc: 0, psTimes: [], conveyorDown: false,
      issues: { damaged: 0, noLabel: 0, missort: 0 }, writtenOff: 0, unsorted: 0,
      hourly: [],               // por hora del turno: { stow, induct, pick, staff }
      laborMin: 0,              // minutos-persona trabajados
      cyc: { dockInduct: [0, 0], inductStow: [0, 0], stowPick: [0, 0], pickOut: [0, 0] },
      events: [],
      hv: [],                   // paquetes high value del turno, para seguirlos uno a uno
    };

    // Rutas: N por pasillo, con peso de volumen distinto para que unas se llenen antes
    S.aisles.forEach((a) => {
      for (let j = 0; j < ST.routesPerAisle; j++) {
        const n = a.idx * ST.routesPerAisle + j + 1;
        S.routes.push({
          n, code: "R" + String(n).padStart(ST.aisles.length * ST.routesPerAisle > 99 ? 3 : 2, "0"), aisle: a.idx, j,
          town: L.towns[(n * 3) % L.towns.length],
          weight: 0.5 + rand() * 1.2,  // peso de volumen; un CSV importado lo sustituye por el volumen real
          bag: [], cart: [], van: null, out: 0,
          upstream: 0,          // paquetes de la ruta que aún no han llegado a su saca
          picking: false, dispatched: false, departAt: null, late: false, wave: null,
        });
      }
    });
    // una ruta sin volumen no sale esa noche: no entra en ninguna oleada ni en los totales
    if (opts.routeWeights) S.routes.forEach((r, i) => { r.weight = opts.routeWeights[i] || 0; r.off = !r.weight; });
    const totalWeight = () => S.routes.reduce((s, r) => s + r.weight, 0);

    // Plan del turno: camiones programados y oleadas de salida
    S.plan = {
      // hold: carga para el sort de la noche (llega por la tarde, se descarga y se deja en la playa sin procesar)
      trucks: SH.trucks.map((x, i) => ({ id: "T-" + String(i + 1).padStart(2, "0"), at: at(x.at), units: x.units, state: "pending", hold: !!x.hold })),
      cutoff: at(SH.sortCutoff),
      events: (SH.events || []).map((e) => ({ ...e, at: e.at ? at(e.at) : null, state: "pending" })),
      waves: SH.waves.map((w, i) => {
        const aisleIdx = w.aisles.map((id) => ST.aisles.findIndex((a) => a.id === id));
        // routes: [desde, hasta] dentro del pasillo (1 = la primera ruta del pasillo); sin él, el pasillo entero
        const [lo, hi] = w.routes || [1, ST.routesPerAisle];
        const routes = S.routes.filter((r) => !r.off && aisleIdx.includes(r.aisle) && r.j + 1 >= lo && r.j + 1 <= hi).map((r) => r.n);
        return { n: i + 1, at: at(w.at), deadline: at(w.at) + SH.loadWindow, routes, pickStarted: false, called: false };
      }),
    };
    // eta: hora real de llegada. Un retraso solo se conoce cuando el camión no aparece a su hora
    for (const pt of S.plan.trucks) {
      const late = S.plan.events.find((e) => e.type === "truckLate" && e.truck === pt.id);
      pt.eta = pt.at; pt.delay = late ? late.minutes : 0;
    }
    // el volumen y la ventana del sort son solo de lo que se procesa en este turno
    const sortTrucks = S.plan.trucks.filter((x) => !x.hold);
    S.plan.volume = sortTrucks.reduce((s, x) => s + x.units, 0);
    S.plan.holdVolume = S.plan.trucks.reduce((s, x) => s + (x.hold ? x.units : 0), 0);
    S.plan.firstTruck = Math.min(...sortTrucks.map((x) => x.at));
    S.plan.waves.forEach((w) => w.routes.forEach((n) => (S.routes[n - 1].wave = w)));
    S.plan.firstWave = Math.min(...S.plan.waves.map((w) => w.at));
    S.plan.pickStart = S.plan.firstWave - SH.pickLead;
    S.plan.end = Math.max(...S.plan.waves.map((w) => w.deadline + SH.maxWait));
    // Horario del equipo de noche: entra a sortStart y para en los descansos (todo el sort a la vez).
    // Sin horario en el plan, el equipo llega un cuarto de hora antes del primer camión y no para.
    S.plan.sortStart = SH.sortStart ? at(SH.sortStart) : S.plan.firstTruck - 15;
    S.plan.nightEnd = SH.nightEnd ? at(SH.nightEnd) : null;
    S.plan.breaks = (SH.breaks || []).map((b) => ({ from: at(b.at), to: at(b.at) + b.minutes, minutes: b.minutes }));
    // paquetes de la carga de la noche descargados en este turno (se quedan en la playa)
    S.held = 0;

    // Plantilla con nombre: quién está en cada proceso (opts.crew = false la desactiva)
    const crew = DSCrew && opts.crew !== false ? DSCrew.create(L, S, { seed: opts.seed }) : null;
    S.crew = crew;
    const by = (who) => (who ? ` por ${who.name} (${who.id})` : "");
    const PNAME = { receive: "la zona de carros", induct: "inducción", stow: "stow", pick: "pick", ps: "problem solve", dock: "dock marshall", yard: "yard marshall" };
    // los cambios de plantilla (planificador, recomendaciones) se reflejan en quién trabaja dónde
    function syncCrew() {
      if (!crew) return;
      for (const c of crew.sync()) log(c.from && c.to ? `${c.name} (${c.id}) pasa de ${PNAME[c.from]} a ${PNAME[c.to]}` : c.to ? `${c.name} (${c.id}) entra en ${PNAME[c.to]}` : `${c.name} (${c.id}) sale de ${PNAME[c.from]}`);
    }

    // Zona de carros: un carril por grupo y tamaño
    const groupOfAisle = (ai) => R.groups.findIndex((g) => g.aisles.includes(ai));
    S.lanes = [];
    // held: carros de la carga de la noche, aparcados en la playa de su grupo hasta el sort de la noche
    R.groups.forEach((g, gi) => R.classes.forEach((c, ci) => S.lanes.push({ gi, ci, group: g, cls: c, open: null, closed: [], holdOpen: null, held: [] })));
    const laneOf = (p) => S.lanes.find((l) => l.gi === p.group && l.cls.id === p.cls);

    function pickRoute() {
      let x = rand() * totalWeight();
      for (const r of S.routes) { x -= r.weight; if (x <= 0) return r; }
      return S.routes[S.routes.length - 1];
    }
    function stagingCount() {
      let n = 0;
      for (const l of S.lanes) { if (l.open) n += l.open.items.length; for (const c of l.closed) n += c.items.length; }
      return n;
    }
    function heldCount() {
      let n = 0;
      for (const l of S.lanes) { if (l.holdOpen) n += l.holdOpen.items.length; for (const c of l.held) n += c.items.length; }
      return n;
    }
    // rendimiento del momento: el del turno (S.eff) por el de las personas que hay en ese proceso
    const pf = (key) => (S.eff[key] || 1) * (crew ? crew.factor(key) : 1);
    const rate = (base, key, cfg) => ((base * S.staff[key]) / cfg.staff) * pf(key);

    // Contadores por minuto y por hora para los ritmos reales
    function count(key, n) {
      const m = Math.floor(S.t), f = S.flow[key];
      f[m] = (f[m] || 0) + (n || 1);
      const h = Math.floor(S.t / 60), H = S.hourly[h] || (S.hourly[h] = { stow: 0, induct: 0, pick: 0, load: 0, receive: 0 });
      H[key] = (H[key] || 0) + (n || 1);
      S.totals[key] = (S.totals[key] || 0) + (n || 1);
      return crew ? crew.work(key, n) : null;
    }
    // Paquetes por hora de un proceso en la última hora (o lo que va de turno)
    // (en el sort sin contar el descanso: esos minutos no se trabaja)
    function hourRate(key) {
      const f = S.flow[key], now = Math.floor(S.t), from = Math.max(S.plan.firstTruck, 0);
      const sortKey = key === "receive" || key === "induct" || key === "stow" || key === "ps";
      const span = sortKey ? Math.max(workBetween(Math.max(S.t - 60, from), S.t), 1) : Math.min(60, Math.max(S.t - from, 1));
      let n = 0;
      for (let m = now; m > now - 60; m--) n += f[m] || 0;
      return (n / Math.min(span, 60)) * 60;
    }
    const cycAdd = (k, v) => { S.cyc[k][0] += v; S.cyc[k][1]++; };

    function log(msg, kind) {
      S.events.unshift({ t: S.t, msg, kind: kind || "" });
      trim(S.events, 40);
      hooks.log(msg, kind);
    }
    function hist(p, msg) { p.hist.push({ t: S.t, msg }); p.seenAt = S.t; }

    const SIZES = [["Sobre", 0.3, "S"], ["Pequeño", 1.2, "S"], ["Mediano", 3.5, "M"], ["Oversize", 9, "O"]];
    function newPkg(truck) {
      let id;
      do { id = "DS" + String(Math.floor(rand() * 1e8)).padStart(8, "0"); } while (S.pkgs.has(id));
      const r = pickRoute(), sz = SIZES[Math.floor(rand() ** 1.6 * SIZES.length)];
      r.upstream++; S.unsorted++;
      const p = {
        id, route: r.n, size: sz[0], cls: sz[2], group: groupOfAisle(r.aisle), weight: +(sz[1] * (0.6 + rand() * 0.8)).toFixed(1),
        cp: "11" + String(Math.floor(rand() * 690) + 1).padStart(3, "0"),
        truck: truck.id, sorted: false, where: "truck", hist: [], unloadedAt: S.t,
      };
      hist(p, `Descargado del camión ${truck.id} · muelle ${truck.dock + 1}`);
      if (hvRand() < HV.share) {
        p.hv = true; p.value = Math.round((HV.min + hvRand() ** 2 * (HV.max - HV.min)) / 5) * 5;
        S.hv.push(p);
      }
      S.pkgs.set(id, p);
      if (S.pkgs.size > 60000) {
        for (const [k, v] of S.pkgs) { if (S.pkgs.size < 50000) break; if (v.where === "delivered" && k !== S.tracked && !v.hv) S.pkgs.delete(k); }
      }
      return p;
    }

    // Paquete de la carga de la noche: no tiene ruta de este turno, solo su grupo (por pasillos) y su tamaño
    function newHeld(truck) {
      let id;
      do { id = "DS" + String(Math.floor(rand() * 1e8)).padStart(8, "0"); } while (S.pkgs.has(id));
      const sz = SIZES[Math.floor(rand() ** 1.6 * SIZES.length)];
      // cada grupo recibe en proporción a sus pasillos
      let x = rand() * ST.aisles.length, group = 0;
      for (let gi = 0; gi < R.groups.length; gi++) { x -= R.groups[gi].aisles.length; if (x < 0) { group = gi; break; } }
      const p = { id, route: null, size: sz[0], cls: sz[2], group, weight: +(sz[1] * (0.6 + rand() * 0.8)).toFixed(1),
        cp: "11" + String(Math.floor(rand() * 690) + 1).padStart(3, "0"), truck: truck.id, sorted: false, hold: true, where: "truck", hist: [], unloadedAt: S.t };
      hist(p, `Descargado del camión ${truck.id} · muelle ${truck.dock + 1} · para el sort de la noche`);
      S.pkgs.set(id, p);
      return p;
    }

    // ── Tránsito por polilínea ────────────────────────────
    function send(pkg, pts, dest, extra) {
      let total = 0; const segs = [];
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(l); total += l; }
      const tr = { pkg, pts, segs, total: Math.max(total, 1), d: 0, dest, ...extra };
      pkg.where = "transit"; pkg.tr = tr;
      S.transit.push(tr);
    }

    function arrive(tr) {
      const p = tr.pkg; p.tr = null;
      const r = S.routes[p.route - 1];
      switch (tr.dest) {
        case "receive": {
          const l = laneOf(p);
          if (!l.open) l.open = { id: "C-" + String(S.nextCart++).padStart(3, "0"), items: [], openedAt: S.t };
          l.open.items.push(p); l.open.touchedAt = S.t; l.open.bump = hooks.now();
          p.where = "staging"; p.cartId = l.open.id;
          hist(p, `Recepción · carro ${l.open.id} (${l.group.id} · ${l.cls.name.toLowerCase()})`);
          if (l.open.items.length >= l.cls.cap) { l.open.closedAt = S.t; l.closed.push(l.open); l.open = null; }
          break;
        }
        case "hold": {
          const l = laneOf(p);
          if (!l.holdOpen) l.holdOpen = { id: "C-" + String(S.nextCart++).padStart(3, "0"), items: [], openedAt: S.t, hold: true };
          l.holdOpen.items.push(p); l.holdOpen.touchedAt = S.t;
          p.where = "held"; p.cartId = l.holdOpen.id;
          hist(p, `En la playa · carro ${l.holdOpen.id} (${l.group.id} · ${l.cls.name.toLowerCase()}), hasta el sort de la noche (ciclo 1)`);
          if (l.holdOpen.items.length >= l.cls.cap) { l.held.push(l.holdOpen); l.holdOpen = null; }
          break;
        }
        case "induct": p.where = "induct"; S.inductQ.push(p); break;
        case "aisle": p.where = "aisle"; S.aisles[r.aisle].queue.push(p); break;
        case "bag": {
          // tr.bag: la saca en la que realmente cae (distinta de su ruta si es un missort)
          const br = S.routes[(tr.bag || p.route) - 1];
          p.where = "bag"; p.bag = br.n; br.bag.push(p); S.stowed++; S.stowLog.push(S.t);
          // para el sort cuenta el primer stow, aunque sea en la saca equivocada
          if (!p.stowedOnce) { p.stowedOnce = true; S.unsorted--; }
          br.bump = hooks.now();
          hooks.fx("stow", { route: br });
          if (br !== r) { hist(p, `Stow por error en la saca ${br.code}${by(p.stowBy)} (su ruta es ${r.code})`); break; }
          S.sorted++; r.upstream--;
          p.stowAt = S.t; if (p.inductAt != null) cycAdd("inductStow", S.t - p.inductAt);
          if (r.dispatched) hist(p, `Llega tarde: la furgoneta de ${r.code} ya salió (rollover)`);
          S.dockToStow.push(S.t - p.unloadedAt); trim(S.dockToStow, 120);
          hist(p, `Stow en la saca ${r.code}${by(p.stowBy)} · pasillo ${ST.aisles[r.aisle].id}`);
          break;
        }
        case "ps": p.where = "ps"; p.psAt = S.t; S.psQ.push(p); break;
        case "cart": p.where = "cart"; r.cart.push(p); p.pickAt = S.t; if (p.stowAt != null) cycAdd("stowPick", S.t - p.stowAt); hist(p, `Pick · carro de ${r.code}`); break;
        case "van": {
          const v = S.vans.find((x) => x.id === tr.van);
          p.where = "van"; p.van = tr.van; count("load");
          if (v) { v.incoming--; v.loaded++; v.items.push(p); v.bump = hooks.now(); }
          hist(p, `Cargado en la furgoneta ${tr.van}`);
          break;
        }
      }
    }

    // ── Problem solve ─────────────────────────────────────
    const psIn = () => ({ x: PS.x + PS.w / 2, y: PS.y + PS.h - 14 });
    function toPS(p, issue, from) {
      p.issue = issue; S.issues[issue]++;
      const label = { damaged: "dañado", noLabel: "etiqueta ilegible", missort: "mal clasificado" }[issue];
      hist(p, `A problem solve: ${label}`);
      // por el pasillo bajo la zona de carros (o por el lateral de las sacas) hasta problem solve
      const gy = R.y + R.h + 8, c = psIn();
      const pts = from.y > gy + 10
        ? [from, { x: ST.x + ST.w + 8, y: from.y }, { x: ST.x + ST.w + 8, y: gy }, { x: c.x, y: gy }, c]
        : [from, { x: from.x, y: gy }, { x: c.x, y: gy }, c];
      send(p, pts, "ps");
    }
    function resolvePS(p) {
      const r = S.routes[p.route - 1];
      S.psTimes.push(S.t - p.psAt); trim(S.psTimes, 200); count("ps");
      if (p.issue === "damaged" && rand() < Q.writeOff) {
        p.where = "writtenoff"; S.writtenOff++; r.upstream--; if (!p.stowedOnce) S.unsorted--;
        hist(p, "Sin arreglo: se da de baja y se avisa al cliente");
        return;
      }
      const c = psIn(), gy = R.y + R.h + 8;
      if (p.issue === "missort") {
        // ya sabemos su ruta: va directo a su saca
        const b = geo.bagCenter(r);
        hist(p, `Resuelto: vuelve a la saca de ${r.code}`);
        send(p, [c, { x: c.x, y: gy }, { x: ST.x + ST.w + 8, y: gy }, { x: ST.x + ST.w + 8, y: b.y }, b], "bag");
      } else {
        hist(p, p.issue === "damaged" ? "Reembalado: vuelve a inducción" : "Reetiquetado: vuelve a inducción");
        send(p, [c, { x: c.x, y: gy }, { x: I.x + I.w / 2, y: gy }, { x: I.x + I.w / 2, y: I.y + I.h - 22 }], "induct");
      }
    }

    // ── Acciones ──────────────────────────────────────────
    // Devuelven un texto cuando no se pueden hacer, para que la interfaz lo muestre
    function freeDock() {
      const used = new Set(S.trucks.map((t) => t.dock));
      const free = [...Array(D.count).keys()].filter((i) => !used.has(i));
      return free.length ? free[Math.floor(rand() * free.length)] : -1;
    }
    function dockTruck(id, units, dock, who, hold) {
      const t = { id, dock, units, total: units, state: "arriving", p: 0, acc: 0, hold: !!hold };
      S.trucks.push(t);
      log(`Camión ${t.id} atraca en el muelle ${dock + 1} con ${units} paquetes${hold ? " para la noche: se descargan y se dejan en la playa" : ""}${who ? ` · check-in${by(who)}` : ""}`, "in");
      return t;
    }
    // Camión extra, fuera del plan: pasa por el check-in como los demás
    function addTruck() {
      if (S.trucks.length + S.gate.length >= D.count) return `Los ${D.count} muelles están ocupados`;
      const units = Math.round(D.truckUnits * (0.7 + rand() * 0.6));
      toGate({ id: "T-" + S.nextTruck++, units });
    }
    // Llegada a la puerta. Sin dock marshall el conductor se coordina como puede y tarda bastante más en atracar
    function toGate(g) {
      g.at = S.t; S.gate.push(g);
      if (!S.staff.dock) log(`Camión ${g.id} en la puerta sin dock marshall: espera unos ${DM.selfCheckInMin} min para atracar`, "warn");
    }
    // Check-in: cada dock marshall atiende un camión cada vez, por orden de llegada; luego el camión atraca si hay muelle
    function checkIn() {
      const n = S.staff.dock;
      let busy = S.gate.filter((g) => g.checkEnd != null && !g.checked && !g.self).length;
      for (const g of S.gate) {
        if (g.checkEnd != null) continue;
        if (!n) { g.self = true; g.checkEnd = S.t + DM.selfCheckInMin; continue; }
        if (busy >= n) break;
        g.checkEnd = S.t + DM.checkInMin / pf("dock"); busy++;
      }
      for (const g of S.gate) {
        if (g.checked || g.checkEnd == null || S.t < g.checkEnd) continue;
        g.checked = true;
        if (!g.self) { const who = count("dock"); g.by = who; }
      }
      for (const g of S.gate) {
        if (!g.checked) continue;
        const dock = freeDock();
        if (dock < 0) { if (!S.waitLogged[g.id]) { S.waitLogged[g.id] = true; log(`Camión ${g.id} espera muelle libre`, "warn"); } break; }
        g.done = true;
        if (g.plan) { g.plan.state = "docked"; g.plan.dockedAt = S.t; }
        dockTruck(g.id, g.units, dock, g.by, g.plan && g.plan.hold);
      }
      S.gate = S.gate.filter((g) => !g.done);
    }

    function freePad() {
      const used = new Set(S.vans.map((v) => v.pad));
      for (let i = 0; i < Y.pads; i++) if (!used.has(i)) return i;
      return -1;
    }

    // Paquetes de una ruta que quedan por recoger de sus sacas
    const toPick = (r) => (r.picking && !r.dispatched ? r.bag.length : 0);

    function startPick(r) {
      if (r.picking || r.dispatched) return;
      r.picking = true;
    }

    // Furgoneta para una ruta: la de su oleada o una llamada a mano (adelanta la salida)
    function callVan(route, wave) {
      if (!route) {
        route = S.routes.filter((r) => !r.van && !r.dispatched && r.bag.length).sort((a, b) => b.bag.length - a.bag.length)[0];
        if (!route) return "No hay rutas con paquetes esperando furgoneta";
      }
      if (route.dispatched) return `${route.code} ya ha salido`;
      if (route.van) return `${route.code} ya tiene furgoneta`;
      if (!wave && !route.bag.length && !route.cart.length) return `La saca de ${route.code} está vacía`;
      const pad = freePad();
      if (pad < 0) return "El yard está lleno";
      const deadline = wave ? wave.deadline : S.t + SH.loadWindow;
      if (!S.staff.yard && wave && !S.waitLogged["yard" + wave.n]) { S.waitLogged["yard" + wave.n] = true; log(`Oleada ${wave.n} sin yard marshall: las furgonetas tardan en colocarse y cargan más despacio`, "warn"); }
      const v = { id: "V-" + String(S.nextVan++).padStart(3, "0"), route: route.n, pad, state: "arriving", p: 0, acc: 0,
        loaded: 0, incoming: 0, items: [], calledAt: S.t, deadline, manual: !wave };
      route.van = v; route.deadline = deadline;
      startPick(route);
      S.vans.push(v);
      log(`Furgoneta ${v.id} para ${route.code} (${route.town}) · plaza ${pad + 1}${wave ? ` · oleada ${wave.n}` : " · llamada a mano"}`, "out");
    }

    function depart(v) {
      const r = S.routes[v.route - 1];
      v.state = "leaving"; v.p = 0; r.van = null; r.out += v.loaded;
      // sale en su minuto: si espera hasta el límite por paquetes que no llegan, sale a tiempo y esos se quedan (rollover)
      r.dispatched = true; r.departAt = S.t; r.late = S.t > v.deadline + 0.5;
      if (S.staff.yard) count("yard");
      hooks.fx("depart", { van: v, route: r });
      S.vanTimes.push(S.t - v.calledAt); trim(S.vanTimes, 100);
      S.routesOut++; if (r.late) S.routesLate++;
      S.dispatched += v.loaded;
      for (const p of v.items) {
        p.where = "route"; hist(p, `Sale a reparto · ${r.town}`);
        if (p.pickAt != null) cycAdd("pickOut", S.t - p.pickAt);
        S.deliveries.push({ at: S.t + 45 + rand() * 240, pkg: p });
      }
      const left = r.bag.length + r.cart.length + r.upstream;
      log(`Furgoneta ${v.id} sale con ${v.loaded} paquetes de ${r.code}${r.late ? " · TARDE" : " · a tiempo"}${left ? ` · ${left} se quedan (rollover)` : ""}`, r.late ? "bad" : "out");
    }

    const VEH = 1; // minutos simulados que tarda un vehículo en atracar o salir

    // Suma capacidad de un paso. El tope evita que un proceso parado acumule trabajo para luego,
    // pero deja pasar todo lo que da de sí en el paso aunque sea más de 3 paquetes
    const cap = (acc, add) => Math.min(acc + add, Math.max(3, add + 1));

    // ── Paso de simulación (dt en minutos simulados) ──────
    function step(dt) {
      dt = dt || DT;
      S.t += dt; S.steps++;
      syncCrew();
      // descanso o antes de entrar: el equipo de noche no descarga, no mueve carros, no induce ni hace stow
      const idle = sortIdle(S.t), brk = onBreak(S.t);
      if (brk !== !!S.onBreak) {
        S.onBreak = brk;
        const b = S.plan.breaks.find((x) => S.t >= x.from - 1 && S.t <= x.to + 1);
        if (brk) log(`Descanso del equipo de noche hasta las ${clock(L, b ? b.to : S.t)}: el sort se para`, "warn");
        else log("Fin del descanso: el sort sigue", "out");
      }

      // Camiones del plan: llegan a la puerta a su hora, pasan el check-in y atracan si hay muelle libre
      if (S.auto) for (const pt of S.plan.trucks) {
        if (pt.state !== "pending" || S.t < pt.at) continue;
        if (pt.delay && pt.eta === pt.at) { pt.eta = pt.at + pt.delay; log(`Camión ${pt.id} viene con ${pt.delay} min de retraso (llega a las ${clock(L, pt.eta)})`, "bad"); }
        if (S.t < pt.eta) continue;
        pt.state = "gate";
        toGate({ id: pt.id, units: pt.units, plan: pt });
      }
      checkIn();

      // Camiones
      for (const t of S.trucks) {
        if (t.state === "arriving") { t.p += dt / VEH; if (t.p >= 1) { t.state = "unloading"; t.p = 1; } }
        else if (t.state === "unloading") {
          if (idle) continue;
          // sin dock marshall nadie ordena muelles ni carros vacíos: la descarga va más lenta
          t.acc += (D.unloadRate / 60) * dt * (S.staff.dock ? 1 : DM.unloadNoMarshal);
          while (t.acc >= 1 && t.units > 0) {
            t.acc--; t.units--;
            if (t.hold) {
              // carga de la noche: del muelle a la playa de su grupo, sin pasar por inducción
              S.held++;
              const p = newHeld(t), x = geo.dockX(t.dock), lc = geo.laneCenter(laneOf(p));
              send(p, [{ x, y: D.wallY }, { x, y: R.y - 2 }, { x: lc.x, y: R.y - 2 }, { x: lc.x, y: lc.y }], "hold");
              continue;
            }
            S.received++;
            const p = newPkg(t), x = geo.dockX(t.dock);
            if (rand() < Q.damaged) { toPS(p, "damaged", { x, y: D.wallY }); continue; }
            const lc = geo.laneCenter(laneOf(p));
            send(p, [{ x, y: D.wallY }, { x, y: R.y - 2 }, { x: lc.x, y: R.y - 2 }, { x: lc.x, y: lc.y }], "receive");
          }
          if (!t.units) { t.state = "leaving"; t.p = 0; log(`Camión ${t.id} vacío, libera el muelle ${t.dock + 1}`, "in"); }
        } else t.p += dt / VEH;
      }
      S.trucks = S.trucks.filter((t) => !(t.state === "leaving" && t.p >= 1));

      // Zona de carros → Inducción: cuando inducción tiene hueco, se lleva el carro más antiguo
      for (const l of S.lanes) {
        if (l.open && l.open.items.length && S.t - l.open.touchedAt > R.staleMinutes) { l.open.closedAt = S.t; l.closed.push(l.open); l.open = null; }
        if (l.holdOpen && S.t - l.holdOpen.touchedAt > R.staleMinutes) { l.held.push(l.holdOpen); l.holdOpen = null; }
      }
      // se lleva otro carro si inducción no va a tener trabajo para cuando llegue (lo que espera + lo que ya va de camino)
      const buffer = Math.max(40, (rate(I.rate, "induct", I) / 60) * (R.moveMinutes + 1.5));
      let coming = S.moves.reduce((n, m) => n + m.cart.items.length, 0);
      while (!idle && S.moves.length < S.staff.receive && S.inductQ.length + coming < buffer) {
        let best = null;
        for (const l of S.lanes) if (l.closed.length && (!best || l.closed[0].closedAt < best.closed[0].closedAt)) best = l;
        if (!best) break;
        const cart = best.closed.shift(), from = geo.laneCenter(best);
        for (const p of cart.items) { p.where = "moving"; hist(p, `Carro ${cart.id} llevado a inducción`); }
        // el carro baja al pasillo bajo la zona de carros y va por él hasta inducción
        const gy = R.y + R.h + 8, pts = [from, { x: from.x, y: gy }, { x: I.x + I.w / 2, y: gy }, { x: I.x + I.w / 2, y: I.y + I.h - 22 }];
        const segs = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
        S.moves.push({ cart, lane: best, pts, segs, total: segs.reduce((a, b) => a + b, 0), p: 0 });
        coming += cart.items.length;
      }
      for (const m of S.moves) {
        if (idle) break;
        m.p += (dt * pf("receive")) / R.moveMinutes;
        if (m.p >= 1) { for (const p of m.cart.items) { p.where = "induct"; S.inductQ.push(p); } count("receive", m.cart.items.length); }
      }
      S.moves = S.moves.filter((m) => m.p < 1);

      // Inducción → conveyor → pasillo
      S.acc.induct = cap(S.acc.induct, (rate(I.rate, "induct", I) / 60) * dt);
      if (S.conveyorDown || idle) S.acc.induct = 0;
      while (S.acc.induct >= 1 && S.inductQ.length) {
        S.acc.induct--;
        const p = S.inductQ.shift(), r = S.routes[p.route - 1], a = ST.aisles[r.aisle];
        if (p.issue !== "noLabel" && rand() < Q.noLabel) { count("induct"); toPS(p, "noLabel", { x: I.x + I.w / 2, y: I.y + I.h - 22 }); continue; }
        p.sorted = true;
        const who = count("induct");
        hist(p, `Inducido${by(who)} · ruta ${r.code} → pasillo ${a.id}`);
        p.inductAt = S.t; cycAdd("dockInduct", S.t - p.unloadedAt);
        send(p, [{ x: CV.x, y: I.y + I.h - 10 }, { x: CV.x, y: geo.beltY(a) }, { x: ST.x + 8, y: geo.beltY(a) }], "aisle", { belt: true });
      }

      // Stow: cada pasillo con su parte de la plantilla
      // los stowers se reparten entre los pasillos según los paquetes que esperan en cada uno
      const waiting = S.aisles.reduce((n, a) => n + a.queue.length, 0);
      const stowRateNow = rate(ST.rate, "stow", ST);
      for (const a of S.aisles) {
        const share = waiting ? a.queue.length / waiting : 1 / S.aisles.length;
        a.acc = idle ? 0 : cap(a.acc, ((stowRateNow * share) / 60) * dt);
        while (a.acc >= 1 && a.queue.length) {
          a.acc--; a.done++;
          let who = count("stow");
          const p = a.queue.shift(), r = S.routes[p.route - 1];
          // missort: acaba en la saca de al lado
          let br = r;
          if (!p.issue && rand() < Q.missort) {
            br = S.routes[r.j < ST.routesPerAisle - 1 ? r.n : r.n - 2];
            S.issues.missort++; p.missorted = true;
            // el fallo se atribuye a un stower, con más probabilidad a quien es menos cuidadoso
            if (crew) who = crew.missort();
          }
          p.stowBy = who;
          const b = geo.bagCenter(br);
          send(p, [{ x: ST.x + 8, y: geo.beltY(a) }, { x: b.x, y: geo.beltY(a) }, b], "bag", { bag: br.n });
        }
      }

      // Oleadas: el pick de cada ruta empieza pickLead minutos antes y la furgoneta llega a la hora
      if (S.auto) for (const w of S.plan.waves) {
        if (!w.pickStarted && S.t >= w.at - SH.pickLead) {
          w.pickStarted = true;
          w.routes.forEach((n) => startPick(S.routes[n - 1]));
          log(`Empieza el pick de la oleada ${w.n} (${w.routes.length} rutas, salida ${clock(L, w.at)})`, "out");
        }
        if (S.t >= w.at) {
          let pending = 0;
          for (const n of w.routes) { const r = S.routes[n - 1]; if (!r.dispatched && !r.van && callVan(r, w)) pending++; }
          w.called = !pending;
        }
      }

      // Pick: primero las rutas de la oleada más temprana (y las llamadas a mano)
      S.acc.pick = cap(S.acc.pick, (rate(P.rate, "pick", P) / 60) * dt);
      if (S.acc.pick >= 1) {
        const queue = S.routes.filter((r) => toPick(r) > 0).sort((a, b) => (a.deadline ?? a.wave?.deadline ?? 1e9) - (b.deadline ?? b.wave?.deadline ?? 1e9) || a.n - b.n);
        // el equipo se reparte entre las dos primeras rutas de la cola
        let k = 0;
        while (S.acc.pick >= 1 && queue.length) {
          const i = k++ % Math.min(queue.length, 2), r = queue[i];
          if (!toPick(r)) { queue.splice(i, 1); continue; }
          S.acc.pick--;
          const who = count("pick"), p = r.bag.shift();
          const b = geo.bagCenter(r), c = geo.cartCenter(r);
          // el picker ve que el paquete no es de esta ruta (toPS lo vuelve a contar, de ahí el --)
          if (p.route !== r.n) { S.issues.missort--; toPS(p, "missort", b); continue; }
          hist(p, `Pick de la saca de ${r.code}${by(who)}`);
          send(p, [b, { x: ST.x + ST.w, y: b.y }, { x: P.x, y: c.y }, c], "cart");
        }
      }

      // Furgonetas
      for (const v of S.vans) {
        const r = S.routes[v.route - 1];
        // el yard marshall coloca cada furgoneta en su plaza; sin él tardan varios minutos en aparcar y cargan más despacio
        if (v.state === "arriving") { v.p += dt / (S.staff.yard ? VEH : YM.parkNoMarshal); if (v.p >= 1) { v.state = "loading"; v.p = 1; } }
        else if (v.state === "loading") {
          v.acc = cap(v.acc, (Y.loadRate / 60) * dt * (S.staff.yard ? 1 : YM.loadNoMarshal));
          while (v.acc >= 1 && r.cart.length) {
            v.acc--; v.incoming++;
            const p = r.cart.shift(), c = geo.cartCenter(r), pc = geo.padCenter(v.pad);
            send(p, [c, { x: P.x + P.w, y: c.y }, { x: Y.x + 6, y: pc.y }, pc], "van", { van: v.id });
          }
          const ready = !r.cart.length && !toPick(r) && !v.incoming && !inFlight(r);
          if ((ready && (r.upstream === 0 || S.t >= v.deadline)) || S.t >= v.deadline + SH.maxWait) depart(v);
        } else v.p += dt / VEH;
      }
      S.vans = S.vans.filter((v) => !(v.state === "leaving" && v.p >= 1));

      // Eventos programados: conveyor parado
      for (const ev of S.plan.events) {
        if (ev.type !== "conveyor") continue;
        if (ev.state === "pending" && S.t >= ev.at) { ev.state = "active"; S.conveyorDown = true; log(`Conveyor parado por avería (${ev.minutes} min previstos)`, "bad"); }
        if (ev.state === "active" && S.t >= ev.at + ev.minutes) { ev.state = "done"; S.conveyorDown = false; log("Conveyor en marcha otra vez", "out"); }
      }

      // Problem solve
      S.psAcc = brk ? 0 : cap(S.psAcc, (rate(PS.uph * PS.staff, "ps", PS) / 60) * dt);
      // cada incidencia lleva unos minutos de revisión (reetiquetar, reembalar, buscar su ruta)
      while (S.psAcc >= 1 && S.psQ.length && S.t - S.psQ[0].psAt >= PS.handleMin) { S.psAcc--; resolvePS(S.psQ.shift()); }
      if (!S.psQ.length) S.psAcc = Math.min(S.psAcc, 1);

      // Tránsito
      const still = [];
      for (const tr of S.transit) {
        if (!(tr.belt && S.conveyorDown)) tr.d += CV.speed * dt;
        if (tr.d >= tr.total) arrive(tr); else still.push(tr);
      }
      S.transit = still;

      // Entregas
      if (S.deliveries.length) {
        const rest = [];
        for (const d of S.deliveries) {
          if (d.at <= S.t) { d.pkg.where = "delivered"; hist(d.pkg, "Entregado al cliente"); S.delivered++; }
          else rest.push(d);
        }
        S.deliveries = rest;
      }

      // Horas trabajadas y deriva de la productividad (cada 10 min)
      // el equipo de sort trabaja de noche (hasta acabar el sort) y el de pick desde la primera oleada
      // el descanso no cuenta como hora trabajada
      const sortCrew = S.t >= S.plan.sortStart && S.sortDoneAt == null && !brk, pickCrew = S.t >= S.plan.pickStart && !S.over;
      const on = marshalsOn();
      const active = { receive: sortCrew, induct: sortCrew, stow: sortCrew, pick: pickCrew, ps: sortCrew || (pickCrew && !brk), dock: on.dock, yard: on.yard };
      for (const k of ["dock", "yard"]) if (on[k] && !S.staff[k]) S.noMarshal[k] += dt;
      // el dock marshall acaba cuando ha atracado y se ha descargado el último camión del plan
      if (S.dockDoneAt == null && S.t > S.plan.firstTruck && S.plan.trucks.every((x) => x.state === "docked") && !S.gate.length && !S.trucks.some((t) => t.units > 0)) S.dockDoneAt = S.t;
      for (const k in active) if (active[k]) { S.procMin[k] = (S.procMin[k] || 0) + S.staff[k] * dt; S.laborMin += S.staff[k] * dt; }
      if (crew) crew.tick(active, dt);
      if (Math.floor(S.t / 10) !== Math.floor((S.t - dt) / 10)) {
        // vuelve poco a poco hacia el 97% (nadie rinde al 100% todo el turno) con algo de ruido
        for (const k in S.eff) S.eff[k] = Math.min(1.08, Math.max(0.85, S.eff[k] + (0.97 - S.eff[k]) * 0.25 + (rand() - 0.5) * 0.06));
      }

      // Fin del sort y fin del turno
      if (S.sortDoneAt == null && S.plan.trucks.every((x) => x.hold || x.state !== "pending") && !S.gate.some((g) => !(g.plan && g.plan.hold)) && !S.trucks.some((t) => !t.hold && t.units > 0) && S.unsorted === 0) {
        S.sortDoneAt = S.t;
        log(`Sort terminado a las ${clock(L, S.t)}${S.t <= S.plan.cutoff ? " · antes del corte" : " · DESPUÉS del corte"}`, S.t <= S.plan.cutoff ? "out" : "bad");
      }
      if (!S.over && S.routes.every((r) => r.dispatched || r.off) && !S.vans.length) {
        S.over = true; S.endAt = S.t;
        log(`Turno terminado: ${S.routesOut - S.routesLate}/${S.routes.filter((r) => !r.off).length} rutas a tiempo`, "out");
        hooks.fx("end", {});
      }

      // Histórico por minuto
      if (S.t - S.lastMinute >= 1) {
        S.lastMinute = Math.floor(S.t);
        trim(S.stowLog, 6000);
        S.history.push({ t: S.lastMinute, plant: S.received - S.dispatched, stow: stowRate(), sorted: S.sorted, plan: planAt(S.lastMinute) });
        trim(S.history, 1200);
      }
    }

    // Cuándo hace falta cada marshal: el de dock mientras llegan y se descargan los camiones del plan,
    // el de yard desde un rato antes de la primera oleada hasta que sale la última furgoneta
    function marshalsOn() {
      return { dock: S.t >= S.plan.sortStart && S.dockDoneAt == null, yard: S.t >= S.plan.firstWave - YM.before && !S.over };
    }

    // Paquetes de una ruta que van de camino a su carro de pick
    function inFlight(r) {
      for (const tr of S.transit) if (tr.dest === "cart" && tr.pkg.route === r.n) return true;
      return false;
    }

    // Descansos del equipo de noche
    const onBreak = (t) => S.plan.breaks.some((b) => t >= b.from && t < b.to);
    // El sort no avanza antes de que entre el equipo de noche ni durante su descanso
    const sortIdle = (t) => t < S.plan.sortStart || onBreak(t);
    // Minutos de trabajo entre a y b, sin los descansos
    function workBetween(a, b) {
      let m = Math.max(0, b - a);
      for (const br of S.plan.breaks) m -= Math.max(0, Math.min(b, br.to) - Math.max(a, br.from));
      return m;
    }

    // Plan de clasificación acumulado: lineal en minutos de trabajo desde que empieza el sort hasta el corte
    // (plano durante el descanso)
    function planAt(t) {
      const s0 = Math.max(S.plan.firstTruck, S.plan.sortStart);
      const f = workBetween(s0, t) / workBetween(s0, S.plan.cutoff);
      return Math.round(S.plan.volume * Math.min(Math.max(f, 0), 1));
    }

    // ── Previsión ─────────────────────────────────────────
    const KEYS = ["receive", "induct", "stow", "pick", "ps", "dock", "yard"];
    const ONES = Object.fromEntries(KEYS.map((k) => [k, 1]));
    const sameStaff = (a, b) => KEYS.every((k) => (a[k] || 0) === (b[k] || 0));
    // Ritmo de cada equipo (1 = el habitual). Con el reparto de ahora, el de la gente que está; con otro, el de
    // la gente que entraría y saldría (no es lo mismo quitar de stow al más rápido que a alguien que acaba de llegar).
    function factors(staff) {
      if (!crew) return ONES;
      if (!staff || sameStaff(staff, S.staff)) { const f = {}; for (const k of KEYS) f[k] = crew.factor(k); return f; }
      return crew.preview(staff).factors;
    }
    // Capacidad nominal de cada proceso con un reparto (paq/h; problem solve, incidencias/h)
    function capacity(staff, f) {
      staff = staff || S.staff; f = f || factors(staff);
      return {
        receive: ((R.rate * staff.receive) / R.staff) * f.receive,
        induct: ((I.rate * staff.induct) / I.staff) * f.induct,
        stow: ((ST.rate * staff.stow) / ST.staff) * f.stow,
        pick: ((P.rate * staff.pick) / P.staff) * f.pick,
        ps: PS.uph * staff.ps * f.ps,
      };
    }
    // Proceso que marca el ritmo del sort: el de menos capacidad entre carros, inducción y stow
    function bottleneck(staff, f) {
      const cap = capacity(staff, f);
      const key = ["stow", "induct", "receive"].reduce((a, b) => (cap[b] < cap[a] ? b : a));
      return { key, rate: cap[key], cap };
    }
    // Capacidad de clasificación (paq/min) con el rendimiento real medio
    function sortCap(staff, f) {
      const c = capacity(staff, f);
      return Math.min(c.receive * FLOW.receive, c.induct * FLOW.induct, c.stow * FLOW.stow) / 60;
    }

    // Cuándo empieza a descargar cada camión que falta. El check-in va de uno en uno por dock marshall;
    // sin dock marshall cada camión tarda más en atracar y descarga más despacio.
    function feeds(staff, f) {
      // la carga de la noche no cuenta para el sort de este turno
      const n = staff.dock || 0, list = S.trucks.filter((t) => t.units > 0 && !t.hold).map((t) => ({ from: S.t, left: t.units }));
      const free = Array(n).fill(S.t);
      S.gate.filter((g) => g.checkEnd != null && !g.checked && !g.self).slice(0, n).forEach((g, i) => (free[i] = g.checkEnd));
      const arriving = S.gate.map((g) => ({ at: g.at, units: g.plan && g.plan.hold ? 0 : g.units, from: g.checked ? S.t : g.checkEnd != null ? g.checkEnd : null }))
        .concat(S.plan.trucks.filter((x) => x.state === "pending").map((x) => (x.hold ? { ...x, units: 0 } : x)).map((x) => ({ at: Math.max(x.eta, S.t), units: x.units, from: null })))
        .sort((a, b) => a.at - b.at);
      for (const a of arriving) {
        let from = a.from;
        if (from == null && !n) from = a.at + DM.selfCheckInMin;
        else if (from == null) { free.sort((x, y) => x - y); from = free[0] = Math.max(a.at, free[0]) + DM.checkInMin / (f.dock || 1); }
        list.push({ from: Math.max(from, S.t), left: a.units });
      }
      return { list, unload: (D.unloadRate / 60) * (n ? 1 : DM.unloadNoMarshal) };
    }

    // Problem solve como una cola: arr[i] son las incidencias que llegan en el minuto i desde ahora.
    // Devuelve, para cada minuto, en qué minuto queda resuelto todo lo que ha llegado hasta entonces.
    function psQueue(arr, perMin) {
      const n = arr.length, A = new Float64Array(n), done = new Float64Array(n);
      let a = 0, p = 0;
      const Pd = new Float64Array(n);
      for (let i = 0; i < n; i++) { a += arr[i]; A[i] = a; p = Math.min(a, p + perMin); Pd[i] = p; }
      for (let i = 0, j = 0; i < n; i++) { if (j < i) j = i; while (j < n - 1 && Pd[j] < A[i] - 0.5) j++; done[i] = j; }
      return done;
    }
    const horizon = () => Math.ceil(Math.max(S.plan.end + 240 - S.t, 120));
    // Incidencias que aún pasarán por problem solve durante el sort: las que ya hay y las de lo que falta por clasificar
    function psSortArrivals(arr, remaining, end) {
      arr[0] += S.psQ.length + S.transit.filter((tr) => tr.dest === "ps").length;
      const span = Math.max(1, Math.min(arr.length - 1, Math.ceil(end - S.t))), per = (remaining * (Q.damaged + Q.noLabel)) / span;
      for (let i = 0; i < span; i++) arr[i] += per;
    }

    // Hora prevista de fin del sort con un reparto (o con el de ahora).
    // Modelo de flujo minuto a minuto: los camiones pendientes entran al ritmo de descarga desde que pasan el check-in
    // y el sort va vaciando lo que hay a su capacidad, la del proceso más lento entre carros, inducción y stow.
    // Así cuenta que al principio de la noche no hay trabajo. Si problem solve va atrasado, el sort no acaba
    // hasta que vuelven a inducción los paquetes que tenía.
    function forecast(staff, capOverride, f) {
      if (S.sortDoneAt != null && !staff) return { sortEnd: S.sortDoneAt, done: true };
      staff = staff || S.staff; f = f || factors(staff);
      const fd = feeds(staff, f), list = fd.list;
      const remaining = S.unsorted + list.reduce((s, x) => s + x.left, 0);
      const cap = capOverride || sortCap(staff, f);
      let backlog = S.unsorted, t = S.t, last = S.t;
      while (list.some((x) => x.left > 0) || backlog > 0.5) {
        // antes de que entre el equipo y en el descanso no se descarga ni se clasifica
        if (!sortIdle(t)) {
          for (const x of list) if (x.left > 0 && x.from <= t) { const n = Math.min(x.left, fd.unload); x.left -= n; backlog += n; last = t + 1; }
          backlog = Math.max(0, backlog - cap);
        }
        t += 1;
        if (t - S.t > 1440) break;
      }
      // + recorrido del último paquete: muelle → carros → inducción → cinta → saca
      let end = Math.max(t, last + 8), psDelay = 0;
      if (remaining) {
        const arr = new Float64Array(Math.max(horizon(), Math.ceil(end - S.t) + 60));
        psSortArrivals(arr, remaining, end);
        const i = Math.min(arr.length - 1, Math.ceil(end - S.t)), done = psQueue(arr, (capacity(staff, f).ps * FLOW.ps) / 60);
        psDelay = Math.max(0, done[i] - i);
        end += psDelay;
      }
      return { sortEnd: remaining ? end : S.t, done: false, remaining, lastUnload: last, psDelay };
    }

    // Previsión por oleada: cuándo acaba su pick, cuándo saldrían sus furgonetas y cuántos paquetes se quedarían.
    // El pick va oleada a oleada; al hacerlo salen los missorts, que pasan por problem solve antes de volver a su saca:
    // la furgoneta los espera hasta su hora límite y, si no llegan, sale sin ellos (rollover).
    function waveForecast(staff, f) {
      const cur = !staff || sameStaff(staff, S.staff);
      staff = staff || S.staff; f = f || factors(staff);
      const fc = forecast(cur ? null : staff, null, f), sortEnd = fc.sortEnd;
      const c = capacity(staff, f), pickCap = (c.pick * PICK_FLOW) / 60;
      const park = staff.yard ? VEH : YM.parkNoMarshal, load = (Y.loadRate / 60) * (staff.yard ? 1 : YM.loadNoMarshal);
      const tw = totalWeight();
      const future = S.plan.trucks.filter((x) => x.state === "pending" && !x.hold).reduce((s, x) => s + x.units, 0) + S.gate.reduce((s, g) => s + (g.plan && g.plan.hold ? 0 : g.units), 0) + S.trucks.reduce((s, t) => s + (t.hold ? 0 : t.units), 0);
      const arr = new Float64Array(horizon()), idx = (t) => Math.max(0, Math.min(arr.length - 1, Math.round(t - S.t)));
      if (!fc.done && fc.remaining) psSortArrivals(arr, fc.remaining, sortEnd);
      let cursor = S.t;
      // plazas del yard: si la oleada anterior sigue cargando, parte de las furgonetas espera a que se libere una
      const busy = [];
      const out = S.plan.waves.map((w) => {
        const routes = w.routes.map((n) => S.routes[n - 1]).filter((r) => !r.dispatched);
        if (!routes.length) {
          const all = w.routes.map((n) => S.routes[n - 1]);
          return { n: w.n, done: true, late: all.filter((r) => r.late).length, depart: Math.max(...all.map((r) => r.departAt)), deadline: w.deadline, rollover: 0 };
        }
        const vols = routes.map((r) => r.bag.length + r.cart.length + r.upstream + (future * r.weight) / tw);
        const pending = routes.some((r) => r.upstream) || future > 0;
        const start = Math.max(cursor, w.at - SH.pickLead);
        // lo que falta por recoger: lo que está en sacas, lo que aún no ha llegado y su parte de los camiones pendientes
        const toPickVol = routes.reduce((s, r) => s + r.bag.length + r.upstream + (future * r.weight) / tw, 0);
        // el equipo de pick trabaja oleada tras oleada; mientras espera los últimos paquetes del sort sigue con las siguientes
        cursor = start + toPickVol / pickCap;
        const pickDone = pending ? Math.max(cursor, sortEnd + 5) : cursor;
        // missorts que saldrán al recoger las sacas de esta oleada
        const a = idx(Math.max(start, S.t)), b = Math.max(a + 1, idx(pickDone)), mis = (toPickVol * Q.missort) / (b - a);
        for (let i = a; i < b; i++) arr[i] += mis;
        // cada furgoneta: plaza libre, aparcar, cargar su ruta y el último paquete hasta la plaza (o esperar a que acabe
        // el pick). Pasado el límite más la espera máxima sale con lo que tenga y el resto se queda (rollover).
        const latest = w.deadline + SH.maxWait;
        busy.sort((x, y) => x - y);
        let free = Y.pads - busy.filter((d) => d > w.at).length, roll = 0, k = 0;
        const freed = busy.filter((d) => d > w.at);
        const deps = routes.map((r, i) => {
          const arrive = r.van ? r.van.calledAt : free-- > 0 ? w.at : freed[k++] ?? w.at + 30;
          const loadEnd = Math.max(arrive + park, S.t) + vols[i] / load + 2;
          const d = Math.min(Math.max(loadEnd, pickDone + 3), latest);
          if (loadEnd > latest) roll += (loadEnd - latest) * load;
          return d;
        });
        // lo que no se llega a recoger: por falta de pick o porque el sort aún no lo ha dejado en su saca
        let short = cursor > latest ? (cursor - latest) * pickCap : 0;
        if (pending && sortEnd > latest) short = Math.max(short, (sortEnd - latest) * sortCap(staff, f) * (routes.reduce((s, r) => s + r.weight, 0) / tw));
        roll += Math.min(toPickVol, short);
        busy.push(...deps);
        return { n: w.n, done: false, pickDone, depart: Math.max(...deps), deadline: w.deadline, late: deps.filter((d) => d > w.deadline + 0.5).length, roll, a, b, mis };
      });
      const done = psQueue(arr, (c.ps * FLOW.ps) / 60), back = PS.handleMin + 3;
      for (const w of out) {
        if (w.done) continue;
        let roll = w.roll, lastBack = w.pickDone;
        for (let i = w.a; i < w.b; i++) { const t = S.t + done[i] + back; if (t > w.deadline) roll += w.mis; else lastBack = Math.max(lastBack, t); }
        // la furgoneta espera los que vuelven antes de su límite
        w.depart = Math.max(w.depart, Math.min(lastBack, w.deadline));
        w.rollover = Math.round(roll);
        delete w.a; delete w.b; delete w.mis; delete w.roll;
      }
      return out;
    }

    // Plantilla mínima para cerrar el sort con margen antes del corte, sacar las oleadas a tiempo y sin rollover
    // de problem solve. Usa el rendimiento medio de una noche con el equipo habitual (no el del momento ni el de
    // quién está hoy), para que no baile con el ruido.
    function crewNeeded(margin) {
      margin = margin == null ? 15 : margin;
      const target = S.plan.cutoff - margin, sortDone = S.sortDoneAt != null;
      // el menor n que cumple, buscando de 1 a 60
      const least = (fits) => { let lo = 1, hi = 60; if (!fits(hi)) return null; while (lo < hi) { const m = (lo + hi) >> 1; if (fits(m)) hi = m; else lo = m + 1; } return lo; };
      // un marshal en dock y otro en yard: con uno basta para el check-in y las oleadas de esta estación
      const staff = { ...S.staff, dock: DM.staff ? 1 : 0, yard: YM.staff ? 1 : 0 };
      let reachable = true, goal = target;
      if (!sortDone) {
        // cada proceso del sort por separado: la menor plantilla con la que no sería él quien retrase el corte
        const capOf = (k, n) => (capacity({ ...staff, [k]: n }, ONES)[k] * FLOW[k]) / 60;
        const ends = (c) => forecast(staff, c, ONES).sortEnd;
        // si ni con gente de sobra se llega (camiones tarde), se planifica para acabar cuanto antes
        const floor = ends(1e9);
        goal = Math.max(target, floor + 5);
        reachable = floor <= target;
        for (const k of ["stow", "induct", "receive"]) staff[k] = least((n) => ends(capOf(k, n)) <= goal) || 60;
      }
      // problem solve: que no retrase el sort ni deje paquetes sin volver a su saca (con pick de sobra)
      const psFits = (n) => {
        const st = { ...staff, ps: n };
        return (sortDone || forecast(st, null, ONES).sortEnd <= goal + 1) && waveForecast({ ...st, pick: 60 }, ONES).every((w) => w.done || !w.rollover);
      };
      staff.ps = least(psFits) || Math.max(PS.staff, S.staff.ps);
      // en pick, el margen es un 5% de capacidad: la salida de una oleada depende de minutos
      const lateWith = (n) => waveForecast({ ...staff, pick: n * 0.95 }, ONES).reduce((s, w) => s + (w.done ? 0 : w.late), 0);
      staff.pick = least((n) => lateWith(n) === 0) || 60;
      const total = (k) => k.reduce((s, x) => s + staff[x], 0);
      return { staff, reachable, sortDone, sortEnd: sortDone ? S.sortDoneAt : forecast(staff, null, ONES).sortEnd,
        sort: total(["receive", "induct", "stow", "ps"]), pick: staff.pick, marshals: total(["dock", "yard"]) };
    }

    // Reparto de n personas entre carros, inducción y stow que da más capacidad de sort: se va dando cada persona
    // al proceso que va más corto, con el ritmo de los equipos de ahora
    function splitSort(n) {
      const f = factors(), per = { receive: (R.rate / R.staff) * f.receive * FLOW.receive, induct: (I.rate / I.staff) * f.induct * FLOW.induct, stow: (ST.rate / ST.staff) * f.stow * FLOW.stow };
      const st = { receive: 1, induct: 1, stow: 1 };
      for (let i = 3; i < n; i++) {
        // a igualdad, donde ya hay gente (menos cambios)
        const k = ["stow", "induct", "receive"].reduce((a, b) => (st[b] * per[b] < st[a] * per[a] - 1e-9 || (Math.abs(st[b] * per[b] - st[a] * per[a]) < 1e-9 && S.staff[b] > S.staff[a]) ? b : a));
        st[k]++;
      }
      return { ...S.staff, ...st };
    }
    const SNAME = { receive: "la zona de carros", induct: "inducción", stow: "stow", pick: "pick", ps: "problem solve", dock: "dock marshall", yard: "yard marshall" };
    // "Mueve 2 de stow a inducción" o, si hay más de un cambio, la lista de cambios
    function movesText(to) {
      const d = KEYS.filter((k) => to[k] !== S.staff[k]).map((k) => [k, to[k] - S.staff[k]]);
      const out = d.filter((x) => x[1] < 0), inn = d.filter((x) => x[1] > 0);
      if (out.length === 1 && inn.length === 1) return `Mueve ${inn[0][1]} de ${SNAME[out[0][0]]} a ${SNAME[inn[0][0]]}`;
      return d.map(([k, v]) => `${SNAME[k]} ${v > 0 ? "+" : ""}${v}`).join(", ").replace(/^./, (c) => c.toUpperCase());
    }

    // Recomendación del momento, como la daría un responsable de turno: mover gente donde hace falta.
    // Devuelve null si no hay nada que mejorar. staff es el reparto propuesto, listo para aplicar.
    function advise() {
      if (S.over) return null;
      // sin marshal no se para nada, pero todo va más lento: es lo primero que hay que cubrir
      if (!S.staff.dock && DM.staff && S.t >= S.plan.firstTruck - 30 && S.dockDoneAt == null)
        return { id: "add:dock", kind: "bad", staff: { ...S.staff, dock: 1 },
          text: `No hay dock marshall: cada camión espera unos ${DM.selfCheckInMin} min en la puerta para atracar y descarga más despacio. Pon a una persona en el check-in.` };
      if (!S.staff.yard && YM.staff && S.t >= S.plan.firstWave - YM.before - 30)
        return { id: "add:yard", kind: "bad", staff: { ...S.staff, yard: 1 },
          text: `No hay yard marshall para las oleadas: las furgonetas tardan unos ${YM.parkNoMarshal} min en colocarse y cargan más despacio. Pon a una persona en el yard.` };
      if (S.t < S.plan.firstTruck) return null;
      const late = (st) => waveForecast(st).reduce((s, w) => s + (w.done ? 0 : w.late), 0);
      if (S.sortDoneAt == null) {
        const now = forecast().sortEnd, pool = S.staff.receive + S.staff.induct + S.staff.stow;
        // 1) repartir mejor la gente que ya hay
        const st = splitSort(pool);
        if (!sameStaff(st, S.staff)) {
          const end = forecast(st).sortEnd;
          if (end <= now - 10) return { id: "move:" + KEYS.map((k) => st[k]).join(","), kind: now > S.plan.cutoff ? "bad" : "warn", staff: st,
            text: `${movesText(st)}: el sort acabaría a las ${clock(L, end)} en vez de a las ${clock(L, now)}.` };
        }
        // 2) si aun así no se llega al corte, la menor cantidad de gente que hay que sumar
        if (now > S.plan.cutoff && forecast(null, 1e9).sortEnd <= S.plan.cutoff) {
          for (let extra = 1; extra <= 20; extra++) {
            const opt = splitSort(pool + extra), end = forecast(opt).sortEnd;
            if (end > S.plan.cutoff - 5) continue;
            return { id: "add:sort", kind: "bad", staff: opt,
              text: `No se llega al corte de las ${clock(L, S.plan.cutoff)}: ${extra === 1 ? "falta 1 persona" : `faltan ${extra} personas`}. Con carros ${opt.receive}, inducción ${opt.induct} y stow ${opt.stow} el sort acabaría a las ${clock(L, end)} (horas extra o gente de otro turno).` };
          }
        }
      }
      // 3) problem solve: si va a dejar paquetes sin volver a su saca
      const roll = (st) => waveForecast(st).reduce((s, w) => s + (w.done ? 0 : w.rollover), 0);
      if (S.t >= S.plan.pickStart - 60 && roll(S.staff) >= 5) {
        for (let extra = 1; extra <= 3; extra++) {
          const st = { ...S.staff, ps: S.staff.ps + extra };
          if (roll(st) < 5) return { id: "add:ps", kind: "warn", staff: st,
            text: `Problem solve no da abasto: unos ${roll(S.staff)} paquetes se quedarían sin volver a su saca antes de que salga su furgoneta. Con ${extra} persona${extra > 1 ? "s" : ""} más (${st.ps}) llegarían a tiempo.` };
        }
      }
      // 4) pick: refuerzo si alguna oleada va a salir tarde
      if (S.t >= S.plan.pickStart - 30 && late(S.staff)) {
        const need = crewNeeded(0).staff.pick;
        // si ya no hay plantilla razonable que lo arregle, no se recomienda nada
        if (need > S.staff.pick && need - S.staff.pick <= 10) return { id: "add:pick", kind: "bad", staff: { ...S.staff, pick: need },
          text: `Refuerza pick con ${need - S.staff.pick} persona${need - S.staff.pick > 1 ? "s" : ""} (${need} en total) para que el pick no retrase las oleadas.` };
      }
      return null;
    }

    // Horas-persona que quedan de turno con un reparto, según cuándo trabaja cada equipo
    function laborLeft(staff) {
      staff = staff || S.staff;
      const f = factors(staff), cur = sameStaff(staff, S.staff);
      const fc = forecast(cur ? null : staff, null, f), ws = waveForecast(staff, f);
      const end = Math.max(...ws.map((w) => w.depart)), sortEnd = fc.done ? S.t : fc.sortEnd;
      const span = (a, b) => workBetween(Math.max(a, S.t), b), s0 = S.plan.sortStart;
      const dockEnd = S.dockDoneAt != null || fc.done ? S.t : fc.lastUnload;
      const m = { receive: span(s0, sortEnd), induct: span(s0, sortEnd), stow: span(s0, sortEnd), ps: span(s0, end), pick: span(S.plan.pickStart, end),
        dock: span(s0, dockEnd), yard: span(S.plan.firstWave - YM.before, end) };
      // el equipo de sort de noche sigue fichado hasta su salida aunque acabe antes
      const support = S.plan.nightEnd == null ? 0 : (staff.receive + staff.induct + staff.stow) * workBetween(Math.max(sortEnd, S.t), S.plan.nightEnd);
      return (KEYS.reduce((s, k) => s + (staff[k] || 0) * m[k], 0) + support) / 60;
    }

    // Qué cambiaría un reparto ahora mismo, al instante: fin del sort, oleadas, cuello de botella,
    // horas-persona y quién entraría o saldría de cada proceso
    function whatIf(staff) {
      const fNow = factors(), fThen = factors(staff), pv = crew ? crew.preview(staff) : { joins: [], leaves: [] };
      const sum = (ws, k) => ws.reduce((s, w) => s + (w[k] || 0), 0);
      const side = (st, f, cur) => {
        const fc = forecast(cur ? null : st, null, f), ws = waveForecast(cur ? null : st, f);
        return { sortEnd: fc.sortEnd, sortDone: !!fc.done, psDelay: fc.psDelay || 0, waves: ws, late: sum(ws, "late"), rollover: sum(ws, "rollover"),
          bottleneck: bottleneck(st, f), labor: laborLeft(st) };
      };
      return { now: side(S.staff, fNow, true), then: side(staff, fThen, false), joins: pv.joins, leaves: pv.leaves };
    }

    function stowRate() {
      const from = S.t - 60; let n = 0;
      for (let i = S.stowLog.length - 1; i >= 0 && S.stowLog[i] >= from; i--) n++;
      return S.t < 60 ? Math.round((n / Math.max(S.t, 1)) * 60) : n;
    }

    // Minutos de cola por proceso
    function loads() {
      const out = [
        { name: "la zona de carros", m: stagingCount() / (rate(I.rate, "induct", I) / 60) },
        { name: "Inducción", m: S.inductQ.length / (rate(I.rate, "induct", I) / 60) },
      ];
      // stow es un solo equipo que se mueve entre pasillos: su cola es la de todos
      const stowQ = S.aisles.reduce((n, a) => n + a.queue.length, 0);
      out.push({ name: "Stow", m: stowQ / (rate(ST.rate, "stow", ST) / 60) });
      const pick = S.routes.reduce((s, r) => s + toPick(r), 0);
      out.push({ name: "Pick", m: pick / (rate(P.rate, "pick", P) / 60) });
      return out;
    }

    // Minutos-persona del equipo de sort de noche desde que acaba el sort hasta que sale (nightEnd): siguen fichados
    // haciendo rutas y buscando paquetes perdidos. Al acabar la partida se cuenta hasta su hora de salida.
    function supportMin() {
      if (S.sortDoneAt == null || S.plan.nightEnd == null) return 0;
      const n = (S.staff.receive || 0) + (S.staff.induct || 0) + (S.staff.stow || 0);
      return n * workBetween(S.sortDoneAt, S.over ? S.plan.nightEnd : Math.min(S.t, S.plan.nightEnd));
    }

    // Métricas del turno
    function metrics() {
      const out = S.routes.filter((r) => r.dispatched);
      const cap = ST.bagCapacity;
      const fill = out.length ? avg(out.filter((r) => r.out).map((r) => r.out / (Math.ceil(r.out / cap) * cap))) : null;
      // rollover: paquetes que siguen en la estación y cuya ruta ya salió
      let rollover = 0;
      if (out.length) for (const p of S.pkgs.values()) if (!p.hold && p.where !== "route" && p.where !== "delivered" && p.where !== "writtenoff" && S.routes[p.route - 1].dispatched) rollover++;
      const defects = S.issues.damaged + S.issues.noLabel + S.issues.missort;
      const psOpen = S.psQ.length + S.transit.filter((tr) => tr.dest === "ps").length;
      const procs = [["receive", R, "Zona de carros"], ["induct", I, "Inducción"], ["stow", ST, "Stow"], ["pick", P, "Pick"], ["ps", PS, "Problem solve"]].map(([key, cfg, name]) => {
        const real = hourRate(key);
        return { key, name, staff: S.staff[key], uph: real / S.staff[key], target: cfg.uph, rate: real, cap: rate(cfg.rate || cfg.uph * cfg.staff, key, cfg) };
      });
      // marshals: no mueven paquetes, se mira si están cuando hacen falta y lo que tienen esperando
      const on = marshalsOn();
      procs.push({ key: "dock", name: "Dock marshall", marshal: true, staff: S.staff.dock, needed: on.dock, queue: S.gate.length, done: S.totals.dock || 0 });
      procs.push({ key: "yard", name: "Yard marshall", marshal: true, staff: S.staff.yard, needed: on.yard, queue: S.vans.filter((v) => v.state === "arriving").length, done: S.totals.yard || 0 });
      const cycle = Object.entries(S.cyc).map(([k, [sum, n]]) => ({ key: k, min: n ? sum / n : null }));
      const laborHours = (S.laborMin + supportMin()) / 60;
      return {
        quality: {
          missortRate: S.sorted ? S.issues.missort / S.sorted : 0, dpmo: S.received ? (defects / S.received) * 1e6 : 0,
          psOpen, psAvg: S.psTimes.length ? avg(S.psTimes) : null, writtenOff: S.writtenOff, ...S.issues,
        },
        processes: procs, cycle, laborHours, supportHours: supportMin() / 60, pph: laborHours > 0.5 ? S.sorted / laborHours : null,
        waves: waveForecast(),
        routesTotal: S.routes.filter((r) => !r.off).length, routesOut: S.routesOut, routesLate: S.routesLate, routesOnTime: S.routesOut - S.routesLate,
        rollover, bagFill: fill, forecast: forecast(), cutoff: S.plan.cutoff,
      };
    }

    // Paquetes que siguen dentro de la estación, contados por estado
    function inPlantCount() {
      let n = 0;
      // la carga de la noche se cuenta aparte (S.held): no es trabajo de este turno
      for (const p of S.pkgs.values()) if (!p.hold && p.where !== "route" && p.where !== "delivered" && p.where !== "writtenoff") n++;
      return n;
    }

    // ── Acciones del usuario ──────────────────────────────
    // Todo lo que cambia la partida desde fuera pasa por aquí y queda apuntado con el paso en que se hizo:
    // así project() puede repetir la partida exacta hasta ahora y seguirla con otro reparto.
    function apply(a) {
      switch (a.type) {
        case "staff": {
          const ch = KEYS.filter((k) => a.staff[k] != null && a.staff[k] !== S.staff[k]);
          if (!ch.length) return;
          const txt = ch.map((k) => `${SNAME[k]} ${S.staff[k]}→${a.staff[k]}`).join(", ");
          for (const k of ch) S.staff[k] = Math.max(0, Math.min(60, a.staff[k]));
          log(`${a.why || "Cambio de plantilla"}: ${txt}`, a.why ? "out" : "warn");
          return;
        }
        case "truck": return addTruck();
        case "van": return callVan(a.route ? S.routes[a.route - 1] : null);
        case "auto": S.auto = !!a.on; return;
        case "move": {
          const e = crew && crew.people.find((x) => x.id === a.id);
          if (!e) return "Esa persona no está en la plantilla";
          const c = crew.move(e, a.to || null);
          if (c) log(`${c.name} (${c.id}) ${c.from && c.to ? `pasa de ${PNAME[c.from]} a ${PNAME[c.to]}` : c.to ? `entra en ${PNAME[c.to]}` : "queda disponible"}`, "warn");
          return;
        }
      }
    }
    function act(a) { S.actions.push({ ...a, step: S.steps }); return apply(a); }

    // Resumen de la partida para comparar repartos
    function summary() {
      const m = metrics();
      return { t: S.t, over: S.over, sortEnd: S.sortDoneAt, cutoff: S.plan.cutoff, endAt: S.endAt, routesLate: m.routesLate, routesOut: m.routesOut,
        routesTotal: m.routesTotal, rollover: m.rollover, laborHours: m.laborHours, pph: m.pph, waves: m.waves.map((w) => ({ n: w.n, depart: w.depart, late: w.late })),
        volume: S.plan.volume, received: S.received, held: S.held, dispatched: S.dispatched, dpmo: m.quality.dpmo, missortRate: m.quality.missortRate,
        staff: { ...S.staff0 }, clock0: L.shiftStart };
    }

    // plantilla mínima calculada antes de empezar, para comparar en el informe con la que hubo
    S.crewPlan = crewNeeded();
    S.staff0 = { ...S.staff };

    return {
      S, L, SH, geo, posOf, step, freePad, laneOf, stagingCount, heldCount, rate, loads, stowRate, inPlantCount,
      toPick, forecast, metrics, planAt, onBreak, workBetween, sortCap, at, waveForecast, hourRate, log, crewNeeded, advise,
      capacity, bottleneck, factors, laborLeft, whatIf, marshalsOn, summary, apply, spec, pf, VEH,
      // acciones (quedan apuntadas para poder repetir la partida)
      addTruck: () => act({ type: "truck" }),
      callVan: (route) => act({ type: "van", route: route ? route.n : null }),
      setStaff: (staff, why) => act({ type: "staff", staff, why }),
      setAuto: (on) => act({ type: "auto", on: !!on }),
      moveWorker: (id, to) => act({ type: "move", id, to: to || null }),
      clock: (t) => clock(L, t),
    };
  }

  // Simula el resto del turno: repite la partida exacta hasta el paso `atStep` (misma semilla y mismas acciones)
  // y desde ahí sigue con el reparto `staff` (o con el que había) hasta que sale la última furgoneta.
  function project(L, opts, actions, atStep, staff) {
    const E = create(L, { ...opts, hooks: undefined }), S = E.S;
    const acts = (actions || []).slice().sort((a, b) => a.step - b.step);
    let i = 0;
    while (S.steps < atStep) {
      while (i < acts.length && acts[i].step <= S.steps) E.apply(acts[i++]);
      E.step(DT);
    }
    while (i < acts.length) E.apply(acts[i++]);
    if (staff) E.setStaff(staff, "Simulación");
    const limit = S.plan.end + 240;
    while (!S.over && S.t < limit) E.step(DT);
    return E.summary();
  }

  function clock(L, t) {
    const m = Math.floor(t + L.shiftStart);
    return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(((m % 60) + 60) % 60).padStart(2, "0");
  }
  function fmtMin(m) { return m < 1 ? "< 1 min" : m < 90 ? Math.round(m) + " min" : (m / 60).toFixed(1) + " h"; }

  const api = { create, project, geometry, posOf, rng, clock, fmtMin, avg, toShift, DT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
