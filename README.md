# DS Flow · el viaje de un paquete

Mapa interactivo y animado de una estación de reparto de última milla: camiones en 9 muelles, recepción, inducción, conveyor, stow a sacas, pick por rutas y furgonetas en el yard. Permite rastrear cualquier paquete desde el muelle hasta la entrega y ver los KPIs del ciclo en vivo desde un centro de control.

**Demo:** https://jorgeoliver7.github.io/ds-flow/

Forma parte del [portfolio de Jorge Acedo](https://jorgeoliver7.github.io/Portfolio-Website/).

## Stack

JavaScript sin dependencias y Canvas. Sin build: es una página estática.

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Estructura de la página y controles |
| `ds-flow.css` | Estilos (temas claro/oscuro y estilos "Claude" y "Editorial") |
| `layout.js` | Geometría y parámetros de la estación: muelles, conveyor, sacas, yard |
| `engine.js` | Motor de la simulación y métricas, sin DOM (se prueba en Node) |
| `render.js` | Dibujo del plano en Canvas |
| `ui.js` | Centro de control, controles y bucle de animación |
| `test/` | Pruebas del motor (`npm test`) |

## Ejecutar en local

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Tests

```bash
npm test   # node --test, sin dependencias
```

## Despliegue

GitHub Pages desde la rama `main` (carpeta raíz).

---

Estación genérica inspirada en experiencia real en logística de última milla; ritmos, rutas y paquetes son sintéticos.
