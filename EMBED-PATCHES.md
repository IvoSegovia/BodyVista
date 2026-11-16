# Cambios de SemioLab 3D a `src/main.js`

Todo el código propio del modo embed vive en `src/embed/`. Éstas son las únicas
líneas agregadas a `src/main.js` (commit base 166c94b); cada una lleva el
comentario `/* semiolab-embed */`.

| Línea | Código | Motivo |
|---|---|---|
| 488 | `if(document.body.classList.contains('embed'))return;` al inicio del `pointerdown` nativo del lienzo | En embed la selección nativa no existe: después de `showSection`/`showMicro` la herramienta nativa pasa a `''` y un clic dejaba la estructura seleccionada (emisivo turquesa, `state.selected`). Sin `pointerStart`, el `pointerup` nativo sale temprano. El clic lo interpreta el puente (`pick`). |
| 502 | Ídem al inicio del `pointermove` nativo del lienzo | Sin hover nativo en embed: no hay raycast por movimiento, ni cursor `pointer`, ni etiqueta flotante. |
| 803 | `embed:{controls,camera},` en el literal `window.BodyVista` | `src/embed/camara.js` necesita los controles y la cámara para ser dueño de la navegación (botones, mano, límites, vuelo). |
