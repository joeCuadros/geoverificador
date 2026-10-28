/**
 * geo.js — Distancia entre dos puntos para los módulos de peligros y denuncias.
 * La fórmula vive en calculos.js (radio medio de la Tierra de 6 371 008,8 m); aquí solo se expone con el nombre
 * que esos módulos ya usan. Debe cargarse después de calculos.js.
 */
const Geo = (() => {
  const haversine = (lat1, lon1, lat2, lon2) => Calculos.haversine(lat1, lon1, lat2, lon2);
  return { haversine };
})();
