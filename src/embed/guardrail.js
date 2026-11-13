// SemioLab 3D · Performance Guardrail en ejecución (Plan de Choque §1.4).
// Las constantes replican LIMITES_3D de packages/schema/src/perf.ts (el fork no
// importa el monorepo): si cambian allí, cambian aquí.
//
// Este módulo no importa Three.js ni el catálogo: las reglas son funciones
// puras (probadas con node:test en guardrail.test.js) y la parte de ejecución
// recibe todo lo que necesita por parámetro.

export const LIMITES = Object.freeze({
  maxSistemasNivel3: 2,
  maxSistemasNivel2: 1,
  maxSistemasNivel1: 2,
  presupuestoTriangulos: 900_000,
  pixelRatioMaximo: 1.25,
  pixelRatioDegradado: 1,
  fpsMinimo: 24,
  segundosBajoFps: 3,
  segundosSinInteraccion: 20,
  intervaloStatsMs: 2000,
});

const TOPES = [
  { nivel: 3, maximo: LIMITES.maxSistemasNivel3, destino: 1 }, // G1: el más antiguo baja a 1
  { nivel: 2, maximo: LIMITES.maxSistemasNivel2, destino: 1 }, // G2
  { nivel: 1, maximo: LIMITES.maxSistemasNivel1, destino: 0 }, // G3
];

/**
 * Orden de encendido: los sistemas cambiados pasan al final (más recientes);
 * los apagados salen. Un sistema encendido que no figura se considera el más antiguo.
 */
export function actualizarOrden(orden, cambios) {
  const tocados = Object.keys(cambios);
  const resto = orden.filter(s => !tocados.includes(s));
  return [...resto, ...tocados.filter(s => cambios[s] > 0)];
}

function antiguedad(orden, sistema) {
  const indice = orden.indexOf(sistema);
  return indice === -1 ? -1 : indice;
}

/**
 * G1–G3 sobre un mapa de capas. Devuelve las capas recortadas y los sistemas
 * atenuados (para el aviso neutro). `protegidos` nunca se tocan salvo que no
 * haya otra forma de cumplir el tope.
 */
export function recortarCapas(capas, orden, protegidos = []) {
  const resultado = { ...capas };
  const atenuadas = new Set();
  for (const { nivel, maximo, destino } of TOPES) {
    const enNivel = Object.keys(resultado).filter(s => resultado[s] === nivel);
    const sobrantes = enNivel.length - maximo;
    if (sobrantes <= 0) continue;
    const candidatos = enNivel
      .sort((a, b) => Number(protegidos.includes(a)) - Number(protegidos.includes(b)) || antiguedad(orden, a) - antiguedad(orden, b))
      .slice(0, sobrantes);
    for (const sistema of candidatos) { resultado[sistema] = destino; atenuadas.add(sistema); }
  }
  return { capas: resultado, atenuadas: [...atenuadas] };
}

/** `setLayers`: aplica los cambios pedidos sobre las capas actuales y recorta. */
export function recortarSetLayers(actuales, cambios, orden, protegidos = []) {
  const nuevoOrden = actualizarOrden(orden, cambios);
  const { capas, atenuadas } = recortarCapas({ ...actuales, ...cambios }, nuevoOrden, protegidos);
  return { capas, atenuadas, orden: nuevoOrden.filter(s => capas[s] > 0) };
}

/** `restore`: recorta las capas de la vista; G6: con escena microscópica todas las capas quedan en 0. */
export function recortarVista(vista, orden, protegidos = []) {
  if (vista.micro) {
    const apagadas = Object.fromEntries(Object.keys(vista.layers).map(s => [s, 0]));
    return { vista: { ...vista, layers: apagadas }, atenuadas: [] };
  }
  const { capas, atenuadas } = recortarCapas(vista.layers, orden, protegidos);
  return { vista: { ...vista, layers: capas }, atenuadas };
}

/**
 * Sistemas que sostienen el contenido del caso: los de las partes en
 * `selected` o `isolate` que no están forzadas por `added` (si se apaga su
 * capa, desaparecen). La degradación no los toca.
 */
export function sistemasProtegidos(vista, sistemasDeParte) {
  const agregadas = new Set(vista.added ?? []);
  const partes = [...(vista.selected ?? []), ...(vista.isolate ?? [])].filter(id => !agregadas.has(id));
  return [...new Set(partes.flatMap(sistemasDeParte))];
}

/**
 * Siguiente paso del orden de degradación automática: (1) resolución a 1.0;
 * (2) capas en nivel 1 a 0; (3) capas en nivel 2 a 1; (4) pausa de animaciones.
 * `soloCapas` (exceso de triángulos, G4) salta la resolución y la pausa, que no
 * reducen triángulos. Devuelve null si no queda nada por degradar.
 */
export function siguientePasoDegradacion({ pixelRatio, capas, animacionesPausadas }, protegidos = [], soloCapas = false) {
  if (!soloCapas && pixelRatio > LIMITES.pixelRatioDegradado) return { tipo: 'resolucion', pixelRatio: LIMITES.pixelRatioDegradado };
  for (const [desde, hasta] of [[1, 0], [2, 1]]) {
    const atenuadas = Object.keys(capas).filter(s => capas[s] === desde && !protegidos.includes(s));
    if (atenuadas.length > 0) {
      return { tipo: 'capas', capas: { ...capas, ...Object.fromEntries(atenuadas.map(s => [s, hasta])) }, atenuadas };
    }
  }
  if (!soloCapas && !animacionesPausadas) return { tipo: 'pausa' };
  return null;
}

/**
 * Promedio de cuadros por segundo con render a demanda: en reposo no se dibuja
 * y eso no cuenta como «lento». Sólo se evalúa mientras hay cuadros seguidos.
 */
export class MonitorFps {
  constructor({ ventanaMs = 1000, actividadMs = 250 } = {}) {
    this.ventanaMs = ventanaMs;
    this.actividadMs = actividadMs;
    this.cuadros = [];
    this.bajoDesde = null;
  }

  registrar(ahora) {
    this.cuadros.push(ahora);
    while (this.cuadros.length && this.cuadros[0] < ahora - Math.max(this.ventanaMs, LIMITES.intervaloStatsMs)) this.cuadros.shift();
  }

  fps(ahora, ventanaMs = this.ventanaMs) {
    return this.cuadros.filter(t => t > ahora - ventanaMs).length * (1000 / ventanaMs);
  }

  /** true si el promedio estuvo por debajo del mínimo durante `segundosBajoFps` seguidos. */
  debeDegradar(ahora) {
    const activo = this.cuadros.length > 0 && ahora - this.cuadros[this.cuadros.length - 1] < this.actividadMs;
    if (!activo) { this.bajoDesde = null; return false; }
    // Con menos de una ventana de historia el promedio no es representativo.
    if (ahora - this.cuadros[0] < this.ventanaMs * 0.9) return false;
    if (this.fps(ahora) >= LIMITES.fpsMinimo) { this.bajoDesde = null; return false; }
    this.bajoDesde ??= ahora;
    if (ahora - this.bajoDesde < LIMITES.segundosBajoFps * 1000) return false;
    this.bajoDesde = null;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Render a demanda (G8) con tope de cuadros
// ---------------------------------------------------------------------------

export const FPS_MAXIMO = 60;
/** Margen para que un rAF que llega apenas antes de 1/60 s no pierda el cuadro (pantallas de 120/144/240 Hz). */
const INTERVALO_MINIMO_MS = 1000 / FPS_MAXIMO - 2;
/** En reposo se dibuja igual un cuadro por segundo: cubre cambios internos de BodyVista que no se detectan. */
export const CUADRO_SEGURIDAD_MS = 1000;

/**
 * ¿Se dibuja este cuadro? Nunca más de 60 por segundo; en reposo (sin cambio
 * de cámara ni de lienzo, sin cuadro pedido, sin interacción ni escena
 * animada) sólo el cuadro de seguridad.
 */
export function decidirCuadro({ ahora, ultimoCuadro, cambio, pedido, interactuando, animando }) {
  const transcurrido = ahora - ultimoCuadro;
  if (transcurrido < INTERVALO_MINIMO_MS) return false;
  if (cambio || pedido || interactuando || animando) return true;
  return transcurrido >= CUADRO_SEGURIDAD_MS;
}

/**
 * Variación de matriz por debajo de la cual la imagen no cambia. La
 * amortiguación de OrbitControls deja la cámara moviéndose en cantidades
 * ínfimas que nunca llegan a cero: sin tolerancia, el reposo no existiría.
 */
export const TOLERANCIA_CAMARA = 1e-6;

/** Firma de lo que cambia la imagen sin pasar por el embed: matrices de la cámara y tamaño del lienzo. */
export function crearFirmaCuadro() {
  let anterior = null;
  const leer = (camara, lienzo) => [...camara.matrixWorld.elements, ...camara.projectionMatrix.elements, lienzo.width, lienzo.height];
  return {
    cambio(camara, lienzo) {
      if (anterior === null) return true;
      const actual = leer(camara, lienzo);
      return actual.some((valor, i) => Math.abs(valor - anterior[i]) > TOLERANCIA_CAMARA);
    },
    guardar(camara, lienzo) { anterior = leer(camara, lienzo); },
  };
}

// ---------------------------------------------------------------------------
// Ejecución dentro del visor
// ---------------------------------------------------------------------------

/**
 * @param visor   window.BodyVista
 * @param escena  resultado de crearEscena (escena.js)
 * @param opciones.sistemasDeParte  partId => sistemas
 * @param opciones.alAtenuar        ({ atenuadas, capas }) => void   (aviso neutro)
 * @param opciones.alMedir          ({ fps, triangulos, llamadas }) => void   (cada 2 s)
 * @param opciones.automatico       false en ?perf=1: mide sin degradar
 */
export function iniciarGuardrail(visor, escena, { sistemasDeParte, alAtenuar, alMedir, automatico = true }) {
  const ventana = escena.contexto.renderer?.domElement.ownerDocument.defaultView ?? window;
  const estado = {
    orden: [],
    pixelRatio: Math.min(ventana.devicePixelRatio || 1, LIMITES.pixelRatioMaximo),
    pausadoPorApp: false,
    pausadoPorInactividad: false,
    animacionesPausadas: false,
    /** Escena microscópica abierta: anima en cada cuadro, así que se dibuja (con tope). */
    microActiva: false,
    /** Cuadros dibujados por motivo (calibración, ?perf=1). */
    motivosCuadro: {},
    ultimaInteraccion: performance.now(),
  };
  const monitor = new MonitorFps();
  let rendererEnvuelto = null;

  // G7: una sola animación y nunca desde el puente; playActivity queda deshabilitado en embed.
  visor.playActivity = () => Promise.resolve();

  /**
   * Envuelve renderer.render una sola vez, sin tocar el bucle de BodyVista
   * (main.js dibuja en cada rAF): pausa (G7/setQuality) y render a demanda con
   * tope de 60 cuadros/s (G8). Un cuadro pedido por el embed que cae dentro
   * del tope queda pendiente y sale en el siguiente rAF.
   */
  function envolverRenderer(renderer) {
    if (rendererEnvuelto === renderer) return;
    rendererEnvuelto = renderer;
    renderer.setPixelRatio(estado.pixelRatio);
    const dibujar = renderer.render.bind(renderer);
    const firma = crearFirmaCuadro();
    const cuadro = { ultimo: -Infinity, pendiente: true };
    const motivos = estado.motivosCuadro;
    renderer.render = (escenaThree, camara) => {
      const ahora = performance.now();
      const interactuando = ahora - estado.ultimaInteraccion < 200;
      if (estado.pausadoPorApp || estado.pausadoPorInactividad) return;
      if (escena.contexto.cuadroPropio) cuadro.pendiente = true;
      if (estado.animacionesPausadas && !interactuando && !cuadro.pendiente) return;
      const lienzo = renderer.domElement;
      const condiciones = {
        cambio: firma.cambio(camara, lienzo),
        pedido: cuadro.pendiente,
        interactuando,
        animando: estado.microActiva && !estado.animacionesPausadas,
      };
      const dibuja = decidirCuadro({ ahora, ultimoCuadro: cuadro.ultimo, ...condiciones });
      if (!dibuja) return;
      const motivo = Object.keys(condiciones).find(clave => condiciones[clave]) ?? 'seguridad';
      motivos[motivo] = (motivos[motivo] ?? 0) + 1;
      cuadro.ultimo = ahora;
      cuadro.pendiente = false;
      dibujar(escenaThree, camara);
      firma.guardar(camara, lienzo);
    };
  }

  escena.alDibujar(ahora => {
    if (escena.contexto.renderer) envolverRenderer(escena.contexto.renderer);
    monitor.registrar(ahora);
    if (automatico && monitor.debeDegradar(ahora)) degradar(false);
  });

  function vistaActual() { return visor.getState(); }

  function protegidosActuales() { return sistemasProtegidos(vistaActual(), sistemasDeParte); }

  async function restaurar(vista) {
    await visor.restore(vista);
    escena.pedirCuadro();
  }

  function avisar(atenuadas, capas) {
    if (atenuadas.length > 0) alAtenuar({ atenuadas, capas });
  }

  async function degradar(soloCapas) {
    const actual = vistaActual();
    const paso = siguientePasoDegradacion(
      { pixelRatio: estado.pixelRatio, capas: actual.layers, animacionesPausadas: estado.animacionesPausadas },
      sistemasProtegidos(actual, sistemasDeParte),
      soloCapas,
    );
    if (!paso) return false;
    if (paso.tipo === 'resolucion') {
      estado.pixelRatio = paso.pixelRatio;
      escena.contexto.renderer?.setPixelRatio(paso.pixelRatio);
      escena.pedirCuadro();
    } else if (paso.tipo === 'capas') {
      await restaurar({ ...actual, layers: paso.capas });
      estado.orden = estado.orden.filter(s => paso.capas[s] > 0);
      avisar(paso.atenuadas, paso.capas);
    } else {
      estado.animacionesPausadas = true;
    }
    return true;
  }

  function registrarInteraccion() {
    estado.ultimaInteraccion = performance.now();
    if (estado.pausadoPorInactividad) { estado.pausadoPorInactividad = false; escena.pedirCuadro(); }
  }
  for (const tipo of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) {
    ventana.addEventListener(tipo, registrarInteraccion, { capture: true, passive: true });
  }

  // G7/G8: tras 20 s sin interacción no se dibuja; G4: exceso de triángulos atenúa capas; stats cada 2 s.
  setInterval(() => {
    const ahora = performance.now();
    if (automatico && ahora - estado.ultimaInteraccion > LIMITES.segundosSinInteraccion * 1000) estado.pausadoPorInactividad = true;
    const info = escena.contexto.renderer?.info.render ?? { triangles: 0, calls: 0 };
    const fps = Math.round(monitor.fps(ahora, LIMITES.intervaloStatsMs) * 10) / 10;
    alMedir({ fps, triangulos: info.triangles, llamadas: info.calls });
    if (automatico && info.triangles > LIMITES.presupuestoTriangulos) void degradar(true);
  }, LIMITES.intervaloStatsMs);

  return {
    /** `setLayers` recortado en caliente (G1–G3; G6 mientras haya escena microscópica). */
    async setLayers(cambios) {
      registrarInteraccion();
      const actual = vistaActual();
      if (actual.micro) return;
      const recorte = recortarSetLayers(actual.layers, cambios, estado.orden, protegidosActuales());
      estado.orden = recorte.orden;
      await restaurar({ ...actual, layers: recorte.capas });
      avisar(recorte.atenuadas, recorte.capas);
    },
    /** `restore` recortado en caliente. */
    async restore(vista) {
      registrarInteraccion();
      const encendidas = Object.keys(vista.layers).filter(s => vista.layers[s] > 0);
      estado.orden = estado.orden.filter(s => encendidas.includes(s));
      const recorte = recortarVista(vista, estado.orden, sistemasProtegidos(vista, sistemasDeParte));
      estado.microActiva = Boolean(recorte.vista.micro);
      await restaurar(recorte.vista);
      avisar(recorte.atenuadas, recorte.vista.layers);
    },
    setQuality({ pixelRatio, pausar }) {
      estado.pausadoPorApp = pausar;
      estado.pixelRatio = Math.min(pixelRatio, LIMITES.pixelRatioMaximo);
      escena.contexto.renderer?.setPixelRatio(estado.pixelRatio);
      if (!pausar) registrarInteraccion();
      escena.pedirCuadro();
    },
    /** `showMicro` del puente: con escena microscópica el visor anima y debe dibujar. */
    marcarMicro(activa) {
      estado.microActiva = activa;
      escena.pedirCuadro();
    },
    registrarInteraccion,
    /** Cuadros dibujados por motivo desde la última lectura (calibración). */
    leerMotivosCuadro() {
      const copia = { ...estado.motivosCuadro };
      for (const clave of Object.keys(estado.motivosCuadro)) delete estado.motivosCuadro[clave];
      return copia;
    },
  };
}
