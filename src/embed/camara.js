// SemioLab 3D · cámara clínica del modo embed (B10; docs/plan-fase-2.md §1.3).
// Dueña de la navegación: botones del ratón, mano, teclado, límites del pivote,
// encuadres y vuelo. Llega a los controles y la cámara de BodyVista por
// window.BodyVista.embed (gancho en main.js, ver EMBED-PATCHES.md).
//
// Convenciones de la escena: z vertical, +x izquierda del paciente, −y frente.
// Las funciones puras (encuadre, interpolación, límites) usan vectores como
// arreglos [x, y, z] y se prueban con node:test en tests/camara.test.js.
import { MOUSE, TOUCH } from '../vendor/three.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Caja de la piel con 5 cm de holgura: el pivote no sale de aquí. */
export const LIMITES_PIVOTE = Object.freeze({ x: [-0.55, 0.55], y: [-0.30, 0.30], z: [-1.32, 1.32] });

export const POLAR_MINIMO = 0.12;
export const DISTANCIA_MAXIMA = 7;
export const MARGEN_ENCUADRE = 1.15;

/** Encuadres con nombre (cajas mín. y máx.), semillas calculadas desde el catálogo. */
export const ENCUADRES = Object.freeze({
  cuerpo: { min: [-0.493, -0.231, -1.270], max: [0.493, 0.201, 1.270] },
  cabeza_cuello: { min: [-0.15, -0.18, 0.86], max: [0.15, 0.20, 1.27] },
  torax: { min: [-0.25, -0.19, 0.44], max: [0.25, 0.20, 0.90] },
  abdomen: { min: [-0.24, -0.20, 0.02], max: [0.24, 0.21, 0.50] },
  miembros_inferiores: { min: [-0.26, -0.20, -1.27], max: [0.26, 0.20, 0.12] },
});

/** Direcciones de vista, del centro hacia la cámara. `actual` = la vigente. */
export const DIRECCIONES = Object.freeze({
  frente: [0, -1, 0],
  espalda: [0, 1, 0],
  izquierda: [1, 0, 0],
  derecha: [-1, 0, 0],
  arriba: normalizar([0.02, -0.2, 1]),
});

const TECLAS_ENCUADRE = { 0: 'cuerpo', 1: 'cabeza_cuello', 2: 'torax', 3: 'abdomen', 4: 'miembros_inferiores' };
const PASO_FLECHA = 0.04;
const FACTOR_ACERCAR = 0.8;
const FACTOR_ALEJAR = 1.25;
const FPS_MINIMO_VUELO = 20;

// ---------------------------------------------------------------------------
// Vectores
// ---------------------------------------------------------------------------

function suma(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function resta(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function escala(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function productoPunto(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cruz(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norma(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalizar(a) { const n = norma(a); return n > 0 ? escala(a, 1 / n) : [0, 0, 0]; }
function interpolar(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
function acotar(v, [min, max]) { return Math.min(max, Math.max(min, v)); }

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

/**
 * Cámara y pivote que encuadran la caja mirando desde `direccion` (unitaria o
 * no; del centro hacia la cámara). Mismo cálculo que frameBox (main.js):
 * extensiones proyectadas en lugar de una esfera envolvente.
 * @param caja    { min: [x,y,z], max: [x,y,z] }
 * @param optica  { fov (grados, vertical), aspect }
 */
export function encuadre(caja, direccion, { fov, aspect }, margen = MARGEN_ENCUADRE) {
  const c = interpolar(caja.min, caja.max, 0.5);
  const f = normalizar(direccion);
  let derecha = cruz([0, 0, 1], f);
  derecha = productoPunto(derecha, derecha) < 0.1 ? [1, 0, 0] : normalizar(derecha);
  const arriba = normalizar(cruz(f, derecha));
  const tan = Math.tan((fov * Math.PI) / 360);
  let distancia = 0.12;
  for (const x of [caja.min[0], caja.max[0]]) {
    for (const y of [caja.min[1], caja.max[1]]) {
      for (const z of [caja.min[2], caja.max[2]]) {
        const v = resta([x, y, z], c);
        const profundidad = productoPunto(v, f);
        distancia = Math.max(
          distancia,
          Math.abs(productoPunto(v, arriba)) / tan + profundidad,
          Math.abs(productoPunto(v, derecha)) / (tan * aspect) + profundidad,
        );
      }
    }
  }
  return { camera: suma(c, escala(f, distancia * margen)), target: c };
}

/** Esféricas con eje z, convención de rotateView (upright-controls.js): θ = atan2(x, −y), φ = acos(z/r). */
export function esfericas(offset) {
  const r = norma(offset);
  if (r === 0) return { r: 0, theta: 0, phi: 0 };
  return { r, theta: Math.atan2(offset[0], -offset[1]), phi: Math.acos(acotar(offset[2] / r, [-1, 1])) };
}

export function desdeEsfericas({ r, theta, phi }) {
  return [r * Math.sin(theta) * Math.sin(phi), -r * Math.cos(theta) * Math.sin(phi), r * Math.cos(phi)];
}

/** Δθ de θ0 a θ1 por el arco corto, en (−π, π]. */
export function deltaAnguloCorto(theta0, theta1) {
  const vuelta = 2 * Math.PI;
  let delta = (theta1 - theta0) % vuelta;
  if (delta > Math.PI) delta -= vuelta;
  if (delta <= -Math.PI) delta += vuelta;
  return delta;
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Posición del vuelo en la fracción k ∈ [0, 1] (ya suavizada). El pivote va en
 * línea recta; cámara − pivote, en esféricas: la cámara rodea el cuerpo.
 */
export function interpolarVuelo(desde, hasta, k) {
  const target = interpolar(desde.target, hasta.target, k);
  const e0 = esfericas(resta(desde.camera, desde.target));
  const e1 = esfericas(resta(hasta.camera, hasta.target));
  const r = e0.r > 0 && e1.r > 0 ? e0.r * (e1.r / e0.r) ** k : e0.r + (e1.r - e0.r) * k;
  const theta = e0.theta + deltaAnguloCorto(e0.theta, e1.theta) * k;
  const phi = e0.phi + (e1.phi - e0.phi) * k;
  return { camera: suma(target, desdeEsfericas({ r, theta, phi })), target };
}

/** Duración por defecto (ms): crece con el recorrido del pivote y el cambio de distancia. */
export function duracionVuelo(desde, hasta) {
  const r0 = norma(resta(desde.camera, desde.target));
  const r1 = norma(resta(hasta.camera, hasta.target));
  const cambioDistancia = r0 > 0 && r1 > 0 ? Math.abs(Math.log(r1 / r0)) : 0;
  const recorrido = norma(resta(hasta.target, desde.target));
  return acotar(350 + 500 * (recorrido + 0.3 * cambioDistancia), [350, 900]);
}

/** Pivote acotado a LIMITES_PIVOTE. */
export function acotarPivote(target) {
  return [acotar(target[0], LIMITES_PIVOTE.x), acotar(target[1], LIMITES_PIVOTE.y), acotar(target[2], LIMITES_PIVOTE.z)];
}

const INDICE_EJE = { x: 0, y: 1, z: 2 };

/**
 * Caja de lo visible aplastada en el plano del corte, con la misma posición
 * que updateSection (main.js): lerp(max + .002, min − .002, section/100).
 */
export function cajaDeCorte(caja, eje, section) {
  const i = INDICE_EJE[eje];
  const desde = caja.max[i] + 0.002;
  const hasta = caja.min[i] - 0.002;
  const corte = desde + (hasta - desde) * (section / 100);
  const min = [...caja.min];
  const max = [...caja.max];
  min[i] = max[i] = corte;
  return { min, max };
}

/** Se mira el corte desde la mitad que se quitó (la de coordenada mayor en el eje). */
export function direccionDeCorte(eje) {
  return { z: 'arriba', x: 'izquierda', y: 'espalda' }[eje];
}

// ---------------------------------------------------------------------------
// Ejecución dentro del visor
// ---------------------------------------------------------------------------

const vector = v => [v.x, v.y, v.z];

/**
 * @param visor     window.BodyVista (con el gancho `embed: { controls, camera }`)
 * @param escena    resultado de crearEscena (escena.js)
 * @param guardrail resultado de iniciarGuardrail (registrarInteraccion, ultimoFps)
 * @param opciones.alCambiarNavegacion  ({ mano }) => void, cuando cambia desde el teclado
 * @param opciones.modoActual           () => modo del puente ('explorar', 'marcar:…', 'examinar')
 * @param opciones.cajaDePartes         ids => { min, max } | null (escena.js)
 */
export function crearCamara(visor, escena, guardrail, { alCambiarNavegacion = () => {}, modoActual = () => 'explorar', cajaDePartes = () => null, ventana = window } = {}) {
  const { controls, camera } = visor.embed;
  const documento = ventana.document;
  const lienzo = () => escena.contexto.renderer?.domElement ?? documento.querySelector('#stage canvas');

  let mano = false;
  let espacio = false;
  const desplaza = () => mano || espacio;

  // setTool (main.js) sigue asignando LEFT y ONE; sin setter la asignación lanzaría (módulo estricto).
  Object.defineProperty(controls.mouseButtons, 'LEFT', { get: () => (desplaza() ? MOUSE.PAN : MOUSE.ROTATE), set() {}, enumerable: true, configurable: true });
  Object.defineProperty(controls.touches, 'ONE', { get: () => (desplaza() ? TOUCH.PAN : TOUCH.ROTATE), set() {}, enumerable: true, configurable: true });
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.PAN;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.minPolarAngle = POLAR_MINIMO;
  controls.maxPolarAngle = Math.PI - POLAR_MINIMO;
  controls.maxDistance = DISTANCIA_MAXIMA;

  function actualizarCursor() {
    documento.body.dataset.mano = desplaza() ? '1' : '0';
  }
  actualizarCursor();
  controls.addEventListener('start', () => { documento.body.dataset.arrastrando = '1'; });
  controls.addEventListener('end', () => { documento.body.dataset.arrastrando = '0'; });

  function fijarMano(valor, desdeTeclado) {
    if (mano === valor) return;
    mano = valor;
    actualizarCursor();
    if (desdeTeclado) alCambiarNavegacion({ mano });
  }

  // Límite del pivote: cámara y pivote se mueven el mismo delta.
  controls.addEventListener('change', () => {
    const actual = vector(controls.target);
    const delta = resta(acotarPivote(actual), actual);
    if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return;
    controls.target.set(...suma(actual, delta));
    camera.position.set(...suma(vector(camera.position), delta));
  });

  const estadoActual = () => ({ camera: vector(camera.position), target: vector(controls.target) });
  const direccionVigente = () => normalizar(resta(vector(camera.position), vector(controls.target)));
  const distanciaVigente = () => norma(resta(vector(camera.position), vector(controls.target)));
  const optica = () => ({ fov: camera.fov, aspect: camera.aspect || 1 });
  const resolverDireccion = nombre => (nombre === undefined || nombre === 'actual' ? direccionVigente() : DIRECCIONES[nombre]);

  function aplicar({ camera: posicion, target }) {
    controls.target.set(...target);
    camera.position.set(...posicion);
    camera.up.set(0, 0, 1);
    camera.lookAt(controls.target);
    controls.update();
    guardrail.registrarInteraccion();
    escena.pedirCuadro();
  }

  function movimientoReducido() {
    if (ventana.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    const fps = guardrail.ultimoFps?.() ?? null;
    return fps !== null && fps < FPS_MINIMO_VUELO;
  }

  let vuelo = null;
  function terminarVuelo() {
    if (!vuelo) return;
    ventana.cancelAnimationFrame(vuelo.cuadro);
    controls.enabled = true;
    const { resolver } = vuelo;
    vuelo = null;
    resolver();
  }

  /** Vuela a { camera, target }. Un vuelo nuevo reemplaza al anterior; resuelve al terminar o cancelarse. */
  function volar(destino, ms) {
    terminarVuelo();
    const damping = controls.enableDamping;
    controls.enableDamping = false; // vacía la inercia pendiente
    controls.update();
    controls.enableDamping = damping;
    const desde = estadoActual();
    const hasta = { camera: [...destino.camera], target: [...destino.target] };
    const duracion = movimientoReducido() ? 0 : (ms ?? duracionVuelo(desde, hasta));
    return new Promise(resolver => {
      if (duracion <= 0) { aplicar(hasta); resolver(); return; }
      controls.enabled = false;
      const inicio = performance.now();
      const paso = ahora => {
        if (!vuelo) return;
        const t = Math.min(1, (ahora - inicio) / duracion);
        aplicar(t >= 1 ? hasta : interpolarVuelo(desde, hasta, easeInOutCubic(t)));
        if (t >= 1) terminarVuelo();
        else vuelo.cuadro = ventana.requestAnimationFrame(paso);
      };
      vuelo = { cuadro: ventana.requestAnimationFrame(paso), resolver };
    });
  }

  // El usuario manda: cualquier pointerdown, rueda o tecla cancela el vuelo
  // antes de que el evento llegue a los controles (fase de captura).
  for (const tipo of ['pointerdown', 'wheel', 'keydown']) ventana.addEventListener(tipo, terminarVuelo, { capture: true, passive: true });

  function centrarEn(punto, ms) {
    const delta = resta(punto, vector(controls.target));
    return volar({ camera: suma(vector(camera.position), delta), target: suma(vector(controls.target), delta) }, ms);
  }

  function encuadrarCaja(caja, direccion, margen, ms) {
    return volar(encuadre(caja, resolverDireccion(direccion), optica(), margen), ms);
  }

  function enfocarPartes(ids, margen, direccion, ms) {
    const caja = cajaDePartes(ids);
    return caja ? encuadrarCaja(caja, direccion, margen, ms) : Promise.resolve();
  }

  function encuadrar(nombre, direccion, margen, ms) {
    const caja = ENCUADRES[nombre];
    return caja ? encuadrarCaja(caja, direccion, margen, ms) : Promise.resolve();
  }

  /** Conserva pivote y distancia; cambia el punto de vista. */
  function orientar(direccion, ms) {
    const target = vector(controls.target);
    return volar({ camera: suma(target, escala(resolverDireccion(direccion), distanciaVigente())), target }, ms);
  }

  function zoom(factor, ms) {
    const target = vector(controls.target);
    const distancia = acotar(distanciaVigente() * factor, [controls.minDistance, controls.maxDistance]);
    return volar({ camera: suma(target, escala(direccionVigente(), distancia)), target }, ms);
  }

  /** Carga del mensaje flyTo del puente (ya validada: exactamente una fuente). */
  function volarA({ part_ids, punto, region, direccion, camera: posicion, target, margen, ms }) {
    if (part_ids) return enfocarPartes(part_ids, margen, direccion, ms);
    if (region) return encuadrar(region, direccion, margen, ms);
    if (punto) {
      if (direccion === undefined) return centrarEn(punto, ms);
      return volar({ camera: suma(punto, escala(resolverDireccion(direccion), distanciaVigente())), target: punto }, ms);
    }
    if (posicion && target) return volar({ camera: posicion, target }, ms);
    return Promise.resolve();
  }

  /** Corte: mira el plano desde la mitad que se quitó (como alignSectionView). */
  function mirarCorte(eje, section, ms) {
    const visible = escena.cajaVisible();
    if (!visible) return Promise.resolve();
    return encuadrarCaja(cajaDeCorte(visible, eje, section), direccionDeCorte(eje), MARGEN_ENCUADRE, ms);
  }

  // Desplazamiento en el plano de la pantalla, en fracción de la distancia al pivote.
  function desplazarPantalla(dx, dy) {
    const f = direccionVigente();
    let derecha = cruz([0, 0, 1], f);
    derecha = productoPunto(derecha, derecha) < 1e-6 ? [1, 0, 0] : normalizar(derecha);
    const arriba = normalizar(cruz(f, derecha));
    const paso = distanciaVigente() * PASO_FLECHA;
    const delta = suma(escala(derecha, dx * paso), escala(arriba, dy * paso));
    terminarVuelo();
    aplicar({ camera: suma(vector(camera.position), delta), target: suma(vector(controls.target), delta) });
  }

  // Último puntero sobre el lienzo: F centra en lo que está debajo.
  let ultimoPuntero = null;
  ventana.addEventListener('pointermove', evento => {
    if (evento.target === lienzo()) ultimoPuntero = { clientX: evento.clientX, clientY: evento.clientY };
  }, { passive: true });

  ventana.addEventListener('dblclick', evento => {
    if (evento.target !== lienzo() || modoActual() !== 'explorar') return;
    const tocado = escena.tocarCuerpo(evento);
    if (tocado) void centrarEn(tocado.punto);
  });

  const FLECHAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  ventana.addEventListener('keydown', evento => {
    if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(documento.activeElement?.tagName ?? '')) return;
    const tecla = evento.key;
    if (tecla === ' ') {
      evento.preventDefault();
      if (!espacio) { espacio = true; actualizarCursor(); }
      return;
    }
    if (evento.repeat && !FLECHAS[tecla]) return;
    if (tecla === 'h' || tecla === 'H') fijarMano(!mano, true);
    else if (FLECHAS[tecla]) { evento.preventDefault(); desplazarPantalla(...FLECHAS[tecla]); }
    else if (tecla === '+' || tecla === '=') void zoom(FACTOR_ACERCAR);
    else if (tecla === '-') void zoom(FACTOR_ALEJAR);
    else if (Object.hasOwn(TECLAS_ENCUADRE, tecla)) void encuadrar(TECLAS_ENCUADRE[tecla]);
    else if ((tecla === 'f' || tecla === 'F') && ultimoPuntero) {
      const tocado = escena.tocarCuerpo(ultimoPuntero);
      if (tocado) void centrarEn(tocado.punto);
    }
  });
  const soltarEspacio = () => { if (espacio) { espacio = false; actualizarCursor(); } };
  ventana.addEventListener('keyup', evento => { if (evento.key === ' ') soltarEspacio(); });
  ventana.addEventListener('blur', soltarEspacio);

  return {
    volar,
    volarA,
    centrarEn,
    enfocarPartes,
    encuadrar,
    orientar,
    zoom,
    mirarCorte,
    /** Desde la app (setNavegacion): no se reenvía como `navegacion`. */
    fijarMano: valor => fijarMano(valor, false),
    estadoActual,
  };
}
