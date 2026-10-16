// Comparar dos turnos enteros lado a lado: escenario y plantilla en cada lado, con el coste de las horas trabajadas.
// run() no toca el DOM (se ejecuta en un Web Worker y en Node); html() solo devuelve texto.
(function (root) {
  "use strict";
  const DSEngine = typeof module !== "undefined" && module.exports ? require("./engine.js") : root.DSEngine;

  // Plantillas que se pueden elegir en cada lado
  const STAFF_MODES = [
    { id: "scenario", name: "La del escenario" },
    { id: "min", name: "La mínima para el corte" },
  ];

  // Juega un turno entero (opts como DSEngine.create) con la plantilla del escenario o con la mínima calculada
  function run(L, opts, mode) {
    let o = opts;
    if (mode === "min") {
      const need = DSEngine.create(L, { ...opts, hooks: undefined }).S.crewPlan.staff;
      o = { ...opts, staff: need };
    }
    const E = DSEngine.create(L, { ...o, hooks: undefined }), S = E.S;
    const limit = S.plan.end + 240;
    while (!S.over && S.t < limit) E.step(DSEngine.DT);
    return E.summary();
  }

  const n0 = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = (v, d) => v.toFixed(d).replace(".", ",");
  const eur = (v) => n0(v) + " €";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clock = (r, t) => DSEngine.clock({ shiftStart: r.clock0 }, t);
  const sum = (st, keys) => keys.reduce((s, k) => s + (st[k] || 0), 0);

  // Coste: horas-persona de todo el turno (sort, pick y marshals) por el coste por hora; por paquete, entre los recibidos
  function cost(r, hourly) { const total = r.laborHours * hourly; return { total, perPkg: r.received ? total / r.received : null }; }

  // Filas de la comparación. better: qué lado gana en esa fila (-1 menor es mejor, 1 mayor es mejor, 0 no se compara)
  function rows(a, b, hourly) {
    const ca = cost(a, hourly), cb = cost(b, hourly);
    const sortTxt = (r) => (r.sortEnd == null ? "sin terminar" : `${clock(r, r.sortEnd)} · ${r.sortEnd <= r.cutoff ? Math.round(r.cutoff - r.sortEnd) + " min antes" : Math.round(r.sortEnd - r.cutoff) + " min tarde"}`);
    const crew = (r) => `${sum(r.staff, ["receive", "induct", "stow", "ps"])} sort · ${r.staff.pick} pick · ${sum(r.staff, ["dock", "yard"])} marshalls`;
    return [
      { label: "Volumen", a: n0(a.received), b: n0(b.received), va: a.received, vb: b.received, better: 0 },
      { label: "Plantilla", a: crew(a), b: crew(b), better: 0 },
      { label: "Fin del sort", a: sortTxt(a), b: sortTxt(b), va: a.sortEnd == null ? 1e9 : a.sortEnd - a.cutoff, vb: b.sortEnd == null ? 1e9 : b.sortEnd - b.cutoff, better: -1 },
      { label: "Rutas a tiempo", a: `${a.routesOut - a.routesLate}/${a.routesTotal}`, b: `${b.routesOut - b.routesLate}/${b.routesTotal}`, va: (a.routesOut - a.routesLate) / a.routesTotal, vb: (b.routesOut - b.routesLate) / b.routesTotal, better: 1 },
      { label: "Rollover", a: n0(a.rollover), b: n0(b.rollover), va: a.rollover, vb: b.rollover, better: -1 },
      { label: "Horas-persona", a: dec(a.laborHours, 1), b: dec(b.laborHours, 1), va: a.laborHours, vb: b.laborHours, better: -1 },
      { label: "Paq / hora trabajada", a: a.pph == null ? "—" : n0(a.pph), b: b.pph == null ? "—" : n0(b.pph), va: a.pph || 0, vb: b.pph || 0, better: 1 },
      { label: "DPMO", a: n0(a.dpmo), b: n0(b.dpmo), va: a.dpmo, vb: b.dpmo, better: -1 },
      { label: "Coste del turno", a: eur(ca.total), b: eur(cb.total), va: ca.total, vb: cb.total, better: -1 },
      { label: "Coste por paquete", a: ca.perPkg == null ? "—" : dec(ca.perPkg, 3) + " €", b: cb.perPkg == null ? "—" : dec(cb.perPkg, 3) + " €", va: ca.perPkg, vb: cb.perPkg, better: -1 },
    ];
  }

  // Conclusión en una frase: qué cuesta de más (o ahorra) B frente a A y qué se gana o se pierde a cambio
  function verdict(a, b, hourly, names) {
    const ca = cost(a, hourly), cb = cost(b, hourly), d = cb.total - ca.total;
    const lateA = a.routesTotal - (a.routesOut - a.routesLate), lateB = b.routesTotal - (b.routesOut - b.routesLate);
    const money = Math.abs(d) < 1 ? "cuesta lo mismo que" : `cuesta ${eur(Math.abs(d))} ${d > 0 ? "más" : "menos"} (${d > 0 ? "+" : "−"}${Math.round((Math.abs(d) / ca.total) * 100)}%) que`;
    const gains = [];
    if (lateB !== lateA) gains.push(lateB < lateA ? `saca a tiempo ${lateA - lateB} ruta${lateA - lateB > 1 ? "s" : ""} más` : `deja ${lateB - lateA} ruta${lateB - lateA > 1 ? "s" : ""} más fuera de su ventana`);
    if (Math.abs(b.rollover - a.rollover) >= 5) gains.push(b.rollover < a.rollover ? `deja ${n0(a.rollover - b.rollover)} paquetes menos para mañana` : `deja ${n0(b.rollover - a.rollover)} paquetes más para mañana`);
    const sa = a.sortEnd == null ? null : a.sortEnd - a.cutoff, sb = b.sortEnd == null ? null : b.sortEnd - b.cutoff;
    if (sa != null && sb != null && Math.abs(sb - sa) >= 5) gains.push(sb < sa ? `acaba el sort ${Math.round(sa - sb)} min antes` : `acaba el sort ${Math.round(sb - sa)} min más tarde`);
    const list = gains.length > 1 ? gains.slice(0, -1).join(", ") + " y " + gains[gains.length - 1] : gains[0];
    return `${names[1]} ${money} ${names[0]}${gains.length ? ": " + list : ", con el mismo resultado en rutas, rollover y sort"}.`;
  }

  function html(a, b, hourly, names) {
    const cell = (r, side) => {
      const v = side ? r.vb : r.va, o = side ? r.va : r.vb;
      const win = r.better && v != null && o != null && Math.abs(v - o) > 1e-9 && (r.better < 0 ? v < o : v > o);
      return `<td class="${win ? "is-ok" : ""}">${esc(side ? r.b : r.a)}</td>`;
    };
    const body = rows(a, b, hourly).map((r) => `<tr><td>${r.label}</td>${cell(r, 0)}${cell(r, 1)}</tr>`).join("");
    return `<table class="ds-cmp-table"><thead><tr><th></th><th>A · ${esc(names[0])}</th><th>B · ${esc(names[1])}</th></tr></thead><tbody>${body}</tbody></table>
      <p class="ds-cmp-verdict">${esc(verdict(a, b, hourly, ["A", "B"]))}</p>`;
  }

  const api = { run, rows, verdict, html, cost, STAFF_MODES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSCompare = api;
})(typeof window !== "undefined" ? window : globalThis);
