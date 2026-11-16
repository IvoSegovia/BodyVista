// SemioLab 3D · capa de etiquetas con líneas guía (B12; docs/plan-fase-2.md §1.2).
// Reemplaza a las etiquetas nativas (#annotation-labels, oculto en embed.css).
// Una capa <div id="semiolab-etiquetas"> sobre el lienzo, sin eventos de puntero:
// un <svg> para líneas, anclas y pins, y un <div> por texto. La distribución
// (etiquetas-distribucion.js) corre sólo con la cámara quieta; mientras se mueve,
// la capa baja al 25 % y no se toca el DOM en cada cuadro.
import { distribuirEtiquetas, anchoMaximo } from './etiquetas-distribucion.js';
import { COLORES } from './hotspots.js';

export const MODOS_ETIQUETAS = ['auto', 'siempre', 'ocultas'];
const ABIERTA_MS = 5000;
const DESVANECER_MS = 300;
const PERMANENCIA_HOVER_MS = 1500;
const CERCANIA_PIN_PX = 12;
const MAX_SELECCIONADAS = 8;
const UMBRAL_DOM_PX = 0.5;
const SVG = 'http://www.w3.org/2000/svg';
const ID_CURSOR = 'cursor';

export const TONOS = {
  neutro: '#334155',
  sintoma: COLORES.sintoma,
  signo: COLORES.signo,
  foco: COLORES.foco,
  real: '#dc2626',
};

/**
 * @param escena   crearEscena (escena.js)
 * @param opciones.cajaDePartes    (ids) => { min, max } | null
 * @param opciones.nombreParte     (part_id) => nombre en español
 * @param opciones.alCambiarModo   ({ modo }) => void · cuando cambia desde el teclado (L)
 * @param opciones.modoActual      () => modo del visor: el clic sobre un pin sólo fija en `explorar`
 */
export function crearCapaEtiquetas(escena, { cajaDePartes, nombreParte, alCambiarModo = () => {}, modoActual = () => 'explorar', ventana = window }) {
  const documento = ventana.document;
  const raiz = documento.createElement('div');
  raiz.id = 'semiolab-etiquetas';
  const svg = documento.createElementNS(SVG, 'svg');
  svg.classList.add('semiolab-etiquetas-lineas');
  const capaEnlaces = documento.createElementNS(SVG, 'g');
  const capaLineas = documento.createElementNS(SVG, 'g');
  const capaGrupos = documento.createElementNS(SVG, 'g');
  svg.append(capaEnlaces, capaLineas, capaGrupos);
  const capaNumeros = documento.createElement('div');
  raiz.append(svg, capaNumeros);
  documento.body.append(raiz);

  let modo = 'auto';
  let margenes = { arriba: 0, abajo: 0, izquierda: 0 };
  let micro = false;
  let resaltado = null;
  /** id → entrada { id, texto, origen, prioridad, tono, columna, ancla, abiertaHasta, fija, cerca, cercaHasta, nodos } */
  const entradas = new Map();
  let enlaces = [];
  let grupos = [];
  /** ids marcados en un grupo de marcadores: su texto no se abre al pasar el cursor. */
  let idsAgrupados = new Set();
  /** Medidas por texto y ancho máximo (se mide una vez por texto). */
  const medidas = new Map();
  /** Proyecciones de la última distribución, para el cursor y los clics. */
  let proyectadas = new Map();
  let temporizador = 0;
  let temporizadorSalida = 0;

  // ------------------------------------------------------------------ fuentes

  function quitarOrigen(origen, conservar = new Set()) {
    for (const [id, e] of entradas) {
      if (e.origen === origen && !conservar.has(id)) { liberar(e); entradas.delete(id); }
    }
  }

  function poner(datos, abrir) {
    const previa = entradas.get(datos.id);
    if (previa) {
      const textoCambio = previa.texto !== datos.texto;
      Object.assign(previa, datos);
      if (textoCambio) previa.nodos.texto.textContent = datos.texto;
      return previa;
    }
    const entrada = { ...datos, abiertaHasta: abrir ? ahora() + ABIERTA_MS : 0, fija: false, cerca: false, cercaHasta: 0, nodos: crearNodos(datos) };
    entradas.set(datos.id, entrada);
    return entrada;
  }

  /** Vista restaurada: sus `labels` y hasta 8 `selected`; todas se abren 5 s. */
  function alRestaurarVista(vista) {
    micro = Boolean(vista.micro);
    quitarOrigen('vista');
    (vista.labels ?? []).forEach((label, i) => {
      if (typeof label.text !== 'string' || label.text.trim() === '' || !Array.isArray(label.position)) return;
      poner({ id: `vista:label:${i}`, texto: label.text, origen: 'vista', prioridad: 2, tono: 'neutro', ancla: { punto: label.position } }, true);
    });
    for (const partId of (vista.selected ?? []).slice(0, MAX_SELECCIONADAS)) {
      const texto = nombreParte(partId);
      if (texto) poner({ id: `vista:sel:${partId}`, texto, origen: 'vista', prioridad: 2, tono: 'neutro', ancla: { part_id: partId } }, true);
    }
    const hasta = ahora() + ABIERTA_MS;
    for (const e of entradas.values()) if (e.origen !== 'hotspot') e.abiertaHasta = hasta;
    actualizar();
  }

  /** Mensaje setEtiquetas (ya validado): cada campo presente reemplaza al anterior. */
  function setEtiquetas(m) {
    if (m.modo !== undefined) modo = m.modo;
    if (m.margenes !== undefined) margenes = { izquierda: 0, ...m.margenes };
    if (m.etiquetas !== undefined) {
      quitarOrigen('app', new Set(m.etiquetas.map(e => `app:${e.id}`)));
      for (const e of m.etiquetas) {
        poner({
          id: `app:${e.id}`,
          texto: e.texto,
          origen: 'app',
          prioridad: e.prioridad ?? 3,
          tono: e.tono ?? 'neutro',
          columna: e.columna,
          ancla: e.part_id !== undefined ? { part_id: e.part_id } : { punto: e.punto },
        }, true);
      }
    }
    if (m.enlaces !== undefined) enlaces = m.enlaces.map(e => ({ ...e }));
    actualizar();
  }

  /** Marcadores con texto (prioridad 1): colapsados salvo cursor encima, resaltado o modo «siempre». */
  function setMarcadores(lista, idResaltado) {
    resaltado = idResaltado ? `hotspot:${idResaltado}` : null;
    const conTexto = lista.filter(h => typeof h.texto === 'string' && h.texto !== '');
    quitarOrigen('hotspot', new Set(conTexto.map(h => `hotspot:${h.id}`)));
    for (const h of conTexto) {
      poner({ id: `hotspot:${h.id}`, texto: h.texto, origen: 'hotspot', prioridad: 1, tono: h.tipo, ancla: { punto: h.punto }, partId: h.part_id }, false);
    }
    actualizar();
  }

  /**
   * B14: rótulo bajo el cursor ({ texto, punto } o null): punto semiológico en
   * modo examinar, estructura en explorar y foco. Prioridad 3, tono neutro,
   * abierto mientras el cursor esté encima; no cuenta como etiqueta de la app.
   */
  function setCursor(datos) {
    if (!datos) {
      if (!entradas.has(ID_CURSOR)) return;
      quitarOrigen('cursor');
    } else {
      poner({ id: ID_CURSOR, texto: datos.texto, origen: 'cursor', prioridad: 3, tono: 'neutro', ancla: { punto: datos.punto } }, false);
    }
    documento.body.dataset.etiquetaCursor = datos?.texto ?? '';
    actualizar();
  }

  function setGrupos(lista) {
    grupos = lista;
    idsAgrupados = new Set(lista.flatMap(g => g.ids.map(id => `hotspot:${id}`)));
    dibujarGrupos();
  }

  function marcarMicro(activa) {
    micro = activa;
    actualizar();
  }

  function fijarModo(nuevo, desdeTeclado) {
    if (!MODOS_ETIQUETAS.includes(nuevo) || nuevo === modo) return;
    modo = nuevo;
    if (nuevo === 'auto') {
      const hasta = ahora() + ABIERTA_MS;
      for (const e of entradas.values()) if (e.origen !== 'hotspot') e.abiertaHasta = hasta;
    }
    if (desdeTeclado) alCambiarModo({ modo });
    actualizar();
  }

  // ------------------------------------------------------------------ estado

  function ahora() {
    return performance.now();
  }

  function abierta(e, t) {
    if (micro) return false;
    if (e.origen === 'cursor') return true;
    if (modo === 'ocultas') return false;
    if (modo === 'siempre') return true;
    if (e.origen === 'hotspot') return e.id === resaltado || (e.cerca && !idsAgrupados.has(e.id));
    return e.fija || e.cerca || t < e.abiertaHasta || t < e.cercaHasta;
  }

  function puntoAncla(e) {
    if (e.ancla.punto) return e.ancla.punto;
    if (!escena.estaVisible(e.ancla.part_id)) return null;
    const caja = cajaDePartes([e.ancla.part_id]);
    return caja ? caja.min.map((v, i) => (v + caja.max[i]) / 2) : null;
  }

  // ------------------------------------------------------------------ DOM

  function crearNodos(datos) {
    const texto = documento.createElement('div');
    texto.className = 'semiolab-etiqueta';
    texto.dataset.id = datos.id;
    texto.dataset.tono = datos.tono ?? 'neutro';
    texto.textContent = datos.texto;
    texto.style.visibility = 'hidden';
    capaNumeros.append(texto);
    const linea = documento.createElementNS(SVG, 'polyline');
    linea.classList.add('semiolab-linea');
    linea.setAttribute('stroke', TONOS[datos.tono] ?? TONOS.neutro);
    linea.style.visibility = 'hidden';
    const punto = documento.createElementNS(SVG, 'circle');
    punto.classList.add('semiolab-ancla');
    punto.dataset.id = datos.id;
    punto.setAttribute('fill', TONOS[datos.tono] ?? TONOS.neutro);
    punto.style.visibility = 'hidden';
    capaLineas.append(linea, punto);
    return { texto, linea, punto, ultima: null };
  }

  function liberar(e) {
    e.nodos.texto.remove();
    e.nodos.linea.remove();
    e.nodos.punto.remove();
  }

  // Medidor aparte, con la misma clase y el borde de tono de 3 px: la caja medida
  // es exactamente la que se dibuja (si no, el texto se parte en otra línea).
  const medidor = documento.createElement('div');
  medidor.className = 'semiolab-etiqueta semiolab-medidor';
  medidor.dataset.lado = 'derecha';
  raiz.append(medidor);

  function medir(e, wMax) {
    const clave = `${wMax}|${e.texto}`;
    let medida = medidas.get(clave);
    if (!medida) {
      medidor.textContent = e.texto;
      medidor.style.width = '';
      medidor.style.maxWidth = `${wMax}px`;
      medidor.style.display = 'inline-block';
      const ancho = Math.min(wMax, Math.ceil(medidor.getBoundingClientRect().width) + 1);
      medidor.style.display = '';
      medidor.style.width = `${ancho}px`;
      medida = { ancho, alto: Math.ceil(medidor.getBoundingClientRect().height) };
      medidor.textContent = '';
      medidas.set(clave, medida);
    }
    return medida;
  }

  const lejos = (a, b) => a === null || b === null || Math.abs(a - b) > UMBRAL_DOM_PX;

  function mostrar(nodo, visible) {
    const valor = visible ? 'visible' : 'hidden';
    if (nodo.style.visibility !== valor) nodo.style.visibility = valor;
  }

  /** Escribe la posición de una entrada sólo si algo cambió más de medio píxel. */
  function dibujarEntrada(e, caja, pin) {
    const { texto, linea, punto } = e.nodos;
    const previa = e.nodos.ultima ?? {};
    if (caja) {
      if (lejos(previa.x ?? null, caja.x) || lejos(previa.y ?? null, caja.y) || previa.ancho !== caja.ancho) {
        texto.style.transform = `translate(${caja.x}px, ${caja.y}px)`;
        texto.style.width = `${caja.ancho}px`;
        texto.style.maxWidth = `${caja.ancho}px`;
      }
      const puntos = [[caja.ax, caja.ay], caja.codo, caja.borde];
      const firma = puntos.flat();
      if (!previa.linea || firma.some((v, i) => lejos(previa.linea[i], v))) {
        linea.setAttribute('points', puntos.map(p => p.map(v => v.toFixed(1)).join(',')).join(' '));
      }
      texto.dataset.lado = caja.lado;
      e.nodos.ultima = { x: caja.x, y: caja.y, ancho: caja.ancho, linea: firma, ax: caja.ax, ay: caja.ay };
      texto.style.opacity = '1';
      linea.style.opacity = '';
      mostrar(texto, true);
      mostrar(linea, true);
    } else {
      mostrar(texto, false);
      mostrar(linea, false);
      e.nodos.ultima = { ...previa, ax: pin?.ax, ay: pin?.ay };
    }
    const ancla = caja ?? pin;
    // Los marcadores ya son su propio pin: no se dibuja otro encima.
    const conPunto = ancla && e.origen !== 'hotspot';
    if (conPunto) {
      if (lejos(Number(punto.getAttribute('cx')), ancla.ax) || lejos(Number(punto.getAttribute('cy')), ancla.ay)) {
        punto.setAttribute('cx', ancla.ax.toFixed(1));
        punto.setAttribute('cy', ancla.ay.toFixed(1));
      }
      const r = caja ? '1.5' : '4';
      if (punto.getAttribute('r') !== r) punto.setAttribute('r', r);
      punto.classList.toggle('pin', !caja);
    }
    punto.dataset.estado = caja ? 'abierta' : 'pin';
    texto.dataset.estado = caja ? 'abierta' : 'pin';
    mostrar(punto, Boolean(conPunto));
  }

  function ajustarRaiz() {
    const lienzo = escena.contexto.renderer?.domElement;
    if (!lienzo) return;
    const caja = lienzo.getBoundingClientRect();
    const estilo = raiz.style;
    const valores = { left: `${caja.left}px`, top: `${caja.top}px`, width: `${caja.width}px`, height: `${caja.height}px` };
    for (const [clave, valor] of Object.entries(valores)) if (estilo[clave] !== valor) estilo[clave] = valor;
  }

  // ------------------------------------------------------------------ distribución

  /** Mostradas en la última distribución: al cerrarse se desvanecen antes de reubicar a las demás. */
  let mostradas = new Set();
  let saliendo = false;

  function actualizar() {
    clearTimeout(temporizador);
    if (saliendo || escena.enMovimiento() || !escena.contexto.camara) return;
    const t = ahora();
    const cerradas = [...mostradas].filter(id => {
      const e = entradas.get(id);
      return e && !abierta(e, t);
    });
    if (cerradas.length === 0) { distribuir(t); programar(t); return; }
    // Desvanecer en 300 ms; recién después se redistribuye sin ellas.
    saliendo = true;
    for (const id of cerradas) {
      const { texto, linea } = entradas.get(id).nodos;
      texto.style.opacity = '0';
      linea.style.opacity = '0';
    }
    temporizadorSalida = setTimeout(() => {
      saliendo = false;
      if (escena.enMovimiento()) return;
      distribuir(ahora());
      programar(ahora());
    }, DESVANECER_MS);
  }

  function distribuir(t) {
    ajustarRaiz();
    const { ancho, alto } = escena.tamanoLienzo();
    const wMax = anchoMaximo(ancho);
    const derecha = escena.derechaCamara();
    proyectadas = new Map();
    const candidatas = [];
    for (const e of entradas.values()) {
      const punto = micro ? null : puntoAncla(e);
      const p = punto ? escena.proyectar(punto) : null;
      if (!p || !p.dentro) { dibujarEntrada(e, null, null); continue; }
      const eje = escena.proyectar([0, 0, punto[2]]);
      proyectadas.set(e.id, { ax: p.x, ay: p.y });
      if (!abierta(e, t)) continue;
      const medida = medir(e, wMax);
      candidatas.push({
        id: e.id,
        ax: p.x,
        ay: p.y,
        xc: eje.x,
        lado3d: punto[0] * derecha[0] + punto[1] * derecha[1],
        alto: medida.alto,
        ancho: medida.ancho,
        // La que el usuario abrió con el cursor gana lugar.
        prioridad: e.cerca ? 4 : e.prioridad,
        columna: e.columna,
      });
    }
    const { cajas, pins } = distribuirEtiquetas({ ancho, alto, margenes, etiquetas: candidatas });
    const cajaDe = new Map(cajas.map(c => [c.id, c]));
    const pinDe = new Map(pins.map(p => [p.id, p]));
    mostradas = new Set(cajas.map(c => c.id));
    for (const e of entradas.values()) {
      const p = proyectadas.get(e.id);
      if (!p) continue;
      dibujarEntrada(e, cajaDe.get(e.id) ?? null, pinDe.get(e.id) ?? p);
    }
    dibujarEnlaces();
    dibujarGrupos();
    publicarConteo();
  }

  /** Próximo vencimiento (fin de los 5 s o de la permanencia del cursor). */
  function programar(t) {
    let proximo = Infinity;
    if (modo === 'auto' && !micro) {
      for (const e of entradas.values()) {
        for (const limite of [e.abiertaHasta, e.cercaHasta]) if (limite > t) proximo = Math.min(proximo, limite);
      }
    }
    if (proximo < Infinity) temporizador = setTimeout(actualizar, proximo - t + 5);
  }

  function dibujarEnlaces() {
    const nodos = enlaces.flatMap(enlace => {
      if (micro) return [];
      const a = escena.proyectar(enlace.de);
      const b = escena.proyectar(enlace.a);
      if (!a.dentro || !b.dentro) return [];
      const linea = documento.createElementNS(SVG, 'line');
      linea.classList.add('semiolab-enlace');
      linea.setAttribute('x1', a.x.toFixed(1));
      linea.setAttribute('y1', a.y.toFixed(1));
      linea.setAttribute('x2', b.x.toFixed(1));
      linea.setAttribute('y2', b.y.toFixed(1));
      linea.setAttribute('stroke', TONOS[enlace.tono] ?? TONOS.neutro);
      return [linea];
    });
    capaEnlaces.replaceChildren(...nodos);
  }

  /** Grupos de marcadores: pin con número; abierto, abanico con un hilo a la posición real de cada uno. */
  function dibujarGrupos() {
    const nodos = [];
    for (const grupo of micro ? [] : grupos) {
      if (grupo.abierto) {
        for (const m of grupo.abanico) {
          const hilo = documento.createElementNS(SVG, 'line');
          hilo.classList.add('semiolab-hilo');
          hilo.setAttribute('x1', m.fx.toFixed(1));
          hilo.setAttribute('y1', m.fy.toFixed(1));
          hilo.setAttribute('x2', m.x.toFixed(1));
          hilo.setAttribute('y2', m.y.toFixed(1));
          const disco = documento.createElementNS(SVG, 'circle');
          disco.classList.add('semiolab-abanico');
          disco.dataset.id = m.id;
          disco.setAttribute('cx', m.fx.toFixed(1));
          disco.setAttribute('cy', m.fy.toFixed(1));
          disco.setAttribute('r', '6');
          disco.setAttribute('fill', COLORES[m.tipo] ?? TONOS.neutro);
          nodos.push(hilo, disco);
        }
      } else {
        const g = documento.createElementNS(SVG, 'g');
        g.classList.add('semiolab-grupo');
        g.dataset.n = String(grupo.ids.length);
        const circulo = documento.createElementNS(SVG, 'circle');
        circulo.setAttribute('cx', grupo.x.toFixed(1));
        circulo.setAttribute('cy', grupo.y.toFixed(1));
        circulo.setAttribute('r', '9');
        const numero = documento.createElementNS(SVG, 'text');
        numero.setAttribute('x', grupo.x.toFixed(1));
        numero.setAttribute('y', grupo.y.toFixed(1));
        numero.textContent = String(grupo.ids.length);
        g.append(circulo, numero);
        nodos.push(g);
      }
    }
    capaGrupos.replaceChildren(...nodos);
  }

  /** Conteos en <body data-etiquetas-*>: los leen las pruebas e2e. */
  function publicarConteo() {
    const cuerpo = documento.body;
    cuerpo.dataset.etiquetasModo = modo;
    // El rótulo del cursor (B14) no cuenta: es la herramienta, no una etiqueta.
    cuerpo.dataset.etiquetasAbiertas = String([...mostradas].filter(id => id !== ID_CURSOR).length);
    cuerpo.dataset.etiquetasPins = String([...entradas.values()].filter(e => e.origen !== 'hotspot' && e.origen !== 'cursor' && proyectadas.has(e.id) && !mostradas.has(e.id)).length);
  }

  // ------------------------------------------------------------------ cámara

  escena.alMoverCamara(() => {
    clearTimeout(temporizador);
    clearTimeout(temporizadorSalida);
    saliendo = false;
    raiz.classList.add('moviendo');
  });
  escena.alReposar(() => {
    raiz.classList.remove('moviendo');
    actualizar();
  });

  // ------------------------------------------------------------------ puntero y teclado

  function puntoEnLienzo(evento) {
    const lienzo = escena.contexto.renderer?.domElement;
    if (!lienzo || evento.target !== lienzo) return null;
    const caja = lienzo.getBoundingClientRect();
    return { x: evento.clientX - caja.left, y: evento.clientY - caja.top };
  }

  /** Entrada cuyo pin (o marcador) está a menos de 12 px del punto. */
  function entradaCerca(p) {
    let mejor = null;
    let distanciaMejor = CERCANIA_PIN_PX;
    for (const [id, a] of proyectadas) {
      if (id === ID_CURSOR) continue;
      const d = Math.hypot(a.ax - p.x, a.ay - p.y);
      if (d < distanciaMejor) { mejor = entradas.get(id) ?? null; distanciaMejor = d; }
    }
    return mejor;
  }

  let cuadroPuntero = 0;
  let ultimoPuntero = null;
  ventana.addEventListener('pointermove', evento => {
    if (evento.pointerType === 'touch' || evento.buttons !== 0) return;
    ultimoPuntero = puntoEnLienzo(evento);
    if (cuadroPuntero) return;
    cuadroPuntero = ventana.requestAnimationFrame(() => {
      cuadroPuntero = 0;
      revisarCercania(ultimoPuntero);
    });
  }, { capture: true, passive: true });
  documento.addEventListener('pointerleave', () => revisarCercania(null));

  function revisarCercania(p) {
    if (escena.enMovimiento() || modo === 'ocultas') return;
    const cerca = p ? entradaCerca(p) : null;
    let cambio = false;
    const t = ahora();
    for (const e of entradas.values()) {
      const ahoraCerca = e === cerca;
      if (e.cerca === ahoraCerca) continue;
      e.cerca = ahoraCerca;
      if (!ahoraCerca) e.cercaHasta = t + PERMANENCIA_HOVER_MS;
      cambio = true;
    }
    if (cambio) actualizar();
  }

  // Clic (sin arrastre) sobre un pin en modo explorar: la etiqueta queda fija (o se suelta).
  let presion = null;
  ventana.addEventListener('pointerdown', evento => {
    const p = puntoEnLienzo(evento);
    presion = p && evento.button === 0 ? { ...p, t: ahora() } : null;
  }, { capture: true, passive: true });
  ventana.addEventListener('pointerup', evento => {
    const inicio = presion;
    presion = null;
    const p = puntoEnLienzo(evento);
    if (!inicio || !p || Math.hypot(p.x - inicio.x, p.y - inicio.y) > 5 || ahora() - inicio.t > 500) return;
    const e = pinBajo(p);
    if (!e) return;
    e.fija = !e.fija;
    if (!e.fija) e.abiertaHasta = 0;
    actualizar();
  }, { capture: true, passive: true });

  function pinBajo(p) {
    if (modo !== 'auto' || modoActual() !== 'explorar') return null;
    const e = entradaCerca(p);
    return e && e.origen !== 'hotspot' ? e : null;
  }

  ventana.addEventListener('keydown', evento => {
    if (evento.ctrlKey || evento.metaKey || evento.altKey || evento.repeat) return;
    if (/INPUT|TEXTAREA|SELECT/.test(documento.activeElement?.tagName ?? '')) return;
    if (evento.key !== 'l' && evento.key !== 'L') return;
    fijarModo(MODOS_ETIQUETAS[(MODOS_ETIQUETAS.indexOf(modo) + 1) % MODOS_ETIQUETAS.length], true);
  });

  publicarConteo();

  return {
    setEtiquetas,
    setMarcadores,
    setGrupos,
    setCursor,
    alRestaurarVista,
    marcarMicro,
    /** La vista cambió sin mover la cámara (capas, corte): anclas visibles y proyecciones. */
    refrescar: actualizar,
    modo: () => modo,
    /** true si el clic cae sobre un pin que fija su etiqueta: el puente no lo trata como pick. */
    tocaPin(evento) {
      const p = puntoEnLienzo(evento);
      return Boolean(p && pinBajo(p));
    },
  };
}
