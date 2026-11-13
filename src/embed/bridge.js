// SemioLab 3D · puente postMessage visor ↔ aplicación v1 (SPEC.md Anexo C y
// Plan de Choque §1.4). Contrato canónico: packages/schema/src/bridge-3d.ts,
// donde la aplicación valida con Zod todo lo que recibe. Este archivo no
// importa el schema (el fork queda aislado del monorepo): verifica origen,
// emisor, canal, `type` y la forma mínima de cada carga; la vista completa la
// valida BodyVista en restore() mediante validateView (src/state.js).

const CANAL = 'semiolab-puente';
const VERSION = 1;
const MODOS = new Set(['explorar', 'marcar:sintoma', 'marcar:signo', 'marcar:foco', 'examinar']);
const TIPOS_HOTSPOT = new Set(['sintoma', 'signo', 'foco']);
const ESCENAS_MICRO = new Set(['alveoli', 'nephron', 'sarcomere', 'synapse', 'villi', 'vessel']);
const EJES = new Set(['x', 'y', 'z']);
const CLIC_MAX_PX = 5;
const CLIC_MAX_MS = 500;

const esObjeto = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const esNumero = v => typeof v === 'number' && Number.isFinite(v);
const esPunto = v => Array.isArray(v) && v.length === 3 && v.every(esNumero);
const esNivel = v => v === 0 || v === 1 || v === 2 || v === 3;
const esTexto = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;

function esMensajeDelPuente(datos) {
  return esObjeto(datos) && datos.canal === CANAL && datos.version === VERSION && typeof datos.type === 'string';
}

function esHotspot(h) {
  return esObjeto(h) && esTexto(h.id) && TIPOS_HOTSPOT.has(h.tipo) && esTexto(h.part_id, 80) && esPunto(h.punto);
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
 * @param piezas    { visor, escena, guardrail, hotspots, describirParte, modo: { actual, cambiar } }
 * @returns enviar(mensaje)
 */
export function iniciarPuente(ventana, { visor, escena, guardrail, hotspots, describirParte, modo }) {
  const padre = ventana.parent;
  const origen = ventana.location.origin;
  const enviar = mensaje => padre.postMessage({ canal: CANAL, version: VERSION, ...mensaje }, origen);

  async function emitirEstado() {
    await visor.whenIdle();
    enviar({ type: 'state', vista: visor.getState() });
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
      if (!esObjeto(m.vista) || !esObjeto(m.vista.layers)) return false;
      enCola(() => guardrail.restore(m.vista).then(emitirEstado));
      return true;
    },
    setLayers(m) {
      if (!esObjeto(m.capas) || !Object.values(m.capas).every(esNivel)) return false;
      enCola(() => guardrail.setLayers(m.capas).then(emitirEstado));
      return true;
    },
    showSection(m) {
      if (!EJES.has(m.axis) || !esNumero(m.section) || m.section < 0 || m.section > 100) return false;
      enCola(() => Promise.resolve(visor.showSection(m.axis))
        .then(() => visor.restore({ ...visor.getState(), axis: m.axis, section: m.section }))
        .then(() => { escena.pedirCuadro(); return emitirEstado(); }));
      return true;
    },
    showMicro(m) {
      if (m.key !== null && !ESCENAS_MICRO.has(m.key)) return false;
      enCola(() => Promise.resolve(m.key === null ? visor.restore({ ...visor.getState(), micro: null }) : visor.showMicro(m.key))
        .then(() => { guardrail.marcarMicro(m.key !== null); return emitirEstado(); }));
      return true;
    },
    setHotspots(m) {
      if (!Array.isArray(m.hotspots) || m.hotspots.length > 200 || !m.hotspots.every(esHotspot)) return false;
      if (m.resaltado !== null && !esTexto(m.resaltado)) return false;
      hotspots.setHotspots(m.hotspots, m.resaltado);
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
    if (performance.now() - inicio.t > CLIC_MAX_MS || hotspots.tocaMarcador(evento)) return;
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
