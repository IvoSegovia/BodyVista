// SemioLab 3D · calibración del Performance Guardrail (?embed=1&perf=1).
// `pnpm perf:calibrar` llama a window.SemiolabPerf.medir(vista) para cada vista:
// la restaura sin recortes, gira la cámara alrededor del objetivo dibujando un
// cuadro por frame durante `ms` y devuelve FPS promedio, triángulos y llamadas.
import * as THREE from '../vendor/three.js';

export function exponerCalibracion(ventana, visor, escena, { hotspots, describirParte, guardrail }) {
  ventana.SemiolabPerf = {
    async medir(vista, ms = 5000) {
      await visor.restore(vista);
      await visor.whenIdle();
      const { renderer, camara } = escena.contexto;
      if (!renderer || !camara) throw Error('El visor todavía no dibujó ningún cuadro');
      const objetivo = new THREE.Vector3().fromArray(vista.target);
      const eje = camara.up.clone().normalize();
      const inicioCamara = camara.position.clone();
      let cuadros = 0, triangulos = 0, llamadas = 0;
      const inicio = performance.now();
      await new Promise(resolver => {
        const paso = () => {
          const t = performance.now() - inicio;
          if (t >= ms) { resolver(); return; }
          camara.position.copy(inicioCamara).sub(objetivo).applyAxisAngle(eje, (t / ms) * Math.PI * 2).add(objetivo);
          camara.lookAt(objetivo);
          renderer.render(escena.contexto.escena, camara);
          cuadros++;
          triangulos = Math.max(triangulos, renderer.info.render.triangles);
          llamadas = Math.max(llamadas, renderer.info.render.calls);
          requestAnimationFrame(paso);
        };
        requestAnimationFrame(paso);
      });
      camara.position.copy(inicioCamara);
      camara.lookAt(objetivo);
      return { fps: Math.round((cuadros / (ms / 1000)) * 10) / 10, triangulos, llamadas, pixelRatio: renderer.getPixelRatio() };
    },
    estado: () => visor.getState(),
    /** Cuadros dibujados por motivo (cambio de cámara, pedido, interacción, animación, seguridad). */
    motivosCuadro: () => guardrail.leerMotivosCuadro(),
    /** Herramienta de autor (scripts/anclas-generar.mjs): qué estructura y punto de piel hay bajo (x, y) del lienzo. */
    tocar(clientX, clientY) {
      const tocado = escena.tocarCuerpo({ clientX, clientY });
      return tocado ? { ...tocado, regiones: describirParte(tocado.part_id)?.regiones ?? [] } : null;
    },
    /** Dibuja hotspots sin pasar por el puente (captura de evidencia). */
    mostrarHotspots(lista) {
      hotspots.setHotspots(lista, null);
      escena.pedirCuadro();
    },
  };
}
