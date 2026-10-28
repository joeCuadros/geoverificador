/**
 * app.js — Interfaz: mapa Leaflet, selección de punto y ficha de las 5 variables.
 * Al elegir el punto, todo se resuelve con archivos locales de public/data: zonificación vigente (V1a), aviso del PDM
 * proyectado (V1b, texto de CONFIG.estadoPDM) y equipamiento de OpenStreetMap congelado (V2 a V5: salud, educación
 * por nivel, transporte y área verde; ver equipamiento.js). Solo la búsqueda de direcciones (Nominatim) consulta un
 * servicio externo, al pulsar «Buscar»; Overpass en vivo se usa únicamente si falta un archivo de equipamiento.
 * Los módulos fuera de alcance (peligros, zona sísmica, denuncias y registro de riesgos) siguen en el código pero se
 * ocultan con CONFIG.modulos; `?modulos=todos` en la URL los vuelve a mostrar.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDist = (d) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(2).replace('.', ',')} km`);

  const fmtUmbral = (m) => `${Math.round(m)} m`; // los umbrales se dicen siempre en metros

  // Módulos visibles: CONFIG.modulos, o todos con ?modulos=todos (ver Calculos.modulosEfectivos).
  const MODULOS = Calculos.modulosEfectivos(CONFIG.modulos, window.location.search);

  const state = {
    point: null,
    pointMarker: null,
    circle: null,
    entorno: null,       // resultado de Equipamiento.evaluar para el punto actual (salud, educación, transporte, área verde)
    entornoStatus: 'none', // none | loading | ok
    entornoSeq: 0,       // descarta respuestas de un punto anterior
    entornoLayer: null,  // marcadores y líneas hacia lo más cercano de cada variable
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

  // ------------------------------------------------------- Módulos y documentación
  // Lo que pertenece a un módulo oculto no se muestra (nunca se vuelve a mostrar un panel: eso lo decide la pestaña).
  document.querySelectorAll('[data-modulo]').forEach((el) => {
    if (!el.dataset.modulo.split(' ').some((m) => MODULOS[m])) el.hidden = true;
  });

  // Documentación automática de lo que realmente se consulta (mismas definiciones que usan la extracción y la clasificación)
  const code = (v) => `<code>${esc(v)}</code>`;
  const NOMBRE_VARIABLE = { salud: 'Salud', educacion: 'Educación', transporte: 'Transporte', areasVerdes: 'Áreas verdes' };
  $('filters-doc').innerHTML = Object.entries(Calculos.FILTROS).map(([cat, filtros]) => `
    <h4>${NOMBRE_VARIABLE[cat]}</h4>
    <ul>${filtros.map((f) => `<li>${code(f.clave)} = ${f.valores ? f.valores.map(code).join(', ') : `cualquier valor${f.excluir ? ` salvo ${f.excluir.map(code).join(', ')}` : ''}`}</li>`).join('')}</ul>`).join('')
    + `<h4>Niveles educativos</h4>
    <ul>
      <li>${code('amenity')} = ${code('kindergarten')} → inicial.</li>
      <li>${code('amenity')} = ${code('school')} con ${code('isced:level')} (0 inicial, 1 primaria, 2 y 3 secundaria) o ${code('school')} = ${code('kindergarten')}, ${code('primary')}, ${code('secondary')} → los niveles que declare.</li>
      <li>${code('amenity')} = ${code('school')} sin etiqueta de nivel → candidato a primaria y secundaria.</li>
    </ul>
    <h4>Umbrales</h4>
    <ul>
      <li>Salud: ${CONFIG.umbrales.salud} m (${esc(CONFIG.fuentesUmbral.salud.toLowerCase())}).</li>
      <li>Educación: inicial ${CONFIG.umbrales.educacion.inicial} m, primaria ${CONFIG.umbrales.educacion.primaria} m, secundaria ${CONFIG.umbrales.educacion.secundaria} m (${esc(CONFIG.fuentesUmbral.educacion)}).</li>
      <li>Transporte: ${CONFIG.umbrales.transporte} m (${esc(CONFIG.fuentesUmbral.transporte.toLowerCase())}).</li>
      <li>Área verde: al menos ${CONFIG.umbrales.areaVerde.areaMinM2} m² a ${CONFIG.umbrales.areaVerde.distanciaM} m (${esc(CONFIG.fuentesUmbral.areaVerde)}).</li>
      <li>Aviso de borde de zona: otra zona a ${CONFIG.umbrales.bordeZona} m o menos (${esc(CONFIG.fuentesUmbral.bordeZona.toLowerCase())}).</li>
    </ul>
    <p>Los archivos con estos elementos se generaron una vez con <code>pnpm datos:extraer</code> y están en <code>public/data/equipamiento</code>.</p>`;

  // ------------------------------------------------------------- Pestañas
  const TABS = [...document.querySelectorAll('.tabs [role="tab"]')].filter((b) => !b.hidden).map((b) => b.dataset.tab);
  function selectTab(name, focus = false) {
    TABS.forEach((t) => {
      const btn = $(`tabbtn-${t}`);
      const on = t === name;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      $(`tab-${t}`).hidden = !on;
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
  const VARIABLES = {
    salud: { titulo: 'Salud', icono: '🏥', color: '#c2410c' },
    educacion: { titulo: 'Educación', icono: '🎓', color: '#7c3aed' },
    transporte: { titulo: 'Transporte', icono: '🚌', color: '#1d4ed8' },
    areaVerde: { titulo: 'Área verde', icono: '🌳', color: '#15803d' },
  };

  function poiIcon(v) {
    return L.divIcon({
      className: 'poi-icon',
      html: `<span style="background:${v.color}">${v.icono}</span>`,
      iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -13],
    });
  }

  // ------------------------------------------------------------ Punto
  // Círculo de 500 m: solo lo usan los módulos de peligros y denuncias, así que solo se dibuja si alguno está visible.
  function drawCircle() {
    if (state.ring) { map.removeLayer(state.ring); state.ring = null; }
    if (!state.point || !(MODULOS.desastre || MODULOS.seguridad)) return;
    state.ring = L.circle([state.point.lat, state.point.lon], {
      radius: CONFIG.peligros.radio, color: '#0f766e', weight: 2, fillColor: '#0f766e', fillOpacity: 0.06, interactive: false,
    }).addTo(map);
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
    updateZona();
    if (MODULOS.riesgos) state.evaluacion = Riesgos.leerEvaluacion(lat, lon);
    $('welcome').hidden = true;
    $('ficha').hidden = false;
    $('map-hint').classList.add('oculto');
    $('point-distrito').textContent = 'Buscando distrito…';
    updateEntorno();
    if (MODULOS.desastre) updatePeligro();
    updateDistrito(); // el distrito se muestra siempre como referencia; la zona sísmica solo con su módulo
    if (MODULOS.seguridad) updateDelito();
    renderResumen();
    $('point-info').innerHTML = `${lat.toFixed(6)}, ${lon.toFixed(6)} · <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}" target="_blank" rel="noopener">ver en OSM</a>`;
  }

  map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng));

  // ------------------------------------------------------------ Zonificación
  const fmtNum = (n) => Math.round(n).toLocaleString('es-PE');
  const has = (v) => v !== null && v !== undefined && v !== '';
  const ZON_BADGE = {
    si: { cls: 'ok', text: 'Construible' },
    condicionado: { cls: 'warn', text: 'Requiere consulta' },
    no: { cls: 'no', text: 'No construible' },
  };

  $('zon-fuente').textContent = `Fuente: ${CONFIG.zonificacion.fuente}. Referencial: no reemplaza los certificados municipales.`;

  // V1b Zonificación proyectada: solo un aviso de texto, y únicamente si CONFIG.estadoPDM tiene fuente y fecha.
  const avisoPDM = Calculos.avisoPDMProyectado(CONFIG.estadoPDM);
  const enlaceSeguro = (u) => (/^https?:\/\//.test(u || '') ? u : null);
  if (avisoPDM) {
    const f = enlaceSeguro(avisoPDM.url) ? `<a href="${esc(avisoPDM.url)}" target="_blank" rel="noopener">${esc(avisoPDM.fuente)}</a>` : esc(avisoPDM.fuente);
    $('pdm-aviso').innerHTML = `
      <div class="pdm-aviso">
        <strong>Zonificación proyectada (PDM nuevo)</strong>
        <p>${esc(avisoPDM.texto)}</p>
        <p class="small muted">Fuente: ${f}, ${esc(avisoPDM.fecha)}. Es una nota de prensa, no un documento oficial; no hay mapa de la zonificación proyectada.</p>
      </div>`;
    $('credito-pdm').innerHTML = `${f} (${esc(avisoPDM.fecha)})`;
  }

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
    // Alerta de borde (V1a): otra zona a CONFIG.umbrales.bordeZona m o menos del punto.
    const b = z.borde;
    const nombreVecina = b && b.alerta ? ((state.reglas && state.reglas[b.codigo]) || {}).nombre : '';
    const alertaBorde = b && b.alerta
      ? `<p class="zon-msg empty alerta-borde"><strong>Punto cerca del borde de la zona.</strong> A ${fmtDist(b.distanciaM)} (en línea recta) hay otra zona: <strong>${esc(b.codigo)}</strong>${nombreVecina ? ` · ${esc(nombreVecina)}` : ''}. El plano se extrajo de un PDF y cerca de un borde el resultado puede no ser exacto: confirma la zona con el certificado municipal. Aviso a ${b.umbralM} m o menos (convención del proyecto).</p>`
      : '';

    $('zon').innerHTML = `
      ${alertaBorde}
      <div class="zon-card">
        <div class="zon-head">
          <span class="swatch" style="background:${esc(z.color)}"></span>
          <span class="zon-code">${esc(z.codigo)}</span>
          <span class="zon-name">${esc(r ? r.nombre : 'Código sin reglas en la tabla')}</span>
          <span class="badge ${badge.cls}">${badge.text}</span>
        </div>
        ${filas.length ? `<dl class="zon-data">${filas.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${filas.length ? `<p class="zon-nota small">Parámetros del Reglamento del PDM Arequipa 2016-2025, Título III${r && r.articulo ? ` (${esc(r.articulo)})` : ''}.</p>` : ''}
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
      state.reglas = Zonificacion.reglas();
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
    if (!MODULOS.sismica) { el.innerHTML = ''; return; }
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
    if (MODULOS.riesgos) renderRiesgos();
    const cards = [];

    // Zonificación (V1a vigente y V1b proyectada)
    const aviso = avisoPDM ? '<br><strong>Aviso:</strong> el nuevo PDM no está aprobado; la zonificación puede cambiar.' : '';
    if (state.zonaStatus === 'ok') {
      const r = state.zona.regla;
      const badge = ZON_BADGE[r && r.edificable];
      const borde = state.zona.borde && state.zona.borde.alerta ? `<br><strong>Cerca del borde:</strong> otra zona (${esc(state.zona.borde.codigo)}) a ${fmtDist(state.zona.borde.distanciaM)}.` : '';
      cards.push(tarjeta({ tab: 'normativo', kicker: 'Zonificación vigente', valor: esc(state.zona.codigo), detalle: `${esc(r ? r.nombre : 'Código sin reglas en la tabla')}${borde}${aviso}`, badge, wide: true }));
      setBadge('normativo', state.zona.codigo, state.zona.borde && state.zona.borde.alerta ? 'alerta' : '');
    } else if (state.zonaStatus === 'outside') {
      cards.push(tarjeta({ tab: 'normativo', kicker: 'Zonificación vigente', valor: 'Sin zona', detalle: `El punto está fuera del área zonificada del plano.${aviso}`, badge: { cls: 'warn', text: 'Fuera del plano' }, wide: true }));
      setBadge('normativo', '—');
    } else if (state.zonaStatus === 'error') {
      cards.push(tarjeta({ tab: 'normativo', kicker: 'Zonificación vigente', valor: 'No disponible', detalle: 'No se pudo consultar la zonificación.', wide: true }));
      setBadge('normativo', '');
    } else {
      cards.push(tarjeta({ tab: 'normativo', kicker: 'Zonificación vigente', valor: cargandoHtml, cargando: true, wide: true }));
      setBadge('normativo', '');
    }

    // Servicios (V2 a V5)
    const e = state.entorno;
    const kicker = (v) => `${VARIABLES[v].icono} ${VARIABLES[v].titulo}`;
    const estadoBadgeResumen = (r) => ({ cls: ESTADO_CLS[r.estado], text: r.estado });
    const valorDist = (r) => (r.distanciaM === null ? 'Sin distancia' : r.distanciaM === 0 ? 'Dentro del área' : `${fmtDist(r.distanciaM)} en línea recta`);
    const detalleDe = (r) => (r.error ? 'No se pudo obtener el dato.' : r.nombre ? `${esc(r.nombre)} · umbral ${fmtUmbral(r.umbralM)}` : `Umbral ${fmtUmbral(r.umbralM)}`);
    if (e) {
      cards.push(tarjeta({ tab: 'entorno', kicker: kicker('salud'), valor: valorDist(e.salud), detalle: detalleDe(e.salud), badge: estadoBadgeResumen(e.salud) }));
      const niveles = Equipamiento.NIVELES;
      const cumplen = niveles.filter((n) => e.educacion[n].estado === 'CUMPLE').length;
      cards.push(tarjeta({
        tab: 'entorno', kicker: kicker('educacion'), valor: `${cumplen} de ${niveles.length} niveles`,
        detalle: niveles.map((n) => `${n[0].toUpperCase()}${n.slice(1)}: ${e.educacion[n].estado.toLowerCase()}${e.educacion[n].distanciaM !== null ? ` (${fmtDist(e.educacion[n].distanciaM)})` : ''}`).join('<br>'),
        badge: { cls: cumplen === niveles.length ? 'ok' : cumplen === 0 ? 'no' : 'warn', text: cumplen === niveles.length ? 'CUMPLE' : cumplen === 0 ? 'NO CUMPLE' : 'PARCIAL' },
      }));
      cards.push(tarjeta({ tab: 'entorno', kicker: kicker('transporte'), valor: valorDist(e.transporte), detalle: detalleDe(e.transporte), badge: estadoBadgeResumen(e.transporte) }));
      cards.push(tarjeta({ tab: 'entorno', kicker: kicker('areaVerde'), valor: valorDist(e.areaVerde), detalle: detalleDe(e.areaVerde), badge: estadoBadgeResumen(e.areaVerde) }));
      const todos = [e.salud, ...niveles.map((n) => e.educacion[n]), e.transporte, e.areaVerde];
      setBadge('entorno', `${todos.filter((r) => r.estado === 'CUMPLE').length}/${todos.length}`);
    } else {
      ['salud', 'educacion', 'transporte', 'areaVerde'].forEach((v) => cards.push(tarjeta({ tab: 'entorno', kicker: kicker(v), valor: cargandoHtml, cargando: true })));
      setBadge('entorno', '');
    }

    // Módulos fuera de alcance (solo si CONFIG.modulos o ?modulos=todos los activan)
    if (MODULOS.desastre || MODULOS.sismica) {
      if (state.peligroStatus === 'ok' && MODULOS.desastre) {
        const p = state.peligro;
        const det = [`El más cercano a ${fmtDist(p.masCercano.distancia)}.`];
        if (MODULOS.sismica && state.distritoStatus === 'ok') det.push(`Zona sísmica ${esc(state.distrito.zona)} (Z = ${esc(String(state.distrito.z).replace('.', ','))}).`);
        cards.push(tarjeta({
          tab: 'desastre', kicker: 'Desastre',
          valor: `${fmtNum(p.total)} peligro${p.total === 1 ? '' : 's'} a ${p.radio} m`,
          detalle: det.join(' '),
          badge: enZonaRiesgo() ? { cls: 'no', text: `Zona de riesgo en el plano (${state.zona.codigo})` } : null,
        }));
        setBadge('desastre', enZonaRiesgo() ? '!' : String(p.total), enZonaRiesgo() ? 'alerta' : '');
      } else if (state.peligroStatus === 'error') {
        cards.push(tarjeta({ tab: 'desastre', kicker: 'Desastre', valor: 'No disponible', detalle: 'No se pudo consultar el inventario de peligros.' }));
      } else if (MODULOS.desastre) {
        cards.push(tarjeta({ tab: 'desastre', kicker: 'Desastre', valor: cargandoHtml, cargando: true }));
      } else if (state.distritoStatus === 'ok') {
        cards.push(tarjeta({ tab: 'desastre', kicker: 'Peligro sísmico', valor: `Zona ${esc(state.distrito.zona)}`, detalle: `Z = ${esc(String(state.distrito.z).replace('.', ','))} · Norma E.030 2026` }));
      }
    }

    if (MODULOS.seguridad) {
      if (state.delito) {
        const { total, ROBO, HURTO } = state.delito.conteo;
        cards.push(tarjeta({ tab: 'seguridad', kicker: 'Seguridad', valor: `${fmtNum(total)} denuncias`, detalle: `${fmtNum(ROBO)} robos · ${fmtNum(HURTO)} hurtos · ${state.delito.radio} m · ${state.delito.meta.meses} meses` }));
        setBadge('seguridad', fmtCorto(total));
      } else if (state.delitoError) {
        cards.push(tarjeta({ tab: 'seguridad', kicker: 'Seguridad', valor: 'No disponible', detalle: 'No se pudo calcular el indicador de denuncias.' }));
      } else {
        cards.push(tarjeta({ tab: 'seguridad', kicker: 'Seguridad', valor: cargandoHtml, cargando: true }));
      }
    }

    if (MODULOS.riesgos) {
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
    }

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
      timeout: 'Los servidores públicos están lentos o saturados (ya se reintentó automáticamente). Espera un momento o prueba con un radio menor.',
      rate_limit: 'Se superó el límite de uso. Espera uno o dos minutos antes de reintentar; no repitas la consulta de inmediato.',
      forbidden: service === 'Nominatim'
        ? 'Nominatim exige identificar la aplicación. Abre la página desde un servidor local (http://localhost:8000) en lugar de file:// y, si puedes, completa nominatimEmail en js/config.js.'
        : 'El servicio bloqueó la solicitud. Prueba el servidor alternativo.',
      busy: 'Todos los servidores públicos están ocupados ahora mismo (ya se reintentó automáticamente). Reintenta en unos minutos o con un radio menor.',
      runtime: 'La consulta fue demasiado pesada para el servidor público. Reduce el radio e inténtalo de nuevo.',
      parse: 'El servicio respondió algo inesperado (a veces una página de error). Reintenta más tarde.',
      http: 'Revisa el código HTTP en la pestaña Network.',
    };
    return { title: err.message, hint: hints[err.kind] || '' };
  }

  // ------------------------------------------------------------ Servicios (V2 a V5)
  const ESTADO_CLS = { CUMPLE: 'ok', 'NO CUMPLE': 'no', 'SIN DATO': 'warn' };
  const estadoBadge = (estado) => `<span class="badge ${ESTADO_CLS[estado]}">${estado}</span>`;
  const fmtArea = (m2) => `${fmtNum(m2)} m² (${(m2 / 10000).toFixed(2).replace('.', ',')} ha)`;
  const distTexto = (r) => (r.distanciaM === 0 ? 'el punto está dentro del área' : `${fmtDist(r.distanciaM)} en línea recta`);
  const NIVEL_TXT = { inicial: 'Inicial', primaria: 'Primaria', secundaria: 'Secundaria' };

  // Línea principal de un resultado: más cercano, distancia y umbral (o por qué no hay dato).
  function lineaResultado(r, textos) {
    if (r.error) return `<p class="zon-msg error"><strong>No se pudo obtener el dato.</strong> ${esc(r.error)}</p>`;
    if (r.estado === 'SIN DATO') return `<p class="var-main muted">${textos.sinDato}</p>`;
    if (r.distanciaM === null) return `<p class="var-main muted">${textos.sinDistancia} (umbral: ${fmtUmbral(r.umbralM)}).</p>`;
    return `<p class="var-main"><strong>${esc(r.nombre)}</strong> · ${distTexto(r)} <span class="muted">(umbral: ${fmtUmbral(r.umbralM)})</span></p>`;
  }
  const metodoHtml = (r) => `<details class="var-metodo"><summary>Método</summary><p>${esc(r.metodo)}</p></details>`;
  const fuenteHtml = (r) => `<p class="var-meta">Fuente: ${esc(r.fuente)}${r.fecha ? `, datos extraídos el ${esc(r.fecha)}` : ''}.</p>`;

  function tarjetaVariable(v, estado, cuerpo) {
    return `<article class="var-card">
      <header class="var-head"><span class="var-icon" style="background:${v.color}">${v.icono}</span><h3>${v.titulo}</h3>${estadoBadge(estado)}</header>
      ${cuerpo}
    </article>`;
  }

  function renderEntorno() {
    const e = state.entorno;
    const salud = tarjetaVariable(VARIABLES.salud, e.salud.estado,
      lineaResultado(e.salud, { sinDato: 'No hay establecimientos de salud en los datos de OpenStreetMap.', sinDistancia: 'No se encontró ninguno cerca' })
      + (e.salud.etiqueta ? `<p class="var-meta">Etiqueta de OSM: <code>${esc(e.salud.etiqueta)}</code></p>` : '') + fuenteHtml(e.salud) + metodoHtml(e.salud));

    const peor = Equipamiento.NIVELES.map((n) => e.educacion[n]);
    const niveles = Equipamiento.NIVELES.map((n) => {
      const r = e.educacion[n];
      return `<div class="var-nivel">
        <div class="var-nivel-head"><strong>${NIVEL_TXT[n]}</strong>${estadoBadge(r.estado)}</div>
        ${lineaResultado(r, { sinDato: `No hay colegios de nivel ${n} en los datos de OpenStreetMap.`, sinDistancia: 'No se encontró ninguno cerca' })}
        ${r.etiqueta ? `<p class="var-meta">Etiqueta de OSM: <code>${esc(r.etiqueta)}</code></p>` : ''}
        ${metodoHtml(r)}
      </div>`;
    }).join('');
    const cumplen = peor.filter((r) => r.estado === 'CUMPLE').length;
    const estadoEdu = cumplen === peor.length ? 'CUMPLE' : peor.every((r) => r.estado === 'SIN DATO') ? 'SIN DATO' : 'NO CUMPLE';
    const educacion = tarjetaVariable(VARIABLES.educacion, estadoEdu, `${niveles}
      <p class="var-meta">OSM casi no etiqueta el nivel de los colegios: uno sin nivel se toma como candidato a primaria y secundaria; los jardines cuentan como inicial.</p>
      ${fuenteHtml(e.educacion.inicial)}`);

    const transporte = tarjetaVariable(VARIABLES.transporte, e.transporte.estado,
      lineaResultado(e.transporte, { sinDato: 'No hay paraderos en los datos de OpenStreetMap.', sinDistancia: 'No se encontró ninguno cerca' })
      + (e.transporte.etiqueta ? `<p class="var-meta">Etiqueta de OSM: <code>${esc(e.transporte.etiqueta)}</code></p>` : '') + fuenteHtml(e.transporte) + metodoHtml(e.transporte));

    const v = e.areaVerde;
    const u = CONFIG.umbrales.areaVerde;
    const sens = v.error || v.estado === 'SIN DATO' ? '' : `<p class="var-meta">Superficie: ${v.areaM2 ? fmtArea(v.areaM2) : '—'}. Con el criterio más estricto (al menos ${fmtNum(u.areaGrandeM2)} m², 1 ha): ${v.cumple1ha ? `también hay una a ${fmtDist(v.distancia1haM)} (${esc(v.nombre1ha)})` : `no hay ninguna a ${u.distanciaM} m o menos`}.</p>`;
    const areaVerde = tarjetaVariable(VARIABLES.areaVerde, v.estado,
      lineaResultado(v, { sinDato: 'No hay áreas verdes en los datos de OpenStreetMap.', sinDistancia: `Ninguna área verde de los datos mide al menos ${fmtNum(u.areaMinM2)} m²` })
      + `<p class="var-meta">Criterio: un área verde de al menos ${fmtNum(u.areaMinM2)} m² a ${u.distanciaM} m o menos.</p>` + sens + fuenteHtml(v) + metodoHtml(v));

    $('entorno').innerHTML = salud + educacion + transporte + areaVerde;
    $('entorno-fuente').textContent = 'Distancias en línea recta, no recorrido a pie. OpenStreetMap es colaborativo: algo ausente puede existir. Los umbrales de salud, transporte y borde de zona son convenciones del proyecto.';
  }

  // Marcadores y línea recta hacia lo más cercano de cada variable (el área verde se dibuja como polígono).
  function limpiarEntornoMapa() {
    if (state.entornoLayer) { map.removeLayer(state.entornoLayer); state.entornoLayer = null; }
  }

  function dibujarEntorno() {
    limpiarEntornoMapa();
    const e = state.entorno;
    const { lat, lon } = state.point;
    const grupo = L.layerGroup();
    const filas = [
      { v: VARIABLES.salud, r: e.salud, rotulo: 'Salud' },
      ...Equipamiento.NIVELES.map((n) => ({ v: VARIABLES.educacion, r: e.educacion[n], rotulo: `Educación ${n}` })),
      { v: VARIABLES.transporte, r: e.transporte, rotulo: 'Transporte' },
      { v: VARIABLES.areaVerde, r: e.areaVerde, rotulo: 'Área verde' },
    ].filter((f) => f.r.lat !== null && f.r.lat !== undefined);
    // Un mismo colegio puede ser el más cercano de varios niveles: un solo marcador con todos los rótulos.
    const porElemento = new Map();
    filas.forEach((f) => {
      const k = f.r.osm || `${f.r.lat},${f.r.lon}`;
      if (!porElemento.has(k)) porElemento.set(k, { ...f, rotulos: [] });
      porElemento.get(k).rotulos.push(`${f.rotulo}: ${f.r.estado.toLowerCase()}`);
    });
    porElemento.forEach(({ v, r, rotulos }) => {
      if (r.forma) L.geoJSON({ type: 'Feature', geometry: r.forma }, { style: { color: v.color, weight: 2, fillOpacity: 0.18 }, interactive: false }).addTo(grupo);
      else L.polyline([[lat, lon], [r.lat, r.lon]], { color: v.color, weight: 2, dashArray: '4 6', interactive: false }).addTo(grupo);
      const enlace = r.osm ? `<br><small><a href="https://www.openstreetmap.org/${esc(r.osm)}" target="_blank" rel="noopener">${esc(r.osm)} en openstreetmap.org</a></small>` : '';
      L.marker([r.lat, r.lon], { icon: poiIcon(v), title: r.nombre || v.titulo })
        .bindPopup(`<strong>${esc(r.nombre)}</strong><br>${rotulos.map(esc).join('<br>')}<br>${distTexto(r)}${enlace}`)
        .addTo(grupo);
    });
    state.entornoLayer = grupo.addTo(map);
  }

  async function updateEntorno() {
    const seq = ++state.entornoSeq;
    const { lat, lon } = state.point;
    state.entorno = null;
    state.entornoStatus = 'loading';
    limpiarEntornoMapa();
    $('entorno').innerHTML = '<p class="zon-msg loading"><span class="spinner"></span>Buscando los servicios más cercanos…</p>';
    const e = await Equipamiento.evaluar(lat, lon); // nunca rechaza: cada variable devuelve SIN DATO con su causa si falla
    if (seq !== state.entornoSeq) return; // el usuario ya eligió otro punto
    state.entorno = e;
    state.entornoStatus = 'ok';
    renderEntorno();
    dibujarEntorno();
    renderResumen();
  }

  // --------------------------------------------------------- Ficha en PDF
  // Reúne lo que ya se calculó y lo pasa a reporte.js (no calcula nada nuevo).
  function datosReporte() {
    const zonaOk = state.zonaStatus === 'ok';
    const r = zonaOk ? state.zona.regla : null;
    const lote = Number($('lote').value);
    const d = state.distritoStatus === 'ok' ? state.distrito : null;
    const resumen = [];
    resumen.push(['Zonificación vigente', zonaOk ? `${state.zona.codigo} · ${r ? r.nombre : ''}${ZON_BADGE[r && r.edificable] ? ` — ${ZON_BADGE[r.edificable].text.toLowerCase()}` : ''}${state.zona.borde && state.zona.borde.alerta ? `; cerca del borde: otra zona (${state.zona.borde.codigo}) a ${fmtDist(state.zona.borde.distanciaM)}` : ''}` : state.zonaStatus === 'outside' ? 'Fuera del área zonificada' : 'No disponible']);
    if (avisoPDM) resumen.push(['Zonificación proyectada', `${avisoPDM.texto} (${avisoPDM.fuente}, ${avisoPDM.fecha})`]);
    const e = state.entorno;
    const linea = (x) => (x ? `${x.estado}${x.distanciaM !== null ? ` · ${fmtDist(x.distanciaM)}` : ''}${x.nombre ? ` · ${x.nombre}` : ''}` : 'No disponible');
    if (e) {
      resumen.push(['Salud', linea(e.salud)]);
      Equipamiento.NIVELES.forEach((n) => resumen.push([`Educación ${n}`, linea(e.educacion[n])]));
      resumen.push(['Transporte', linea(e.transporte)]);
      resumen.push(['Área verde', linea(e.areaVerde)]);
    }
    const modulos = {};
    if (MODULOS.desastre || MODULOS.sismica) {
      modulos.desastre = {
        zonaRiesgo: enZonaRiesgo(),
        peligro: MODULOS.desastre && state.peligroStatus === 'ok' ? state.peligro : null,
        distrito: MODULOS.sismica ? d : null,
        mostrarPeligro: MODULOS.desastre,
        mostrarSismica: MODULOS.sismica,
      };
      resumen.push(['Desastre', `${MODULOS.desastre ? (state.peligro ? `${fmtNum(state.peligro.total)} peligros geológicos registrados a ${state.peligro.radio} m` : 'Peligros no disponibles') : ''}${MODULOS.sismica && d ? `${MODULOS.desastre ? '; ' : ''}zona sísmica ${d.zona} (Z = ${String(d.z).replace('.', ',')})` : ''}${MODULOS.desastre && enZonaRiesgo() ? '; zona de riesgo muy alto en el plano' : ''}`]);
    }
    if (MODULOS.seguridad) {
      modulos.seguridad = { delito: state.delito, periodo: state.delito ? `${fmtFecha(state.delito.meta.ventanaDesde)} – ${fmtFecha(state.delito.meta.hasta)}` : '' };
      resumen.push(['Seguridad', state.delito ? `${fmtNum(state.delito.conteo.total)} denuncias de robo y hurto a ${state.delito.radio} m en ${state.delito.meta.meses} meses` : 'No disponible']);
    }
    if (MODULOS.riesgos) {
      modulos.riesgos = { riesgos: state.riesgos || [], evaluacion: state.evaluacion, nivel: Riesgos.nivel, escala: Riesgos.ESCALA, decisiones: Riesgos.DECISIONES };
      resumen.push(['Registro de riesgos', `${(state.riesgos || []).length} riesgos identificados`]);
    }
    return {
      fecha: new Date().toLocaleString('es-PE', { dateStyle: 'long', timeStyle: 'short' }),
      punto: state.point,
      distritoTitulo: d ? `Distrito de ${capitalizar(d.distrito)}` : 'Arequipa',
      distritoNombre: d ? capitalizar(d.distrito) : '',
      resumen,
      zonaStatus: state.zonaStatus,
      zona: zonaOk ? state.zona : null,
      badgeZona: zonaOk && ZON_BADGE[r && r.edificable] ? ZON_BADGE[r.edificable].text : null,
      lote: lote > 0 ? lote : null,
      potencial: zonaOk && lote > 0 ? Zonificacion.potencial(r, lote) : null,
      avisoPDM,
      variables: e,
      umbrales: CONFIG.umbrales,
      fuentesUmbral: CONFIG.fuentesUmbral,
      modulos,
      fuentes: { zonificacion: CONFIG.zonificacion.fuente, peligros: CONFIG.peligros.fuente, distritos: CONFIG.distritos.fuente, delitos: CONFIG.delitos.fuente },
    };
  }

  $('download').addEventListener('click', () => {
    if (!state.point) return;
    renderResumen();
    Reporte.imprimir($('reporte'), datosReporte());
  });

  // --------------------------------------------------------- Datos crudos (JSON, para verificación)
  $('download-json').addEventListener('click', () => {
    if (!state.point) return;
    const out = {
      generado: new Date().toISOString(),
      punto: { lat: state.point.lat, lon: state.point.lon },
      zonificacion_vigente: state.zona
        ? { codigo: state.zona.codigo, regla: state.zona.regla, borde: state.zona.borde, fuente: CONFIG.zonificacion.fuente }
        : null,
      zonificacion_proyectada: avisoPDM,
      salud: state.entorno && state.entorno.salud,
      educacion: state.entorno && state.entorno.educacion,
      transporte: state.entorno && state.entorno.transporte,
      area_verde: state.entorno && state.entorno.areaVerde && { ...state.entorno.areaVerde, forma: undefined },
      umbrales: CONFIG.umbrales,
      fuentes_umbral: CONFIG.fuentesUmbral,
    };
    if (MODULOS.sismica) {
      out.zona_sismica = state.distritoStatus === 'ok'
        ? { distrito: state.distrito.distrito, ubigeo: state.distrito.ubigeo, zona: state.distrito.zona, z: state.distrito.z, fuente: CONFIG.distritos.fuente }
        : null;
    }
    if (MODULOS.riesgos) {
      out.registro_riesgos = (state.riesgos || []).map((r) => {
        const e = state.evaluacion[r.id] || {};
        const n = Riesgos.nivel(e.p, e.i);
        return {
          id: r.id, categoria: r.categoria, riesgo: r.titulo, evidencia: r.evidencia, fuente: r.fuente,
          probabilidad: e.p ?? null, impacto: e.i ?? null, nivel: n ? n.texto : null,
          decision: e.decision != null ? Riesgos.DECISIONES[e.decision] : null,
          acciones: r.acciones.map((ac, k) => ({ accion: ac.texto, fuente: ac.fuente, hecha: (e.hechas || []).includes(k) })),
        };
      });
    }
    if (MODULOS.desastre) {
      out.peligros_geologicos = state.peligro
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
        : null;
    }
    if (MODULOS.seguridad) {
      out.denuncias = state.delito
        ? {
          radio_m: state.delito.radio,
          desde: state.delito.meta.ventanaDesde,
          hasta: state.delito.meta.hasta,
          robo: state.delito.conteo.ROBO,
          hurto: state.delito.conteo.HURTO,
          total: state.delito.conteo.total,
          fuente: CONFIG.delitos.fuente,
        }
        : null;
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ficha-predio_${state.point.lat.toFixed(5)}_${state.point.lon.toFixed(5)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Ayuda para verificar desde la consola del navegador (F12)
  window.osmDebug = { map, state, MODULOS, Calculos, Services, Zonificacion, Equipamiento, Peligros, Distritos, Riesgos, Delitos };
})();
