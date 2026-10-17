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
      desc: "Unos 26.000 paquetes en 12 camiones, 26 personas en el sort de noche y una parada corta del conveyor.",
      shift: (sh) => sh,
    },
    {
      id: "pico", name: "Pico (Prime Day)", seed: 21,
      desc: "Un 40% más de volumen (unos 37.000 paquetes) con un refuerzo de plantilla que no crece al mismo ritmo.",
      shift: (sh) => { scaleTrucks(sh, 1.4); return sh; },
      staff: (L) => ({ receive: L.receive.staff + 1, induct: L.induct.staff + 1, stow: L.stow.staff + 3, pick: L.pick.staff + 4 }),
    },
    {
      id: "personal", name: "Falta de personal", seed: 33,
      desc: "Cuatro bajas en stow y cuatro en pick. Prueba a mover gente con el planificador.",
      shift: (sh) => sh,
      staff: (L) => ({ stow: L.stow.staff - 4, pick: L.pick.staff - 4 }),
    },
    {
      id: "retraso", name: "Camión retrasado", seed: 45,
      desc: "El último camión llega una hora tarde y el conveyor se para 20 minutos.",
      shift: (sh) => {
        sh.events = [{ type: "conveyor", at: "02:20", minutes: 20 }, { type: "truckLate", truck: "T-12", minutes: 60 }];
        return sh;
      },
    },
    {
      id: "pm", name: "Tarde (PM, same day)", seed: 58,
      desc: "Turno de tarde: 2 yard marshall desde las 14:00 y 4 asociados de 16:00 a 21:00, con un manager y un supervisor. Los camiones de las 14:30 y las 15:30 traen carga para la noche, que se descarga y se deja en la playa. El de las 16:00 trae unos 500 paquetes de same day, que se procesan para las 8 rutas de las 18:00.",
      shift: (sh) => ({
        ...sh, start: "14:00", sortStart: "16:00", nightEnd: null, breaks: [],
        // todos fichados hasta las 21:00: los yard marshall desde las 14:00 y los asociados desde las 16:00
        teamEnd: "21:00", marshalsIn: "14:00", teamProcs: ["receive", "induct", "stow", "pick", "ps", "dock", "yard"],
        // uno de los yard marshall recibe los camiones y, acabada la descarga, pasa al yard con el otro
        dockToYard: true,
        trucks: [
          { at: "14:30", units: 1800, hold: true }, { at: "15:30", units: 1600, hold: true },
          { at: "16:00", units: 500 },
        ],
        sortCutoff: "17:45", events: [],
        waves: [{ at: "18:00", aisles: ["A"] }],
      }),
      // 4 asociados: carros, inducción, stow y pick (los incidentes los resuelve quien los encuentra); 2 yard marshall
      staff: () => ({ receive: 1, induct: 1, stow: 1, pick: 1, ps: 1, dock: 1, yard: 1 }),
      routes: [1.2, 0.8, 1, 1.4, 0.6, 1.1, 0.9, 1],
    },
  ];

  // Opciones para DSEngine.create a partir de un escenario
  function options(L, id) {
    const sc = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    const n = L.stow.aisles.length * L.stow.routesPerAisle;
    return {
      seed: sc.seed, shift: sc.shift(clone(L.shift)), staff: sc.staff ? sc.staff(L) : {},
      routeWeights: sc.routes ? Array.from({ length: n }, (_, i) => sc.routes[i] || 0) : undefined,
    };
  }

  const api = { list: SCENARIOS, options };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSScenarios = api;
})(typeof window !== "undefined" ? window : globalThis);
