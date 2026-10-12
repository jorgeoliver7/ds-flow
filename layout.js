// Plano de la estación de reparto (DS). Todo el mapa sale de aquí: cambia
// posiciones, ritmos, número de muelles, pasillos o rutas y la simulación se adapta.
// Orientación: docks arriba, conveyor por la izquierda, stow en el centro y
// yard a la derecha (las furgonetas entran por abajo y salen por arriba).
// Ritmos en unidades/hora con la plantilla base (staff).
window.DS_LAYOUT = {
  width: 1240,
  height: 740,
  shiftStart: 23 * 60,     // el ciclo arranca a las 23:00

  docks: {
    count: 9,
    wallY: 112,            // pared de muelles (los camiones atracan por encima)
    left: 40, right: 780,
    truckUnits: 180,
    unloadRate: 360,       // paq/h por muelle
  },

  // Zona de carros: almacenaje temporal entre el dock y el conveyor.
  // Lo descargado se reparte en carros por grupo (cada uno con sus pasillos)
  // y por tamaño; los carros se llevan después a inducción.
  receive: {
    name: "Zona de carros", code: "CRT",
    x: 170, y: 124, w: 610, h: 112,
    staff: 3,              // personas moviendo carros a inducción
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
    desc: "Cada paquete se pone en el conveyor. Al escanearlo, el sistema le asigna su ruta y el pasillo al que tiene que ir.",
  },

  conveyor: { x: 95, top: 236, bottom: 712, speed: 240 }, // px por minuto simulado (~0,5 m/s a escala del plano)

  stow: {
    name: "Stow a sacas", code: "STW",
    rate: 1800, staff: 12,  // repartido entre pasillos
    desc: "Los stowers cogen el paquete del conveyor y lo meten en la saca de su ruta. Cada pasillo tiene las sacas de 8 rutas.",
    aisles: [
      // de arriba abajo: C, B, A
      { id: "A", y: 568 },
      { id: "B", y: 410 },
      { id: "C", y: 252 },
    ],
    x: 180, w: 600, h: 144,
    routesPerAisle: 8,
    bagCapacity: 60,
  },

  pick: {
    name: "Pick por rutas", code: "PCK",
    x: 806, y: 252, w: 104, h: 456,
    rate: 2400, staff: 8,
    desc: "Cuando la furgoneta de una ruta está lista, los pickers sacan todas sus sacas, las montan en un carro y las llevan al yard.",
  },

  yard: {
    name: "Yard", code: "YRD",
    x: 940, y: 16, w: 290, h: 708,
    pads: 12,
    loadRate: 1200,
    onTimeMinutes: 15,     // objetivo: furgoneta cargada y fuera en ≤ 15 min
    desc: "Las furgonetas entran por abajo, aparcan en su plaza, cargan el carro de su ruta y salen a reparto por arriba.",
  },

  // Municipios por ruta para la ficha del paquete
  towns: ["Cádiz", "San Fernando", "Chiclana", "Puerto Real", "El Puerto", "Jerez", "Rota", "Conil"],
};
