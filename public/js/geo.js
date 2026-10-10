/**
 * geo.js — Cálculo de distancias entre el punto elegido y los elementos de OSM.
 *
 *  - Nodos (paraderos, hospitales mapeados como punto): distancia haversine exacta.
 *  - Vías cerradas (parques, canchas, edificios): 0 m si el punto cae dentro;
 *    si no, distancia al borde más cercano (proyección local plana, error < 0,1 % a estas escalas).
 *  - Relaciones (multipolígonos): se usa el centro de su caja envolvente → aproximado.
 */
const Geo = (() => {
  const R = 6371008.8; // radio medio de la Tierra en metros
  const rad = (d) => (d * Math.PI) / 180;

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Proyecta (lat, lon) a metros respecto al origen (lat0, lon0).
  function project(lat, lon, lat0, lon0) {
    return { x: rad(lon - lon0) * Math.cos(rad(lat0)) * R, y: rad(lat - lat0) * R };
  }

  // Distancia del origen (0,0) al segmento AB.
  function distToSegment(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy);
  }

  // ¿El origen (0,0) está dentro del polígono? (ray casting)
  function originInPolygon(pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const { x: xi, y: yi } = pts[i];
      const { x: xj, y: yj } = pts[j];
      if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const boundsCenter = (b) => ({ lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 });

  /**
   * Devuelve { lat, lon, distance, method, shape?, closed? } para un elemento Overpass
   * obtenido con `out body geom;`, o null si no tiene geometría utilizable.
   *   method: 'point' | 'inside' | 'edge' | 'center'
   */
  function locate(el, lat0, lon0) {
    if (el.type === 'node' && typeof el.lat === 'number') {
      return { lat: el.lat, lon: el.lon, distance: haversine(lat0, lon0, el.lat, el.lon), method: 'point' };
    }

    if (el.type === 'way' && Array.isArray(el.geometry)) {
      const geom = el.geometry.filter(Boolean);
      if (geom.length === 0) return null;
      const pts = geom.map((p) => project(p.lat, p.lon, lat0, lon0));
      const first = geom[0];
      const last = geom[geom.length - 1];
      const closed = geom.length >= 4 && first.lat === last.lat && first.lon === last.lon;
      const c = el.bounds ? boundsCenter(el.bounds) : { lat: first.lat, lon: first.lon };

      let distance;
      let method = 'edge';
      if (closed && originInPolygon(pts)) {
        distance = 0;
        method = 'inside';
      } else if (pts.length === 1) {
        distance = Math.hypot(pts[0].x, pts[0].y);
      } else {
        distance = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
          distance = Math.min(distance, distToSegment(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
        }
      }
      return {
        lat: c.lat,
        lon: c.lon,
        distance,
        method,
        closed,
        shape: geom.map((p) => [p.lat, p.lon]),
      };
    }

    // Relaciones u otros: centro de la caja envolvente (aproximado).
    const c = el.center || (el.bounds ? boundsCenter(el.bounds) : null);
    if (!c) return null;
    return { lat: c.lat, lon: c.lon, distance: haversine(lat0, lon0, c.lat, c.lon), method: 'center' };
  }

  return { haversine, locate };
})();
