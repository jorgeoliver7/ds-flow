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

  // "05:30" → minutos desde el inicio del turno; lo que cae antes del inicio es del día siguiente
  function toShift(hhmm, shiftStart) {
    const [h, m] = String(hhmm).split(":").map(Number);
    let t = h * 60 + m - shiftStart;
    if (t < -120) t += 1440;
    return t;
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
    const SH = L.shift, at = (hhmm) => toShift(hhmm, L.shiftStart);

    // ── Estado ────────────────────────────────────────────
    const S = {
      t: 0, auto: true, over: false, endAt: null, sortDoneAt: null,
      pkgs: new Map(),
      trucks: [], vans: [], transit: [],
      inductQ: [], moves: [], nextCart: 1,
      acc: { induct: 0, pick: 0 },
      staff: { receive: R.staff, induct: I.staff, stow: ST.staff, pick: P.staff },
      aisles: ST.aisles.map((a, i) => ({ ...a, idx: i, queue: [], acc: 0, done: 0 })),
      routes: [],
      received: 0, stowed: 0, sorted: 0, dispatched: 0, delivered: 0, routesOut: 0, routesLate: 0,
      deliveries: [],
      stowLog: [], dockToStow: [], vanTimes: [],
      history: [], lastMinute: 0,
      nextTruck: 101, nextVan: 1, waitLogged: {},
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
          bag: [], cart: [], van: null, out: 0,
          upstream: 0,          // paquetes de la ruta que aún no han llegado a su saca
          picking: false, dispatched: false, departAt: null, late: false, wave: null,
        });
      }
    });
    const totalWeight = () => S.routes.reduce((s, r) => s + r.weight, 0);

    // Plan del turno: camiones programados y oleadas de salida
    S.plan = {
      trucks: SH.trucks.map((x, i) => ({ id: "T-" + String(i + 1).padStart(2, "0"), at: at(x.at), units: x.units, state: "pending" })),
      cutoff: at(SH.sortCutoff),
      waves: SH.waves.map((w, i) => {
        const aisleIdx = w.aisles.map((id) => ST.aisles.findIndex((a) => a.id === id));
        return { n: i + 1, at: at(w.at), deadline: at(w.at) + SH.loadWindow, routes: S.routes.filter((r) => aisleIdx.includes(r.aisle)).map((r) => r.n), pickStarted: false, called: false };
      }),
    };
    S.plan.volume = S.plan.trucks.reduce((s, x) => s + x.units, 0);
    S.plan.firstTruck = Math.min(...S.plan.trucks.map((x) => x.at));
    S.plan.waves.forEach((w) => w.routes.forEach((n) => (S.routes[n - 1].wave = w)));
    S.plan.end = Math.max(...S.plan.waves.map((w) => w.deadline + SH.maxWait));

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
      r.upstream++;
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
          p.where = "bag"; r.bag.push(p); S.stowed++; S.sorted++; r.upstream--; S.stowLog.push(S.t);
          if (r.dispatched) hist(p, `Llega tarde: la furgoneta de ${r.code} ya salió (rollover)`);
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
    function freeDock() {
      const used = new Set(S.trucks.map((t) => t.dock));
      const free = [...Array(D.count).keys()].filter((i) => !used.has(i));
      return free.length ? free[Math.floor(rand() * free.length)] : -1;
    }
    function dockTruck(id, units, dock) {
      const t = { id, dock, units, total: units, state: "arriving", p: 0, acc: 0 };
      S.trucks.push(t);
      log(`Camión ${t.id} atraca en el muelle ${dock + 1} con ${units} paquetes`, "in");
      return t;
    }
    // Camión extra, fuera del plan
    function addTruck() {
      const dock = freeDock();
      if (dock < 0) return `Los ${D.count} muelles están ocupados`;
      const units = Math.round(D.truckUnits * (0.7 + rand() * 0.6));
      dockTruck("T-" + S.nextTruck++, units, dock);
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
      r.dispatched = true; r.departAt = S.t; r.late = S.t > v.deadline;
      hooks.fx("depart", { van: v, route: r });
      S.vanTimes.push(S.t - v.calledAt); trim(S.vanTimes, 100);
      S.routesOut++; if (r.late) S.routesLate++;
      S.dispatched += v.loaded;
      for (const p of v.items) {
        p.where = "route"; hist(p, `Sale a reparto · ${r.town}`);
        S.deliveries.push({ at: S.t + 45 + rand() * 240, pkg: p });
      }
      const left = r.bag.length + r.cart.length + r.upstream;
      log(`Furgoneta ${v.id} sale con ${v.loaded} paquetes de ${r.code}${r.late ? " · TARDE" : " · a tiempo"}${left ? ` · ${left} se quedan (rollover)` : ""}`, r.late ? "bad" : "out");
    }

    const VEH = 1; // minutos simulados que tarda un vehículo en atracar o salir

    // ── Paso de simulación (dt en minutos simulados) ──────
    function step(dt) {
      S.t += dt;

      // Camiones del plan: atracan a su hora si hay muelle libre; si no, esperan
      if (S.auto) for (const pt of S.plan.trucks) {
        if (pt.state !== "pending" || S.t < pt.at) continue;
        const dock = freeDock();
        if (dock < 0) { if (!S.waitLogged[pt.id]) { S.waitLogged[pt.id] = true; log(`Camión ${pt.id} espera muelle libre`, "warn"); } continue; }
        pt.state = "docked"; pt.dockedAt = S.t;
        dockTruck(pt.id, pt.units, dock);
      }

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
      S.acc.pick = Math.min(S.acc.pick + (rate(P.rate, "pick", P) / 60) * dt, 3);
      if (S.acc.pick >= 1) {
        const queue = S.routes.filter((r) => toPick(r) > 0).sort((a, b) => (a.deadline ?? a.wave?.deadline ?? 1e9) - (b.deadline ?? b.wave?.deadline ?? 1e9) || a.n - b.n);
        // el equipo se reparte entre las dos primeras rutas de la cola
        let k = 0;
        while (S.acc.pick >= 1 && queue.length) {
          const i = k++ % Math.min(queue.length, 2), r = queue[i];
          if (!toPick(r)) { queue.splice(i, 1); continue; }
          S.acc.pick--;
          const p = r.bag.shift();
          const b = geo.bagCenter(r), c = geo.cartCenter(r);
          hist(p, `Pick de la saca de ${r.code}`);
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
          const ready = !r.cart.length && !toPick(r) && !v.incoming && !inFlight(r);
          if ((ready && (r.upstream === 0 || S.t >= v.deadline)) || S.t >= v.deadline + SH.maxWait) depart(v);
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

      // Fin del sort y fin del turno
      if (S.sortDoneAt == null && S.plan.trucks.every((x) => x.state !== "pending") && !S.trucks.some((t) => t.units > 0) && upstreamTotal() === 0) {
        S.sortDoneAt = S.t;
        log(`Sort terminado a las ${clock(L, S.t)}${S.t <= S.plan.cutoff ? " · antes del corte" : " · DESPUÉS del corte"}`, S.t <= S.plan.cutoff ? "out" : "bad");
      }
      if (!S.over && S.routes.every((r) => r.dispatched) && !S.vans.length) {
        S.over = true; S.endAt = S.t;
        log(`Turno terminado: ${S.routesOut - S.routesLate}/${S.routes.length} rutas a tiempo`, "out");
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

    // Paquetes de una ruta que van de camino a su carro de pick
    function inFlight(r) {
      for (const tr of S.transit) if (tr.dest === "cart" && tr.pkg.route === r.n) return true;
      return false;
    }
    const upstreamTotal = () => S.routes.reduce((s, r) => s + r.upstream, 0);

    // Plan de clasificación acumulado: lineal desde el primer camión hasta el corte
    function planAt(t) {
      const f = (t - S.plan.firstTruck) / (S.plan.cutoff - S.plan.firstTruck);
      return Math.round(S.plan.volume * Math.min(Math.max(f, 0), 1));
    }

    // Capacidad nominal de clasificación (paq/min): el más lento entre inducción y stow
    function sortCap(staff) {
      staff = staff || S.staff;
      return Math.min((I.rate * staff.induct) / I.staff, (ST.rate * staff.stow) / ST.staff) / 60;
    }

    // Hora prevista de fin del sort con el ritmo nominal de la plantilla
    function forecast(staff) {
      if (S.sortDoneAt != null && !staff) return { sortEnd: S.sortDoneAt, done: true };
      const future = S.plan.trucks.filter((x) => x.state === "pending");
      const onDock = S.trucks.reduce((s, t) => s + t.units, 0);
      const remaining = upstreamTotal() + onDock + future.reduce((s, x) => s + x.units, 0);
      let end = S.t + remaining / sortCap(staff);
      // no se puede acabar antes de descargar y mover el último camión
      for (const x of future) end = Math.max(end, Math.max(x.at, S.t) + x.units / (D.unloadRate / 60) + 8);
      for (const t of S.trucks) if (t.units) end = Math.max(end, S.t + t.units / (D.unloadRate / 60) + 8);
      return { sortEnd: end, done: false, remaining };
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
      const pick = S.routes.reduce((s, r) => s + toPick(r), 0);
      out.push({ name: "Pick", m: pick / (rate(P.rate, "pick", P) / 60) });
      return out;
    }

    // Métricas del turno
    function metrics() {
      const out = S.routes.filter((r) => r.dispatched);
      const cap = ST.bagCapacity;
      const fill = out.length ? avg(out.filter((r) => r.out).map((r) => r.out / (Math.ceil(r.out / cap) * cap))) : null;
      const rollover = out.reduce((s, r) => s + r.bag.length + r.cart.length + r.upstream, 0);
      return {
        routesTotal: S.routes.length, routesOut: S.routesOut, routesLate: S.routesLate, routesOnTime: S.routesOut - S.routesLate,
        rollover, bagFill: fill, forecast: forecast(), cutoff: S.plan.cutoff,
      };
    }

    // Paquetes que siguen dentro de la estación, contados por estado
    function inPlantCount() {
      let n = 0;
      for (const p of S.pkgs.values()) if (p.where !== "route" && p.where !== "delivered") n++;
      return n;
    }

    return {
      S, L, geo, posOf, step, addTruck, callVan, freePad, laneOf, stagingCount, rate, loads, stowRate, inPlantCount,
      toPick, forecast, metrics, planAt, sortCap, at,
      clock: (t) => clock(L, t),
    };
  }

  function clock(L, t) {
    const m = Math.floor(t + L.shiftStart);
    return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(((m % 60) + 60) % 60).padStart(2, "0");
  }
  function fmtMin(m) { return m < 1 ? "< 1 min" : m < 90 ? Math.round(m) + " min" : (m / 60).toFixed(1) + " h"; }

  const api = { create, geometry, posOf, rng, clock, fmtMin, avg, toShift };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
