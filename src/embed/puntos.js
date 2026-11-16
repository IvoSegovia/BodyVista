// SemioLab 3D · capa de puntos semiológicos (B14; docs/plan-fase-2.md §1.4).
// Cada punto es un aro apoyado en la piel (RingGeometry orientada según la
// normal del ancla), con MeshBasicMaterial transparente, depthWrite false y
// polygonOffset: sin inyección de shaders. La app manda el catálogo con sus
// anclas y el estado de cada punto (setPuntos); el visor sólo dibuja.
//
// En modo examinar, el cursor resuelve el punto más cercano (≤ 15 veces por
// segundo) y su «nombre · detalle» aparece con la capa de etiquetas. Mientras
// la cámara se mueve no se resuelve nada: la capa de etiquetas ya no escribe
// al DOM durante un vuelo, y el aro, que es geometría de la escena, la acompaña.
import * as THREE from '../vendor/three.js';
import { limitarFrecuencia, piezasDelEstado, puntoMasCercano, puntoVisible } from './puntos-cercania.js';

/** Separación del aro respecto de la piel (unidades de escena). */
const SEPARACION = 0.003;
const SEGMENTOS = 40;
const CURSOR_MS = 1000 / 15;
const EJE_Z = new THREE.Vector3(0, 0, 1);

function material(color, opacidad) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: opacidad,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

function crearMalla(geometria, { color, opacidad }, orden) {
  const malla = new THREE.Mesh(geometria, material(color, opacidad));
  malla.renderOrder = orden;
  return malla;
}

/**
 * @param escena   crearEscena (escena.js)
 * @param opciones.modoActual   () => modo del visor
 * @param opciones.capa         capa de etiquetas (etiquetas.js): rótulo bajo el cursor
 * @param opciones.nombreParte  (part_id) => nombre en español (modos foco y explorar)
 * @param opciones.sistemasDeParte (part_id) => sistemas: la piel no se rotula
 */
export function crearCapaPuntos(escena, { modoActual, capa = null, nombreParte = () => null, sistemasDeParte = () => [], ventana = window }) {
  const grupo = new THREE.Group();
  grupo.name = 'semiolab-puntos';
  escena.contexto.raiz.add(grupo);

  /** id → { datos, nodo, firma } */
  const puntos = new Map();
  let mostrar = 'hover';
  let bajoCursor = null;

  function liberar(entrada) {
    grupo.remove(entrada.nodo);
    entrada.nodo.traverse(objeto => {
      if (objeto.isMesh) { objeto.geometry.dispose(); objeto.material.dispose(); }
    });
  }

  /** Grupo orientado según la normal, con las piezas del estado. */
  function construir(datos) {
    const nodo = new THREE.Group();
    nodo.name = `punto:${datos.id}`;
    const normal = new THREE.Vector3().fromArray(datos.normal).normalize();
    nodo.position.fromArray(datos.punto).addScaledVector(normal, SEPARACION);
    nodo.quaternion.setFromUnitVectors(EJE_Z, normal);
    const piezas = piezasDelEstado(datos.estado, datos.radio);
    if (piezas.disco) nodo.add(crearMalla(new THREE.CircleGeometry(piezas.disco.radio, SEGMENTOS), piezas.disco, 1002));
    nodo.add(crearMalla(new THREE.RingGeometry(piezas.aro.interior, piezas.aro.exterior, SEGMENTOS), piezas.aro, 1003));
    if (piezas.centro) nodo.add(crearMalla(new THREE.CircleGeometry(piezas.centro.radio, 16), piezas.centro, 1003));
    grupo.add(nodo);
    return nodo;
  }

  const firmaDe = d => JSON.stringify([d.punto, d.normal, d.radio, d.estado]);

  function actualizarVisibilidad() {
    let cambio = false;
    for (const [id, entrada] of puntos) {
      const visible = puntoVisible(entrada.datos.estado, mostrar, id === bajoCursor);
      if (entrada.nodo.visible !== visible) { entrada.nodo.visible = visible; cambio = true; }
    }
    publicarConteo();
    if (cambio) escena.pedirCuadro();
  }

  function setPuntos(lista, modoMostrar) {
    mostrar = modoMostrar;
    const vigentes = new Set(lista.map(p => p.id));
    for (const [id, entrada] of puntos) if (!vigentes.has(id)) { liberar(entrada); puntos.delete(id); }
    for (const datos of lista) {
      const previa = puntos.get(datos.id);
      const firma = firmaDe(datos);
      if (previa && previa.firma === firma) { previa.datos = datos; continue; }
      if (previa) liberar(previa);
      puntos.set(datos.id, { datos, nodo: construir(datos), firma });
    }
    if (bajoCursor !== null && !puntos.has(bajoCursor)) fijarCursor(null);
    actualizarVisibilidad();
    escena.pedirCuadro();
  }

  /** Cantidades en <body data-puntos-*>: las leen las pruebas e2e. */
  function publicarConteo() {
    const cuerpo = ventana.document?.body;
    if (!cuerpo) return;
    const lista = [...puntos.values()];
    cuerpo.dataset.puntos = String(lista.length);
    cuerpo.dataset.puntosVisibles = String(lista.filter(e => e.nodo.visible).length);
    cuerpo.dataset.puntosHallazgo = String(lista.filter(e => e.datos.estado === 'hallazgo').length);
    cuerpo.dataset.puntosExaminados = String(lista.filter(e => e.datos.estado === 'examinado').length);
    cuerpo.dataset.puntoCursor = bajoCursor ?? '';
  }

  // ---- Cursor ----

  /** Rótulo bajo el cursor: { clave, texto, punto } o null. */
  let rotulo = null;
  function fijarRotulo(nuevo) {
    if (rotulo?.clave === nuevo?.clave) return;
    rotulo = nuevo;
    capa?.setCursor(nuevo ? { texto: nuevo.texto, punto: nuevo.punto } : null);
  }

  function fijarCursor(id) {
    if (bajoCursor === id) return;
    bajoCursor = id;
    const datos = id === null ? null : puntos.get(id)?.datos;
    fijarRotulo(datos ? { clave: `punto:${id}`, texto: datos.nombre, punto: datos.punto } : null);
    actualizarVisibilidad();
  }

  /** Punto del catálogo bajo un toque de piel (modo examinar); null fuera de todo radio. */
  function puntoEn(tocado) {
    if (!tocado || puntos.size === 0) return null;
    return puntoMasCercano([...puntos.values()].map(e => e.datos), tocado.punto, tocado.normal ?? null);
  }

  function revisarCursor(evento) {
    if (escena.enMovimiento()) return;
    const modo = modoActual();
    if (evento === null || (modo !== 'examinar' && modo !== 'explorar' && modo !== 'marcar:foco')) {
      fijarCursor(null);
      fijarRotulo(null);
      return;
    }
    const tocado = escena.tocarCuerpo(evento);
    if (modo === 'examinar') {
      fijarCursor(puntoEn(tocado));
      return;
    }
    // Explorar y foco: nombre de la estructura bajo el cursor (la piel no se rotula).
    fijarCursor(null);
    const nombre = tocado && !sistemasDeParte(tocado.part_id).includes('skin') ? nombreParte(tocado.part_id) : null;
    fijarRotulo(nombre ? { clave: `parte:${tocado.part_id}`, texto: nombre.slice(0, 80), punto: tocado.punto } : null);
  }

  const revisarLimitado = limitarFrecuencia(revisarCursor, CURSOR_MS);
  ventana.addEventListener('pointermove', evento => {
    if (evento.pointerType === 'touch' || evento.buttons !== 0) return;
    if (evento.target !== escena.contexto.renderer?.domElement) { revisarLimitado(null); return; }
    revisarLimitado(evento);
  }, { capture: true, passive: true });
  ventana.document.addEventListener('pointerleave', () => revisarLimitado(null));

  return {
    setPuntos,
    /** Punto semiológico bajo el toque (pick en modo examinar). */
    puntoEn,
    /** El modo cambió: el cursor se vuelve a resolver en el próximo movimiento. */
    alCambiarModo() {
      fijarCursor(null);
      fijarRotulo(null);
    },
  };
}
