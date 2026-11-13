// SemioLab 3D · idioma fijo del modo embed: español, con respaldo en inglés.
// Nunca chino ni japonés (src/i18n.js → useDerivedLanguage).
import anatomia from '../locales/anatomy.json' with { type: 'json' };
import catalogo from '../../catalog.json' with { type: 'json' };
import { ESCENAS_MICRO, INTERFAZ, PARTES } from './es-dict.js';

/** Nombre inglés con el que BodyVista muestra una estructura (anatomy.json). */
function nombreIngles(parte) {
  return anatomia[parte.name]?.[0];
}

/** inglés → español: interfaz, escenas microscópicas y estructuras de los casos. */
export function crearTablaEspanol() {
  const tabla = new Map([...Object.entries(INTERFAZ), ...Object.entries(ESCENAS_MICRO)]);
  for (const parte of catalogo.parts) {
    const espanol = PARTES[parte.id];
    const ingles = nombreIngles(parte);
    if (espanol && ingles) tabla.set(ingles, espanol);
  }
  return tabla;
}

const SEPARADORES = [' · ', ': '];

/**
 * Traduce un texto ya resuelto al inglés. Las frases compuestas por BodyVista
 * («Corazón · Pulmones», «Sistema: Contorno») se traducen por partes; la parte
 * que no figura queda en inglés. Devuelve undefined si nada cambió.
 */
export function crearTraductor(tabla) {
  function traducir(texto) {
    const exacto = tabla.get(texto);
    if (exacto !== undefined) return exacto;
    for (const separador of SEPARADORES) {
      if (!texto.includes(separador)) continue;
      const partes = texto.split(separador);
      const traducidas = partes.map(parte => traducir(parte.trim()) ?? parte);
      if (traducidas.some((parte, i) => parte !== partes[i])) return traducidas.join(separador);
    }
    return undefined;
  }
  return traducir;
}

/** Fija el español en el documento del visor (título incluido). */
export function fijarEspanol(ventana, useDerivedLanguage) {
  const traducir = crearTraductor(crearTablaEspanol());
  useDerivedLanguage({ code: 'es', base: 'en', translate: traducir });
  return traducir;
}
