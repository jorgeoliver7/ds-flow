// Tour guiado: recorre un turno de principio a fin y para en lo importante, con una explicación en cada parada.
// Ilumina la parte de la pantalla de la que habla y, cuando hace falta, adelanta el turno hasta la hora del paso.
// ui.js le pasa un api con lo que necesita (motor, escenario, velocidad, pestañas...).
(function (root) {
  "use strict";

  // Cada paso: target (selector de lo que se ilumina), title, body (texto o función que lo calcula con el turno
  // en marcha), at (hora del turno a la que se adelanta antes de mostrarlo), before (prepara la pantalla) y
  // action (botón opcional que hace algo por quien mira).
  const STEPS = [
    {
      target: ".ds-map-wrap", at: "01:40",
      before: (a) => { a.view("station"); a.setScenario("personal"); a.setCtab("search"); },
      title: "Un turno de noche, de principio a fin",
      body: "Esta es la estación: los camiones atracan arriba, lo descargado va a la zona de carros y a inducción, el conveyor lo lleva a los tres pasillos de sacas y, por la mañana, se recoge por rutas y sale en furgonetas desde el yard. Para la demo cargo el escenario \"Falta de personal\": hoy faltan cuatro personas en stow y cuatro en pick.",
    },
    {
      target: ".ds-shift-wrap",
      title: "El plan del turno",
      body: (a) => `La barra resume la noche: los triángulos son los camiones del plan, el equipo de noche entra a las ${a.clock(a.S().plan.sortStart)} y para a descansar${a.breakTxt()}. La línea roja es el corte del sort (${a.clock(a.S().plan.cutoff)}) y los bloques de color, las oleadas de salida. El rombo es la hora a la que acabaría el sort al ritmo de ahora.`,
    },
    {
      target: "#ds-kpis",
      title: "Lo que mira un responsable",
      body: (a) => {
        const f = a.E().forecast(), cut = a.S().plan.cutoff, late = f.sortEnd > cut;
        return `Los KPIs se actualizan en directo. El más importante es el fin previsto del sort: ahora mismo sale a las ${a.clock(f.sortEnd)}, ${late ? `${Math.round(f.sortEnd - cut)} min después del corte` : `${Math.round(cut - f.sortEnd)} min antes del corte`}. ${late ? "Con la gente que falta no llegamos, y la app lo sabe desde el principio de la noche." : "Vamos bien de tiempo."} Debajo están las rutas a tiempo, el rollover (lo que se queda para mañana) y la productividad por hora trabajada.`;
      },
    },
    {
      target: "#ds-procs",
      title: "La recomendación",
      body: (a, done) => {
        if (done) return `Hecho: ${done} El cambio queda apuntado en la actividad, y el rombo de la barra del turno se ha movido con él.`;
        const adv = a.E().advise();
        return adv
          ? `La app avisa como lo haría un responsable de turno: "${adv.text}" Se aplica con un clic y queda apuntado en la actividad.`
          : "Cuando algo va mal, aquí aparece una recomendación como la daría un responsable de turno (mover gente o reforzar un proceso), lista para aplicar con un clic.";
      },
      action: {
        label: "Aplicar la recomendación",
        run: (a) => {
          const before = a.E().forecast().sortEnd;
          if (!a.applyAdvice()) return null;
          const after = a.E().forecast().sortEnd, cut = a.S().plan.cutoff;
          return `el sort acabaría ahora a las ${a.clock(after)} en vez de a las ${a.clock(before)}, ${after <= cut ? `${Math.round(cut - after)} min antes del corte.` : `todavía ${Math.round(after - cut)} min tarde.`}`;
        },
      },
    },
    {
      target: "#ds-procs",
      title: "El planificador de plantilla",
      body: "Cada proceso tiene sus personas, su UPH real frente al objetivo y su cola. Con − y + pruebas un reparto antes de aplicarlo: al instante ves la nueva hora de fin, qué proceso marcaría el ritmo, las rutas que saldrían tarde y quién entraría o saldría. \"Simular el resto del turno\" repite la noche exacta hasta ahora y la sigue hasta la última furgoneta con y sin el cambio. Abajo, la plantilla mínima para llegar al corte con margen.",
    },
    {
      target: ".ds-track", spotPad: 10,
      before: (a) => a.setCtab("search"),
      title: "Seguir un paquete",
      body: "Cualquier paquete se puede rastrear por su código o pulsándolo en el mapa: dónde está, su ruta y todo su recorrido con la hora y la persona que lo movió. También se pueden pulsar las sacas, los camiones, las furgonetas y cada zona.",
      action: { label: "Rastrear uno al azar", run: (a) => { a.trackRandom(); return null; } },
    },
    {
      target: ".ds-insights", at: "04:08",
      title: "El descanso",
      body: (a) => `Hemos adelantado el turno hasta las ${a.clock(a.S().t)}. De ${a.breakTxt(true)} el equipo de noche descansa y el sort se para: la curva de clasificados se queda plana, igual que el plan, y la previsión ya lo cuenta. A la derecha, el ritmo por hora y el tiempo que pasa un paquete en cada tramo.`,
    },
    {
      target: ".ds-ctabs", spotPad: 10,
      before: (a) => a.setCtab("hv"),
      title: "High Values",
      body: "Los paquetes de valor alto se siguen uno a uno: dónde está cada uno ahora y desde cuándo. La app avisa si alguno acaba en problem solve, en una saca que no es la suya o se queda sin su furgoneta. En el mapa llevan un marco dorado.",
    },
    {
      target: ".ds-map-wrap", at: "06:50",
      before: (a) => a.setCtab("search"),
      title: "Las oleadas de salida",
      body: (a) => `Son las ${a.clock(a.S().t)}. El sort ${a.S().sortDoneAt != null ? `acabó a las ${a.clock(a.S().sortDoneAt)}` : "sigue en marcha"} y el equipo de mañana recoge las sacas por rutas en carros. Las furgonetas entran al yard por oleadas: el yard marshal las coloca, cargan su carro y salen por arriba. Si una oleada sale tarde o deja paquetes, lo verás en las alertas.`,
    },
    {
      target: '.ds-tabs [data-view="crew"]', spotPad: 8,
      title: "La plantilla",
      body: "En esta pestaña está cada persona del turno (con un ID y un nombre inventados): dónde está ahora, sus horas, paquetes, UPH y cómo va frente a la media de su proceso. Marca a los mejores y a quien necesita seguimiento, y se puede mover a alguien de proceso.",
      action: { label: "Abrir la plantilla", run: (a) => { a.view("crew"); return null; } },
    },
    {
      target: "#ds-report-btn", spotPad: 8,
      before: (a) => a.view("station"),
      title: "Ya lo tienes",
      body: "Al acabar el turno se abre un informe con lo que salió bien y lo que hay que mejorar, la productividad y el coste, y se puede comparar con otro escenario. Puedes seguir el turno en pantalla completa o ir directamente al informe.",
      final: true,
    },
  ];

  function create(api) {
    let i = -1, busy = false, timer = null, spot, card, prevSpeed = null, done = {};

    function el(tag, cls, html) { const e = document.createElement(tag); e.className = cls; if (html != null) e.innerHTML = html; return e; }

    function mount() {
      spot = el("div", "ds-tour-spot");
      card = el("div", "ds-tour-card");
      card.setAttribute("role", "dialog"); card.setAttribute("aria-live", "polite"); card.setAttribute("aria-label", "Tour guiado");
      document.body.append(spot, card);
      card.addEventListener("click", (e) => {
        const b = e.target.closest("[data-tour]"); if (!b || busy) return;
        const k = b.dataset.tour;
        if (k === "next") go(i + 1);
        else if (k === "prev") go(i - 1);
        else if (k === "close") stop();
        else if (k === "action") { const r = STEPS[i].action.run(api); if (r) done[i] = r; setTimeout(() => render(), 350); }
        else if (k === "present") { stop(); api.present(true); }
        else if (k === "report") { stop(); api.finish(); }
      });
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
    }
    function onKey(e) {
      if (!card) return;
      if (e.key === "Escape") { e.preventDefault(); stop(); }
      else if (e.key === "ArrowRight" && !busy && i < STEPS.length - 1) go(i + 1);
      else if (e.key === "ArrowLeft" && !busy && i > 0) go(i - 1);
    }

    function start() {
      if (card) return;
      mount();
      done = {};
      prevSpeed = api.speed();
      // durante el tour el turno avanza despacio para que se vea moverse sin cambiar mientras se lee
      api.setSpeed(10);
      go(0);
    }
    function stop() {
      if (!card) return;
      clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      spot.remove(); card.remove(); spot = card = null; i = -1;
      if (prevSpeed != null) api.setSpeed(prevSpeed);
      api.setPaused(false);
    }

    function go(n) {
      if (n < 0 || n >= STEPS.length) return;
      // hacia atrás no se deshace el turno: el paso se vuelve a mostrar con la hora de ahora
      const back = n < i;
      i = n;
      const st = STEPS[i];
      if (st.before && !back) st.before(api);
      const target = st.at && !back ? api.at(st.at) : null;
      if (target != null && api.S().t < target) {
        busy = true;
        card.innerHTML = `<p class="ds-eyebrow">Paso ${i + 1} de ${STEPS.length}</p><h3>${esc(st.title)}</h3><p class="ds-tour-ff"><span class="ds-spin"></span>Adelantando el turno hasta las ${st.at}…</p>`;
        place();
        api.fastForward(target, () => { busy = false; show(); });
      } else show();
    }
    function show() {
      const st = STEPS[i], t = document.querySelector(st.target);
      if (t) t.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      render();
      clearInterval(timer);
      // lo iluminado puede cambiar de tamaño mientras se actualiza el panel
      timer = setInterval(place, 300);
      setTimeout(place, 400);
    }
    function render() {
      if (!card) return;
      const st = STEPS[i], body = typeof st.body === "function" ? st.body(api, done[i]) : st.body;
      card.innerHTML = `
        <p class="ds-eyebrow">Paso ${i + 1} de ${STEPS.length}</p>
        <h3>${esc(st.title)}</h3>
        <p>${esc(body)}</p>
        ${st.action && !done[i] ? `<button class="ds-btn ds-btn--out ds-tour-act" data-tour="action">${esc(st.action.label)}</button>` : ""}
        <div class="ds-tour-nav">
          <button class="ds-btn ds-btn--ghost" data-tour="close">Salir</button>
          <span class="ds-tour-dots" aria-hidden="true">${STEPS.map((_, k) => `<i class="${k === i ? "is-on" : ""}"></i>`).join("")}</span>
          ${i > 0 ? `<button class="ds-btn ds-btn--ghost" data-tour="prev" aria-label="Paso anterior">←</button>` : ""}
          ${st.final
            ? `<button class="ds-btn" data-tour="present">Pantalla completa</button><button class="ds-btn ds-btn--out" data-tour="report">Ver el informe</button>`
            : `<button class="ds-btn ds-btn--out" data-tour="next">Siguiente →</button>`}
        </div>`;
      place();
      card.querySelector(st.final ? '[data-tour="report"]' : '[data-tour="next"]')?.focus({ preventScroll: true });
    }

    // Coloca el foco de luz sobre lo que se explica y la tarjeta al lado (debajo, encima o, si no cabe, abajo del todo)
    function place() {
      if (!card || i < 0) return;
      const st = STEPS[i], t = document.querySelector(st.target), vw = innerWidth, vh = innerHeight;
      const pad = st.spotPad || 6;
      if (!t || !t.getClientRects().length) { spot.style.opacity = "0"; card.style.left = Math.max(16, (vw - card.offsetWidth) / 2) + "px"; card.style.top = Math.max(16, (vh - card.offsetHeight) / 2) + "px"; return; }
      const r = t.getBoundingClientRect();
      const top = Math.max(r.top - pad, 4), bottom = Math.min(r.bottom + pad, vh - 4);
      Object.assign(spot.style, { opacity: "1", left: r.left - pad + "px", top: top + "px", width: r.width + pad * 2 + "px", height: Math.max(0, bottom - top) + "px" });
      const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14;
      let x = Math.min(Math.max(16, r.left), vw - cw - 16), y;
      if (bottom + gap + ch <= vh - 8) y = bottom + gap;
      else if (top - gap - ch >= 8) y = top - gap - ch;
      else {
        // al lado, si hay hueco; si no, abajo del todo sobre lo iluminado
        if (r.right + gap + cw <= vw - 8) { x = r.right + gap; y = Math.min(Math.max(16, r.top), vh - ch - 16); }
        else if (r.left - gap - cw >= 8) { x = r.left - gap - cw; y = Math.min(Math.max(16, r.top), vh - ch - 16); }
        else y = vh - ch - 16;
      }
      card.style.left = x + "px"; card.style.top = y + "px";
    }

    return { start, stop, get active() { return !!card; } };
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  root.DSTour = { create, STEPS };
})(typeof window !== "undefined" ? window : globalThis);
