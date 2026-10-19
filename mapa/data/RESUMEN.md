# Base geográfica del mapa de Cádiz

Generado con `python3 mapa/tools/build_data.py`. Lo que sigue sale de [`cadiz-base.json`](cadiz-base.json).

Una sola estación reparte las dos familias de rutas. Los minutos son lo que tarda una furgoneta en llegar desde la estación a cada zona, ponderados por población.

## Por familia de rutas

| Rutas | Municipios | Zonas | Población | Rurales | Población en riesgo alto de inundación | Minutos medios hasta la zona | Zona más lejana |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| DQX1 | 18 | 67 | 858.487 | 25 | 116.313 (14%) | 28 | Jerez de la Frontera (11400), 84 min |
| EQX1 | 27 | 59 | 391.388 | 35 | 82.838 (21%) | 75 | Tarifa (11392), 125 min |

## Por comarca

| Comarca | Rutas | Población | Km medios desde la estación | Minutos medios desde la estación |
| --- | --- | ---: | ---: | ---: |
| Bahía de Cádiz | DQX1 | 426.702 | 31 | 25 |
| Campo de Gibraltar | EQX1 | 275.569 | 121 | 79 |
| Campiña de Jerez | DQX1 | 218.052 | 16 | 18 |
| Costa Noroeste | DQX1 | 125.466 | 41 | 43 |
| Sierra de Cádiz | EQX1 | 115.819 | 79 | 65 |
| La Janda | DQX1 | 88.267 | 69 | 51 |

## Tramos inundables más críticos

Población que depende de cada tramo para recibir sus paquetes desde la estación.

| Tramo | Vía | Motivo | Población que pasa por él |
| --- | --- | --- | ---: |
| Medina Sidonia – Jerez de la Frontera | A-381 | cruce del Guadalete | 286.861 |
| San Fernando – Chiclana de la Frontera | A-48 | río Iro | 163.425 |
| Algeciras – Los Barrios | A-7 | río Palmones | 123.433 |
| Estación – El Puerto de Santa María | A-4 | cruce del Guadalete | 118.508 |
| Jerez de la Frontera – Arcos de la Frontera | A-382 | cruce del Guadalete | 115.819 |
| Los Barrios – San Roque | A-7 | río Guadarranque | 102.760 |
| Arcos de la Frontera – Bornos | A-384 | río Guadalete | 57.689 |
| Bornos – Villamartín | A-384 | río Guadalete | 50.031 |

## Cómo se ha construido

- **Zonas**: cada código postal dentro de su municipio (126 zonas). San Martín del Tesorillo se separa de Jimena con el contorno del IGN, porque el dataset de códigos postales es anterior a 2018.
- **Población**: la del municipio en el Censo 2021 del INE, repartida entre sus códigos postales con más peso a los pequeños (cascos urbanos) que a los grandes (campo). Es una estimación: el INE no publica población por código postal.
- **Estación y rutas**: una sola estación ficticia junto a la A-4, entre Jerez y El Puerto, que reparte dos familias de rutas: DQX1 (Bahía, Jerez, Costa Noroeste y La Janda) y EQX1 (Campo de Gibraltar y Sierra). Los nombres son inventados.
- **Carreteras**: red esquemática entre pueblos (`carreteras.csv`), con rodeo y velocidad media por tipo de vía. Los tiempos son de una furgoneta sin tráfico ni paradas.
- **Riesgo de inundación y lluvia** (`municipios.csv`): valores ilustrativos inspirados en ríos y episodios conocidos (Guadalete, Iro, Barbate, La Janda, Guadiaro, Palmones, Grazalema). No es cartografía oficial.
