// Centro de control: panel, controles y bucle de animación.
(function () {
  "use strict";

  const L = window.DS_LAYOUT;
  const $ = (s) => document.querySelector(s);
  const D = L.docks, R = L.receive, I = L.induct, ST = L.stow, P = L.pick, Y = L.yard;
  const { avg, fmtMin } = DSEngine;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => (typeof v === "number" ? v.toLocaleString("es-ES") : v);

  const canvas = $("#ds-map");
  // E: motor, S: su estado, V: render. Se recrean al reiniciar la partida.
  let E, S, V, ready = false;
  const clock = (t) => DSEngine.clock(L, t);
  const C = new Proxy({}, { get: (_, k) => V.C[k] });

  // Escenario: se puede compartir con ?escenario=pico
  const SCN = DSScenarios.list;
  let scenarioId = new URLSearchParams(location.search).get("escenario");
  if (!SCN.some((s) => s.id === scenarioId)) scenarioId = SCN[0].id;
  const scenario = () => SCN.find((s) => s.id === scenarioId);

  function boot() {
    ready = false;
    const prev = S;
    E = DSEngine.create(L, Object.assign(DSScenarios.options(L, scenarioId), {
      hooks: { log: () => ready && renderLog(), fx: (k, d) => V && V.onFx(k, d), now: () => performance.now() / 1000 },
    }));
    S = E.S;
    S.speed = prev ? prev.speed : Number($("#ds-speed").value) / 60;
    S.paused = false; S.selected = null; S.tracked = null; draft = null;
    S.auto = $("#ds-auto").checked;
    V = DSRender.create(E, canvas);
    V.resize(); V.readColors();
    pauseBtn.textContent = "❚❚ Pausa"; pauseBtn.setAttribute("aria-pressed", "false");
    reportShown = false;
    $("#ds-scenario-desc").textContent = scenario().desc;
    ready = true;
    renderDetail(); renderLog(); renderKpis();
  }

  // ── Informe de fin de turno ───────────────────────────
  const reportEl = $("#ds-report");
  let reportShown = false, report = null;
  function openReport() {
    report = DSReport.build(E, scenario());
    $("#ds-report-body").innerHTML = DSReport.html(report);
    if (!reportEl.open) reportEl.showModal();
  }
  $("#ds-report-btn").addEventListener("click", openReport);
  $("#ds-report-close").addEventListener("click", () => reportEl.close());
  $("#ds-report-csv").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([DSReport.csv(report)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `ds-flow-informe-${scenarioId}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("#ds-report-print").addEventListener("click", () => window.print());
  // se imprime siempre en claro, aunque la página esté en oscuro
  let themeBeforePrint = null;
  window.addEventListener("beforeprint", () => { themeBeforePrint = document.documentElement.dataset.theme; document.documentElement.dataset.theme = "light"; });
  window.addEventListener("afterprint", () => { if (themeBeforePrint) document.documentElement.dataset.theme = themeBeforePrint; });

  const scSel = $("#ds-scenario");
  scSel.innerHTML = SCN.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  scSel.value = scenarioId;
  scSel.addEventListener("change", () => {
    scenarioId = scSel.value;
    const url = new URL(location.href);
    if (scenarioId === SCN[0].id) url.searchParams.delete("escenario"); else url.searchParams.set("escenario", scenarioId);
    history.replaceState(null, "", url);
    boot();
  });

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

  // Diferencia con el corte en texto: "20 min antes" / "15 min tarde"
  const vsCutoff = (t, cutoff) => (t <= cutoff ? `${fmtMin(cutoff - t)} antes` : `${fmtMin(t - cutoff)} tarde`);

  function renderKpis() {
    const m = E.metrics(), f = m.forecast, late = f.sortEnd > m.cutoff;
    const kp = [
      ["Hora", clock(S.t)],
      [f.done ? "Fin del sort" : "Fin previsto del sort", `<span class="${late ? "is-bad" : "is-ok"}">${clock(f.sortEnd)}</span>`, vsCutoff(f.sortEnd, m.cutoff) + " del corte"],
      ["Recibidos", S.received, `de ${num(S.plan.volume)} planificados`],
      ["Clasificados", S.sorted],
      ["En planta", S.received - S.dispatched],
      ["Stow / h", E.stowRate()],
      ["Rutas fuera", `${m.routesOut}/${m.routesTotal}`],
      ["Rutas a tiempo", m.routesOut ? `<span class="${m.routesLate ? "is-warn" : "is-ok"}">${m.routesOnTime}/${m.routesOut}</span>` : "—"],
      ["Rollover", m.rollover, "paquetes que se quedan"],
      ["Llenado de saca", m.bagFill == null ? "—" : Math.round(m.bagFill * 100) + "%"],
      ["Horas trabajadas", m.laborHours.toFixed(1)],
      ["Paq / h trabajada", m.pph == null ? "—" : Math.round(m.pph), "clasificados"],
    ];
    $("#ds-kpis").innerHTML = kp.map(([l, v, sub]) => `<div class="ds-kpi"><span>${l}</span><strong>${num(v)}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`).join("");

    const al = [];
    if (!f.done && late && S.t > S.plan.firstTruck) al.push(["bad", `El sort acabaría a las ${clock(f.sortEnd)}, ${fmtMin(f.sortEnd - m.cutoff)} después del corte (${clock(m.cutoff)})`]);
    const worst = E.loads().sort((a, b) => b.m - a.m)[0];
    if (worst && worst.m > 6) al.push([worst.m > 15 ? "bad" : "warn", `Cuello de botella en ${worst.name}: ${Math.round(worst.m)} min de cola`]);
    const overdue = S.vans.filter((v) => v.state === "loading" && S.t > v.deadline);
    if (overdue.length) al.push(["bad", `${overdue.length} furgoneta${overdue.length > 1 ? "s" : ""} fuera de su ventana de salida`]);
    const waiting = S.plan.trucks.filter((x) => x.state === "pending" && S.t >= x.eta).length;
    if (waiting) al.push(["warn", `${waiting} camión${waiting > 1 ? "es esperan" : " espera"} muelle libre`]);
    if (E.freePad() < 0) al.push(["warn", "Yard completo: no caben más furgonetas"]);
    if (m.routesLate) al.push(["warn", `${m.routesLate} ruta${m.routesLate > 1 ? "s salieron" : " salió"} tarde`]);
    if (S.over) al.unshift(["ok", `Turno terminado a las ${clock(S.endAt)}`]);
    for (const p of m.processes) {
      const st = procStatus(p);
      if (st === "bad") al.push(["warn", `${p.name} rinde al ${Math.round((p.uph / p.target) * 100)}% del objetivo (${Math.round(p.uph)} de ${p.target} UPH)`]);
    }
    if (S.conveyorDown) al.unshift(["bad", "Conveyor parado: no se induce nada hasta que vuelva a funcionar"]);
    if (m.quality.psOpen > 25) al.push([m.quality.psOpen > 60 ? "bad" : "warn", `${m.quality.psOpen} paquetes esperando en problem solve`]);
    if (m.quality.missortRate > 0.006 && S.sorted > 2000) al.push(["warn", `Missorts al ${(m.quality.missortRate * 100).toFixed(2)}%, por encima del 0,6%`]);
    const lateW = m.waves.filter((w) => !w.done && w.late);
    if (lateW.length) al.push(["bad", `Con el ritmo actual saldrían tarde ${lateW.map((w) => "la oleada " + w.n).join(" y ")}`]);
    renderProcs(m);
    renderCycle(m);
    renderQuality(m.quality);
    $("#ds-alerts").innerHTML = al.length ? al.map(([k, msg]) => `<li class="is-${k}">${msg}</li>`).join("") : `<li class="is-ok">Turno según el plan, sin incidencias</li>`;
  }

  function renderLog() {
    const el = $("#ds-log"); if (!el) return;
    el.innerHTML = S.events.slice(0, 14).map((e) => `<li class="is-${e.kind}"><time>${clock(e.t)}</time>${esc(e.msg)}</li>`).join("");
  }

  const STATUS = { truck: "En el camión", transit: "En movimiento", staging: "En la zona de carros", moving: "Carro de camino a inducción", induct: "Esperando inducción", aisle: "En el conveyor, esperando stow",
    bag: "En la saca", ps: "En problem solve", writtenoff: "Dado de baja", cart: "En el carro de pick", van: "Cargado en furgoneta", route: "En reparto", delivered: "Entregado" };

  function staffCtl(key) {
    return `<div class="ds-staff"><span>Personal</span><button data-staff="${key}" data-d="-1" aria-label="Quitar persona">−</button><b>${S.staff[key]}</b><button data-staff="${key}" data-d="1" aria-label="Añadir persona">+</button></div>`;
  }
  const stats = (rows) => `<ul class="ds-stats">${rows.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join("")}</ul>`;
  const head = (code, title) => `<h3><span class="ds-code">${code}</span>${title}</h3>`;

  function routeState(r) {
    if (r.dispatched) return `Salió ${clock(r.departAt)}${r.late ? " · tarde" : ""}`;
    if (r.van) return "Cargando furgoneta";
    if (r.picking) return "En pick";
    return "Recibiendo stow";
  }

  function renderDetail() {
    const el = $("#ds-detail"), s = S.selected;
    if (!s) { el.innerHTML = `<p class="ds-hint">Pulsa un paquete en movimiento, una saca, una furgoneta o cualquier zona del mapa. También puedes rastrear un paquete por su código.</p>`; return; }
    if (s.kind === "pkg") {
      const p = S.pkgs.get(s.id); if (!p) { S.selected = null; return renderDetail(); }
      const r = S.routes[p.route - 1];
      const ISSUE = { damaged: "Dañado", noLabel: "Etiqueta ilegible", missort: "Mal clasificado" };
      el.innerHTML = head("PKG", p.id) +
        stats([["Estado", STATUS[p.where] || p.where], ...(p.issue ? [["Incidencia", `<span class="is-warn">${ISSUE[p.issue]}</span>`]] : []), ["Grupo", R.groups[p.group].id], ["Ruta", p.sorted ? `${r.code} · ${r.town}` : "Pendiente de inducción"], ["CP destino", p.cp], ["Tamaño", `${p.size} · ${p.weight} kg`]]) +
        `<ol class="ds-timeline">${p.hist.slice().reverse().map((h) => `<li><time>${clock(h.t)}</time>${esc(h.msg)}</li>`).join("")}</ol>`;
    } else if (s.kind === "lane") {
      const l = S.lanes[s.id], waiting = l.closed.reduce((t, c) => t + c.items.length, 0);
      el.innerHTML = head(l.cls.short, `${l.group.id} · ${l.cls.name}`) +
        `<p>Carros de paquetes ${l.cls.name.toLowerCase()} del grupo ${l.group.id}, que van a los pasillos ${l.group.aisles.map((i) => ST.aisles[i].id).join(" y ")}.</p>` +
        stats([["Carro abierto", l.open ? `${l.open.id} · ${l.open.items.length}/${l.cls.cap}` : "—"], ["Carros cerrados esperando", l.closed.length], ["Paquetes esperando", waiting + (l.open ? l.open.items.length : 0)], ["Capacidad por carro", l.cls.cap]]);
    } else if (s.kind === "route") {
      const r = S.routes[s.id - 1], w = r.wave;
      el.innerHTML = head(r.code, `Ruta ${r.code} · ${r.town}`) +
        stats([["Estado", routeState(r)], ["Oleada", w ? `${w.n} · salida ${clock(w.at)}–${clock(w.deadline)}` : "—"], ["Pasillo", ST.aisles[r.aisle].id],
          ["En sacas", `${r.bag.length} · ${Math.ceil(r.bag.length / ST.bagCapacity)} saca${Math.ceil(r.bag.length / ST.bagCapacity) === 1 ? "" : "s"}`],
          ["Aún por llegar", r.upstream], ["En el carro", r.cart.length], ["Furgoneta", r.van ? r.van.id : "—"], ["Enviados", r.out]]) +
        (!r.van && !r.dispatched && r.bag.length ? `<button class="ds-btn" data-call="${r.n}">Llamar furgoneta ya</button>` : "");
    } else if (s.kind === "aisle") {
      const a = S.aisles.find((x) => x.id === s.id), routes = S.routes.filter((r) => r.aisle === a.idx);
      el.innerHTML = head("STW", `Pasillo ${a.id}`) + `<p>${ST.desc}</p>` +
        stats([["Rutas", `${routes[0].code}–${routes[routes.length - 1].code}`], ["Esperando stow", a.queue.length], ["Stoweados", a.done], ["Paquetes en sacas", routes.reduce((t, r) => t + r.bag.length, 0)]]) + staffCtl("stow");
    } else if (s.kind === "truck") {
      const t = S.trucks.find((x) => x.id === s.id); if (!t) { S.selected = null; return renderDetail(); }
      const pt = S.plan.trucks.find((x) => x.id === t.id);
      el.innerHTML = head("IN", `Camión ${t.id}`) + `<p>Tráiler que llega desde un centro de distribución, en el muelle ${t.dock + 1}.</p>` +
        stats([["Estado", { arriving: "Atracando", unloading: "Descargando", leaving: "Saliendo" }[t.state]], ["Llegada prevista", pt ? clock(pt.at) + (pt.eta !== pt.at ? ` · llegó ${clock(pt.dockedAt ?? pt.eta)}` : "") : "Extra, fuera del plan"], ["Quedan", `${t.units}/${t.total}`], ["Ritmo", D.unloadRate + " paq/h"]]);
    } else if (s.kind === "van") {
      const v = S.vans.find((x) => x.id === s.id); if (!v) { S.selected = null; return renderDetail(); }
      const r = S.routes[v.route - 1];
      el.innerHTML = head("OUT", `Furgoneta ${v.id}`) + `<p>Ruta ${r.code} hacia ${r.town}, plaza ${v.pad + 1} del yard.</p>` +
        stats([["Estado", { arriving: "Entrando al yard", loading: "Cargando", leaving: "Saliendo a reparto" }[v.state]], ["Cargados", v.loaded], ["Por cargar", r.cart.length + E.toPick(r)],
          ["Tiempo en yard", fmtMin(S.t - v.calledAt)], ["Salida a tiempo hasta", clock(v.deadline)]]);
    } else if (s.id === "conveyor") {
      el.innerHTML = head("CNV", "Conveyor") + `<p>Lleva cada paquete desde inducción hasta la boca del pasillo de su ruta.</p>` +
        stats([["En la cinta", S.transit.filter((t) => t.belt).length]]);
    } else {
      const cfg = { receive: R, induct: I, pick: P, yard: Y, problem: L.problem }[s.id];
      let rows;
      if (s.id === "receive") rows = [["Paquetes en carros", E.stagingCount()], ["Carros esperando", S.lanes.reduce((t, l) => t + l.closed.length, 0)], ["Carros en camino", S.moves.length]];
      if (s.id === "induct") rows = [["En cola", S.inductQ.length], ["Capacidad", Math.round(E.rate(I.rate, "induct", I)) + " paq/h"]];
      if (s.id === "pick") rows = [["Por recoger", S.routes.reduce((t, r) => t + E.toPick(r), 0)], ["Rutas en pick", S.routes.filter((r) => E.toPick(r) || r.cart.length).length], ["Capacidad", Math.round(E.rate(P.rate, "pick", P)) + " paq/h"]];
      if (s.id === "problem") {
        const q = E.metrics().quality;
        rows = [["Por resolver", q.psOpen], ["Resolución media", q.psAvg == null ? "—" : fmtMin(q.psAvg)], ["Dados de baja", q.writtenOff], ["Capacidad", Math.round(E.rate(L.problem.uph * S.staff.ps, "ps", L.problem)) + " paq/h"]];
      }
      if (s.id === "yard") rows = [["Furgonetas", `${S.vans.length}/${Y.pads}`], ["Tiempo medio en yard", S.vanTimes.length ? fmtMin(avg(S.vanTimes)) : "—"], ["Salidas", S.routesOut]];
      el.innerHTML = head(cfg.code, cfg.name) + `<p>${cfg.desc}</p>` + stats(rows) + (s.id !== "yard" ? staffCtl(s.id === "problem" ? "ps" : s.id) : "");
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

  // ── Procesos y planificador de plantilla ──────────────
  // draft: reparto de personas que se está probando antes de aplicarlo
  let draft = null;
  const QUEUE = { receive: () => E.stagingCount(), induct: () => S.inductQ.length, stow: () => S.aisles.reduce((s, a) => s + a.queue.length, 0), pick: () => S.routes.reduce((s, r) => s + E.toPick(r), 0), ps: () => S.psQ.length };
  // Semáforo: solo cuenta cuando el proceso tiene trabajo (si está parado por falta de paquetes no es culpa suya)
  function procStatus(p) {
    if (!QUEUE[p.key]() || p.rate < 1) return "idle";
    const k = p.uph / p.target;
    return k >= 0.95 ? "ok" : k >= 0.8 ? "warn" : "bad";
  }
  const sameStaff = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

  function renderProcs(m) {
    const staff = draft || S.staff;
    const rows = m.processes.map((p) => {
      const st = procStatus(p), q = QUEUE[p.key](), cap = (p.target * S.staff[p.key]) / 60;
      return `<tr><td><i class="ds-sem is-${st}"></i>${p.name}</td>
        <td class="ds-pp"><button data-pp="${p.key}" data-d="-1" aria-label="Quitar persona de ${p.name}">−</button><b class="${staff[p.key] !== S.staff[p.key] ? "is-changed" : ""}">${staff[p.key]}</b><button data-pp="${p.key}" data-d="1" aria-label="Añadir persona a ${p.name}">+</button></td>
        <td>${st === "idle" ? "—" : Math.round(p.uph)}</td><td>${p.target}</td><td>${q ? fmtMin(q / cap) : "—"}</td></tr>`;
    }).join("");
    const total = Object.values(staff).reduce((s, v) => s + v, 0), base = Object.values(S.staff).reduce((s, v) => s + v, 0);
    const waveTxt = (ws) => ws.map((w) => `<span>O${w.n} ${w.done ? (w.late ? `<b class="is-bad">${w.late} tarde</b>` : '<b class="is-ok">fuera</b>') : `<b class="${w.late ? "is-bad" : "is-ok"}">${clock(w.depart)}</b>`}</span>`).join("");
    let out;
    if (draft && !sameStaff(draft, S.staff)) {
      const now = E.forecast(), then = E.forecast(draft), wNow = m.waves, wThen = E.waveForecast(draft);
      const lateNow = wNow.reduce((s, w) => s + w.late, 0), lateThen = wThen.reduce((s, w) => s + w.late, 0);
      out = `<div class="ds-plan-out">Con este reparto (${total} personas, ${total - base >= 0 ? "+" : ""}${total - base}): fin del sort
        <b class="${then.sortEnd > S.plan.cutoff ? "is-bad" : "is-ok"}">${clock(then.sortEnd)}</b> (ahora ${clock(now.sortEnd)}) · rutas tarde previstas
        <b class="${lateThen ? "is-bad" : "is-ok"}">${lateThen}</b> (ahora ${lateNow})
        <div class="ds-waves">Salida prevista: ${waveTxt(wThen)}</div></div>
        <div class="ds-plan-actions"><button class="ds-btn ds-btn--out" data-plan="apply">Aplicar</button><button class="ds-btn ds-btn--ghost" data-plan="discard">Descartar</button></div>`;
    } else {
      out = `<div class="ds-plan-out">${total} personas · prueba a mover gente con − y + para ver el efecto antes de aplicarlo.
        <div class="ds-waves">Salida prevista: ${waveTxt(m.waves)}</div></div>`;
    }
    $("#ds-procs").innerHTML = `<table><thead><tr><th>Proceso</th><th>Personas</th><th>UPH</th><th>Obj.</th><th>Cola</th></tr></thead><tbody>${rows}</tbody></table>${out}`;
  }
  function onProcs(e) {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pp) {
      draft = draft || { ...S.staff };
      draft[b.dataset.pp] = Math.max(1, Math.min(60, draft[b.dataset.pp] + Number(b.dataset.d)));
    }
    if (b.dataset.plan === "apply" && draft) {
      const moves = Object.keys(draft).filter((k) => draft[k] !== S.staff[k]).map((k) => `${k} ${S.staff[k]}→${draft[k]}`);
      Object.assign(S.staff, draft); draft = null;
      E.log(`Cambio de plantilla: ${moves.join(", ")}`, "warn");
    }
    if (b.dataset.plan === "discard") draft = null;
    renderProcs(E.metrics());
  }
  $("#ds-procs").addEventListener("pointerdown", onProcs);
  $("#ds-procs").addEventListener("click", (e) => { if (e.detail === 0) onProcs(e); });

  // ── Tiempo de ciclo ───────────────────────────────────
  const CYCLE = { dockInduct: ["Muelle → inducción", "--ds-raw"], inductStow: ["Inducción → saca", "--ds-a"], stowPick: ["Espera en saca → pick", "--ds-c"], pickOut: ["Pick → salida", "--ds-b"] };
  function renderCycle(m) {
    const segs = m.cycle.filter((c) => c.min != null), total = segs.reduce((s, c) => s + c.min, 0);
    if (!segs.length) { $("#ds-cycle").innerHTML = `<p class="ds-hint">Aparece en cuanto se clasifiquen los primeros paquetes.</p>`; return; }
    $("#ds-cycle").innerHTML = `<div class="ds-cycle-bar">${segs.map((c) => `<i style="width:${(c.min / total) * 100}%;background:var(${CYCLE[c.key][1]})"></i>`).join("")}</div>
      <ul>${m.cycle.map((c) => `<li><i class="ds-dot" style="background:var(${CYCLE[c.key][1]})"></i>${CYCLE[c.key][0]}<b>${c.min == null ? "—" : fmtMin(c.min)}</b></li>`).join("")}</ul>`;
  }

  // ── Calidad ───────────────────────────────────────────
  function renderQuality(q) {
    const pct = (v) => (v * 100).toFixed(2).replace(".", ",") + "%";
    const rows = [
      ["Missort", `<b class="${q.missortRate > 0.006 ? "is-warn" : ""}">${pct(q.missortRate)}</b>`],
      ["DPMO", `<b>${num(Math.round(q.dpmo))}</b>`],
      ["PS abiertos", `<b class="${q.psOpen > 25 ? "is-warn" : ""}">${q.psOpen}</b>`],
      ["Resolución media", `<b>${q.psAvg == null ? "—" : fmtMin(q.psAvg)}</b>`],
      ["Dañados", `<b>${q.damaged}</b>`], ["Sin etiqueta", `<b>${q.noLabel}</b>`],
      ["Mal clasificados", `<b>${q.missort}</b>`], ["Dados de baja", `<b>${q.writtenOff}</b>`],
    ];
    $("#ds-quality").innerHTML = rows.map(([k, v]) => `<li>${k}${v}</li>`).join("");
  }

  // ── Ritmo por hora ────────────────────────────────────
  function drawHourly() {
    const hours = Math.ceil((S.plan.end + 15) / 60), bars = [];
    let max = 1;
    for (let h = 0; h < hours; h++) {
      const H = S.hourly[h]; if (!H) continue;
      // la hora en curso se escala a hora completa para no parecer una caída
      const k = h === Math.floor(S.t / 60) ? 60 / Math.max(S.t - h * 60, 5) : 1;
      bars.push({ x: h * 60 + 4, w: 26, y: H.stow * k, color: C.aisle[0], alpha: k > 1 ? 0.45 : 0.85 });
      bars.push({ x: h * 60 + 30, w: 26, y: H.pick * k, color: C.aisle[1], alpha: k > 1 ? 0.45 : 0.85 });
      max = Math.max(max, H.stow * k, H.pick * k);
    }
    const target = (L.stow.uph * S.staff.stow);
    DSCharts.draw($("#ds-hourly"), {
      C, x0: 0, x1: hours * 60, yMax: Math.max(max, target) * 1.05,
      xTicks: hourTicks(0, hours * 60, 120), bars,
      hlines: [{ y: target, color: C.muted, label: "obj. " + num(target) }],
    });
  }

  // ── Línea de tiempo del turno ─────────────────────────
  const shiftCanvas = $("#ds-shift");
  function hourTicks(x0, x1, every) {
    const out = [], first = Math.ceil((x0 + L.shiftStart) / every) * every - L.shiftStart;
    for (let x = first; x <= x1; x += every) out.push({ x, label: clock(x) });
    return out;
  }
  function drawShift() {
    const dpr = window.devicePixelRatio || 1, w = shiftCanvas.clientWidth, h = shiftCanvas.clientHeight;
    if (shiftCanvas.width !== Math.round(w * dpr)) { shiftCanvas.width = Math.round(w * dpr); shiftCanvas.height = Math.round(h * dpr); }
    const ctx = shiftCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const x0 = -10, x1 = S.plan.end + 15, X = (t) => 8 + ((t - x0) / (x1 - x0)) * (w - 16);
    const by = 30;
    ctx.font = `500 9px ${C.mono}`; ctx.textBaseline = "top"; ctx.textAlign = "center";
    for (const t of hourTicks(x0, x1, 60)) { ctx.fillStyle = C.muted; ctx.fillText(t.label, X(t.x), by + 14); ctx.fillRect(X(t.x), by + 8, 1, 4); }
    // barra de fondo y transcurrido
    ctx.fillStyle = C.zone; ctx.fillRect(X(x0), by, X(x1) - X(x0), 6);
    ctx.fillStyle = C.line; ctx.fillRect(X(x0), by, X(Math.min(S.t, x1)) - X(x0), 6);
    // ventana de sort: del primer camión al corte
    ctx.fillStyle = C.raw; ctx.globalAlpha = 0.35; ctx.fillRect(X(S.plan.firstTruck), by, X(S.plan.cutoff) - X(S.plan.firstTruck), 6); ctx.globalAlpha = 1;
    // oleadas: pick (claro) y ventana de salida (sólido)
    const SH = E.SH;
    for (const wv of S.plan.waves) {
      const col = C.aisle[S.routes[wv.routes[0] - 1].aisle];
      ctx.fillStyle = col; ctx.globalAlpha = 0.3; ctx.fillRect(X(wv.at - SH.pickLead), by, X(wv.at) - X(wv.at - SH.pickLead), 6);
      ctx.globalAlpha = 1; ctx.fillRect(X(wv.at), by - 2, X(wv.deadline) - X(wv.at), 10);
      ctx.fillStyle = C.fg; ctx.textBaseline = "bottom"; ctx.fillText("O" + wv.n, X(wv.at + SH.loadWindow / 2), by - 4); ctx.textBaseline = "top";
    }
    // camiones
    for (const pt of S.plan.trucks) {
      const tri = (x) => { ctx.beginPath(); ctx.moveTo(X(x), by - 3); ctx.lineTo(X(x) - 3, by - 9); ctx.lineTo(X(x) + 3, by - 9); ctx.closePath(); ctx.fill(); };
      if (pt.eta !== pt.at) {
        // retraso: hueco entre la hora del plan y la real
        ctx.fillStyle = C.bad; ctx.fillRect(X(pt.at), by - 7, X(pt.eta) - X(pt.at), 2);
        ctx.globalAlpha = 0.4; tri(pt.at); ctx.globalAlpha = 1;
        tri(pt.eta); continue;
      }
      ctx.fillStyle = pt.state === "pending" ? (S.t >= pt.at ? C.warn : C.muted) : C.raw;
      tri(pt.at);
    }
    // corte del sort
    ctx.fillStyle = C.bad; ctx.fillRect(X(S.plan.cutoff) - 1, by - 12, 2, 24);
    ctx.textBaseline = "bottom"; ctx.fillText("corte " + clock(S.plan.cutoff), X(S.plan.cutoff), by - 13);
    // fin previsto del sort
    const f = E.forecast();
    if (S.t > S.plan.firstTruck) {
      const fx = X(Math.min(f.sortEnd, x1)), late = f.sortEnd > S.plan.cutoff;
      ctx.fillStyle = late ? C.bad : C.ok;
      ctx.beginPath(); ctx.moveTo(fx, by - 3); ctx.lineTo(fx + 5, by + 3); ctx.lineTo(fx, by + 9); ctx.lineTo(fx - 5, by + 3); ctx.closePath(); ctx.fill();
    }
    // ahora
    ctx.fillStyle = C.sel; ctx.fillRect(X(Math.min(S.t, x1)) - 1, by - 6, 2, 18);
  }

  // ── Plan frente a real ────────────────────────────────
  function drawPlan() {
    const H = S.history, x0 = Math.min(S.plan.firstTruck, 0) - 5;
    const f = E.forecast(), x1 = Math.max(S.plan.cutoff, f.sortEnd) + 20;
    const total = S.plan.volume + Math.max(0, S.received - S.plan.volume);
    const real = H.filter((p) => p.t <= x1).map((p) => [p.t, p.sorted]);
    const series = [
      { pts: [[S.plan.firstTruck, 0], [S.plan.cutoff, S.plan.volume]], color: C.muted, dash: [5, 4], width: 1.5 },
      { pts: real, color: C.aisle[0], width: 2 },
    ];
    if (!f.done && S.t > S.plan.firstTruck) series.push({ pts: [[S.t, S.sorted], [f.sortEnd, total]], color: f.sortEnd > S.plan.cutoff ? C.bad : C.ok, dash: [2, 3], width: 1.5 });
    DSCharts.draw($("#ds-plan"), {
      C, x0, x1, yMax: total, yFmt: (v) => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "k" : v),
      xTicks: hourTicks(x0, x1, 60), series,
      vlines: [{ x: S.plan.cutoff, color: C.bad, label: "corte" }],
    });
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
  $("#ds-restart").addEventListener("click", () => boot());
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
    if (V) V.readColors();
  }
  themeBtn.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
  let saved = "dark"; try { saved = localStorage.getItem("a-theme") || "dark"; } catch (e) {}
  applyTheme(saved === "light" ? "light" : "dark");

  // ── Bucle ─────────────────────────────────────────────
  boot();
  // acceso desde la consola del navegador (y para las capturas automáticas)
  window.__ds = () => E;
  let last = performance.now(), uiAcc = 0, mapVisible = true;
  // si el mapa no está en pantalla (p. ej. leyendo el panel en el móvil), la simulación sigue pero no se dibuja
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { mapVisible = es[0].isIntersecting; }).observe(canvas);
  // en táctil dibujamos a ~30 fps: el movimiento sigue fluido y el móvil trabaja la mitad
  const MIN_FRAME = V.COARSE ? 1000 / 31 : 0;
  function frame(now) {
    if (now - last < MIN_FRAME) { requestAnimationFrame(frame); return; }
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (!S.paused) { let rem = dt * S.speed; while (rem > 0) { const d = Math.min(rem, 0.05); E.step(d); rem -= d; } }
    if (mapVisible) V.draw(now / 1000);
    uiAcc += dt;
    if (uiAcc > (V.COARSE ? 0.5 : 0.25)) {
      uiAcc = 0; renderKpis(); drawShift(); drawPlan(); drawHourly(); if (S.selected) renderDetail();
      // al terminar el turno se abre el informe una vez
      if (S.over && !reportShown) { reportShown = true; openReport(); }
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener("resize", () => V.resize());
  requestAnimationFrame(frame);
})();
