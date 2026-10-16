// Dibujo del plano en canvas. Lee el estado del motor y no lo modifica.
(function (root) {
  "use strict";

  function create(E, canvas) {
    const S = E.S, L = E.L, posOf = E.posOf, rate = E.rate, stagingCount = E.stagingCount, laneOf = E.laneOf;
    const D = L.docks, R = L.receive, I = L.induct, CV = L.conveyor, ST = L.stow, P = L.pick, Y = L.yard, PS = L.problem;
    const { dockX, beltY, bagRect, bagCenter, cartRect, cartCenter, padRect, padCenter, laneRect, laneCenter, center } = E.geo;
    const AISLE_COLORS = ["--ds-a", "--ds-b", "--ds-c", "--ds-d"];
    const ctx = canvas.getContext("2d");
    // el motor avanza a pasos fijos; LEAD son los minutos simulados que el reloj lleva por delante del último paso,
    // y con ellos lo que se mueve se dibuja donde estará, para que vaya fluido a cualquier velocidad
    let LEAD = 0;
    const ahead = (o, minutes) => Math.min(1, o.p + LEAD / minutes);
    const tpos = (tr) => posOf({ pts: tr.pts, segs: tr.segs, d: Math.min(tr.total, tr.d + (tr.belt && S.conveyorDown ? 0 : CV.speed * LEAD)) });

    const loadColor = (m) => (m > 15 ? C.bad : m > 6 ? C.warn : C.ok);

    // ── Render ────────────────────────────────────────────
    let C = {};
    function readColors() {
      const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
      C = {
        floor: g("--ds-floor"), grid: g("--ds-grid"), zone: g("--ds-zone"), line: g("--ds-line"),
        fg: g("--ds-fg"), soft: g("--ds-fg-soft"), muted: g("--ds-fg-muted"),
        raw: g("--ds-raw"), belt: g("--ds-belt"), truck: g("--ds-truck"), van: g("--ds-van"),
        ok: g("--ds-ok"), warn: g("--ds-warn"), bad: g("--ds-bad"), sel: g("--ds-sel"),
        aisle: AISLE_COLORS.map(g),
        box: g("--ds-box"), hv: g("--ds-hv") || g("--ds-warn"), tape: g("--ds-tape"), shadow: g("--ds-shadow"), wheel: g("--ds-wheel"),
        sans: g("--ds-font-sans"), mono: g("--ds-font-mono"),
      };
      bgDirty = true;
    }

    // Resolución limitada: en móviles con pantallas 3× dibujar a resolución nativa
    // multiplica por 4 el trabajo sin que se note la diferencia.
    const COARSE = window.matchMedia("(pointer: coarse)").matches;
    const DPR = () => Math.min(window.devicePixelRatio || 1, COARSE ? 1.25 : 2);
    let scale = 1, bgDirty = true;
    const bg = document.createElement("canvas"), bctx = bg.getContext("2d");
    function resize() {
      const w = canvas.parentElement.clientWidth, dpr = DPR();
      scale = w / L.width;
      canvas.style.height = L.height * scale + "px";
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(L.height * scale * dpr);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      bgDirty = true;
    }

    // El suelo (color + rejilla de puntos o líneas) no cambia: se pinta una vez
    function paintBackground() {
      bg.width = canvas.width; bg.height = canvas.height;
      bctx.setTransform(canvas.width / L.width, 0, 0, canvas.height / L.height, 0, 0);
      bctx.fillStyle = C.floor; bctx.fillRect(0, 0, L.width, L.height);
      bctx.fillStyle = C.grid;
      for (let x = 12; x < L.width; x += 24) for (let y = 12; y < L.height; y += 24) bctx.fillRect(x - 1, y - 1, 2, 2);
      bgDirty = false;
    }

    // Sombra barata: una copia desplazada en vez de shadowBlur, que en móvil es carísimo
    function softShadow(x, y, w, h, r, off) {
      ctx.fillStyle = C.shadow; rr(x, y + off, w, h, r); ctx.fill();
    }

    function rr(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    // superficie de zona con sombra suave
    function card(x, y, w, h, r) {
      const rad = r + 6;
      softShadow(x, y, w, h, rad, 4);
      ctx.fillStyle = C.zone; rr(x, y, w, h, rad); ctx.fill();
    }
    const isSel = (kind, id) => S.selected && S.selected.kind === kind && S.selected.id === id;
    function text(s, x, y, font, color, align) {
      ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || "left"; ctx.fillText(s, x, y); ctx.textAlign = "left";
    }
    const MONO = (w, s) => `${w} ${s}px ${C.mono}`;
    const SANS = (w, s) => `${w} ${s}px ${C.sans}`;

    function zoneBox(z, kind, loadM) {
      card(z.x, z.y, z.w, z.h, 10);
      ctx.lineWidth = isSel("zone", kind) ? 2.5 : 1; ctx.strokeStyle = isSel("zone", kind) ? C.sel : C.line; ctx.stroke();
      if (loadM !== undefined) { ctx.fillStyle = loadColor(loadM); rr(z.x, z.y, z.w, 4, 2); ctx.fill(); }
      ctx.textBaseline = "top";
      text(z.code, z.x + 10, z.y + 12, MONO(600, 10), C.muted);
      text(z.name, z.x + 10, z.y + 26, SANS(600, 13), C.fg);
    }

    function queueDots(x, y, w, n, color, max) {
      const s = 7, cols = Math.max(1, Math.floor(w / s)), shown = Math.min(n, max);
      ctx.fillStyle = color;
      for (let i = 0; i < shown; i++) ctx.fillRect(x + (i % cols) * s, y + Math.floor(i / cols) * s, s - 2, s - 2);
    }

    function drawBelts(time) {
      const belt = (pts, w) => {
        ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.strokeStyle = C.belt; ctx.lineWidth = w; ctx.setLineDash([]);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.strokeStyle = C.floor; ctx.lineWidth = w - 5; ctx.setLineDash([2, 6]);
        ctx.lineDashOffset = S.paused ? 0 : -time * 12 * Math.min(S.speed * 6, 4);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.restore();
      };
      belt([{ x: CV.x, y: CV.top }, { x: CV.x, y: CV.bottom }], 14);
      for (const a of ST.aisles) belt([{ x: CV.x, y: beltY(a) }, { x: ST.x + ST.w - 10, y: beltY(a) }], 10);
      ctx.textBaseline = "top";
      ctx.save(); ctx.translate(CV.x - 22, (CV.top + CV.bottom) / 2); ctx.rotate(-Math.PI / 2);
      text("CONVEYOR", 0, 0, MONO(600, 10), C.muted, "center"); ctx.restore();
    }

    function drawDocks() {
      ctx.strokeStyle = C.line; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(D.left - 14, D.wallY); ctx.lineTo(D.right + 14, D.wallY); ctx.stroke();
      ctx.textBaseline = "middle";
      for (let i = 0; i < D.count; i++) {
        const x = dockX(i);
        ctx.fillStyle = C.line; ctx.fillRect(x - 26, D.wallY - 4, 52, 8);
        text("D" + (i + 1), x, D.wallY - 50, MONO(600, 11), C.muted, "center");
      }
      text("DOCK", D.right + 22, D.wallY - 60, MONO(600, 10), C.muted);
      text(D.count + " muelles", D.right + 22, D.wallY - 44, MONO(500, 10), C.muted);
      // camiones esperando en la puerta: check-in o muelle libre
      if (S.gate.length) text(`${S.gate.length} en puerta`, D.right + 22, D.wallY - 78, MONO(600, 10), C.warn);
      if (D.marshal) marshalBadge("dock", D.right + 16, D.wallY - 32);
    }

    const ease = (p) => 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), 3);

    // Marshal en su puesto: verde si está cuando hace falta, rojo si falta, gris fuera de su horario.
    // Devuelve el recuadro para poder pulsarlo en el mapa.
    const badges = {};
    function marshalBadge(key, x, y, right) {
      const n = S.staff[key], on = E.marshalsOn()[key], miss = on && !n;
      const label = miss ? `Sin ${key} marshall` : `${n > 1 ? n + " × " : ""}${key === "dock" ? "Dock" : "Yard"} marshall`;
      const col = miss ? C.bad : on ? C.ok : C.muted;
      ctx.font = SANS(600, 10);
      const w = ctx.measureText(label).width + 30, h = 20;
      if (right) x -= w;
      ctx.fillStyle = C.zone; rr(x, y, w, h, 10); ctx.fill();
      ctx.lineWidth = isSel("marshal", key) ? 2 : 1; ctx.strokeStyle = isSel("marshal", key) ? C.sel : col; ctx.stroke();
      // persona: cabeza y hombros (tachada si falta)
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x + 12, y + 7, 3, 0, Math.PI * 2); ctx.fill();
      rr(x + 7, y + 11, 10, 6, 3); ctx.fill();
      if (miss) { ctx.strokeStyle = C.bad; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 5, y + 17); ctx.lineTo(x + 19, y + 3); ctx.stroke(); }
      ctx.textBaseline = "middle";
      text(label, x + 23, y + h / 2 + 0.5, SANS(600, 10), miss ? C.bad : on ? C.fg : C.muted);
      badges[key] = { x, y, w, h };
    }

    function drawTruck(t) {
      const tp = t.state === "unloading" ? t.p : ahead(t, E.VEH);
      const off = t.state === "arriving" ? (1 - ease(tp)) * -130 : t.state === "leaving" ? ease(tp) * -130 : 0;
      const w = 66, h = 96, x = dockX(t.dock) - w / 2, y = D.wallY - h - 6 + off;
      const moving = t.state !== "unloading";
      ctx.fillStyle = C.wheel;
      for (const wy of [y + 18, y + h - 22]) for (const wx of [x - 4, x + w - 2]) {
        rr(wx, wy, 6, 14, 2); ctx.fill();
        if (moving) { ctx.fillStyle = C.floor; ctx.fillRect(wx + 1, wy + ((NOW * 40) % 12), 4, 2); ctx.fillStyle = C.wheel; }
      }
      if (moving && Math.random() < 0.3) burst(x + w / 2 + (Math.random() - 0.5) * 20, y - 10, C.line, 1, 0.5);
      softShadow(x, y, w, h, 10, 3);
      ctx.fillStyle = C.truck; rr(x, y, w, h, 10); ctx.fill();
      if (isSel("truck", t.id)) { ctx.strokeStyle = C.sel; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = C.line; rr(x + 10, y - 8, w - 20, 12, 3); ctx.fill(); // cabina
      ctx.fillStyle = C.raw; ctx.fillRect(x + 7, y + h - 12, (w - 14) * (t.units / t.total), 4);
      ctx.textBaseline = "middle";
      text(t.id, x + w / 2, y + 30, MONO(600, 10), C.fg, "center");
      text(t.units + " paq", x + w / 2, y + 48, MONO(500, 10), C.soft, "center");
    }

    const movePos = (m) => posOf({ pts: m.pts, segs: m.segs, d: ahead(m, R.moveMinutes / E.pf("receive")) * m.total });

    function drawCartIcon(x, y, w, h, fill, color, open, k) {
      ctx.fillStyle = C.wheel; ctx.fillRect(x + 2, y + h - 1, 3, 3); ctx.fillRect(x + w - 5, y + h - 1, 3, 3);
      ctx.fillStyle = C.floor; rr(x, y, w, h, 4); ctx.fill();
      ctx.save(); rr(x, y, w, h, 4); ctx.clip();
      ctx.fillStyle = C.box; const fh = h * fill * (1 + (k || 0) * 0.08);
      ctx.fillRect(x, y + h - fh, w, fh); ctx.restore();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      if (open) ctx.setLineDash([3, 2]);
      rr(x, y, w, h, 4); ctx.stroke(); ctx.setLineDash([]);
    }

    function drawStaging() {
      const n = stagingCount();
      zoneBox(R, "receive", n / (rate(I.rate, "induct", I) / 60));
      ctx.textBaseline = "top";
      text(String(n), R.x + 10, R.y + 50, MONO(600, 20), C.fg);
      text("paquetes en carros", R.x + 10, R.y + 74, SANS(500, 10), C.muted);
      // carga para la noche aparcada en la playa (turno de tarde)
      const held = E.heldCount();
      if (held) text(`${held} para la noche`, R.x + 10, R.y + 90, MONO(600, 9), C.soft);
      R.groups.forEach((g, gi) => {
        const first = laneRect(S.lanes[gi * R.classes.length]), last = laneRect(S.lanes[gi * R.classes.length + R.classes.length - 1]);
        text(g.id, first.x, R.y + 10, MONO(600, 11), C.aisle[g.aisles[0]]);
        text("pasillos " + g.aisles.map((i) => ST.aisles[i].id).join("·"), last.x + last.w, R.y + 11, MONO(500, 9), C.muted, "right");
      });
      const cw = 16, ch = 22, gap = 5;
      for (let i = 0; i < S.lanes.length; i++) {
        const l = S.lanes[i], lr = laneRect(l), col = C.aisle[l.group.aisles[0]];
        ctx.fillStyle = C.floor; rr(lr.x, lr.y, lr.w, lr.h, 8); ctx.fill();
        if (isSel("lane", i)) { ctx.strokeStyle = C.sel; ctx.lineWidth = 2; ctx.stroke(); }
        text(l.cls.short, lr.x + 5, lr.y + lr.h - 12, MONO(600, 8), C.muted);
        // primero los carros del turno; detrás, más apagados, los que esperan al sort de la noche
        const carts = (l.open ? [l.open] : []).concat(l.closed, l.holdOpen ? [l.holdOpen] : [], l.held);
        const perRow = Math.floor((lr.w - 6) / (cw + gap)), rows = 2, max = perRow * rows;
        carts.slice(0, max).forEach((c, j) => {
          const x = lr.x + 5 + (j % perRow) * (cw + gap), y = lr.y + 5 + Math.floor(j / perRow) * (ch + 6);
          if (c.hold) ctx.globalAlpha = 0.4;
          drawCartIcon(x, y, cw, ch, c.items.length / l.cls.cap, col, c === l.open || c === l.holdOpen, bump(c.bump || 0, NOW));
          ctx.globalAlpha = 1;
        });
        if (carts.length > max) text("+" + (carts.length - max), lr.x + lr.w - 4, lr.y + lr.h - 12, MONO(600, 8), C.soft, "right");
      }
    }

    function drawMoves() {
      for (const m of S.moves) {
        const p = movePos(m), l = m.lane;
        drawCartIcon(p.x - 8, p.y - 11, 16, 22, m.cart.items.length / l.cls.cap, C.aisle[l.group.aisles[0]], false, 0);
      }
    }

    function drawQueueZone(z, kind, q, cfg) {
      zoneBox(z, kind, q.length / (rate(cfg.rate, kind, cfg) / 60));
      ctx.textBaseline = "top";
      if (z.w > 300) {
        text(String(q.length), z.x + 130, z.y + 12, MONO(600, 22), C.fg);
        text("en cola", z.x + 130, z.y + 40, SANS(500, 10), C.muted);
        const qw = z.w - 232, rows = Math.floor((z.h - 18) / 7);
        queueDots(z.x + 220, z.y + 12, qw, q.length, C.raw, Math.floor(qw / 7) * rows);
      } else {
        text(String(q.length) + " en cola", z.x + 10, z.y + 50, MONO(600, 12), C.fg);
      }
    }

    function drawAisles() {
      // stow es un solo equipo: el color de la cola sale de lo que espera en todos los pasillos
      const stowMin = S.aisles.reduce((n, a) => n + a.queue.length, 0) / (rate(ST.rate, "stow", ST) / 60);
      for (const a of S.aisles) {
        const sel = isSel("aisle", a.id);
        card(ST.x, a.y, ST.w, ST.h, 10);
        ctx.lineWidth = sel ? 2.5 : 1; ctx.strokeStyle = sel ? C.sel : C.line; ctx.stroke();
        ctx.fillStyle = loadColor(a.queue.length ? stowMin : 0); rr(ST.x, a.y, 4, ST.h, 2); ctx.fill();
        ctx.textBaseline = "middle";
        text("PASILLO " + a.id, ST.x + ST.w - 12, a.y + 8, MONO(600, 9), C.muted, "right");
        if (a.queue.length) text(a.queue.length + " por stowear", ST.x + 14, a.y + 8, MONO(500, 9), C.soft);
      }
      if (SHELVES > 1) { drawRacks(); return; }
      for (const r of S.routes) {
        let b = bagRect(r);
        // la saca que se está llenando: cuando una se completa se cierra y se empieza otra
        const col = C.aisle[r.aisle], n = r.bag.length, bags = Math.ceil(n / ST.bagCapacity);
        const f = n ? (n % ST.bagCapacity || ST.bagCapacity) / ST.bagCapacity : 0;
        // la saca se infla con la carga y rebota al recibir un paquete
        const k = bump(r.bump || 0, NOW), sx = 0.9 + f * 0.1 + k * 0.06, sy = 0.92 + f * 0.08 - k * 0.04;
        b = { x: b.x + (b.w * (1 - sx)) / 2, y: b.y + b.h * (1 - sy), w: b.w * sx, h: b.h * sy };
        ctx.fillStyle = col; rr(b.x + b.w / 2 - 5, b.y - 4, 10, 6, 3); ctx.fill(); // nudo
        ctx.fillStyle = C.floor; rr(b.x, b.y, b.w, b.h, 10); ctx.fill();
        ctx.save(); rr(b.x, b.y, b.w, b.h, 10); ctx.clip();
        ctx.fillStyle = col; ctx.globalAlpha = 0.7; ctx.fillRect(b.x, b.y + b.h * (1 - f), b.w, b.h * f); ctx.restore();
        const sel = isSel("route", r.n), late = r.dispatched && n > 0;
        ctx.lineWidth = r.van || sel || r.picking || late ? 2 : 1;
        ctx.strokeStyle = sel ? C.sel : late ? C.bad : r.van ? C.ok : r.picking && !r.dispatched ? C.warn : C.line;
        if (r.dispatched && !n) ctx.setLineDash([3, 3]);
        rr(b.x, b.y, b.w, b.h, 10); ctx.stroke(); ctx.setLineDash([]);
        ctx.textBaseline = "top";
        text(r.code, b.x + b.w / 2, b.y + 5, MONO(600, 9), C.fg, "center");
        if (r.dispatched && !n) text("✓", b.x + b.w / 2, b.y + b.h / 2 - 6, MONO(600, 12), C.ok, "center");
        else {
          text(String(n), b.x + b.w / 2, b.y + b.h - 15, MONO(600, 10), C.fg, "center");
          if (bags > 1) text("×" + bags, b.x + b.w / 2, b.y + 17, MONO(500, 8), C.soft, "center");
        }
      }
      ctx.textBaseline = "top";
      text(`STOW A SACAS · ${S.routes.length} RUTAS`, ST.x + ST.w / 2, Math.max(...ST.aisles.map((a) => a.y)) + ST.h + 10, MONO(600, 10), C.muted, "center");
    }

    // Estanterías: una balda por ruta, con la saca que se está llenando como barra horizontal
    const SHELVES = ST.shelves || 1;
    function drawRacks() {
      const racks = ST.racksPerAisle;
      for (const a of S.aisles) for (let k = 0; k < racks; k++) {
        const r0 = bagRect(S.routes[a.idx * ST.routesPerAisle + k * SHELVES]);
        ctx.fillStyle = C.floor; rr(r0.x - 2, r0.y - 2, r0.w + 4, (r0.h + 2) * SHELVES + 2, 6); ctx.fill();
      }
      for (const r of S.routes) {
        const b = bagRect(r), col = C.aisle[r.aisle], n = r.bag.length;
        const f = n ? (n % ST.bagCapacity || ST.bagCapacity) / ST.bagCapacity : 0, k = bump(r.bump || 0, NOW);
        if (r.off) { ctx.globalAlpha = 0.35; }
        ctx.fillStyle = col; ctx.globalAlpha *= 0.55 + k * 0.4;
        ctx.fillRect(b.x + 1, b.y + 1, (b.w - 2) * f, b.h - 2); ctx.globalAlpha = 1;
        const sel = isSel("route", r.n), late = r.dispatched && n > 0;
        if (sel || late || r.van || (r.picking && !r.dispatched)) {
          ctx.lineWidth = sel ? 2 : 1.5;
          ctx.strokeStyle = sel ? C.sel : late ? C.bad : r.van ? C.ok : C.warn;
          rr(b.x, b.y, b.w, b.h, 3); ctx.stroke();
        }
        ctx.textBaseline = "middle";
        text(r.code, b.x + 4, b.y + b.h / 2 + 1, MONO(600, 8), r.off ? C.muted : C.fg);
        if (r.dispatched && !n) text("✓", b.x + b.w - 4, b.y + b.h / 2 + 1, MONO(600, 9), C.ok, "right");
        else if (n) text(String(n), b.x + b.w - 4, b.y + b.h / 2 + 1, MONO(500, 8), C.soft, "right");
      }
      ctx.textBaseline = "top";
      const active = S.routes.filter((r) => !r.off).length;
      text(`STOW · ${S.aisles.length * racks} ESTANTERÍAS · ${active} RUTAS`, ST.x + ST.w / 2, Math.max(...ST.aisles.map((a) => a.y)) + ST.h + 10, MONO(600, 10), C.muted, "center");
    }

    function drawPick() {
      const toPick = S.routes.reduce((s, r) => s + E.toPick(r), 0);
      card(P.x, P.y, P.w, P.h, 10);
      ctx.lineWidth = isSel("zone", "pick") ? 2.5 : 1; ctx.strokeStyle = isSel("zone", "pick") ? C.sel : C.line; ctx.stroke();
      ctx.fillStyle = loadColor(toPick / (rate(P.rate, "pick", P) / 60)); rr(P.x, P.y, P.w, 4, 2); ctx.fill();
      ctx.textBaseline = "top";
      text("PICK · CARROS", P.x + P.w / 2, P.y + P.h + 10, MONO(600, 10), C.muted, "center");
      for (const r of S.routes) {
        if (!r.van && !r.cart.length && !E.toPick(r)) continue;
        const c = cartRect(r), col = C.aisle[r.aisle];
        ctx.fillStyle = C.floor; rr(c.x, c.y, c.w, c.h, 3); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.textBaseline = "middle";
        if (c.h >= 20) {
          text(r.code, c.x + c.w / 2, c.y + c.h / 2 - 4, MONO(600, 8), C.fg, "center");
          text(String(r.cart.length), c.x + c.w / 2, c.y + c.h / 2 + 6, MONO(500, 8), C.soft, "center");
        } else {
          // celdas pequeñas: el carro se llena de color según lo recogido
          const tot = r.cart.length + E.toPick(r);
          ctx.fillStyle = col; ctx.globalAlpha = 0.6; ctx.fillRect(c.x + 1, c.y + 1, (c.w - 2) * (tot ? r.cart.length / tot : 1), c.h - 2); ctx.globalAlpha = 1;
          text(String(r.cart.length), c.x + c.w / 2, c.y + c.h / 2 + 1, MONO(600, 7), C.fg, "center");
        }
      }
    }

    function drawProblem() {
      const n = S.psQ.length;
      zoneBox(PS, "problem", n / (rate(PS.uph * PS.staff, "ps", PS) / 60));
      ctx.textBaseline = "top";
      text(String(n), PS.x + 10, PS.y + 50, MONO(600, 20), n ? C.bad : C.fg);
      text("por resolver", PS.x + 10, PS.y + 74, SANS(500, 10), C.muted);
      queueDots(PS.x + 10, PS.y + 90, PS.w - 20, n, C.bad, Math.floor((PS.w - 20) / 7) * 2);
    }

    function drawYard() {
      ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = isSel("zone", "yard") ? C.sel : C.line; ctx.lineWidth = isSel("zone", "yard") ? 2.5 : 1.5;
      rr(Y.x, Y.y, Y.w, Y.h, 12); ctx.stroke(); ctx.restore();
      ctx.textBaseline = "top";
      text(Y.code, Y.x + 12, Y.y + 9, MONO(600, 10), C.muted);
      text("Yard · furgonetas", Y.x + 44, Y.y + 8, SANS(600, 12), C.fg);
      if (Y.marshal) marshalBadge("yard", Y.x + Y.w - 10, Y.y + 4, true);
      ctx.textBaseline = "top";
      // carril central: entrada por abajo, salida por arriba
      const lx = Y.x + Y.w / 2;
      ctx.save(); ctx.strokeStyle = C.grid; ctx.lineWidth = 2; ctx.setLineDash([10, 10]); ctx.lineDashOffset = S.paused ? 0 : NOW * 20;
      ctx.beginPath(); ctx.moveTo(lx, Y.y + Y.h - 30); ctx.lineTo(lx, Y.y + 34); ctx.stroke(); ctx.restore();
      ctx.fillStyle = C.muted;
      ctx.beginPath(); ctx.moveTo(lx, Y.y + 26); ctx.lineTo(lx - 7, Y.y + 38); ctx.lineTo(lx + 7, Y.y + 38); ctx.closePath(); ctx.fill();
      text("SALIDA", lx + 12, Y.y + 28, MONO(600, 9), C.muted);
      text("ENTRADA", lx, Y.y + Y.h - 22, MONO(600, 9), C.muted, "center");
      for (let i = 0; i < Y.pads; i++) {
        const p = padRect(i);
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); rr(p.x, p.y, p.w, p.h, 6); ctx.stroke(); ctx.setLineDash([]);
        text("P" + (i + 1), p.x + 5, p.y + 4, MONO(500, 8), C.muted);
      }
      for (const v of S.vans) {
        const p = padRect(v.pad), r = S.routes[v.route - 1];
        const vp = v.state === "arriving" ? ahead(v, S.staff.yard ? E.VEH : Y.marshal.parkNoMarshal) : v.state === "leaving" ? ahead(v, E.VEH) : v.p;
        const off = v.state === "arriving" ? (1 - ease(vp)) * 120 : v.state === "leaving" ? ease(vp) * -120 : 0;
        ctx.globalAlpha = v.state === "arriving" ? Math.max(ease(vp), 0.05) : v.state === "leaving" ? 1 - ease(vp) : 1;
        let x = p.x + 6, y = p.y + 12 + off, w = p.w - 12, h = p.h - 18;
        // la furgoneta se hunde un poco con cada paquete y lleva ruedas que giran al moverse
        const k = bump(v.bump || 0, NOW);
        y += k * 2;
        ctx.fillStyle = C.wheel;
        for (const wy of [y + 10, y + h - 16]) for (const wx of [x - 3, x + w - 3]) {
          rr(wx, wy, 6, 11, 2); ctx.fill();
          if (v.state !== "loading") { ctx.fillStyle = C.floor; ctx.fillRect(wx + 1, wy + ((NOW * 40) % 9), 4, 2); ctx.fillStyle = C.wheel; }
        }
        if (v.state === "leaving" && Math.random() < 0.5) burst(x + w / 2, y + h + 4, C.line, 1, 0.6);
        softShadow(x, y, w, h, 12, 3);
        ctx.fillStyle = C.van; rr(x, y, w, h, 12); ctx.fill();
        ctx.fillStyle = C.line; rr(x + 8, y - 3, w - 16, 6, 3); ctx.fill(); // parabrisas
        ctx.fillStyle = C.aisle[r.aisle]; ctx.fillRect(x + 4, y, w - 8, 3);
        if (isSel("van", v.id)) { ctx.strokeStyle = C.sel; ctx.lineWidth = 2; rr(x, y, w, h, 12); ctx.stroke(); }
        const expected = v.loaded + v.incoming + r.cart.length + E.toPick(r);
        ctx.fillRect(x + 6, y + h - 9, (w - 12) * (v.loaded / Math.max(expected, 1)), 4);
        ctx.textBaseline = "top";
        // minutos que le quedan para salir a tiempo (en rojo si ya se pasó)
        const left = v.deadline - S.t, leftTxt = (left >= 0 ? Math.ceil(left) : "+" + Math.ceil(-left)) + "′";
        const leftCol = left < 0 ? C.bad : left < 5 ? C.warn : C.muted;
        if (w > 90) {
          text(v.id, x + 6, y + 9, MONO(600, 10), C.fg);
          text(r.code + " · " + v.loaded + "/" + expected, x + 6, y + 23, MONO(500, 9), C.soft);
          if (v.state === "loading") text(leftTxt, x + w - 6, y + 9, MONO(600, 9), leftCol, "right");
        } else {
          // furgoneta estrecha (yard con muchas plazas): ruta, carga y minutos en líneas cortas
          const cx = x + w / 2;
          text(r.code, cx, y + 8, MONO(600, 9), C.fg, "center");
          text(String(v.loaded), cx, y + 21, MONO(500, 8), C.soft, "center");
          if (v.state === "loading") text(leftTxt, cx, y + 33, MONO(600, 8), leftCol, "center");
        }
        ctx.globalAlpha = 1;
      }
    }

    function drawTransit(time) {
      for (const tr of S.transit) {
        const p = tpos(tr), pkg = tr.pkg;
        const col = pkg.issue && (tr.dest === "ps" || pkg.where === "ps") ? C.bad : pkg.sorted ? C.aisle[S.routes[pkg.route - 1].aisle] : C.raw;
        // cajita de cartón que se balancea, con la cinta del color de su pasillo
        const seed = pkg.seed || (pkg.seed = Math.random() * 6.28);
        const big = pkg.size === "Oversize" ? 1.35 : pkg.size === "Sobre" ? 0.8 : 1;
        ctx.save();
        ctx.translate(p.x, p.y + Math.sin(time * 9 + seed) * 0.9);
        ctx.rotate(Math.sin(time * 3 + seed) * 0.14);
        ctx.scale(big, big);
        ctx.fillStyle = C.shadow; rr(-4.5, -3, 10, 9, 2); ctx.fill();
        ctx.fillStyle = C.box; rr(-5, -5, 10, 9, 2); ctx.fill();
        ctx.fillStyle = col; ctx.fillRect(-1.2, -5, 2.4, 9);
        // high value: marco dorado para verlo de un vistazo
        if (pkg.hv) { ctx.strokeStyle = C.hv; ctx.lineWidth = 1.6; rr(-6.5, -6.5, 13, 12, 3); ctx.stroke(); }
        ctx.restore();
      }
    }

    // ── Partículas ──────────────────────────────────────
    const fx = [];
    function burst(x, y, color, n, power) {
      if (fx.length > 400) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * power;
        fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.6, life: 1, color, r: 1.5 + Math.random() * 2 });
      }
    }
    let fxLast = 0;
    function drawFx(time) {
      const dt = Math.min(time - fxLast, 0.05); fxLast = time;
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        f.x += f.vx * dt * 60; f.y += f.vy * dt * 60; f.vy += 0.12 * dt * 60; f.life -= dt * 1.6;
        if (f.life <= 0) { fx.splice(i, 1); continue; }
        ctx.globalAlpha = f.life; ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const bump = (since, now) => Math.max(0, 1 - (now - since) * 5);

    function trackedPos() {
      const p = S.tracked && S.pkgs.get(S.tracked);
      if (!p) return null;
      const r = S.routes[p.route - 1];
      switch (p.where) {
        case "transit": return p.tr ? tpos(p.tr) : null;
        case "staging": case "held": { const l = laneOf(p); return l ? laneCenter(l) : center(R); }
        case "moving": { const m = S.moves.find((x) => x.cart.items.includes(p)); return m ? movePos(m) : center(I); }
        case "induct": return center(I);
        case "ps": return center(PS);
        case "aisle": return { x: ST.x + 14, y: beltY(ST.aisles[r.aisle]) };
        case "bag": return bagCenter(r);
        case "cart": return cartCenter(r);
        case "van": { const v = S.vans.find((x) => x.id === p.van); return v ? padCenter(v.pad) : null; }
      }
      return null;
    }

    let NOW = 0;
    function draw(time, lead) {
      NOW = time; LEAD = lead || 0;
      if (bgDirty) paintBackground();
      ctx.drawImage(bg, 0, 0, L.width, L.height);
      drawDocks(); drawBelts(time);
      drawStaging();
      drawQueueZone(I, "induct", S.inductQ, I);
      drawAisles(); drawPick(); drawProblem(); drawYard();
      for (const t of S.trucks) drawTruck(t);
      drawMoves();
      drawTransit(time);
      drawFx(time);
      // aviso encima de los paquetes para que se lea siempre
      if (S.conveyorDown) {
        const y = (CV.top + CV.bottom) / 2;
        ctx.textBaseline = "middle";
        ctx.fillStyle = C.bad; rr(CV.x - 32, y - 10, 64, 20, 10); ctx.fill();
        text("PARADO", CV.x, y + 1, MONO(700, 10), C.floor, "center");
      }
      const tp = trackedPos();
      if (tp) {
        // ondas que salen del paquete rastreado
        for (let i = 0; i < 3; i++) {
          const ph = (time * 0.8 + i / 3) % 1;
          ctx.globalAlpha = 1 - ph; ctx.strokeStyle = C.sel; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(tp.x, tp.y, 6 + ph * 26, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // ── Interacción con el mapa ───────────────────────────
    const inside = (x, y, b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    function hit(x, y) {
      let best = null, bd = 10;
      for (const tr of S.transit) { const p = tpos(tr), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = tr.pkg; } }
      if (best) return { kind: "pkg", id: best.id };
      for (const k in badges) if (inside(x, y, { ...badges[k], x: badges[k].x - 4, y: badges[k].y - 4, w: badges[k].w + 8, h: badges[k].h + 8 })) return { kind: "marshal", id: k };
      for (const t of S.trucks) if (y < D.wallY && Math.abs(x - dockX(t.dock)) < 34) return { kind: "truck", id: t.id };
      for (const v of S.vans) if (inside(x, y, padRect(v.pad))) return { kind: "van", id: v.id };
      for (const r of S.routes) if (inside(x, y, bagRect(r))) return { kind: "route", id: r.n };
      for (const r of S.routes) if ((r.van || r.cart.length) && inside(x, y, cartRect(r))) return { kind: "route", id: r.n };
      for (const a of ST.aisles) if (inside(x, y, { x: ST.x, y: a.y, w: ST.w, h: ST.h })) return { kind: "aisle", id: a.id };
      for (let i = 0; i < S.lanes.length; i++) if (inside(x, y, laneRect(S.lanes[i]))) return { kind: "lane", id: i };
      const zones = { receive: R, induct: I, pick: P, problem: PS, yard: Y };
      for (const k in zones) if (inside(x, y, zones[k])) return { kind: "zone", id: k };
      if (Math.abs(x - CV.x) < 12 && y > CV.top && y < CV.bottom) return { kind: "zone", id: "conveyor" };
      return null;
    }

    const local = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };

    // Efectos que dispara el motor
    function onFx(kind, d) {
      if (kind === "stow" && Math.random() < 0.35) { const c = bagCenter(d.route); burst(c.x, bagRect(d.route).y + 4, C.aisle[d.route.aisle], 3, 1.2); }
      if (kind === "depart") { const c = padCenter(d.van.pad); burst(c.x, c.y, C.aisle[d.route.aisle], 16, 2.2); burst(c.x, c.y, C.box, 8, 1.6); }
    }

    return { draw, resize, readColors, hit, local, onFx, loadColor, get C() { return C; }, COARSE };
  }

  root.DSRender = { create };
})(window);
