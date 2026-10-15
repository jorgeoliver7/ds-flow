// Importa una noche concreta desde un CSV. El archivo se lee en el navegador y no sale de él:
// no se sube a ningún sitio ni se guarda.
//
// Formato (separador ";" o ",", con cabecera):
//   tipo;id;hora;paquetes
//   camion;T-01;23:05;850     → camión del plan: hora de llegada y paquetes
//   ruta;R001;;220            → paquetes de una ruta (reparte el volumen entre rutas)
//   corte;;05:30;             → hora de corte del sort (opcional)
//   oleada;1;06:30;           → hora de salida de la oleada 1, o de la primera del pasillo A con "oleada;A" (opcional)
(function (root) {
  "use strict";

  const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const TYPES = { camion: "truck", truck: "truck", ruta: "route", route: "route", corte: "cutoff", cutoff: "cutoff", oleada: "wave", wave: "wave" };

  function parse(text, L) {
    const errors = [];
    const lines = String(text).replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (!lines.length) return { ok: false, errors: ["El archivo está vacío"] };
    const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
    const head = lines[0].split(sep).map(norm);
    const col = (names) => head.findIndex((h) => names.includes(h));
    const cTipo = col(["tipo", "type"]), cId = col(["id", "codigo", "ruta", "camion"]), cHora = col(["hora", "time", "at"]), cN = col(["paquetes", "cantidad", "units", "volumen"]);
    if (cTipo < 0 || cN < 0) return { ok: false, errors: ['Falta la cabecera: "tipo;id;hora;paquetes"'] };

    const shift = JSON.parse(JSON.stringify(L.shift));
    const trucks = [], routeVol = {}, waves = {};
    const routes = L.stow.aisles.length * L.stow.routesPerAisle;
    lines.slice(1).forEach((line, i) => {
      const c = line.split(sep).map((x) => x.trim()), n = i + 2;
      const type = TYPES[norm(c[cTipo])], id = (c[cId] || "").toUpperCase(), hora = (c[cHora] || "").padStart(5, "0"), units = Number(String(c[cN] || "").replace(/\./g, ""));
      if (!type) { errors.push(`Línea ${n}: tipo "${c[cTipo]}" desconocido`); return; }
      if (type === "truck") {
        if (!HHMM.test(hora)) return errors.push(`Línea ${n}: hora "${c[cHora]}" no válida (HH:MM)`);
        if (!(units > 0)) return errors.push(`Línea ${n}: el camión necesita un número de paquetes`);
        trucks.push({ at: hora, units: Math.round(units) });
      } else if (type === "route") {
        const k = Number(id.replace(/\D/g, ""));
        if (!(k >= 1 && k <= routes)) return errors.push(`Línea ${n}: ruta "${id}" fuera de R01–R${String(routes).padStart(2, "0")}`);
        if (!(units >= 0)) return errors.push(`Línea ${n}: la ruta necesita un número de paquetes`);
        routeVol[k] = (routeVol[k] || 0) + units;
      } else if (type === "cutoff") {
        if (!HHMM.test(hora)) return errors.push(`Línea ${n}: hora de corte no válida`);
        shift.sortCutoff = hora;
      } else if (type === "wave") {
        // id: número de oleada (1, 2…) o letra de pasillo (mueve todas las oleadas de ese pasillo)
        const isNum = /^\d+$/.test(id);
        if (isNum ? !(Number(id) >= 1 && Number(id) <= shift.waves.length) : !L.stow.aisles.some((a) => a.id === id)) return errors.push(`Línea ${n}: oleada o pasillo "${id}" no existe`);
        if (!HHMM.test(hora)) return errors.push(`Línea ${n}: hora de oleada no válida`);
        waves[id] = hora;
      }
    });

    if (trucks.length) shift.trucks = trucks.sort((a, b) => toMin(a.at) - toMin(b.at));
    if (Object.keys(waves).length) {
      // por pasillo: la primera oleada del pasillo va a esa hora y las demás conservan su separación
      const first = {};
      for (const w of shift.waves) if (!(w.aisles[0] in first)) first[w.aisles[0]] = toMin(w.at);
      shift.waves = shift.waves.map((w, i) => {
        if (waves[String(i + 1)]) return { ...w, at: waves[String(i + 1)] };
        const a = w.aisles[0];
        if (!waves[a]) return w;
        const m = toMin(waves[a]) + toMin(w.at) - first[a] - 720;
        return { ...w, at: String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, "0") + ":" + String(((m % 60) + 60) % 60).padStart(2, "0") };
      });
    }
    // los eventos del ejemplo (conveyor parado) no son de esta noche
    shift.events = [];
    let weights = null;
    const vol = Object.values(routeVol).reduce((s, v) => s + v, 0);
    if (vol > 0) weights = Array.from({ length: routes }, (_, i) => routeVol[i + 1] || 0);
    else if (Object.keys(routeVol).length) errors.push("Las rutas suman 0 paquetes");
    if (!trucks.length && !weights) errors.push("No hay camiones ni rutas en el archivo");

    const total = shift.trucks.reduce((s, t) => s + t.units, 0);
    return {
      ok: !errors.length, errors, shift, weights,
      summary: `${shift.trucks.length} camiones · ${String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} paquetes${weights ? ` · ${weights.filter((w) => w > 0).length} rutas con volumen` : ""}`,
    };
  }

  // minutos desde las 12:00 para ordenar horas de noche (23:00 antes que 01:00)
  const toMin = (h) => { const [a, b] = h.split(":").map(Number); return ((a * 60 + b + 720) % 1440); };

  const api = { parse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSImport = api;
})(typeof window !== "undefined" ? window : globalThis);
