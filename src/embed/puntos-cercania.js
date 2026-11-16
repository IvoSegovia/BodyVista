// SemioLab 3D · puntos semiológicos (B14): decisiones puras, sin Three.js ni DOM,
// para probarlas con node --test. La capa que dibuja está en puntos.js.

/** Un punto se elige si el toque cae a menos de 1,6 radios de su ancla. */
export const FACTOR_RADIO = 1.6;
export const ESTADOS_PUNTO = ['neutro', 'examinado', 'hallazgo'];
export const MODOS_MOSTRAR = ['hover', 'todos', 'ninguno'];
/** Radio máximo del disco de hallazgo (unidades de escena). */
export const RADIO_DISCO_MAX = 0.04;

const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const producto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Punto más cercano al punto de piel tocado, dentro de FACTOR_RADIO radios.
 * Con `normal`, descarta los de la cara opuesta (p. ej. la cara medial del
 * brazo cuando se toca la lateral): la piel tocada y el punto deben mirar
 * hacia el mismo lado.
 * @returns id del punto o null
 */
export function puntoMasCercano(puntos, tocado, normal = null) {
  let mejor = null;
  let distanciaMejor = Infinity;
  for (const p of puntos) {
    const d = distancia(p.punto, tocado);
    if (d > p.radio * FACTOR_RADIO || d >= distanciaMejor) continue;
    if (normal && producto(normal, p.normal) <= 0) continue;
    mejor = p.id;
    distanciaMejor = d;
  }
  return mejor;
}

/**
 * ¿Se dibuja el punto? El que está bajo el cursor (modo examinar) siempre;
 * «todos»: todos; «hover»: los examinados y con hallazgo; «ninguno»: sólo el
 * del cursor (el interruptor «Hallazgos» apaga el mapa, no la herramienta).
 */
export function puntoVisible(estado, mostrar, bajoCursor) {
  if (bajoCursor) return true;
  if (mostrar === 'todos') return true;
  if (mostrar === 'ninguno') return false;
  return estado !== 'neutro';
}

/**
 * Piezas de cada estado: aro (siempre), punto central (examinado) y disco
 * cian al 35 % (hallazgo). Radios relativos al del punto; el disco, ≤ 0,04.
 */
export function piezasDelEstado(estado, radio) {
  const hallazgo = estado === 'hallazgo';
  return {
    aro: { interior: radio * (hallazgo ? 0.82 : 0.86), exterior: radio, color: hallazgo ? '#06b6d4' : '#64748b', opacidad: hallazgo ? 0.95 : 0.85 },
    centro: estado === 'examinado' ? { radio: radio * 0.18, color: '#64748b', opacidad: 0.9 } : null,
    disco: hallazgo ? { radio: Math.min(radio * 0.82, RADIO_DISCO_MAX), color: '#06b6d4', opacidad: 0.35 } : null,
  };
}

/** Valida un punto de setPuntos (forma mínima; el contrato canónico es bridge-3d.ts). */
export function esPuntoVisor(p) {
  const esNumero = v => typeof v === 'number' && Number.isFinite(v);
  const esTriple = v => Array.isArray(v) && v.length === 3 && v.every(esNumero);
  return typeof p === 'object' && p !== null
    && typeof p.id === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(p.id)
    && typeof p.nombre === 'string' && p.nombre.trim().length > 0 && p.nombre.length <= 120
    && esTriple(p.punto) && esTriple(p.normal) && Math.hypot(...p.normal) > 1e-6
    && esNumero(p.radio) && p.radio > 0 && p.radio <= 0.1
    && ESTADOS_PUNTO.includes(p.estado);
}

export function esSetPuntos(m) {
  return Array.isArray(m.puntos) && m.puntos.length <= 80 && m.puntos.every(esPuntoVisor)
    && new Set(m.puntos.map(p => p.id)).size === m.puntos.length
    && MODOS_MOSTRAR.includes(m.mostrar);
}

/** Limita una función a una llamada cada `ms` (la última pendiente se ejecuta al vencer). */
export function limitarFrecuencia(funcion, ms, reloj = () => performance.now(), programar = setTimeout) {
  let ultima = -Infinity;
  let pendiente = null;
  let temporizador = null;
  return argumento => {
    pendiente = argumento;
    const t = reloj();
    if (t - ultima >= ms) {
      ultima = t;
      pendiente = null;
      funcion(argumento);
      return;
    }
    if (temporizador !== null) return;
    temporizador = programar(() => {
      temporizador = null;
      ultima = reloj();
      const valor = pendiente;
      pendiente = null;
      funcion(valor);
    }, ms - (t - ultima));
  };
}
