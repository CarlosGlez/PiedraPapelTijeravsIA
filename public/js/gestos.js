// Clasificación del gesto a partir de los 21 puntos de la mano que da MediaPipe.

// [punta, nudillo medio] de índice, medio, anular y meñique. El punto 0 es la muñeca.
const DEDOS = [[8, 6], [12, 10], [16, 14], [20, 18]];
const distancia = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Un dedo está estirado si su punta está bastante más lejos de la muñeca que su nudillo.
// Funciona aunque la mano esté inclinada (no depende de "arriba/abajo").
// Si confunde gestos, sube UMBRAL a 1.2 para ser más estricto.
const UMBRAL = 1.1;

export function clasificar(puntos) {
  const muneca = puntos[0];
  const estirados = DEDOS.map(([punta, nudillo]) =>
    distancia(puntos[punta], muneca) > distancia(puntos[nudillo], muneca) * UMBRAL
  );
  const cuantos = estirados.filter(Boolean).length;

  if (estirados[0] && estirados[1] && !estirados[2] && !estirados[3]) return 'tijera';
  if (cuantos >= 3) return 'papel';
  if (cuantos === 0) return 'piedra';
  return null; // gesto ambiguo
}

// El gesto que más se repite en una lista de frames (si es al menos la mitad).
// Así un frame borroso no arruina la lectura.
export function mayoria(gestos, minFrames = 3) {
  if (gestos.length < minFrames) return null;
  const cuenta = {};
  for (const g of gestos) cuenta[g] = (cuenta[g] || 0) + 1;
  const [mejor, n] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
  return n / gestos.length >= 0.5 ? mejor : null;
}
