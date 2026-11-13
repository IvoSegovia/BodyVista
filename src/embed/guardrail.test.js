// Pruebas del Performance Guardrail en ejecución: node --test src/embed/guardrail.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUADRO_SEGURIDAD_MS, FPS_MAXIMO, LIMITES, TOLERANCIA_CAMARA, MonitorFps, crearFirmaCuadro, decidirCuadro, recortarSetLayers, recortarVista, siguientePasoDegradacion, sistemasProtegidos,
} from './guardrail.js';

const neutra = { skeletal: 0, muscular: 0, cardiovascular: 0, nervous: 0, respiratory: 0, skin: 3 };

test('setLayers dentro de los topes no recorta', () => {
  const r = recortarSetLayers(neutra, { skeletal: 3 }, ['skin']);
  assert.deepEqual(r.atenuadas, []);
  assert.equal(r.capas.skeletal, 3);
  assert.deepEqual(r.orden, ['skin', 'skeletal']);
});

test('G1: el tercer sistema sólido baja a nivel 1 al más antiguo', () => {
  const r = recortarSetLayers({ ...neutra, skeletal: 3 }, { muscular: 3 }, ['skin', 'skeletal']);
  assert.deepEqual(r.atenuadas, ['skin']);
  assert.equal(r.capas.skin, 1);
  assert.equal(r.capas.skeletal, 3);
  assert.equal(r.capas.muscular, 3);
});

test('G1 respeta el orden de encendido, no el orden de las claves', () => {
  const r = recortarSetLayers({ ...neutra, skin: 3, skeletal: 3 }, { nervous: 3 }, ['skeletal', 'skin']);
  assert.deepEqual(r.atenuadas, ['skeletal']);
});

test('G2: un segundo sistema en nivel 2 baja el más antiguo a 1', () => {
  const r = recortarSetLayers({ ...neutra, muscular: 2 }, { nervous: 2 }, ['skin', 'muscular']);
  assert.equal(r.capas.muscular, 1);
  assert.equal(r.capas.nervous, 2);
});

test('G3: un tercer sistema en nivel 1 apaga el más antiguo', () => {
  const r = recortarSetLayers({ ...neutra, skin: 1, muscular: 1 }, { nervous: 1 }, ['skin', 'muscular']);
  assert.deepEqual(r.atenuadas, ['skin']);
  assert.equal(r.capas.skin, 0);
  assert.deepEqual(r.orden, ['muscular', 'nervous']);
});

test('G1 en cascada con G3: lo bajado a 1 puede terminar apagado', () => {
  const capas = { ...neutra, skin: 1, respiratory: 1, skeletal: 3, cardiovascular: 3 };
  const r = recortarSetLayers(capas, { muscular: 3 }, ['skin', 'respiratory', 'skeletal', 'cardiovascular']);
  assert.equal(Object.values(r.capas).filter(n => n === 3).length, LIMITES.maxSistemasNivel3);
  assert.ok(Object.values(r.capas).filter(n => n === 1).length <= LIMITES.maxSistemasNivel1);
});

test('restore: G6 apaga todas las capas con escena microscópica', () => {
  const r = recortarVista({ layers: { ...neutra, skeletal: 3 }, micro: 'sarcomere' }, []);
  assert.ok(Object.values(r.vista.layers).every(n => n === 0));
});

test('restore: recorta una vista con tres sistemas sólidos', () => {
  const r = recortarVista({ layers: { ...neutra, skeletal: 3, muscular: 3 }, micro: null }, []);
  assert.equal(r.atenuadas.length, 1);
});

test('las partes de selected/isolate fuera de added protegen sus sistemas', () => {
  const sistemas = id => ({ a: ['cardiovascular'], b: ['respiratory'] })[id] ?? [];
  assert.deepEqual(sistemasProtegidos({ selected: ['a'], isolate: ['b'], added: ['b'] }, sistemas), ['cardiovascular']);
});

test('orden de degradación: resolución, nivel 1 → 0, nivel 2 → 1, pausa', () => {
  let estado = { pixelRatio: 1.25, capas: { skin: 1, muscular: 2, cardiovascular: 1 }, animacionesPausadas: false };
  assert.equal(siguientePasoDegradacion(estado).tipo, 'resolucion');
  estado = { ...estado, pixelRatio: 1 };
  const paso2 = siguientePasoDegradacion(estado, ['cardiovascular']);
  assert.deepEqual(paso2, { tipo: 'capas', capas: { skin: 0, muscular: 2, cardiovascular: 1 }, atenuadas: ['skin'] });
  const paso3 = siguientePasoDegradacion({ ...estado, capas: paso2.capas }, ['cardiovascular']);
  assert.deepEqual(paso3.atenuadas, ['muscular']);
  assert.equal(siguientePasoDegradacion({ ...estado, capas: { cardiovascular: 1 } }, ['cardiovascular']).tipo, 'pausa');
  assert.equal(siguientePasoDegradacion({ ...estado, capas: {}, animacionesPausadas: true }), null);
  assert.equal(siguientePasoDegradacion({ ...estado, pixelRatio: 1.25, capas: {} }, [], true), null);
});

test('MonitorFps degrada tras 3 s por debajo de 24 FPS y no en reposo', () => {
  const monitor = new MonitorFps();
  let t = 0;
  let degrado = false;
  for (; t <= 4000 && !degrado; t += 60) { monitor.registrar(t); degrado = monitor.debeDegradar(t); } // ~16 FPS
  assert.ok(degrado);
  assert.ok(t >= 3000);
  const fluido = new MonitorFps();
  for (let u = 0; u <= 5000; u += 16) { fluido.registrar(u); assert.equal(fluido.debeDegradar(u), false); }
  assert.equal(fluido.debeDegradar(9000), false); // reposo: sin cuadros no hay degradación
});

// ---- Render a demanda (G8) con tope de 60 cuadros/s ----

const reposo = { cambio: false, pedido: false, interactuando: false, animando: false };

test('G8: en reposo sólo dibuja el cuadro de seguridad, una vez por segundo', () => {
  assert.equal(decidirCuadro({ ...reposo, ahora: 500, ultimoCuadro: 0 }), false);
  assert.equal(decidirCuadro({ ...reposo, ahora: CUADRO_SEGURIDAD_MS, ultimoCuadro: 0 }), true);
});

test('G8: cambio de cámara, cuadro pedido, interacción o escena animada dibujan', () => {
  for (const motivo of ['cambio', 'pedido', 'interactuando', 'animando']) {
    assert.equal(decidirCuadro({ ...reposo, [motivo]: true, ahora: 100, ultimoCuadro: 0 }), true, motivo);
  }
});

test('tope: a 240 Hz con la cámara en movimiento no pasa de 60 cuadros por segundo', () => {
  let ultimoCuadro = -Infinity;
  let cuadros = 0;
  for (let i = 0; i < 240; i++) {
    const ahora = (i * 1000) / 240;
    if (decidirCuadro({ ...reposo, cambio: true, ahora, ultimoCuadro })) { cuadros++; ultimoCuadro = ahora; }
  }
  assert.ok(cuadros <= FPS_MAXIMO && cuadros >= FPS_MAXIMO - 2, `${cuadros} cuadros`);
});

test('tope: a 60 Hz no pierde cuadros', () => {
  let ultimoCuadro = -Infinity;
  let cuadros = 0;
  for (let i = 0; i < 60; i++) {
    const ahora = (i * 1000) / 60;
    if (decidirCuadro({ ...reposo, cambio: true, ahora, ultimoCuadro })) { cuadros++; ultimoCuadro = ahora; }
  }
  assert.equal(cuadros, 60);
});

test('firma de cuadro: detecta movimiento de cámara y cambio de tamaño del lienzo', () => {
  const camara = { matrixWorld: { elements: Array(16).fill(0) }, projectionMatrix: { elements: Array(16).fill(1) } };
  const lienzo = { width: 800, height: 600 };
  const firma = crearFirmaCuadro();
  assert.equal(firma.cambio(camara, lienzo), true);
  firma.guardar(camara, lienzo);
  assert.equal(firma.cambio(camara, lienzo), false);
  camara.matrixWorld.elements[12] = 0.5;
  assert.equal(firma.cambio(camara, lienzo), true);
  firma.guardar(camara, lienzo);
  assert.equal(firma.cambio(camara, { width: 801, height: 600 }), true);
});

test('firma de cuadro: el residuo de la amortiguación de la cámara no cuenta como cambio', () => {
  const camara = { matrixWorld: { elements: Array(16).fill(0) }, projectionMatrix: { elements: Array(16).fill(1) } };
  const lienzo = { width: 800, height: 600 };
  const firma = crearFirmaCuadro();
  firma.guardar(camara, lienzo);
  camara.matrixWorld.elements[12] = TOLERANCIA_CAMARA / 10;
  assert.equal(firma.cambio(camara, lienzo), false);
  camara.matrixWorld.elements[12] = TOLERANCIA_CAMARA * 10;
  assert.equal(firma.cambio(camara, lienzo), true);
});
