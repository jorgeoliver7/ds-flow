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
        return `Un modelo de gradient boosting, entrenado con 12.000 días jugados por el motor, predice la entrega de cada zona y la de un día malo (nueve de cada diez salen mejor). Con este flash flood: ${a.pct(r.total.entrega)} de entrega prevista y ${a.pct(r.total.p10)} en un día malo. La Sierra (EQX1) sufre más: ${a.pct(r.EQX1.entrega)} frente a ${a.pct(r.DQX1.entrega)} de DQX1.`;
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
      title: "Jugar el día",
      body: "Ahora el motor juega el día entero: las 120 furgonetas salen por oleadas, los tramos cortados por el agua se marcan en rojo y el mapa se llena según lo entregado. \"Otro día\" lo repite con las mismas condiciones y otra suerte; la IA predice la media de muchos días así.",
    },
    {
      target: ".ds-back", spotPad: 8,
      title: "Enlazado con DS Flow",
      body: "El informe de fin de turno de DS Flow abre este mapa con lo que salió de la estación: los paquetes, el retraso medio de las oleadas y el rollover. Lo que pasa en el sort se ve aquí en la calle.",
      final: [
        { label: "Seguir en el mapa", run: () => {} },
        { label: "Abrir DS Flow", out: true, run: (a) => a.dsflow() },
      ],
    },
  ];

  root.DSMapaTour = { STEPS };
})(typeof window !== "undefined" ? window : globalThis);
