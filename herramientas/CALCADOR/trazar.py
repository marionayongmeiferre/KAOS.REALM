# CALCADOR — saca el contorno de verdad de una foto de referencia.
#
# Para qué es: hasta ahora, para copiar una silueta yo escribía las curvas a
# ojo, sacaba una captura y comparaba. Con esto la foto pasa a ser NÚMEROS:
# dónde están las puntas, cuánto miden, cuántas hay, si es simétrica y de qué
# orden. Así el generador de mandalas se ajusta a la referencia y no a mi ojo.
#
# Uso:   python trazar.py referencias\cruz.jpg
#        python trazar.py referencias\*.jpg
#
# Deja en salida\ dos ficheros por foto:
#   <nombre>.json   las medidas
#   <nombre>.png    la comparación, para mirarla
#
# Sólo necesita PIL y numpy, que ya están instalados. No instala nada.

import sys, os, json, math, glob
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(AQUI, "salida")
LADO = 1200          # el mismo lienzo que usa mandalas.js
MAX_LADO = 640       # se reduce antes de trabajar: más rápido y quita grano
N_ANGULOS = 720      # medio grado por muestra


# ----------------------------------------------------------------- binarizar
def otsu(gris):
    """Umbral automático. Separa tinta de papel sin que yo elija un número:
    con fotos de pantalla el gris de fondo cambia en cada una."""
    hist = np.bincount(gris.ravel(), minlength=256).astype(float)
    total = float(gris.size)
    suma = float(np.dot(np.arange(256), hist))
    wB = 0.0; sumaB = 0.0; mejor = -1.0; umbral = 127
    for t in range(256):
        wB += hist[t]
        if wB == 0:
            continue
        wF = total - wB
        if wF <= 0:
            break
        sumaB += t * hist[t]
        mB = sumaB / wB
        mF = (suma - sumaB) / wF
        var = wB * wF * (mB - mF) ** 2
        if var > mejor:
            mejor = var
            umbral = t
    return umbral


def cargar(ruta):
    im = Image.open(ruta).convert("L")
    if max(im.size) > MAX_LADO:
        f = MAX_LADO / float(max(im.size))
        im = im.resize((max(1, int(im.width * f)), max(1, int(im.height * f))),
                       Image.LANCZOS)
    gris = np.asarray(im, dtype=np.uint8)
    mascara = gris <= otsu(gris)

    # ¿Blanco sobre negro? Sus referencias vienen de las dos maneras. Si el
    # BORDE de la foto es "tinta", es que estaba del revés: el fondo es lo
    # negro y el dibujo lo blanco.
    borde = np.concatenate([mascara[0], mascara[-1], mascara[:, 0], mascara[:, -1]])
    if borde.mean() > 0.5:
        mascara = ~mascara
    return im, gris, mascara


def manchas_utiles(mascara):
    """Se queda con TODAS las piezas que cuenten, no sólo con la mayor.

    Antes cogía sólo la más grande, y una estrella de ocho puntas cuyos rayos no
    se tocan la medía como si fuera un rayo suelto: dio proporción 5.26 en una
    pieza que a ojo es cuadrada. Muchos de sus diseños son varios trozos que no
    se rozan. Se descarta lo que baje del 2% de la pieza mayor, que es donde
    viven las motas y los bordes de la foto.

    Devuelve la máscara y cuántos trozos ha dejado."""
    H, W = mascara.shape
    visto = np.zeros((H, W), dtype=bool)
    trozos = []
    ys, xs = np.nonzero(mascara)
    for y0, x0 in zip(ys, xs):
        if visto[y0, x0]:
            continue
        cola = deque([(int(y0), int(x0))])
        visto[y0, x0] = True
        celdas = []
        while cola:
            y, x = cola.popleft()
            celdas.append((y, x))
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and mascara[ny, nx] and not visto[ny, nx]:
                    visto[ny, nx] = True
                    cola.append((ny, nx))
        trozos.append(celdas)
    out = np.zeros((H, W), dtype=bool)
    if not trozos:
        return out, 0, []
    mayor = max(len(t) for t in trozos)
    buenos = [t for t in trozos if len(t) >= mayor * 0.02]
    for t in buenos:
        idx = np.array(t)
        out[idx[:, 0], idx[:, 1]] = True
    return out, len(buenos), buenos


# ------------------------------------------------------------------ contorno
DIRS = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def trazar_borde(mascara):
    """Sigue el borde píxel a píxel (Moore). Devuelve la vuelta entera."""
    H, W = mascara.shape
    ys, xs = np.nonzero(mascara)
    if len(ys) == 0:
        return []
    inicio = (int(ys[0]), int(xs[0]))
    actual = inicio
    vuelta = 7
    borde = [inicio]
    for _ in range(H * W * 4):
        encontrado = False
        for k in range(8):
            d = (vuelta + 1 + k) % 8
            ny, nx = actual[0] + DIRS[d][0], actual[1] + DIRS[d][1]
            if 0 <= ny < H and 0 <= nx < W and mascara[ny, nx]:
                vuelta = (d + 5) % 8
                actual = (ny, nx)
                borde.append(actual)
                encontrado = True
                break
        if not encontrado:
            break
        if actual == inicio and len(borde) > 2:
            break
    return borde


def simplificar(pts, tol):
    """Quita los puntos que no cambian la forma (Douglas-Peucker). Un borde de
    3000 píxeles y uno de 120 puntos dibujan lo mismo, pero el segundo se lee.
    Va por pila y no por recursión: 3000 puntos revientan el límite de Python."""
    if len(pts) < 3:
        return list(pts)
    guardar = [False] * len(pts)
    guardar[0] = guardar[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        a, b = pila.pop()
        if b <= a + 1:
            continue
        ini, fin = pts[a], pts[b]
        dx, dy = fin[0] - ini[0], fin[1] - ini[1]
        largo = math.hypot(dx, dy)
        peor = 0.0
        idx = -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if largo == 0:
                d = math.hypot(px - ini[0], py - ini[1])
            else:
                d = abs(dy * px - dx * py + fin[0] * ini[1] - fin[1] * ini[0]) / largo
            if d > peor:
                peor = d
                idx = i
        if peor > tol and idx > 0:
            guardar[idx] = True
            pila.append((a, idx))
            pila.append((idx, b))
    return [p for p, g in zip(pts, guardar) if g]


# -------------------------------------------------------------- firma radial
def firma_radial(mascara, cy, cx, n=N_ANGULOS):
    """Para cada ángulo, hasta dónde llega la tinta. Es la medida que más sirve
    en estos ornamentos: de aquí salen las puntas, su largo y la simetría."""
    H, W = mascara.shape
    rmax = math.hypot(max(cy, H - cy), max(cx, W - cx))
    r = np.zeros(n)
    for i in range(n):
        a = 2.0 * math.pi * i / n
        dy, dx = -math.sin(a), math.cos(a)     # +Y hacia arriba, como el lienzo
        ultimo = 0.0
        d = 0.0
        while d < rmax:
            y = int(round(cy + dy * d))
            x = int(round(cx + dx * d))
            if 0 <= y < H and 0 <= x < W and mascara[y, x]:
                ultimo = d
            d += 0.5
        r[i] = ultimo
    return r


def orden_simetria(r):
    """¿De cuántos brazos es? La firma radial de una estrella de 8 se repite 8
    veces por vuelta, así que sale como un pico en el armónico 8."""
    f = np.abs(np.fft.rfft(r - r.mean()))
    if len(f) < 18:
        return []
    fuerza = f[2:17]
    tope = float(fuerza.max())
    if tope <= 0:
        return []
    pares = [(k + 2, round(float(fuerza[k]) / tope, 3)) for k in range(len(fuerza))]
    pares.sort(key=lambda p: -p[1])
    return pares[:3]


def simetria_espejo(r):
    """1.00 = tiene un eje de espejo. Su cresta/lis lo tiene; la daga también."""
    n = len(r)
    rc = r - r.mean()
    denom = float(np.dot(rc, rc))
    if denom == 0:
        return 0.0
    mejor = -1.0
    invertida = rc[::-1]
    for s in range(n):
        v = float(np.dot(rc, np.roll(invertida, s))) / denom
        if v > mejor:
            mejor = v
    return round(mejor, 3)


def puntas(r, n_max=16):
    """Máximos locales bien marcados: son las puntas del ornamento."""
    n = len(r)
    med = float(r.mean())
    crudas = []
    for i in range(n):
        a, b, c = r[i - 1], r[i], r[(i + 1) % n]
        if b >= a and b > c and b > med * 1.05:
            crudas.append((i, float(b)))
    # junta los que están pegados: un pico ancho no son tres puntas
    juntas = []
    for i, v in crudas:
        if juntas and min(abs(i - juntas[-1][0]), n - abs(i - juntas[-1][0])) < n * 0.02:
            if v > juntas[-1][1]:
                juntas[-1] = (i, v)
        else:
            juntas.append((i, v))
    juntas.sort(key=lambda p: -p[1])
    return juntas[:n_max]


# ------------------------------------------------------------------ pintarlo
def comparacion(im, mascara, contorno, cy, cx, r, pk, ruta):
    H, W = mascara.shape
    alto_tira = 130
    lienzo = Image.new("RGB", (W * 2 + 12, H + alto_tira + 8), "white")
    lienzo.paste(im.convert("RGB"), (0, 0))

    calco = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(calco)
    if len(contorno) > 2:
        d.line([(x, y) for y, x in contorno] + [(contorno[0][1], contorno[0][0])],
               fill=(0, 0, 0), width=2)
    d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(255, 61, 92))
    for i, v in pk:
        a = 2.0 * math.pi * i / len(r)
        d.line([(cx, cy), (cx + math.cos(a) * v, cy - math.sin(a) * v)],
               fill=(255, 61, 92), width=1)
    lienzo.paste(calco, (W + 12, 0))

    tira = Image.new("RGB", (W * 2 + 12, alto_tira), "white")
    dt = ImageDraw.Draw(tira)
    rmax = max(float(r.max()), 1e-6)
    ancho = W * 2 + 12
    pts = [(i * ancho / float(len(r)),
            alto_tira - 6 - (r[i] / rmax) * (alto_tira - 16)) for i in range(len(r))]
    dt.line(pts, fill=(0, 0, 0), width=1)
    for i, v in pk:
        x = i * ancho / float(len(r))
        dt.line([(x, 4), (x, alto_tira - 6)], fill=(255, 61, 92), width=1)
    lienzo.paste(tira, (0, H + 8))
    lienzo.save(ruta)



# ------------------------------------------------------- todos los contornos
def contorno_de(celdas, forma):
    """Traza la vuelta de un trozo suelto."""
    m = np.zeros(forma, dtype=bool)
    idx = np.array(celdas)
    m[idx[:, 0], idx[:, 1]] = True
    return trazar_borde(m)


def huecos_de(mascara):
    """Los agujeros de dentro.

    Truco: se mira el FONDO. Todo lo que no es tinta y no llega hasta el borde
    de la imagen es un hueco encerrado. Sin esto, reseguir una flor de lis
    calada daba una mancha maciza — los calados se perdían por el camino.
    """
    H, W = mascara.shape
    fondo = ~mascara
    visto = np.zeros((H, W), dtype=bool)
    fuera = deque()
    for x in range(W):
        for y in (0, H - 1):
            if fondo[y, x] and not visto[y, x]:
                visto[y, x] = True
                fuera.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if fondo[y, x] and not visto[y, x]:
                visto[y, x] = True
                fuera.append((y, x))
    while fuera:
        y, x = fuera.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and fondo[ny, nx] and not visto[ny, nx]:
                visto[ny, nx] = True
                fuera.append((ny, nx))
    # lo que queda del fondo sin visitar son los agujeros
    encerrado = fondo & ~visto
    if not encerrado.any():
        return []
    _, _, trozos = manchas_utiles(encerrado)
    return trozos


def todos_los_contornos(mascara, trozos, cy, cx, rmax, tol):
    """Devuelve [{tipo, pts}] con las vueltas de tinta y de hueco, ya
    normalizadas al radio máximo y simplificadas."""
    forma = mascara.shape
    salida = []
    for celdas in trozos:
        b = simplificar(contorno_de(celdas, forma), tol)
        if len(b) > 6:
            salida.append({"tipo": "tinta",
                           "pts": [[round((x - cx) / rmax, 4), round((cy - y) / rmax, 4)]
                                   for y, x in b]})
    for celdas in huecos_de(mascara):
        # Los agujeros muy pequeños son grano de la foto, no calados.
        if len(celdas) < 60:
            continue
        b = simplificar(contorno_de(celdas, forma), tol)
        if len(b) > 6:
            salida.append({"tipo": "hueco",
                           "pts": [[round((x - cx) / rmax, 4), round((cy - y) / rmax, 4)]
                                   for y, x in b]})
    return salida

# ---------------------------------------------------------------------- main
def calcar(ruta):
    nombre = os.path.splitext(os.path.basename(ruta))[0]
    im, gris, mascara = cargar(ruta)
    mascara, n_trozos, trozos = manchas_utiles(mascara)
    if not mascara.any():
        print("  " + nombre + ": no encuentro ninguna figura")
        return

    ys, xs = np.nonzero(mascara)
    cy, cx = float(ys.mean()), float(xs.mean())
    # El contorno sigue siendo el del trozo mayor: dibujar la vuelta de ocho
    # piezas sueltas no se lee. Las MEDIDAS sí van sobre todos los trozos.
    borde = trazar_borde(mascara)
    simple = simplificar(borde, 1.2)
    r = firma_radial(mascara, cy, cx)

    rmax = float(r.max())
    vivos = r[r > 0]
    rmin = float(vivos.min()) if len(vivos) else 0.0
    pk = puntas(r)

    # todo normalizado al radio máximo: así la medida no depende del tamaño de
    # la foto y se puede comparar una referencia con otra
    esc = (LADO * 0.44 / rmax) if rmax > 0 else 1.0
    contorno_n = [[round((x - cx) / rmax, 4), round((cy - y) / rmax, 4)]
                  for y, x in simple] if rmax > 0 else []
    svg = "M " + " L ".join(
        "%.1f %.1f" % ((x - cx) * esc, (y - cy) * esc) for y, x in simple) + " Z"

    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    datos = {
        "fichero": os.path.basename(ruta),
        "lado": LADO,
        "trozos": n_trozos,
        "centro": [round(cx, 1), round(cy, 1)],
        "radio": {"max": 1.0,
                  "min": round(rmin / rmax, 3) if rmax else 0,
                  "medio": round(float(vivos.mean()) / rmax, 3) if len(vivos) else 0},
        "simetria": {"radial": orden_simetria(r), "espejo": simetria_espejo(r)},
        "puntas": [{"angulo": round(i * 360.0 / len(r), 1), "radio": round(v / rmax, 3)}
                   for i, v in sorted(pk)],
        "relleno": round(float(mascara.sum()) / (math.pi * rmax * rmax), 3) if rmax else 0,
        "proporcion": round((x1 - x0 + 1) / float(y1 - y0 + 1), 3),
        "contorno": contorno_n,
        # Todas las vueltas, tinta y hueco. Es lo que se usa para reseguir una
        # referencia en vez de reconstruirla con formas básicas apiladas.
        "contornos": todos_los_contornos(mascara, trozos, cy, cx, rmax, 1.0) if rmax else [],
        "svg": svg,
    }
    os.makedirs(SALIDA, exist_ok=True)
    with open(os.path.join(SALIDA, nombre + ".json"), "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=1)
    comparacion(im, mascara, simple, cx, cy, r, pk, os.path.join(SALIDA, nombre + ".png"))

    sim = datos["simetria"]["radial"]
    print("  %-18s trozos=%-2d puntas=%-3d simetria=%-3s espejo=%.2f relleno=%.2f proporcion=%.2f"
          % (nombre, n_trozos, len(pk), (str(sim[0][0]) if sim else "-"),
             datos["simetria"]["espejo"], datos["relleno"], datos["proporcion"]))


def main():
    args = sys.argv[1:]
    if not args:
        print("uso: python trazar.py <foto> [mas fotos...]")
        print("     python trazar.py referencias\\*.jpg")
        return
    rutas = []
    for a in args:
        rutas.extend(sorted(glob.glob(a)) or [a])
    print("calcando %d:" % len(rutas))
    for ruta in rutas:
        if not os.path.exists(ruta):
            print("  no existe: " + ruta)
            continue
        try:
            calcar(ruta)
        except Exception as e:
            print("  %s: %s" % (os.path.basename(ruta), e))
    print("resultados en " + SALIDA)


if __name__ == "__main__":
    main()
