// Escenarios de la demo: cada uno cambia el plan del turno o la plantilla y lleva su semilla,
// así la misma demo sale siempre igual. Las cifras son inventadas.
(function (root) {
  "use strict";

  const clone = (o) => JSON.parse(JSON.stringify(o));
  // Sube o baja el volumen de todos los camiones del plan
  const scaleTrucks = (sh, k) => sh.trucks.forEach((t) => (t.units = Math.round((t.units * k) / 10) * 10));

  const SCENARIOS = [
    {
      id: "normal", name: "Noche normal", seed: 7,
      desc: "El plan de siempre: 10 camiones, plantilla completa y una parada corta del conveyor.",
      shift: (sh) => sh,
    },
    {
      id: "pico", name: "Pico (Prime Day)", seed: 21,
      desc: "Un 40% más de volumen con un refuerzo de plantilla que no llega al mismo ritmo.",
      shift: (sh) => { scaleTrucks(sh, 1.4); return sh; },
      staff: (L) => ({ receive: L.receive.staff + 1, induct: L.induct.staff + 1, stow: L.stow.staff + 3, pick: L.pick.staff + 4 }),
    },
    {
      id: "personal", name: "Falta de personal", seed: 33,
      desc: "Tres bajas en stow y tres en pick. Prueba a mover gente con el planificador.",
      shift: (sh) => sh,
      staff: (L) => ({ stow: L.stow.staff - 3, pick: L.pick.staff - 3 }),
    },
    {
      id: "retraso", name: "Camión retrasado", seed: 45,
      desc: "El último camión llega hora y media tarde y el conveyor se para 20 minutos.",
      shift: (sh) => {
        sh.events = [{ type: "conveyor", at: "01:20", minutes: 20 }, { type: "truckLate", truck: "T-10", minutes: 90 }];
        return sh;
      },
    },
  ];

  // Opciones para DSEngine.create a partir de un escenario
  function options(L, id) {
    const sc = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    return { seed: sc.seed, shift: sc.shift(clone(L.shift)), staff: sc.staff ? sc.staff(L) : {} };
  }

  const api = { list: SCENARIOS, options };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSScenarios = api;
})(typeof window !== "undefined" ? window : globalThis);
