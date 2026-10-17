# DS Flow · el viaje de un paquete

Simulación de un turno de noche en una estación de reparto de última milla, del primer camión a la última furgoneta: unos 26.000 paquetes, un equipo de noche de 30 personas que entra a la 01:00 y descansa de 04:00 a 04:30, 120 rutas en 24 estanterías y 6 oleadas de salida. Se ve cómo se mueve cada paquete por el plano y, a la vez, las métricas con las que se lleva una estación de verdad: hora prevista de fin del sort, rutas a tiempo, productividad por proceso, calidad y un informe al acabar el turno.

**Demo:** https://jorgeoliver7.github.io/ds-flow/

Forma parte del [portfolio de Jorge Acedo](https://jorgeoliver7.github.io/Portfolio-Website/).

![Vista general a mitad de turno](docs/vista-general.jpg)

## Cómo contar un turno con la app

**Tour guiado** (botón "Presentar"): recorre un turno de falta de personal en 11 pasos y explica cada parte de la pantalla: el plan del turno, los KPIs, la recomendación (se aplica desde el tour), el planificador, el rastreo de paquetes, el descanso, los high value, las oleadas, la plantilla y el informe. Adelanta el turno hasta la hora de cada paso. Se mueve con las flechas y se sale con Esc.

1. **Elige un escenario** arriba a la izquierda: noche normal, pico, falta de personal, camión retrasado o tarde (PM), el turno del yard marshall. La tarde tiene 2 yard marshall desde las 14:00 y, de 16:00 a 21:00, 4 asociados, un supervisor (resuelve las incidencias) y un manager; a veces hay de refuerzo 2 asociados y otro supervisor, que aparecen como disponibles en la plantilla. Uno de los yard marshall recibe los camiones en los muelles y, acabada la descarga, pasa al yard con el otro para las rutas de las 18:00. En la tarde llegan dos camiones antes de las 16:00 (14:30 y 15:30) con carga **para la noche**: se descargan, pero los carros se quedan en la playa sin procesar hasta el sort de la noche (ciclo 1 del día siguiente); en el plano se ven como carros atenuados con "N para la noche". El camión de las 16:00 trae el **same day** (unos 500 paquetes): se descarga al momento, se clasifica y sale en las rutas de las 18:00. Cada uno tiene su semilla, así que sale igual cada vez. También se puede enlazar directamente con `?escenario=pico`.
2. **Sube la velocidad** a 180× o 600× para ver el turno entero en unos minutos.
3. **Sigue la barra del turno**: camiones del plan (▼), descanso del equipo de noche, corte del sort, oleadas de salida y el rombo con la hora prevista de fin del sort, en verde si llega al corte y en rojo si no. En el descanso el sort se para (descarga, carros, inducción, stow y problem solve) y la previsión, el plan y la UPH ya lo cuentan.
4. **Prueba el planificador** en "Procesos y plantilla": mueve personas con − y + y verás al instante la nueva hora de fin del sort, qué proceso marcaría el ritmo, las rutas que saldrían tarde, el rollover, las horas-persona que quedan y quién entraría o saldría de cada proceso (no es lo mismo quitar al más rápido que a alguien nuevo). **"Simular el resto del turno"** repite la partida exacta hasta ese momento y la sigue hasta la última furgoneta con y sin el cambio, para comparar el resultado real. Debajo está la **plantilla mínima** para llegar al corte con 15 min de margen, sacar todas las oleadas y cubrir los marshalls; "Probar" la carga en el planificador.
5. **Sigue las recomendaciones**: durante el turno la app avisa como lo haría un responsable de turno ("Mueve 1 de inducción a stow: el sort acabaría a las 05:52 en vez de a las 06:23"). Se aplican con un clic y quedan en la actividad.
6. **Marshalls**: un dock marshall hace el check-in de cada camión antes de que atraque y un yard marshall coloca y da la salida a las furgonetas durante las oleadas. Sin ellos no se para nada, pero los camiones tardan más en atracar y descargan más despacio, y las furgonetas tardan en aparcar y salen más tarde. Se ven en el plano (verde en su puesto, rojo si faltan) y se pueden quitar para ver el efecto.
7. **Sigue los high value**: en el centro de control, la pestaña "High Values" lista los paquetes de valor alto del turno con dónde está cada uno ahora (camión, carro, saca, carro de pick, furgoneta...) y desde cuándo, y avisa si alguno está en problem solve, en una saca que no es la suya o se ha quedado sin su furgoneta. En el mapa llevan un marco dorado.
8. **Mira la pestaña "Plantilla"**: cada persona del turno con un ID y un nombre inventados, su equipo (noche, mañana o tarde), dónde está ahora, horas, paquetes, UPH, % del objetivo, comparación con la media de su proceso y missorts. Marca a los mejores y a quien necesita seguimiento, permite mover a alguien de proceso y se descarga en CSV.
9. **Al acabar se abre el informe** con lo que salió bien y lo que hay que mejorar, el coste del turno y por paquete, y compara la plantilla con la que se empezó con la mínima para ese volumen. Se puede descargar en CSV o guardar como PDF.
10. **Compara escenarios** (botón "Comparar" o desde el informe): elige escenario y plantilla (la del escenario o la mínima para el corte) en cada lado y la app juega los dos turnos enteros en segundo plano. Sale una tabla con fin del sort, rutas a tiempo, rollover, horas-persona, productividad, DPMO y coste, y una frase con la conclusión ("B cuesta 596 € más que A: saca a tiempo 16 rutas más..."). El coste por hora es un valor de ejemplo que se cambia ahí mismo.

![Informe de fin de turno con falta de personal](docs/informe.jpg)

**Modo presentación** (tecla <kbd>P</kbd>, o "Pantalla completa" al final del tour): pantalla completa con el plano y los KPIs principales. La barra espaciadora pausa.

![Modo presentación durante el pico](docs/presentacion.jpg)

## Qué significa cada métrica

| Métrica | Qué mide |
| --- | --- |
| Fin previsto del sort | Hora a la que quedaría todo clasificado en sacas al ritmo de la plantilla actual. Simula minuto a minuto lo que queda: los camiones pendientes entran al ritmo de descarga desde que pasan el check-in y el proceso más lento (zona de carros, inducción o stow) va vaciando lo acumulado al ritmo medio real de cada uno, medido con la simulación. Si problem solve va atrasado, el sort no acaba hasta que vuelven sus paquetes. |
| Corte del sort | Hora límite para tener todo clasificado antes de empezar a cargar. |
| Rutas a tiempo | Furgonetas que salen dentro de la ventana de su oleada. |
| Rollover | Paquetes que siguen en la estación cuando su ruta ya ha salido: se quedan para el día siguiente. |
| UPH | Paquetes por hora y persona. En el panel es la última hora; en el informe, todo el turno entre las horas fichadas, así que las esperas también cuentan. |
| Horas trabajadas | Horas-persona de todo el turno. Quien está fichado cuenta desde que entra hasta su salida, aunque su proceso no tenga trabajo: el sort de noche, problem solve y el dock marshall hasta las 09:30 (tras el sort hacen rutas y buscan paquetes perdidos) y toda la tarde hasta las 21:00. El manager no cuenta. |
| Paq / h trabajada | Paquetes clasificados entre todas las horas-persona del turno. El descanso no cuenta como hora trabajada. |
| Coste del turno | Horas-persona de todo el turno (sort, pick y marshalls) por el coste de una hora. Por paquete, entre los paquetes recibidos. |
| Llenado de saca | Ocupación media de las sacas de las rutas que ya han salido. |
| Missort | Paquetes que acaban en una saca que no es la suya. Se detectan en pick y vuelven por problem solve. |
| DPMO | Defectos (dañados, sin etiqueta y missorts) por millón de paquetes recibidos. |
| Problem solve | Paquetes en revisión y su tiempo medio de resolución. Los dañados sin arreglo se dan de baja. |
| Plantilla mínima | Personas por proceso con las que el sort acaba 15 min antes del corte, salen todas las oleadas y problem solve no deja paquetes sin volver a su saca, más un dock marshall y un yard marshall. Se calcula con el mismo modelo de flujo que la previsión, con el ritmo del equipo habitual. |
| vs equipo | UPH de una persona frente a la media de las demás de su proceso en el mismo turno. Como la UPH es por hora fichada, las esperas bajan a todo el equipo; compararse con el equipo aísla el ritmo de cada uno. Por debajo del 90% sale como aviso, desde el 108% como top. |
| Tiempo de ciclo | Minutos medios de cada tramo: muelle → inducción → saca → pick → salida. |

![Planificador de plantilla](docs/planificador.jpg)

![Pestaña de plantilla](docs/plantilla.jpg)

## Importar una noche concreta

"Importar CSV" carga camiones, volumen por ruta, hora de corte y oleadas desde un archivo como [`ejemplo-turno.csv`](ejemplo-turno.csv):

```
tipo;id;hora;paquetes
camion;T-01;01:00;700
ruta;R01;;420
corte;;06:00;
oleada;A;06:20;
```

El archivo **se lee en el navegador y no se sube a ningún sitio**. El `.gitignore` deja fuera cualquier otro CSV para que no acabe en el repositorio por error.

## Datos

La estación es genérica. Muelles, pasillos, rutas, horarios, ritmos y volúmenes son cifras inventadas o redondeadas, y se ajustan en [`layout.js`](layout.js). Las personas de la plantilla, sus IDs y sus nombres también son inventados. No contiene datos internos de ninguna empresa.

## Stack

JavaScript sin dependencias y Canvas. Sin build: es una página estática.

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Estructura de la página y controles |
| `ds-flow.css` | Estilos, tema claro y oscuro, modo presentación e impresión del informe |
| `layout.js` | Geometría de la estación, objetivos de UPH, calidad y plan del turno |
| `engine.js` | Motor de la simulación y métricas, sin DOM (se prueba en Node) |
| `crew.js` | Plantilla con nombre: personas, habilidades, quién trabaja en cada proceso y sus métricas |
| `crewui.js` | Pestaña de plantilla |
| `scenarios.js` | Escenarios de la demo, cada uno con su semilla |
| `report.js` | Informe de fin de turno y exportación a CSV |
| `compare.js` | Comparación de dos turnos enteros con su coste |
| `tour.js` | Tour guiado del botón "Presentar" |
| `importcsv.js` | Lectura del CSV de una noche |
| `render.js` | Dibujo del plano en Canvas |
| `charts.js` | Gráficas pequeñas (plan frente a real, ritmo por hora) |
| `ui.js` | Centro de control, planificador, high values, controles y bucle de animación |
| `whatif-worker.js` | Simula turnos en segundo plano: el resto del turno para el planificador y los turnos enteros de la comparación |
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

Comprueban que no se pierde ningún paquete, que la misma semilla da la misma partida, que el turno se completa, que la previsión se acerca a la hora real, que la estimación del planificador se acerca a la simulación completa, que simular el resto del turno repite la partida exacta, el efecto de los marshalls, el descanso, las horas de apoyo de la noche, la carga de la tarde que se queda en la playa, la comparación de escenarios, los high value, las incidencias, los escenarios y la importación del CSV. Se ejecutan en cada PR con GitHub Actions.

## Despliegue

GitHub Pages desde la rama `main` (carpeta raíz).
