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
  };
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

  /** Estructura visible bajo el puntero; atraviesa capas tenues (nivel 1) si detrás hay algo sólido. */
  function tocarCuerpo(evento) {
    const rayo = rayoDesde(evento);
    if (!rayo) return null;
    const mallas = new Map();
    for (const parte of catalogo.parts) {
      const entrada = visor.getEntry(parte.id);
      if (!entrada || !visibleEnCadena(entrada.group)) continue;
      for (const malla of entrada.meshes ?? []) if (malla.visible) mallas.set(malla, parte.id);
    }
    const impactos = rayo.intersectObjects([...mallas.keys()], false)
      .filter(impacto => !recortadoPorCorte(impacto.point, impacto.object, contexto.renderer));
    if (impactos.length === 0) return null;
    const elegido = impactos.find(i => (materialDe(i.object)?.opacity ?? 1) >= OPACIDAD_PICABLE) ?? impactos[0];
    const normal = elegido.face?.normal.clone().transformDirection(elegido.object.matrixWorld) ?? new THREE.Vector3();
    const punto = elegido.point.clone().addScaledVector(normal, SEPARACION_SUPERFICIE);
    return { part_id: mallas.get(elegido.object), punto: punto.toArray() };
  }

  return {
    contexto,
    pedirCuadro,
    rayoDesde,
    tocarCuerpo,
    alDibujar(oyente) { oyentesCuadro.add(oyente); return () => oyentesCuadro.delete(oyente); },
    estaVisible(partId) {
      const entrada = visor.getEntry(partId);
      return Boolean(entrada && visibleEnCadena(entrada.group));
    },
  };
}
