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
    truckUnits: 2000,      // volumen típico de un camión extra (botón + Camión)
    unloadRate: 2000,      // paq/h por muelle
    // Dock marshal: recibe cada camión, revisa precinto y documentación y le asigna muelle
    marshal: {
      name: "Dock marshal", code: "DKM",
      staff: 1,
      checkInMin: 3,       // minutos por camión con dock marshal (uno detrás de otro si llegan juntos)
      selfCheckInMin: 15,  // sin dock marshal: el conductor espera y se coordina como puede
      unloadNoMarshal: 0.85, // y la descarga va más lenta, sin nadie que ordene muelles y carros
      desc: "Recibe a cada camión en la puerta, comprueba precinto y albarán y le asigna muelle. Sin él los camiones esperan más para atracar y la descarga va más desordenada.",
    },
  },

  // Zona de carros: almacenaje temporal entre el dock y el conveyor.
  // Lo descargado se reparte en carros por grupo (cada uno con sus pasillos)
  // y por tamaño; los carros se llevan después a inducción.
  receive: {
    name: "Zona de carros", code: "CRT",
    x: 170, y: 124, w: 610, h: 112,
    staff: 3,              // personas moviendo carros a inducción
    uph: 1400,             // objetivo: paquetes por hora y persona
    rate: 6000,            // lo que pueden llevar a inducción entre todos (carros llenos y medio llenos), calibrado con la simulación
    moveMinutes: 1,      // lo que tarda un carro en llegar a inducción
    staleMinutes: 4,       // un carro a medio llenar se lleva tras este tiempo sin cambios
    desc: "Lo que sale del camión se coloca en carros, separados por grupo y por tamaño. Cuando inducción tiene hueco, alguien lleva el siguiente carro hasta allí.",
    groups: [
      { id: "EQX1", aisles: [0, 1] },
      { id: "DQX1", aisles: [2] },
    ],
    classes: [
      { id: "S", name: "Pequeños", short: "PEQ", cap: 60 },
      { id: "M", name: "Medianos", short: "MED", cap: 36 },
      { id: "O", name: "Oversize", short: "OVS", cap: 12 },
    ],
  },

  induct: {
    name: "Inducción", code: "IND",
    x: 40, y: 124, w: 110, h: 112,
    rate: 5500, staff: 5,
    uph: 1100,
    desc: "Cada paquete se pone en el conveyor. Al escanearlo, el sistema le asigna su ruta y el pasillo al que tiene que ir.",
  },

  conveyor: { x: 95, top: 236, bottom: 712, speed: 240 }, // px por minuto simulado (~0,5 m/s a escala del plano)

  stow: {
    name: "Stow a sacas", code: "STW",
    rate: 4800, staff: 16,  // los stowers van a los pasillos que tienen paquetes
    uph: 300,
    desc: "Los stowers cogen el paquete del conveyor y lo meten en la saca de su ruta. Cada pasillo tiene 8 estanterías con 5 rutas cada una.",
    aisles: [
      // de arriba abajo: C, B, A
      { id: "A", y: 568 },
      { id: "B", y: 410 },
      { id: "C", y: 252 },
    ],
    x: 180, w: 600, h: 144,
    racksPerAisle: 8,      // estanterías por pasillo
    shelves: 5,            // rutas por estantería (una por balda)
    routesPerAisle: 40,
    bagCapacity: 40,       // paquetes por saca: una ruta llena varias
  },

  pick: {
    name: "Pick por rutas", code: "PCK",
    x: 806, y: 252, w: 104, h: 456,
    rate: 12000, staff: 20,  // equipo de mañana, aparte del de la noche
    uph: 600,
    desc: "Antes de cada oleada, los pickers sacan las sacas de sus rutas, las montan en un carro por ruta y las dejan listas para la furgoneta.",
  },

  // Problem solve: paquetes con incidencias (dañados, sin etiqueta legible o mal clasificados)
  problem: {
    name: "Problem solve", code: "PS",
    x: 806, y: 124, w: 104, h: 112,
    staff: 2,
    uph: 30,                             // resoluciones por hora y persona
    handleMin: 6,                        // minutos mínimos que pasa un paquete en revisión
    desc: "Aquí acaban los paquetes con incidencias: dañados, sin etiqueta legible o mal clasificados. Se revisan y vuelven al flujo, o se dan de baja si no tienen arreglo.",
  },

  // Calidad: probabilidad de cada incidencia por paquete
  quality: {
    damaged: 0.0015,       // llega dañado del camión
    noLabel: 0.003,        // la etiqueta no se lee en inducción
    missort: 0.004,        // el stower lo mete en la saca de al lado
    writeOff: 0.3,         // de los dañados, los que no tienen arreglo
  },

  yard: {
    name: "Yard", code: "YRD",
    x: 940, y: 16, w: 290, h: 708,
    pads: 24,
    padCols: 4,            // columnas de plazas, la mitad a cada lado del carril
    loadRate: 1800,
    // Yard marshal: ordena la entrada de furgonetas a sus plazas y da la salida durante las oleadas
    marshal: {
      name: "Yard marshal", code: "YDM",
      staff: 1,
      before: 15,          // empieza este rato antes de la primera oleada
      parkNoMarshal: 5,    // sin yard marshal: minutos que tarda una furgoneta en encontrar y ocupar su plaza
      loadNoMarshal: 0.85, // y la carga va más lenta
      desc: "Durante las oleadas dirige la entrada de cada furgoneta a su plaza, vigila la carga y da la salida. Sin él las furgonetas tardan en colocarse y salen más tarde.",
    },
    desc: "Las furgonetas entran por abajo, aparcan en su plaza, cargan el carro de su ruta y salen a reparto por arriba.",
  },

  // Plan del turno. Son valores de ejemplo, no datos reales de ninguna estación:
  // ajústalos (o importa un CSV desde la app) para simular una noche concreta.
  shift: {
    // unos 26.000 paquetes en 12 camiones para un equipo de noche de 26 personas
    // (3 en carros, 5 en inducción, 16 en stow y 2 en problem solve)
    trucks: [
      { at: "23:00", units: 2300 }, { at: "23:10", units: 2100 }, { at: "23:30", units: 2400 },
      { at: "23:50", units: 2200 }, { at: "00:10", units: 2300 }, { at: "00:35", units: 2100 },
      { at: "01:00", units: 2400 }, { at: "01:25", units: 2200 }, { at: "01:50", units: 2100 },
      { at: "02:15", units: 2300 }, { at: "02:40", units: 2000 }, { at: "03:00", units: 1800 },
    ],
    sortCutoff: "05:30",   // hora límite para tener todo clasificado en sacas
    pickLead: 75,          // minutos antes de su oleada en que empieza el pick de una ruta
    loadWindow: 20,        // minutos desde la hora de la oleada para cargar y salir a tiempo
    maxWait: 20,           // pasado el límite, la furgoneta espera como mucho esto y sale con lo que tenga
    // incidencias programadas (para que la demo salga siempre igual)
    events: [
      { type: "conveyor", at: "01:20", minutes: 8 },
    ],
    // oleadas de 20 rutas cada 15 min: routes es el tramo de rutas del pasillo (1–40)
    waves: [
      { at: "06:30", aisles: ["A"], routes: [1, 20] },
      { at: "06:45", aisles: ["A"], routes: [21, 40] },
      { at: "07:00", aisles: ["B"], routes: [1, 20] },
      { at: "07:15", aisles: ["B"], routes: [21, 40] },
      { at: "07:30", aisles: ["C"], routes: [1, 20] },
      { at: "07:45", aisles: ["C"], routes: [21, 40] },
    ],
  },

  // High value: paquetes de valor alto (electrónica, joyería...) que se siguen uno a uno durante el turno.
  // Proporción y valores inventados.
  highValue: { share: 0.004, min: 300, max: 2500 },

  // Municipios por ruta para la ficha del paquete
  towns: ["Cádiz", "San Fernando", "Chiclana", "Puerto Real", "El Puerto", "Jerez", "Rota", "Conil"],
};

if (typeof module !== "undefined" && module.exports) module.exports = DS_LAYOUT;
else (typeof window !== "undefined" ? window : globalThis).DS_LAYOUT = DS_LAYOUT; // también en un Web Worker
