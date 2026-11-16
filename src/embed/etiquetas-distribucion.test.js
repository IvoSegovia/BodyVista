// node --test src/embed/etiquetas-distribucion.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEPARACION,
  abanico,
  agruparMarcadores,
  distribuirEtiquetas,
  regresionIsotonica,
  segmentosSeCortan,
} from './etiquetas-distribucion.js';

/** Generador congruencial con semilla fija: mismas entradas en cada corrida. */
function generador(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 2 ** 32;
  };
}

function entradaAleatoria(semilla, n = 20, ancho = 656, alto = 481) {
  const azar = generador(semilla);
  const etiquetas = Array.from({ length: n }, (_, i) => ({
    id: `e${String(i).padStart(2, '0')}`,
    ax: 120 + azar() * (ancho - 240),
    ay: azar() * alto,
    xc: ancho / 2,
    lado3d: azar() < 0.5 ? -1 : 1,
    alto: azar() < 0.5 ? 18 : 33,
    prioridad: Math.floor(azar() * 4),
  }));
  return { ancho, alto, margenes: { arriba: 40, abajo: 36 }, etiquetas };
}

const seIntersecan = (a, b) => a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto;
const contiene = (c, [x, y]) => x >= c.x && x <= c.x + c.ancho && y >= c.y && y <= c.y + c.alto;

test('20 entradas pseudoaleatorias: ninguna pareja de cajas se pisa y todas quedan dentro de los márgenes', () => {
  for (let semilla = 1; semilla <= 20; semilla++) {
    const entrada = entradaAleatoria(semilla);
    const { cajas, pins } = distribuirEtiquetas(entrada);
    assert.equal(cajas.length + pins.length, entrada.etiquetas.length, `semilla ${semilla}: ninguna se pierde`);
    for (let i = 0; i < cajas.length; i++) {
      const c = cajas[i];
      assert.ok(c.y >= entrada.margenes.arriba - 1e-9, `semilla ${semilla}: ${c.id} bajo el HUD superior`);
      assert.ok(c.y + c.alto <= entrada.alto - entrada.margenes.abajo + 1e-9, `semilla ${semilla}: ${c.id} sobre el HUD inferior`);
      assert.ok(c.x >= 8 - 1e-9 && c.x + c.ancho <= entrada.ancho - 8 + 1e-9, `semilla ${semilla}: ${c.id} dentro de la vista`);
      for (let j = i + 1; j < cajas.length; j++) {
        const d = cajas[j];
        assert.ok(!seIntersecan(c, d), `semilla ${semilla}: ${c.id} y ${d.id} se pisan`);
        if (c.lado === d.lado) assert.ok(Math.abs(c.cy - d.cy) >= (c.alto + d.alto) / 2 + SEPARACION - 1e-9);
      }
    }
  }
});

test('misma entrada → misma salida, también con las etiquetas en otro orden', () => {
  const entrada = entradaAleatoria(7);
  const una = distribuirEtiquetas(entrada);
  const otra = distribuirEtiquetas({ ...entrada, etiquetas: [...entrada.etiquetas].reverse() });
  assert.deepEqual(otra, una);
  assert.deepEqual(distribuirEtiquetas(structuredClone(entrada)), una);
});

test('si no entran, se colapsan a pin las de menor prioridad', () => {
  // Lienzo bajo (tope 6 por columna) y cajas altas: entran 3 por columna.
  const etiquetas = Array.from({ length: 5 }, (_, i) => ({
    id: `d${i}`, ax: 350, ay: 150, xc: 300, lado3d: 1, alto: 60, prioridad: i === 2 ? 0 : i === 4 ? 1 : 3,
  }));
  const { cajas, pins } = distribuirEtiquetas({ ancho: 600, alto: 260, margenes: { arriba: 20, abajo: 20 }, etiquetas });
  assert.deepEqual(pins.map(p => p.id), ['d2', 'd4']);
  assert.deepEqual(cajas.map(c => c.id).sort(), ['d0', 'd1', 'd3']);
  assert.ok(cajas.every(c => c.lado === 'derecha'));
});

test('tope por columna: 6 si el lienzo mide menos de 420 px de alto', () => {
  const etiquetas = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, ax: 100 + i, ay: 30 * i + 20, xc: 300, lado3d: 0, alto: 14, prioridad: i }));
  const { cajas, pins } = distribuirEtiquetas({ ancho: 600, alto: 400, margenes: {}, etiquetas: etiquetas.map(e => ({ ...e, ax: 350 })) });
  assert.equal(cajas.length, 6);
  assert.deepEqual(pins.map(p => p.id), ['t0', 't1']);
});

test('sin cruces: dos anclas apiladas contra el margen superior, la de id menor lejos de la columna', () => {
  // Con el mismo yd (acotado al margen), el orden por id pone primero a «a», cuyo
  // tramo largo corta el de «b». Se intercambian.
  const etiquetas = [
    { id: 'a', ax: 420, ay: 0, xc: 600, lado3d: 0, alto: 30, ancho: 180, prioridad: 2 },
    { id: 'b', ax: 230, ay: 10, xc: 600, lado3d: 0, alto: 30, ancho: 180, prioridad: 2 },
  ];
  const { cajas } = distribuirEtiquetas({ ancho: 1200, alto: 500, margenes: {}, etiquetas });
  const [primera, segunda] = [...cajas].sort((x, y) => x.cy - y.cy);
  assert.equal(primera.id, 'b');
  assert.equal(segunda.id, 'a');
  assert.ok(!segmentosSeCortan([primera.ax, primera.ay], primera.codo, [segunda.ax, segunda.ay], segunda.codo));
});

test('dos anclas a 10 px en el centro quedan una a cada lado (decide el lado 3D)', () => {
  const ancho = 656;
  const etiquetas = [
    { id: 'z_e1c2f695621baf7b', ax: ancho / 2 - 5, ay: 200, xc: ancho / 2, lado3d: -0.04, alto: 18, prioridad: 2 },
    { id: 'z_08395ee34200cd80', ax: ancho / 2 + 5, ay: 202, xc: ancho / 2, lado3d: 0.05, alto: 18, prioridad: 2 },
  ];
  const { cajas, pins } = distribuirEtiquetas({ ancho, alto: 481, margenes: { arriba: 40, abajo: 36 }, etiquetas });
  assert.equal(pins.length, 0);
  const lados = Object.fromEntries(cajas.map(c => [c.id, c.lado]));
  assert.deepEqual(lados, { z_e1c2f695621baf7b: 'izquierda', z_08395ee34200cd80: 'derecha' });
  for (const c of cajas) {
    const otra = cajas.find(d => d !== c);
    assert.ok(!seIntersecan(c, otra));
    assert.ok(!contiene(c, [otra.ax, otra.ay]), `${c.id} tapa el ancla de ${otra.id}`);
    assert.ok(!contiene(c, [c.ax, c.ay]), `${c.id} tapa su propia ancla`);
  }
});

test('sin lado 3D, la paridad de la posición por id reparte los lados', () => {
  const etiquetas = ['p1', 'p0'].map(id => ({ id, ax: 300, ay: 200, xc: 300, lado3d: 0, alto: 18, prioridad: 2 }));
  const { cajas } = distribuirEtiquetas({ ancho: 600, alto: 480, margenes: {}, etiquetas });
  assert.deepEqual(Object.fromEntries(cajas.map(c => [c.id, c.lado])), { p0: 'izquierda', p1: 'derecha' });
});

test('un ancla bajo su columna pasa a la otra; bajo las dos, queda como pin', () => {
  const { cajas } = distribuirEtiquetas({ ancho: 600, alto: 480, margenes: {}, etiquetas: [
    { id: 'x', ax: 40, ay: 100, xc: 300, lado3d: 0, alto: 18, prioridad: 2 },
  ] });
  assert.equal(cajas[0].lado, 'derecha');
  // Con 100 px de ancho los codos de las dos columnas se cruzan en el centro.
  const estrecho = distribuirEtiquetas({ ancho: 100, alto: 480, margenes: {}, etiquetas: [
    { id: 'y', ax: 50, ay: 100, xc: 50, lado3d: 1, alto: 18, prioridad: 2 },
  ] });
  assert.deepEqual(estrecho.pins.map(p => p.id), ['y']);
});

test('la columna explícita se respeta; el margen izquierdo corre la columna', () => {
  const { cajas } = distribuirEtiquetas({ ancho: 800, alto: 480, margenes: { izquierda: 50 }, etiquetas: [
    { id: 'c', ax: 600, ay: 100, xc: 400, lado3d: 1, alto: 18, prioridad: 2, columna: 'izquierda' },
  ] });
  assert.equal(cajas[0].lado, 'izquierda');
  assert.equal(cajas[0].x, 58);
});

test('regresión isotónica por bloques adyacentes', () => {
  assert.deepEqual(regresionIsotonica([1, 3, 2, 4]), [1, 2.5, 2.5, 4]);
  assert.deepEqual(regresionIsotonica([5, 1, 0]), [2, 2, 2]);
});

test('agruparMarcadores: voraz en orden de id con umbral de 14 px', () => {
  const grupos = agruparMarcadores([
    { id: 'm3', x: 108, y: 100 },
    { id: 'm1', x: 100, y: 100 },
    { id: 'm2', x: 300, y: 300 },
    { id: 'm4', x: 125, y: 100 },
  ]);
  assert.deepEqual(grupos.map(g => g.ids), [['m1', 'm3'], ['m2'], ['m4']]);
  assert.deepEqual([grupos[0].x, grupos[0].y], [104, 100]);
});

test('abanico: radio 22 px y el primero arriba', () => {
  const [primero, segundo] = abanico(4);
  assert.ok(Math.abs(primero[0]) < 1e-9 && Math.abs(primero[1] + 22) < 1e-9);
  assert.ok(Math.abs(segundo[0] - 22) < 1e-9 && Math.abs(segundo[1]) < 1e-9);
});
