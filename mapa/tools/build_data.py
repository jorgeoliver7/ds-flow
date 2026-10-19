"""Construye la base geográfica del mapa de reparto de Cádiz.

Une los códigos postales de la provincia con la población del INE, las dos
estación ficticia con sus dos familias de rutas (DQX1 y EQX1) y una red de
carreteras esquemática, y
escribe mapa/data/cadiz-base.json, mapa/data/RESUMEN.md y docs/mapa-base.png.

    python3 -m pip install shapely matplotlib
    python3 mapa/tools/build_data.py

Las fuentes se descargan una vez en mapa/tools/.cache (no se sube al repo).
"""

import csv
import heapq
import json
import math
import os
import subprocess
import sys
import tarfile
import urllib.request
from collections import defaultdict

from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping, shape
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, ".cache")
OUT_JSON = os.path.join(ROOT, "mapa", "data", "cadiz-base.json")
OUT_MD = os.path.join(ROOT, "mapa", "data", "RESUMEN.md")
OUT_PNG = os.path.join(ROOT, "docs", "mapa-base.png")

SOURCES = {
    "cp": "https://raw.githubusercontent.com/inigoflores/ds-codigos-postales/master/data/CADIZ.geojson",
    "atlas": "https://registry.npmjs.org/es-atlas/-/es-atlas-0.6.0.tgz",
    "countries": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson",
}

# Una sola estación (la de DS Flow) que reparte dos familias de rutas:
# DQX1 (Bahía, Jerez, Costa Noroeste y La Janda) y EQX1 (Campo de Gibraltar y
# Sierra). Ubicación ficticia en un polígono junto a la A-4.
ESTACION = {"id": "Estación", "nombre": "Estación DS Flow", "lat": 36.655, "lon": -6.105}
RUTAS = {
    "DQX1": "Bahía de Cádiz, Jerez, Costa Noroeste y La Janda",
    "EQX1": "Campo de Gibraltar y Sierra de Cádiz",
}

# Pueblos de fuera de la provincia por los que pasa la ruta más corta a la Sierra.
NODOS_DE_PASO = {"Ronda (Málaga)": (-5.164, 36.742)}

BBOX = box(-6.55, 35.85, -5.0, 37.1)

# Red esquemática: rodeo frente a la línea recta y velocidad media de una furgoneta.
VIAS = {
    "autovia": {"rodeo": 1.15, "kmh": 100},
    "nacional": {"rodeo": 1.25, "kmh": 70},
    "comarcal": {"rodeo": 1.30, "kmh": 60},
    "sierra": {"rodeo": 1.60, "kmh": 45},
}
# Del centro del pueblo a la zona: los primeros km por calles y el resto por
# carreteras locales.
ULTIMA_MILLA = {"rodeo": 1.35, "km_urbanos": 3, "kmh_urbano": 25, "kmh_local": 55}

SIMPLIFICAR = 0.0012  # grados, unos 120 m


def descargar(nombre):
    os.makedirs(CACHE, exist_ok=True)
    url = SOURCES[nombre]
    ruta = os.path.join(CACHE, os.path.basename(url))
    if not os.path.exists(ruta):
        print("descargando", url)
        urllib.request.urlretrieve(url, ruta)
    return ruta


def leer_atlas():
    ruta = descargar("atlas")
    with tarfile.open(ruta) as tar:
        muni = json.load(tar.extractfile("package/es/municipalities.json"))
    return muni


def topo_a_shapes(topo, objeto):
    """Decodifica un objeto TopoJSON (arcos cuantizados) en geometrías de shapely."""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcos = []
    for arco in topo["arcs"]:
        x = y = 0
        puntos = []
        for dx, dy in arco:
            x += dx
            y += dy
            puntos.append((x * sx + tx, y * sy + ty))
        arcos.append(puntos)

    def anillo(indices):
        puntos = []
        for i in indices:
            tramo = arcos[i] if i >= 0 else arcos[~i][::-1]
            puntos.extend(tramo if not puntos else tramo[1:])
        return puntos

    def poligono(anillos):
        # La cuantización deja algunos huecos degenerados de menos de 4 puntos.
        exterior = anillo(anillos[0])
        if len(exterior) < 4:
            return None
        huecos = [h for h in (anillo(a) for a in anillos[1:]) if len(h) >= 4]
        return Polygon(exterior, huecos)

    salida = {}
    for g in topo["objects"][objeto]["geometries"]:
        if g["type"] == "Polygon":
            geom = poligono(g["arcs"])
        elif g["type"] == "MultiPolygon":
            geom = MultiPolygon([p for p in (poligono(a) for a in g["arcs"]) if p is not None])
        else:
            continue
        if geom is None:
            continue
        salida[str(g["id"])] = {"geom": geom.buffer(0), "nombre": g.get("properties", {}).get("name")}
    return salida


def km(a, b):
    """Distancia en km entre dos puntos (lon, lat)."""
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def area_km2(geom):
    lat = geom.centroid.y
    return geom.area * 111.32 * 111.32 * math.cos(math.radians(lat))


def redondear(geom, dec=4):
    def anillo(coords):
        return [[round(x, dec), round(y, dec)] for x, y in coords]

    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    return [[anillo(p.exterior.coords)] + [anillo(i.coords) for i in p.interiors] for p in polys if not p.is_empty]


def leer_csv(nombre):
    with open(os.path.join(HERE, nombre), encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter=";"))


def construir_zonas(municipios, atlas):
    cp = json.load(open(descargar("cp"), encoding="utf-8"))
    partes = defaultdict(list)
    for f in cp["features"]:
        p = f["properties"]
        partes[(p["COD_POSTAL"], str(p["CODIGO_INE"]))].append(shape(f["geometry"]).buffer(0))

    zonas = []
    for (codigo, ine), geoms in partes.items():
        geom = unary_union(geoms)
        zonas.append({"cp": codigo, "ine": ine, "geom": geom})

    # El dataset de códigos postales es anterior a la segregación de
    # San Martín del Tesorillo (2018): sus zonas salen como Jimena.
    tesorillo = atlas["11903"]["geom"]
    for z in zonas:
        if z["ine"] == "11021" and tesorillo.contains(z["geom"].representative_point()):
            z["ine"] = "11903"

    faltan = set(municipios) - {z["ine"] for z in zonas}
    if faltan:
        sys.exit(f"municipios sin zonas: {faltan}")

    # Población por zona: la del municipio repartida entre sus códigos postales,
    # con más peso a las zonas pequeñas (casco urbano) que a las grandes (campo).
    por_muni = defaultdict(list)
    for z in zonas:
        z["area_km2"] = area_km2(z["geom"])
        por_muni[z["ine"]].append(z)
    for ine, lista in por_muni.items():
        pesos = [max(z["area_km2"], 0.3) ** -0.6 for z in lista]
        total = sum(pesos)
        pob = int(municipios[ine]["poblacion_2021"])
        for z, w in zip(lista, pesos):
            z["poblacion"] = round(pob * w / total)
    return zonas


def red_carreteras(municipios):
    nodos = {m["municipio"]: (float(m["lon"]), float(m["lat"])) for m in municipios.values()}
    nodos.update(NODOS_DE_PASO)
    nodos[ESTACION["id"]] = (ESTACION["lon"], ESTACION["lat"])
    tramos = []
    vecinos = defaultdict(list)
    for t in leer_csv("carreteras.csv"):
        a, b = t["desde"], t["hasta"]
        if a not in nodos or b not in nodos:
            sys.exit(f"tramo con nodo desconocido: {a} - {b}")
        via = VIAS[t["tipo"]]
        dist = km(nodos[a], nodos[b]) * via["rodeo"]
        minutos = dist / via["kmh"] * 60
        tramo = {
            "id": len(tramos),
            "desde": a,
            "hasta": b,
            "via": t["via"],
            "tipo": t["tipo"],
            "km": round(dist, 1),
            "min": round(minutos, 1),
            "inundable": t["inundable"] == "1",
            "nota": t["nota"],
            "coords": [[round(c, 4) for c in nodos[a]], [round(c, 4) for c in nodos[b]]],
        }
        tramos.append(tramo)
        vecinos[a].append((b, tramo))
        vecinos[b].append((a, tramo))
    return nodos, tramos, vecinos


def dijkstra(origen, vecinos):
    mejor = {origen: (0.0, 0.0, [])}
    cola = [(0.0, origen)]
    while cola:
        t, n = heapq.heappop(cola)
        if t > mejor[n][0]:
            continue
        for m, tramo in vecinos[n]:
            nt = t + tramo["min"]
            if m not in mejor or nt < mejor[m][0]:
                mejor[m] = (nt, mejor[n][1] + tramo["km"], mejor[n][2] + [tramo["id"]])
                heapq.heappush(cola, (nt, m))
    return mejor


def contexto(atlas):
    """Siluetas alrededor de la provincia para que el mapa no flote en el vacío."""
    vecinos = {}
    for prov, nombre in (("41", "Sevilla"), ("29", "Málaga"), ("21", "Huelva")):
        geoms = [v["geom"] for k, v in atlas.items() if k.startswith(prov) and len(k) == 5]
        g = unary_union(geoms).intersection(BBOX).simplify(0.004)
        if not g.is_empty:
            vecinos[nombre] = g
    paises = json.load(open(descargar("countries"), encoding="utf-8"))
    for f in paises["features"]:
        nombre = f["properties"]["NAME"]
        if nombre in ("Morocco", "Gibraltar"):
            g = shape(f["geometry"]).buffer(0).intersection(BBOX)
            if not g.is_empty:
                vecinos["Marruecos" if nombre == "Morocco" else "Gibraltar"] = g.simplify(0.002 if nombre == "Morocco" else 0.0002)
    return vecinos


def clase(densidad):
    if densidad >= 1500:
        return "urbana"
    if densidad >= 150:
        return "periurbana"
    return "rural"


def main():
    municipios = {m["ine"]: m for m in leer_csv("municipios.csv")}
    atlas = topo_a_shapes(leer_atlas(), "municipalities")
    zonas = construir_zonas(municipios, atlas)
    nodos, tramos, vecinos = red_carreteras(municipios)
    desde_estacion = dijkstra(ESTACION["id"], vecinos)

    salida_zonas = []
    for z in sorted(zonas, key=lambda z: (z["ine"], z["cp"])):
        m = municipios[z["ine"]]
        pueblo = nodos[m["municipio"]]
        centro = z["geom"].representative_point()
        local_km = km(pueblo, (centro.x, centro.y)) * ULTIMA_MILLA["rodeo"]
        urbanos = min(local_km, ULTIMA_MILLA["km_urbanos"])
        local_min = (urbanos / ULTIMA_MILLA["kmh_urbano"] + (local_km - urbanos) / ULTIMA_MILLA["kmh_local"]) * 60
        t, d, camino = desde_estacion[m["municipio"]]
        acceso = {"km": round(d + local_km, 1), "min": round(t + local_min), "tramos": camino}
        densidad = z["poblacion"] / max(z["area_km2"], 0.01)
        salida_zonas.append({
            "id": f'{z["cp"]}-{z["ine"]}',
            "cp": z["cp"],
            "ine": z["ine"],
            "municipio": m["municipio"],
            "comarca": m["comarca"],
            "rutas": m["rutas"],
            "poblacion": z["poblacion"],
            "area_km2": round(z["area_km2"], 2),
            "densidad": round(densidad),
            "clase": clase(densidad),
            "riesgo_inundacion": int(m["riesgo_inundacion"]),
            "lluvia_relativa": float(m["lluvia_relativa"]),
            "centro": [round(centro.x, 4), round(centro.y, 4)],
            "acceso": acceso,
            "geometria": redondear(z["geom"].simplify(SIMPLIFICAR, preserve_topology=True)),
        })

    provincia = unary_union([v["geom"] for k, v in atlas.items() if k.startswith("11") and len(k) == 5])
    base = {
        "meta": {
            "descripcion": "Base geográfica del mapa de reparto de Cádiz (DS Flow). Población real; estación y red de carreteras esquemáticas.",
            "fuentes": {
                "codigos_postales": SOURCES["cp"],
                "poblacion": "INE, Censo de Población 2021, por municipio",
                "municipios_y_provincias": "es-atlas 0.6.0 (IGN)",
                "paises": "Natural Earth 10m",
            },
            "bbox": list(BBOX.bounds),
        },
        "estacion": ESTACION,
        "rutas": [{"id": k, "zona": v} for k, v in RUTAS.items()],
        "municipios": [
            {
                "ine": m["ine"],
                "nombre": m["municipio"],
                "comarca": m["comarca"],
                "rutas": m["rutas"],
                "poblacion": int(m["poblacion_2021"]),
                "pueblo": [float(m["lon"]), float(m["lat"])],
            }
            for m in sorted(municipios.values(), key=lambda m: m["municipio"])
        ],
        "zonas": salida_zonas,
        "carreteras": tramos,
        "provincia": redondear(provincia.simplify(0.002, preserve_topology=True)),
        "contexto": {k: redondear(v) for k, v in contexto(atlas).items()},
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(base, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{OUT_JSON}: {os.path.getsize(OUT_JSON) / 1024:.0f} KB, {len(salida_zonas)} zonas, {len(tramos)} tramos")

    resumen(base)
    preview(base)


def miles(n):
    return f"{n:,.0f}".replace(",", ".")


def resumen(base):
    zonas = base["zonas"]
    tramos = {t["id"]: t for t in base["carreteras"]}
    lineas = [
        "# Base geográfica del mapa de Cádiz",
        "",
        "Generado con `python3 mapa/tools/build_data.py`. Lo que sigue sale de [`cadiz-base.json`](cadiz-base.json).",
        "",
        "Una sola estación reparte las dos familias de rutas. Los minutos son lo que tarda una furgoneta en llegar desde la estación a cada zona, ponderados por población.",
        "",
        "## Por familia de rutas",
        "",
        "| Rutas | Municipios | Zonas | Población | Rurales | Población en riesgo alto de inundación | Minutos medios hasta la zona | Zona más lejana |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for r in RUTAS:
        zs = [z for z in zonas if z["rutas"] == r]
        pob = sum(z["poblacion"] for z in zs)
        riesgo = sum(z["poblacion"] for z in zs if z["riesgo_inundacion"] == 3)
        media = sum(z["acceso"]["min"] * z["poblacion"] for z in zs) / pob
        lejana = max(zs, key=lambda z: z["acceso"]["min"])
        lineas.append(
            f'| {r} | {len({z["ine"] for z in zs})} | {len(zs)} | {miles(pob)} | {sum(z["clase"] == "rural" for z in zs)} '
            f'| {miles(riesgo)} ({riesgo / pob:.0%}) | {media:.0f} | {lejana["municipio"]} ({lejana["cp"]}), {lejana["acceso"]["min"]} min |'
        )

    lineas += ["", "## Por comarca", "", "| Comarca | Rutas | Población | Km medios desde la estación | Minutos medios desde la estación |", "| --- | --- | ---: | ---: | ---: |"]
    comarcas = defaultdict(list)
    for z in zonas:
        comarcas[(z["comarca"], z["rutas"])].append(z)
    for (comarca, r), zs in sorted(comarcas.items(), key=lambda kv: -sum(z["poblacion"] for z in kv[1])):
        pob = sum(z["poblacion"] for z in zs)
        km_medios = sum(z["acceso"]["km"] * z["poblacion"] for z in zs) / pob
        minutos = sum(z["acceso"]["min"] * z["poblacion"] for z in zs) / pob
        lineas.append(f"| {comarca} | {r} | {miles(pob)} | {km_medios:.0f} | {minutos:.0f} |")

    uso = defaultdict(int)
    for z in zonas:
        for t in z["acceso"]["tramos"]:
            uso[t] += z["poblacion"]
    criticos = sorted((t for t in uso if tramos[t]["inundable"]), key=lambda t: -uso[t])[:8]
    lineas += [
        "",
        "## Tramos inundables más críticos",
        "",
        "Población que depende de cada tramo para recibir sus paquetes desde la estación.",
        "",
        "| Tramo | Vía | Motivo | Población que pasa por él |",
        "| --- | --- | --- | ---: |",
    ]
    for t in criticos:
        tr = tramos[t]
        lineas.append(f'| {tr["desde"]} – {tr["hasta"]} | {tr["via"]} | {tr["nota"]} | {miles(uso[t])} |')

    lineas += [
        "",
        "## Cómo se ha construido",
        "",
        f"- **Zonas**: cada código postal dentro de su municipio ({len(zonas)} zonas). San Martín del Tesorillo se separa de Jimena con el contorno del IGN, porque el dataset de códigos postales es anterior a 2018.",
        "- **Población**: la del municipio en el Censo 2021 del INE, repartida entre sus códigos postales con más peso a los pequeños (cascos urbanos) que a los grandes (campo). Es una estimación: el INE no publica población por código postal.",
        "- **Estación y rutas**: una sola estación ficticia junto a la A-4, entre Jerez y El Puerto, que reparte dos familias de rutas: DQX1 (Bahía, Jerez, Costa Noroeste y La Janda) y EQX1 (Campo de Gibraltar y Sierra). Los nombres son inventados.",
        "- **Carreteras**: red esquemática entre pueblos (`carreteras.csv`), con rodeo y velocidad media por tipo de vía. Los tiempos son de una furgoneta sin tráfico ni paradas.",
        "- **Riesgo de inundación y lluvia** (`municipios.csv`): valores ilustrativos inspirados en ríos y episodios conocidos (Guadalete, Iro, Barbate, La Janda, Guadiaro, Palmones, Grazalema). No es cartografía oficial.",
        "",
    ]
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lineas))
    print("\n".join(lineas))


def preview(base):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PatchCollection
    from matplotlib.patches import Polygon as MplPolygon

    fig, ax = plt.subplots(figsize=(11, 9), dpi=110)
    fig.patch.set_facecolor("#0e1116")
    ax.set_facecolor("#0e1116")

    def dibujar(polys, **kw):
        patches = [MplPolygon(p[0], closed=True) for p in polys]
        ax.add_collection(PatchCollection(patches, **kw))

    for g in base["contexto"].values():
        dibujar(g, facecolor="#232a33", edgecolor="#3a4450", linewidth=0.5)
    colores = {"DQX1": matplotlib.colormaps["Oranges"], "EQX1": matplotlib.colormaps["Blues"]}
    for z in base["zonas"]:
        nivel = min(1.0, math.log10(max(z["densidad"], 1)) / 4)
        dibujar(z["geometria"], facecolor=colores[z["rutas"]](0.25 + 0.7 * nivel), edgecolor="#0e1116", linewidth=0.3)
    for t in base["carreteras"]:
        (x1, y1), (x2, y2) = t["coords"]
        ax.plot([x1, x2], [y1, y2], color="#e5484d" if t["inundable"] else "#d8dee9", linewidth=1.1 if t["tipo"] == "autovia" else 0.6, alpha=0.8, zorder=3)
    e = base["estacion"]
    ax.scatter([e["lon"]], [e["lat"]], s=140, marker="s", color="white", edgecolor="black", zorder=5)
    ax.annotate("Estación", (e["lon"], e["lat"]), xytext=(8, -4), textcoords="offset points", color="white", fontsize=11, weight="bold", zorder=6)
    for m in base["municipios"]:
        if m["poblacion"] > 40000:
            ax.annotate(m["nombre"], m["pueblo"], xytext=(4, 4), textcoords="offset points", color="#c9d1d9", fontsize=7, zorder=6)

    ax.set_xlim(-6.5, -5.05)
    ax.set_ylim(35.88, 37.05)
    ax.set_aspect(1 / math.cos(math.radians(36.5)))
    ax.axis("off")
    ax.set_title("Cádiz · zonas de reparto por densidad (naranja rutas DQX1, azul rutas EQX1) · tramos inundables en rojo", color="#c9d1d9", fontsize=10)
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    fig.savefig(OUT_PNG, bbox_inches="tight", facecolor=fig.get_facecolor())
    print("preview:", OUT_PNG)


if __name__ == "__main__":
    main()
