// Simula el resto del turno en segundo plano: repite la partida hasta ahora y la sigue con otro reparto.
// Lo usa el planificador (ui.js) para no frenar la animación mientras calcula.
// con la misma versión (?v=...) que la página
importScripts("crew.js" + self.location.search, "engine.js" + self.location.search);
self.onmessage = (e) => {
  const { L, opts, actions, atStep, staff } = e.data;
  self.postMessage(DSEngine.project(L, opts, actions, atStep, staff));
};
