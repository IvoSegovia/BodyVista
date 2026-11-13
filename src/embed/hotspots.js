// SemioLab 3D · capa propia de marcadores 3D (SPEC §3.1, Anexo C `setHotspots`).
// Código propio: sprites en la escena de BodyVista con prueba de oclusión por
// profundidad. Cada marcador son dos sprites: uno con depthTest (se ve sólo si
// nada lo tapa) y un «fantasma» tenue sin depthTest que deja ubicarlo cuando
// queda detrás de otra estructura.
import * as THREE from '../vendor/three.js';

const COLORES = { sintoma: '#f59e0b', signo: '#06b6d4', foco: '#8b5cf6' };
const TAMANO = 0.03; // fracción de la altura del lienzo (sizeAttenuation: false)
const TAMANO_RESALTADO = 0.045;
const OPACIDAD_FANTASMA = 0.28;
const UMBRAL_ARRASTRE_PX = 4;

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
 */
export function crearCapaHotspots(escena, { modoActual, alMover, alTocar = () => {} }) {
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

  function escalar(marcador, id) {
    const tamano = id === resaltado ? TAMANO_RESALTADO : TAMANO;
    marcador.visible.scale.setScalar(tamano);
    marcador.fantasma.scale.setScalar(tamano);
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
        marcador = { ...crearSprites(datos.tipo), datos };
        marcadores.set(datos.id, marcador);
        grupo.add(marcador.fantasma, marcador.visible);
      }
      marcador.datos = datos;
      ubicar(marcador, datos.punto);
      escalar(marcador, datos.id);
    }
    actualizarVisibilidad();
    publicarConteo();
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

  /** Un marcador sobre una estructura oculta (capa apagada, corte) no se muestra. */
  function actualizarVisibilidad() {
    let cambio = false;
    for (const marcador of marcadores.values()) {
      const visible = escena.estaVisible(marcador.datos.part_id);
      if (marcador.visible.visible !== visible) cambio = true;
      marcador.visible.visible = marcador.fantasma.visible = visible;
    }
    return cambio;
  }

  // La visibilidad se recalcula en cada cuadro; si cambió, se pide otro.
  escena.alDibujar(() => { if (actualizarVisibilidad()) escena.pedirCuadro(); });

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
    if (!esLienzo(evento) || modoActual() !== 'explorar' || evento.button !== 0) return;
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
  }, true);

  return {
    setHotspots,
    /** true si el evento cae sobre un marcador: el puente no lo trata como pick. */
    tocaMarcador: evento => marcadorBajo(evento) !== null,
  };
}
