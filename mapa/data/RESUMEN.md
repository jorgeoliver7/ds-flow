# Base geográfica del mapa de Cádiz

Generado con `python3 mapa/tools/build_data.py`. Lo que sigue sale de [`cadiz-base.json`](cadiz-base.json).

## Por estación

| Estación | Municipios | Zonas | Población | Rurales | Población en riesgo alto de inundación | Minutos medios a la zona | Zona más lejana |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| DQX1 | 18 | 67 | 858.487 | 25 | 116.313 (14%) | 30 | Jerez de la Frontera (11400), 84 min |
| EQX1 | 27 | 59 | 391.388 | 35 | 82.838 (21%) | 49 | El Gastor (11688), 166 min |

## Por comarca

| Comarca | Estación | Población | Minutos medios desde su estación | Minutos medios desde la otra |
| --- | --- | ---: | ---: | ---: |
| Bahía de Cádiz | DQX1 | 426.702 | 26 | 89 |
| Campo de Gibraltar | EQX1 | 275.569 | 16 | 88 |
| Campiña de Jerez | DQX1 | 218.052 | 18 | 84 |
| Costa Noroeste | DQX1 | 125.466 | 43 | 111 |
| Sierra de Cádiz | EQX1 | 115.819 | 126 | 67 |
| La Janda | DQX1 | 88.267 | 55 | 77 |

## Tramos inundables más críticos

Población que depende de cada tramo para recibir sus paquetes desde su estación.

| Tramo | Vía | Motivo | Población que pasa por él |
| --- | --- | --- | ---: |
| San Fernando – Chiclana de la Frontera | A-48 | río Iro | 144.959 |
| Los Barrios – EQX1 | A-7 | río Palmones | 132.238 |
| DQX1 – El Puerto de Santa María | A-4 | cruce del Guadalete | 118.508 |
| EQX1 – San Roque | A-7 | río Guadarranque | 117.251 |
| Medina Sidonia – Jerez de la Frontera | A-381 | cruce del Guadalete | 108.788 |
| Jerez de la Frontera – Arcos de la Frontera | A-382 | cruce del Guadalete | 79.030 |
| Arcos de la Frontera – Bornos | A-384 | río Guadalete | 44.255 |
| Bornos – Villamartín | A-384 | río Guadalete | 36.597 |

## Cómo se ha construido

- **Zonas**: cada código postal dentro de su municipio (126 zonas). San Martín del Tesorillo se separa de Jimena con el contorno del IGN, porque el dataset de códigos postales es anterior a 2018.
- **Población**: la del municipio en el Censo 2021 del INE, repartida entre sus códigos postales con más peso a los pequeños (cascos urbanos) que a los grandes (campo). Es una estimación: el INE no publica población por código postal.
- **Estaciones**: DQX1 y EQX1 son ficticias, con ubicaciones plausibles junto a las autovías. Las comarcas de Costa Noroeste y La Janda se asignan a DQX1 por cercanía.
- **Carreteras**: red esquemática entre pueblos (`carreteras.csv`), con rodeo y velocidad media por tipo de vía. Los tiempos son de una furgoneta sin tráfico ni paradas.
- **Riesgo de inundación y lluvia** (`municipios.csv`): valores ilustrativos inspirados en ríos y episodios conocidos (Guadalete, Iro, Barbate, La Janda, Guadiaro, Palmones, Grazalema). No es cartografía oficial.
