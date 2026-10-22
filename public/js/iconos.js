// Iconos de Font Awesome 6 (la hoja de estilos se carga desde cdnjs en index.html).
// Catálogo completo: https://fontawesome.com/search?o=r&m=free&s=solid

export const ICONO_TIRO = {
  piedra: 'fa-hand-back-fist',
  papel: 'fa-hand',
  tijera: 'fa-hand-scissors',
};

// Crea un <i> con el icono. Se arma con DOM (no innerHTML) para no mezclar HTML con texto del usuario.
export function icono(nombre, clasesExtra = '') {
  const i = document.createElement('i');
  i.className = `fa-solid ${nombre} ${clasesExtra}`.trim();
  i.setAttribute('aria-hidden', 'true');
  return i;
}

export const iconoTiro = (tiro, clasesExtra) => icono(ICONO_TIRO[tiro], clasesExtra);

// Reemplaza el contenido de un elemento por: icono + texto
export function ponerConIcono(elemento, nombreIcono, texto) {
  elemento.replaceChildren(icono(nombreIcono), document.createTextNode(` ${texto}`));
}
