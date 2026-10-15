// Gráficas pequeñas en canvas con ejes: líneas y barras. Sin dependencias.
(function (root) {
  "use strict";

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // Escala "bonita" para el eje Y: 4 marcas redondas
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  // o: { x0, x1, yMax, xTicks: [{x, label}], yFmt, C (colores), font,
  //      series: [{ pts: [[x,y]], color, dash, width, fill }], bars: [{ x, w, y, color }],
  //      vlines: [{ x, color, label, dash }], hlines: [{ y, color, label, dash }] }
  function draw(canvas, o) {
    const { ctx, w, h } = setup(canvas), C = o.C;
    const pad = { l: 38, r: 8, t: 8, b: 18 };
    const yMax = niceMax(o.yMax || 1);
    const X = (x) => pad.l + ((x - o.x0) / (o.x1 - o.x0 || 1)) * (w - pad.l - pad.r);
    const Yp = (y) => h - pad.b - (y / yMax) * (h - pad.t - pad.b);
    ctx.font = `500 9px ${C.mono}`; ctx.textBaseline = "middle";

    // rejilla y eje Y
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i, y = Yp(v);
      ctx.strokeStyle = C.line; ctx.globalAlpha = i ? 0.5 : 1; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, Math.round(y) + 0.5); ctx.lineTo(w - pad.r, Math.round(y) + 0.5); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = C.muted; ctx.textAlign = "right";
      ctx.fillText((o.yFmt || String)(v), pad.l - 5, y);
    }
    // eje X
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const t of o.xTicks || []) {
      const x = X(t.x); if (x < pad.l - 1 || x > w - pad.r + 1) continue;
      ctx.fillStyle = C.muted; ctx.fillText(t.label, x, h - pad.b + 5);
    }

    for (const b of o.bars || []) {
      const x0 = X(b.x), x1 = X(b.x + b.w);
      ctx.fillStyle = b.color; ctx.globalAlpha = b.alpha || 0.85;
      const y = Yp(b.y);
      ctx.fillRect(x0 + 1, y, Math.max(x1 - x0 - 2, 1), h - pad.b - y);
      ctx.globalAlpha = 1;
    }
    for (const l of o.hlines || []) {
      const y = Yp(l.y);
      ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.setLineDash(l.dash || [4, 3]);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.setLineDash([]);
      if (l.label) { ctx.fillStyle = l.color; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(l.label, w - pad.r - 2, y - 2); }
    }
    for (const l of o.vlines || []) {
      const x = X(l.x); if (x < pad.l || x > w - pad.r) continue;
      ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.setLineDash(l.dash || [4, 3]);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.setLineDash([]);
      if (l.label) { ctx.fillStyle = l.color; ctx.textAlign = x > w / 2 ? "right" : "left"; ctx.textBaseline = "top"; ctx.fillText(l.label, x + (x > w / 2 ? -4 : 4), pad.t); }
    }
    for (const s of o.series || []) {
      if (s.pts.length < 2) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.8; ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Yp(y)) : ctx.moveTo(X(x), Yp(y))));
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  root.DSCharts = { draw, niceMax };
})(window);
