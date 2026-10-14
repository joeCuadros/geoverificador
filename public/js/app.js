/**
 * app.js — Interfaz: mapa Leaflet, selección de punto, análisis y resultados.
 * Principio de uso responsable: NINGUNA consulta se lanza al hacer clic, escribir o cambiar el radio.
 * Solo se consulta al pulsar «Buscar» (Nominatim) o «Analizar entorno» (Overpass).
 * La zonificación, los peligros, la zona sísmica y las denuncias sí se muestran al elegir el punto, porque se
 * resuelven con archivos locales (zonificacion.js, peligros.js, distritos.js y delitos.js). El registro de riesgos
 * (riesgos.js) se arma con esos mismos datos.
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
    peligro: null,       // resultado de Peligros.indicador para el punto actual
    peligroStatus: 'none', // none | loading | ok | error
    peligroSeq: 0,       // descarta respuestas de un punto anterior
    pelLayer: null,      // peligros registrados (se crea la primera vez que se activa)
    distrito: null,      // resultado de Distritos.lookup (distrito y zona sísmica)
    distritoStatus: 'none', // none | loading | ok | outside | error
    distritoSeq: 0,      // descarta respuestas de un punto anterior
    evaluacion: {},      // evaluación del usuario por riesgo: { id: { p, i, decision, hechas } }
  };

  // ------------------------------------------------------------------ Mapa
  const map = L.map('map').setView(CONFIG.center, CONFIG.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

  // El plano de zonificación va en un panel propio, debajo de marcadores y círculo, y no captura clics.
  const zonPane = map.createPane('zonificacion');
  zonPane.style.zIndex = 350;
  zonPane.style.pointerEvents = 'none';
  // El mapa de calor va encima del plano y debajo de marcadores; tampoco captura clics.
  const calorPane = map.createPane('calor');
  calorPane.style.zIndex = 360;
  calorPane.style.pointerEvents = 'none';
  // Los peligros van encima del mapa de calor y sí reciben clics (para abrir su popup).
  map.createPane('peligros').style.zIndex = 450;

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
    sec.className = 'osm-cat';
    sec.innerHTML = `
      <label class="osm-cat-head">
        <input type="checkbox" checked aria-label="Mostrar ${esc(cat.label)}">
        <span class="swatch" style="background:${cat.color}"></span>
        <span class="name">${esc(cat.label)}</span>
        <span class="count">–</span>
      </label>
      <div class="osm-cat-meta">Sin analizar</div>
      <ul class="items"></ul>`;
    $('cats').appendChild(sec);
    const layer = L.layerGroup().addTo(map);
    const ui = {
      sec, layer,
      check: sec.querySelector('input'),
      count: sec.querySelector('.count'),
      meta: sec.querySelector('.osm-cat-meta'),
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

  // ------------------------------------------------------------- Pestañas
  const TABS = ['resumen', 'normativo', 'desastre', 'seguridad', 'entorno', 'riesgos', 'fuentes'];
  function selectTab(name, focus = false) {
    TABS.forEach((t) => {
      const btn = $(`tabbtn-${t}`);
      const on = t === name;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      $(`tab-${t}`).hidden = !on;
      if (on && t === 'entorno' && !state.mostrarEntorno) { state.mostrarEntorno = true; drawCircle(); }
      if (on && focus) btn.focus();
      // La pestaña activa siempre queda visible en la barra (que se desplaza en horizontal).
      if (on) { const bar = btn.parentElement; bar.scrollLeft = btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2; }
    });
    // Si el panel estaba desplazado, vuelve al inicio del contenido (las pestañas quedan fijas arriba).
    const panel = document.querySelector('.panel');
    const tope = document.querySelector('.point-card').offsetHeight;
    if (panel.scrollTop > tope) panel.scrollTop = tope;
  }
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[role="tab"]');
    if (btn) selectTab(btn.dataset.tab);
  });
  // Flechas izquierda/derecha, Inicio y Fin, como en un tablist estándar.
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(document.activeElement?.dataset?.tab);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = TABS.length - 1;
    if (n !== null) { e.preventDefault(); selectTab(TABS[n], true); }
  });

  // Tarjeta de capas plegable (plegada de inicio en pantallas angostas).
  function setLayersOpen(open) {
    $('layers-toggle').setAttribute('aria-expanded', String(open));
    $('layers-body').hidden = !open;
  }
  $('layers-toggle').addEventListener('click', () => setLayersOpen($('layers-body').hidden));
  if (window.matchMedia('(max-width: 820px)').matches) setLayersOpen(false);

  $('probar').addEventListener('click', () => {
    setPoint(CONFIG.center[0], CONFIG.center[1]);
    map.setView(CONFIG.center, 16);
  });

  // Botones «Ver en el mapa» de cada pestaña: activan la misma casilla de la tarjeta de capas y se sincronizan con ella.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-capa]');
    if (b) $(b.dataset.capa).click();
  });
  ['zon-layer', 'pel-layer', 'del-layer'].forEach((id) => {
    $(id).addEventListener('change', () => {
      document.querySelectorAll(`[data-capa="${id}"]`).forEach((b) => b.setAttribute('aria-pressed', String($(id).checked)));
    });
  });

  // Menú de resultados del buscador: se cierra con Escape o al hacer clic fuera.
  const showSearchPop = (show) => { $('search-pop').hidden = !show; };
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) showSearchPop(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') showSearchPop(false); });

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
  // Dos círculos: el radio de análisis de peligros y denuncias (siempre) y el radio del entorno de OSM
  // (solo cuando se usa la pestaña Entorno, para no confundir qué se está midiendo).
  function drawCircle() {
    if (state.circle) { map.removeLayer(state.circle); state.circle = null; }
    if (state.ring) { map.removeLayer(state.ring); state.ring = null; }
    if (!state.point) return;
    const c = [state.point.lat, state.point.lon];
    state.ring = L.circle(c, {
      radius: CONFIG.peligros.radio, color: '#0f766e', weight: 2, fillColor: '#0f766e', fillOpacity: 0.06, interactive: false,
    }).addTo(map);
    if (state.mostrarEntorno) {
      state.circle = L.circle(c, {
        radius: Number($('radius').value), color: '#16a34a', weight: 1.5, dashArray: '6 6', fill: false, interactive: false,
      }).addTo(map);
    }
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
    $('query-details').hidden = true;
    renderResumen();
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
    state.evaluacion = Riesgos.leerEvaluacion(lat, lon);
    $('welcome').hidden = true;
    $('ficha').hidden = false;
    $('map-hint').classList.add('oculto');
    $('point-distrito').textContent = 'Buscando distrito…';
    updatePeligro();
    updateDistrito();
    updateDelito();
    renderResumen();
    $('point-info').innerHTML = `${lat.toFixed(6)}, ${lon.toFixed(6)} · <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}" target="_blank" rel="noopener">ver en OSM</a>`;
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

  $('zon-fuente').textContent = `Fuente: ${CONFIG.zonificacion.fuente}. Referencial: no reemplaza los certificados municipales.`;

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
      renderPeligro(); // el aviso de zona de riesgo depende de la zonificación
      renderResumen();
    } catch (err) {
      if (seq !== state.zonaSeq) return;
      state.zonaStatus = 'error';
      renderResumen();
      zonMessage('error', `<strong>No se pudo consultar la zonificación.</strong> ${esc(err.message)}`);
      console.error('[Zonificación] fallo', err);
    }
  }

  $('lote').addEventListener('input', () => { renderZona(); renderResumen(); });

  // ------------------------------------------------------------------ Peligros
  $('pel-fuente').textContent = `Fuente: ${CONFIG.peligros.fuente}. Es un inventario de eventos documentados: que no haya registros no significa que el lugar sea seguro.`;

  function pelMessage(kind, html) {
    $('pel').innerHTML = `<p class="zon-msg ${kind}">${html}</p>`;
  }

  // ¿El plano de zonificación marca el punto como zona de riesgo?
  const enZonaRiesgo = () => state.zonaStatus === 'ok' && state.zona.regla && state.zona.regla.grupo === 'riesgo';

  function renderPeligro() {
    if (state.peligroStatus !== 'ok') return;
    const p = state.peligro;
    const m = p.masCercano;
    const alerta = enZonaRiesgo()
      ? `<p class="zon-msg error"><strong>El plano de zonificación ubica este punto en zona de riesgo muy alto (${esc(state.zona.codigo)}: ${esc(state.zona.regla.nombre)}).</strong> ${esc(state.zona.regla.nota || '')}</p>`
      : '';
    $('pel').innerHTML = `
      ${alerta}
      <div class="zon-card">
        <div class="stat-row"><span class="big-number">${fmtNum(p.total)}</span><span class="stat-label">peligro${p.total === 1 ? '' : 's'} geológico${p.total === 1 ? '' : 's'} registrado${p.total === 1 ? '' : 's'} a ${p.radio} m</span></div>
        ${p.porTipo.length ? `<ul class="pel-tipos">${p.porTipo.map(([t, n]) => `<li>${esc(t)} · ${fmtNum(n)}</li>`).join('')}</ul>` : ''}
        <dl class="zon-data">
          <div><dt>Más cercano</dt><dd>${fmtDist(m.distancia)}</dd></div>
          <div><dt>Tipo</dt><dd>${esc(m.subtipo || m.tipo)}</dd></div>
          ${m.anio ? `<div><dt>Registrado</dt><dd>${esc(m.anio)}</dd></div>` : ''}
        </dl>
        <p class="zon-nota">${m.sector ? `Sector del más cercano: «${esc(m.sector)}». ` : ''}Inventario ${esc(p.meta.anioDesde)}–${esc(p.meta.anioHasta)}, ${fmtNum(p.meta.registros)} registros en Arequipa metropolitana. Un registro es un evento documentado en un sector, no su alcance real.</p>
      </div>`;
  }

  async function updatePeligro() {
    const seq = ++state.peligroSeq;
    const { lat, lon } = state.point;
    state.peligro = null;
    state.peligroStatus = 'loading';
    pelMessage('loading', '<span class="spinner"></span>Buscando peligros registrados cerca…');
    try {
      const p = await Peligros.indicador(lat, lon);
      if (seq !== state.peligroSeq) return; // el usuario ya eligió otro punto
      state.peligro = p;
      state.peligroStatus = 'ok';
      renderPeligro();
    } catch (err) {
      if (seq !== state.peligroSeq) return;
      state.peligroStatus = 'error';
      pelMessage('error', `<strong>No se pudo consultar el inventario de peligros.</strong> ${esc(err.message)}`);
      console.error('[Peligros] fallo', err);
    }
    renderResumen();
  }

  $('pel-layer').addEventListener('change', async (e) => {
    const box = e.target;
    if (!box.checked) {
      if (state.pelLayer) map.removeLayer(state.pelLayer);
      return;
    }
    box.disabled = true;
    try {
      if (!state.pelLayer) state.pelLayer = await Peligros.capa('peligros');
      if (box.checked) state.pelLayer.addTo(map);
    } catch (err) {
      box.checked = false;
      pelMessage('error', `<strong>No se pudieron cargar los peligros.</strong> ${esc(err.message)}`);
      console.error('[Peligros] fallo', err);
    } finally {
      box.disabled = false;
    }
  });

  // ------------------------------------------------------------ Peligro sísmico
  $('sismo-fuente').textContent = `Fuente: ${CONFIG.distritos.fuente}.`;

  const capitalizar = (t) => t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\b(Y|De|Del|La)\b/g, (m) => m.toLowerCase());

  function renderSismo() {
    const el = $('sismo');
    if (state.distritoStatus === 'loading') { el.innerHTML = '<p class="zon-msg loading"><span class="spinner"></span>Buscando el distrito y su zona sísmica…</p>'; return; }
    if (state.distritoStatus === 'error') { el.innerHTML = `<p class="zon-msg error"><strong>No se pudo consultar la zona sísmica.</strong> ${esc(state.distritoError || '')}</p>`; return; }
    if (state.distritoStatus === 'outside') { el.innerHTML = '<p class="zon-msg empty">El punto está fuera de los distritos descargados: no se asigna zona sísmica.</p>'; return; }
    if (state.distritoStatus !== 'ok') { el.innerHTML = ''; return; }
    const d = state.distrito;
    el.innerHTML = `
      <div class="zon-card">
        <div class="sismo-z">
          <div class="sismo-ring"><div><b>${esc(d.zona)}</b><small>Zona</small></div></div>
          <div>
            <div class="stat-row"><span class="big-number">Z = ${esc(String(d.z).replace('.', ','))}</span></div>
            <div class="muted small">Distrito de ${esc(capitalizar(d.distrito))} · Norma E.030 2026</div>
          </div>
        </div>
        <p class="zon-nota">Z es la aceleración máxima horizontal en suelo rígido con 10 % de probabilidad de ser excedida en 50 años, como fracción de la gravedad (E.030, Art. 11). Es un valor regional: el suelo del predio puede amplificar el movimiento y eso lo determina el Estudio de Mecánica de Suelos que la E.030 exige a todo proyecto de edificación (Art. 16.1).</p>
      </div>`;
  }

  async function updateDistrito() {
    const seq = ++state.distritoSeq;
    const { lat, lon } = state.point;
    state.distrito = null;
    state.distritoStatus = 'loading';
    renderSismo();
    try {
      const d = await Distritos.lookup(lat, lon);
      if (seq !== state.distritoSeq) return; // el usuario ya eligió otro punto
      state.distrito = d;
      state.distritoStatus = d ? 'ok' : 'outside';
      $('point-distrito').textContent = d ? `Distrito de ${capitalizar(d.distrito)}` : 'Fuera de los distritos de Arequipa metropolitana';
    } catch (err) {
      if (seq !== state.distritoSeq) return;
      state.distritoStatus = 'error';
      state.distritoError = err.message;
      $('point-distrito').textContent = 'Punto seleccionado';
      console.error('[Distritos] fallo', err);
    }
    renderSismo();
    renderResumen();
  }

  // ------------------------------------------------------------------ Resumen
  // Una tarjeta por tipo de riesgo con el dato tal cual lo entrega cada fuente (sin puntaje ni semáforo global).
  // Al hacer clic se abre la pestaña con el detalle.
  function tarjeta({ tab, kicker, valor, detalle, badge, wide, cargando }) {
    return `
      <button type="button" class="sum-card ${tab}${wide ? ' wide' : ''}${cargando ? ' loading' : ''}" data-tab="${tab}">
        <span class="sum-kicker">${kicker}</span>
        <span class="sum-value">${valor}</span>
        ${detalle ? `<span class="sum-detail">${detalle}</span>` : ''}
        ${badge ? `<span class="badge ${badge.cls}">${esc(badge.text)}</span>` : ''}
        <span class="sum-go">Ver detalle →</span>
      </button>`;
  }
  const cargandoHtml = '<span class="spinner"></span>Consultando…';
  const fmtCorto = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')} k` : String(n));

  function setBadge(id, texto, cls = '') {
    const el = $(`badge-${id}`);
    el.textContent = texto ?? '';
    el.className = `tab-badge${cls ? ` ${cls}` : ''}`;
  }

  function renderResumen() {
    if (!state.point) return;
    renderRiesgos();
    const cards = [];

    // Normativo
    if (state.zonaStatus === 'ok') {
      const r = state.zona.regla;
      const badge = ZON_BADGE[r && r.edificable];
      cards.push(tarjeta({ tab: 'normativo', kicker: 'Normativo', valor: esc(state.zona.codigo), detalle: esc(r ? r.nombre : 'Código sin reglas en la tabla'), badge }));
      setBadge('normativo', state.zona.codigo);
    } else if (state.zonaStatus === 'outside') {
      cards.push(tarjeta({ tab: 'normativo', kicker: 'Normativo', valor: 'Sin zona', detalle: 'El punto está fuera del área zonificada del plano.', badge: { cls: 'warn', text: 'Fuera del plano' } }));
      setBadge('normativo', '—');
    } else if (state.zonaStatus === 'error') {
      cards.push(tarjeta({ tab: 'normativo', kicker: 'Normativo', valor: 'No disponible', detalle: 'No se pudo consultar la zonificación.' }));
      setBadge('normativo', '');
    } else {
      cards.push(tarjeta({ tab: 'normativo', kicker: 'Normativo', valor: cargandoHtml, cargando: true }));
      setBadge('normativo', '');
    }

    // Desastre
    if (state.peligroStatus === 'ok') {
      const p = state.peligro;
      const det = [`El más cercano a ${fmtDist(p.masCercano.distancia)}.`];
      if (state.distritoStatus === 'ok') det.push(`Zona sísmica ${esc(state.distrito.zona)} (Z = ${esc(String(state.distrito.z).replace('.', ','))}).`);
      cards.push(tarjeta({
        tab: 'desastre', kicker: 'Desastre',
        valor: `${fmtNum(p.total)} peligro${p.total === 1 ? '' : 's'} a ${p.radio} m`,
        detalle: det.join(' '),
        badge: enZonaRiesgo() ? { cls: 'no', text: `Zona de riesgo en el plano (${state.zona.codigo})` } : null,
      }));
      setBadge('desastre', enZonaRiesgo() ? '!' : String(p.total), enZonaRiesgo() ? 'alerta' : '');
    } else if (state.peligroStatus === 'error') {
      cards.push(tarjeta({ tab: 'desastre', kicker: 'Desastre', valor: 'No disponible', detalle: 'No se pudo consultar el inventario de peligros.' }));
    } else {
      cards.push(tarjeta({ tab: 'desastre', kicker: 'Desastre', valor: cargandoHtml, cargando: true }));
    }

    // Seguridad
    if (state.delito) {
      const { total, ROBO, HURTO } = state.delito.conteo;
      cards.push(tarjeta({ tab: 'seguridad', kicker: 'Seguridad', valor: `${fmtNum(total)} denuncias`, detalle: `${fmtNum(ROBO)} robos · ${fmtNum(HURTO)} hurtos · ${state.delito.radio} m · ${state.delito.meta.meses} meses` }));
      setBadge('seguridad', fmtCorto(total));
    } else if (state.delitoError) {
      cards.push(tarjeta({ tab: 'seguridad', kicker: 'Seguridad', valor: 'No disponible', detalle: 'No se pudo calcular el indicador de denuncias.' }));
    } else {
      cards.push(tarjeta({ tab: 'seguridad', kicker: 'Seguridad', valor: cargandoHtml, cargando: true }));
    }

    // Entorno
    if (state.items.length && state.meta) {
      const por = CATEGORIES.map((c) => `${c.label.toLowerCase()} ${state.items.filter((i) => i.cat.id === c.id).length}`).join(' · ');
      cards.push(tarjeta({ tab: 'entorno', kicker: 'Entorno', valor: `${state.items.length} elementos`, detalle: `${por} (${state.meta.radius} m)` }));
      setBadge('entorno', String(state.items.length));
    } else if (state.meta) {
      cards.push(tarjeta({ tab: 'entorno', kicker: 'Entorno', valor: '0 elementos', detalle: `Sin elementos de OSM en ${state.meta.radius} m con las etiquetas consultadas.` }));
      setBadge('entorno', '0');
    } else {
      cards.push(tarjeta({ tab: 'entorno', kicker: 'Entorno', valor: 'Sin analizar', detalle: 'Consulta OpenStreetMap desde la pestaña Entorno.' }));
      setBadge('entorno', '');
    }

    // Registro de riesgos
    const rs = state.riesgos || [];
    const ev = state.evaluacion;
    const evaluados = rs.filter((r) => Riesgos.nivel(ev[r.id]?.p, ev[r.id]?.i));
    const altos = evaluados.filter((r) => Riesgos.nivel(ev[r.id].p, ev[r.id].i).texto === 'Alto').length;
    cards.push(tarjeta({
      tab: 'riesgos', kicker: 'Gestión de riesgos', wide: true,
      valor: `${rs.length} riesgos identificados`,
      detalle: evaluados.length ? `${evaluados.length} evaluados por ti · ${altos} de nivel alto.` : 'Evalúa la probabilidad y el impacto de cada uno y elige qué harás.',
    }));
    setBadge('riesgos', rs.length ? String(rs.length) : '', 'accent');

    $('resumen').innerHTML = cards.join('');
  }

  $('resumen').addEventListener('click', (e) => {
    const card = e.target.closest('.sum-card');
    if (card) selectTab(card.dataset.tab);
  });

  // ------------------------------------------------------------ Gestión de riesgos
  function contextoRiesgos() {
    const lote = Number($('lote').value);
    return {
      zonaStatus: state.zonaStatus,
      zona: state.zonaStatus === 'ok' ? state.zona : null,
      lote: lote > 0 ? lote : null,
      peligro: state.peligroStatus === 'ok' ? state.peligro : null,
      distrito: state.distritoStatus === 'ok' ? state.distrito : null,
      delito: state.delito,
    };
  }

  // Datos que aún se están cargando (el registro se completa cuando terminan).
  function pendientes() {
    const p = [];
    if (state.zonaStatus === 'loading') p.push('zonificación');
    if (state.peligroStatus === 'loading') p.push('peligros');
    if (state.distritoStatus === 'loading') p.push('zona sísmica');
    if (!state.delito && !state.delitoError) p.push('denuncias');
    return p;
  }

  function opciones(lista, valor) {
    return `<option value="">—</option>${lista.map((o) => `<option value="${o.v}"${o.v === valor ? ' selected' : ''}>${esc(o.texto)}</option>`).join('')}`;
  }

  // Grupo de botones excluyentes (radio) para probabilidad o impacto.
  function segmentado(id, k, valor) {
    return `<div class="seg" role="radiogroup">${Riesgos.ESCALA.map((o) => `
      <label><input type="radio" name="${id}-${k}" data-k="${k}" value="${o.v}"${o.v === valor ? ' checked' : ''}><span>${esc(o.texto)}</span></label>`).join('')}</div>`;
  }

  // Matriz 3 × 3 con los riesgos que el usuario ya evaluó (probabilidad en filas, impacto en columnas).
  function matrizHtml(riesgos, ev) {
    const nombres = ['Baja', 'Media', 'Alta'];
    let celdas = '';
    for (let p = 3; p >= 1; p--) {
      celdas += `<div class="lab-y" style="grid-row:${4 - p}">${nombres[p - 1]}</div>`;
      for (let i = 1; i <= 3; i++) {
        const n = Riesgos.nivel(p, i);
        const ids = riesgos.filter((r) => ev[r.id]?.p === p && ev[r.id]?.i === i);
        celdas += `<div class="celda ${n.texto.toLowerCase()}" style="grid-row:${4 - p};grid-column:${i + 2}" title="Probabilidad ${nombres[p - 1].toLowerCase()} · impacto ${nombres[i - 1].toLowerCase()}: nivel ${n.texto.toLowerCase()}">
          <span class="pt">${n.puntaje}</span>${ids.map((r) => `<button type="button" class="chip-id" data-ir="${r.id}" title="${esc(r.titulo)}">${r.id}</button>`).join('')}</div>`;
      }
    }
    const labsX = nombres.map((t, k) => `<div class="lab-x" style="grid-column:${k + 3}">${t}</div>`).join('');
    const hay = riesgos.some((r) => Riesgos.nivel(ev[r.id]?.p, ev[r.id]?.i));
    return `
      <div class="matriz-wrap">
        <div class="matriz-title"><strong>Matriz de riesgos</strong><span>nivel = probabilidad × impacto</span></div>
        <div class="matriz">
          <div class="eje-y">Probabilidad</div>${celdas}${labsX}<div class="eje-x">Impacto</div>
        </div>
        ${hay ? '' : '<p class="matriz-vacia">Aún no evaluaste ningún riesgo: elige probabilidad e impacto en las tarjetas de abajo y aparecerán aquí.</p>'}
      </div>`;
  }

  state.filtroRiesgo = 'Todos';

  function renderRiesgos() {
    if (!state.point) return;
    const riesgos = Riesgos.identificar(contextoRiesgos());
    state.riesgos = riesgos;
    const ev = state.evaluacion;
    const evaluados = riesgos.filter((r) => Riesgos.nivel(ev[r.id]?.p, ev[r.id]?.i));
    const altos = evaluados.filter((r) => Riesgos.nivel(ev[r.id].p, ev[r.id].i).texto === 'Alto').length;
    const falta = pendientes();
    const decisiones = Riesgos.DECISIONES.map((t, k) => ({ v: k, texto: t }));
    const categorias = ['Todos', ...new Set(riesgos.map((r) => r.categoria))];
    if (!categorias.includes(state.filtroRiesgo)) state.filtroRiesgo = 'Todos';
    const visibles = riesgos.filter((r) => state.filtroRiesgo === 'Todos' || r.categoria === state.filtroRiesgo);

    $('riesgos').innerHTML = `
      <div class="r-kpis">
        <div class="r-kpi"><b>${riesgos.length}</b><span>identificados</span></div>
        <div class="r-kpi"><b>${evaluados.length}</b><span>evaluados por ti</span></div>
        <div class="r-kpi alto"><b>${altos}</b><span>de nivel alto</span></div>
      </div>
      ${falta.length ? `<p class="r-loading"><span class="spinner"></span>Cargando ${esc(falta.join(', '))}: el registro se completa al terminar.</p>` : ''}
      ${matrizHtml(riesgos, ev)}
      <div class="filtros" role="group" aria-label="Filtrar por tipo de riesgo">
        ${categorias.map((c) => `<button type="button" data-filtro="${esc(c)}" aria-pressed="${c === state.filtroRiesgo}">${esc(c)}<span class="n">${c === 'Todos' ? riesgos.length : riesgos.filter((r) => r.categoria === c).length}</span></button>`).join('')}
      </div>
      ${visibles.length ? visibles.map((r) => {
        const e = ev[r.id] || {};
        const n = Riesgos.nivel(e.p, e.i);
        const hechas = (e.hechas || []).filter((k) => k < r.acciones.length).length;
        const pct = Math.round((100 * hechas) / r.acciones.length);
        return `
        <article class="riesgo ${r.categoria.toLowerCase()}" id="riesgo-${r.id}" data-id="${r.id}">
          <div class="r-head">
            <div class="r-titles">
              <div class="r-tag">${esc(r.categoria)}<span class="r-id">${r.id}</span></div>
              <h3>${esc(r.titulo)}</h3>
            </div>
            <span class="badge ${n ? n.cls : 'neutral'}">${n ? `Nivel ${n.texto.toLowerCase()} · ${n.puntaje}` : 'Sin evaluar'}</span>
          </div>
          <p class="r-evidencia">${esc(r.evidencia)}</p>
          <p class="r-fuente">Fuente del dato: ${esc(r.fuente)}</p>
          <div class="r-eval">
            <div><span class="r-lbl">Probabilidad</span>${segmentado(r.id, 'p', e.p)}</div>
            <div><span class="r-lbl">Impacto</span>${segmentado(r.id, 'i', e.i)}</div>
            <label class="r-dec"><span class="r-lbl">Decisión</span><select data-k="decision">${opciones(decisiones, e.decision)}</select></label>
          </div>
          <div class="r-acciones-head">
            <span class="r-lbl">Acciones de tratamiento</span>
            <span class="progreso"><span class="pbar"><i style="width:${pct}%"></i></span>${hechas}/${r.acciones.length}</span>
          </div>
          <ul class="r-acciones">
            ${r.acciones.map((ac, k) => {
              const hecha = (e.hechas || []).includes(k);
              return `<li class="${hecha ? 'hecha' : ''}"><label><input type="checkbox" data-k="hecha" data-a="${k}"${hecha ? ' checked' : ''}> <span>${esc(ac.texto)}</span></label><span class="fuente">Fuente: ${esc(ac.fuente)}</span></li>`;
            }).join('')}
          </ul>
          ${e.p || e.i || e.decision != null || (e.hechas || []).length ? '<div class="r-foot"><button type="button" data-limpiar="1">Limpiar mi evaluación</button></div>' : ''}
        </article>`;
      }).join('') : '<p class="r-vacio">Sin riesgos en esta categoría.</p>'}`;
    $('riesgos-csv').hidden = riesgos.length === 0;
  }

  const guardarYRedibujar = () => {
    Riesgos.guardarEvaluacion(state.point.lat, state.point.lon, state.evaluacion);
    renderResumen(); // redibuja también el registro y las insignias
  };

  $('riesgos').addEventListener('change', (e) => {
    const card = e.target.closest('.riesgo');
    if (!card || !state.point) return;
    const id = card.dataset.id;
    const k = e.target.dataset.k;
    const ev = state.evaluacion[id] || (state.evaluacion[id] = {});
    if (k === 'hecha') {
      const a = Number(e.target.dataset.a);
      const set = new Set(ev.hechas || []);
      if (e.target.checked) set.add(a); else set.delete(a);
      ev.hechas = [...set];
    } else {
      ev[k] = e.target.value === '' ? null : Number(e.target.value);
    }
    guardarYRedibujar();
  });

  $('riesgos').addEventListener('click', (e) => {
    const filtro = e.target.closest('[data-filtro]');
    if (filtro) { state.filtroRiesgo = filtro.dataset.filtro; renderRiesgos(); return; }
    const chip = e.target.closest('[data-ir]');
    if (chip) {
      state.filtroRiesgo = 'Todos';
      renderRiesgos();
      const card = $(`riesgo-${chip.dataset.ir}`);
      if (card) { card.scrollIntoView({ block: 'start' }); card.classList.add('destacado'); setTimeout(() => card.classList.remove('destacado'), 1500); }
      return;
    }
    if (e.target.closest('[data-limpiar]') && state.point) {
      const id = e.target.closest('.riesgo').dataset.id;
      delete state.evaluacion[id];
      guardarYRedibujar();
    }
  });

  $('riesgos-csv').addEventListener('click', () => {
    if (!state.point || !state.riesgos) return;
    const blob = new Blob([Riesgos.registroCsv(state.riesgos, state.evaluacion, state.point)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `registro-riesgos_${state.point.lat.toFixed(5)}_${state.point.lon.toFixed(5)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

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
    const pRobo = total ? (100 * ROBO) / total : 0;
    $('del').innerHTML = `
      <div class="zon-card">
        <div class="stat-row"><span class="big-number">${fmtNum(total)}</span><span class="stat-label">denuncias de robo y hurto a ${d.radio} m</span></div>
        ${total ? `<div class="bar-split" aria-hidden="true"><span style="width:${pRobo}%;background:#b91c1c"></span><span style="width:${100 - pRobo}%;background:#fca5a5"></span></div>
        <div class="bar-legend"><span><i style="background:#b91c1c"></i>${fmtNum(ROBO)} robos</span><span><i style="background:#fca5a5"></i>${fmtNum(HURTO)} hurtos</span></div>` : ''}
        <p class="zon-nota">Periodo: ${d.meta.meses} meses (${esc(periodo)}), el tramo reciente donde ≥ ${Math.round(CONFIG.delitos.coberturaMinima * 100)} % de las denuncias trae ubicación (${Math.round(d.meta.coberturaVentana * 100)} % en promedio). Solo cuenta las que tienen ubicación. Robo: con violencia o amenaza; hurto: sin violencia.</p>
      </div>
      <p class="zon-msg">Para compararlo con el resto de la ciudad, usa <strong>Ver mapa de calor</strong>: muestra dónde se concentran las denuncias (escala relativa).</p>`;
  }

  async function updateDelito() {
    const seq = ++state.delitoSeq;
    const { lat, lon } = state.point;
    state.delito = null;
    state.delitoError = false;
    delMessage('loading', '<span class="spinner"></span>Contando denuncias alrededor del punto…');
    try {
      const d = await Delitos.indicador(lat, lon);
      if (seq !== state.delitoSeq) return; // el usuario ya eligió otro punto
      state.delito = d;
      state.delitoError = false;
      renderDelito();
      renderResumen();
    } catch (err) {
      if (seq !== state.delitoSeq) return;
      state.delitoError = true;
      renderResumen();
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
    showSearchPop(true);
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
            showSearchPop(false);
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
    renderResumen();
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
    if (!state.point) return;
    const out = {
      generado: new Date().toISOString(),
      punto: { lat: state.point.lat, lon: state.point.lon },
      entorno_consulta: state.meta || null,
      zonificacion: state.zona
        ? { codigo: state.zona.codigo, regla: state.zona.regla, fuente: CONFIG.zonificacion.fuente }
        : null,
      zona_sismica: state.distritoStatus === 'ok'
        ? { distrito: state.distrito.distrito, ubigeo: state.distrito.ubigeo, zona: state.distrito.zona, z: state.distrito.z, fuente: CONFIG.distritos.fuente }
        : null,
      registro_riesgos: (state.riesgos || []).map((r) => {
        const e = state.evaluacion[r.id] || {};
        const n = Riesgos.nivel(e.p, e.i);
        return {
          id: r.id, categoria: r.categoria, riesgo: r.titulo, evidencia: r.evidencia, fuente: r.fuente,
          probabilidad: e.p ?? null, impacto: e.i ?? null, nivel: n ? n.texto : null,
          decision: e.decision != null ? Riesgos.DECISIONES[e.decision] : null,
          acciones: r.acciones.map((ac, k) => ({ accion: ac.texto, fuente: ac.fuente, hecha: (e.hechas || []).includes(k) })),
        };
      }),
      peligros_geologicos: state.peligro
        ? {
          radio_m: state.peligro.radio,
          total: state.peligro.total,
          por_tipo: Object.fromEntries(state.peligro.porTipo),
          mas_cercano: {
            distancia_m: Math.round(state.peligro.masCercano.distancia),
            tipo: state.peligro.masCercano.tipo,
            subtipo: state.peligro.masCercano.subtipo,
            sector: state.peligro.masCercano.sector,
            anio: state.peligro.masCercano.anio,
          },
          fuente: CONFIG.peligros.fuente,
        }
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
    a.download = `ficha-predio_${state.point.lat.toFixed(5)}_${state.point.lon.toFixed(5)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('analyze').addEventListener('click', analyze);

  // Ayuda para verificar desde la consola del navegador (F12)
  window.osmDebug = { map, state, Geo, Services, Zonificacion, Peligros, Distritos, Riesgos, Delitos, CATEGORIES };
})();
