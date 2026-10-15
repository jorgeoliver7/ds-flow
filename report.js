// Informe de fin de turno: resume la partida en KPIs, lo que salió bien y mal, y lo exporta a CSV.
// No toca el DOM (salvo html(), que solo devuelve texto), así que se prueba en Node.
(function (root) {
  "use strict";

  const PROCS = { receive: "Zona de carros", induct: "Inducción", stow: "Stow", pick: "Pick", ps: "Problem solve" };
  const CYCLE = { dockInduct: "Muelle → inducción", inductStow: "Inducción → saca", stowPick: "Espera en saca → pick", pickOut: "Pick → salida" };
  const pct = (v, d = 0) => (v * 100).toFixed(d).replace(".", ",") + "%";
  const dec = (v, d = 1) => (v == null ? "—" : v.toFixed(d).replace(".", ","));
  // miles con punto también en 4 cifras (toLocaleString("es-ES") deja "8200")
  const n0 = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function build(E, sc) {
    const S = E.S, L = E.L, m = E.metrics(), q = m.quality, clock = E.clock;
    const fmt = (min) => (min < 90 ? Math.round(min) + " min" : (min / 60).toFixed(1).replace(".", ",") + " h");
    const sortEnd = S.sortDoneAt, cutoff = S.plan.cutoff;

    // UPH por persona de todo el turno: paquetes del proceso entre las horas-persona de su equipo
    const cfg = { receive: L.receive, induct: L.induct, stow: L.stow, pick: L.pick, ps: L.problem };
    const procs = Object.keys(PROCS).map((k) => {
      const hours = (S.procMin[k] || 0) / 60, units = S.totals[k] || 0, uph = hours > 0.2 ? units / hours : null;
      // problem solve depende de cuántas incidencias haya, así que no se compara con su objetivo
      return { key: k, name: PROCS[k], staff: S.staff[k], units, hours, uph, target: cfg[k].uph, ratio: uph && k !== "ps" ? uph / cfg[k].uph : null };
    });
    const waves = m.waves.map((w) => {
      const pw = S.plan.waves.find((x) => x.n === w.n);
      return { n: w.n, routes: pw.routes.length, at: pw.at, deadline: w.deadline, depart: w.depart, late: w.late, done: w.done };
    });

    const kpis = [
      ["Volumen", n0(S.received), `de ${n0(S.plan.volume)} planificados`],
      ["Fin del sort", sortEnd == null ? "Sin terminar" : clock(sortEnd), sortEnd == null ? `corte ${clock(cutoff)}` : sortEnd <= cutoff ? `${fmt(cutoff - sortEnd)} antes del corte` : `${fmt(sortEnd - cutoff)} después del corte`, sortEnd != null && sortEnd <= cutoff ? "ok" : "bad"],
      ["Rutas a tiempo", `${m.routesOnTime}/${m.routesTotal}`, m.routesLate ? `${m.routesLate} tarde` : "todas", m.routesLate ? "bad" : "ok"],
      ["Rollover", String(m.rollover), "paquetes para mañana", m.rollover ? "bad" : "ok"],
      ["Horas trabajadas", dec(m.laborHours), "horas-persona"],
      ["Paquetes / hora trabajada", m.pph == null ? "—" : String(Math.round(m.pph)), "clasificados"],
      ["Llenado de saca", m.bagFill == null ? "—" : pct(m.bagFill)],
      ["Missort", pct(q.missortRate, 2), `${q.missort} paquetes`, q.missortRate > 0.005 ? "warn" : "ok"],
      ["DPMO", n0(q.dpmo), "defectos por millón"],
      ["Problem solve", q.psAvg == null ? "—" : fmt(q.psAvg), `resolución media · ${q.writtenOff} de baja`],
      ["Fin del turno", S.endAt == null ? "En curso" : clock(S.endAt)],
    ];

    const good = [], bad = [];
    if (sortEnd != null) (sortEnd <= cutoff ? good : bad).push(sortEnd <= cutoff
      ? `El sort acabó a las ${clock(sortEnd)}, ${fmt(cutoff - sortEnd)} antes del corte.`
      : `El sort acabó a las ${clock(sortEnd)}, ${fmt(sortEnd - cutoff)} después del corte de las ${clock(cutoff)}.`);
    else bad.push(`El sort no llegó a terminar (corte a las ${clock(cutoff)}).`);
    // si el sort llegó tarde, quién marcó el ritmo: el proceso con menos capacidad nominal
    if (sortEnd == null || sortEnd > cutoff) {
      const capOf = (k) => (cfg[k].rate * S.staff[k]) / cfg[k].staff;
      const [slow, fast] = capOf("stow") <= capOf("induct") ? ["stow", "induct"] : ["induct", "stow"];
      bad.push(capOf(slow) === capOf(fast)
        ? `Inducción y stow iban justos: ${n0(capOf(slow))} paq/h cada uno con la plantilla del turno.`
        : `${PROCS[slow]} marcó el ritmo del sort: con ${S.staff[slow]} personas da ${n0(capOf(slow))} paq/h, frente a ${n0(capOf(fast))} de ${PROCS[fast].toLowerCase()}.`);
    }
    if (!m.routesLate && m.routesOut === m.routesTotal) good.push(`Las ${m.routesTotal} rutas salieron dentro de su ventana.`);
    for (const w of waves) if (w.late) bad.push(`Oleada ${w.n}: ${w.late} de ${w.routes} rutas salieron tarde (última a las ${clock(w.depart)}, límite ${clock(w.deadline)}).`);
    if (m.rollover) bad.push(`${m.rollover} paquetes se quedan en la estación para mañana (rollover).`);
    else if (m.routesOut) good.push("Sin rollover: no se queda ningún paquete en la estación.");
    const byRatio = procs.filter((p) => p.ratio != null);
    for (const p of byRatio) if (p.ratio >= 0.95) good.push(`${p.name} trabajó al ${pct(p.ratio)} de su objetivo (${Math.round(p.uph)} de ${p.target} UPH).`);
    const worst = byRatio.slice().sort((a, b) => a.ratio - b.ratio)[0];
    // la UPH es por hora fichada: un proceso bajo suele significar esperas o gente de más
    if (worst && worst.ratio < 0.9) bad.push(`${worst.name} se quedó en el ${pct(worst.ratio)} de su objetivo (${Math.round(worst.uph)} de ${worst.target} UPH por hora fichada): hubo esperas o sobraba gente.`);
    if (q.missortRate <= 0.005) good.push(`Missort del ${pct(q.missortRate, 2)}, dentro del 0,5% objetivo.`);
    else bad.push(`Missort del ${pct(q.missortRate, 2)}, por encima del 0,5% objetivo.`);
    if (q.writtenOff) bad.push(`${q.writtenOff} paquete${q.writtenOff > 1 ? "s dañados se dieron" : " dañado se dio"} de baja.`);
    for (const ev of S.plan.events) {
      if (ev.type === "conveyor" && ev.state !== "pending") bad.push(`El conveyor estuvo parado ${ev.minutes} min desde las ${clock(ev.at)}.`);
    }
    for (const pt of S.plan.trucks) if (pt.eta !== pt.at) bad.push(`El camión ${pt.id} llegó ${pt.delay} min tarde (${clock(pt.eta)} en vez de ${clock(pt.at)}).`);

    const cycle = m.cycle.map((c) => ({ name: CYCLE[c.key], min: c.min }));
    return { scenario: sc ? sc.name : "Turno", seed: sc ? sc.seed : null, over: S.over, now: clock(S.t), kpis, procs, waves, cycle, quality: q, good, bad, clock };
  }

  // CSV para Excel en español: separador ";" y coma decimal
  function csv(r) {
    const rows = [["Sección", "Métrica", "Valor", "Detalle"]];
    rows.push(["Turno", "Escenario", r.scenario, r.seed == null ? "" : "semilla " + r.seed]);
    for (const [k, v, sub] of r.kpis) rows.push(["KPI", k, v, sub || ""]);
    for (const p of r.procs) rows.push(["Proceso", p.name, p.uph == null ? "" : Math.round(p.uph), `objetivo ${p.target} UPH · ${p.staff} personas · ${p.units} paquetes`]);
    for (const w of r.waves) rows.push(["Oleada", "O" + w.n, r.clock(w.depart), `límite ${r.clock(w.deadline)} · ${w.late} de ${w.routes} rutas tarde`]);
    for (const c of r.cycle) rows.push(["Tiempo de ciclo", c.name, c.min == null ? "" : dec(c.min), "minutos"]);
    for (const g of r.good) rows.push(["Bien", "", g, ""]);
    for (const b of r.bad) rows.push(["A mejorar", "", b, ""]);
    const cell = (v) => { const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
  }

  function html(r) {
    const k = r.kpis.map(([l, v, sub, cls]) => `<div class="ds-kpi"><span>${l}</span><strong class="${cls ? "is-" + cls : ""}">${esc(v)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`).join("");
    const procs = r.procs.map((p) => `<tr><td>${p.name}</td><td>${p.staff}</td><td>${n0(p.units)}</td><td>${p.uph == null ? "—" : Math.round(p.uph)}</td><td>${p.target}</td>
      <td class="${p.ratio == null ? "" : p.ratio >= 0.95 ? "is-ok" : p.ratio >= 0.85 ? "is-warn" : "is-bad"}">${p.ratio == null ? "—" : pct(p.ratio)}</td></tr>`).join("");
    const waves = r.waves.map((w) => `<tr><td>O${w.n}</td><td>${w.routes}</td><td>${r.clock(w.at)}–${r.clock(w.deadline)}</td><td class="${w.late ? "is-bad" : "is-ok"}">${r.clock(w.depart)}</td><td>${w.late}</td></tr>`).join("");
    const list = (a, empty) => (a.length ? a.map((x) => `<li>${esc(x)}</li>`).join("") : `<li class="ds-hint">${empty}</li>`);
    return `
      <header class="ds-report-head">
        <div><p class="ds-eyebrow">Informe de fin de turno${r.over ? "" : " · provisional, " + r.now}</p><h2>${esc(r.scenario)}</h2></div>
      </header>
      <div class="ds-kpis ds-report-kpis">${k}</div>
      <div class="ds-report-cols">
        <section><h4>Lo que salió bien</h4><ul class="ds-report-list ds-report-good">${list(r.good, "Nada destacable")}</ul></section>
        <section><h4>Lo que hay que mejorar</h4><ul class="ds-report-list ds-report-bad">${list(r.bad, "Nada: turno limpio")}</ul></section>
      </div>
      <div class="ds-report-cols">
        <section class="ds-procs"><h4>Productividad del turno</h4><table><thead><tr><th>Proceso</th><th>Pers.</th><th>Paquetes</th><th>UPH</th><th>Obj.</th><th>%</th></tr></thead><tbody>${procs}</tbody></table></section>
        <section class="ds-procs"><h4>Oleadas</h4><table><thead><tr><th>Oleada</th><th>Rutas</th><th>Ventana</th><th>Salida</th><th>Tarde</th></tr></thead><tbody>${waves}</tbody></table>
          <h4 style="margin-top:14px">Tiempo de ciclo</h4><ul class="ds-quality">${r.cycle.map((c) => `<li>${c.name}<b>${c.min == null ? "—" : dec(c.min) + " min"}</b></li>`).join("")}</ul></section>
      </div>`;
  }

  const api = { build, csv, html };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSReport = api;
})(typeof window !== "undefined" ? window : globalThis);
