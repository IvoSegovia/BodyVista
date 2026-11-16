// SemioLab 3D · acceso a la escena de BodyVista desde el modo embed.
// No toca main.js: llega a la escena subiendo desde el grupo de una estructura
// ya cargada (window.BodyVista.getEntry) y obtiene renderer y cámara con un
// objeto centinela, porque Three.js se los pasa a onBeforeRender en cada cuadro.
import * as THREE from '../vendor/three.js';
import catalogo from '../../catalog.json';

const SISTEMAS = new Set(['skeletal', 'muscular', 'cardiovascular', 'nervous', 'respiratory', 'digestive',
  'urinary', 'lymphatic', 'endocrine', 'reproductive', 'sensory', 'skin']);
const REGIONES = new Set(['head', 'neck', 'thorax', 'abdomen', 'pelvis', 'upper', 'lower']);
const OPACIDAD_PICABLE = 0.5;
const SEPARACION_SUPERFICIE = 0.004;
/** Espera tras el último cambio de cámara para dar la vista por quieta (ms). */
export const REPOSO_MS = 150;

const partesPorId = new Map(catalogo.parts.map(parte => [parte.id, parte]));

export function describirParte(partId) {
  const parte = partesPorId.get(partId);
  if (!parte) return null;
  return {
    sistemas: parte.systems.filter(s => SISTEMAS.has(s)),
    regiones: (parte.regions ?? []).filter(r => REGIONES.has(r)),
  };
}

export function sistemasDeParte(partId) {
  return describirParte(partId)?.sistemas ?? [];
}

/** Unión de los `bounds` del catálogo de esas partes ({ min, max }); null si ninguna existe. */
export function cajaDePartes(ids) {
  let caja = null;
  for (const id of ids) {
    const bounds = partesPorId.get(id)?.bounds;
    if (!bounds) continue;
    const [min, max] = bounds;
    caja = caja === null
      ? { min: [...min], max: [...max] }
      : { min: caja.min.map((v, i) => Math.min(v, min[i])), max: caja.max.map((v, i) => Math.max(v, max[i])) };
  }
  return caja;
}

function buscarEscena(visor) {
  for (const parte of catalogo.parts) {
    let nodo = visor.getEntry(parte.id)?.group;
    if (!nodo) continue;
    while (nodo.parent) nodo = nodo.parent;
    if (nodo.isScene) return nodo;
  }
  return null;
}

function visibleEnCadena(objeto) {
  for (let nodo = objeto; nodo; nodo = nodo.parent) if (!nodo.visible) return false;
  return true;
}

function materialDe(malla) {
  return Array.isArray(malla.material) ? malla.material[0] : malla.material;
}

/** Un punto que el corte (clipping) dejó fuera no es tocable. */
function recortadoPorCorte(punto, malla, renderer) {
  const planos = [...(materialDe(malla)?.clippingPlanes ?? []), ...(renderer.clippingPlanes ?? [])];
  return planos.some(plano => plano.distanceToPoint(punto) < 0);
}

export function crearEscena(visor) {
  const escena = buscarEscena(visor);
  if (!escena) throw Error('No se encontró la escena de BodyVista');

  const raiz = new THREE.Group();
  raiz.name = 'semiolab-embed';
  escena.add(raiz);

  // cuadroPropio: el cuadro lo pidió el embed (marcadores), no BodyVista; el
  // guardrail lo deja pasar aunque las animaciones estén pausadas.
  const contexto = { escena, raiz, renderer: null, camara: null, cuadroPropio: false };
  const oyentesCuadro = new Set();

  const centinela = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
  centinela.name = 'semiolab-centinela';
  centinela.frustumCulled = false;
  centinela.scale.setScalar(1e-6);
  centinela.onBeforeRender = (renderer, _escena, camara) => {
    contexto.renderer = renderer;
    contexto.camara = camara;
    const ahora = performance.now();
    for (const oyente of oyentesCuadro) oyente(ahora);
    vigilarCamara();
  };

  // ---- Movimiento de cámara (B12): «se mueve» al primer cuadro con otra cámara
  // o tamaño de lienzo; «reposa» REPOSO_MS después del último cambio. Las capas
  // de etiquetas y marcadores sólo trabajan al reposar: nada de DOM por cuadro.
  const oyentesMovimiento = new Set();
  const oyentesReposo = new Set();
  const firma = new Float64Array(34);
  const tamano = new THREE.Vector2();
  let hayFirma = false;
  let moviendo = false;
  let temporizadorReposo = 0;

  function vigilarCamara() {
    const { camara, renderer } = contexto;
    renderer.getSize(tamano);
    const valores = [...camara.matrixWorld.elements, ...camara.projectionMatrix.elements, tamano.x, tamano.y];
    let cambio = !hayFirma;
    for (let i = 0; i < valores.length; i++) {
      if (Math.abs(firma[i] - valores[i]) > 1e-7) { cambio = true; firma[i] = valores[i]; }
    }
    if (!cambio) return;
    hayFirma = true;
    if (!moviendo) {
      moviendo = true;
      for (const oyente of oyentesMovimiento) oyente();
    }
    clearTimeout(temporizadorReposo);
    temporizadorReposo = setTimeout(() => {
      moviendo = false;
      for (const oyente of oyentesReposo) oyente();
    }, REPOSO_MS);
  }

  const vector = new THREE.Vector3();
  /** Tamaño del lienzo en píxeles CSS. */
  function tamanoLienzo() {
    if (!contexto.renderer) return { ancho: 0, alto: 0 };
    contexto.renderer.getSize(tamano);
    return { ancho: tamano.x, alto: tamano.y };
  }

  /** Punto de escena → píxeles CSS del lienzo; `dentro` es false fuera del cono de visión. */
  function proyectar(punto) {
    const camara = contexto.camara;
    if (!camara) return { x: 0, y: 0, dentro: false };
    const { ancho, alto } = tamanoLienzo();
    vector.fromArray(punto).project(camara);
    const dentro = vector.z >= -1 && vector.z <= 1 && Math.abs(vector.x) <= 1 && Math.abs(vector.y) <= 1;
    return { x: ((vector.x + 1) / 2) * ancho, y: ((1 - vector.y) / 2) * alto, dentro };
  }

  /** Vector derecha de la cámara en coordenadas de escena. */
  function derechaCamara() {
    const camara = contexto.camara;
    if (!camara) return [1, 0, 0];
    return vector.setFromMatrixColumn(camara.matrixWorld, 0).normalize().toArray();
  }
  raiz.add(centinela);

  let cuadroPedido = false;
  /** Dibuja un cuadro (render a demanda, G8). BodyVista dibuja igual: renderer.render(scene, camera). */
  function pedirCuadro() {
    if (cuadroPedido) return;
    cuadroPedido = true;
    requestAnimationFrame(() => {
      cuadroPedido = false;
      if (!contexto.renderer || !contexto.camara) return;
      contexto.cuadroPropio = true;
      try { contexto.renderer.render(escena, contexto.camara); } finally { contexto.cuadroPropio = false; }
    });
  }

  const raycaster = new THREE.Raycaster();

  function rayoDesde(evento) {
    const lienzo = contexto.renderer?.domElement;
    if (!lienzo || !contexto.camara) return null;
    const caja = lienzo.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((evento.clientX - caja.left) / caja.width) * 2 - 1,
      -((evento.clientY - caja.top) / caja.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, contexto.camara);
    return raycaster;
  }

  /** Mallas visibles → id de su estructura. */
  function mallasVisibles() {
    const mallas = new Map();
    for (const parte of catalogo.parts) {
      const entrada = visor.getEntry(parte.id);
      if (!entrada || !visibleEnCadena(entrada.group)) continue;
      for (const malla of entrada.meshes ?? []) if (malla.visible) mallas.set(malla, parte.id);
    }
    return mallas;
  }

  /**
   * Estructura visible bajo el puntero; atraviesa capas tenues (nivel 1) si detrás hay algo sólido.
   * Devuelve { part_id, punto, normal }: punto separado de la piel y normal unitaria de la cara.
   */
  function tocarCuerpo(evento) {
    const rayo = rayoDesde(evento);
    if (!rayo) return null;
    const mallas = mallasVisibles();
    const impactos = rayo.intersectObjects([...mallas.keys()], false)
      .filter(impacto => !recortadoPorCorte(impacto.point, impacto.object, contexto.renderer));
    if (impactos.length === 0) return null;
    const elegido = impactos.find(i => (materialDe(i.object)?.opacity ?? 1) >= OPACIDAD_PICABLE) ?? impactos[0];
    const normal = elegido.face?.normal.clone().transformDirection(elegido.object.matrixWorld) ?? new THREE.Vector3();
    const punto = elegido.point.clone().addScaledVector(normal, SEPARACION_SUPERFICIE);
    // B14: la normal de la cara tocada orienta los aros de los puntos semiológicos.
    return { part_id: mallas.get(elegido.object), punto: punto.toArray(), normal: normal.toArray() };
  }

  const rayoOclusion = new THREE.Raycaster();
  const origen = new THREE.Vector3();
  const destino = new THREE.Vector3();

  /**
   * Puntos tapados por una estructura sólida (opacidad ≥ 0,5) entre la cámara y
   * ellos. Un solo recorrido de mallas para todos. Lo usan los marcadores para
   * mostrar el «fantasma» sólo cuando hace falta (B12).
   */
  function tapados(puntos) {
    const camara = contexto.camara;
    if (!camara || puntos.length === 0) return puntos.map(() => false);
    const solidas = [...mallasVisibles().keys()].filter(m => (materialDe(m)?.opacity ?? 1) >= OPACIDAD_PICABLE);
    camara.getWorldPosition(origen);
    return puntos.map(punto => {
      destino.fromArray(punto);
      const distancia = origen.distanceTo(destino);
      rayoOclusion.set(origen, destino.clone().sub(origen).normalize());
      rayoOclusion.far = Math.max(0, distancia - 0.01);
      return rayoOclusion.intersectObjects(solidas, false)
        .some(impacto => !recortadoPorCorte(impacto.point, impacto.object, contexto.renderer));
    });
  }

  return {
    contexto,
    pedirCuadro,
    tapados,
    rayoDesde,
    tocarCuerpo,
    alDibujar(oyente) { oyentesCuadro.add(oyente); return () => oyentesCuadro.delete(oyente); },
    alMoverCamara(oyente) { oyentesMovimiento.add(oyente); return () => oyentesMovimiento.delete(oyente); },
    alReposar(oyente) { oyentesReposo.add(oyente); return () => oyentesReposo.delete(oyente); },
    enMovimiento: () => moviendo,
    tamanoLienzo,
    proyectar,
    derechaCamara,
    /**
     * Caja de lo visible ({ min, max }), con las cajas de BodyVista (entry.box),
     * igual que updateSection en main.js; null si no hay nada visible.
     */
    cajaVisible() {
      const caja = new THREE.Box3();
      for (const parte of catalogo.parts) {
        const entrada = visor.getEntry(parte.id);
        if (entrada?.box && entrada.group.visible) caja.union(entrada.box);
      }
      return caja.isEmpty() ? null : { min: caja.min.toArray(), max: caja.max.toArray() };
    },
    estaVisible(partId) {
      const entrada = visor.getEntry(partId);
      return Boolean(entrada && visibleEnCadena(entrada.group));
    },
  };
}
