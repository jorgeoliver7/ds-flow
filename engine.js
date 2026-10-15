// Motor de la simulación: estado, reglas y métricas de la estación. No toca el DOM,
// así que se puede ejecutar y probar en Node (ver test/).
(function (root) {
  "use strict";

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
    const bagW = (ST.w - 24) / ST.routesPerAisle;
    const g = {
      dockX: (i) => D.left + ((D.right - D.left) / D.count) * (i + 0.5),
      beltY: (a) => a.y + 20,
      bagRect(r) {
        const a = ST.aisles[r.aisle];
        return { x: ST.x + 12 + r.j * bagW + 3, y: a.y + 38, w: bagW - 6, h: ST.h - 48 };
      },
      cartRect(r) {
        const a = ST.aisles[r.aisle], col = r.j % 2, row = Math.floor(r.j / 2);
        return { x: P.x + 10 + col * 44, y: a.y + 6 + row * 25, w: 40, h: 21 };
      },
      padRect(i) {
        // dos filas de plazas a los lados de un carril central
        const col = i % 2, row = Math.floor(i / 2), rows = Y.pads / 2;
        const lane = 56, w = (Y.w - 24 - lane) / 2, h = (Y.h - 80) / rows;
        return { x: col ? Y.x + Y.w - 12 - w : Y.x + 12, y: Y.y + 40 + row * h, w, h: h - 10 };
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

  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const trim = (a, n) => { if (a.length > n) a.splice(0, a.length - n); };

  // opts: { seed, hooks: { log(msg, kind), fx(kind, data), now() } }
  function create(L, opts) {
    opts = opts || {};
    const hooks = Object.assign({ log() {}, fx() {}, now: () => 0 }, opts.hooks);
    const rand = rng(opts.seed == null ? 7 : opts.seed);
    const D = L.docks, R = L.receive, I = L.induct, CV = L.conveyor, ST = L.stow, P = L.pick, Y = L.yard;
    const geo = geometry(L);

    // ── Estado ────────────────────────────────────────────
    const S = {
      t: 0, auto: true,
      pkgs: new Map(),
      trucks: [], vans: [], transit: [],
      inductQ: [], moves: [], nextCart: 1,
      acc: { induct: 0, pick: 0 },
      staff: { receive: R.staff, induct: I.staff, stow: ST.staff, pick: P.staff },
      aisles: ST.aisles.map((a, i) => ({ ...a, idx: i, queue: [], acc: 0, done: 0 })),
      routes: [],
      received: 0, stowed: 0, dispatched: 0, delivered: 0, routesOut: 0,
      deliveries: [],
      stowLog: [], dockToStow: [], vanTimes: [], vansOnTime: 0,
      history: [], lastMinute: 0,
      pickRR: 0, nextTruck: 101, nextVan: 1, lastAutoTruck: -99, lastAutoVan: -99,
      events: [],
    };

    // Rutas: N por pasillo, con peso de volumen distinto para que unas se llenen antes
    S.aisles.forEach((a) => {
      for (let j = 0; j < ST.routesPerAisle; j++) {
        const n = a.idx * ST.routesPerAisle + j + 1;
        S.routes.push({
          n, code: "R" + String(n).padStart(2, "0"), aisle: a.idx, j,
          town: L.towns[(n * 3) % L.towns.length],
          weight: 0.5 + rand() * 1.2,
          bag: [], cart: [], toPick: 0, van: null, out: 0,
        });
      }
    });
    const totalWeight = () => S.routes.reduce((s, r) => s + r.weight, 0);

    // Zona de carros: un carril por grupo y tamaño
    const groupOfAisle = (ai) => R.groups.findIndex((g) => g.aisles.includes(ai));
    S.lanes = [];
    R.groups.forEach((g, gi) => R.classes.forEach((c, ci) => S.lanes.push({ gi, ci, group: g, cls: c, open: null, closed: [] })));
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
    const rate = (base, key, cfg) => (base * S.staff[key]) / cfg.staff;

    function log(msg, kind) {
      S.events.unshift({ t: S.t, msg, kind: kind || "" });
      trim(S.events, 40);
      hooks.log(msg, kind);
    }
    function hist(p, msg) { p.hist.push({ t: S.t, msg }); }

    const SIZES = [["Sobre", 0.3, "S"], ["Pequeño", 1.2, "S"], ["Mediano", 3.5, "M"], ["Oversize", 9, "O"]];
    function newPkg(truck) {
      let id;
      do { id = "DS" + String(Math.floor(rand() * 1e8)).padStart(8, "0"); } while (S.pkgs.has(id));
      const r = pickRoute(), sz = SIZES[Math.floor(rand() ** 1.6 * SIZES.length)];
      const p = {
        id, route: r.n, size: sz[0], cls: sz[2], group: groupOfAisle(r.aisle), weight: +(sz[1] * (0.6 + rand() * 0.8)).toFixed(1),
        cp: "11" + String(Math.floor(rand() * 690) + 1).padStart(3, "0"),
        truck: truck.id, sorted: false, where: "truck", hist: [], unloadedAt: S.t,
      };
      hist(p, `Descargado del camión ${truck.id} · muelle ${truck.dock + 1}`);
      S.pkgs.set(id, p);
      if (S.pkgs.size > 20000) {
        for (const [k, v] of S.pkgs) { if (S.pkgs.size < 17000) break; if (v.where === "delivered" && k !== S.tracked) S.pkgs.delete(k); }
      }
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
        case "induct": p.where = "induct"; S.inductQ.push(p); break;
        case "aisle": p.where = "aisle"; S.aisles[r.aisle].queue.push(p); break;
        case "bag":
          p.where = "bag"; r.bag.push(p); S.stowed++; S.stowLog.push(S.t);
          r.bump = hooks.now();
          hooks.fx("stow", { route: r });
          S.dockToStow.push(S.t - p.unloadedAt); trim(S.dockToStow, 120);
          hist(p, `Stow en la saca ${r.code} · pasillo ${ST.aisles[r.aisle].id}`);
          break;
        case "cart": p.where = "cart"; r.cart.push(p); hist(p, `Pick · carro de ${r.code}`); break;
        case "van": {
          const v = S.vans.find((x) => x.id === tr.van);
          p.where = "van"; p.van = tr.van;
          if (v) { v.incoming--; v.loaded++; v.items.push(p); v.bump = hooks.now(); }
          hist(p, `Cargado en la furgoneta ${tr.van}`);
          break;
        }
      }
    }

    // ── Acciones ──────────────────────────────────────────
    // Devuelven un texto cuando no se pueden hacer, para que la interfaz lo muestre
    function addTruck() {
      const used = new Set(S.trucks.map((t) => t.dock));
      const free = [...Array(D.count).keys()].filter((i) => !used.has(i));
      if (!free.length) return `Los ${D.count} muelles están ocupados`;
      const dock = free[Math.floor(rand() * free.length)];
      const units = Math.round(D.truckUnits * (0.7 + rand() * 0.6));
      const t = { id: "T-" + S.nextTruck++, dock, units, total: units, state: "arriving", p: 0, acc: 0 };
      S.trucks.push(t);
      log(`Camión ${t.id} atraca en el muelle ${dock + 1} con ${units} paquetes`, "in");
    }

    function freePad() {
      const used = new Set(S.vans.map((v) => v.pad));
      for (let i = 0; i < Y.pads; i++) if (!used.has(i)) return i;
      return -1;
    }

    function callVan(route) {
      if (!route) {
        route = S.routes.filter((r) => !r.van && r.bag.length).sort((a, b) => b.bag.length - a.bag.length)[0];
        if (!route) return "No hay sacas con paquetes esperando furgoneta";
      }
      if (route.van) return `${route.code} ya tiene furgoneta`;
      if (!route.bag.length) return `La saca de ${route.code} está vacía`;
      const pad = freePad();
      if (pad < 0) return "El yard está lleno";
      const v = { id: "V-" + String(S.nextVan++).padStart(3, "0"), route: route.n, pad, state: "arriving", p: 0, acc: 0,
        expected: route.bag.length, loaded: 0, incoming: 0, items: [], calledAt: S.t };
      route.van = v; route.toPick += route.bag.length;
      S.vans.push(v);
      log(`Furgoneta ${v.id} asignada a ${route.code} (${route.town}) · ${v.expected} paquetes · plaza ${pad + 1}`, "out");
    }

    function depart(v) {
      const r = S.routes[v.route - 1];
      v.state = "leaving"; v.p = 0; r.van = null; r.out += v.loaded;
      hooks.fx("depart", { van: v, route: r });
      const yardTime = S.t - v.calledAt;
      S.vanTimes.push(yardTime); trim(S.vanTimes, 100);
      if (yardTime <= Y.onTimeMinutes) S.vansOnTime++;
      S.routesOut++; S.dispatched += v.loaded;
      for (const p of v.items) {
        p.where = "route"; hist(p, `Sale a reparto · ${r.town}`);
        S.deliveries.push({ at: S.t + 45 + rand() * 240, pkg: p });
      }
      log(`Furgoneta ${v.id} sale a reparto con ${v.loaded} paquetes (${r.code} · ${fmtMin(yardTime)} en yard)`, "out");
    }

    const VEH = 1; // minutos simulados que tarda un vehículo en atracar o salir

    // ── Paso de simulación (dt en minutos simulados) ──────
    function step(dt) {
      S.t += dt;

      // Camiones
      for (const t of S.trucks) {
        if (t.state === "arriving") { t.p += dt / VEH; if (t.p >= 1) { t.state = "unloading"; t.p = 1; } }
        else if (t.state === "unloading") {
          t.acc += (D.unloadRate / 60) * dt;
          while (t.acc >= 1 && t.units > 0) {
            t.acc--; t.units--; S.received++;
            const p = newPkg(t), x = geo.dockX(t.dock);
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
      }
      while (S.moves.length < S.staff.receive && S.inductQ.length < 40) {
        let best = null;
        for (const l of S.lanes) if (l.closed.length && (!best || l.closed[0].closedAt < best.closed[0].closedAt)) best = l;
        if (!best) break;
        const cart = best.closed.shift(), from = geo.laneCenter(best);
        for (const p of cart.items) { p.where = "moving"; hist(p, `Carro ${cart.id} llevado a inducción`); }
        // el carro baja al pasillo bajo la zona de carros y va por él hasta inducción
        const gy = R.y + R.h + 8, pts = [from, { x: from.x, y: gy }, { x: I.x + I.w / 2, y: gy }, { x: I.x + I.w / 2, y: I.y + I.h - 22 }];
        const segs = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
        S.moves.push({ cart, lane: best, pts, segs, total: segs.reduce((a, b) => a + b, 0), p: 0 });
      }
      for (const m of S.moves) {
        m.p += dt / R.moveMinutes;
        if (m.p >= 1) for (const p of m.cart.items) { p.where = "induct"; S.inductQ.push(p); }
      }
      S.moves = S.moves.filter((m) => m.p < 1);

      // Inducción → conveyor → pasillo
      S.acc.induct = Math.min(S.acc.induct + (rate(I.rate, "induct", I) / 60) * dt, 3);
      while (S.acc.induct >= 1 && S.inductQ.length) {
        S.acc.induct--;
        const p = S.inductQ.shift(), r = S.routes[p.route - 1], a = ST.aisles[r.aisle];
        p.sorted = true;
        hist(p, `Inducido · ruta ${r.code} → pasillo ${a.id}`);
        send(p, [{ x: CV.x, y: I.y + I.h - 10 }, { x: CV.x, y: geo.beltY(a) }, { x: ST.x + 8, y: geo.beltY(a) }], "aisle", { belt: true });
      }

      // Stow: cada pasillo con su parte de la plantilla
      const perAisle = rate(ST.rate, "stow", ST) / S.aisles.length;
      for (const a of S.aisles) {
        a.acc = Math.min(a.acc + (perAisle / 60) * dt, 3);
        while (a.acc >= 1 && a.queue.length) {
          a.acc--; a.done++;
          const p = a.queue.shift(), r = S.routes[p.route - 1], b = geo.bagCenter(r);
          send(p, [{ x: ST.x + 8, y: geo.beltY(a) }, { x: b.x, y: geo.beltY(a) }, b], "bag");
        }
      }

      // Pick: reparto round-robin entre rutas con furgoneta asignada
      S.acc.pick = Math.min(S.acc.pick + (rate(P.rate, "pick", P) / 60) * dt, 3);
      // puntero persistente para que ninguna ruta se quede sin pickers
      const picking = () => S.routes.some((r) => r.toPick > 0);
      while (S.acc.pick >= 1 && picking()) {
        S.pickRR = (S.pickRR + 1) % S.routes.length;
        const r = S.routes[S.pickRR];
        if (!r.toPick) continue;
        S.acc.pick--;
        const p = r.bag.shift(); r.toPick--;
        if (p) {
          const b = geo.bagCenter(r), c = geo.cartCenter(r);
          send(p, [b, { x: ST.x + ST.w, y: b.y }, { x: P.x, y: c.y }, c], "cart");
        }
      }

      // Furgonetas
      for (const v of S.vans) {
        const r = S.routes[v.route - 1];
        if (v.state === "arriving") { v.p += dt / VEH; if (v.p >= 1) { v.state = "loading"; v.p = 1; } }
        else if (v.state === "loading") {
          v.acc = Math.min(v.acc + (Y.loadRate / 60) * dt, 3);
          while (v.acc >= 1 && r.cart.length) {
            v.acc--; v.incoming++;
            const p = r.cart.shift(), c = geo.cartCenter(r), pc = geo.padCenter(v.pad);
            send(p, [c, { x: P.x + P.w, y: c.y }, { x: Y.x + 6, y: pc.y }, pc], "van", { van: v.id });
          }
          if (v.loaded >= v.expected && !v.incoming) depart(v);
        } else v.p += dt / VEH;
      }
      S.vans = S.vans.filter((v) => !(v.state === "leaving" && v.p >= 1));

      // Tránsito
      const still = [];
      for (const tr of S.transit) {
        tr.d += CV.speed * dt;
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

      // Piloto automático
      if (S.auto) {
        const inPlant = S.received - S.dispatched;
        if (inPlant < 2600 && stagingCount() < 400 && S.t - S.lastAutoTruck > 4) { addTruck(); S.lastAutoTruck = S.t; }
        if (S.t - S.lastAutoVan > 0.5) {
          const r = S.routes.filter((x) => !x.van && x.bag.length >= 20).sort((a, b) => b.bag.length - a.bag.length)[0];
          if (r && freePad() >= 0) callVan(r);
          S.lastAutoVan = S.t;
        }
      }

      // Histórico por minuto
      if (S.t - S.lastMinute >= 1) {
        S.lastMinute = Math.floor(S.t);
        trim(S.stowLog, 6000);
        S.history.push({ plant: S.received - S.dispatched, stow: stowRate() });
        trim(S.history, 240);
      }
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
      const perAisle = rate(ST.rate, "stow", ST) / S.aisles.length / 60;
      for (const a of S.aisles) out.push({ name: "stow del pasillo " + a.id, m: a.queue.length / perAisle });
      const toPick = S.routes.reduce((s, r) => s + r.toPick, 0);
      out.push({ name: "Pick", m: toPick / (rate(P.rate, "pick", P) / 60) });
      return out;
    }

    // Paquetes que siguen dentro de la estación, contados por estado
    function inPlantCount() {
      let n = 0;
      for (const p of S.pkgs.values()) if (p.where !== "route" && p.where !== "delivered") n++;
      return n;
    }

    // Arranque: algo de volumen ya en las sacas para que el mapa tenga vida desde el principio
    function seedStart() {
      const seedTruck = { id: "T-100", dock: 0 };
      for (let i = 0; i < 520; i++) {
        const p = newPkg(seedTruck), r = S.routes[p.route - 1], aisle = ST.aisles[r.aisle].id;
        p.sorted = true; p.where = "bag"; r.bag.push(p);
        p.hist = [{ t: -40, msg: "Descargado del camión T-100 · muelle 1" }, { t: -32, msg: `Inducido · ruta ${r.code} → pasillo ${aisle}` }, { t: -25, msg: `Stow en la saca ${r.code} · pasillo ${aisle}` }];
        S.received++; S.stowed++;
      }
      addTruck(); addTruck(); addTruck();
      // y unas cuantas rutas ya cargando en el yard
      S.routes.slice().sort((x, y) => y.bag.length - x.bag.length).slice(0, 3).forEach((r) => callVan(r));
    }
    if (opts.seedStart !== false) seedStart();

    return {
      S, L, geo, posOf, step, addTruck, callVan, freePad, laneOf, stagingCount, rate, loads, stowRate, inPlantCount,
      clock: (t) => clock(L, t),
    };
  }

  function clock(L, t) {
    const m = Math.floor(t + L.shiftStart);
    return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(((m % 60) + 60) % 60).padStart(2, "0");
  }
  function fmtMin(m) { return m < 1 ? "< 1 min" : m < 90 ? Math.round(m) + " min" : (m / 60).toFixed(1) + " h"; }

  const api = { create, geometry, posOf, rng, clock, fmtMin, avg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
