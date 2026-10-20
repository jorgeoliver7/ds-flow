# Modelo de IA del mapa de reparto

Generado con `python3 mapa/tools/entrenar_modelo.py`.

## Qué hace

El motor de reparto (`mapa/reparto.js`) juega un día rutas por rutas, y cada día sale distinto: la tormenta cae más en una comarca que en otra y la inundación corta unos tramos u otros. Para saber qué esperar con unas condiciones hay que jugar muchos días. El modelo aprende de 12.000 días simulados (1.116.000 filas de zona y día) y predice al instante, para cada una de las zonas:

- la **tasa de entrega esperada**,
- la tasa de entrega en un **día malo** (percentil 10: nueve de cada diez días salen mejor),
- la tasa de **entregas fallidas**.

Son tres modelos de gradient boosting con árboles por zona, más uno por familia de rutas para el día malo (scikit-learn, `HistGradientBoostingRegressor`), exportados a JSON y evaluados en el navegador por `mapa/modelo.js`, sin dependencias. Las filas pesan por paquetes, así que el error está medido por paquete.

## Qué tal predice

Con días que el modelo no ha visto (el 20% de los días, separados por día, no por fila):

| Qué | Gradient boosting | Regresión lineal | Media |
| --- | ---: | ---: | ---: |
| Error medio por zona y día (tasa de entrega) | 4,0 puntos | 5,9 puntos | 13,6 puntos |
| R² por zona y día | 0,818 | 0,728 | 0 |
| Error medio por familia de rutas y día | 1,9 puntos | 4,1 puntos | |

Un día concreto lleva su azar (qué tramos se cortan, cómo rinde cada conductor), así que parte de ese error no se puede predecir. Contra la **media de 30 días jugados con las mismas condiciones** (60 condiciones distintas), que es lo que el modelo intenta estimar, el error medio por zona baja a **1,7 puntos**.

El percentil 10 de cada zona queda por encima del resultado real en el 11% de esos días (lo ideal es el 10%). El día malo de una familia de rutas no es la suma de los días malos de sus zonas, porque no caen todos a la vez: lo da un cuarto modelo, entrenado con una fila por familia y día, que queda por encima del resultado real en el 17% de los días.

Entregas fallidas: error medio de 0,4 puntos, R² 0,731.

## Qué pesa más

Cuánto empeora el error si se baraja cada rasgo (permutation importance), en puntos de tasa de entrega:

| Rasgo | Peso |
| --- | ---: |
| Huelga | 6,21 |
| Volumen | 5,53 |
| Retraso de salida | 1,82 |
| Lluvia | 1,30 |
| Flash flood | 1,29 |
| Refuerzo de furgonetas | 0,97 |
| Riesgo de inundación de la zona | 0,40 |
| Densidad de población | 0,26 |
| Longitud | 0,17 |
| Población | 0,17 |
| Km desde la estación | 0,17 |
| Minutos desde la estación | 0,11 |
| Latitud | 0,10 |
| Rutas EQX1 o DQX1 | 0,09 |
| Tramos inundables en el camino | 0,09 |
| Superficie de la zona | 0,07 |
| Lluvia habitual de la zona | 0,07 |
| Dirección desde la estación | 0,03 |

En el mapa, la explicación de cada escenario se calcula con valores de Shapley sobre las seis condiciones del día: cuánto aporta cada una (lluvia, flash flood, huelga...) a la diferencia con un día normal.

## Límites

- El modelo aprende del motor, no de datos reales de reparto: es tan bueno como el motor. Su papel es dar la respuesta al instante y con su incertidumbre.
- Fuera del rango entrenado (volumen de 0,5 a 1,8, huelga hasta el 60%, retraso hasta 2 horas) no hay garantías.
