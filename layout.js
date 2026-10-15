// Plano de la estación de reparto (DS). Todo el mapa sale de aquí: cambia
// posiciones, ritmos, número de muelles, pasillos o rutas y la simulación se adapta.
// Orientación: docks arriba, conveyor por la izquierda, stow en el centro y
// yard a la derecha (las furgonetas entran por abajo y salen por arriba).
// Ritmos en unidades/hora con la plantilla base (staff).
const DS_LAYOUT = {
  width: 1240,
  height: 740,
  shiftStart: 23 * 60,     // el ciclo arranca a las 23:00

  docks: {
    count: 9,
    wallY: 112,            // pared de muelles (los camiones atracan por encima)
    left: 40, right: 780,
    truckUnits: 600,       // volumen típico de un camión extra (botón + Camión)
    unloadRate: 600,       // paq/h por muelle
  },

  // Zona de carros: almacenaje temporal entre el dock y el conveyor.
  // Lo descargado se reparte en carros por grupo (cada uno con sus pasillos)
  // y por tamaño; los carros se llevan después a inducción.
  receive: {
    name: "Zona de carros", code: "CRT",
    x: 170, y: 124, w: 610, h: 112,
    staff: 3,              // personas moviendo carros a inducción
    uph: 600,              // objetivo: paquetes por hora y persona
    moveMinutes: 1.2,      // lo que tarda un carro en llegar a inducción
    staleMinutes: 4,       // un carro a medio llenar se lleva tras este tiempo sin cambios
    desc: "Lo que sale del camión se coloca en carros, separados por grupo y por tamaño. Cuando inducción tiene hueco, alguien lleva el siguiente carro hasta allí.",
    groups: [
      { id: "EQX1", aisles: [0, 1] },
      { id: "DQX1", aisles: [2] },
    ],
    classes: [
      { id: "S", name: "Pequeños", short: "PEQ", cap: 40 },
      { id: "M", name: "Medianos", short: "MED", cap: 24 },
      { id: "O", name: "Oversize", short: "OVS", cap: 8 },
    ],
  },

  induct: {
    name: "Inducción", code: "IND",
    x: 40, y: 124, w: 110, h: 112,
    rate: 1800, staff: 4,
    uph: 450,
    desc: "Cada paquete se pone en el conveyor. Al escanearlo, el sistema le asigna su ruta y el pasillo al que tiene que ir.",
  },

  conveyor: { x: 95, top: 236, bottom: 712, speed: 240 }, // px por minuto simulado (~0,5 m/s a escala del plano)

  stow: {
    name: "Stow a sacas", code: "STW",
    rate: 1800, staff: 12,  // repartido entre pasillos
    uph: 150,
    desc: "Los stowers cogen el paquete del conveyor y lo meten en la saca de su ruta. Cada pasillo tiene las sacas de 8 rutas.",
    aisles: [
      // de arriba abajo: C, B, A
      { id: "A", y: 568 },
      { id: "B", y: 410 },
      { id: "C", y: 252 },
    ],
    x: 180, w: 600, h: 144,
    routesPerAisle: 8,
    bagCapacity: 40,       // paquetes por saca: una ruta llena varias
  },

  pick: {
    name: "Pick por rutas", code: "PCK",
    x: 806, y: 252, w: 104, h: 456,
    rate: 4200, staff: 14,
    uph: 300,
    desc: "Antes de cada oleada, los pickers sacan las sacas de sus rutas, las montan en un carro por ruta y las dejan listas para la furgoneta.",
  },

  yard: {
    name: "Yard", code: "YRD",
    x: 940, y: 16, w: 290, h: 708,
    pads: 12,
    loadRate: 1800,
    desc: "Las furgonetas entran por abajo, aparcan en su plaza, cargan el carro de su ruta y salen a reparto por arriba.",
  },

  // Plan del turno. Son valores de ejemplo, no datos reales de ninguna estación:
  // ajústalos (o importa un CSV desde la app) para simular una noche concreta.
  shift: {
    trucks: [
      { at: "23:05", units: 820 }, { at: "23:20", units: 760 }, { at: "23:40", units: 900 },
      { at: "00:10", units: 850 }, { at: "00:40", units: 940 }, { at: "01:10", units: 780 },
      { at: "01:45", units: 880 }, { at: "02:20", units: 820 }, { at: "02:50", units: 760 },
      { at: "03:20", units: 690 },
    ],
    sortCutoff: "05:30",   // hora límite para tener todo clasificado en sacas
    pickLead: 75,          // minutos antes de su oleada en que empieza el pick de una ruta
    loadWindow: 25,        // minutos desde la hora de la oleada para cargar y salir a tiempo
    maxWait: 20,           // pasado el límite, la furgoneta espera como mucho esto y sale con lo que tenga
    waves: [
      { at: "06:30", aisles: ["A"] },
      { at: "07:00", aisles: ["B"] },
      { at: "07:30", aisles: ["C"] },
    ],
  },

  // Municipios por ruta para la ficha del paquete
  towns: ["Cádiz", "San Fernando", "Chiclana", "Puerto Real", "El Puerto", "Jerez", "Rota", "Conil"],
};

if (typeof module !== "undefined" && module.exports) module.exports = DS_LAYOUT;
else window.DS_LAYOUT = DS_LAYOUT;
