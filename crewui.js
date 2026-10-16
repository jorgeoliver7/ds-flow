// Pestaña "Plantilla": cada persona del turno, dónde está ahora y cómo va.
// Lee el motor de ui.js (window.__ds) y se redibuja sola mientras está a la vista.
(function () {
  "use strict";

  const L = window.DS_LAYOUT;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
  const PROC = { receive: "Zona de carros", induct: "Inducción", stow: "Stow", pick: "Pick", ps: "Problem solve", dock: "Dock marshall", yard: "Yard marshall" };
  const SHORT = { receive: "Carros", induct: "Inducción", stow: "Stow", pick: "Pick", ps: "PS", dock: "Dock M.", yard: "Yard M." };
  // los marshals no mueven paquetes: cuentan camiones recibidos y furgonetas despachadas, sin objetivo de UPH
  const MARSHAL = { dock: "camiones", yard: "furgonetas" };
  const TEAM = { noche: "Noche", "mañana": "Mañana", tarde: "Tarde" };
  const FLAG = { top: ["Top", "ok"], low: ["Por debajo", "warn"], quality: ["Calidad", "bad"] };
  const TARGETS = { receive: L.receive.uph, induct: L.induct.uph, stow: L.stow.uph, pick: L.pick.uph, ps: L.problem.uph, dock: null, yard: null };

  const view = $("#ds-crew"), main = document.querySelector(".ds-main");
  let filter = "all", sortKey = "proc", sortDir = 1, selected = null, rows = [];
  const E = () => window.__ds();

  // ── Pestañas ─────────────────────────────────────────
  function show(which) {
    const crew = which === "crew";
    view.hidden = !crew; main.hidden = crew;
    for (const b of document.querySelectorAll(".ds-tabs [role=tab]")) b.setAttribute("aria-selected", String(b.dataset.view === which));
    if (crew) render();
    else window.dispatchEvent(new Event("resize"));
    try { history.replaceState(null, "", crew ? "#plantilla" : location.pathname + location.search); } catch (e) {}
  }
  for (const b of document.querySelectorAll(".ds-tabs [role=tab]")) b.addEventListener("click", () => show(b.dataset.view));

  // Dónde está cada persona ahora mismo, en palabras
  function status(e, S) {
    const sortOn = S.t >= S.plan.sortStart && S.sortDoneAt == null, pickOn = S.t >= S.plan.pickStart && !S.over;
    if (!e.proc) return { txt: e.bench ? "Disponible" : "Libre", cls: "idle" };
    const clock = E().clock;
    if (MARSHAL[e.proc]) {
      if (E().marshalsOn()[e.proc]) return { txt: PROC[e.proc], cls: "on" };
      if (e.proc === "yard" && !S.over) return { txt: `Yard marshall desde ${clock(S.plan.firstWave - (L.yard.marshal ? L.yard.marshal.before : 15))}`, cls: "later" };
      if (e.proc === "dock" && S.dockDoneAt == null) return { txt: `Dock marshall desde ${clock(S.plan.sortStart)}`, cls: "later" };
      return { txt: e.proc === "dock" ? "Camiones recibidos" : "Oleadas terminadas", cls: "idle" };
    }
    const on = e.proc === "pick" ? pickOn : e.proc === "ps" ? sortOn || pickOn : sortOn;
    if (on) return { txt: PROC[e.proc], cls: "on" };
    if (e.proc === "pick" && !pickOn && !S.over) return { txt: `Pick desde ${clock(S.plan.pickStart)}`, cls: "later" };
    // tras el sort, la noche sigue hasta su hora de salida haciendo rutas y buscando paquetes perdidos
    if (!sortOn && S.sortDoneAt != null && e.proc !== "ps" && S.plan.nightEnd != null && S.t < S.plan.nightEnd && e.team === "noche")
      return { txt: `Apoyo: rutas y paquetes perdidos (hasta las ${clock(S.plan.nightEnd)})`, cls: "on" };
    if (!sortOn && S.sortDoneAt != null) return { txt: "Sort terminado", cls: "idle" };
    return { txt: `${PROC[e.proc]} desde ${clock(S.plan.sortStart)}`, cls: "later" };
  }

  function data() {
    const eng = E(), S = eng.S, crew = S.crew;
    if (!crew) return [];
    return crew.stats(TARGETS).map((e) => ({ ...e, st: status(e, S), uph: e.hours > 0.25 && !MARSHAL[e.primary] ? e.units / e.hours : null }));
  }

  const FILTERS = [["all", "Todos"], ["working", "Trabajando hoy"], ...Object.entries(SHORT), ["free", "Disponibles"], ["top", "Top"], ["flag", "Con aviso"], ["new", "Nuevos"]];
  function pass(e) {
    if (filter === "all") return true;
    if (filter === "working") return !!e.proc;
    if (filter === "free") return !e.proc;
    if (filter === "top") return e.flag === "top";
    if (filter === "flag") return e.flag === "low" || e.flag === "quality";
    if (filter === "new") return e.tenure < 3;
    return e.proc === filter;
  }
  const SORT = {
    id: (e) => e.id, name: (e) => e.name, team: (e) => e.team,
    proc: (e) => (e.proc ? Object.keys(PROC).indexOf(e.proc) : 9) * 1000 - (e.vsTeam || 0) * 100,
    hours: (e) => e.hours, units: (e) => e.units, uph: (e) => e.uph || 0, ratio: (e) => e.ratio || 0, vsTeam: (e) => e.vsTeam || 0,
    missort: (e) => e.missortRate || 0, tenure: (e) => e.tenure,
  };

  function render() {
    if (view.hidden) return;
    const eng = E(); if (!eng) return;
    const S = eng.S;
    rows = data();
    $("#ds-crew-clock").textContent = `${eng.clock(S.t)} · ${$("#ds-scenario").selectedOptions[0]?.textContent || ""}`;
    $("#ds-crew-pause").textContent = S.paused ? "▶ Seguir" : "❚❚ Pausa";

    // resumen del equipo
    const working = rows.filter((e) => e.proc), hours = rows.reduce((s, e) => s + e.hours, 0);
    const flagged = rows.filter((e) => e.flag === "low" || e.flag === "quality").length, top = rows.filter((e) => e.flag === "top").length;
    const fresh = working.filter((e) => e.tenure < 3).length, temps = rows.filter((e) => e.temp).length;
    const kp = [
      ["Personas hoy", working.length, `${rows.length - working.length} disponibles`],
      ["Horas fichadas", hours.toFixed(1).replace(".", ","), "en el turno"],
      ["Top", top, "≥ 108% de su equipo"],
      ["Con aviso", flagged, "< 90% de su equipo o missort > 0,6%"],
      ["Nuevos", fresh, "menos de 3 meses"],
      ["Temporales", temps, "de ETT, si faltó gente"],
    ];
    $("#ds-crew-kpis").innerHTML = kp.map(([l, v, sub]) => `<div class="ds-kpi"><span>${l}</span><strong>${v}</strong><small>${sub}</small></div>`).join("");
    $("#ds-crew-count").textContent = working.length;

    $("#ds-crew-filters").innerHTML = FILTERS.map(([k, l]) => {
      const n = rows.filter((e) => { const f = filter; filter = k; const ok = pass(e); filter = f; return ok; }).length;
      return `<button class="ds-chip${filter === k ? " is-on" : ""}" data-filter="${k}">${l} <b>${n}</b></button>`;
    }).join("");

    const list = rows.filter(pass).sort((a, b) => { const x = SORT[sortKey](a), y = SORT[sortKey](b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir || a.id.localeCompare(b.id); });
    const th = (k, l, title) => `<th data-sort="${k}"${title ? ` title="${title}"` : ""} class="${sortKey === k ? (sortDir > 0 ? "is-asc" : "is-desc") : ""}">${l}</th>`;
    const ratioCls = (r) => (r == null ? "" : r >= 1.05 ? "is-ok" : r < 0.9 ? "is-warn" : "");
    $("#ds-crew-table").innerHTML = `<thead><tr>${th("id", "ID")}${th("name", "Nombre")}${th("team", "Equipo")}${th("proc", "Ahora")}${th("hours", "Horas")}${th("units", "Paquetes")}${th("uph", "UPH")}${th("ratio", "% obj.", "UPH por hora fichada frente al objetivo del proceso")}${th("vsTeam", "vs equipo", "UPH frente a la media de su proceso en este turno")}${th("missort", "Missort")}<th>Aviso</th></tr></thead>
      <tbody>${list.map((e) => `<tr data-id="${e.id}" class="${selected === e.id ? "is-sel" : ""}">
        <td class="ds-mono">${e.id}</td><td>${esc(e.name)}${e.tenure < 3 ? ' <span class="ds-tag">nuevo</span>' : ""}${e.temp ? ' <span class="ds-tag">ETT</span>' : ""}</td>
        <td>${TEAM[e.team]}</td><td><i class="ds-st is-${e.st.cls}"></i>${e.st.txt}</td>
        <td class="ds-mono">${e.hours ? e.hours.toFixed(1).replace(".", ",") : "—"}</td><td class="ds-mono">${e.units ? num(e.units) : "—"}</td>
        <td class="ds-mono">${e.uph == null ? "—" : Math.round(e.uph)}</td><td class="ds-mono">${pct(e.ratio)}</td>
        <td class="ds-mono ${ratioCls(e.vsTeam)}">${pct(e.vsTeam)}</td>
        <td class="ds-mono ${e.missortRate > 0.006 ? "is-bad" : ""}">${e.missortRate == null ? "—" : (e.missortRate * 100).toFixed(2).replace(".", ",") + "%"}</td>
        <td>${e.flag ? `<span class="ds-flag is-${FLAG[e.flag][1]}">${FLAG[e.flag][0]}</span>` : ""}</td></tr>`).join("") || `<tr><td colspan="11" class="ds-hint">Nadie con este filtro.</td></tr>`}</tbody>`;
    renderDetail();
  }

  function renderDetail() {
    const el = $("#ds-crew-detail");
    const e = rows.find((x) => x.id === selected);
    if (!e) { el.innerHTML = `<p class="ds-hint">Pulsa una persona para ver su turno: horas y paquetes por proceso, missorts y cambios de puesto. Desde aquí también se la puede mover de proceso.</p>`; return; }
    const eng = E(), S = eng.S, crew = S.crew, person = crew.people.find((p) => p.id === e.id);
    const procs = e.procs.length ? e.procs.map((p) => MARSHAL[p.key]
      ? `<tr><td>${PROC[p.key]}</td><td>${p.hours.toFixed(1).replace(".", ",")}</td><td>${num(p.units)} ${MARSHAL[p.key]}</td><td>—</td><td>—</td><td>—</td></tr>`
      : `<tr><td>${PROC[p.key]}</td><td>${p.hours.toFixed(1).replace(".", ",")}</td><td>${num(p.units)}</td><td>${p.uph == null ? "—" : Math.round(p.uph)}</td><td>${p.key === "ps" ? "—" : p.target}</td><td>${pct(p.vsTeam)}</td></tr>`).join("") : `<tr><td colspan="6" class="ds-hint">Aún no ha trabajado en este turno.</td></tr>`;
    const moves = e.moves.length ? e.moves.map((m) => `<li><time>${eng.clock(m.t)}</time>${m.from ? PROC[m.from] : "Disponible"} → ${m.to ? PROC[m.to] : "Disponible"}</li>`).join("") : `<li class="ds-hint">Sin cambios de puesto.</li>`;
    // a qué procesos se le puede mover: los de su equipo; sin formación rinde al 75%
    // un marshal sí se puede quitar (para ver qué pasa sin él); un proceso de paquetes no se queda vacío
    const lone = e.proc && !MARSHAL[e.proc] && crew.byProc[e.proc].length <= 1;
    const targets = Object.keys(PROC).filter((k) => crew.teamOf(k) === e.team && k !== e.proc);
    const btn = (k) => `<button class="ds-btn ds-btn--ghost" data-move="${k}" ${lone ? "disabled" : ""} title="${e.skills.includes(k) ? "" : "Sin formación: rendiría al 75%"}">${SHORT[k]}${e.skills.includes(k) ? "" : " *"}</button>`;
    el.innerHTML = `
      <p class="ds-eyebrow">${e.id} · equipo de ${TEAM[e.team].toLowerCase()}</p>
      <h3>${esc(e.name)}</h3>
      <p class="ds-crew-now"><i class="ds-st is-${e.st.cls}"></i>${e.st.txt}${e.proc && e.since > 0 ? ` · desde las ${eng.clock(e.since)}` : ""}</p>
      <ul class="ds-stats">
        <li><span>Antigüedad</span><b>${e.temp ? "ETT" : e.tenure < 12 ? e.tenure + " meses" : (e.tenure / 12).toFixed(1).replace(".", ",") + " años"}</b></li>
        <li><span>Ritmo habitual</span><b>${pct(person.speed)}</b></li>
        <li><span>% del objetivo</span><b>${pct(e.ratio)}</b></li>
        <li><span>Frente a su equipo</span><b>${pct(e.vsTeam)}</b></li>
        <li><span>Missorts</span><b>${e.missorts}${e.missortRate == null ? "" : " · " + (e.missortRate * 100).toFixed(2).replace(".", ",") + "%"}</b></li>
      </ul>
      <div class="ds-skills">${e.skills.map((k) => `<span class="ds-chip${k === e.primary ? " is-on" : ""}">${SHORT[k]}</span>`).join("")}</div>
      <h4>Por proceso</h4>
      <table class="ds-mini"><thead><tr><th>Proceso</th><th>Horas</th><th>Paq.</th><th>UPH</th><th>Obj.</th><th>vs eq.</th></tr></thead><tbody>${procs}</tbody></table>
      <h4>Cambios de puesto</h4><ul class="ds-log">${moves}</ul>
      <h4>Mover a</h4>
      <div class="ds-move">${targets.map(btn).join("")}${e.proc ? `<button class="ds-btn ds-btn--ghost" data-move="" ${lone ? "disabled" : ""}>Disponible</button>` : ""}</div>
      ${lone ? `<p class="ds-hint">Es la única persona en ${PROC[e.proc].toLowerCase()}: no se puede quedar vacío.</p>` : `<p class="ds-hint">* sin formación en ese proceso: rendiría al 75%.</p>`}`;
  }

  // ── Interacción ──────────────────────────────────────
  $("#ds-crew-filters").addEventListener("click", (ev) => { const b = ev.target.closest("[data-filter]"); if (b) { filter = b.dataset.filter; render(); } });
  $("#ds-crew-table").addEventListener("click", (ev) => {
    const h = ev.target.closest("th[data-sort]");
    if (h) { const k = h.dataset.sort; sortDir = sortKey === k ? -sortDir : ["hours", "units", "uph", "ratio", "vsTeam", "missort", "tenure"].includes(k) ? -1 : 1; sortKey = k; render(); return; }
    const r = ev.target.closest("tr[data-id]"); if (r) { selected = r.dataset.id; render(); }
  });
  $("#ds-crew-detail").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-move]"); if (!b || b.disabled) return;
    // pasa por el motor para que quede apuntado y se pueda repetir al simular el resto del turno
    E().moveWorker(selected, b.dataset.move || null);
    render();
  });
  $("#ds-crew-pause").addEventListener("click", () => { $("#ds-pause").click(); render(); });
  $("#ds-crew-csv").addEventListener("click", () => {
    const head = ["ID", "Nombre", "Equipo", "Proceso habitual", "Habilidades", "Antigüedad (meses)", "Ahora", "Horas", "Paquetes", "UPH", "% objetivo", "vs equipo", "Missorts", "Missort %", "Aviso"];
    const cell = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const dec = (v, d) => (v == null ? "" : v.toFixed(d).replace(".", ","));
    const lines = data().map((e) => [e.id, e.name, TEAM[e.team], PROC[e.primary], e.skills.map((k) => SHORT[k]).join(", "), e.tenure, e.st.txt, dec(e.hours, 2), e.units,
      e.uph == null ? "" : Math.round(e.uph), dec(e.ratio && e.ratio * 100, 0), dec(e.vsTeam && e.vsTeam * 100, 0), e.missorts, dec(e.missortRate && e.missortRate * 100, 2), e.flag ? FLAG[e.flag][0] : ""]);
    const csv = "﻿" + [head, ...lines].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "ds-flow-plantilla.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // al reiniciar o cambiar de escenario la gente es otra partida: se limpia la selección si ya no existe
  setInterval(() => { if (!view.hidden) render(); }, 800);
  if (location.hash === "#plantilla") show("crew");
})();
