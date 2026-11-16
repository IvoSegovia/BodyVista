// SemioLab 3D · puente postMessage visor ↔ aplicación v1 (SPEC.md Anexo C y
// Plan de Choque §1.4). Contrato canónico: packages/schema/src/bridge-3d.ts,
// donde la aplicación valida con Zod todo lo que recibe. Este archivo no
// importa el schema (el fork queda aislado del monorepo): verifica origen,
// emisor, canal, `type` y la forma mínima de cada carga; la vista completa la
// valida BodyVista en restore() mediante validateView (src/state.js).
import { DIRECCIONES, ENCUADRES } from './camara.js';
import { MODOS_ETIQUETAS, TONOS } from './etiquetas.js';

const CANAL = 'semiolab-puente';
const VERSION = 1;
const MODOS = new Set(['explorar', 'marcar:sintoma', 'marcar:signo', 'marcar:foco', 'examinar']);
const TIPOS_HOTSPOT = new Set(['sintoma', 'signo', 'foco']);
const ESCENAS_MICRO = new Set(['alveoli', 'nephron', 'sarcomere', 'synapse', 'villi', 'vessel']);
const EJES = new Set(['x', 'y', 'z']);
const CLIC_MAX_PX = 5;
const CLIC_MAX_MS = 500;
const PART_ID = /^(z_[0-9a-f]{16}|bp2_[A-Za-z0-9_]+)$/;
const REGIONES_ENCUADRE = new Set(Object.keys(ENCUADRES));
const NOMBRES_DIRECCION = new Set([...Object.keys(DIRECCIONES), 'actual']);

const esObjeto = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const esNumero = v => typeof v === 'number' && Number.isFinite(v);
const esPunto = v => Array.isArray(v) && v.length === 3 && v.every(esNumero);
const esNivel = v => v === 0 || v === 1 || v === 2 || v === 3;
const esTexto = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;

function esMensajeDelPuente(datos) {
  return esObjeto(datos) && datos.canal === CANAL && datos.version === VERSION && typeof datos.type === 'string';
}

const enRango = (v, min, max) => esNumero(v) && v >= min && v <= max;
const esOpcional = (v, prueba) => v === undefined || prueba(v);

/** flyTo: exactamente una fuente entre part_ids | punto | region | (camera y target juntos). */
function esFlyTo(m) {
  const fuentes = [m.part_ids, m.punto, m.region, m.camera ?? m.target].filter(v => v !== undefined).length;
  if (fuentes !== 1 || (m.camera === undefined) !== (m.target === undefined)) return false;
  return esOpcional(m.part_ids, ids => Array.isArray(ids) && ids.length >= 1 && ids.length <= 50 && ids.every(id => typeof id === 'string' && PART_ID.test(id)))
    && esOpcional(m.punto, esPunto)
    && esOpcional(m.region, r => REGIONES_ENCUADRE.has(r))
    && esOpcional(m.camera, esPunto)
    && esOpcional(m.target, esPunto)
    && esOpcional(m.direccion, d => NOMBRES_DIRECCION.has(d))
    && esOpcional(m.margen, v => enRango(v, 1, 3))
    && esOpcional(m.ms, v => enRango(v, 0, 2000));
}

function esHotspot(h) {
  return esObjeto(h) && esTexto(h.id) && TIPOS_HOTSPOT.has(h.tipo) && esTexto(h.part_id, 80) && esPunto(h.punto)
    && esOpcional(h.texto, v => esTexto(v, 80));
}

const COLUMNAS = new Set(['izquierda', 'derecha']);
const esTono = v => Object.hasOwn(TONOS, v);

/** Etiqueta de setEtiquetas: exactamente un ancla (part_id o punto). */
function esEtiqueta(e) {
  if (!esObjeto(e) || !esTexto(e.id) || !esTexto(e.texto, 80)) return false;
  if ((e.part_id === undefined) === (e.punto === undefined)) return false;
  return esOpcional(e.part_id, id => typeof id === 'string' && PART_ID.test(id))
    && esOpcional(e.punto, esPunto)
    && esOpcional(e.columna, c => COLUMNAS.has(c))
    && esOpcional(e.tono, esTono)
    && esOpcional(e.prioridad, v => Number.isInteger(v) && v >= 0 && v <= 3);
}

function esEnlace(e) {
  return esObjeto(e) && esPunto(e.de) && esPunto(e.a) && esOpcional(e.tono, esTono);
}

/** setEtiquetas: todos los campos opcionales; el que viene reemplaza al vigente. */
function esSetEtiquetas(m) {
  return esOpcional(m.modo, v => MODOS_ETIQUETAS.includes(v))
    && esOpcional(m.margenes, g => esObjeto(g) && enRango(g.arriba, 0, 200) && enRango(g.abajo, 0, 200) && esOpcional(g.izquierda, v => enRango(v, 0, 200)))
    && esOpcional(m.etiquetas, l => Array.isArray(l) && l.length <= 24 && l.every(esEtiqueta) && new Set(l.map(e => e.id)).size === l.length)
    && esOpcional(m.enlaces, l => Array.isArray(l) && l.length <= 10 && l.every(esEnlace));
}

// BodyVista marca <body data-ready="true"> al terminar la carga inicial (main.js).
export function cuandoEsteCargado(documento) {
  return new Promise((resolver, rechazar) => {
    const revisar = () => {
      const estado = documento.body.dataset.ready;
      if (estado === 'true') { observador.disconnect(); resolver(); return true; }
      if (estado === 'error') { observador.disconnect(); rechazar(Error('BodyVista no pudo cargar el modelo')); return true; }
      return false;
    };
    const observador = new MutationObserver(revisar);
    if (!revisar()) observador.observe(documento.body, { attributes: true, attributeFilter: ['data-ready'] });
  });
}

/**
 * @param ventana   window del iframe
 * @param piezas    { visor, escena, guardrail, camara, hotspots, etiquetas, describirParte, modo: { actual, cambiar } }
 * @returns enviar(mensaje)
 */
export function iniciarPuente(ventana, { visor, escena, guardrail, camara, hotspots, etiquetas, describirParte, modo }) {
  const padre = ventana.parent;
  const origen = ventana.location.origin;
  const enviar = mensaje => padre.postMessage({ canal: CANAL, version: VERSION, ...mensaje }, origen);

  /** Escena microscópica: la capa de etiquetas se oculta y vuelven los rótulos nativos del mecanismo. */
  function marcarMicro(activa) {
    ventana.document.body.dataset.micro = activa ? '1' : '0';
    etiquetas.marcarMicro(activa);
  }

  async function emitirEstado() {
    await visor.whenIdle();
    const vista = visor.getState();
    enviar({ type: 'state', vista });
    // La vista cambió (capas, corte, partes) aunque la cámara siga quieta.
    hotspots.refrescar();
    etiquetas.refrescar();
  }

  // Los cambios de vista son asíncronos: se aplican en orden de llegada, cada
  // uno sobre el estado que dejó el anterior. Sin la cola, un restore lento
  // que termina después de showMicro saca al visor de la escena microscópica.
  let cola = Promise.resolve();
  const enCola = tarea => {
    cola = cola.then(tarea).catch(error => console.warn('[puente] error al aplicar', error));
  };

  // Cada manejador valida su carga y devuelve false si no cumple el contrato.
  const manejadores = {
    restore(m) {
      if (!esObjeto(m.vista) || !esObjeto(m.vista.layers) || !esOpcional(m.animar, v => typeof v === 'boolean')) return false;
      enCola(async () => {
        const actual = visor.getState();
        if (m.animar && (m.vista.projection ?? 'perspective') === actual.projection) {
          // Capas y partes de la vista con la cámara actual; después, el vuelo a la de la vista.
          await guardrail.restore({ ...m.vista, camera: actual.camera, target: actual.target, up: actual.up, projection: actual.projection });
          await camara.volar({ camera: m.vista.camera, target: m.vista.target });
        } else {
          await guardrail.restore(m.vista);
        }
        await visor.whenIdle();
        const vista = visor.getState();
        marcarMicro(Boolean(vista.micro));
        etiquetas.alRestaurarVista(vista);
        await emitirEstado();
      });
      return true;
    },
    setLayers(m) {
      if (!esObjeto(m.capas) || !Object.values(m.capas).every(esNivel)) return false;
      enCola(() => guardrail.setLayers(m.capas).then(emitirEstado));
      return true;
    },
    // Sin openSection (main.js), que pisaba capas, isolate y selected y salteaba
    // el guardrail: el corte se aplica sobre la vista vigente.
    showSection(m) {
      if (!EJES.has(m.axis) || !esNumero(m.section) || m.section < 0 || m.section > 100) return false;
      enCola(async () => {
        const actual = visor.getState();
        if (actual.micro) return; // el corte no aplica a la escena microscópica
        await guardrail.restore({ ...actual, axis: m.axis, section: m.section });
        if (m.section > 0) await camara.mirarCorte(m.axis, m.section);
        escena.pedirCuadro();
        await emitirEstado();
      });
      return true;
    },
    flyTo(m) {
      if (!esFlyTo(m)) return false;
      enCola(() => camara.volarA(m).then(emitirEstado));
      return true;
    },
    orientar(m) {
      if (!NOMBRES_DIRECCION.has(m.direccion)) return false;
      enCola(() => camara.orientar(m.direccion).then(emitirEstado));
      return true;
    },
    zoom(m) {
      if (!enRango(m.factor, 0.25, 4)) return false;
      enCola(() => camara.zoom(m.factor).then(emitirEstado));
      return true;
    },
    setNavegacion(m) {
      if (typeof m.mano !== 'boolean') return false;
      camara.fijarMano(m.mano);
      return true;
    },
    showMicro(m) {
      if (m.key !== null && !ESCENAS_MICRO.has(m.key)) return false;
      enCola(() => Promise.resolve(m.key === null ? visor.restore({ ...visor.getState(), micro: null }) : visor.showMicro(m.key))
        .then(() => { guardrail.marcarMicro(m.key !== null); marcarMicro(m.key !== null); return emitirEstado(); }));
      return true;
    },
    setHotspots(m) {
      if (!Array.isArray(m.hotspots) || m.hotspots.length > 200 || !m.hotspots.every(esHotspot)) return false;
      if (m.resaltado !== null && !esTexto(m.resaltado)) return false;
      hotspots.setHotspots(m.hotspots, m.resaltado);
      return true;
    },
    setEtiquetas(m) {
      if (!esSetEtiquetas(m)) return false;
      etiquetas.setEtiquetas(m);
      return true;
    },
    setMode(m) {
      if (!MODOS.has(m.modo)) return false;
      modo.cambiar(m.modo);
      return true;
    },
    setQuality(m) {
      if (!esNumero(m.pixelRatio) || m.pixelRatio < 0.5 || m.pixelRatio > 2 || typeof m.pausar !== 'boolean') return false;
      guardrail.setQuality(m);
      return true;
    },
  };

  ventana.addEventListener('message', evento => {
    if (evento.origin !== origen || evento.source !== padre) return;
    const datos = evento.data;
    if (!esMensajeDelPuente(datos)) return;
    const manejar = Object.hasOwn(manejadores, datos.type) ? manejadores[datos.type] : null;
    if (!manejar) { console.warn('[puente] type desconocido:', datos.type); return; }
    if (datos.type !== 'setQuality') guardrail.registrarInteraccion();
    try {
      if (!manejar(datos)) console.warn('[puente] mensaje rechazado:', datos.type);
    } catch (error) {
      console.warn('[puente] error al aplicar', datos.type, error);
    }
  });

  // pick: un clic (sin arrastre de cámara) sobre una estructura visible.
  let presion = null;
  ventana.addEventListener('pointerdown', evento => {
    if (evento.button !== 0 || evento.target !== escena.contexto.renderer?.domElement) { presion = null; return; }
    presion = { x: evento.clientX, y: evento.clientY, t: performance.now() };
  }, true);
  ventana.addEventListener('pointerup', evento => {
    const inicio = presion;
    presion = null;
    if (!inicio || Math.hypot(evento.clientX - inicio.x, evento.clientY - inicio.y) > CLIC_MAX_PX) return;
    if (performance.now() - inicio.t > CLIC_MAX_MS || hotspots.tocaMarcador(evento) || etiquetas.tocaPin(evento)) return;
    const tocado = escena.tocarCuerpo(evento);
    if (!tocado) return;
    const parte = describirParte(tocado.part_id);
    enviar({
      type: 'pick',
      modo: modo.actual(),
      part_id: tocado.part_id,
      sistema: parte?.sistemas[0] ?? null,
      regiones: parte?.regiones ?? [],
      punto: tocado.punto,
    });
  });

  return enviar;
}
