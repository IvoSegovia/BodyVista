// SemioLab 3D · capa propia de marcadores 3D (SPEC §3.1, Anexo C `setHotspots`).
// Código propio: sprites en la escena de BodyVista con prueba de oclusión por
// profundidad. Cada marcador son dos sprites: uno con depthTest (se ve sólo si
// nada lo tapa) y un «fantasma» tenue sin depthTest que deja ubicarlo cuando
// queda detrás de otra estructura (B12: sólo se muestra si el visible está tapado).
// B12: tamaño fijo en píxeles; los marcadores que se superponen en pantalla se
// agrupan en un pin con número (capa de etiquetas) que se abre en abanico.
// Ningún sprite se mueve de su lugar verdadero.
import * as THREE from '../vendor/three.js';
import { abanico, agruparMarcadores } from './etiquetas-distribucion.js';

export const COLORES = { sintoma: '#f59e0b', signo: '#06b6d4', foco: '#8b5cf6' };
const TAMANO_PX = 10;
const TAMANO_RESALTADO_PX = 16;
const OPACIDAD_FANTASMA = 0.28;
const UMBRAL_ARRASTRE_PX = 4;
const UMBRAL_GRUPO_PX = 14;
const RADIO_ABANICO_PX = 22;
/** Cercanía del cursor que abre un grupo; con el abanico abierto, hasta su borde más esto. */
const CERCANIA_PX = 12;
const RADIO_TOQUE_ABANICO_PX = 9;

/**
 * Escala de un sprite con sizeAttenuation: false para que mida `px` píxeles CSS:
 * px · 2·tan(fov/2) / alto del lienzo (perspectiva); en ortográfica, la altura visible.
 */
export function escalaParaPixeles(px, camara, altoLienzo) {
  if (!camara || altoLienzo <= 0) return 0.03;
  if (camara.isOrthographicCamera) return (px * (camara.top - camara.bottom)) / (camara.zoom || 1) / altoLienzo;
  return (px * 2 * Math.tan((camara.fov * Math.PI) / 360)) / altoLienzo;
}

function texturaDisco(color) {
  const lado = 64;
  const lienzo = document.createElement('canvas');
  lienzo.width = lienzo.height = lado;
  const g = lienzo.getContext('2d');
  g.beginPath();
  g.arc(lado / 2, lado / 2, lado / 2 - 4, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  g.stroke();
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  return textura;
}

const texturas = Object.fromEntries(Object.entries(COLORES).map(([tipo, color]) => [tipo, texturaDisco(color)]));

function crearSprites(tipo) {
  const visible = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturas[tipo], sizeAttenuation: false, depthTest: true, depthWrite: false, transparent: true }));
  const fantasma = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturas[tipo], sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, opacity: OPACIDAD_FANTASMA }));
  visible.renderOrder = 1001;
  fantasma.renderOrder = 1000;
  return { visible, fantasma };
}

/**
 * @param escena   resultado de crearEscena (escena.js)
 * @param opciones.modoActual  () => modo del visor; sólo se arrastra en `explorar`
 * @param opciones.alMover     ({ id, part_id, punto }) => void
 * @param opciones.alTocar     (id) => void · clic sin arrastre sobre un marcador
 * @param opciones.capa        capa de etiquetas (etiquetas.js): dibuja grupos y abanicos
 */
export function crearCapaHotspots(escena, { modoActual, alMover, alTocar = () => {}, capa = null }) {
  const grupo = new THREE.Group();
  grupo.name = 'semiolab-hotspots';
  escena.contexto.raiz.add(grupo);

  /** id → { datos, visible, fantasma } */
  const marcadores = new Map();
  let resaltado = null;

  function ubicar(marcador, punto) {
    marcador.visible.position.fromArray(punto);
    marcador.fantasma.position.fromArray(punto);
  }

  let optica = { alto: 0, fov: 0 };
  function escalar(marcador, id) {
    const px = id === resaltado ? TAMANO_RESALTADO_PX : TAMANO_PX;
    const tamano = escalaParaPixeles(px, escena.contexto.camara, escena.tamanoLienzo().alto);
    marcador.visible.scale.setScalar(tamano);
    marcador.fantasma.scale.setScalar(tamano);
  }

  /** Al cambiar el alto del lienzo o el campo de visión, se recalcula la escala de todos. */
  function vigilarOptica() {
    const camara = escena.contexto.camara;
    const alto = escena.tamanoLienzo().alto;
    const fov = camara?.isOrthographicCamera ? camara.top - camara.bottom + camara.zoom : (camara?.fov ?? 0);
    if (alto === optica.alto && fov === optica.fov) return false;
    optica = { alto, fov };
    for (const [id, marcador] of marcadores) escalar(marcador, id);
    return marcadores.size > 0;
  }

  function liberar(marcador) {
    grupo.remove(marcador.visible, marcador.fantasma);
    marcador.visible.material.dispose();
    marcador.fantasma.material.dispose();
  }

  function setHotspots(lista, idResaltado) {
    resaltado = idResaltado;
    const vigentes = new Set(lista.map(h => h.id));
    for (const [id, marcador] of marcadores) if (!vigentes.has(id)) { liberar(marcador); marcadores.delete(id); }
    for (const datos of lista) {
      let marcador = marcadores.get(datos.id);
      if (!marcador || marcador.datos.tipo !== datos.tipo) {
        if (marcador) liberar(marcador);
        marcador = { ...crearSprites(datos.tipo), datos, tapado: true };
        marcadores.set(datos.id, marcador);
        grupo.add(marcador.fantasma, marcador.visible);
      }
      marcador.datos = datos;
      ubicar(marcador, datos.punto);
      escalar(marcador, datos.id);
    }
    actualizarVisibilidad();
    publicarConteo();
    capa?.setMarcadores(lista, resaltado);
    refrescar();
    escena.pedirCuadro();
  }

  /** Cantidad de marcadores por tipo en <body data-hotspots-*>: la usan las pruebas e2e. */
  function publicarConteo() {
    const cuerpo = globalThis.document?.body;
    if (!cuerpo) return;
    for (const tipo of ['sintoma', 'signo', 'foco']) {
      cuerpo.dataset[`hotspots${tipo[0].toUpperCase()}${tipo.slice(1)}`] = String([...marcadores.values()].filter(m => m.datos.tipo === tipo).length);
    }
  }

  /**
   * Un marcador sobre una estructura oculta (capa apagada, corte) no se muestra.
   * El fantasma, sólo si el visible está tapado (se calcula al reposar la cámara).
   */
  function actualizarVisibilidad() {
    let cambio = false;
    for (const marcador of marcadores.values()) {
      const visible = escena.estaVisible(marcador.datos.part_id);
      const fantasma = visible && marcador.tapado;
      if (marcador.visible.visible !== visible || marcador.fantasma.visible !== fantasma) cambio = true;
      marcador.visible.visible = visible;
      marcador.fantasma.visible = fantasma;
    }
    return cambio;
  }

  // La visibilidad y la escala se revisan en cada cuadro (comparaciones, sin DOM); si cambian, se pide otro.
  escena.alDibujar(() => {
    const escala = vigilarOptica();
    if (actualizarVisibilidad() || escala) escena.pedirCuadro();
  });

  // ---- Oclusión y grupos: sólo con la cámara quieta ----
  /** Grupos de más de un marcador: { clave, ids, x, y, miembros: [{ id, tipo, x, y }] }. */
  let grupos = [];
  let abierto = null;

  function refrescar() {
    if (escena.enMovimiento() || !escena.contexto.camara) return;
    const lista = [...marcadores.values()].filter(m => escena.estaVisible(m.datos.part_id));
    const tapados = escena.tapados(lista.map(m => m.datos.punto));
    lista.forEach((marcador, i) => { marcador.tapado = tapados[i]; });
    if (actualizarVisibilidad()) escena.pedirCuadro();

    const enPantalla = [];
    for (const marcador of lista) {
      const p = escena.proyectar(marcador.datos.punto);
      if (p.dentro) enPantalla.push({ id: marcador.datos.id, tipo: marcador.datos.tipo, x: p.x, y: p.y });
    }
    const porId = new Map(enPantalla.map(p => [p.id, p]));
    grupos = agruparMarcadores(enPantalla, UMBRAL_GRUPO_PX)
      .filter(g => g.ids.length > 1)
      .map(g => ({ clave: g.ids.join('|'), ids: g.ids, x: g.x, y: g.y, miembros: g.ids.map(id => porId.get(id)) }));
    if (!grupos.some(g => g.clave === abierto)) abierto = null;
    dibujarGrupos();
  }

  function dibujarGrupos() {
    capa?.setGrupos(grupos.map(g => ({
      ...g,
      abierto: g.clave === abierto,
      abanico: abanico(g.ids.length, RADIO_ABANICO_PX).map(([dx, dy], k) => ({ ...g.miembros[k], fx: g.x + dx, fy: g.y + dy })),
    })));
  }

  function abrirGrupo(clave) {
    if (abierto === clave) return;
    abierto = clave;
    dibujarGrupos();
  }

  escena.alReposar(refrescar);
  escena.alMoverCamara(() => abrirGrupo(null));

  function puntoEnLienzo(evento) {
    const caja = escena.contexto.renderer?.domElement.getBoundingClientRect();
    return caja ? { x: evento.clientX - caja.left, y: evento.clientY - caja.top } : null;
  }

  function grupoCerca(p) {
    return grupos.find(g => {
      const radio = g.clave === abierto ? RADIO_ABANICO_PX + CERCANIA_PX : CERCANIA_PX;
      return Math.hypot(g.x - p.x, g.y - p.y) < radio;
    }) ?? null;
  }

  /** Marcador del abanico abierto bajo el puntero. */
  function miembroDelAbanico(evento) {
    const grupo = grupos.find(g => g.clave === abierto);
    const p = puntoEnLienzo(evento);
    if (!grupo || !p) return null;
    const desplazamientos = abanico(grupo.ids.length, RADIO_ABANICO_PX);
    const k = desplazamientos.findIndex(([dx, dy]) => Math.hypot(grupo.x + dx - p.x, grupo.y + dy - p.y) < RADIO_TOQUE_ABANICO_PX);
    return k < 0 ? null : grupo.ids[k];
  }

  // Ratón: el abanico se abre al acercarse al pin del grupo y se cierra al alejarse.
  window.addEventListener('pointermove', evento => {
    if (arrastre || evento.pointerType === 'touch' || escena.enMovimiento() || grupos.length === 0) return;
    if (evento.buttons !== 0) return;
    const p = esLienzo(evento) ? puntoEnLienzo(evento) : null;
    abrirGrupo(p ? (grupoCerca(p)?.clave ?? null) : null);
  }, { capture: true, passive: true });

  let toqueAbanico = null;

  // ---- Arrastre: en modo explorar, un marcador se reubica sobre el cuerpo ----
  let arrastre = null;

  function marcadorBajo(evento) {
    const rayo = escena.rayoDesde(evento);
    if (!rayo) return null;
    rayo.camera = escena.contexto.camara;
    const sprites = [...marcadores.values()].filter(m => m.visible.visible).map(m => m.fantasma);
    const [impacto] = rayo.intersectObjects(sprites, false);
    if (!impacto) return null;
    return [...marcadores.entries()].find(([, m]) => m.fantasma === impacto.object)?.[0] ?? null;
  }

  function esLienzo(evento) {
    return evento.target === escena.contexto.renderer?.domElement;
  }

  // Fase de captura en window: corre antes que los controles de órbita del lienzo.
  window.addEventListener('pointerdown', evento => {
    if (!esLienzo(evento) || evento.button !== 0) return;
    // Un toque sobre un marcador del abanico abierto equivale a tocar ese marcador.
    const enAbanico = miembroDelAbanico(evento);
    if (enAbanico) {
      evento.stopImmediatePropagation();
      toqueAbanico = enAbanico;
      return;
    }
    // Pantalla táctil: tocar el pin de un grupo lo abre o lo cierra.
    if (evento.pointerType === 'touch') {
      const p = puntoEnLienzo(evento);
      const grupo = p ? grupos.find(g => Math.hypot(g.x - p.x, g.y - p.y) < CERCANIA_PX) : null;
      if (grupo) {
        evento.stopImmediatePropagation();
        abrirGrupo(abierto === grupo.clave ? null : grupo.clave);
        toqueAbanico = '';
        return;
      }
    }
    if (modoActual() !== 'explorar') return;
    const id = marcadorBajo(evento);
    if (!id) return;
    evento.stopImmediatePropagation();
    arrastre = { id, x: evento.clientX, y: evento.clientY, movido: false, destino: null };
  }, true);

  window.addEventListener('pointermove', evento => {
    if (!arrastre) return;
    evento.stopImmediatePropagation();
    if (Math.hypot(evento.clientX - arrastre.x, evento.clientY - arrastre.y) < UMBRAL_ARRASTRE_PX && !arrastre.movido) return;
    arrastre.movido = true;
    const marcador = marcadores.get(arrastre.id);
    const sobre = escena.tocarCuerpo(evento);
    if (!marcador || !sobre) return;
    arrastre.destino = sobre;
    ubicar(marcador, sobre.punto);
    escena.pedirCuadro();
  }, true);

  window.addEventListener('pointerup', evento => {
    if (toqueAbanico !== null) {
      evento.stopImmediatePropagation();
      const id = toqueAbanico;
      toqueAbanico = null;
      if (id) alTocar(id);
      return;
    }
    if (!arrastre) return;
    evento.stopImmediatePropagation();
    const { id, destino, movido } = arrastre;
    arrastre = null;
    const marcador = marcadores.get(id);
    if (!marcador) return;
    if (!movido) { alTocar(id); return; }
    if (!destino) return;
    marcador.datos = { ...marcador.datos, ...destino };
    alMover({ id, part_id: destino.part_id, punto: destino.punto });
    refrescar();
  }, true);

  return {
    setHotspots,
    /** Recalcula oclusión y grupos (la vista cambió sin mover la cámara: capas, corte). */
    refrescar,
    /** true si el evento cae sobre un marcador: el puente no lo trata como pick. */
    tocaMarcador: evento => marcadorBajo(evento) !== null,
  };
}
