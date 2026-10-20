// Tour guiado del mapa de Cádiz: los pasos. El motor del tour es el de DS Flow (../tour.js);
// ui.js le pasa un api con lo que necesita (escenario, modo, resultados de la IA, zona peor).
(function (root) {
  "use strict";

  const puntos = (v) => (Math.abs(v) * 100).toFixed(1).replace(".", ",");
  const NOMBRE = { lluvia: "la lluvia", inundacion: "el flash flood", huelga: "la huelga", volumen: "el volumen", refuerzo: "el refuerzo", retraso: "el retraso" };

  const STEPS = [
    {
      target: ".mp-map-wrap",
      before: (a) => { a.modo("ia"); a.escenario("normal"); },
      title: "El reparto de DS Flow, zona a zona",
      body: (a) => {
        const r = a.res(), o = a.otra();
        return `Cada trozo es un código postal que reparte la estación de DS Flow (el cuadrado, junto a la A-4). Las rutas DQX1 van a la Bahía, Jerez, la Costa Noroeste y La Janda; las EQX1, a la Sierra. En un día normal la IA prevé un ${a.pct(r.total.entrega)} de entrega. El ${o.zona}, rayado, lo reparte una estación de ${o.estacion}.`;
      },
    },
    {
      target: "#mp-scenarios", spotPad: 10,
      before: (a) => a.escenario("flood"),
      title: "Cambia las condiciones del día",
      body: "Elige un escenario o mueve los deslizadores: lluvia, flash flood, huelga, volumen, furgonetas de refuerzo y retraso de salida de la estación. Para la demo cargo un flash flood: lluvia fuerte y riadas en los tramos inundables.",
    },
    {
      target: "#mp-kpis",
      title: "La IA responde al instante",
      body: (a) => {
        const r = a.res();
        return `Un modelo de gradient boosting, entrenado con 12.000 turnos simulados por el motor, predice la entrega de cada zona y la de un día malo (nueve de cada diez salen mejor). Con este flash flood: ${a.pct(r.total.entrega)} de entrega prevista y ${a.pct(r.total.p10)} en un día malo. La Sierra (EQX1) sufre más: ${a.pct(r.EQX1.entrega)} frente a ${a.pct(r.DQX1.entrega)} de DQX1.`;
      },
    },
    {
      target: "#mp-why-card",
      title: "Por qué baja",
      body: (a) => {
        const w = a.porQue(), caida = w.normal - w.escenario;
        const partes = w.aportes.filter((x) => x.aporte < -0.001).map((x) => `${NOMBRE[x.condicion]} resta ${puntos(x.aporte)}`);
        return `La entrega cae ${puntos(caida)} puntos frente a un día normal. Los valores de Shapley reparten esa caída entre las condiciones del día: ${partes.join(" y ")}. Así se ve qué pesa más cuando se juntan varias cosas.`;
      },
    },
    {
      target: "#mp-reco",
      title: "Qué hacer",
      body: "La recomendación usa el mismo modelo para probar soluciones: cuántas furgonetas de refuerzo harían falta para llegar al 95%, si el problema son las carreteras y no las furgonetas, y qué zonas conviene avisar.",
    },
    {
      target: "#mp-zone-card",
      before: (a) => a.peorZona(),
      title: "Cada zona por dentro",
      body: (a) => {
        const z = a.peorZona();
        const malo = z.p10 < 0.05 ? "en un día malo el agua la deja sin acceso" : `en un día malo se queda en el ${a.pct(z.p10)}`;
        return `Toca cualquier zona del mapa para ver su detalle. Esta es ${z.municipio} (${z.cp}), la más expuesta hoy: ${malo}. Se ve cuántos paquetes tiene, cuánto se tarda en llegar desde la estación y su riesgo de inundación.`;
      },
    },
    {
      target: ".mp-map-wrap",
      before: (a) => a.modo("dia"),
      title: "Simular el turno",
      body: "Ahora el motor simula el turno de reparto: las furgonetas cargan en la estación, salen por oleadas, recorren sus zonas parada a parada por las calles y vuelven (huecas, de vuelta). Toca una furgoneta para seguir su ruta. \"Otro turno\" lo repite con las mismas condiciones y otra suerte; la IA predice la media de muchos turnos así.",
    },
    {
      target: "#mp-fleet-card",
      before: (a) => a.alFinal(),
      title: "Cómo le ha ido a la flota",
      body: (a) => {
        const f = a.flota();
        const veredicto = f.faltan > 0 ? `faltaron unas ${f.faltan} furgonetas` : f.sobran > 0 ? `sobraron unas ${f.sobran} furgonetas` : "las furgonetas fueron justas";
        const agua = f.porAgua > f.porTiempo ? `, pero ${f.porAgua} de las ${f.conProblemas} rutas con problemas los tienen por el agua y eso no se arregla con más furgonetas` : "";
        return `Al volver cada furgoneta se sabe cómo le fue al conductor: ${f.aTiempo} rutas sin problemas y ${f.conProblemas} con paquetes que vuelven, por falta de tiempo o por el agua. Con este flash flood ${veredicto}${agua}. La gráfica enseña cómo salen por oleadas y cómo vuelven por la tarde.`;
      },
    },
    {
      target: ".ds-back", spotPad: 8,
      title: "Enlazado con DS Flow",
      body: "El informe de fin de turno de DS Flow abre este mapa simulando el reparto con lo que salió de la estación: los paquetes, el rollover y la hora a la que salió cada oleada. Si una oleada salió tarde del sort, aquí sus furgonetas salen tarde y se ve en qué rutas no da tiempo.",
      final: [
        { label: "Seguir en el mapa", run: () => {} },
        { label: "Abrir DS Flow", out: true, run: (a) => a.dsflow() },
      ],
    },
  ];

  root.DSMapaTour = { STEPS };
})(typeof window !== "undefined" ? window : globalThis);
