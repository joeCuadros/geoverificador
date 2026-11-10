/**
 * capas-ui.js: Vista de «Ver en el mapa»: dibuja las entidades reales (colegios, salud, paraderos, parques, zonas, quebradas,
 * sismos) y los sectores de una búsqueda sobre el mapa de Leaflet, con una leyenda de una línea por capa y «Quitar del mapa».
 *
 * Qué se dibuja y por qué lo decide capas.js (puro y con pruebas). Aquí solo se traduce eso a capas de Leaflet: iconos por nivel
 * para pocos colegios, círculos de lienzo (canvas) cuando son muchos, polígonos para parques y zonas, líneas para quebradas y
 * círculos pequeños para los sismos. Nunca se pinta lo que no cumple ni se ve la cuadrícula de la búsqueda.
 */
const CapasUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icono = (id) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const MAX_ICONOS = 350; // por encima, los puntos se dibujan como círculos de lienzo: más ligeros con miles de colegios

  // Un color por tipo de entidad; los colegios además cambian de forma/letra por nivel (nunca solo el color).
  const COLOR = {
    inicial: '#9a4d00', primaria: '#1c3a6b', secundaria: '#6b2d7a', salud: '#b0272b', consultorio: '#0f6b6b', mercado: '#9a3412', supermercado: '#065f46', mall: '#9d174d', galeria: '#a16207', abastecimiento: '#9a3412', compras_ocio: '#9d174d', comercio_barrio: '#a16207', paradero: '#3b4a5a', parques: '#2f7d3b', quebradas: '#1f6fb2',
    sismos: '#c2570c', volcan_alto: '#a31621', volcan_moderado: '#e07b00', volcan_bajo: '#e9c046', sectores: '#0b5d4f', residencial: '#b88a2e', tranquilo: '#8a6d1f', campina: '#6f9a2f', comercial: '#7a4fa0', historico: '#a0422f',
  };
  const LETRA = { inicial: 'I', primaria: 'P', secundaria: 'S', salud: '+', consultorio: 'C', mercado: 'M', supermercado: 'S', mall: 'CC', galeria: 'G', paradero: 'B' };
  const CAPAS_COMERCIO = ['abastecimiento', 'compras_ocio', 'comercio_barrio']; // las tres necesidades de comercio, informativas: polígono con popup, sin círculo
  // Riesgo de los distritos ante El Niño (CENEPRED): de menor a mayor. La leyenda lleva además el texto y los nombres, así que el color no es lo único que informa.
  const COLOR_RIESGO = { Bajo: '#6aa84f', Medio: '#e9c046', Alto: '#e07b00', 'Muy alto': '#a31621' };

  let api = null; // { map, datos(opciones: { rutas, volcan, cenepred }): Promise<{ datos, zonas, cauces, sismos, volcan, cenepred, rutas, umbrales, fecha }>, mapaVisible? }
  let grupo = null;
  let activas = []; // capas elegidas con los chips: [{ id }]
  let contexto = null; // lo que vino del chat: { capas, distrito, sectores }
  let secuencia = 0;
  let ultimo = null; // último resultado de Capas.construir
  let limitesPendientes = null;
  let renderers = null;
  const sectorCapas = new Map(); // n → capa de Leaflet del sector

  function crearPanes(map) {
    const pane = (nombre, z, clics = false) => {
      const p = map.createPane(nombre);
      p.style.zIndex = z;
      if (!clics) p.style.pointerEvents = 'none';
      return p;
    };
    pane('capasZonas', 352);
    pane('capasRiesgo', 353, true);
    pane('capasVolcan', 354, true);
    pane('capasParques', 356);
    pane('capasSectores', 380, true);
    pane('capasLineas', 420, true);
    pane('capasPuntos', 430, true);
    renderers = {
      zonas: L.canvas({ pane: 'capasZonas', padding: 0.4 }),
      puntos: L.canvas({ pane: 'capasPuntos', padding: 0.4 }),
    };
  }

  const enlaceOsm = (osm) => (osm ? `<br><small><a href="https://www.openstreetmap.org/${esc(osm)}" target="_blank" rel="noopener">${esc(osm)} en openstreetmap.org</a></small>` : '');
  // `fuente` (opcional) es la línea que dice de dónde sale un colegio o un establecimiento de salud, con su código oficial.
  const popup = (titulo, detalle, osm, fuente) => `<strong>${esc(titulo)}</strong>${detalle ? `<br>${esc(detalle)}` : ''}${fuente ? `<br><small>Fuente: ${esc(fuente)}</small>` : ''}${enlaceOsm(osm)}`;

  function marcador(p) {
    const clase = p.tipo === 'colegio' ? `ent-colegio-${p.subtipo}` : `ent-${p.tipo}`;
    const letra = p.tipo === 'colegio' ? LETRA[p.subtipo] : LETRA[p.tipo];
    const html = `<span aria-hidden="true">${letra}</span>`;
    return L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: `ent-marcador ${clase}`, html, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -10] }),
      title: p.titulo, keyboard: false, pane: 'capasPuntos',
    }).bindPopup(popup(p.titulo, p.detalle, p.osm, p.fuenteTexto));
  }

  function circuloLienzo(p) {
    const c = COLOR[p.tipo === 'colegio' ? p.subtipo : p.tipo];
    return L.circleMarker([p.lat, p.lon], { renderer: renderers.puntos, radius: 4.5, color: '#fff', weight: 1, fillColor: c, fillOpacity: 0.95 }).bindPopup(popup(p.titulo, p.detalle, p.osm, p.fuenteTexto));
  }

  /** El punto medio del tramo más largo de una línea: ahí va su etiqueta (la línea se reconoce sin depender del color). */
  function puntoDeEtiqueta(partes) {
    const parte = partes.reduce((a, b) => (b.length > a.length ? b : a), partes[0]);
    const [x, y] = parte[Math.floor(parte.length / 2)];
    return [y, x];
  }

  function dibujarLineasDeBus(r) {
    r.lineasBus.forEach((l) => {
      const nombre = Rutas.etiquetaLinea(l);
      const detalle = `Recorrido publicado por SmartBus (${l.ramales.length} ${l.ramales.length === 1 ? 'sentido o ramal' : 'sentidos y ramales'}). Sin frecuencias ni horarios.`;
      l.partes.forEach((parte) => {
        L.polyline(parte.map(([x, y]) => [y, x]), { color: l.color, weight: 4, opacity: 0.85, pane: 'capasLineas' }).bindPopup(popup(`Línea ${nombre}`, detalle, null)).addTo(grupo);
      });
      L.marker(puntoDeEtiqueta(l.partes), {
        icon: L.divIcon({ className: 'bus-etiqueta', html: `<span style="background:${l.color}">${esc(l.linea)}</span>`, iconSize: [40, 20], iconAnchor: [20, 10] }),
        title: `Línea ${nombre}`, keyboard: false, pane: 'capasPuntos',
      }).bindPopup(popup(`Línea ${nombre}`, detalle, null)).addTo(grupo);
    });
    r.paradasBus.forEach((p) => {
      L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 2.5, fillColor: p.color, fillOpacity: 1, pane: 'capasPuntos' })
        .bindPopup(popup(`Parada más cercana de la línea ${p.linea}`, `${p.nombre} · a ${Math.round(p.distanciaM)} m de tu punto (en línea recta)`, null)).addTo(grupo);
    });
  }

  function dibujar(r) {
    grupo.clearLayers();
    sectorCapas.clear();
    r.poligonos.filter((p) => CAPAS_COMERCIO.includes(p.capa)).forEach((p) => {
      L.geoJSON({ type: 'Feature', geometry: p.geometry }, { style: { color: COLOR[p.capa], weight: 2, fillColor: COLOR[p.capa], fillOpacity: 0.3 }, pane: 'capasParques' })
        .bindPopup(popup(p.titulo, `${p.detalle} (forma en OpenStreetMap; la distancia se mide hasta su borde)`, p.osm)).addTo(grupo);
    });
    r.poligonos.filter((p) => p.capa !== 'parques' && !CAPAS_COMERCIO.includes(p.capa)).forEach((p) => {
      L.geoJSON({ type: 'Feature', geometry: p.geometry }, { style: { color: COLOR[p.capa], weight: 1, fillColor: COLOR[p.capa], fillOpacity: 0.38 }, renderer: renderers.zonas, pane: 'capasZonas', interactive: false }).addTo(grupo);
    });
    r.poligonos.filter((p) => p.capa === 'parques').forEach((p) => {
      L.geoJSON({ type: 'Feature', geometry: p.geometry }, { style: { color: COLOR.parques, weight: 2, fillColor: COLOR.parques, fillOpacity: 0.45 }, pane: 'capasParques' })
        .bindPopup(popup(p.titulo, p.detalle, p.osm)).addTo(grupo);
    });
    r.lineas.forEach((l) => {
      L.geoJSON({ type: 'Feature', geometry: l.geometry }, { style: { color: COLOR.quebradas, weight: 3, opacity: 0.9 }, pane: 'capasLineas' }).bindPopup(popup(l.titulo, l.detalle, null)).addTo(grupo);
    });
    r.circulos.forEach((c) => {
      L.circle([c.lat, c.lon], { radius: c.radioM, color: COLOR[c.capa === 'colegios' ? c.nivel : c.capa === 'salud' ? 'salud' : 'paradero'], weight: 1, dashArray: '4 6', fillOpacity: 0.05, interactive: false, pane: 'capasZonas' }).addTo(grupo);
    });
    r.sectores.forEach((s) => {
      const forma = L.polygon(s.contorno.map((anillo) => anillo.map(([x, y]) => [y, x])), { color: COLOR.sectores, weight: 3, fillColor: COLOR.sectores, fillOpacity: 0.22, pane: 'capasSectores' });
      forma.bindPopup(`<strong>Sector ${s.n}${s.nombre ? ` · cerca de ${esc(s.nombre)}` : ''}</strong><br>Aquí se cumple todo lo que pediste.<br><small>Los bordes son aproximados.</small>`).addTo(grupo);
      sectorCapas.set(s.n, forma);
      L.marker([s.centro.lat, s.centro.lon], {
        icon: L.divIcon({ className: 'chat-marcador', html: `<span>${s.n}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: `Sector ${s.n}`, keyboard: false, pane: 'capasPuntos',
      }).bindPopup(`<strong>Sector ${s.n}</strong>${s.nombre ? `<br>Cerca de ${esc(s.nombre)}` : ''}`).addTo(grupo);
    });
    (r.peligroVolcan || []).forEach((z) => {
      L.geoJSON({ type: 'Feature', geometry: z.geometry }, { style: { color: COLOR[`volcan_${z.nivel}`], weight: 1.5, fillColor: COLOR[`volcan_${z.nivel}`], fillOpacity: 0.3 }, pane: 'capasVolcan' })
        .bindPopup(popup(z.titulo, z.detalle, null)).addTo(grupo);
    });
    // Distritos coloreados por su riesgo ante El Niño (CENEPRED): del nivel más bajo al más alto; cada uno dice su nivel al tocarlo.
    (r.riesgoDistritos || []).forEach((z) => {
      L.geoJSON({ type: 'Feature', geometry: z.geometry }, { style: { color: '#33415c', weight: 1.5, fillColor: COLOR_RIESGO[z.nivel], fillOpacity: 0.45 }, pane: 'capasRiesgo' })
        .bindPopup(popup(z.titulo, z.detalle, null)).addTo(grupo);
    });
    dibujarLineasDeBus(r);
    const iconos = r.puntos.length <= MAX_ICONOS;
    r.puntos.forEach((p) => (iconos ? marcador(p) : circuloLienzo(p)).addTo(grupo));
    r.sismos.forEach((s) => {
      L.circleMarker([s.lat, s.lon], { renderer: renderers.puntos, radius: s.radioPx, color: COLOR.sismos, weight: 1.5, fillColor: COLOR.sismos, fillOpacity: 0.25 })
        .bindPopup(`<strong>Sismo de magnitud ${esc(String(s.magnitud).replace('.', ','))}</strong><br>${esc(s.fecha || '')}${s.profundidadKm !== null && s.profundidadKm !== undefined ? ` · ${esc(s.profundidadKm)} km de profundidad` : ''}${s.ref ? `<br><small>${esc(s.ref)}</small>` : ''}<br><small>Instituto Geofísico del Perú</small>`).addTo(grupo);
    });
  }

  // ------------------------------------------------------------------- Chips
  function dibujarChips() {
    const ids = new Set(todasLasCapas().map((c) => c.id));
    const boton = (c) => `<button type="button" class="chip" data-id="${c.id}" aria-pressed="${ids.has(c.id)}">${icono('cumple')}<span>${esc(c.etiqueta)}</span></button>`;
    const grupoDe = (g) => Capas.CAPAS.filter((c) => c.grupo === g).map(boton).join('');
    $('pintar-chips').innerHTML = `${grupoDe('servicio')}<span class="pintar-sep" aria-hidden="true"></span>${grupoDe('zona')}<span class="pintar-sep" aria-hidden="true"></span>${grupoDe('riesgo')}`;
    $('pintar-quitar').hidden = todasLasCapas().length === 0 && !(contexto && (contexto.sectores || []).length);
  }

  /** Las capas del chat más las que la persona sumó con los chips (sin repetir). */
  function todasLasCapas() {
    const base = contexto ? contexto.capas : [];
    return [...base, ...activas.filter((a) => !base.some((b) => b.id === a.id))];
  }

  // ----------------------------------------------------------------- Leyenda
  const MUESTRA = {
    colegios: '<span class="mu-ico mu-i">I</span><span class="mu-ico mu-p">P</span><span class="mu-ico mu-s">S</span>',
    salud: '<span class="mu-ico mu-salud">+</span>',
    consultorios: '<span class="mu-ico mu-consultorio">C</span>',
    abastecimiento: '<span class="mu-ico mu-mercado">M</span><span class="mu-ico mu-supermercado">S</span>',
    compras_ocio: '<span class="mu-ico mu-mall">CC</span>',
    comercio_barrio: '<span class="mu-ico mu-galeria">G</span>',
    paraderos: '<span class="mu-ico mu-paradero">B</span>',
    parques: '<span class="mu-bloque" style="background:#2f7d3b"></span>',
    quebradas: '<span class="mu-linea"></span>',
    sismos: '<span class="mu-sismo"></span>',
    sectores: '<span class="mu-sector"></span>',
  };
  const muestraDe = (capa, l = null) => (capa === 'volcan' && l ? `<span class="mu-bloque" style="background:${COLOR[`volcan_${l.nivel}`]}"></span>` : null) || (/^cenepred_/.test(capa) && l ? `<span class="mu-bloque" style="background:${COLOR_RIESGO[l.nivel]}"></span>` : null) || MUESTRA[capa] || `<span class="mu-bloque" style="background:${COLOR[capa] || '#777'}"></span>`;

  function limpiarLeyenda() {
    $('leyenda').hidden = true;
    $('leyenda-resumen').textContent = '';
    $('leyenda-estados').innerHTML = '';
    $('leyenda-filas').innerHTML = '';
    $('leyenda-pie').textContent = '';
  }

  function dibujarLeyenda(r, fecha) {
    $('leyenda-resumen').textContent = r.resumen;
    const itemDe = (l) => {
      if (l.capa !== 'lineas') return `<li class="ley-item"><span class="muestra-ent" aria-hidden="true">${muestraDe(l.capa, l)}</span><span class="ley-txt">${esc(l.texto)}</span></li>`;
      // Una fila por línea, con su color y su nombre: el color solo no basta, la etiqueta del mapa lleva el mismo nombre.
      const filas = r.lineasBus.map((b) => `<li class="ley-item"><span class="muestra-ent" aria-hidden="true"><span class="mu-linea-bus" style="background:${b.color}"></span></span><span class="ley-txt">Línea ${esc(Rutas.etiquetaLinea(b))}</span></li>`);
      if (r.paradasBus.length) filas.push('<li class="ley-item"><span class="muestra-ent" aria-hidden="true"><span class="mu-parada-bus"></span></span><span class="ley-txt">Parada más cercana de cada línea (círculo del color de la línea)</span></li>');
      return filas.join('');
    };
    $('leyenda-estados').innerHTML = r.leyenda.map(itemDe).join('')
      + r.sinDatos.map((c) => `<li class="ley-item leyenda-error"><span class="ley-txt">${c === 'lineas' ? 'No pude leer los recorridos de SmartBus, así que no los dibujo.' : `No pude leer el archivo de ${c === 'sismos' ? 'sismos' : c === 'volcan' ? 'peligro volcánico' : c === 'cenepred' ? 'riesgo de los distritos (CENEPRED)' : 'quebradas'}, así que no lo dibujo.`}</span></li>`).join('');
    const fuentes = [];
    if (r.leyenda.some((l) => ['colegios', 'salud', 'consultorios', 'paraderos', 'parques'].includes(l.capa))) fuentes.push(`Colegios: padrón de ESCALE (MINEDU). Salud y consultorios médicos (dos categorías; el consultorio es informativo, sin círculo de distancia): RENIPRESS (SUSALUD). Paraderos y parques: OpenStreetMap (ODbL), que en colegios, salud y consultorios solo completa donde no hay un punto oficial de la misma categoría a 200 m. Datos al ${fecha || 'sin fecha'}; cada punto dice su fuente al tocarlo. Puede faltar alguno.`);
    if (r.leyenda.some((l) => CAPAS_COMERCIO.includes(l.capa))) fuentes.push('Abastecimiento (mercados y supermercados), compras y ocio (malls confirmados con su fuente) y comercio de barrio (galerías): OpenStreetMap (ODbL), solo informativos (sin distancia de referencia ni círculo); de un mall o una galería con forma en el mapa la distancia es al borde, no al centro. Puede faltar alguno.');
    if (r.leyenda.some((l) => ['residencial', 'tranquilo', 'campina', 'comercial', 'historico'].includes(l.capa))) fuentes.push('Zonas: plano del PDM Arequipa 2016-2025 (referencial).');
    if (r.leyenda.some((l) => l.capa === 'quebradas')) fuentes.push('Quebradas y ríos: cauces de la ANA (red de 2018), el IGP y OpenStreetMap (ODbL); cada tramo dice su fuente al tocarlo. Ninguna fuente es completa ni es un mapa de peligro.');
    if (r.leyenda.some((l) => l.capa === 'lineas')) fuentes.push('Líneas de bus: Rutas: SmartBus (smartbus.app), recorridos publicados usados con autorización verbal; sin frecuencias ni horarios.' + (r.paradasBus.length ? ' La parada es la más cercana en línea recta.' : ''));
    if (r.leyenda.some((l) => l.capa === 'volcan')) fuentes.push('Peligro volcánico: zonas del IGP para el Misti (lahares, flujos piroclásticos, lava y avalanchas), un mapa de escala regional y sin fecha de elaboración. No es una evaluación de riesgo, el borde de una zona no es exacto y la ceniza (que cubre toda la ciudad) no se dibuja.');
    if (r.leyenda.some((l) => /^cenepred_/.test(l.capa))) fuentes.push('Riesgo por distrito: escenario del CENEPRED ante lluvias como las de El Niño. Es una estimación por distrito, no una predicción ni una evaluación de tu predio: dentro de un distrito el riesgo cambia de una calle a otra.');
    if (r.leyenda.some((l) => l.capa === 'sismos')) fuentes.push('Sismos: Instituto Geofísico del Perú; actividad reciente reportada, no una predicción.');
    $('leyenda-filas').innerHTML = fuentes.map((f) => `<li><small>${esc(f)}</small></li>`).join('');
    $('leyenda-pie').textContent = r.sectores.length ? 'Los bordes de los sectores son aproximados. Distancias en línea recta.' : 'Distancias en línea recta.';
    $('leyenda').hidden = false;
    $('pintar-anuncio').textContent = r.resumen;
  }

  // ------------------------------------------------------------------- Dibujar
  const caja = (b) => L.latLngBounds([[b[1], b[0]], [b[3], b[2]]]);

  async function aplicar({ encuadrar = true } = {}) {
    const mia = ++secuencia;
    dibujarChips();
    const capas = todasLasCapas();
    const hayAlgo = capas.length > 0 || (contexto && ((contexto.sectores || []).length || contexto.distrito));
    if (!hayAlgo) { grupo.clearLayers(); ultimo = null; limpiarLeyenda(); return; }
    $('leyenda-resumen').textContent = 'Preparando el mapa…';
    $('leyenda').hidden = false;
    try {
      const d = await api.datos({ rutas: capas.some((c) => c.id === 'lineas'), volcan: capas.some((c) => c.id === 'volcan'), cenepred: capas.some((c) => /^cenepred_/.test(c.id)) });
      if (mia !== secuencia) return;
      const distrito = contexto && contexto.distrito;
      const polys = distrito ? Distritos.poligonos(distrito) : null;
      const r = Capas.construir({
        capas, datos: d.datos, zonas: d.zonas, cauces: d.cauces, sismos: d.sismos, volcan: d.volcan, cenepred: d.cenepred, rutas: d.rutas, umbrales: d.umbrales,
        area: polys && polys.length ? { polys } : null, sectores: contexto && contexto.sectores && contexto.sectores.length ? contexto.sectores : null,
      });
      ultimo = r;
      dibujar(r);
      if (distrito && polys.length) {
        const dst = Distritos.feature(distrito);
        L.geoJSON(dst, { style: { color: '#33415c', weight: 2, dashArray: '6 6', fill: false }, interactive: false, pane: 'capasZonas' }).addTo(grupo);
      }
      dibujarLeyenda(r, d.fecha);
      if (encuadrar && r.limites) {
        const b = caja(r.limites).pad(0.08);
        api.map.fitBounds(b, { maxZoom: 16, animate: false });
        limitesPendientes = api.mapaVisible && !api.mapaVisible() ? b : null;
      }
    } catch (err) {
      if (mia !== secuencia) return;
      console.error('[Capas]', err);
      grupo.clearLayers();
      $('leyenda-resumen').textContent = 'No pude dibujar el mapa';
      $('leyenda-estados').innerHTML = `<li class="leyenda-error"><span class="ley-txt">${esc(err && err.message ? err.message : 'Faltan datos para dibujar.')}</span></li>`;
      $('leyenda-filas').innerHTML = '';
      $('leyenda-pie').textContent = 'El chat y los demás datos siguen funcionando.';
    }
  }

  function alternar(id) {
    const enChat = contexto && contexto.capas.some((c) => c.id === id);
    if (enChat) contexto = { ...contexto, capas: contexto.capas.filter((c) => c.id !== id) };
    else if (activas.some((c) => c.id === id)) activas = activas.filter((c) => c.id !== id);
    else {
      // El riesgo de inundación y el de movimientos en masa pintan los mismos distritos: se elige uno a la vez.
      const otro = /^cenepred_/.test(id) ? (c) => /^cenepred_/.test(c.id) : () => false;
      activas = [...activas.filter((c) => !otro(c)), { id }];
    }
    aplicar({ encuadrar: false });
  }

  /** «Quitar del mapa»: deja el mapa solo con el mapa base. */
  function quitar({ anunciar = true } = {}) {
    activas = [];
    contexto = null;
    aplicar({ encuadrar: false });
    if (anunciar) $('pintar-anuncio').textContent = 'Quité lo que había en el mapa.';
  }

  /**
   * El chat pide dibujar algo: las capas de una búsqueda o de un conteo, un distrito y los sectores encontrados.
   *   { capas, distrito?, sectores? }
   */
  function mostrar({ capas = [], distrito = null, sectores = [] }) {
    if (!api) return;
    activas = [];
    contexto = { capas, distrito, sectores };
    aplicar({ encuadrar: true });
  }

  /** «Ver en el mapa» de un sector: acerca el mapa a su contorno y abre su globo. */
  function enfocarSector(n) {
    const forma = sectorCapas.get(n);
    if (!forma) return false;
    api.map.fitBounds(forma.getBounds().pad(0.4), { maxZoom: 17, animate: false });
    forma.openPopup();
    limitesPendientes = null;
    return true;
  }

  /** Al volver a ver el mapa: si algo se dibujó con el mapa oculto, se encuadra de nuevo con su tamaño real. */
  function reajustarVista() {
    if (!limitesPendientes) return;
    api.map.fitBounds(limitesPendientes, { maxZoom: 16, animate: false });
    limitesPendientes = null;
  }

  function iniciar(opciones) {
    api = opciones;
    crearPanes(api.map);
    grupo = L.layerGroup().addTo(api.map);
    dibujarChips();
    $('pintar-chips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (b) alternar(b.dataset.id);
    });
    $('pintar-quitar').addEventListener('click', () => { quitar(); $('pintar-chips').querySelector('.chip').focus(); });
    if (window.matchMedia('(max-width: 639.98px)').matches) $('leyenda').open = false; // en pantallas angostas la leyenda empieza plegada
  }

  return { iniciar, mostrar, quitar, enfocarSector, reajustarVista, alternar, ultimo: () => ultimo };
})();
