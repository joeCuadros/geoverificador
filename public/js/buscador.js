(() => {
  'use strict';

  const LOGIC = window.BuscadorLogica;
  const STORE_KEY = 'geoverificador.preferencias-vivienda.v1';
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const formatScore = (value) => new Intl.NumberFormat('es-PE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));

  let preferences = LOGIC.normalizePreferences({});
  let savedPreferences = false;
  let latestResults = null;
  let requestSequence = 0;
  let chat;
  let selectedZone = '';

  function setStorageMessage(message, isError = false) {
    const status = $('chat-storage-status');
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function loadPreferences() {
    let saved;
    try {
      saved = window.localStorage.getItem(STORE_KEY);
    } catch {
      setStorageMessage('No se pudieron leer las preferencias guardadas. Puedes continuar y volver a intentarlo.', true);
      return;
    }
    if (saved === null) return;
    let parsed;
    try {
      parsed = JSON.parse(saved);
    } catch {
      return;
    }
    if (!LOGIC.isInterpretablePreferences(parsed)) return;
    preferences = LOGIC.normalizePreferences(parsed);
    savedPreferences = preferences.selectedCriteria.length > 0 || preferences.includeConditional;
  }

  function savePreferences(value) {
    preferences = LOGIC.normalizePreferences(value);
    const hasPreferences = preferences.selectedCriteria.length > 0 || preferences.includeConditional;
    if (!hasPreferences) {
      try {
        window.localStorage.removeItem(STORE_KEY);
        savedPreferences = false;
        setStorageMessage('');
      } catch {
        setStorageMessage('No se pudieron borrar las preferencias vacías de este navegador.', true);
      }
      return;
    }
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({
        estrellas: preferences.stars,
        criteriosSeleccionados: preferences.selectedCriteria,
        nivelesEscolares: preferences.schoolLevels,
        necesitaColegios: preferences.needsSchools,
        incluirCondicional: preferences.includeConditional,
      }));
      savedPreferences = true;
      setStorageMessage('Preferencias guardadas solo en este navegador.');
    } catch {
      setStorageMessage('No se pudieron guardar las preferencias en este navegador; podrás buscar de todos modos.', true);
    }
  }

  function clearPreferences() {
    preferences = LOGIC.normalizePreferences({});
    savedPreferences = false;
    let message = 'Se borraron las preferencias guardadas.';
    let isError = false;
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      message = 'Se restablecieron para esta sesión, pero el navegador no permitió borrar el almacenamiento.';
      isError = true;
    }
    chat.setPreferences(preferences);
    chat.showChecklist();
    showChat();
    setStorageMessage(message, isError);
  }

  function showChat() {
    $('chat-vivienda').hidden = false;
    $('resultados-vivienda').hidden = true;
    $('chat-vivienda').focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('geoverificador:modo', { detail: { active: true, results: false } }));
  }

  function showResults() {
    $('chat-vivienda').hidden = true;
    $('resultados-vivienda').hidden = false;
    $('resultados-titulo').focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('geoverificador:modo', { detail: { active: true, results: true } }));
  }

  function leaveMode() {
    requestSequence += 1;
    $('vivienda-panel').hidden = true;
    $('contenido').hidden = false;
    document.dispatchEvent(new CustomEvent('geoverificador:modo', { detail: { active: false } }));
    window.GeoVerificadorMapa?.clearZones();
    window.setTimeout(() => $('buscar-vivienda').focus({ preventScroll: true }), 0);
  }

  function explorePoint() {
    leaveMode();
    window.GeoVerificadorMapa?.preparePointExploration();
  }

  function openPointFromResults(event) {
    if ($('resultados-vivienda').hidden) return;
    const { lat, lng } = event.detail || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    leaveMode();
    window.GeoVerificadorMapa?.choosePoint(lat, lng);
  }

  function renderLegend(container) {
    container.innerHTML = LOGIC.BANDS.map((band, index) => `
      <span class="leyenda-puntaje band-${band.id}">
        <span class="leyenda-muestra" aria-hidden="true">${['B', 'M', 'A'][index]}</span>
        <span><strong>${band.label}</strong><small>${band.range} puntos</small></span>
      </span>`).join('');
  }

  function renderMapLegend() {
    renderLegend($('leyenda-mapa-zonas'));
    $('leyenda-mapa-zonas').hidden = false;
    renderLegend($('resultados-leyenda'));
    $('resultados-leyenda').hidden = false;
  }

  function displayBreakdown(values) {
    if (!values || typeof values !== 'object') return '';
    const entries = Object.entries(values).filter(([criterion, value]) =>
      Object.hasOwn(LOGIC.LABELS, criterion) && Number.isFinite(Number(value)));
    if (entries.length === 0) return '<p class="zone-desglose">Sin desglose disponible.</p>';
    return `<ul class="zone-desglose">${entries.map(([criterion, value]) =>
      `<li>${escapeHtml(LOGIC.LABELS[criterion])}<span>${formatScore(value)}/100</span></li>`).join('')}</ul>`;
  }

  function renderZones(featureCollection) {
    const list = $('lista-zonas');
    list.innerHTML = featureCollection.features.map((feature, index) => {
      const properties = feature.properties || {};
      const name = String(properties.nombre || `Zona ${index + 1}`);
      const score = Number(properties.puntajePromedio);
      const band = LOGIC.bandForScore(score);
      const districts = Array.isArray(properties.distritos) && properties.distritos.length
        ? properties.distritos.map(escapeHtml).join(', ')
        : 'Distrito no disponible';
      const cells = Number.isFinite(Number(properties.cantidadCeldas)) ? Number(properties.cantidadCeldas) : 0;
      const conditional = properties.incluyeConstruccionCondicional
        ? '<span class="zone-conditional">Incluye construcción condicional</span>'
        : '';
      return `<li class="zona-resultado band-${band.id}">
        <button type="button" class="zona-seleccion" data-zone="${escapeHtml(name)}"
          aria-pressed="${name === selectedZone}" aria-label="Ver ${escapeHtml(name)}, puntaje ${formatScore(score)} de 100">
          <span class="zona-numero">${index + 1}</span>
          <span class="zona-cabecera"><strong>${escapeHtml(name)}</strong><span class="zona-score">${formatScore(score)}/100 · ${band.label}</span></span>
          <span class="zona-meta"><span><strong>Distritos:</strong> ${districts}</span>
            <span><strong>Área:</strong> ${escapeHtml(LOGIC.formatArea(properties.areaAproximadaM2))} · ${cells} celdas</span>${conditional}</span>
          ${displayBreakdown(properties.desglosePromedioPorCriterio)}
        </button>
      </li>`;
    }).join('');
    list.querySelectorAll('[data-zone]').forEach((button) => {
      button.addEventListener('click', () => selectZone(button.dataset.zone));
    });
  }

  function selectZone(name) {
    selectedZone = name;
    $('lista-zonas').querySelectorAll('[data-zone]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.zone === name));
    });
    window.GeoVerificadorMapa?.selectZone(name);
  }

  function showLoading() {
    $('resultados-estado').innerHTML = '<span class="spinner" aria-hidden="true"></span>Buscando zonas que coincidan con tus prioridades…';
    $('resultados-estado').setAttribute('aria-busy', 'true');
    $('lista-zonas').replaceChildren();
    $('resultados-leyenda').hidden = true;
    $('repetir-busqueda').hidden = true;
    $('cambiar-preferencias').disabled = true;
    $('resultados-estado').classList.remove('error', 'sin-resultados');
    window.GeoVerificadorMapa?.clearZones();
  }

  function showError(message) {
    $('resultados-estado').textContent = message;
    $('resultados-estado').setAttribute('aria-busy', 'false');
    $('resultados-estado').classList.add('error');
    $('repetir-busqueda').hidden = false;
    $('cambiar-preferencias').disabled = false;
  }

  async function searchZones(value = preferences) {
    preferences = LOGIC.normalizePreferences(value);
    savePreferences(preferences);
    const requestId = ++requestSequence;
    latestResults = null;
    selectedZone = '';
    showResults();
    showLoading();
    try {
      const response = await fetch('/api/v1/zonas/buscar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(LOGIC.buildRequest(preferences)),
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error('El servidor respondió con un formato que no pudimos leer.');
      }
      if (requestId !== requestSequence) return;
      if (!payload || typeof payload !== 'object') {
        throw new Error('El servidor devolvió resultados incompletos. Inténtalo más tarde.');
      }
      if (!response.ok) {
        const detail = typeof payload.message === 'string' ? payload.message : '';
        throw new Error(detail || `El servidor no pudo completar la búsqueda (error ${response.status}).`);
      }
      if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
        throw new Error('El servidor devolvió resultados incompletos. Inténtalo más tarde.');
      }
      latestResults = payload;
      $('resultados-estado').setAttribute('aria-busy', 'false');
      $('cambiar-preferencias').disabled = false;
      $('repetir-busqueda').hidden = false;
      if (payload.features.length === 0) {
        $('resultados-estado').textContent = 'No encontramos zonas con estas condiciones. Prueba asignar más estrellas a otros criterios o incluir zonas de construcción condicional.';
        $('resultados-estado').classList.add('sin-resultados');
        return;
      }
      $('resultados-estado').textContent = `${payload.features.length} zonas encontradas, ordenadas por puntaje.`;
      selectedZone = String(payload.features[0].properties?.nombre || '');
      renderZones(payload);
      renderMapLegend();
      window.GeoVerificadorMapa.showZones(payload);
      if (selectedZone) selectZone(selectedZone);
    } catch (error) {
      if (requestId !== requestSequence) return;
      const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
      showError(message.includes('Failed to fetch') || message.includes('NetworkError')
        ? 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'
        : `No pudimos buscar zonas: ${message}`);
    }
  }

  function openMode() {
    $('contenido').hidden = true;
    $('vivienda-panel').hidden = false;
    document.dispatchEvent(new CustomEvent('geoverificador:modo', { detail: { active: true, results: Boolean(latestResults) } }));
    if (latestResults) {
      showResults();
      if (latestResults.features.length > 0) {
        renderMapLegend();
        window.GeoVerificadorMapa.showZones(latestResults);
        if (selectedZone) selectZone(selectedZone);
      }
    } else chat.showChecklist();
    requestAnimationFrame(() => $('vivienda-titulo').focus({ preventScroll: true }));
  }

  loadPreferences();
  chat = window.GeoChatBuscador.createChat({
    root: $('chat-vivienda'),
    preferences,
    onChange: savePreferences,
    onSearch: searchZones,
    onClear: clearPreferences,
  });
  chat.setPreferences(preferences);
  if (savedPreferences) savePreferences(preferences);

  $('buscar-vivienda').addEventListener('click', openMode);
  $('explorar-punto').addEventListener('click', explorePoint);
  $('cambiar-preferencias').addEventListener('click', () => {
    showChat();
    chat.showSummary();
  });
  $('repetir-busqueda').addEventListener('click', () => searchZones(preferences));
  $('borrar-preferencias').addEventListener('click', clearPreferences);
  window.addEventListener('geoverificador:zona-seleccionada', (event) => {
    const name = event.detail?.name;
    if (typeof name === 'string') selectZone(name);
  });
  window.addEventListener('geoverificador:mapa-vivienda-click', openPointFromResults);

  $('contenido').hidden = true;
  $('vivienda-panel').hidden = false;
  document.dispatchEvent(new CustomEvent('geoverificador:modo', { detail: { active: true, results: false } }));
  requestAnimationFrame(() => $('vivienda-titulo').focus({ preventScroll: true }));
})();
