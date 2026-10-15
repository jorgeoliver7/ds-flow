// Centro de control: panel, controles y bucle de animación.
(function () {
  "use strict";

  const L = window.DS_LAYOUT;
  const $ = (s) => document.querySelector(s);
  const D = L.docks, R = L.receive, I = L.induct, ST = L.stow, P = L.pick, Y = L.yard;
  const { avg, fmtMin } = DSEngine;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const canvas = $("#ds-map");
  let V = null, ready = false; // render; ready cuando el panel ya existe
  const E = DSEngine.create(L, {
    seed: 7,
    hooks: { log: () => ready && renderLog(), fx: (k, d) => V && V.onFx(k, d), now: () => performance.now() / 1000 },
  });
  const S = E.S, clock = E.clock;
  S.speed = 10 / 60; S.paused = false; S.selected = null; S.tracked = null;
  V = DSRender.create(E, canvas);
  const { rate, stagingCount, loads, stowRate, freePad } = E;
  const loadColor = (m) => V.loadColor(m);
  const C = new Proxy({}, { get: (_, k) => V.C[k] });
  const COARSE = V.COARSE;

  canvas.addEventListener("click", (e) => {
    const h = V.hit(...V.local(e));
    if (h && h.kind === "pkg") { track(h.id); return; }
    S.selected = h; renderDetail();
  });
  canvas.addEventListener("mousemove", (e) => { canvas.style.cursor = V.hit(...V.local(e)) ? "pointer" : "default"; });

  function track(id) {
    if (!S.pkgs.get(id)) { toast("No encuentro ese paquete"); return; }
    S.tracked = id; S.selected = { kind: "pkg", id };
    $("#ds-search").value = id;
    renderDetail();
  }

  // ── Centro de control ─────────────────────────────────
  function toast(msg) {
    const el = $("#ds-toast"); el.textContent = msg; el.classList.add("is-on");
    clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove("is-on"), 2400);
  }

  function renderKpis() {
    const vans = S.routesOut, onTime = vans ? Math.round((S.vansOnTime / vans) * 100) + "%" : "—";
    const kp = [
      ["Hora", clock(S.t)],
      ["Recibidos", S.received],
      ["En planta", S.received - S.dispatched],
      ["Stow / h", stowRate()],
      ["Dock-to-stow", S.dockToStow.length ? fmtMin(avg(S.dockToStow)) : "—"],
      ["Rutas fuera", vans],
      ["En reparto", S.dispatched - S.delivered],
      ["Entregados", S.delivered],
      ["Salida a tiempo", onTime],
    ];
    $("#ds-kpis").innerHTML = kp.map(([l, v]) => `<div class="ds-kpi"><span>${l}</span><strong>${typeof v === "number" ? v.toLocaleString("es-ES") : v}</strong></div>`).join("");

    const al = [];
    const worst = loads().sort((a, b) => b.m - a.m)[0];
    if (worst && worst.m > 6) al.push([worst.m > 15 ? "bad" : "warn", `Cuello de botella en ${worst.name}: ${Math.round(worst.m)} min de cola`]);
    const full = S.routes.filter((r) => r.bag.length >= ST.bagCapacity);
    if (full.length) al.push(["bad", `Saca llena en ${full.slice(0, 3).map((r) => r.code).join(", ")}${full.length > 3 ? "…" : ""}: llama a su furgoneta`]);
    const late = S.vans.filter((v) => v.state === "loading" && S.t - v.calledAt > Y.onTimeMinutes);
    if (late.length) al.push(["warn", `${late.length} furgoneta${late.length > 1 ? "s" : ""} por encima de ${Y.onTimeMinutes} min en yard`]);
    if (freePad() < 0) al.push(["warn", "Yard completo: no caben más furgonetas"]);
    if (S.trucks.length === D.count) al.push(["warn", `Los ${D.count} muelles están ocupados`]);
    $("#ds-alerts").innerHTML = al.length ? al.map(([k, m]) => `<li class="is-${k}">${m}</li>`).join("") : `<li class="is-ok">Ciclo estable, sin incidencias</li>`;
  }

  function renderLog() {
    const el = $("#ds-log"); if (!el) return;
    el.innerHTML = S.events.slice(0, 14).map((e) => `<li class="is-${e.kind}"><time>${clock(e.t)}</time>${esc(e.msg)}</li>`).join("");
  }

  const STATUS = { truck: "En el camión", transit: "En movimiento", staging: "En la zona de carros", moving: "Carro de camino a inducción", induct: "Esperando inducción", aisle: "En el conveyor, esperando stow",
    bag: "En la saca", cart: "En el carro de pick", van: "Cargado en furgoneta", route: "En reparto", delivered: "Entregado" };

  function staffCtl(key) {
    return `<div class="ds-staff"><span>Personal</span><button data-staff="${key}" data-d="-1" aria-label="Quitar persona">−</button><b>${S.staff[key]}</b><button data-staff="${key}" data-d="1" aria-label="Añadir persona">+</button></div>`;
  }
  const stats = (rows) => `<ul class="ds-stats">${rows.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join("")}</ul>`;
  const head = (code, title) => `<h3><span class="ds-code">${code}</span>${title}</h3>`;

  function renderDetail() {
    const el = $("#ds-detail"), s = S.selected;
    if (!s) { el.innerHTML = `<p class="ds-hint">Pulsa un paquete en movimiento, una saca, una furgoneta o cualquier zona del mapa. También puedes rastrear un paquete por su código.</p>`; return; }
    if (s.kind === "pkg") {
      const p = S.pkgs.get(s.id); if (!p) { S.selected = null; return renderDetail(); }
      const r = S.routes[p.route - 1];
      el.innerHTML = head("PKG", p.id) +
        stats([["Estado", STATUS[p.where] || p.where], ["Grupo", R.groups[p.group].id], ["Ruta", p.sorted ? `${r.code} · ${r.town}` : "Pendiente de inducción"], ["CP destino", p.cp], ["Tamaño", `${p.size} · ${p.weight} kg`]]) +
        `<ol class="ds-timeline">${p.hist.slice().reverse().map((h) => `<li><time>${clock(h.t)}</time>${esc(h.msg)}</li>`).join("")}</ol>`;
    } else if (s.kind === "lane") {
      const l = S.lanes[s.id], waiting = l.closed.reduce((t, c) => t + c.items.length, 0);
      el.innerHTML = head(l.cls.short, `${l.group.id} · ${l.cls.name}`) +
        `<p>Carros de paquetes ${l.cls.name.toLowerCase()} del grupo ${l.group.id}, que van a los pasillos ${l.group.aisles.map((i) => ST.aisles[i].id).join(" y ")}.</p>` +
        stats([["Carro abierto", l.open ? `${l.open.id} · ${l.open.items.length}/${l.cls.cap}` : "—"], ["Carros cerrados esperando", l.closed.length], ["Paquetes esperando", waiting + (l.open ? l.open.items.length : 0)], ["Capacidad por carro", l.cls.cap]]);
    } else if (s.kind === "route") {
      const r = S.routes[s.id - 1];
      el.innerHTML = head(r.code, `Ruta ${r.code} · ${r.town}`) +
        stats([["Pasillo", ST.aisles[r.aisle].id], ["En la saca", `${r.bag.length}/${ST.bagCapacity}`], ["Por recoger", r.toPick], ["En el carro", r.cart.length], ["Furgoneta", r.van ? r.van.id : "—"], ["Enviados hoy", r.out]]) +
        (!r.van && r.bag.length ? `<button class="ds-btn" data-call="${r.n}">Llamar furgoneta</button>` : "");
    } else if (s.kind === "aisle") {
      const a = S.aisles.find((x) => x.id === s.id), routes = S.routes.filter((r) => r.aisle === a.idx);
      el.innerHTML = head("STW", `Pasillo ${a.id}`) + `<p>${ST.desc}</p>` +
        stats([["Rutas", `${routes[0].code}–${routes[routes.length - 1].code}`], ["Esperando stow", a.queue.length], ["Stoweados", a.done], ["Paquetes en sacas", routes.reduce((t, r) => t + r.bag.length, 0)]]) + staffCtl("stow");
    } else if (s.kind === "truck") {
      const t = S.trucks.find((x) => x.id === s.id); if (!t) { S.selected = null; return renderDetail(); }
      el.innerHTML = head("IN", `Camión ${t.id}`) + `<p>Tráiler que llega desde un centro de distribución, en el muelle ${t.dock + 1}.</p>` +
        stats([["Estado", { arriving: "Atracando", unloading: "Descargando", leaving: "Saliendo" }[t.state]], ["Quedan", `${t.units}/${t.total}`], ["Ritmo", D.unloadRate + " paq/h"]]);
    } else if (s.kind === "van") {
      const v = S.vans.find((x) => x.id === s.id); if (!v) { S.selected = null; return renderDetail(); }
      const r = S.routes[v.route - 1];
      el.innerHTML = head("OUT", `Furgoneta ${v.id}`) + `<p>Ruta ${r.code} hacia ${r.town}, plaza ${v.pad + 1} del yard.</p>` +
        stats([["Estado", { arriving: "Entrando al yard", loading: "Cargando", leaving: "Saliendo a reparto" }[v.state]], ["Carga", `${v.loaded}/${v.expected}`], ["Tiempo en yard", fmtMin(S.t - v.calledAt)], ["Objetivo", `≤ ${Y.onTimeMinutes} min`]]);
    } else if (s.id === "conveyor") {
      el.innerHTML = head("CNV", "Conveyor") + `<p>Lleva cada paquete desde inducción hasta la boca del pasillo de su ruta.</p>` +
        stats([["En la cinta", S.transit.filter((t) => t.belt).length]]);
    } else {
      const cfg = { receive: R, induct: I, pick: P, yard: Y }[s.id];
      let rows;
      if (s.id === "receive") rows = [["Paquetes en carros", stagingCount()], ["Carros esperando", S.lanes.reduce((t, l) => t + l.closed.length, 0)], ["Carros en camino", S.moves.length]];
      if (s.id === "induct") rows = [["En cola", S.inductQ.length], ["Capacidad", Math.round(rate(I.rate, "induct", I)) + " paq/h"]];
      if (s.id === "pick") rows = [["Por recoger", S.routes.reduce((t, r) => t + r.toPick, 0)], ["Rutas en pick", S.routes.filter((r) => r.toPick || r.cart.length).length], ["Capacidad", Math.round(rate(P.rate, "pick", P)) + " paq/h"]];
      if (s.id === "yard") rows = [["Furgonetas", `${S.vans.length}/${Y.pads}`], ["Tiempo medio en yard", S.vanTimes.length ? fmtMin(avg(S.vanTimes)) : "—"], ["Salidas", S.routesOut]];
      el.innerHTML = head(cfg.code, cfg.name) + `<p>${cfg.desc}</p>` + stats(rows) + (s.id !== "yard" ? staffCtl(s.id) : "");
    }
  }

  // Delegado con pointerdown: el panel se redibuja a menudo y un click normal se perdería
  const detailEl = $("#ds-detail");
  function onDetail(e) {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.staff) { const k = b.dataset.staff; S.staff[k] = Math.max(1, Math.min(60, S.staff[k] + Number(b.dataset.d))); }
    if (b.dataset.call) { const err = E.callVan(S.routes[Number(b.dataset.call) - 1]); if (err) toast(err); }
    renderDetail();
  }
  detailEl.addEventListener("pointerdown", onDetail);
  detailEl.addEventListener("click", (e) => { if (e.detail === 0) onDetail(e); });

  // Sparkline
  const spark = $("#ds-spark"), sctx = spark.getContext("2d");
  function drawSpark() {
    const dpr = window.devicePixelRatio || 1, w = spark.clientWidth, h = spark.clientHeight;
    if (spark.width !== Math.round(w * dpr)) { spark.width = Math.round(w * dpr); spark.height = Math.round(h * dpr); }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0); sctx.clearRect(0, 0, w, h);
    const H = S.history; if (H.length < 2) return;
    const line = (key, color) => {
      const max = Math.max(...H.map((p) => p[key]), 1);
      sctx.strokeStyle = color; sctx.lineWidth = 1.6; sctx.beginPath();
      H.forEach((p, i) => { const x = (i / (H.length - 1)) * w, y = h - 4 - (p[key] / max) * (h - 10); i ? sctx.lineTo(x, y) : sctx.moveTo(x, y); });
      sctx.stroke();
    };
    line("plant", C.raw); line("stow", C.aisle[0]);
  }

  // ── Controles ─────────────────────────────────────────
  $("#ds-add-truck").addEventListener("click", () => { const err = E.addTruck(); if (err) toast(err); });
  $("#ds-add-van").addEventListener("click", () => { const err = E.callVan(null); if (err) toast(err); });
  const pauseBtn = $("#ds-pause");
  pauseBtn.addEventListener("click", () => {
    S.paused = !S.paused;
    pauseBtn.textContent = S.paused ? "▶ Reanudar" : "❚❚ Pausa";
    pauseBtn.setAttribute("aria-pressed", String(S.paused));
  });
  // el selector es un multiplicador sobre tiempo real; el motor avanza en minutos simulados
  $("#ds-speed").addEventListener("change", (e) => { S.speed = Number(e.target.value) / 60; });
  $("#ds-auto").addEventListener("change", (e) => { S.auto = e.target.checked; });
  $("#ds-track-form").addEventListener("submit", (e) => { e.preventDefault(); track($("#ds-search").value.trim().toUpperCase()); });
  $("#ds-random").addEventListener("click", () => {
    const live = [...S.transit.map((t) => t.pkg), ...S.routes.flatMap((r) => r.bag)];
    if (!live.length) { toast("Todavía no hay paquetes en planta"); return; }
    track(live[Math.floor(Math.random() * live.length)].id);
  });
  document.querySelectorAll("[data-zone]").forEach((b) => b.addEventListener("click", () => {
    const z = b.dataset.zone;
    S.selected = z.startsWith("aisle") ? { kind: "aisle", id: z.slice(5) } : { kind: "zone", id: z };
    renderDetail();
  }));

  const themeBtn = $("#ds-theme");
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("a-theme", t); } catch (e) {}
    themeBtn.textContent = t === "light" ? "☾" : "☀";
    V.readColors();
  }
  themeBtn.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
  let saved = "dark"; try { saved = localStorage.getItem("a-theme") || "dark"; } catch (e) {}
  applyTheme(saved === "light" ? "light" : "dark");

  // ── Bucle ─────────────────────────────────────────────
  let last = performance.now(), uiAcc = 0, mapVisible = true;
  // si el mapa no está en pantalla (p. ej. leyendo el panel en el móvil), la simulación sigue pero no se dibuja
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { mapVisible = es[0].isIntersecting; }).observe(canvas);
  // en táctil dibujamos a ~30 fps: el movimiento sigue fluido y el móvil trabaja la mitad
  const MIN_FRAME = COARSE ? 1000 / 31 : 0;
  function frame(now) {
    if (now - last < MIN_FRAME) { requestAnimationFrame(frame); return; }
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (!S.paused) { let rem = dt * S.speed; while (rem > 0) { const d = Math.min(rem, 0.05); E.step(d); rem -= d; } }
    if (mapVisible) V.draw(now / 1000);
    uiAcc += dt;
    if (uiAcc > (COARSE ? 0.5 : 0.25)) { uiAcc = 0; renderKpis(); drawSpark(); if (S.selected) renderDetail(); }
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", V.resize);
  V.resize();

  ready = true;
  renderDetail(); renderLog(); renderKpis();
  requestAnimationFrame(frame);
})();
