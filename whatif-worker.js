// Simula turnos en segundo plano para no frenar la animación:
// - el resto del turno con otro reparto (planificador, ui.js)
// - un turno entero con una plantilla (comparar escenarios, compare.js)
// con la misma versión (?v=...) que la página
importScripts("crew.js" + self.location.search, "engine.js" + self.location.search, "compare.js" + self.location.search);
self.onmessage = (e) => {
  const d = e.data;
  if (d.type === "full") self.postMessage(DSCompare.run(d.L, d.opts, d.mode));
  else self.postMessage(DSEngine.project(d.L, d.opts, d.actions, d.atStep, d.staff));
};
