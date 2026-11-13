// SemioLab 3D · español del modo embed (src/embed/es-dict.js, src/embed/idioma.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ui from '../src/locales/ui.js';
import micro from '../src/locales/micro.js';
import extra from '../src/locales/extra.json' with { type: 'json' };
import anatomia from '../src/locales/anatomy.json' with { type: 'json' };
import catalogo from '../catalog.json' with { type: 'json' };
import { dictionary } from '../src/locales/dictionary.js';
import { ESCENAS_MICRO, INTERFAZ, PARTES, REGIONES, SISTEMAS, ZONAS_EXAMEN } from '../src/embed/es-dict.js';
import { crearTablaEspanol, crearTraductor } from '../src/embed/idioma.js';

const CJK = /[぀-ヿ一-鿿]/;
const partesPorId = new Map(catalogo.parts.map(parte => [parte.id, parte]));

test('toda frase de interfaz en inglés (ui, extra, micro) tiene su español', () => {
  const faltan = [];
  for (const diccionario of [ui, extra, micro]) {
    for (const [ingles] of Object.values(diccionario)) if (!INTERFAZ[ingles]?.trim()) faltan.push(ingles);
  }
  assert.deepEqual(faltan, []);
});

test('las etiquetas de las seis escenas microscópicas tienen su español', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const inicio = main.indexOf('function createMicroAnatomy');
  const fin = main.indexOf('\n}\n', inicio);
  const etiquetas = [...main.slice(inicio, fin).matchAll(/label\('([^']+)'/g)].map(m => m[1]);
  assert.ok(etiquetas.length >= 20, 'se esperaban las etiquetas de createMicroAnatomy');
  const tabla = crearTablaEspanol();
  for (const china of new Set(etiquetas)) {
    const ingles = dictionary[china]?.[0];
    assert.ok(ingles, `sin inglés: ${china}`);
    assert.ok(ESCENAS_MICRO[ingles] ?? tabla.get(ingles), `sin español: ${ingles}`);
  }
});

test('los 12 sistemas y las regiones del catálogo tienen nombre español', () => {
  const sistemas = new Set(catalogo.parts.flatMap(parte => parte.systems));
  const regiones = new Set(catalogo.parts.flatMap(parte => parte.regions ?? []));
  assert.equal(sistemas.size, 12);
  for (const sistema of sistemas) assert.ok(SISTEMAS[sistema], `sistema sin nombre: ${sistema}`);
  for (const region of regiones) assert.ok(REGIONES[region], `región sin nombre: ${region}`);
});

test('las 11 zonas de examen apuntan a estructuras del catálogo con nombre español', () => {
  assert.equal(Object.keys(ZONAS_EXAMEN).length, 11);
  for (const { nombre, part_id } of Object.values(ZONAS_EXAMEN)) {
    assert.ok(nombre.trim());
    assert.ok(partesPorId.has(part_id), `part_id inexistente: ${part_id}`);
    assert.ok(PARTES[part_id], `sin nombre español: ${part_id}`);
  }
});

test('todo part_id citado en cases/*.json existe y tiene nombre español', () => {
  const carpeta = new URL('../../../cases/', import.meta.url);
  let archivos;
  try { archivos = readdirSync(carpeta).filter(nombre => nombre.endsWith('.json')); }
  catch { return; } // el fork fuera del monorepo no tiene casos
  const citados = new Set();
  for (const archivo of archivos) {
    for (const id of readFileSync(new URL(archivo, carpeta), 'utf8').match(/\b(z_[0-9a-f]{16}|bp2_[A-Za-z0-9_]+)\b/g) ?? []) citados.add(id);
  }
  assert.ok(citados.size > 0);
  for (const id of citados) {
    assert.ok(partesPorId.has(id), `part_id inexistente: ${id}`);
    assert.ok(PARTES[id], `sin nombre español: ${id}`);
  }
});

test('el traductor usa el español, compone frases por partes y respalda en inglés', () => {
  const traducir = crearTraductor(crearTablaEspanol());
  assert.equal(traducir('Respiratory system'), 'Sistema respiratorio');
  assert.equal(traducir('Heart · Lungs · Blood vessels'), 'Corazón · Pulmones · Vasos sanguíneos');
  assert.equal(traducir('Muscular system: Outline'), 'Sistema muscular: Contorno');
  assert.equal(traducir(anatomia[partesPorId.get('z_08395ee34200cd80').name][0]), 'Ventrículo izquierdo');
  assert.equal(traducir('frase inexistente'), undefined);
});

test('ninguna salida en español contiene caracteres chinos o japoneses', () => {
  const salidas = [...crearTablaEspanol().values(), ...Object.values(SISTEMAS), ...Object.values(REGIONES),
    ...Object.values(ZONAS_EXAMEN).map(zona => zona.nombre)];
  assert.deepEqual(salidas.filter(texto => CJK.test(texto)), []);
});
