// SemioLab 3D · funciones puras de la cámara clínica (src/embed/camara.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENCUADRES,
  LIMITES_PIVOTE,
  acotarPivote,
  cajaDeCorte,
  deltaAnguloCorto,
  duracionVuelo,
  encuadre,
  esfericas,
  interpolarVuelo,
} from '../src/embed/camara.js';

const cerca = (real, esperado, tolerancia = 1e-9, mensaje = '') =>
  assert.ok(Math.abs(real - esperado) <= tolerancia, `${mensaje} ${real} ≠ ${esperado}`);
const cercaVector = (real, esperado, tolerancia = 1e-9) => real.forEach((v, i) => cerca(v, esperado[i], tolerancia, `[${i}]`));
const grados = g => (g * Math.PI) / 180;

const CAJA = { min: [-0.5, -0.1, -1], max: [0.5, 0.1, 1] };
const TAN_16 = Math.tan(grados(16));

/** Proyección de cada esquina en coordenadas de cámara normalizadas (|x|, |y| ≤ 1 = dentro del cuadro). */
function esquinasProyectadas(caja, { camera, target }, { fov, aspect }) {
  const f = target.map((t, i) => camera[i] - t);
  const largo = Math.hypot(...f);
  const atras = f.map(v => v / largo);
  const derechaSinNormalizar = [-atras[1], atras[0], 0];
  const nd = Math.hypot(...derechaSinNormalizar);
  const derecha = nd < 1e-6 ? [1, 0, 0] : derechaSinNormalizar.map(v => v / nd);
  const arriba = [atras[1] * derecha[2] - atras[2] * derecha[1], atras[2] * derecha[0] - atras[0] * derecha[2], atras[0] * derecha[1] - atras[1] * derecha[0]];
  const tan = Math.tan(grados(fov / 2));
  const puntos = [];
  for (const x of [caja.min[0], caja.max[0]]) for (const y of [caja.min[1], caja.max[1]]) for (const z of [caja.min[2], caja.max[2]]) {
    const v = [x - camera[0], y - camera[1], z - camera[2]];
    const profundidad = -(v[0] * atras[0] + v[1] * atras[1] + v[2] * atras[2]);
    const px = (v[0] * derecha[0] + v[1] * derecha[1] + v[2] * derecha[2]) / (profundidad * tan * aspect);
    const py = (v[0] * arriba[0] + v[1] * arriba[1] + v[2] * arriba[2]) / (profundidad * tan);
    puntos.push([px, py]);
  }
  return puntos;
}

test('encuadre: caja conocida, fov 32°, aspecto 1 (manda la altura)', () => {
  const resultado = encuadre(CAJA, [0, -1, 0], { fov: 32, aspect: 1 }, 1.15);
  // Esquina más cercana: |z| / tan(16°) + 0.1 (y = −0.1 queda 0.1 más cerca de la cámara).
  const distancia = 1 / TAN_16 + 0.1;
  cercaVector(resultado.target, [0, 0, 0]);
  cercaVector(resultado.camera, [0, -distancia * 1.15, 0]);
  const puntos = esquinasProyectadas(CAJA, resultado, { fov: 32, aspect: 1 });
  assert.ok(puntos.every(([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1), 'todas las esquinas en cuadro');
  // Con margen 1 la esquina que manda toca justo el borde del cuadro.
  const justo = esquinasProyectadas(CAJA, encuadre(CAJA, [0, -1, 0], { fov: 32, aspect: 1 }, 1), { fov: 32, aspect: 1 });
  cerca(Math.max(...justo.map(([, y]) => Math.abs(y))), 1, 1e-9, 'la altura llena el cuadro');
});

test('encuadre: misma caja con aspecto 0.25 (retrato angosto, manda el ancho)', () => {
  const resultado = encuadre(CAJA, [0, -1, 0], { fov: 32, aspect: 0.25 }, 1.15);
  const distancia = 0.5 / (TAN_16 * 0.25) + 0.1;
  cercaVector(resultado.camera, [0, -distancia * 1.15, 0]);
  const puntos = esquinasProyectadas(CAJA, resultado, { fov: 32, aspect: 0.25 });
  assert.ok(puntos.every(([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1));
  const justo = esquinasProyectadas(CAJA, encuadre(CAJA, [0, -1, 0], { fov: 32, aspect: 0.25 }, 1), { fov: 32, aspect: 0.25 });
  cerca(Math.max(...justo.map(([x]) => Math.abs(x))), 1, 1e-9, 'el ancho llena el cuadro');
});

test('encuadre: los encuadres con nombre quedan en cuadro desde frente y desde arriba', () => {
  for (const [nombre, caja] of Object.entries(ENCUADRES)) {
    for (const direccion of [[0, -1, 0], [0.02, -0.2, 1]]) {
      const optica = { fov: 32, aspect: 1366 / 768 };
      const puntos = esquinasProyectadas(caja, encuadre(caja, direccion, optica), optica);
      assert.ok(puntos.every(([x, y]) => Math.abs(x) <= 1 + 1e-9 && Math.abs(y) <= 1 + 1e-9), `${nombre} ${direccion}`);
    }
  }
});

test('vuelo: θ se interpola por el arco corto', () => {
  cerca(deltaAnguloCorto(grados(170), grados(-170)), grados(20));
  cerca(deltaAnguloCorto(grados(-170), grados(170)), grados(-20));
  cerca(deltaAnguloCorto(0, grados(90)), grados(90));
  const r = 2;
  const desde = { target: [0, 0, 0], camera: [r * Math.sin(grados(170)), -r * Math.cos(grados(170)), 0] };
  const hasta = { target: [0, 0, 0], camera: [r * Math.sin(grados(-170)), -r * Math.cos(grados(-170)), 0] };
  const medio = interpolarVuelo(desde, hasta, 0.5);
  // A mitad de camino la cámara pasa por θ = 180° (detrás, +y), no por el frente (θ = 0, −y).
  cercaVector(medio.camera, [0, r, 0], 1e-9);
  cerca(Math.abs(esfericas(medio.camera).theta), Math.PI, 1e-9);
});

test('vuelo: extremos exactos, pivote en línea recta y distancia geométrica', () => {
  const desde = { target: [0, 0, 0], camera: [0, -4, 0] };
  const hasta = { target: [0, 0, 1], camera: [1, 0, 1] };
  cercaVector(interpolarVuelo(desde, hasta, 0).camera, desde.camera);
  cercaVector(interpolarVuelo(desde, hasta, 1).camera, hasta.camera);
  const medio = interpolarVuelo(desde, hasta, 0.5);
  cercaVector(medio.target, [0, 0, 0.5]);
  const distancia = Math.hypot(...medio.camera.map((c, i) => c - medio.target[i]));
  cerca(distancia, Math.sqrt(4 * 1), 1e-9); // r0·(r1/r0)^½ = √(r0·r1)
});

test('pivote acotado a la caja de la piel con holgura', () => {
  assert.deepEqual(acotarPivote([0.1, -0.2, 0.3]), [0.1, -0.2, 0.3]);
  assert.deepEqual(acotarPivote([1, -1, -2]), [LIMITES_PIVOTE.x[1], LIMITES_PIVOTE.y[0], LIMITES_PIVOTE.z[0]]);
  assert.deepEqual(acotarPivote([-0.6, 0.31, 1.33]), [-0.55, 0.30, 1.32]);
});

test('duración por defecto del vuelo', () => {
  const quieto = { target: [0, 0, 0], camera: [0, -2, 0] };
  assert.equal(duracionVuelo(quieto, quieto), 350);
  cerca(duracionVuelo(quieto, { target: [0, 0, 0.5], camera: [0, -2, 0.5] }), 600);
  cerca(duracionVuelo(quieto, { target: [0, 0, 0], camera: [0, -2 * Math.E, 0] }), 350 + 500 * 0.3);
  assert.equal(duracionVuelo(quieto, { target: [0, 0, 2], camera: [0, -0.1, 2] }), 900);
});

test('caja de corte: plano en la misma posición que updateSection', () => {
  const caja = { min: [-1, -1, -1], max: [1, 1, 1] };
  assert.deepEqual(cajaDeCorte(caja, 'z', 0).min[2], 1.002);
  const medio = cajaDeCorte(caja, 'z', 50);
  cerca(medio.min[2], 0);
  cerca(medio.max[2], 0);
  assert.deepEqual(medio.min.slice(0, 2), [-1, -1]);
  cerca(cajaDeCorte(caja, 'x', 100).max[0], -1.002);
});
