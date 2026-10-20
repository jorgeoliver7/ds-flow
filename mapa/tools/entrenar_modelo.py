"""Entrena el modelo de IA del mapa de reparto y lo exporta para el navegador.

El modelo aprende del motor de reparto (mapa/reparto.js): con miles de días
simulados, predice al instante para cada zona la tasa de entrega esperada, su
escenario malo (percentil 10) y la tasa de entregas fallidas, sin tener que
jugar cientos de días en el navegador. Es un modelo sustituto (surrogate) de
gradient boosting con árboles.

    node mapa/tools/generar_simulaciones.js                       # datos de entrenamiento
    node mapa/tools/generar_simulaciones.js 60 mapa/tools/.cache/montecarlo.csv 30
    python3 -m pip install pandas scikit-learn
    python3 mapa/tools/entrenar_modelo.py

Escribe mapa/data/modelo.json (árboles) y mapa/data/MODELO.md (evaluación).
"""

import json
import os
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATOS = os.path.join(HERE, ".cache", "simulaciones.csv")
MONTECARLO = os.path.join(HERE, ".cache", "montecarlo.csv")
OUT_JSON = os.path.join(ROOT, "mapa", "data", "modelo.json")
OUT_MD = os.path.join(ROOT, "mapa", "data", "MODELO.md")

RASGOS_ZONA = ["acceso_min", "acceso_km", "log_densidad", "log_area", "poblacion_k", "riesgo", "lluvia_rel", "tramos_inundables", "eqx1", "angulo", "lon", "lat"]
RASGOS_DIA = ["volumen", "lluvia", "inundacion", "huelga", "refuerzo", "retraso"]
RASGOS = RASGOS_ZONA + RASGOS_DIA
# El día malo de una familia de rutas no es la suma de los días malos de sus zonas
# (no caen todos a la vez): se aprende aparte, con una fila por familia y día, como
# lo que queda por debajo de la entrega esperada (la de las zonas) en un día malo.
RASGOS_FAMILIA = RASGOS_DIA + ["eqx1", "total"]

# Qué predice cada modelo
MODELOS = {
    "entrega": {"objetivo": "tasa_entrega", "loss": "squared_error", "texto": "Tasa de entrega esperada"},
    "entrega_p10": {"objetivo": "tasa_entrega", "loss": "quantile", "quantile": 0.1, "texto": "Tasa de entrega en un día malo (percentil 10)"},
    "fallidos": {"objetivo": "tasa_fallidos", "loss": "squared_error", "texto": "Tasa de entregas fallidas esperada"},
}
PARAMS = {"learning_rate": 0.1, "min_samples_leaf": 40, "l2_regularization": 1.0, "random_state": 7}
# El de la tasa de entrega es el que se ve en el mapa: más árboles y más hojas
TAMANO = {"entrega": {"max_iter": 250, "max_leaf_nodes": 31}, "entrega_p10": {"max_iter": 200, "max_leaf_nodes": 23}, "fallidos": {"max_iter": 150, "max_leaf_nodes": 15}}


def pesos(df):
    """Cada fila pesa por sus paquetes, y las dos familias de rutas pesan lo mismo
    en total: si no, la Sierra (EQX1, un 11% de los paquetes) apenas contaría y el
    modelo la aprendería peor."""
    paq = df["paquetes"].to_numpy(dtype=float)
    eqx1 = df["eqx1"].to_numpy() == 1
    w = paq.copy()
    w[eqx1] *= paq[~eqx1].sum() / max(paq[eqx1].sum(), 1)
    return w


def entrenar(df, nombre, cfg):
    extra = {"quantile": cfg["quantile"]} if cfg["loss"] == "quantile" else {}
    m = HistGradientBoostingRegressor(loss=cfg["loss"], **extra, **PARAMS, **TAMANO[nombre])
    m.fit(df[RASGOS].to_numpy(), df[cfg["objetivo"]].to_numpy(), sample_weight=pesos(df))
    return m


def familias_dia(df, por=("dia",)):
    """Tasa de entrega de cada familia (y del total) en cada día, por paquetes."""
    por = list(por)
    d = df.assign(ent=df["tasa_entrega"] * df["paquetes"], pe=df["pred"] * df["paquetes"])
    agg = {**{r: (r, "first") for r in RASGOS_DIA}, "ent": ("ent", "sum"), "pe": ("pe", "sum"), "paquetes": ("paquetes", "sum")}
    fam = d.groupby(por + ["eqx1"]).agg(**agg).reset_index().assign(total=0)
    tot = d.groupby(por).agg(**agg).reset_index().assign(eqx1=0, total=1)
    out = pd.concat([fam, tot], ignore_index=True)
    out = out.assign(tasa_entrega=out["ent"] / out["paquetes"], esperada=out["pe"] / out["paquetes"])
    return out.assign(margen=out["tasa_entrega"] - out["esperada"])


def entrenar_dia_malo(fd):
    m = HistGradientBoostingRegressor(loss="quantile", quantile=0.1, **PARAMS, max_iter=150, max_leaf_nodes=15)
    m.fit(fd[RASGOS_FAMILIA].to_numpy(), fd["margen"].to_numpy())
    return m


def exportar(m):
    """Cada árbol en preorden con tres arrays: f (rasgo, -1 en las hojas), t (umbral,
    o el valor en las hojas) y r (hijo derecho; el izquierdo es siempre el siguiente).
    En un nodo se va a la izquierda cuando x[f] <= t."""
    arboles = []
    for iteracion in m._predictors:
        nodos = iteracion[0].nodes
        f, t, r = [], [], []

        def visita(n):
            k = len(f)
            if nodos["is_leaf"][n]:
                f.append(-1); t.append(round(float(nodos["value"][n]), 6)); r.append(0)
                return
            f.append(int(nodos["feature_idx"][n])); t.append(float(f"{nodos['num_threshold'][n]:.9g}")); r.append(0)
            visita(int(nodos["left"][n]))
            r[k] = len(f)
            visita(int(nodos["right"][n]))

        visita(0)
        arboles.append({"f": f, "t": t, "r": r})
    return {"base": round(float(np.ravel(m._baseline_prediction)[0]), 6), "arboles": arboles}


def predecir_exportado(exp, X):
    salida = np.full(len(X), exp["base"])
    for a in exp["arboles"]:
        for i, x in enumerate(X):
            n = 0
            while a["f"][n] != -1:
                n = n + 1 if x[a["f"][n]] <= a["t"][n] else a["r"][n]
            salida[i] += a["t"][n]
    return salida


def mae(a, b, w=None):
    return float(np.average(np.abs(a - b), weights=w))


def r2(y, p, w):
    media = np.average(y, weights=w)
    return 1 - np.average((y - p) ** 2, weights=w) / np.average((y - media) ** 2, weights=w)


def main():
    t0 = time.time()
    df = pd.read_csv(DATOS)
    dias = df["dia"].unique()
    rng = np.random.default_rng(7)
    prueba = set(rng.choice(dias, size=len(dias) // 5, replace=False))
    es_prueba = df["dia"].isin(prueba)
    train, test = df[~es_prueba], df[es_prueba]
    print(f"{len(df):,} filas, {len(dias)} días ({len(prueba)} de prueba)")

    modelos, exportados = {}, {}
    for nombre, cfg in MODELOS.items():
        t = time.time()
        modelos[nombre] = entrenar(train, nombre, cfg)
        exportados[nombre] = exportar(modelos[nombre])
        print(f"  {nombre}: {len(exportados[nombre]['arboles'])} árboles en {time.time() - t:.0f} s")

    esperada = lambda d: d.assign(pred=np.clip(modelos["entrega"].predict(d[RASGOS].to_numpy()), 0, 1))
    fd_train, fd_test = familias_dia(esperada(train)), familias_dia(esperada(test))
    dia_malo = entrenar_dia_malo(fd_train)
    dia_malo_exp = exportar(dia_malo)
    print(f"  dia_malo: {len(dia_malo_exp['arboles'])} árboles")

    # El modelo exportado tiene que dar lo mismo que el de scikit-learn
    muestra = test.sample(300, random_state=1)[RASGOS].to_numpy()
    for nombre, m in modelos.items():
        dif = np.max(np.abs(predecir_exportado(exportados[nombre], muestra) - m.predict(muestra)))
        assert dif < 1e-4, f"{nombre}: la exportación no cuadra ({dif})"
    muestra = fd_test.sample(300, random_state=1)[RASGOS_FAMILIA].to_numpy()
    assert np.max(np.abs(predecir_exportado(dia_malo_exp, muestra) - dia_malo.predict(muestra))) < 1e-4, "dia_malo: la exportación no cuadra"

    w = test["paquetes"].to_numpy()
    y = test["tasa_entrega"].to_numpy()
    p = np.clip(modelos["entrega"].predict(test[RASGOS].to_numpy()), 0, 1)
    lineal = LinearRegression().fit(train[RASGOS], train["tasa_entrega"], sample_weight=train["paquetes"])
    pl = np.clip(lineal.predict(test[RASGOS]), 0, 1)
    media = np.full(len(test), np.average(train["tasa_entrega"], weights=train["paquetes"]))
    p10 = modelos["entrega_p10"].predict(test[RASGOS].to_numpy())
    yf, pf = test["tasa_fallidos"].to_numpy(), modelos["fallidos"].predict(test[RASGOS].to_numpy())

    # Por familia y día: lo que se ve en los KPIs del mapa
    agg = test.assign(pe=p * w, ye=y * w, pl=pl * w).groupby(["dia", "eqx1"])[["pe", "ye", "pl", "paquetes"]].sum()
    fam_mae = mae(agg["pe"] / agg["paquetes"], agg["ye"] / agg["paquetes"])
    fam_mae_lineal = mae(agg["pl"] / agg["paquetes"], agg["ye"] / agg["paquetes"])

    # Contra la media de 30 días jugados con las mismas condiciones (Monte Carlo)
    mc = pd.read_csv(MONTECARLO)
    mc_media = mc.groupby(["dia", "zona"]).agg(**{**{r: (r, "first") for r in RASGOS}, "y": ("tasa_entrega", "mean"), "paquetes": ("paquetes", "mean")}).reset_index()
    mc_p = np.clip(modelos["entrega"].predict(mc_media[RASGOS].to_numpy()), 0, 1)
    mc_mae = mae(mc_p, mc_media["y"].to_numpy(), mc_media["paquetes"].to_numpy())
    mc_p10 = mc.merge(mc_media[["dia", "zona"]].assign(p10=modelos["entrega_p10"].predict(mc_media[RASGOS].to_numpy())), on=["dia", "zona"])
    cobertura = float(np.average(mc_p10["tasa_entrega"] < mc_p10["p10"] - 1e-9, weights=mc_p10["paquetes"]))
    # día malo por familia: cada repetición del Monte Carlo es un día entero
    mc_fd = familias_dia(esperada(mc.assign(rep=mc.groupby(["dia", "zona"]).cumcount())), por=("dia", "rep"))
    mc_fd_p10 = mc_fd["esperada"].to_numpy() + dia_malo.predict(mc_fd[RASGOS_FAMILIA].to_numpy())
    cobertura_familia = float(np.mean(mc_fd["tasa_entrega"].to_numpy() < mc_fd_p10 - 1e-9))

    # Peso de cada rasgo: cuánto empeora el error al barajarlo (permutation importance)
    base_err = mae(p, y, w)
    importancia = {}
    rng = np.random.default_rng(3)
    for r in RASGOS:
        X = test[RASGOS].copy()
        X[r] = rng.permutation(X[r].to_numpy())
        importancia[r] = mae(np.clip(modelos["entrega"].predict(X.to_numpy()), 0, 1), y, w) - base_err

    metricas = {
        "filas_entrenamiento": int(len(train)), "filas_prueba": int(len(test)), "dias": int(len(dias)),
        "entrega": {"mae": mae(p, y, w), "r2": r2(y, p, w), "mae_lineal": mae(pl, y, w), "r2_lineal": r2(y, pl, w), "mae_media": mae(media, y, w)},
        "familia_dia": {"mae": fam_mae, "mae_lineal": fam_mae_lineal},
        "montecarlo": {"dias": int(mc["dia"].nunique()), "repeticiones": int(mc.groupby(["dia", "zona"]).size().max()), "mae": mc_mae, "cobertura_p10": cobertura, "cobertura_p10_familia": cobertura_familia},
        "fallidos": {"mae": mae(pf, yf, w), "r2": r2(yf, pf, w)},
        "importancia": {k: round(v, 5) for k, v in sorted(importancia.items(), key=lambda kv: -kv[1])},
    }

    # unas filas con su predicción, para comprobar en los tests que el navegador da lo mismo
    verificar = test.sample(20, random_state=5)[RASGOS].to_numpy()
    verificacion = [{"x": [float(v) for v in x], **{n: float(modelos[n].predict([x])[0]) for n in MODELOS}} for x in verificar]

    salida = {
        "rasgos": RASGOS,
        "rasgos_zona": RASGOS_ZONA,
        "rasgos_dia": RASGOS_DIA,
        "modelos": {n: {"texto": MODELOS[n]["texto"], **exportados[n]} for n in MODELOS},
        "dia_malo": {"texto": "Lo que baja la entrega de una familia de rutas en un día malo (percentil 10) frente a la esperada", "rasgos": RASGOS_FAMILIA, **dia_malo_exp},
        "metricas": metricas,
        "verificacion": verificacion,
        "verificacion_dia_malo": [{"x": [float(v) for v in x], "margen": float(dia_malo.predict([x])[0])} for x in fd_test.sample(10, random_state=5)[RASGOS_FAMILIA].to_numpy()],
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{OUT_JSON}: {os.path.getsize(OUT_JSON) / 1024:.0f} KB")
    escribir_md(metricas)
    print(json.dumps(metricas, indent=1, ensure_ascii=False))
    print(f"total {time.time() - t0:.0f} s")


NOMBRES = {
    "acceso_min": "Minutos desde la estación", "acceso_km": "Km desde la estación", "log_densidad": "Densidad de población",
    "log_area": "Superficie de la zona", "poblacion_k": "Población", "riesgo": "Riesgo de inundación de la zona",
    "lluvia_rel": "Lluvia habitual de la zona", "tramos_inundables": "Tramos inundables en el camino", "eqx1": "Rutas EQX1 o DQX1",
    "angulo": "Dirección desde la estación", "lon": "Longitud", "lat": "Latitud",
    "volumen": "Volumen", "lluvia": "Lluvia", "inundacion": "Flash flood", "huelga": "Huelga", "refuerzo": "Refuerzo de furgonetas", "retraso": "Retraso de salida",
}


def miles(n):
    return f"{n:,}".replace(",", ".")


def decimal(x, d=1):
    return f"{x:.{d}f}".replace(".", ",")


def escribir_md(m):
    pct = lambda x: f"{decimal(x * 100)} puntos"
    e, f, mc = m["entrega"], m["familia_dia"], m["montecarlo"]
    lineas = [
        "# Modelo de IA del mapa de reparto",
        "",
        "Generado con `python3 mapa/tools/entrenar_modelo.py`.",
        "",
        "## Qué hace",
        "",
        f"El motor de reparto (`mapa/reparto.js`) juega un día rutas por rutas, y cada día sale distinto: la tormenta cae más en una comarca que en otra y la inundación corta unos tramos u otros. Para saber qué esperar con unas condiciones hay que jugar muchos días. El modelo aprende de {miles(m['dias'])} días simulados ({miles(m['filas_entrenamiento'] + m['filas_prueba'])} filas de zona y día) y predice al instante, para cada una de las zonas:",
        "",
        "- la **tasa de entrega esperada**,",
        "- la tasa de entrega en un **día malo** (percentil 10: nueve de cada diez días salen mejor),",
        "- la tasa de **entregas fallidas**.",
        "",
        "Son tres modelos de gradient boosting con árboles por zona, más uno por familia de rutas para el día malo (scikit-learn, `HistGradientBoostingRegressor`), exportados a JSON y evaluados en el navegador por `mapa/modelo.js`, sin dependencias. Las filas pesan por paquetes, así que el error está medido por paquete.",
        "",
        "## Qué tal predice",
        "",
        "Con días que el modelo no ha visto (el 20% de los días, separados por día, no por fila):",
        "",
        "| Qué | Gradient boosting | Regresión lineal | Media |",
        "| --- | ---: | ---: | ---: |",
        f"| Error medio por zona y día (tasa de entrega) | {pct(e['mae'])} | {pct(e['mae_lineal'])} | {pct(e['mae_media'])} |",
        f"| R² por zona y día | {decimal(e['r2'], 3)} | {decimal(e['r2_lineal'], 3)} | 0 |",
        f"| Error medio por familia de rutas y día | {pct(f['mae'])} | {pct(f['mae_lineal'])} | |",
        "",
        f"Un día concreto lleva su azar (qué tramos se cortan, cómo rinde cada conductor), así que parte de ese error no se puede predecir. Contra la **media de {mc['repeticiones']} días jugados con las mismas condiciones** ({mc['dias']} condiciones distintas), que es lo que el modelo intenta estimar, el error medio por zona baja a **{pct(mc['mae'])}**.",
        "",
        f"El percentil 10 de cada zona queda por encima del resultado real en el {mc['cobertura_p10'] * 100:.0f}% de esos días (lo ideal es el 10%). El día malo de una familia de rutas no es la suma de los días malos de sus zonas, porque no caen todos a la vez: lo da un cuarto modelo, entrenado con una fila por familia y día, que queda por encima del resultado real en el {mc['cobertura_p10_familia'] * 100:.0f}% de los días.",
        "",
        f"Entregas fallidas: error medio de {pct(m['fallidos']['mae'])}, R² {decimal(m['fallidos']['r2'], 3)}.",
        "",
        "## Qué pesa más",
        "",
        "Cuánto empeora el error si se baraja cada rasgo (permutation importance), en puntos de tasa de entrega:",
        "",
        "| Rasgo | Peso |",
        "| --- | ---: |",
    ]
    for k, v in m["importancia"].items():
        lineas.append(f"| {NOMBRES[k]} | {decimal(v * 100, 2)} |")
    lineas += [
        "",
        "En el mapa, la explicación de cada escenario se calcula con valores de Shapley sobre las seis condiciones del día: cuánto aporta cada una (lluvia, flash flood, huelga...) a la diferencia con un día normal.",
        "",
        "## Límites",
        "",
        "- El modelo aprende del motor, no de datos reales de reparto: es tan bueno como el motor. Su papel es dar la respuesta al instante y con su incertidumbre.",
        "- Fuera del rango entrenado (volumen de 0,5 a 1,8, huelga hasta el 60%, retraso hasta 2 horas) no hay garantías.",
        "",
    ]
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lineas))


if __name__ == "__main__":
    main()
