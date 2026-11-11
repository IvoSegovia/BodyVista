// SemioLab 3D · punto de entrada del modo embed. Se carga después de main.js
// (index.html), por lo que window.BodyVista ya está definido.
import './embed.css';
import { iniciarPuente } from './bridge.js';

if (new URLSearchParams(location.search).get('embed') === '1') {
  document.body.classList.add('embed');
  iniciarPuente(window);
}
