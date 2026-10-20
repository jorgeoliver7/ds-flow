// Centro de control: panel, controles y bucle de animación.
(function () {
  "use strict";

  const L = window.DS_LAYOUT;
  const $ = (s) => document.querySelector(s);
  const D = L.docks, R = L.receive, I = L.induct, ST = L.stow, P = L.pick, Y = L.yard;
  const { avg, fmtMin } = DSEngine;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // enteros con punto de miles también en 4 cifras ("8.200"), como en el informe
  const num = (v) => (typeof v === "number" ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") : v);

  const canvas = $("#ds-map");
  // E: motor, S: su estado, V: render. Se recrean al reiniciar la partida.
  let E, S, V, ready = false;
  // el reloj sale del motor: el turno de tarde empieza a otra hora
  const clock = (t) => DSEngine.clock(E.L, t);
  const C = new Proxy({}, { get: (_, k) => V.C[k] });

  // Escenario: se puede compartir con ?escenario=pico
  const SCN = DSScenarios.list;
  let scenarioId = new URLSearchParams(location.search).get("escenario");
  if (!SCN.some((s) => s.id === scenarioId)) scenarioId = SCN[0].id;
  // noche importada desde un CSV: vive solo en esta pestaña
  let custom = null;
  const scenario = () => (scenarioId === "importado" && custom) || SCN.find((s) => s.id === scenarioId);
  const scenarioOptions = () => (scenarioId === "importado" && custom
    ? { seed: custom.seed, shift: custom.shift, routeWeights: custom.weights, staff: {} }
    : DSScenarios.options(L, scenarioId));

  function boot() {
    ready = false;
    const prev = S;
    E = DSEngine.create(L, Object.assign(scenarioOptions(), {
      hooks: { log: () => ready && renderLog(), fx: (k, d) => V && V.onFx(k, d), now: () => performance.now() / 1000 },
    }));
    S = E.S;
    S.speed = prev ? prev.speed : Number($("#ds-speed").value) / 60;
    S.paused = false; S.selected = null; S.tracked = null; draft = null; advice = { k: null }; ignored = {}; sim = null; simAcc = 0;
    if (S.auto !== $("#ds-auto").checked) E.setAuto($("#ds-auto").checked);
    V = DSRender.create(E, canvas);
    V.resize(); V.readColors();
    pauseBtn.textContent = "❚❚ Pausa"; pauseBtn.setAttribute("aria-pressed", "false");
    reportShown = false;
    $("#ds-scenario-desc").textContent = scenario().desc;
    ready = true;
    renderDetail(); renderLog(); renderKpis();
  }

  // ── Importar una noche desde CSV ──────────────────────
  $("#ds-import").addEventListener("change", (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = DSImport.parse(reader.result, L);
      if (!res.ok) { toast(res.errors.slice(0, 2).join(" · ")); return; }
      custom = { id: "importado", name: "Noche importada", seed: 7, shift: res.shift, weights: res.weights,
        desc: `${file.name}: ${res.summary}. El archivo solo está en tu navegador.` };
      if (!scSel.querySelector('[value="importado"]')) scSel.insertAdjacentHTML("beforeend", '<option value="importado">Noche importada</option>');
      scenarioId = scSel.value = "importado";
      history.replaceState(null, "", location.pathname);
      boot(); toast("Noche importada: " + res.summary);
    };
    reader.readAsText(file);
  });

  // ── Informe de fin de turno ───────────────────────────
  const reportEl = $("#ds-report");
  let reportShown = false, report = null;
  function openReport() {
    report = DSReport.build(E, scenario(), { hourly: hourly() });
    $("#ds-report-body").innerHTML = DSReport.html(report);
    $("#ds-report-map").href = DSReport.mapaUrl(report);
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
  $("#ds-report-compare").addEventListener("click", () => { reportEl.close(); openCompare(); });

  // ── Comparar escenarios ───────────────────────────────
  // Dos turnos enteros (escenario + plantilla en cada lado), jugados en segundo plano, con su coste
  const cmpEl = $("#ds-compare");
  const COST_KEY = "ds-cost-hour";
  function hourly() {
    let v = NaN; try { v = Number(localStorage.getItem(COST_KEY)); } catch (e) {}
    return v > 0 ? v : (L.cost ? L.cost.hourly : 18);
  }
  const cmpCache = {};
  let cmpJob = 0;
  const cmpScenarios = () => SCN.concat(custom ? [custom] : []);
  const cmpOptions = (id) => (id === "importado" && custom ? { seed: custom.seed, shift: custom.shift, routeWeights: custom.weights, staff: {} } : DSScenarios.options(L, id));
  function openCompare() {
    const opts = cmpScenarios().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    const modes = DSCompare.STAFF_MODES.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
    for (const side of ["a", "b"]) {
      $(`#ds-cmp-${side}-sc`).innerHTML = opts; $(`#ds-cmp-${side}-st`).innerHTML = modes;
      $(`#ds-cmp-${side}-sc`).value = scenarioId;
    }
    // por defecto: el turno de ahora con su plantilla frente a la plantilla mínima para el corte
    $("#ds-cmp-a-st").value = "scenario"; $("#ds-cmp-b-st").value = "min";
    $("#ds-cmp-cost").value = hourly();
    if (!cmpEl.open) cmpEl.showModal();
    runCompare();
  }
  function runCompare() {
    const side = (k) => ({ sc: $(`#ds-cmp-${k}-sc`).value, mode: $(`#ds-cmp-${k}-st`).value });
    const a = side("a"), b = side("b"), job = ++cmpJob, out = $("#ds-cmp-out");
    const name = (x) => `${cmpScenarios().find((s) => s.id === x.sc).name}, ${x.mode === "min" ? "plantilla mínima" : "su plantilla"}`;
    const get = (x) => {
      const key = x.sc + ":" + x.mode + (x.sc === "importado" ? ":" + custom.desc : "");
      if (!cmpCache[key]) {
        const opts = cmpOptions(x.sc);
        cmpCache[key] = inWorker({ type: "full", L, opts, mode: x.mode }, () => DSCompare.run(L, opts, x.mode));
        cmpCache[key].catch(() => delete cmpCache[key]);
      }
      return cmpCache[key];
    };
    out.innerHTML = `<p class="ds-sim-note"><span class="ds-spin"></span>Jugando los dos turnos enteros…</p>`;
    Promise.all([get(a), get(b)]).then(([ra, rb]) => {
      if (job !== cmpJob) return;
      out.innerHTML = DSCompare.html(ra, rb, hourly(), [name(a), name(b)]);
    }).catch((e) => { if (job === cmpJob) out.innerHTML = `<p class="ds-sim-note is-bad">No se ha podido comparar: ${esc(e.message || e)}</p>`; });
  }
  $("#ds-compare-btn").addEventListener("click", openCompare);
  $("#ds-compare-close").addEventListener("click", () => cmpEl.close());
  for (const id of ["#ds-cmp-a-sc", "#ds-cmp-a-st", "#ds-cmp-b-sc", "#ds-cmp-b-st"]) $(id).addEventListener("change", runCompare);
  $("#ds-cmp-cost").addEventListener("change", (e) => {
    const v = Number(String(e.target.value).replace(",", "."));
    if (!(v > 0)) { e.target.value = hourly(); return; }
    try { localStorage.setItem(COST_KEY, String(v)); } catch (err) {}
    runCompare();
  });
  // se imprime siempre en claro, aunque la página esté en oscuro
  let themeBeforePrint = null;
  window.addEventListener("beforeprint", () => { themeBeforePrint = document.documentElement.dataset.theme; document.documentElement.dataset.theme = "light"; });
  window.addEventListener("afterprint", () => { if (themeBeforePrint) document.documentElement.dataset.theme = themeBeforePrint; });

  const scSel = $("#ds-scenario");
  scSel.innerHTML = SCN.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  scSel.value = scenarioId;
  scSel.addEventListener("change", () => {
    scenarioId = scSel.value;
    if (scenarioId === "importado") { boot(); return; }
    const url = new URL(location.href);
    if (scenarioId === SCN[0].id) url.searchParams.delete("escenario"); else url.searchParams.set("escenario", scenarioId);
    history.replaceState(null, "", url);
    boot();
  });

  canvas.addEventListener("click", (e) => {
    const h = V.hit(...V.local(e));
    if (h && h.kind === "pkg") { track(h.id); return; }
    S.selected = h;
    if (ctab !== "search") setCtab("search"); else renderDetail();
  });
  canvas.addEventListener("mousemove", (e) => { canvas.style.cursor = V.hit(...V.local(e)) ? "pointer" : "default"; });

  function track(id) {
    if (!S.pkgs.get(id)) { toast("No encuentro ese paquete"); return; }
    S.tracked = id; S.selected = { kind: "pkg", id };
    $("#ds-search").value = id;
    if (ctab !== "search") setCtab("search"); else renderDetail();
  }

  // ── High Values ───────────────────────────────────────
  // Cada paquete de valor alto del turno: dónde está ahora, desde cuándo y si hay que ir a buscarlo
  let ctab = "search", hvFilter = "all";
  function setCtab(t) {
    ctab = t;
    document.querySelectorAll("[data-ctab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.ctab === t)));
    $("#ds-track-form").hidden = t !== "search"; $("#ds-detail").hidden = t !== "search"; $("#ds-hv").hidden = t !== "hv";
    if (t === "hv") renderHV(); else renderDetail();
  }
  document.querySelectorAll("[data-ctab]").forEach((b) => b.addEventListener("click", () => setCtab(b.dataset.ctab)));

  const HV_DEST = { receive: "Del muelle a la zona de carros", induct: "De camino a inducción", aisle: "En el conveyor", bag: "Entrando en su saca",
    ps: "De camino a problem solve", cart: "Al carro de pick", van: "A la furgoneta" };
  function hvWhere(p) {
    const r = S.routes[p.route - 1];
    switch (p.where) {
      case "truck": return `Camión ${p.truck}`;
      case "transit": return HV_DEST[p.tr && p.tr.dest] || "En movimiento";
      case "staging": return `Carro ${p.cartId} · zona de carros`;
      case "held": return `Carro ${p.cartId} · en la playa, para la noche`;
      case "moving": return `Carro ${p.cartId} hacia inducción`;
      case "induct": return "Cola de inducción";
      case "aisle": return `Pasillo ${ST.aisles[r.aisle].id} · esperando stow`;
      case "bag": { const b = S.routes[p.bag - 1]; return `Saca ${b.code} · pasillo ${ST.aisles[b.aisle].id}${b !== r ? " · no es la suya" : ""}`; }
      case "ps": return "Problem solve";
      case "cart": return `Carro de pick de ${r.code}`;
      case "van": return `Furgoneta ${p.van} · plaza ${(S.vans.find((v) => v.id === p.van)?.pad ?? -1) + 1 || "—"}`;
      case "route": return `En reparto · ${r.town}`;
      case "delivered": return "Entregado";
      case "writtenoff": return "Dado de baja";
    }
    return p.where;
  }
  // out: ya salió · ok: en el flujo · warn: incidencia o en la saca equivocada · bad: su furgoneta se fue sin él, o dado de baja
  function hvState(p) {
    if (p.where === "route" || p.where === "delivered") return "out";
    if (p.where === "writtenoff" || S.routes[p.route - 1].dispatched) return "bad";
    if (p.where === "ps" || (p.tr && p.tr.dest === "ps") || (p.where === "bag" && p.bag !== p.route)) return "warn";
    return "ok";
  }
  const HV_ORDER = { bad: 0, warn: 1, ok: 2, out: 3 };
  const HV_FILTERS = [["all", "Todos"], ["in", "En planta"], ["alert", "Con aviso"], ["out", "Ya salieron"]];
  function renderHV() {
    const el = $("#ds-hv"), all = S.hv.map((p) => ({ p, st: hvState(p) }));
    if (!all.length) { el.innerHTML = `<p class="ds-hint">Los high value aparecen aquí en cuanto se descargan del camión: unos ${Math.round(S.plan.volume * (L.highValue?.share || 0))} esta noche.</p>`; return; }
    const n = (f) => all.filter(f).length, value = all.reduce((s, x) => s + x.p.value, 0);
    const pass = { all: () => true, in: (x) => x.st === "ok" || x.st === "warn", alert: (x) => x.st === "bad" || x.st === "warn", out: (x) => x.st === "out" }[hvFilter];
    const list = all.filter(pass).sort((a, b) => HV_ORDER[a.st] - HV_ORDER[b.st] || (S.routes[a.p.route - 1].wave?.at ?? 0) - (S.routes[b.p.route - 1].wave?.at ?? 0) || b.p.value - a.p.value);
    const alerts = n((x) => x.st === "bad" || x.st === "warn");
    el.innerHTML = `<div class="ds-hv-sum">
        <div><span>Del turno</span><strong>${all.length}</strong></div>
        <div><span>En planta</span><strong>${n((x) => x.st === "ok" || x.st === "warn")}</strong></div>
        <div><span>Salieron</span><strong>${n((x) => x.st === "out")}</strong></div>
        <div><span>Con aviso</span><strong class="${alerts ? "is-bad" : ""}">${alerts}</strong></div></div>
      <p class="ds-hint">${num(value)} € declarados en total. Pulsa uno para ver su historial y seguirlo en el mapa (marco dorado).</p>
      <div class="ds-hv-filters">${HV_FILTERS.map(([k, l]) => `<button class="ds-chip${hvFilter === k ? " is-on" : ""}" data-hvf="${k}">${l}</button>`).join("")}</div>
      <div class="ds-hv-list"><table><thead><tr><th>Paquete</th><th>Ruta</th><th>Dónde está</th></tr></thead><tbody>${list.map(({ p, st }) => {
        const r = S.routes[p.route - 1], w = r.wave;
        return `<tr data-hv="${p.id}"><td class="ds-mono">${p.id}<small>${num(p.value)} €</small></td>
          <td class="ds-mono">${r.code}<small>${r.dispatched ? `salió ${clock(r.departAt)}` : w ? `sale ${clock(w.at)}` : "—"}</small></td>
          <td><i class="ds-sem is-${st === "out" ? "idle" : st}"></i>${esc(hvWhere(p))}<small>${st === "bad" && p.where !== "writtenoff" ? "su furgoneta ya salió · " : ""}desde las ${clock(p.seenAt)}</small></td></tr>`;
      }).join("") || `<tr><td colspan="3" class="ds-hint">Ninguno con este filtro.</td></tr>`}</tbody></table></div>`;
  }
  function onHV(e) {
    const f = e.target.closest("[data-hvf]"); if (f) { hvFilter = f.dataset.hvf; renderHV(); return; }
    const r = e.target.closest("tr[data-hv]"); if (r) { setCtab("search"); track(r.dataset.hv); }
  }
  $("#ds-hv").addEventListener("pointerdown", onHV);
  $("#ds-hv").addEventListener("click", (e) => { if (e.detail === 0) onHV(e); });

  // ── Centro de control ─────────────────────────────────
  function toast(msg) {
    const el = $("#ds-toast"); el.textContent = msg; el.classList.add("is-on");
    clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove("is-on"), 2400);
  }

  // Diferencia con el corte en texto: "20 min antes" / "15 min tarde"
  const vsCutoff = (t, cutoff) => (t <= cutoff ? `${fmtMin(cutoff - t)} antes` : `${fmtMin(t - cutoff)} tarde`);

  function renderKpis() {
    const m = E.metrics(), f = m.forecast, late = f.sortEnd > m.cutoff;
    // los marcados con * se quedan en el modo presentación
    const kp = [
      ["*Hora", clock(S.t)],
      [(f.done ? "*Fin del sort" : "*Fin previsto del sort"), `<span class="${late ? "is-bad" : "is-ok"}">${clock(f.sortEnd)}</span>`, vsCutoff(f.sortEnd, m.cutoff) + " del corte"],
      ["Recibidos", S.received, `de ${num(S.plan.volume)} planificados${S.held ? ` · ${num(S.held)} para la noche` : ""}`],
      ["Clasificados", S.sorted],
      ["En planta", S.received - S.dispatched],
      ["*Stow / h", E.stowRate()],
      ["Rutas fuera", `${m.routesOut}/${m.routesTotal}`],
      ["*Rutas a tiempo", m.routesOut ? `<span class="${m.routesLate ? "is-warn" : "is-ok"}">${m.routesOnTime}/${m.routesOut}</span>` : "—"],
      ["*Rollover", m.rollover, "paquetes que se quedan"],
      ["Llenado de saca", m.bagFill == null ? "—" : Math.round(m.bagFill * 100) + "%"],
      ["Horas trabajadas", m.laborHours.toFixed(1)],
      ["*Paq / h trabajada", m.pph == null ? "—" : Math.round(m.pph), "clasificados"],
    ];
    $("#ds-kpis").innerHTML = kp.map(([l, v, sub]) => `<div class="ds-kpi${l[0] === "*" ? " is-key" : ""}"><span>${l.replace("*", "")}</span><strong>${num(v)}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`).join("");

    const al = [];
    if (!f.done && late && S.t > S.plan.firstTruck) al.push(["bad", `El sort acabaría a las ${clock(f.sortEnd)}, ${fmtMin(f.sortEnd - m.cutoff)} después del corte (${clock(m.cutoff)})`]);
    // el pick trabaja por oleadas con margen: su cola se vigila con la previsión de oleadas, no aquí
    const worst = E.loads().filter((l) => l.name !== "Pick").sort((a, b) => b.m - a.m)[0];
    if (worst && worst.m > 6) al.push([worst.m > 15 ? "bad" : "warn", `Cuello de botella en ${worst.name}: ${Math.round(worst.m)} min de cola`]);
    const overdue = S.vans.filter((v) => v.state === "loading" && S.t > v.deadline);
    if (overdue.length) al.push(["bad", `${overdue.length} furgoneta${overdue.length > 1 ? "s" : ""} fuera de su ventana de salida`]);
    const waiting = S.gate.filter((g) => g.checked).length;
    if (waiting) al.push(["warn", `${waiting} camión${waiting > 1 ? "es esperan" : " espera"} muelle libre`]);
    for (const p of m.processes) if (p.marshal && p.needed && !p.staff) al.unshift(["bad", p.key === "dock"
      ? "Sin dock marshall: los camiones tardan más en atracar y descargan más despacio"
      : "Sin yard marshall en las oleadas: las furgonetas tardan en colocarse y salen más tarde"]);
    if (E.freePad() < 0) al.push(["warn", "Yard completo: no caben más furgonetas"]);
    if (m.routesLate) al.push(["warn", `${m.routesLate} ruta${m.routesLate > 1 ? "s salieron" : " salió"} tarde`]);
    if (S.over) al.unshift(["ok", `Turno terminado a las ${clock(S.endAt)}`]);
    const hvLeft = S.hv.filter((p) => hvState(p) === "bad" && p.where !== "writtenoff").length;
    if (hvLeft) al.unshift(["bad", `${hvLeft} high value se ${hvLeft > 1 ? "han quedado" : "ha quedado"} sin su furgoneta: búscalos en la pestaña High Values`]);
    $("#ds-hv-count").textContent = S.hv.length;
    for (const p of m.processes) {
      const st = procStatus(p);
      if (st === "bad" && p.key !== "ps" && !p.marshal) al.push(["warn", `${p.name} rinde al ${Math.round((p.uph / p.target) * 100)}% del objetivo (${Math.round(p.uph)} de ${p.target} UPH)`]);
    }
    if (S.conveyorDown) al.unshift(["bad", "Conveyor parado: no se induce nada hasta que vuelva a funcionar"]);
    const br = S.plan.breaks.find((b) => S.t >= b.from && S.t < b.to);
    if (br && S.sortDoneAt == null) al.unshift(["warn", `Descanso del equipo de noche hasta las ${clock(br.to)}: el sort está parado`]);
    if (m.quality.psOpen > 25) al.push([m.quality.psOpen > 60 ? "bad" : "warn", `${m.quality.psOpen} paquetes esperando en problem solve`]);
    if (m.quality.missortRate > 0.005 && S.sorted > 2000) al.push(["warn", `Missorts al ${(m.quality.missortRate * 100).toFixed(2).replace(".", ",")}%, por encima del 0,5% objetivo`]);
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

  const STATUS = { truck: "En el camión", transit: "En movimiento", staging: "En la zona de carros", held: "En la playa, para el sort de la noche", moving: "Carro de camino a inducción", induct: "Esperando inducción", aisle: "En el conveyor, esperando stow",
    bag: "En la saca", ps: "En problem solve", writtenoff: "Dado de baja", cart: "En el carro de pick", van: "Cargado en furgoneta", route: "En reparto", delivered: "Entregado" };

  function staffCtl(key, label) {
    return `<div class="ds-staff"><span>${label || "Personal"}</span><button data-staff="${key}" data-d="-1" aria-label="Quitar persona">−</button><b>${S.staff[key]}</b><button data-staff="${key}" data-d="1" aria-label="Añadir persona">+</button></div>`;
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
      el.innerHTML = head("PKG", p.id + (p.hv ? '<span class="ds-hv-tag">HIGH VALUE</span>' : "")) +
        stats([["Estado", STATUS[p.where] || p.where], ...(p.issue ? [["Incidencia", `<span class="is-warn">${ISSUE[p.issue]}</span>`]] : []), ["Grupo", R.groups[p.group].id], ["Ruta", p.hold ? "Se asigna en el sort de la noche (ciclo 1)" : p.sorted ? `${r.code} · ${r.town}` : "Pendiente de inducción"], ["CP destino", p.cp], ["Tamaño", `${p.size} · ${p.weight} kg`], ...(p.hv ? [["Valor declarado", `${num(p.value)} €`]] : [])]) +
        `<ol class="ds-timeline">${p.hist.slice().reverse().map((h) => `<li><time>${clock(h.t)}</time>${esc(h.msg)}</li>`).join("")}</ol>`;
    } else if (s.kind === "lane") {
      const l = S.lanes[s.id], waiting = l.closed.reduce((t, c) => t + c.items.length, 0);
      const heldCarts = l.held.length + (l.holdOpen ? 1 : 0), heldN = l.held.reduce((t, c) => t + c.items.length, 0) + (l.holdOpen ? l.holdOpen.items.length : 0);
      el.innerHTML = head(l.cls.short, `${l.group.id} · ${l.cls.name}`) +
        `<p>Carros de paquetes ${l.cls.name.toLowerCase()} del grupo ${l.group.id}, que van a los pasillos ${l.group.aisles.map((i) => ST.aisles[i].id).join(" y ")}.</p>` +
        stats([["Carro abierto", l.open ? `${l.open.id} · ${l.open.items.length}/${l.cls.cap}` : "—"], ["Carros cerrados esperando", l.closed.length], ["Paquetes esperando", waiting + (l.open ? l.open.items.length : 0)],
          ...(heldCarts ? [["Para la noche (ciclo 1)", `${heldCarts} carro${heldCarts > 1 ? "s" : ""} · ${heldN} paquetes`]] : []), ["Capacidad por carro", l.cls.cap]]);
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
    } else if (s.kind === "marshal") {
      const dock = s.id === "dock", M = dock ? D.marshal : Y.marshal, on = E.marshalsOn()[s.id], n = S.staff[s.id];
      const who = S.crew ? S.crew.byProc[s.id].map((e) => `${esc(e.name)} (${e.id})`).join(", ") : "";
      const now = !n ? (on ? '<span class="is-bad">Sin cubrir</span>' : "Sin cubrir") : on ? "En su puesto" : "Fuera de su horario";
      const rows = dock
        ? [["Ahora", now], ["Quién", who || "—"], ["En la puerta", `${S.gate.length} camión${S.gate.length === 1 ? "" : "es"}`],
          ["Check-in por camión", n ? `${M.checkInMin} min` : `unos ${M.selfCheckInMin} min sin dock marshall`], ["Camiones recibidos", S.totals.dock || 0],
          ["Horario", `desde las ${clock(S.plan.sortStart)} hasta el último camión`]]
        : [["Ahora", now], ["Quién", who || "—"], ["Aparcando", S.vans.filter((v) => v.state === "arriving").length + " furgonetas"],
          ["Aparcar", n ? "1 min" : `unos ${M.parkNoMarshal} min sin yard marshall`], ["Furgonetas despachadas", S.totals.yard || 0],
          ["Horario", `desde las ${clock(S.plan.firstWave - M.before)}, durante las oleadas`]];
      el.innerHTML = head(M.code, M.name) + `<p>${M.desc}</p>` + stats(rows) + staffCtl(s.id, M.name);
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
      el.innerHTML = head(cfg.code, cfg.name) + `<p>${cfg.desc}</p>` + stats(rows) + (s.id !== "yard" ? staffCtl(s.id === "problem" ? "ps" : s.id) : staffCtl("yard", "Yard marshall"));
    }
  }

  // Delegado con pointerdown: el panel se redibuja a menudo y un click normal se perdería
  const detailEl = $("#ds-detail");
  function onDetail(e) {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.staff) { const k = b.dataset.staff; E.setStaff({ ...S.staff, [k]: Math.max(minStaff(k), Math.min(60, S.staff[k] + Number(b.dataset.d))) }); }
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
  // los marshals se pueden quitar (para ver qué pasa sin ellos); un proceso de paquetes no se queda vacío
  const MARSHALS = ["dock", "yard"], minStaff = (k) => (MARSHALS.includes(k) ? 0 : 1);
  function procStatus(p) {
    if (p.marshal) return !p.needed ? "idle" : p.staff ? "ok" : "bad";
    // problem solve va según las incidencias que lleguen: se mira su cola, no su UPH
    if (p.key === "ps") { const q = QUEUE.ps(); return !q ? "idle" : q > 25 ? "bad" : q > 10 ? "warn" : "ok"; }
    // con menos de 5 min de cola el proceso va por delante del trabajo: si rinde poco es por esperas, no por lento
    const q = QUEUE[p.key]();
    if (!q || p.rate < 1 || q / ((p.target * p.staff) / 60) < 5) return "idle";
    const k = p.uph / p.target;
    return k >= 0.95 ? "ok" : k >= 0.8 ? "warn" : "bad";
  }
  const sameStaff = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

  // Recomendación del momento y plantilla mínima: se recalculan cada 2 min de turno, no en cada fotograma
  const PNAME = { receive: "carros", induct: "inducción", stow: "stow", pick: "pick", ps: "PS", dock: "dock", yard: "yard" };
  let advice = { k: null, adv: null, need: null }, ignored = {};
  function adviceNow() {
    const k = Math.floor(S.t / 2) + ":" + Object.values(S.staff).join(",");
    if (advice.k !== k) {
      const adv = E.advise();
      advice = { k, adv: adv && !(ignored[adv.id] > S.t) ? adv : null, need: E.crewNeeded() };
    }
    return advice;
  }
  const crewTxt = (st, keys) => keys.map((k) => `${PNAME[k]} ${st[k]}`).join(" · ");

  const n0 = (v) => num(Math.round(v));
  const dec1 = (v) => v.toFixed(1).replace(".", ",");
  const signed = (v, f) => (v > 0 ? "+" : v < 0 ? "−" : "±") + f(Math.abs(v));
  // Fila de un marshal: no tiene UPH; se mira si está cuando hace falta y lo que tiene esperando
  function marshalRow(p, staff, ctl) {
    const st = procStatus(p), M = p.key === "dock" ? D.marshal : Y.marshal;
    const when = p.needed ? (p.staff ? "en su puesto" : '<b class="is-bad">sin cubrir</b>')
      : p.key === "dock" ? (S.dockDoneAt != null ? "terminado" : `desde ${clock(S.plan.sortStart)}`)
      : S.over ? "terminado" : `desde ${clock(S.plan.firstWave - M.before)}`;
    const q = p.queue ? (p.key === "dock" ? `${p.queue} en puerta` : `${p.queue} aparcando`) : "—";
    return `<tr class="is-marshal"><td><i class="ds-sem is-${st}"></i>${p.name}</td>${ctl}<td colspan="2" class="ds-when">${when}</td><td>${q}</td></tr>`;
  }
  // Comparación de la estimación al instante: ahora frente al reparto que se está probando
  function whatIfHtml(w) {
    const n = w.now, t = w.then, cut = S.plan.cutoff;
    const row = (label, a, b, bad) => `<tr><td>${label}</td><td>${a}</td><td class="${bad == null ? "" : bad ? "is-bad" : "is-ok"}">${b}</td></tr>`;
    const bn = (x) => `${PNAME[x.key]} · ${n0(x.rate)}/h`;
    const dl = t.labor - n.labor;
    const rows = [
      t.sortDone ? "" : row("Fin del sort", clock(n.sortEnd), clock(t.sortEnd), t.sortEnd > cut),
      t.sortDone ? "" : row("Marca el ritmo", bn(n.bottleneck), bn(t.bottleneck), null),
      row("Rutas tarde", n.late, t.late, t.late > n.late ? true : t.late < n.late ? false : null),
      row("Rollover", n0(n.rollover), n0(t.rollover), t.rollover > n.rollover + 4 ? true : t.rollover < n.rollover - 4 ? false : null),
      row("Horas-persona que quedan", dec1(n.labor), `${dec1(t.labor)} <small>(${signed(dl, dec1)})</small>`, null),
    ].join("");
    // quién entraría y quién saldría, con su ritmo en ese proceso
    const pers = (x, verb) => `${esc(x.name)} <small>${x.id}</small> ${verb} ${PNAME[x.to || x.from]}${x.to && x.from ? ` (desde ${PNAME[x.from]})` : ""} · ${Math.round(x.eff * 100)}%${x.temp ? " · ETT" : x.to && !x.trained ? " · sin formación" : ""}`;
    const moves = [...w.joins.map((x) => pers(x, "→")), ...w.leaves.filter((x) => !w.joins.some((j) => j.id === x.id)).map((x) => pers(x, "sale de"))];
    return `<table class="ds-whatif"><thead><tr><th></th><th>Ahora</th><th>Con el cambio</th></tr></thead><tbody>${rows}</tbody></table>
      ${moves.length ? `<ul class="ds-whatif-who">${moves.slice(0, 6).map((x) => `<li>${x}</li>`).join("")}${moves.length > 6 ? `<li>y ${moves.length - 6} más</li>` : ""}</ul>` : ""}`;
  }
  // Resultado de la simulación exacta del resto del turno
  function simHtml(withDraft) {
    const key = withDraft ? simKey(draft) : "";
    if (!sim || sim.key !== key) return `<button class="ds-btn ds-btn--ghost ds-sim-btn" data-plan="sim" title="Repite la partida hasta ahora y la sigue hasta el final del turno: tarda unos segundos">Simular el resto del turno</button>`;
    if (sim.status === "run") return `<p class="ds-sim-note"><span class="ds-spin"></span>Simulando el resto del turno…</p>`;
    if (sim.status === "error") return `<p class="ds-sim-note is-bad">No se ha podido simular: ${esc(sim.error)}</p>`;
    const a = sim.base, b = sim.then, cut = S.plan.cutoff;
    const se = (x) => (x.sortEnd == null ? "sin terminar" : clock(x.sortEnd));
    const cell = (v, bad) => `<td class="${bad == null ? "" : bad ? "is-bad" : "is-ok"}">${v}</td>`;
    const rows = [
      ["Fin del sort", se(a), se(b), (x) => x.sortEnd == null || x.sortEnd > cut],
      ["Rutas a tiempo", `${a.routesOut - a.routesLate}/${a.routesTotal}`, `${b.routesOut - b.routesLate}/${b.routesTotal}`, (x) => x.routesLate > 0 || x.routesOut < x.routesTotal],
      ["Rollover", n0(a.rollover), n0(b.rollover), (x) => x.rollover > 0],
      ["Fin del turno", a.endAt == null ? "—" : clock(a.endAt), b.endAt == null ? "—" : clock(b.endAt), null],
      ["Horas-persona", dec1(a.laborHours), dec1(b.laborHours), null],
      ["Paq / hora trabajada", a.pph == null ? "—" : n0(a.pph), b.pph == null ? "—" : n0(b.pph), null],
    ].map(([l, x, y, bad]) => withDraft ? `<tr><td>${l}</td>${cell(x, bad && bad(a))}${cell(y, bad && bad(b))}</tr>` : `<tr><td>${l}</td>${cell(x, bad && bad(a))}</tr>`).join("");
    return `<div class="ds-sim"><span class="ds-eyebrow">Simulación del turno completo · desde las ${clock(sim.at)}</span>
      <table class="ds-whatif"><thead><tr><th></th><th>${withDraft ? "Sin cambiar" : "Si sigue así"}</th>${withDraft ? "<th>Con el cambio</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>
      <button class="ds-btn ds-btn--ghost ds-sim-btn" data-plan="sim">Volver a simular</button></div>`;
  }

  function renderProcs(m) {
    const staff = draft || S.staff;
    const rows = m.processes.map((p) => {
      const ctl = `<td class="ds-pp"><button data-pp="${p.key}" data-d="-1" aria-label="Quitar persona de ${p.name}">−</button><b class="${staff[p.key] !== S.staff[p.key] ? "is-changed" : ""}">${staff[p.key]}</b><button data-pp="${p.key}" data-d="1" aria-label="Añadir persona a ${p.name}">+</button></td>`;
      if (p.marshal) return marshalRow(p, staff, ctl);
      const st = procStatus(p), q = QUEUE[p.key](), cap = (p.target * S.staff[p.key]) / 60;
      return `<tr><td><i class="ds-sem is-${st}"></i>${p.name}</td>${ctl}<td>${st === "idle" ? "—" : Math.round(p.uph)}</td><td>${p.target}</td><td>${q ? fmtMin(q / cap) : "—"}</td></tr>`;
    }).join("");
    const total = Object.values(staff).reduce((s, v) => s + v, 0), base = Object.values(S.staff).reduce((s, v) => s + v, 0);
    const waveTxt = (ws) => ws.map((w) => `<span>O${w.n} ${w.done ? (w.late ? `<b class="is-bad">${w.late} tarde</b>` : '<b class="is-ok">fuera</b>') : `<b class="${w.late ? "is-bad" : "is-ok"}">${clock(w.depart)}</b>`}</span>`).join("");
    let out;
    if (draft && !sameStaff(draft, S.staff)) {
      const w = E.whatIf(draft);
      out = `<div class="ds-plan-out">Con este reparto: ${total} personas (${total - base >= 0 ? "+" : ""}${total - base}). Estimación al instante:
        ${whatIfHtml(w)}
        <div class="ds-waves">Salida prevista: ${waveTxt(w.then.waves)}</div></div>
        ${simHtml(true)}
        <div class="ds-plan-actions"><button class="ds-btn ds-btn--out" data-plan="apply">Aplicar</button><button class="ds-btn ds-btn--ghost" data-plan="discard">Descartar</button></div>`;
    } else {
      const bn = E.bottleneck();
      out = `<div class="ds-plan-out">${total} personas · prueba a mover gente con − y + para ver el efecto antes de aplicarlo.
        ${S.sortDoneAt == null ? `<div>Marca el ritmo del sort: <b>${PNAME[bn.key]}</b> (${n0(bn.rate)} paq/h).</div>` : ""}
        <div class="ds-waves">Salida prevista: ${waveTxt(m.waves)}</div></div>${S.over ? "" : simHtml(false)}`;
    }
    const { adv, need } = adviceNow();
    const advHtml = adv && !draft ? `<div class="ds-advice is-${adv.kind}"><span class="ds-eyebrow">Recomendación</span><p>${esc(adv.text)}</p>
      <div class="ds-plan-actions"><button class="ds-btn ds-btn--out" data-plan="advice">Aplicar</button><button class="ds-btn ds-btn--ghost" data-plan="ignore">Ignorar</button></div></div>` : "";
    // plantilla mínima para llegar al corte con 15 min de margen, sacar todas las oleadas y cubrir los marshals
    const sortKeys = ["receive", "induct", "stow", "ps"], sortNow = sortKeys.reduce((t, k) => t + S.staff[k], 0);
    const needHtml = `<div class="ds-need"><span>Plantilla mínima ${need.sortDone ? "" : need.reachable ? "para el corte, con 15 min de margen" : "(el corte ya no se alcanza)"}</span>
      ${need.sortDone ? "" : `<b>Sort ${need.sort}</b> <small>${crewTxt(need.staff, sortKeys)} · ahora ${sortNow}</small>`}
      <b>Pick ${need.pick}</b> <small>ahora ${S.staff.pick}</small>
      <b>Marshalls ${need.marshals}</b> <small>dock y yard · ahora ${S.staff.dock + S.staff.yard}</small>
      <button class="ds-btn ds-btn--ghost" data-plan="need" title="Carga esta plantilla en el planificador para ver el efecto antes de aplicarla">Probar</button></div>`;
    $("#ds-procs").innerHTML = `${advHtml}<table><thead><tr><th>Proceso</th><th>Personas</th><th>UPH</th><th>Obj.</th><th>Cola</th></tr></thead><tbody>${rows}</tbody></table>${out}${needHtml}`;
  }

  // ── Simulación exacta del resto del turno ─────────────
  // Repite la partida hasta ahora (misma semilla y mismas acciones) y la sigue hasta el final con y sin el cambio.
  // Va en un Web Worker para no frenar la animación; si el navegador no lo permite (p. ej. abriendo el archivo
  // sin servidor), se hace aquí mismo.
  let sim = null, simAcc = 0;
  // misma versión que los scripts de la página (?v=...), para que el worker no use código antiguo de la caché
  const VERSION = (document.querySelector('script[src^="ui.js"]')?.getAttribute("src").match(/\?.*/) || [""])[0];
  const simKey = (st) => (st ? MARSHALS.concat(["receive", "induct", "stow", "pick", "ps"]).map((k) => st[k]).join(",") : "");
  function project(msg) {
    return inWorker(msg, () => DSEngine.project(msg.L, msg.opts, msg.actions, msg.atStep, msg.staff));
  }
  function inWorker(msg, local) {
    return new Promise((resolve, reject) => {
      let w = null;
      try { w = new Worker("whatif-worker.js" + VERSION); } catch (e) { w = null; }
      const fallback = () => setTimeout(() => { try { resolve(local()); } catch (e) { reject(e); } }, 30);
      if (!w) return fallback();
      w.onmessage = (e) => { w.terminate(); resolve(e.data); };
      w.onerror = (e) => { e.preventDefault(); w.terminate(); fallback(); };
      w.postMessage(msg);
    });
  }
  function runSim() {
    const st = draft && !sameStaff(draft, S.staff) ? { ...draft } : null;
    const job = { key: simKey(st), at: S.t, status: "run" };
    sim = job;
    const msg = (staff) => ({ L: E.spec.L, opts: E.spec.opts, actions: S.actions.slice(), atStep: S.steps, staff });
    const runs = st ? [project(msg(null)), project(msg(st))] : [project(msg(null))];
    Promise.all(runs).then(([base, then]) => { job.status = "done"; job.base = base; job.then = then || base; })
      .catch((e) => { job.status = "error"; job.error = e && e.message ? e.message : String(e); })
      .finally(() => { if (sim === job) renderProcs(E.metrics()); });
  }

  function onProcs(e) {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pp) {
      const k = b.dataset.pp;
      draft = draft || { ...S.staff };
      draft[k] = Math.max(minStaff(k), Math.min(60, draft[k] + Number(b.dataset.d)));
    }
    if (b.dataset.plan === "apply" && draft) { E.setStaff({ ...draft }); draft = null; }
    if (b.dataset.plan === "discard") draft = null;
    if (b.dataset.plan === "need") draft = { ...adviceNow().need.staff };
    if (b.dataset.plan === "sim") runSim();
    const adv = advice.adv;
    if (b.dataset.plan === "advice" && adv) {
      E.setStaff({ ...adv.staff }, "Recomendación aplicada"); advice.k = null;
      toast("Recomendación aplicada");
    }
    // ignorada: no vuelve a salir la misma en 30 min de turno
    if (b.dataset.plan === "ignore" && adv) { ignored[adv.id] = S.t + 30; advice.k = null; }
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
      ["Missort", `<b class="${q.missortRate > 0.005 ? "is-warn" : ""}">${pct(q.missortRate)}</b>`],
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
    const out = [], first = Math.ceil((x0 + E.L.shiftStart) / every) * every - E.L.shiftStart;
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
    // ventana de sort: desde que entra el equipo de noche (o llega el primer camión) hasta el corte
    const s0 = Math.max(S.plan.firstTruck, S.plan.sortStart);
    ctx.fillStyle = C.raw; ctx.globalAlpha = 0.35; ctx.fillRect(X(s0), by, X(S.plan.cutoff) - X(s0), 6); ctx.globalAlpha = 1;
    // descansos del equipo de noche: el sort se para
    for (const b of S.plan.breaks) {
      ctx.fillStyle = C.floor; ctx.fillRect(X(b.from), by - 1, X(b.to) - X(b.from), 8);
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.strokeRect(X(b.from) + 0.5, by - 0.5, X(b.to) - X(b.from) - 1, 7); ctx.setLineDash([]);
      ctx.fillStyle = C.muted; ctx.textBaseline = "bottom"; ctx.fillText("descanso", X((b.from + b.to) / 2), by - 4); ctx.textBaseline = "top";
    }
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
      // carga para la noche: triángulo hueco, no cuenta para el sort de este turno
      if (pt.hold) { ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(pt.at), by - 3); ctx.lineTo(X(pt.at) - 3, by - 9); ctx.lineTo(X(pt.at) + 3, by - 9); ctx.closePath(); ctx.stroke(); continue; }
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
  function planPts() {
    const s0 = Math.max(S.plan.firstTruck, S.plan.sortStart), ts = [s0, S.plan.cutoff];
    for (const b of S.plan.breaks) if (b.from > s0 && b.from < S.plan.cutoff) ts.push(b.from, Math.min(b.to, S.plan.cutoff));
    return ts.sort((a, b) => a - b).map((t) => [t, E.planAt(t)]);
  }
  function drawPlan() {
    const H = S.history, x0 = Math.min(S.plan.firstTruck, 0) - 5;
    const f = E.forecast(), x1 = Math.max(S.plan.cutoff, f.sortEnd) + 20;
    const total = S.plan.volume + Math.max(0, S.received - S.plan.volume);
    const real = H.filter((p) => p.t <= x1).map((p) => [p.t, p.sorted]);
    const series = [
      // el plan va en línea recta en minutos de trabajo y se queda plano en el descanso
      { pts: planPts(), color: C.muted, dash: [5, 4], width: 1.5 },
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
  // las acciones pasan por el motor para que queden apuntadas y la simulación del resto del turno las repita
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
  $("#ds-auto").addEventListener("change", (e) => { E.setAuto(e.target.checked); });
  $("#ds-track-form").addEventListener("submit", (e) => { e.preventDefault(); track($("#ds-search").value.trim().toUpperCase()); });
  $("#ds-random").addEventListener("click", () => {
    const live = [...S.transit.map((t) => t.pkg), ...S.routes.flatMap((r) => r.bag)];
    if (!live.length) { toast("Todavía no hay paquetes en planta"); return; }
    track(live[Math.floor(Math.random() * live.length)].id);
  });
  document.querySelectorAll("[data-zone]").forEach((b) => b.addEventListener("click", () => {
    const z = b.dataset.zone;
    S.selected = z.startsWith("aisle") ? { kind: "aisle", id: z.slice(5) } : z.startsWith("marshal:") ? { kind: "marshal", id: z.slice(8) } : { kind: "zone", id: z };
    renderDetail();
  }));

  // ── Modo presentación ─────────────────────────────────
  const presentBtn = $("#ds-present"), root = document.documentElement;
  function setPresent(on) {
    // la presentación es del plano: si se estaba en la pestaña de plantilla, se vuelve a la estación
    if (on) document.querySelector('.ds-tabs [data-view="station"]')?.click();
    root.classList.toggle("is-present", on);
    presentBtn.setAttribute("aria-pressed", String(on));
    presentBtn.textContent = on ? "■ Salir" : "▶ Presentar";
    if (on && !document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(() => V.resize());
  }
  // el botón abre el tour guiado; en pantalla completa sirve para salir
  presentBtn.addEventListener("click", () => {
    if (root.classList.contains("is-present")) { setPresent(false); return; }
    if (tour.active) tour.stop(); else { if (reportEl.open) reportEl.close(); tour.start(); }
  });

  // ── Tour guiado ───────────────────────────────────────
  // Adelanta el turno hasta t (minutos) en trozos, sin bloquear la página, y vuelve a pintar el panel
  function fastForward(t, done) {
    t = Math.min(t, S.plan.end + 240);
    const tick = () => {
      const t0 = performance.now();
      while (S.t < t && !S.over && performance.now() - t0 < 40) E.step(DSEngine.DT);
      if (S.t < t && !S.over) { requestAnimationFrame(tick); return; }
      simAcc = 0; renderKpis(); renderLog(); drawShift(); drawPlan(); drawHourly();
      if (done) done();
    };
    tick();
  }
  const tour = DSTour.create({
    E: () => E, S: () => S, clock, at: (hhmm) => E.at(hhmm),
    breakTxt: (short) => {
      const b = S.plan.breaks;
      if (!b.length) return short ? "—" : " (este escenario no tiene descanso)";
      return short ? `${clock(b[0].from)} a ${clock(b[0].to)}` : ` de ${b.map((x) => `${clock(x.from)} a ${clock(x.to)}`).join(" y de ")}`;
    },
    view: (v) => { const b = document.querySelector(`.ds-tabs [data-view="${v}"]`); if (b && b.getAttribute("aria-selected") !== "true") b.click(); },
    setScenario: (id) => {
      if (scenarioId !== id) { scSel.value = id; scSel.dispatchEvent(new Event("change")); }
      else if (S.t > 1) boot();
    },
    setCtab: (t) => { if (ctab !== t) setCtab(t); },
    speed: () => Math.round(S.speed * 60),
    setSpeed: (x) => { S.speed = x / 60; const sel = $("#ds-speed"); if ([...sel.options].some((o) => Number(o.value) === x)) sel.value = String(x); },
    setPaused: (on) => { if (!!S.paused !== on) pauseBtn.click(); },
    fastForward,
    applyAdvice: () => { const b = document.querySelector('[data-plan="advice"]'); if (b) b.click(); return !!b; },
    trackRandom: () => $("#ds-random").click(),
    present: (on) => setPresent(on),
    // el mapa de Cádiz simulando el reparto de este turno (lo que lleva salido si aún no ha acabado)
    mapa: () => { location.href = DSReport.mapaUrl(DSReport.build(E, scenario(), { hourly: hourly() })); },
    // al terminar: el turno hasta el final y su informe
    finish: () => fastForward(Infinity, () => { reportShown = true; openReport(); }),
  });
  // salir de pantalla completa con Esc también sale del modo presentación
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && root.classList.contains("is-present")) setPresent(false); });
  // atajos: P presentar, espacio pausa (salvo escribiendo en un campo)
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey || reportEl.open || tour.active) return;
    if (e.key === "p" || e.key === "P") setPresent(!root.classList.contains("is-present"));
    else if (e.key === " " && !e.target.closest("button, a")) { e.preventDefault(); pauseBtn.click(); }
  });

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
    // pasos fijos de DSEngine.DT: así la partida se puede repetir exacta para simular el resto del turno
    if (!S.paused) { simAcc += dt * S.speed; while (simAcc >= DSEngine.DT) { E.step(DSEngine.DT); simAcc -= DSEngine.DT; } }
    if (mapVisible) V.draw(now / 1000, S.paused ? 0 : simAcc);
    uiAcc += dt;
    if (uiAcc > (V.COARSE ? 0.5 : 0.25)) {
      uiAcc = 0; renderKpis(); drawShift(); drawPlan(); drawHourly(); if (S.selected && ctab === "search") renderDetail();
      if (ctab === "hv") renderHV();
      // al terminar el turno se abre el informe una vez
      if (S.over && !reportShown) { reportShown = true; openReport(); }
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener("resize", () => V.resize());
  requestAnimationFrame(frame);
})();
