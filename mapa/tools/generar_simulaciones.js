// Genera los datos de entrenamiento del modelo: miles de días con condiciones al
// azar, simulados con el motor de reparto, una fila por zona y día.
//
//   node mapa/tools/generar_simulaciones.js [dias] [salida.csv] [repeticiones]
//
// Por defecto 6000 días en mapa/tools/.cache/simulaciones.csv (no se sube al repo).
// Con repeticiones > 1 simula cada día varias veces con distinta semilla (Monte Carlo),
// para comprobar el modelo contra la media real del motor.
const fs = require("fs");
const path = require("path");
const R = require("../reparto.js");
const base = require("../data/cadiz-base.json");

const dias = +(process.argv[2] || 6000);
const salida = process.argv[3] || path.join(__dirname, ".cache", "simulaciones.csv");
const repeticiones = +(process.argv[4] || 1);

// Mezcla de días normales y días raros: la mayoría sin lluvia ni huelga, como en la vida real,
// pero con suficientes extremos para que el modelo los aprenda
function condiciones(rand) {
  const u = (a, b) => a + (b - a) * rand();
  const c = {
    volumen: rand() < 0.6 ? Math.max(0.5, 1 + (rand() + rand() + rand() - 1.5) * 0.2) : u(0.5, 1.8),
    lluvia: rand() < 0.45 ? 0 : u(0, 1),
    inundacion: rand() < 0.7 ? 0 : u(0, 1),
    huelga: rand() < 0.75 ? 0 : u(0, 0.6),
    refuerzo: rand() < 0.7 ? 0 : u(0, 0.3),
    retraso: rand() < 0.65 ? 0 : u(0, 120),
  };
  // no hay flash flood sin lluvia
  if (c.inundacion > 0) c.lluvia = Math.max(c.lluvia, c.inundacion * u(0.6, 1));
  return c;
}

const rasgos = new Map(base.zonas.map((z) => [z.id, R.rasgosZona(base, z)]));
const cabecera = ["dia", "zona", ...R.RASGOS_ZONA, ...R.RASGOS_DIA, "paquetes", "tasa_entrega", "tasa_fallidos", "tasa_rts"];
fs.mkdirSync(path.dirname(salida), { recursive: true });
const out = fs.createWriteStream(salida);
out.write(cabecera.join(",") + "\n");
const rand = R.rng(repeticiones > 1 ? 4242 : 2026);
const t0 = Date.now();
for (let d = 0; d < dias; d++) {
  const c = condiciones(rand);
  const filas = [];
  const dia = R.RASGOS_DIA.map((k) => +c[k].toFixed(4));
  for (let k = 0; k < repeticiones; k++) {
    const r = R.simular(base, c, { seed: 1000 + d * repeticiones + k + (repeticiones > 1 ? 500000 : 0) });
    for (const z of r.zonas) {
      if (!z.paquetes) continue;
      filas.push([d, z.id, ...rasgos.get(z.id).map((x) => +x.toFixed(4)), ...dia, z.paquetes,
        (z.entregados / z.paquetes).toFixed(5), (z.fallidos / z.paquetes).toFixed(5), (z.rts / z.paquetes).toFixed(5)].join(","));
    }
  }
  out.write(filas.join("\n") + "\n");
}
out.end(() => console.log(`${dias} días en ${((Date.now() - t0) / 1000).toFixed(1)} s → ${salida}`));
