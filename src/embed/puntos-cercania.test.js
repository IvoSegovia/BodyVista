// Puntos semiológicos (B14): node --test src/embed/puntos-cercania.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTOR_RADIO, RADIO_DISCO_MAX, esSetPuntos, limitarFrecuencia, piezasDelEstado, puntoMasCercano, puntoVisible } from './puntos-cercania.js';

const FRENTE = [0, -1, 0];
const mitral = { id: 'foco_mitral', punto: [0.105, -0.18, 0.555], normal: FRENTE, radio: 0.03 };
const tricuspideo = { id: 'foco_tricuspideo', punto: [0.035, -0.19, 0.6], normal: FRENTE, radio: 0.03 };
const lateral = { id: 'brazo_lateral_der', punto: [-0.3, 0, 0.5], normal: [-1, 0, 0], radio: 0.045 };
const medial = { id: 'brazo_medial_der', punto: [-0.24, 0, 0.5], normal: [1, 0, 0], radio: 0.045 };

test('elige el punto más cercano dentro de 1,6 radios', () => {
  assert.equal(puntoMasCercano([mitral, tricuspideo], [0.1, -0.18, 0.56]), 'foco_mitral');
  assert.equal(puntoMasCercano([mitral, tricuspideo], [0.04, -0.19, 0.6]), 'foco_tricuspideo');
});

test('fuera de 1,6 radios no elige ninguno', () => {
  const borde = 0.03 * FACTOR_RADIO;
  assert.equal(puntoMasCercano([mitral], [0.105 + borde * 0.99, -0.18, 0.555]), 'foco_mitral');
  assert.equal(puntoMasCercano([mitral], [0.105 + borde * 1.01, -0.18, 0.555]), null);
  assert.equal(puntoMasCercano([], [0, 0, 0]), null);
});

test('con normal, descarta los puntos de la cara opuesta', () => {
  const tocadoLateral = [-0.27, 0, 0.5]; // equidistante de las dos caras
  assert.equal(puntoMasCercano([medial, lateral], tocadoLateral, [-1, 0, 0]), 'brazo_lateral_der');
  assert.equal(puntoMasCercano([medial, lateral], tocadoLateral, [1, 0, 0]), 'brazo_medial_der');
});

test('visibilidad: el del cursor siempre; «hover» muestra examinados y hallazgos; «ninguno» sólo el cursor', () => {
  assert.equal(puntoVisible('neutro', 'hover', false), false);
  assert.equal(puntoVisible('neutro', 'hover', true), true);
  assert.equal(puntoVisible('examinado', 'hover', false), true);
  assert.equal(puntoVisible('hallazgo', 'hover', false), true);
  assert.equal(puntoVisible('neutro', 'todos', false), true);
  assert.equal(puntoVisible('hallazgo', 'ninguno', false), false);
  assert.equal(puntoVisible('hallazgo', 'ninguno', true), true);
});

test('piezas por estado: aro fino gris; examinado con punto central; hallazgo con disco cian al 35 % (≤ 0,04)', () => {
  const neutro = piezasDelEstado('neutro', 0.045);
  assert.equal(neutro.centro, null);
  assert.equal(neutro.disco, null);
  assert.equal(neutro.aro.exterior, 0.045);
  assert.ok(piezasDelEstado('examinado', 0.045).centro);
  const hallazgo = piezasDelEstado('hallazgo', 0.06);
  assert.equal(hallazgo.disco.opacidad, 0.35);
  assert.equal(hallazgo.disco.color, '#06b6d4');
  assert.ok(hallazgo.disco.radio <= RADIO_DISCO_MAX);
  assert.ok(piezasDelEstado('hallazgo', 0.03).disco.radio < 0.03);
});

test('setPuntos: forma mínima, tope de 80, ids únicos y modo de mostrar', () => {
  const p = { ...mitral, nombre: 'Foco mitral · 5.º espacio intercostal izquierdo', estado: 'neutro' };
  assert.ok(esSetPuntos({ puntos: [p], mostrar: 'hover' }));
  assert.ok(!esSetPuntos({ puntos: [p, p], mostrar: 'hover' }));
  assert.ok(!esSetPuntos({ puntos: [{ ...p, estado: 'pista' }], mostrar: 'hover' }));
  assert.ok(!esSetPuntos({ puntos: [{ ...p, normal: [0, 0, 0] }], mostrar: 'hover' }));
  assert.ok(!esSetPuntos({ puntos: [p], mostrar: 'siempre' }));
  assert.ok(!esSetPuntos({ puntos: Array.from({ length: 81 }, (_, i) => ({ ...p, id: `p${i}` })), mostrar: 'todos' }));
});

test('limitarFrecuencia: a lo sumo una llamada por intervalo y la última pendiente al vencer', () => {
  let t = 0;
  const llamadas = [];
  const programadas = [];
  const limitada = limitarFrecuencia(v => llamadas.push(v), 66, () => t, (f, ms) => { programadas.push({ f, ms }); return 1; });
  limitada('a');
  t = 10; limitada('b');
  t = 20; limitada('c');
  assert.deepEqual(llamadas, ['a']);
  assert.equal(programadas.length, 1);
  assert.equal(programadas[0].ms, 56); // vence a los 66 ms de la primera
  t = 66; programadas[0].f();
  assert.deepEqual(llamadas, ['a', 'c']);
});
