// SemioLab 3D · puente postMessage visor ↔ aplicación (SPEC.md Anexo C).
// Contrato canónico: packages/schema/src/bridge-3d.ts. Este archivo no importa
// el schema (el fork queda aislado del monorepo): verifica origen, emisor, canal
// y `type`; la forma de la vista la valida el propio BodyVista en restore()
// mediante validateView (src/state.js).

const CANAL = 'semiolab-puente';
const VERSION = 1;

function esMensajeDelPuente(datos) {
  return typeof datos === 'object' && datos !== null &&
    datos.canal === CANAL && datos.version === VERSION && typeof datos.type === 'string';
}

// BodyVista marca <body data-ready="true"> al terminar la carga inicial (main.js).
function cuandoEsteCargado(documento) {
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

const manejadores = {
  restore(visor, mensaje) {
    if (typeof mensaje.vista !== 'object' || mensaje.vista === null) return false;
    visor.restore(mensaje.vista);
    return true;
  },
};

export function iniciarPuente(ventana) {
  const padre = ventana.parent;
  if (padre === ventana) return; // No está embebido: no hay a quién avisar.
  const origen = ventana.location.origin;
  const visor = ventana.BodyVista;
  if (!visor) { console.error('[puente] window.BodyVista no está disponible'); return; }

  const enviar = mensaje => padre.postMessage({ canal: CANAL, version: VERSION, ...mensaje }, origen);

  ventana.addEventListener('message', evento => {
    if (evento.origin !== origen || evento.source !== padre) return;
    const datos = evento.data;
    if (!esMensajeDelPuente(datos)) return;
    const manejar = Object.hasOwn(manejadores, datos.type) ? manejadores[datos.type] : null;
    if (!manejar) { console.warn('[puente] type desconocido:', datos.type); return; }
    if (!manejar(visor, datos)) console.warn('[puente] mensaje rechazado:', datos.type);
  });

  cuandoEsteCargado(ventana.document)
    .then(() => visor.whenIdle())
    .then(() => enviar({ type: 'ready', conteos: visor.getCounts() }))
    .catch(error => console.error('[puente]', error));
}
