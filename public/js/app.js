/**
 * app.js — Interfaz: mapa Leaflet, selección de punto, análisis y resultados.
 * Principio de uso responsable: NINGUNA consulta se lanza al hacer clic, escribir o cambiar el radio.
 * Solo se consulta al pulsar «Buscar» (Nominatim) o «Analizar entorno» (Overpass).
 * La zonificación y las denuncias sí se muestran al elegir el punto, porque se resuelven con archivos locales
 * (zonificacion.js y delitos.js).
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDist = (d) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(2)} km`);
  const METHOD_NOTE = {
    point: '',
    inside: '(el punto está dentro del área)',
    edge: '(hasta el borde más cercano)',
    center: '(hasta el centro; aproximado)',
  };

  const state = {
    point: null,
    pointMarker: null,
    circle: null,
    busy: false,
    lastAnalyzeAt: 0,
    items: [],
    meta: null,
    cache: new Map(),
    zona: null,          // resultado de Zonificacion.lookup para el punto actual
    zonaStatus: 'none',  // none | loading | ok | outside | error
    zonaSeq: 0,          // descarta respuestas de un punto anterior
    zonLayer: null,      // plano completo (se crea la primera vez que se activa)
    zonOutline: null,    // contorno de la zona del punto
    delito: null,        // resultado de Delitos.indicador para el punto actual
    delitoSeq: 0,        // descarta respuestas de un punto anterior
    delLayer: null,      // mapa de calor (se crea la primera vez que se activa)
  };

  // ------------------------------------------------------------------ Mapa
  const map = L.map('map').setView(CONFIG.center, CONFIG.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // El plano de zonificación va en un panel propio, debajo de marcadores y círculo, y no captura clics.
  const zonPane = map.createPane('zonificacion');
  zonPane.style.zIndex = 350;
  zonPane.style.pointerEvents = 'none';
  // El mapa de calor va encima del plano y debajo de marcadores; tampoco captura clics.
  const calorPane = map.createPane('calor');
  calorPane.style.zIndex = 360;
  calorPane.style.pointerEvents = 'none';

  // ------------------------------------------------------- Controles iniciales
  CONFIG.radii.forEach((r) => {
    const o = new Option(r >= 1000 ? `${r / 1000} km` : `${r} m`, r);
    if (r === CONFIG.defaultRadius) o.selected = true;
    $('radius').add(o);
  });
  CONFIG.overpassEndpoints.forEach((e) => $('endpoint').add(new Option(e.label, e.url)));

  // Categorías: bloque de UI + capa de Leaflet por categoría
  const catUI = {};
  CATEGORIES.forEach((cat) => {
    const sec = document.createElement('section');
    sec.className = 'cat';
    sec.innerHTML = `
      <label class="cat-head">
        <input type="checkbox" checked aria-label="Mostrar ${esc(cat.label)}">
        <span class="swatch" style="background:${cat.color}"></span>
        <span class="name">${esc(cat.label)}</span>
        <span class="count">–</span>
      </label>
      <div class="cat-meta">Sin analizar</div>
      <ul class="items"></ul>`;
    $('cats').appendChild(sec);
    const layer = L.layerGroup().addTo(map);
    const ui = {
      sec, layer,
      check: sec.querySelector('input'),
      count: sec.querySelector('.count'),
      meta: sec.querySelector('.cat-meta'),
      list: sec.querySelector('.items'),
    };
    ui.check.addEventListener('change', () => {
      if (ui.check.checked) map.addLayer(layer); else map.removeLayer(layer);
      sec.classList.toggle('off', !ui.check.checked);
    });
    catUI[cat.id] = ui;
  });

  // Documentación automática de las etiquetas realmente consultadas
  $('filters-doc').innerHTML = CATEGORIES.map((cat) => `
    <h4>${esc(cat.label)}</h4>
    <ul>${cat.filters.map((f) => `<li><code>${esc(f.key)}</code> = ${Object.keys(f.values).map((v) => `<code>${esc(v)}</code>`).join(', ')}</li>`).join('')}</ul>`).join('')
    + '<p>Cada elemento se clasifica en la primera categoría cuyo tag coincide. Se buscan nodos, vías y relaciones (<code>nwr</code>).</p>';

  // ------------------------------------------------------------- Utilidades UI
  function setStatus(kind, html) {
    const el = $('status');
    el.className = `status ${kind}`;
    el.innerHTML = (kind === 'loading' ? '<span class="spinner"></span>' : '') + html;
  }

  function setBusy(b) {
    state.busy = b;
    ['analyze', 'radius', 'endpoint'].forEach((id) => { $(id).disabled = b || (id === 'analyze' && !state.point); });
    $('analyze').textContent = b ? 'Consultando…' : 'Analizar entorno';
  }

  function classify(tags) {
    for (const cat of CATEGORIES) {
      for (const f of cat.filters) {
        const v = tags[f.key];
        if (v !== undefined && Object.prototype.hasOwnProperty.call(f.values, v)) {
          return { cat, subtype: f.values[v], tag: `${f.key}=${v}` };
        }
      }
    }
    return null;
  }

  function poiIcon(cat) {
    return L.divIcon({
      className: 'poi-icon',
      html: `<span style="background:${cat.color}">${cat.icon}</span>`,
      iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -13],
    });
  }

  function popupHtml(it) {
    return `<strong>${esc(it.name || '(sin nombre en OSM)')}</strong><br>
      ${esc(it.cat.label)} · ${esc(it.subtype)}<br>
      Distancia: <strong>${fmtDist(it.distance)}</strong> ${esc(METHOD_NOTE[it.method])}<br>
      <small>Etiqueta: <code>${esc(it.tag)}</code><br>
      <a href="https://www.openstreetmap.org/${it.type}/${it.osmId}" target="_blank" rel="noopener">${it.type}/${it.osmId} en openstreetmap.org</a></small>`;
  }

  // ------------------------------------------------------------ Punto y radio
  function drawCircle() {
    if (state.circle) { map.removeLayer(state.circle); state.circle = null; }
    if (!state.point) return;
    state.circle = L.circle([state.point.lat, state.point.lon], {
      radius: Number($('radius').value), color: '#44505f', weight: 1.5, dashArray: '5 5', fillOpacity: 0.04,
    }).addTo(map);
  }

  function clearResults() {
    state.items = [];
    state.meta = null;
    CATEGORIES.forEach((cat) => {
      const ui = catUI[cat.id];
      ui.layer.clearLayers();
      ui.list.innerHTML = '';
      ui.count.textContent = '–';
      ui.meta.textContent = 'Sin analizar';
    });
    $('download').hidden = true;
    $('query-details').hidden = true;
  }

  function setPoint(lat, lon) {
    state.point = { lat, lon };
    if (!state.pointMarker) {
      state.pointMarker = L.marker([lat, lon], { draggable: true, title: 'Punto de análisis' }).addTo(map);
      state.pointMarker.on('dragend', () => {
        const p = state.pointMarker.getLatLng();
        setPoint(p.lat, p.lng);
      });
    } else {
      state.pointMarker.setLatLng([lat, lon]);
    }
    drawCircle();
    clearResults();
    updateZona();
    updateDelito();
    $('point-info').innerHTML = `Punto: <strong>${lat.toFixed(6)}, ${lon.toFixed(6)}</strong>
      · <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}" target="_blank" rel="noopener">verificar en OSM</a>`;
    $('analyze').disabled = state.busy;
    setStatus('idle', 'Punto listo. Pulsa «Analizar entorno» para consultar Overpass.');
  }

  map.on('click', (e) => { if (!state.busy) setPoint(e.latlng.lat, e.latlng.lng); });

  // ------------------------------------------------------------ Zonificación
  const fmtNum = (n) => Math.round(n).toLocaleString('es-PE');
  const has = (v) => v !== null && v !== undefined && v !== '';
  const ZON_BADGE = {
    si: { cls: 'ok', text: 'Construible' },
    condicionado: { cls: 'warn', text: 'Requiere consulta' },
    no: { cls: 'no', text: 'No construible' },
  };

  $('zon-fuente').textContent = `Fuente: ${CONFIG.zonificacion.fuente}. Referencial: no reemplaza el Certificado de Zonificación y Vías.`;

  function zonMessage(kind, html) {
    $('zon').innerHTML = `<p class="zon-msg ${kind}">${html}</p>`;
  }

  // «5 (hasta 6)» cuando la regla tiene un caso base y un máximo distintos.
  const baseMax = (a, b) => (has(b) && b !== a ? `${a} (hasta ${b})` : `${a}`);

  function potencialHtml(regla) {
    const raw = $('lote').value.trim();
    if (raw === '') return '';
    const lote = Number(raw);
    if (!(lote > 0)) return '<p class="zon-calc warn">Escribe un área de lote mayor que cero.</p>';
    if (!regla) return '';
    if (regla.edificable === 'no') return '<p class="zon-calc">No se calcula: esta zona no es construible.</p>';
    if (regla.edificable === 'condicionado') {
      return '<p class="zon-calc">No se calcula: lo que se puede construir aquí depende de la zona vecina o de un plan específico.</p>';
    }
    const pot = Zonificacion.potencial(regla, lote);
    if (!pot) return '<p class="zon-calc">Esta zona no fija un coeficiente: los parámetros dependen del proyecto.</p>';

    const [cBase, cMax] = pot.construible;
    let html = `<p class="zon-calc"><strong>Hasta ${fmtNum(cBase)} m² techados</strong> en un lote de ${fmtNum(lote)} m²`;
    html += cMax > cBase ? ` (${fmtNum(cMax)} m² en el caso máximo; ver nota).` : '.';
    if (pot.ocupable) {
      const [oMin, oMax] = pot.ocupable;
      html += ` El primer piso puede ocupar ${oMin === oMax ? `hasta ${fmtNum(oMax)}` : `entre ${fmtNum(oMin)} y ${fmtNum(oMax)}`} m²; el resto debe quedar libre.`;
    }
    html += '</p>';
    if (pot.bajoLoteMinimo) {
      html += `<p class="zon-calc warn">El lote es menor que el mínimo de la zona (${fmtNum(regla.lote_min_m2)} m²).</p>`;
    }
    return html;
  }

  function renderZona() {
    if (state.zonaStatus === 'outside') {
      zonMessage('empty', '<strong>Este punto está fuera del área zonificada.</strong> El plano no le asigna ninguna zona.');
      return;
    }
    if (state.zonaStatus !== 'ok') return;

    const z = state.zona;
    const r = z.regla;
    const badge = ZON_BADGE[r && r.edificable] || { cls: 'warn', text: 'Sin reglas en la tabla' };
    const filas = [];
    if (r) {
      if (has(r.pisos_base)) filas.push(['Pisos', baseMax(r.pisos_base, r.pisos_max)]);
      if (has(r.coef_base)) filas.push(['Coeficiente de edificación', baseMax(r.coef_base, r.coef_max)]);
      if (has(r.area_libre_pct)) filas.push(['Área libre mínima', `${r.area_libre_pct} %`]);
      if (has(r.lote_min_m2)) filas.push(['Lote mínimo', `${fmtNum(r.lote_min_m2)} m²`]);
      if (has(r.frente_min_m)) filas.push(['Frente mínimo', `${r.frente_min_m} m`]);
    }

    $('zon').innerHTML = `
      <div class="zon-card">
        <div class="zon-head">
          <span class="swatch" style="background:${esc(z.color)}"></span>
          <span class="zon-code">${esc(z.codigo)}</span>
          <span class="zon-name">${esc(r ? r.nombre : 'Código sin reglas en la tabla')}</span>
          <span class="badge ${badge.cls}">${badge.text}</span>
        </div>
        ${filas.length ? `<dl class="zon-data">${filas.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${r && r.nota ? `<p class="zon-nota small">${esc(r.nota)}</p>` : ''}
        ${potencialHtml(r)}
        ${z.coincidencias > 1 ? `<p class="zon-nota small">El plano tiene ${z.coincidencias} zonas superpuestas en este punto; se muestra la que queda encima.</p>` : ''}
      </div>`;
  }

  async function updateZona() {
    const seq = ++state.zonaSeq;
    const { lat, lon } = state.point;
    state.zona = null;
    state.zonaStatus = 'loading';
    if (state.zonOutline) { map.removeLayer(state.zonOutline); state.zonOutline = null; }
    zonMessage('loading', '<span class="spinner"></span>Buscando la zona en el plano…');
    try {
      const z = await Zonificacion.lookup(lat, lon);
      if (seq !== state.zonaSeq) return; // el usuario ya eligió otro punto
      state.zona = z;
      state.zonaStatus = z ? 'ok' : 'outside';
      if (z) state.zonOutline = Zonificacion.contorno(z.feature).addTo(map);
      renderZona();
    } catch (err) {
      if (seq !== state.zonaSeq) return;
      state.zonaStatus = 'error';
      zonMessage('error', `<strong>No se pudo consultar la zonificación.</strong> ${esc(err.message)}`);
      console.error('[Zonificación] fallo', err);
    }
  }

  $('lote').addEventListener('input', renderZona);

  // ---------------------------------------------------------------- Denuncias
  const fmtFecha = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-PE', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  $('del-fuente').textContent = `Fuente: ${CONFIG.delitos.fuente}. Solo denuncias con ubicación real; no son todos los delitos.`;

  function delMessage(kind, html) {
    $('del').innerHTML = `<p class="zon-msg ${kind}">${html}</p>`;
  }

  function renderDelito() {
    const d = state.delito;
    const { total, ROBO, HURTO } = d.conteo;
    const periodo = `${fmtFecha(d.meta.ventanaDesde)} – ${fmtFecha(d.meta.hasta)}`;
    $('del').innerHTML = `
      <div class="zon-card">
        <div class="zon-head">
          <span class="zon-code">${fmtNum(total)}</span>
          <span class="zon-name">denuncias de robo y hurto a ${d.radio} m</span>
        </div>
        <dl class="zon-data">
          <div><dt>Robos</dt><dd>${fmtNum(ROBO)}</dd></div>
          <div><dt>Hurtos</dt><dd>${fmtNum(HURTO)}</dd></div>
        </dl>
        <p class="zon-nota small">Últimos 12 meses con datos (${esc(periodo)}). Robo: con violencia o amenaza; hurto: sin violencia. Activa «Ver mapa de calor» para compararlo con el resto de la ciudad.</p>
      </div>`;
  }

  async function updateDelito() {
    const seq = ++state.delitoSeq;
    const { lat, lon } = state.point;
    state.delito = null;
    delMessage('loading', '<span class="spinner"></span>Contando denuncias alrededor del punto…');
    try {
      const d = await Delitos.indicador(lat, lon);
      if (seq !== state.delitoSeq) return; // el usuario ya eligió otro punto
      state.delito = d;
      renderDelito();
    } catch (err) {
      if (seq !== state.delitoSeq) return;
      delMessage('error', `<strong>No se pudo calcular el indicador de denuncias.</strong> ${esc(err.message)}`);
      console.error('[Denuncias] fallo', err);
    }
  }

  $('zon-layer').addEventListener('change', async (e) => {
    const box = e.target;
    if (!box.checked) {
      if (state.zonLayer) map.removeLayer(state.zonLayer);
      return;
    }
    box.disabled = true;
    try {
      if (!state.zonLayer) state.zonLayer = await Zonificacion.capa('zonificacion');
      if (box.checked) state.zonLayer.addTo(map);
    } catch (err) {
      box.checked = false;
      if (state.zonaStatus !== 'ok') zonMessage('error', `<strong>No se pudo cargar el plano.</strong> ${esc(err.message)}`);
      console.error('[Zonificación] fallo', err);
    } finally {
      box.disabled = false;
    }
  });
  $('radius').addEventListener('change', () => {
    drawCircle();
    if (state.point) { clearResults(); setStatus('idle', 'Radio cambiado. Pulsa «Analizar entorno» para actualizar.'); }
  });

  $('del-layer').addEventListener('change', async (e) => {
    const box = e.target;
    $('del-leyenda').hidden = !box.checked;
    if (!box.checked) {
      if (state.delLayer) map.removeLayer(state.delLayer);
      return;
    }
    box.disabled = true;
    try {
      if (!state.delLayer) state.delLayer = await Delitos.capa('calor');
      if (box.checked) state.delLayer.addTo(map);
    } catch (err) {
      box.checked = false;
      $('del-leyenda').hidden = true;
      delMessage('error', `<strong>No se pudo cargar el mapa de calor.</strong> ${esc(err.message)}`);
      console.error('[Denuncias] fallo', err);
    } finally {
      box.disabled = false;
    }
  });

  // --------------------------------------------------------------- Nominatim
  let searching = false;
  $('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (searching) return;
    const q = $('q').value.trim();
    const box = $('search-status');
    const list = $('search-results');
    list.innerHTML = '';
    if (q.length < 3) { box.textContent = 'Escribe al menos 3 caracteres.'; return; }

    searching = true;
    $('search-btn').disabled = true;
    box.textContent = 'Buscando en Nominatim…';
    try {
      const { results, cached, ms } = await Services.geocode(q, { bounded: $('bounded').checked });
      if (results.length === 0) {
        box.innerHTML = 'Nominatim no encontró coincidencias. Prueba con otro formato (calle y distrito) o desmarca «Limitar la búsqueda a Arequipa».';
      } else {
        box.textContent = cached ? 'Resultados (búsqueda repetida, sin nueva solicitud):' : `Resultados (${ms} ms). Elige uno:`;
        results.forEach((r) => {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = r.name;
          b.addEventListener('click', () => {
            list.innerHTML = '';
            box.textContent = '';
            setPoint(r.lat, r.lon);
            map.setView([r.lat, r.lon], 16);
          });
          li.appendChild(b);
          list.appendChild(li);
        });
      }
    } catch (err) {
      box.innerHTML = `<span style="color:var(--danger)">${esc(describeError(err, 'Nominatim').title)}</span>`;
    } finally {
      searching = false;
      $('search-btn').disabled = false;
    }
  });

  // ---------------------------------------------------------------- Errores
  function describeError(err, service) {
    if (!(err instanceof Services.ServiceError)) return { title: `Error inesperado: ${err.message}`, hint: '' };
    const hints = {
      network: `Puede ser falta de internet, un bloqueo del navegador/extensión/red, o que ${service} esté caído. Abre la pestaña Network de las herramientas de desarrollo para ver el motivo exacto.`,
      timeout: 'El servicio público está lento o saturado. Espera un momento o prueba el servidor alternativo con un radio menor.',
      rate_limit: 'Se superó el límite de uso. Espera uno o dos minutos antes de reintentar; no repitas la consulta de inmediato.',
      forbidden: service === 'Nominatim'
        ? 'Nominatim exige identificar la aplicación. Abre la página desde un servidor local (http://localhost:8000) en lugar de file:// y, si puedes, completa nominatimEmail en js/config.js.'
        : 'El servicio bloqueó la solicitud. Prueba el servidor alternativo.',
      busy: 'El servicio público está ocupado. Prueba el servidor alternativo o reintenta en unos minutos.',
      runtime: 'La consulta fue demasiado pesada para el servidor público. Reduce el radio e inténtalo de nuevo.',
      parse: 'El servicio respondió algo inesperado (a veces una página de error). Reintenta más tarde.',
      http: 'Revisa el código HTTP en la pestaña Network.',
    };
    return { title: err.message, hint: hints[err.kind] || '' };
  }

  // --------------------------------------------------------------- Análisis
  async function analyze() {
    if (state.busy) return;
    if (!state.point) { setStatus('error', 'Primero elige un punto en el mapa.'); return; }

    const { lat, lon } = state.point;
    const radius = Number($('radius').value);
    const endpoint = $('endpoint').value;
    const query = Services.buildOverpassQuery(lat, lon, radius);
    const key = `${endpoint}|${lat.toFixed(5)}|${lon.toFixed(5)}|${radius}`;

    let payload;
    let fromCache = false;
    const hit = state.cache.get(key);
    if (hit && Date.now() - hit.at < CONFIG.cacheTtlMs) {
      payload = hit.payload;
      fromCache = true;
    } else {
      const wait = state.lastAnalyzeAt + CONFIG.analyzeCooldownMs - Date.now();
      if (wait > 0) {
        setStatus('error', `Espera ${Math.ceil(wait / 1000)} s antes de otra consulta (límite propio para respetar Overpass).`);
        return;
      }
      state.lastAnalyzeAt = Date.now();
      setBusy(true);
      setStatus('loading', 'Consultando Overpass API… puede tardar hasta unos 30 s.');
      try {
        payload = await Services.overpass(endpoint, query);
        state.cache.set(key, { at: Date.now(), payload });
      } catch (err) {
        setBusy(false);
        clearResults();
        const d = describeError(err, 'Overpass');
        setStatus('error', `<strong>No se pudieron obtener datos.</strong> ${esc(d.title)}<span class="hint">${esc(d.hint)}</span>`);
        console.error('[Overpass] fallo', err);
        return;
      }
      setBusy(false);
    }

    // ---- Procesar elementos reales devueltos por Overpass
    console.debug('[Overpass] respuesta cruda', payload.data);
    const seen = new Set();
    const items = [];
    let skipped = 0;
    for (const el of payload.data.elements || []) {
      if (!el.tags) continue;
      const id = `${el.type}/${el.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const cls = classify(el.tags);
      const loc = Geo.locate(el, lat, lon);
      if (!cls || !loc) { skipped++; continue; }
      items.push({
        id, type: el.type, osmId: el.id,
        cat: cls.cat, subtype: cls.subtype, tag: cls.tag,
        name: el.tags.name || el.tags['name:es'] || el.tags.official_name || null,
        tags: el.tags,
        ...loc,
      });
    }
    items.sort((a, b) => a.distance - b.distance);
    state.items = items;
    state.meta = {
      generatedAt: new Date().toISOString(), endpoint, radius, lat, lon, query,
      osmBase: payload.data.osm3s && payload.data.osm3s.timestamp_osm_base,
      ms: payload.ms, rawCount: (payload.data.elements || []).length, skipped, fromCache,
    };

    render(items);
    showQuery(query);

    const when = state.meta.osmBase ? ` · datos OSM al ${esc(state.meta.osmBase)}` : '';
    if (items.length === 0) {
      setStatus('empty', `<strong>La consulta funcionó, pero no hay elementos.</strong> Overpass respondió sin resultados para estas etiquetas en ${radius} m${when}. Puede que no existan o que no estén mapeados en OSM. Prueba un radio mayor.`);
    } else {
      const origin = fromCache ? 'Resultado guardado localmente (consulta repetida hace menos de 2 min; no se envió una nueva solicitud).' : `Respuesta real de Overpass en ${payload.ms} ms (HTTP ${payload.status}).`;
      setStatus('ok', `<strong>${items.length} elementos encontrados</strong> en ${radius} m. ${origin}${when}`);
    }
    $('download').hidden = false;
    if (state.circle) map.fitBounds(state.circle.getBounds(), { padding: [20, 20] });
  }

  function render(items) {
    CATEGORIES.forEach((cat) => {
      const ui = catUI[cat.id];
      ui.layer.clearLayers();
      ui.list.innerHTML = '';
      const list = items.filter((i) => i.cat.id === cat.id);
      ui.count.textContent = list.length;

      if (list.length === 0) {
        ui.meta.textContent = 'No se encontraron elementos con estas etiquetas.';
        return;
      }
      const named = list.filter((i) => i.name).length;
      const byType = {};
      list.forEach((i) => { byType[i.subtype] = (byType[i.subtype] || 0) + 1; });
      ui.meta.textContent = `${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(' · ')} — ${named} con nombre, ${list.length - named} sin nombre`;

      list.forEach((it) => {
        if (it.shape && it.shape.length > 1) {
          const opts = { color: cat.color, weight: 2, fillOpacity: 0.15 };
          (it.closed ? L.polygon(it.shape, opts) : L.polyline(it.shape, opts)).addTo(ui.layer);
        }
        const marker = L.marker([it.lat, it.lon], { icon: poiIcon(cat), title: it.name || it.subtype })
          .bindPopup(popupHtml(it))
          .addTo(ui.layer);

        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'item';
        btn.innerHTML = `
          <span class="nm${it.name ? '' : ' none'}">${esc(it.name || 'Sin nombre en OSM')}</span>
          <span class="ds">${fmtDist(it.distance)}</span>
          <span class="sub">${esc(it.subtype)} · ${esc(it.tag)}</span>`;
        btn.addEventListener('click', () => {
          if (!ui.check.checked) { ui.check.checked = true; ui.check.dispatchEvent(new Event('change')); }
          map.setView([it.lat, it.lon], Math.max(map.getZoom(), 17));
          marker.openPopup();
        });
        li.appendChild(btn);
        ui.list.appendChild(li);
      });
    });
  }

  function showQuery(query) {
    $('query-text').value = query;
    $('turbo-link').href = `https://overpass-turbo.eu/?Q=${encodeURIComponent(query)}&R`;
    $('query-details').hidden = false;
  }

  // --------------------------------------------------------- Descarga de datos
  $('download').addEventListener('click', () => {
    if (!state.meta) return;
    const out = {
      ...state.meta,
      zonificacion: state.zona
        ? { codigo: state.zona.codigo, regla: state.zona.regla, fuente: CONFIG.zonificacion.fuente }
        : null,
      denuncias: state.delito
        ? {
          radio_m: state.delito.radio,
          desde: state.delito.meta.ventanaDesde,
          hasta: state.delito.meta.hasta,
          robo: state.delito.conteo.ROBO,
          hurto: state.delito.conteo.HURTO,
          total: state.delito.conteo.total,
          fuente: CONFIG.delitos.fuente,
        }
        : null,
      elements: state.items.map((i) => ({
        osm: i.id, category: i.cat.id, subtype: i.subtype, matchedTag: i.tag, name: i.name,
        lat: i.lat, lon: i.lon, distance_m: Math.round(i.distance * 10) / 10, distance_method: i.method, tags: i.tags,
      })),
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `osm-arequipa-${state.meta.lat.toFixed(5)}_${state.meta.lon.toFixed(5)}_${state.meta.radius}m.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('analyze').addEventListener('click', analyze);

  // Ayuda para verificar desde la consola del navegador (F12)
  window.osmDebug = { state, Geo, Services, Zonificacion, Delitos, CATEGORIES };
})();
