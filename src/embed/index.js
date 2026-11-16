// SemioLab 3D · punto de entrada del modo embed. Se carga después de main.js
// (index.html), por lo que window.BodyVista ya está definido.
import './embed.css';
import { cuandoEsteCargado, iniciarPuente } from './bridge.js';
import { cajaDePartes, crearEscena, describirParte, sistemasDeParte } from './escena.js';
import { crearCamara } from './camara.js';
import { iniciarGuardrail } from './guardrail.js';
import { crearCapaHotspots } from './hotspots.js';
import { crearCapaEtiquetas } from './etiquetas.js';
import { exponerCalibracion } from './perf.js';
import { fijarEspanol, nombreEnEspanol } from './idioma.js';
import { translateDOM, useDerivedLanguage } from '../i18n.js';

const parametros = new URLSearchParams(location.search);

async function iniciarEmbed(ventana, { perf }) {
  const visor = ventana.BodyVista;
  if (!visor) { console.error('[embed] window.BodyVista no está disponible'); return; }
  await cuandoEsteCargado(ventana.document);
  await visor.whenIdle();
  translateDOM(); // texto que main.js armó durante la carga

  const escena = crearEscena(visor);
  const embebido = ventana.parent !== ventana;
  let enviar = () => {};
  let modoActual = 'explorar';
  const modo = {
    actual: () => modoActual,
    cambiar(nuevo) {
      modoActual = nuevo;
      ventana.document.body.dataset.modo = nuevo;
    },
  };

  const guardrail = iniciarGuardrail(visor, escena, {
    sistemasDeParte,
    automatico: !perf,
    alAtenuar: ({ atenuadas, capas }) => enviar({ type: 'guardrail', atenuadas, capas }),
    alMedir: medida => enviar({ type: 'stats', ...medida }),
  });
  const camara = crearCamara(visor, escena, guardrail, {
    modoActual: modo.actual,
    cajaDePartes,
    alCambiarNavegacion: ({ mano }) => enviar({ type: 'navegacion', mano }),
  });
  const etiquetas = crearCapaEtiquetas(escena, {
    cajaDePartes,
    nombreParte: nombreEnEspanol,
    modoActual: modo.actual,
    alCambiarModo: ({ modo: modoEtiquetas }) => enviar({ type: 'etiquetas', modo: modoEtiquetas }),
  });
  const hotspots = crearCapaHotspots(escena, {
    modoActual: modo.actual,
    alMover: movido => enviar({ type: 'hotspotMoved', ...movido }),
    alTocar: id => enviar({ type: 'hotspotClicked', id }),
    capa: etiquetas,
  });
  escena.pedirCuadro();

  if (perf) exponerCalibracion(ventana, visor, escena, { hotspots, describirParte, guardrail });
  if (!embebido) return; // Sin anfitrión no hay a quién avisar.

  enviar = iniciarPuente(ventana, { visor, escena, guardrail, camara, hotspots, etiquetas, describirParte, modo });
  enviar({ type: 'ready', conteos: visor.getCounts() });
}

if (parametros.get('embed') === '1') {
  document.body.classList.add('embed');
  try {
    fijarEspanol(window, useDerivedLanguage);
  } finally {
    document.documentElement.style.removeProperty('visibility'); // ver index.html
  }
  iniciarEmbed(window, { perf: parametros.get('perf') === '1' }).catch(error => console.error('[embed]', error));
}
