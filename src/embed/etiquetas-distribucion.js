// SemioLab 3D · distribución de etiquetas con líneas guía (B12; docs/plan-fase-2.md §1.2).
// Funciones puras: sin Three ni DOM. Entran anclas ya proyectadas a la pantalla
// (píxeles CSS del lienzo) y altos medidos; salen cajas, codos y pins.
// Se prueban con node:test en etiquetas-distribucion.test.js.

/** Margen de la vista (px). */
export const MARGEN = 8;
/** Separación mínima entre dos cajas de la misma columna (px). */
export const SEPARACION = 6;
/** Tramo horizontal entre el codo de la línea y el borde interior de la caja (px). */
export const REPISA = 14;
/** Distancia por debajo de la cual el lado lo decide la geometría 3D (px). */
const LADO_MINIMO_PX = 8;
const PASADAS_CRUCES = 3;

export function anchoMaximo(ancho) {
  return Math.min(190, 0.30 * ancho);
}

/** Etiquetas por columna: 6 en un lienzo bajo, 9 si no. */
export function topePorColumna(alto) {
  return alto < 420 ? 6 : 9;
}

const acotar = (v, min, max) => Math.min(max, Math.max(min, v));
const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * @param entrada.ancho, entrada.alto  tamaño del lienzo en px CSS
 * @param entrada.margenes  { arriba, abajo, izquierda? } ocupados por el HUD de la app
 * @param entrada.etiquetas [{ id, ax, ay, xc, lado3d, alto, ancho?, prioridad, columna? }]
 *   ax, ay  ancla proyectada · xc  x en pantalla del eje del cuerpo a la altura del ancla
 *   lado3d  signo del ancla sobre el vector derecha de la cámara · alto/ancho  caja medida
 * @returns {{ cajas: Caja[], pins: { id, ax, ay }[] }}
 *   Caja = { id, lado, x, y, ancho, alto, cy, ax, ay, codo: [x, y], borde: [x, y] } (x, y: esquina superior izquierda)
 */
export function distribuirEtiquetas({ ancho, alto, margenes = {}, etiquetas }) {
  const arriba = margenes.arriba ?? 0;
  const abajo = margenes.abajo ?? 0;
  const izquierda = margenes.izquierda ?? 0;
  const wMax = anchoMaximo(ancho);
  const ordenId = [...etiquetas].sort(porId);
  const posicionId = new Map(ordenId.map((e, i) => [e.id, i]));
  const pins = [];
  const columnas = { izquierda: [], derecha: [] };

  for (const original of ordenId) {
    const w = Math.min(original.ancho ?? wMax, wMax);
    const e = { ...original, w, h: original.alto };
    const geometria = geometriaColumnas(ancho, izquierda, w);
    let lado = ladoInicial(e, posicionId.get(e.id));
    if (bajoColumna(e.ax, lado, geometria)) lado = otro(lado);
    if (bajoColumna(e.ax, lado, geometria)) { pins.push(pin(e)); continue; }
    e.lado = lado;
    e.geometria = geometria;
    e.yd = acotar(e.ay, arriba + e.h / 2, alto - abajo - e.h / 2);
    columnas[lado].push(e);
  }

  const cajas = [];
  for (const lado of ['izquierda', 'derecha']) {
    const { ubicadas, descartadas } = resolverColumna(columnas[lado], { alto, arriba, abajo });
    pins.push(...descartadas.map(pin));
    cajas.push(...ubicadas.map(caja));
  }
  pins.sort(porId);
  return { cajas, pins };
}

function ladoInicial(e, posicion) {
  if (e.columna === 'izquierda' || e.columna === 'derecha') return e.columna;
  let s = e.ax - e.xc;
  if (Math.abs(s) < LADO_MINIMO_PX) s = e.lado3d ?? 0;
  if (s === 0) return posicion % 2 === 0 ? 'izquierda' : 'derecha';
  return s < 0 ? 'izquierda' : 'derecha';
}

const otro = lado => (lado === 'izquierda' ? 'derecha' : 'izquierda');

/** Borde interior de la caja y codo de la línea, para cada columna. */
function geometriaColumnas(ancho, izquierda, w) {
  const interiorIzquierdo = MARGEN + izquierda + w;
  const interiorDerecho = ancho - MARGEN - w;
  return {
    izquierda: { x: MARGEN + izquierda, interior: interiorIzquierdo, codo: interiorIzquierdo + REPISA },
    derecha: { x: interiorDerecho, interior: interiorDerecho, codo: interiorDerecho - REPISA },
  };
}

/** El ancla cae debajo de la columna si no queda más allá del codo. */
function bajoColumna(ax, lado, geometria) {
  return lado === 'izquierda' ? ax <= geometria.izquierda.codo : ax >= geometria.derecha.codo;
}

function pin(e) {
  return { id: e.id, ax: e.ax, ay: e.ay };
}

function caja(e) {
  const g = e.geometria[e.lado];
  return {
    id: e.id,
    lado: e.lado,
    x: g.x,
    y: e.y - e.h / 2,
    ancho: e.w,
    alto: e.h,
    cy: e.y,
    ax: e.ax,
    ay: e.ay,
    codo: [g.codo, e.y],
    borde: [g.interior, e.y],
  };
}

/** Distancia horizontal del ancla al codo de su columna. */
function lejania(e) {
  return Math.abs(e.ax - e.geometria[e.lado].codo);
}

/** La que se colapsa primero: menor prioridad; empate, la más lejana a su ancla; después, id mayor. */
function peorCandidata(lista) {
  return lista.reduce((peor, e) => {
    if (e.prioridad !== peor.prioridad) return e.prioridad < peor.prioridad ? e : peor;
    if (lejania(e) !== lejania(peor)) return lejania(e) > lejania(peor) ? e : peor;
    return e.id > peor.id ? e : peor;
  });
}

/**
 * Una columna: tope, separación exacta (regresión isotónica), colapso si no
 * entran y corrección de cruces. Devuelve las ubicadas (con y = centro) y las descartadas.
 */
function resolverColumna(lista, limites) {
  const tope = topePorColumna(limites.alto);
  let vigentes = [...lista];
  const descartadas = [];
  const descartar = () => {
    const peor = peorCandidata(vigentes);
    vigentes = vigentes.filter(e => e !== peor);
    descartadas.push(peor);
  };
  while (vigentes.length > tope) descartar();

  let orden = ordenarPorAltura(vigentes);
  let posiciones = separar(orden, limites);
  while (posiciones === null) {
    descartar();
    orden = ordenarPorAltura(vigentes);
    posiciones = separar(orden, limites);
  }

  for (let pasada = 0; pasada < PASADAS_CRUCES; pasada++) {
    const corregido = corregirCruces(orden, posiciones);
    if (!corregido) break;
    const nuevas = separar(corregido, limites);
    if (nuevas === null) break;
    orden = corregido;
    posiciones = nuevas;
  }
  return { ubicadas: orden.map((e, i) => ({ ...e, y: posiciones[i] })), descartadas };
}

function ordenarPorAltura(lista) {
  return [...lista].sort((a, b) => a.yd - b.yd || porId(a, b));
}

/**
 * Centros y'_i que mueven lo mínimo (cuadrados) sin pisarse, en el orden dado.
 * Con s_i el acumulado de (h_k + h_{k+1})/2 + g, z_i = yd_i − s_i debe ser no
 * decreciente: regresión isotónica por bloques adyacentes. null si no entran.
 */
export function separar(orden, { alto, arriba, abajo }) {
  if (orden.length === 0) return [];
  const s = [0];
  for (let i = 1; i < orden.length; i++) s.push(s[i - 1] + (orden[i - 1].h + orden[i].h) / 2 + SEPARACION);
  const ultimo = orden.length - 1;
  const zmin = arriba + orden[0].h / 2;
  const zmax = alto - abajo - orden[ultimo].h / 2 - s[ultimo];
  if (zmax < zmin) return null;
  const z = orden.map((e, i) => e.yd - s[i]);
  return regresionIsotonica(z).map((v, i) => acotar(v, zmin, zmax) + s[i]);
}

/** Regresión isotónica (no decreciente) por fusión de bloques adyacentes. */
export function regresionIsotonica(valores) {
  const bloques = [];
  for (const v of valores) {
    bloques.push({ suma: v, n: 1 });
    while (bloques.length > 1) {
      const ultimo = bloques[bloques.length - 1];
      const anterior = bloques[bloques.length - 2];
      if (anterior.suma / anterior.n <= ultimo.suma / ultimo.n) break;
      anterior.suma += ultimo.suma;
      anterior.n += ultimo.n;
      bloques.pop();
    }
  }
  return bloques.flatMap(b => Array(b.n).fill(b.suma / b.n));
}

/** Primer par de vecinas cuyos tramos ancla→codo se cortan: devuelve el orden con ese par intercambiado, o null. */
function corregirCruces(orden, posiciones) {
  for (let i = 0; i + 1 < orden.length; i++) {
    const a = orden[i];
    const b = orden[i + 1];
    const codoA = [a.geometria[a.lado].codo, posiciones[i]];
    const codoB = [b.geometria[b.lado].codo, posiciones[i + 1]];
    if (segmentosSeCortan([a.ax, a.ay], codoA, [b.ax, b.ay], codoB)) {
      const nuevo = [...orden];
      nuevo[i] = b;
      nuevo[i + 1] = a;
      return nuevo;
    }
  }
  return null;
}

function orientacion(p, q, r) {
  const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return Math.abs(v) < 1e-9 ? 0 : Math.sign(v);
}

/** Corte propio de dos segmentos (compartir un extremo o tocarse en la punta no cuenta). */
export function segmentosSeCortan(p1, p2, q1, q2) {
  const o1 = orientacion(p1, p2, q1);
  const o2 = orientacion(p1, p2, q2);
  const o3 = orientacion(q1, q2, p1);
  const o4 = orientacion(q1, q2, p2);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Agrupamiento voraz de marcadores en pantalla, en orden de id: cada uno entra
 * al primer grupo cuyo centro esté a menos de `umbral` px.
 * @param puntos [{ id, x, y }]
 * @returns [{ ids, x, y }] con (x, y) el centro del grupo
 */
export function agruparMarcadores(puntos, umbral = 14) {
  const grupos = [];
  for (const p of [...puntos].sort(porId)) {
    const grupo = grupos.find(g => Math.hypot(g.x - p.x, g.y - p.y) < umbral);
    if (!grupo) { grupos.push({ ids: [p.id], x: p.x, y: p.y, sx: p.x, sy: p.y }); continue; }
    grupo.ids.push(p.id);
    grupo.sx += p.x;
    grupo.sy += p.y;
    grupo.x = grupo.sx / grupo.ids.length;
    grupo.y = grupo.sy / grupo.ids.length;
  }
  return grupos.map(({ ids, x, y }) => ({ ids, x, y }));
}

/** Desplazamientos del abanico de un grupo de n: radio 22 px, ángulos −90° + 360°·k/n. */
export function abanico(n, radio = 22) {
  return Array.from({ length: n }, (_, k) => {
    const angulo = ((-90 + (360 * k) / n) * Math.PI) / 180;
    return [radio * Math.cos(angulo), radio * Math.sin(angulo)];
  });
}
