/**
 * app.js — Interfaz: mapa Leaflet, selección de punto y ficha de las 5 variables.
 * Al elegir el punto, todo se resuelve con archivos locales de public/data: zonificación vigente (V1a), aviso del PDM
 * proyectado (V1b, texto de CONFIG.estadoPDM) y equipamiento de OpenStreetMap congelado (V2 a V5: salud, educación
 * por nivel, transporte y área verde; ver equipamiento.js). Solo la búsqueda de direcciones (Nominatim) consulta un
 * servicio externo, al pulsar «Buscar»; Overpass en vivo se usa únicamente si falta un archivo de equipamiento.
 * Los módulos fuera de alcance (peligros, zona sísmica, denuncias y registro de riesgos) siguen en el código pero se
 * ocultan con CONFIG.modulos; `?modulos=todos` en la URL los vuelve a mostrar.
 *
 * El recorrido de la visita es Inicio, guía breve y chat (recorrido.js, espacio-ui.js, tour.js, tour-ui.js). El chat es lo
 * principal (asistente-ui.js) y el mapa dibuja las entidades reales de lo que se pide: colegios, parques, zonas, quebradas, sismos y los sectores encontrados (capas.js, capas-ui.js).
 * La consulta de un punto es secundaria y vive en el panel «Buscar por punto», oculto por defecto; sigue 3 pasos (ver
 * onboarding.js): 1 ubicar el predio, 2 confirmar el punto y 3 leer el reporte. Cada servicio es una tarjeta desplegable;
 * «Comparar puntos» (comparar.js, comparar-ui.js) y las verificaciones antes de comprar (verificaciones.js) completan la
 * ayuda a decidir.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDist = (d) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(2).replace('.', ',')} km`);

  const fmtUmbral = (m) => `${Math.round(m)} m`; // los umbrales se dicen siempre en metros

  // Módulos visibles: CONFIG.modulos, o todos con ?modulos=todos (ver Calculos.modulosEfectivos).
  const MODULOS = Calculos.modulosEfectivos(CONFIG.modulos, window.location.search);

  const almacen = () => { try { return window.localStorage; } catch (err) { return null; } };

  const state = {
    flujo: { ...Onboarding.ESTADO_INICIAL }, // paso actual (Onboarding.transicion)
    etiqueta: '',        // nombre del lugar si vino de una búsqueda (si no, «Punto elegido en el mapa»)
    moverMetros: 10,     // salto de los botones para mover el punto
    distritoTexto: '',   // «Distrito de …» del punto actual
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
    umbrales: Umbrales.leer(almacen()), // «Mis umbrales»: lo que fija la persona (hoy, distancia mínima a una quebrada)
    cauce: null,         // resultado de Contexto.quebradas para el punto actual (INFORMATIVO, o según el umbral de la persona)
    contextoRiesgo: null, // { peligros, sismos } de Contexto: contexto informativo, no una evaluación
    contextoSeq: 0,      // descarta respuestas de un punto anterior
  };

  // ------------------------------------------------------------------ Mapa
  const map = L.map('map').setView(CONFIG.center, CONFIG.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
  // El contenedor cambia de tamaño al pasar de un paso a otro (la hoja inferior crece o se achica): Leaflet debe enterarse.
  if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));

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

  // Tarjeta de capas plegable (plegada de inicio en pantallas angostas).
  function setLayersOpen(open) {
    $('layers-toggle').setAttribute('aria-expanded', String(open));
    $('layers-body').hidden = !open;
  }
  $('layers-toggle').addEventListener('click', () => setLayersOpen($('layers-body').hidden));
  if (window.matchMedia('(max-width: 1199px)').matches) setLayersOpen(false);

  $('probar').addEventListener('click', () => {
    colocarPunto(CONFIG.center[0], CONFIG.center[1], { etiqueta: 'Plaza de Armas de Arequipa', vista: 17 });
  });

  // Botones «Ver en el mapa» de cada tarjeta: activan la misma casilla de la tarjeta de capas y se sincronizan con ella.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-capa]');
    if (b) $(b.dataset.capa).click();
  });
  ['zon-layer', 'pel-layer', 'del-layer'].forEach((id) => {
    $(id).addEventListener('change', () => {
      document.querySelectorAll(`[data-capa="${id}"]`).forEach((b) => b.setAttribute('aria-pressed', String($(id).checked)));
    });
  });

  // Resultados del buscador: aparecen debajo del formulario, dentro de la hoja.
  const showSearchPop = (show) => { $('search-pop').hidden = !show; };

  // ------------------------------------------------------------- Utilidades UI
  const icono = (id, extra = '') => `<svg class="ico${extra ? ` ${extra}` : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const VARIABLES = {
    salud: { titulo: 'Salud', icono: 'salud' },
    educacion: { titulo: 'Colegio', icono: 'colegio' },
    transporte: { titulo: 'Paradero', icono: 'paradero' },
    areaVerde: { titulo: 'Área verde', icono: 'verde' },
    quebradas: { titulo: 'Quebradas y cauces', icono: 'quebrada' },
    peligros: { titulo: 'Peligros geológicos registrados', icono: 'aviso' },
    sismos: { titulo: 'Sismos recientes (IGP)', icono: 'sismo' },
  };
  const colorMapa = (nombre) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || '#1c3a6b';
  const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anunciar = (texto) => { $('anuncios').textContent = ''; setTimeout(() => { $('anuncios').textContent = texto; }, 60); };
  // Nominatim devuelve la dirección completa (hasta el país); para el reporte basta lo primero.
  const etiquetaCorta = (nombre) => String(nombre).split(',').map((p) => p.trim()).filter(Boolean).slice(0, 3).join(', ');

  function poiIcon(v) {
    return L.divIcon({
      className: `poi-icon${v.icono === 'verde' ? ' verde' : ''}`,
      html: `<span>${icono(v.icono)}</span>`,
      iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16],
    });
  }

  // El marcador del punto: una chincheta de tinta con un centro claro.
  const puntoIcon = L.divIcon({
    className: 'punto-icon',
    html: '<svg viewBox="0 0 38 48" aria-hidden="true"><path class="pp-cuerpo" d="M19 46S3 29.5 3 18a16 16 0 0 1 32 0c0 11.5-16 28-16 28z"/><circle class="pp-centro" cx="19" cy="18" r="6"/></svg>',
    iconSize: [38, 48], iconAnchor: [19, 46],
  });

  // ------------------------------------------------------------ Pasos
  const PASO_TITULO = { ubicar: 'ubicar-h', confirmar: 'confirmar-h', reporte: 'dir-h' };

  function aplicarFlujo(nuevo, { foco = true } = {}) {
    const cambio = nuevo.paso !== state.flujo.paso;
    state.flujo = nuevo;
    $('app').dataset.paso = nuevo.paso;
    $('paso-ubicar').hidden = nuevo.paso !== 'ubicar';
    $('paso-confirmar').hidden = nuevo.paso !== 'confirmar';
    $('resultado').hidden = nuevo.paso !== 'reporte';
    $('mover-panel').hidden = !nuevo.moviendo;
    $('btn-mover').setAttribute('aria-expanded', String(nuevo.moviendo));
    // Solo se arrastra el marcador mientras se confirma el punto.
    if (state.pointMarker) {
      if (nuevo.paso === 'confirmar') state.pointMarker.dragging.enable(); else state.pointMarker.dragging.disable();
    }
    if (!cambio) return;
    if (nuevo.paso === 'reporte') $('consejo').hidden = Onboarding.consejoVisto(almacen());
    $('contenido').scrollTop = 0;
    window.scrollTo(0, 0);
    if (foco) $(PASO_TITULO[nuevo.paso]).focus({ preventScroll: true });
    // El mapa cambia de tamaño con el paso: se recoloca sobre el punto.
    requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      if (state.point && nuevo.paso !== 'reporte' && !map.getBounds().pad(-0.2).contains([state.point.lat, state.point.lon])) {
        map.panTo([state.point.lat, state.point.lon], { animate: !sinMovimiento() });
      }
    });
  }

  // ------------------------------------------------------------ Punto
  // Círculo de 500 m: solo lo usan los módulos de peligros y denuncias, así que solo se dibuja si alguno está visible.
  function drawCircle() {
    if (state.ring) { map.removeLayer(state.ring); state.ring = null; }
    if (!state.point || !(MODULOS.desastre || MODULOS.seguridad)) return;
    const c = colorMapa('--tinta');
    state.ring = L.circle([state.point.lat, state.point.lon], {
      radius: CONFIG.peligros.radio, color: c, weight: 2, fillColor: c, fillOpacity: 0.06, interactive: false,
    }).addTo(map);
  }

  const MOVER_DIR = { ArrowUp: 'N', ArrowDown: 'S', ArrowRight: 'E', ArrowLeft: 'O' };
  const DIR_TEXTO = { N: 'al norte', S: 'al sur', E: 'al este', O: 'al oeste' };

  function crearMarcador(lat, lon) {
    const m = L.marker([lat, lon], { icon: puntoIcon, draggable: true, keyboard: true, title: 'Punto elegido', zIndexOffset: 1000 }).addTo(map);
    m.on('dragend', () => {
      const p = m.getLatLng();
      colocarPunto(p.lat, p.lng);
    });
    const el = m.getElement();
    if (el) {
      el.setAttribute('aria-label', 'Punto elegido. Con las flechas del teclado lo mueves.');
      // Alternativa al arrastre: las flechas del teclado mueven el punto (y no desplazan el mapa).
      el.addEventListener('keydown', (e) => {
        const dir = MOVER_DIR[e.key];
        if (!dir || state.flujo.paso !== 'confirmar') return;
        e.preventDefault();
        e.stopPropagation();
        moverPunto(dir);
      });
    }
    return m;
  }

  function refrescarTextoPunto() {
    if (!state.point) return;
    const { lat, lon } = state.point;
    const coord = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    const lugar = state.etiqueta || 'Punto elegido en el mapa';
    $('confirmar-lugar').textContent = lugar;
    $('confirmar-detalle').textContent = `${state.distritoTexto ? `${state.distritoTexto} · ` : ''}${coord}`;
    $('dir-h').textContent = lugar;
    $('point-distrito').textContent = state.distritoTexto;
    $('point-info').innerHTML = `${coord} · <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}" target="_blank" rel="noopener">ver en OpenStreetMap</a>`;
  }

  // Elige o mueve el punto (paso 1 o 2). En el reporte el mapa no cambia el punto: eso se hace con «Cambiar».
  function colocarPunto(lat, lon, { etiqueta = null, vista = null, aviso = '', conservarMover = false } = {}) {
    if (state.flujo.paso === 'reporte') return;
    EspacioUI.abrirPunto({ foco: false }); // elegir un punto abre «Buscar por punto» (si ya estaba abierto, no hace nada)
    state.point = { lat, lon };
    if (etiqueta !== null) {
      state.etiqueta = etiqueta;
      state.etiquetaOrigen = { lat, lon };
    } else if (!state.etiquetaOrigen || Calculos.haversine(lat, lon, state.etiquetaOrigen.lat, state.etiquetaOrigen.lon) > 100) {
      // Si el punto se aleja de la dirección buscada, ya no se le puede llamar así.
      state.etiqueta = '';
      state.etiquetaOrigen = null;
    }
    if (etiqueta !== null || state.flujo.paso !== 'confirmar') $('confirmar-aviso').textContent = aviso;
    if (!state.pointMarker) state.pointMarker = crearMarcador(lat, lon); else state.pointMarker.setLatLng([lat, lon]);
    drawCircle();
    $('map-hint').classList.add('oculto');
    state.distritoTexto = '';
    refrescarTextoPunto();
    updateDistrito(); // archivo local: se muestra ya en el paso 2
    let nuevoFlujo = Onboarding.transicion(state.flujo, 'elegir-punto');
    // Con los botones de flecha el panel de movimiento sigue abierto para poder dar varios pasos seguidos.
    if (conservarMover && state.flujo.moviendo) nuevoFlujo = { ...nuevoFlujo, moviendo: true };
    if (vista) map.setView([lat, lon], vista, { animate: !sinMovimiento() });
    aplicarFlujo(nuevoFlujo);
  }

  function moverPunto(dir) {
    if (!state.point || state.flujo.paso !== 'confirmar') return;
    const q = Onboarding.desplazar(state.point, dir, state.moverMetros);
    colocarPunto(q.lat, q.lon, { conservarMover: true });
    if (!map.getBounds().pad(-0.15).contains([q.lat, q.lon])) map.panTo([q.lat, q.lon], { animate: !sinMovimiento() });
    $('mover-estado').textContent = `Punto movido ${state.moverMetros} m ${DIR_TEXTO[dir]}. Coordenadas ${q.lat.toFixed(6)}, ${q.lon.toFixed(6)}.`;
  }

  function fijarSalto(metros) {
    state.moverMetros = metros;
    document.querySelectorAll('.paso-mov [data-metros]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.metros) === metros)));
    $('pad-centro').textContent = `${metros} m`;
    document.querySelectorAll('.pad-btn').forEach((b) => b.setAttribute('aria-label', `Mover el punto ${metros} m ${DIR_TEXTO[b.dataset.dir]}`));
  }
  fijarSalto(10);
  document.querySelector('.paso-mov').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metros]');
    if (b) fijarSalto(Number(b.dataset.metros));
  });
  document.querySelector('.pad').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]');
    if (b) moverPunto(b.dataset.dir);
  });
  $('btn-mover').addEventListener('click', () => aplicarFlujo(Onboarding.transicion(state.flujo, 'mover'), { foco: false }));

  // Tocar el mapa abre el panel «Buscar por punto». Con el reporte abierto el punto no cambia: se cambia con «Cambiar».
  map.on('click', (e) => {
    if (state.flujo.paso === 'reporte') { EspacioUI.abrirPunto(); return; }
    colocarPunto(e.latlng.lat, e.latlng.lng);
  });

  // «Sí, verificar»: pasa al reporte y lanza todas las consultas locales.
  $('btn-verificar').addEventListener('click', () => {
    const nuevo = Onboarding.transicion(state.flujo, 'confirmar');
    if (nuevo.paso !== 'reporte') return;
    aplicarFlujo(nuevo);
    consultar();
  });

  function consultar() {
    const { lat, lon } = state.point;
    state.anunciado = false;
    state.resumenChat = null;
    drawCircle();
    updateZona();
    if (MODULOS.riesgos) state.evaluacion = Riesgos.leerEvaluacion(lat, lon);
    updateEntorno();
    updateContexto();
    if (MODULOS.desastre) updatePeligro();
    if (state.distritoStatus === 'none' || state.distritoStatus === 'error') updateDistrito();
    if (MODULOS.seguridad) updateDelito();
    renderResumen();
  }

  function limpiarMapa() {
    if (state.zonOutline) { map.removeLayer(state.zonOutline); state.zonOutline = null; }
    limpiarEntornoMapa();
  }

  $('btn-cambiar').addEventListener('click', () => {
    limpiarMapa();
    aplicarFlujo(Onboarding.transicion(state.flujo, 'cambiar'));
    $('q').focus();
  });

  // «Nueva consulta»: vuelve al inicio sin punto ni resultados.
  $('btn-nueva').addEventListener('click', () => {
    ['zonaSeq', 'entornoSeq', 'peligroSeq', 'distritoSeq', 'delitoSeq', 'contextoSeq'].forEach((k) => { state[k] += 1; });
    limpiarMapa();
    if (state.pointMarker) { map.removeLayer(state.pointMarker); state.pointMarker = null; }
    if (state.ring) { map.removeLayer(state.ring); state.ring = null; }
    Object.assign(state, {
      point: null, etiqueta: '', etiquetaOrigen: null, distritoTexto: '', zona: null, zonaStatus: 'none', entorno: null, entornoStatus: 'none',
      distrito: null, distritoStatus: 'none', peligro: null, peligroStatus: 'none', delito: null, evaluacion: {}, cauce: null, contextoRiesgo: null,
    });
    $('lote').value = '';
    $('q').value = '';
    $('zon-calc').innerHTML = '';
    $('search-results').innerHTML = '';
    $('search-status').textContent = '';
    showSearchPop(false);
    $('ubicacion-estado').textContent = '';
    $('confirmar-aviso').textContent = '';
    $('guardar-estado').textContent = '';
    $('map-hint').classList.remove('oculto');
    map.setView(CONFIG.center, CONFIG.zoom, { animate: false });
    aplicarFlujo(Onboarding.transicion(state.flujo, 'nueva'));
    CompararUI.actualizarBoton();
    $('q').focus();
  });

  // ------------------------------------------------------------ Usar mi ubicación
  $('usar-ubicacion').addEventListener('click', () => {
    const estado = $('ubicacion-estado');
    const mensaje = (texto, error = false) => { estado.textContent = texto; estado.classList.toggle('error', error); };
    if (!navigator.geolocation) { mensaje('Este navegador no puede darnos tu ubicación. Escribe una dirección o toca el mapa.', true); return; }
    const boton = $('usar-ubicacion');
    boton.disabled = true;
    mensaje('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition((pos) => {
      boton.disabled = false;
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      if (!Onboarding.dentroDeCaja(lat, lon, CONFIG.viewbox)) {
        mensaje('Tu ubicación parece estar fuera de Arequipa metropolitana. Escribe una dirección o toca el mapa.', true);
        return;
      }
      mensaje('');
      const aviso = accuracy > 150 ? `La ubicación del dispositivo tiene un margen de unos ${Math.round(accuracy)} m: revisa que el marcador esté sobre tu predio.` : '';
      colocarPunto(lat, lon, { etiqueta: 'Tu ubicación', vista: 17, aviso });
    }, (err) => {
      boton.disabled = false;
      mensaje(err.code === 1
        ? 'No tenemos permiso para ver tu ubicación. Puedes permitirlo en el navegador, escribir una dirección o tocar el mapa.'
        : 'No pudimos obtener tu ubicación. Escribe una dirección o toca el mapa.', true);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });

  // ------------------------------------------------------------ Consejo del reporte (nada es obligatorio)
  // El recorrido guiado («¿Cómo funciona?») vive en tour.js y tour-ui.js.
  $('consejo-ok').addEventListener('click', () => {
    Onboarding.marcarConsejoVisto(almacen());
    $('consejo').hidden = true;
    $('zona-h').tabIndex = -1;
    $('zona-h').focus();
  });

  // ------------------------------------------------------------ Zonificación
  const fmtNum = (n) => Math.round(n).toLocaleString('es-PE');
  const has = (v) => v !== null && v !== undefined && v !== '';
  // `cls` lo usan los avisos de módulos y el PDF; `clase` e `ico` dibujan la etiqueta con icono + texto.
  const ZON_BADGE = {
    si: { cls: 'ok', text: 'Construible', clase: 'cumple', ico: 'cumple' },
    condicionado: { cls: 'warn', text: 'Requiere consulta', clase: 'parcial', ico: 'aviso' },
    no: { cls: 'no', text: 'No construible', clase: 'nocumple', ico: 'nocumple' },
  };
  const ZON_SIN_REGLAS = { cls: 'warn', text: 'Sin reglas en la tabla', clase: 'sindato', ico: 'sindato' };
  const ZON_SIGNIFICADO = {
    si: 'En esta zona el plano permite construir. Los parámetros de abajo fijan cuánto y cómo.',
    condicionado: 'En esta zona lo que se puede construir depende de la zona vecina, de un plan específico o de una norma especial. Consulta a la municipalidad.',
    no: 'En esta zona el plano no prevé construir vivienda ni usos comunes. La nota de abajo explica el motivo.',
  };

  $('zon-fuente').innerHTML = `<b>Fuente:</b> ${esc(CONFIG.zonificacion.fuente)} · <b>Fecha:</b> plano vigente 2016-2025 · <b>Método:</b> se ubica el punto dentro de los polígonos del plano. Es referencial: no reemplaza los certificados municipales.`;

  // V1b Zonificación proyectada: solo un aviso de texto, y únicamente si CONFIG.estadoPDM tiene fuente y fecha.
  const avisoPDM = Calculos.avisoPDMProyectado(CONFIG.estadoPDM);
  const enlaceSeguro = (u) => (/^https?:\/\//.test(u || '') ? u : null);
  if (avisoPDM) {
    const f = enlaceSeguro(avisoPDM.url) ? `<a href="${esc(avisoPDM.url)}" target="_blank" rel="noopener">${esc(avisoPDM.fuente)}</a>` : esc(avisoPDM.fuente);
    $('pdm-aviso').innerHTML = `
      <div class="pdm-aviso" role="note">
        ${icono('info', 'ico-lg')}
        <div>
          <strong>Zonificación proyectada (PDM nuevo)</strong>
          <p>${esc(avisoPDM.texto)}</p>
          <p class="small muted">Fuente: ${f} · Fecha: ${esc(avisoPDM.fecha)}. Es una nota de prensa, no un documento oficial; no hay mapa de la zonificación proyectada.</p>
        </div>
      </div>`;
    $('credito-pdm').innerHTML = `${f} (${esc(avisoPDM.fecha)})`;
  }

  function zonMessage(kind, html) {
    $('zon').innerHTML = `<p class="zon-msg ${kind}">${html}</p>`;
    $('zona-card').setAttribute('aria-busy', String(kind === 'loading'));
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

  function renderCalculo() {
    $('zon-calc').innerHTML = state.zonaStatus === 'ok' ? potencialHtml(state.zona.regla) : '';
  }

  function renderZona() {
    if (state.zonaStatus === 'outside') {
      zonMessage('empty', '<strong>Este punto está fuera del área zonificada.</strong> El plano no le asigna ninguna zona.');
      renderCalculo();
      return;
    }
    if (state.zonaStatus !== 'ok') return;

    const z = state.zona;
    const r = z.regla;
    const badge = ZON_BADGE[r && r.edificable] || ZON_SIN_REGLAS;
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
      ? `<div class="alerta-borde" role="note">${icono('aviso', 'ico-lg')}<p><strong>Punto cerca del borde de la zona.</strong> A ${fmtDist(b.distanciaM)} (en línea recta) hay otra zona: <strong>${esc(b.codigo)}</strong>${nombreVecina ? ` · ${esc(nombreVecina)}` : ''}. El plano se extrajo de un PDF y cerca de un borde el resultado puede no ser exacto: confirma la zona con el certificado municipal. Aviso a ${b.umbralM} m o menos (convención del proyecto).</p></div>`
      : '';
    const significado = r ? ZON_SIGNIFICADO[r.edificable] : 'El código del plano no está en la tabla de reglas de esta herramienta: confirma la zona con la municipalidad.';

    $('zon').innerHTML = `
      ${alertaBorde}
      <div class="zona-ficha">
        <div class="zona-rotulo">
          <span class="zona-codigo" style="--zona-color:${esc(z.color)}">${esc(z.codigo)}</span>
          <div class="zona-titulo">
            <p class="zona-nombre">${esc(r ? r.nombre : 'Código sin reglas en la tabla')}</p>
            <span class="estado ${badge.clase}">${icono(badge.ico)}${esc(badge.text)}</span>
          </div>
        </div>
        ${significado ? `<p class="zona-significado">${esc(significado)}</p>` : ''}
        ${filas.length ? `<dl class="param-lista">${filas.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${filas.length ? `<p class="zon-nota">Parámetros del Reglamento del PDM Arequipa 2016-2025, Título III${r && r.articulo ? ` (${esc(r.articulo)})` : ''}.</p>` : ''}
        ${r && r.nota ? `<p class="zon-nota">${esc(r.nota)}</p>` : ''}
        ${z.coincidencias > 1 ? `<p class="zon-nota">El plano tiene ${z.coincidencias} zonas superpuestas en este punto; se muestra la que queda encima.</p>` : ''}
      </div>`;
    $('zona-card').setAttribute('aria-busy', 'false');
    renderCalculo();
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

  $('lote').addEventListener('input', () => { renderCalculo(); renderResumen(); });

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
      state.distritoTexto = d ? `Distrito de ${capitalizar(d.distrito)}` : 'Fuera de los distritos de Arequipa metropolitana';
      refrescarTextoPunto();
    } catch (err) {
      if (seq !== state.distritoSeq) return;
      state.distritoStatus = 'error';
      state.distritoError = err.message;
      state.distritoTexto = '';
      refrescarTextoPunto();
      console.error('[Distritos] fallo', err);
    }
    renderSismo();
    renderResumen();
  }

  // ------------------------------------------------------------------ Resumen
  // La pantalla ya no tiene tarjetas de resumen: cada dato se lee en su propia tarjeta. Aquí solo se refrescan el
  // registro de riesgos (si su módulo está activo) y el anuncio para lectores de pantalla cuando el reporte está listo.
  const fmtCorto = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')} k` : String(n));

  function textoResumen() {
    const partes = [];
    if (state.zonaStatus === 'ok') {
      const r = state.zona.regla;
      partes.push(`Zonificación ${state.zona.codigo}${r ? `, ${r.nombre}` : ''}`);
    } else if (state.zonaStatus === 'outside') {
      partes.push('El punto está fuera del área zonificada');
    }
    const e = state.entorno;
    if (e) {
      const t = (r) => `${r.estado.toLowerCase()}${r.distanciaM !== null ? `, ${fmtDist(r.distanciaM)}` : ''}`;
      partes.push(`Salud: ${t(e.salud)}`);
      const niv = Equipamiento.NIVELES;
      partes.push(`Colegio: ${niv.filter((n) => e.educacion[n].estado === 'CUMPLE').length} de ${niv.length} niveles cumplen`);
      partes.push(`Paradero: ${t(e.transporte)}`);
      partes.push(`Área verde: ${t(e.areaVerde)}`);
    }
    return `Reporte listo. ${partes.join('. ')}.`;
  }

  function renderResumen() {
    CompararUI.actualizarBoton(); // el botón «Guardar para comparar» depende de que la consulta esté lista
    if (!state.point) return;
    if (MODULOS.riesgos) renderRiesgos();
    const listo = state.zonaStatus !== 'none' && state.zonaStatus !== 'loading' && state.entorno;
    if (listo && !state.anunciado && state.flujo.paso === 'reporte') {
      state.anunciado = true;
      anunciar(textoResumen());
    }
    resumenLlano();
  }

  // Resumen en palabras de todos los días: encabeza la ficha y se publica una vez en el chat (resumen.js). Espera a tener
  // la zona, los servicios, el distrito y el cauce más cercano; no calcula nada nuevo.
  function resumenLlano() {
    const listo = state.zonaStatus !== 'none' && state.zonaStatus !== 'loading' && state.entorno && state.cauce
      && state.distritoStatus !== 'none' && state.distritoStatus !== 'loading';
    if (!state.point || !listo) return;
    const r = Resumen.punto({
      distrito: state.distritoStatus === 'ok' ? state.distrito.distrito : null,
      zona: state.zonaStatus === 'ok' ? state.zona : null,
      entorno: state.entorno,
      cauce: state.cauce,
    });
    $('ficha-resumen-lineas').innerHTML = r.lineas.map((l) => `<p>${esc(l)}</p>`).join('');
    $('ficha-resumen').hidden = false;
    const clave = `${state.point.lat},${state.point.lon}`;
    if (state.resumenChat !== clave) {
      state.resumenChat = clave;
      AsistenteUI.publicarPunto({ ...r, etiqueta: state.etiqueta });
    }
  }

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
    box.textContent = 'Buscando la dirección…';
    try {
      const { results } = await Services.geocode(q, { bounded: $('bounded').checked });
      if (results.length === 0) {
        box.textContent = 'No encontramos esa dirección. Prueba con la calle y el distrito, o desmarca «Buscar solo en Arequipa». También puedes tocar el mapa.';
      } else {
        box.textContent = results.length === 1 ? 'Encontramos este lugar. Tócalo para elegirlo:' : 'Elige el lugar que buscas:';
        results.forEach((r) => {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = r.name;
          b.addEventListener('click', () => {
            list.innerHTML = '';
            box.textContent = '';
            showSearchPop(false);
            colocarPunto(r.lat, r.lon, { etiqueta: etiquetaCorta(r.name), vista: 17 });
          });
          li.appendChild(b);
          list.appendChild(li);
        });
      }
    } catch (err) {
      box.innerHTML = `<span class="texto-error">No pudimos buscar la dirección. ${esc(describeError(err, 'Nominatim').title)} Toca el mapa para elegir el punto.</span>`;
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
  // Cada estado lleva icono y texto (la forma del icono también lo distingue), nunca solo color.
  const ESTADO_CLS = { CUMPLE: 'ok', 'NO CUMPLE': 'no', 'SIN DATO': 'warn' };
  const ESTADO_UI = {
    CUMPLE: { clase: 'cumple', ico: 'cumple' },
    'NO CUMPLE': { clase: 'nocumple', ico: 'nocumple' },
    'SIN DATO': { clase: 'sindato', ico: 'sindato' },
    PARCIAL: { clase: 'parcial', ico: 'parcial' },
    INFORMATIVO: { clase: 'informativo', ico: 'info' }, // dato sin umbral normativo: se muestra sin cumple / no cumple
  };
  const estadoBadge = (estado, texto) => `<span class="estado ${ESTADO_UI[estado].clase}">${icono(ESTADO_UI[estado].ico)}${esc(texto || estado)}</span>`;
  const fmtArea = (m2) => `${fmtNum(m2)} m² (${(m2 / 10000).toFixed(2).replace('.', ',')} ha)`;
  const fmtFechaDato = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'sin fecha');
  const NIVEL_TXT = { inicial: 'Inicial', primaria: 'Primaria', secundaria: 'Secundaria' };
  const SIN_DATO_TXT = 'Puede existir pero no estar en nuestros datos: OpenStreetMap es un mapa colaborativo.';

  // Distancia grande y, debajo, el nombre del más cercano.
  function datoPrincipal(r) {
    if (r.error) return `<p class="zon-msg error"><strong>No se pudo obtener el dato.</strong> ${esc(r.error)}</p>`;
    if (r.distanciaM === null) return '';
    const dist = r.distanciaM === 0 ? '0 m' : fmtDist(r.distanciaM);
    return `<div class="var-dato">
      <p class="var-dist">${dist} <small>${r.distanciaM === 0 ? 'el punto está dentro del área' : 'en línea recta'}</small></p>
      <p class="var-nombre">${esc(r.nombre)}</p>
    </div>`;
  }

  // Explicación en una frase: qué significa el estado frente a la distancia de referencia.
  function explicacion(r, cosa) {
    if (r.error) return '';
    if (r.estado === 'SIN DATO') return `<p class="var-vacio"><strong>Sin dato.</strong> No hay ${cosa} en nuestros datos. ${SIN_DATO_TXT}</p>`;
    if (r.distanciaM === null) return `<p class="var-explica">No se encontró ${cosa} dentro de los datos cercanos. Distancia de referencia: ${fmtUmbral(r.umbralM)}.</p>`;
    return `<p class="var-explica">${r.estado === 'CUMPLE' ? `Está dentro de la distancia de referencia (${fmtUmbral(r.umbralM)}).` : `Está más lejos que la distancia de referencia (${fmtUmbral(r.umbralM)}).`}</p>`;
  }

  // Lo que cada dato NO dice. Va dentro de cada tarjeta, junto a la fuente y la fecha.
  const QUE_NO_CUBRE = {
    salud: 'Solo cuenta lo mapeado en OpenStreetMap con etiquetas de salud. No dice si atiende emergencias, su horario ni su categoría, y la distancia es en línea recta, no recorrido a pie.',
    educacion: 'OpenStreetMap casi no etiqueta el nivel: un colegio sin nivel se toma como candidato a primaria y secundaria, y los jardines cuentan como inicial. No dice si es público o privado, ni si hay vacantes.',
    transporte: 'Un paradero no es un servicio: el de OpenStreetMap no dice qué líneas lo usan, su horario ni su frecuencia, y las paradas informales (combis, micros) rara vez están completas.',
    rutas: 'Son los recorridos que SmartBus publicó en la fecha indicada, no un servicio garantizado: no traen frecuencias ni horarios, y un cambio de ruta por tramos puede no estar reflejado. La distancia es al trazado, no a donde se puede subir. Una línea de otra empresa que SmartBus no publica no aparece.',
    areaVerde: `Solo cuenta polígonos cerrados en OpenStreetMap de al menos ${fmtNum(CONFIG.umbrales.areaVerde.areaMinM2)} m²; una plaza mapeada de otra forma no cuenta. No dice si el acceso es público ni cómo está mantenida.`,
  };

  // Fuente, fecha, método y límites de un dato: el detalle que se abre al tocar la tarjeta.
  function detalleDato(r, noCubre, { metodo = true } = {}) {
    return `<dl class="var-detalle">
      <div><dt>Fuente</dt><dd>${esc(r.fuente)}</dd></div>
      <div><dt>Fecha de los datos</dt><dd>${esc(fmtFechaDato(r.fecha))}</dd></div>
      ${metodo ? `<div><dt>Método</dt><dd>${esc(r.metodo)}</dd></div>` : ''}
      <div><dt>Qué no cubre</dt><dd>${esc(noCubre)}</dd></div>
    </dl>`;
  }

  // Líneas de SmartBus que pasan cerca del punto (Rutas.cerca): otra fuente distinta del paradero de OpenStreetMap.
  function bloqueRutas(t) {
    const r = t && t.rutas;
    if (!r) return '';
    if (r.error) return `<div class="var-rutas"><p class="zon-msg error"><strong>No se pudieron cargar las líneas.</strong> ${esc(r.error)}</p></div>`;
    const ref = fmtUmbral(r.distanciaM);
    const nota = `<p class="var-meta">Fuente: ${esc(r.fuente)}, recorridos del ${esc(fmtFechaDato(r.fecha))}. Distancia de referencia de ${ref}: ${esc(CONFIG.fuentesUmbral.transporte.toLowerCase())}.</p>`;
    if (!r.lineas.length) return `<div class="var-rutas"><p class="var-rutas-t"><strong>Líneas que pasan a ≤${ref}:</strong> ninguna en los recorridos publicados por SmartBus.</p>${nota}</div>`;
    const items = r.lineas.map((l) => {
      const ramales = [...new Set(l.ramales.map((x) => x.ramal))];
      const parada = l.parada ? ` · parada más cercana «${esc(l.parada.nombre)}» a ${fmtDist(l.parada.distanciaM)}` : '';
      return `<li><strong>${esc(Rutas.etiquetaLinea(l))}</strong><span class="var-meta">trazado a ${fmtDist(l.distanciaM)}${parada} · ${esc(ramales.slice(0, 4).join(', '))}${ramales.length > 4 ? ` y ${ramales.length - 4} más` : ''}</span></li>`;
    }).join('');
    return `<div class="var-rutas"><p class="var-rutas-t"><strong>Líneas que pasan a ≤${ref}:</strong> ${esc(Rutas.listaTexto(r.lineas))}</p><ul class="var-rutas-lista">${items}</ul>${nota}</div>`;
  }

  function detalleRutas(r) {
    if (!r || r.error) return '';
    return `<dl class="var-detalle">
      <div><dt>Fuente de las líneas</dt><dd>${esc(r.fuente)}. Datos usados con ${esc(r.permiso || CONFIG.rutas.permiso)}.</dd></div>
      <div><dt>Fecha de los datos</dt><dd>${esc(fmtFechaDato(r.fecha))} (descarga)</dd></div>
      <div><dt>Método</dt><dd>Distancia en línea recta del punto al trazado de cada recorrido (plano local, como el resto de distancias). Se agrupan los recorridos de ida y vuelta por línea. Referencia: ${fmtUmbral(r.distanciaM)}.</dd></div>
      <div><dt>Qué no cubre</dt><dd>${esc(QUE_NO_CUBRE.rutas)}</dd></div>
    </dl>`;
  }

  // Línea de la tarjeta cerrada: distancia frente a la distancia de referencia.
  function lineaResumen(r) {
    if (r.error) return 'No se pudo obtener el dato';
    if (r.estado === 'SIN DATO' || r.distanciaM === null) return `Sin dato · referencia ${fmtUmbral(r.umbralM)}`;
    return `${r.distanciaM === 0 ? '0 m (dentro del área)' : `${fmtDist(r.distanciaM)} en línea recta`} · referencia ${fmtUmbral(r.umbralM)}`;
  }

  // Cada tarjeta es un desplegable accesible: el resumen (estado y distancia frente al umbral) siempre se ve.
  function tarjetaVariable(v, estado, resumen, cuerpo, textoEstado) {
    return `<details class="var-card">
      <summary class="var-resumen">
        <span class="var-icon${v.icono === 'verde' ? ' verde' : ''}">${icono(v.icono)}</span>
        <span class="var-resumen-t"><span class="var-titulo">${v.titulo}</span><span class="var-linea">${esc(resumen)}</span></span>
        ${estadoBadge(estado, textoEstado)}
        <span class="var-chevron" aria-hidden="true"></span>
      </summary>
      <div class="var-cuerpo">${cuerpo}</div>
    </details>`;
  }

  function renderEntorno() {
    const e = state.entorno;
    const etiq = (r) => (r.etiqueta ? `<p class="var-meta">Etiqueta de OpenStreetMap: <code>${esc(r.etiqueta)}</code></p>` : '');

    const salud = tarjetaVariable(VARIABLES.salud, e.salud.estado, lineaResumen(e.salud),
      datoPrincipal(e.salud) + explicacion(e.salud, 'establecimientos de salud') + etiq(e.salud) + detalleDato(e.salud, QUE_NO_CUBRE.salud));

    const niveles = Equipamiento.NIVELES.map((n) => {
      const r = e.educacion[n];
      return `<div class="var-nivel">
        <div class="var-nivel-head"><strong>${NIVEL_TXT[n]}</strong>${estadoBadge(r.estado)}</div>
        ${datoPrincipal(r)}
        ${explicacion(r, `colegios de nivel ${n}`)}
        ${etiq(r)}
        <p class="var-meta"><b>Método:</b> ${esc(r.metodo)}</p>
      </div>`;
    }).join('');
    const edu = Equipamiento.NIVELES.map((n) => e.educacion[n]);
    const cumplen = edu.filter((r) => r.estado === 'CUMPLE').length;
    const estadoEdu = cumplen === edu.length ? 'CUMPLE' : edu.every((r) => r.estado === 'SIN DATO') ? 'SIN DATO' : cumplen === 0 ? 'NO CUMPLE' : 'PARCIAL';
    const textoEdu = estadoEdu === 'PARCIAL' ? `${cumplen} de ${edu.length} niveles` : null;
    const resumenEdu = estadoEdu === 'SIN DATO' ? 'Sin dato en los tres niveles'
      : `${cumplen} de ${edu.length} niveles dentro de la distancia de referencia (${edu.map((r) => fmtUmbral(r.umbralM)).join(' / ')})`;
    const educacion = tarjetaVariable(VARIABLES.educacion, estadoEdu, resumenEdu,
      `<div class="var-niveles">${niveles}</div>${detalleDato(e.educacion.inicial, QUE_NO_CUBRE.educacion, { metodo: false })}`, textoEdu);

    const rutas = e.transporte.rutas;
    const resumenTransporte = lineaResumen(e.transporte) + (rutas && !rutas.error ? ` · ${rutas.lineas.length} ${rutas.lineas.length === 1 ? 'línea' : 'líneas'} a ≤${fmtUmbral(rutas.distanciaM)}` : '');
    const transporte = tarjetaVariable(VARIABLES.transporte, e.transporte.estado, resumenTransporte,
      datoPrincipal(e.transporte) + explicacion(e.transporte, 'paraderos') + etiq(e.transporte) + bloqueRutas(e.transporte) + detalleDato(e.transporte, QUE_NO_CUBRE.transporte) + detalleRutas(rutas));

    const v = e.areaVerde;
    const u = CONFIG.umbrales.areaVerde;
    const sens = v.error || v.estado === 'SIN DATO' ? '' : `<p class="var-meta">Superficie: ${v.areaM2 ? fmtArea(v.areaM2) : '—'}. Con el criterio más estricto (al menos ${fmtNum(u.areaGrandeM2)} m², 1 ha): ${v.cumple1ha ? `también hay una a ${fmtDist(v.distancia1haM)} (${esc(v.nombre1ha)})` : `no hay ninguna a ${u.distanciaM} m o menos`}.</p>`;
    const areaVerde = tarjetaVariable(VARIABLES.areaVerde, v.estado, lineaResumen(v),
      datoPrincipal(v) + explicacion(v, 'áreas verdes')
      + `<p class="var-meta">Criterio: un área verde de al menos ${fmtNum(u.areaMinM2)} m² a ${u.distanciaM} m o menos.</p>` + sens
      + detalleDato(v, QUE_NO_CUBRE.areaVerde));

    $('entorno').innerHTML = salud + educacion + transporte + areaVerde + '<div id="card-quebradas"></div>';
    renderQuebradas(); // llega aparte (archivo congelado de la ANA)
    $('entorno').setAttribute('aria-busy', 'false');
    $('entorno-toggle').hidden = false;
    actualizarToggleTarjetas();
    $('entorno-fuente').textContent = 'Distancias en línea recta, no recorrido a pie. OpenStreetMap es colaborativo: algo ausente puede existir. Las distancias de referencia de salud, paradero y borde de zona son convenciones del proyecto. Las líneas de transporte son recorridos publicados por SmartBus, sin frecuencias ni horarios.';
  }

  // ------------------------------------------------------ Quebradas y cauces (ANA)
  // Sin umbral normativo: INFORMATIVO. Si la persona fija el suyo en «Mis umbrales», CUMPLE / NO CUMPLE «según tu umbral».
  const NORMALIZA = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const QUEBRADAS_CITADAS = ['Añashuayco', 'San Lázaro']; // quebradas de Arequipa que citan los informes de INGEMMET (docs/INVESTIGACION-VARIABLES.md)

  function resumenQuebradas(q) {
    if (q.estado === 'SIN DATO') return 'Sin dato: no se pudo leer la red de cauces';
    const base = `${q.nombre} · ${fmtDist(q.distanciaM)} en línea recta`;
    return q.segunUmbralUsuario ? `${base} · según tu umbral de ${fmtUmbral(q.umbralM)}` : `${base} · sin umbral normativo`;
  }

  function umbralFormHtml(q) {
    const v = state.umbrales.quebradaMinM;
    return `<form class="umbral-form" novalidate>
      <h5>Mis umbrales</h5>
      <label for="umbral-quebrada">Distancia mínima a una quebrada o un río</label>
      <div class="umbral-fila">
        <span class="input-unit"><input id="umbral-quebrada" name="quebradaMinM" type="number" min="1" max="${Umbrales.MAXIMO_M}" step="1" inputmode="numeric" placeholder="Ej.: 200" value="${v === null ? '' : v}" aria-describedby="umbral-ayuda"><em>m</em></span>
        <button type="submit" class="secondary compacto">Guardar mi umbral</button>
        <button type="button" class="link" data-umbral-quitar${v === null ? ' hidden' : ''}>Quitar</button>
      </div>
      <p id="umbral-ayuda" class="small muted">Es tu criterio, no una norma: ninguna fija esta distancia. Con tu umbral, la tarjeta dice «cumple» si el cauce está a esa distancia o más lejos. Se guarda solo en este navegador.</p>
      <p class="texto-error small umbral-error" role="alert" hidden></p>
    </form>`;
  }

  function cuerpoQuebradas(q) {
    if (q.estado === 'SIN DATO') {
      return `<p class="zon-msg error"><strong>No se pudo obtener el dato.</strong> ${esc(q.error || 'El archivo de quebradas no está disponible.')}</p>${umbralFormHtml(q)}`;
    }
    const ausentes = QUEBRADAS_CITADAS.filter((n) => !(q.nombres || []).some((x) => NORMALIZA(x).includes(NORMALIZA(n))));
    const cubre = `La red hidrográfica de la ANA es de escala nacional: en este archivo figuran ${q.tramos} tramos de ${(q.nombres || []).length} cursos (${esc((q.nombres || []).join(', '))}). No incluye todas las quebradas urbanas${ausentes.length ? ` (por ejemplo, no figura${ausentes.length > 1 ? 'n' : ''} ${ausentes.join(' ni ')}, que citan los informes de INGEMMET)` : ''}. No es un mapa de peligro de huaicos ni de inundación, y la faja marginal no está delimitada aquí.`;
    const explica = q.segunUmbralUsuario
      ? `<p class="var-explica"><strong>Según tu umbral</strong> (al menos ${fmtUmbral(q.umbralM)} de un cauce): ${q.estado === 'CUMPLE' ? 'cumple' : 'no cumple'}. Es tu criterio, no una norma.</p>`
      : '<p class="var-explica"><strong>Informativo.</strong> No existe una distancia normativa a una quebrada, así que no decimos si es cerca o lejos. Si quieres un criterio propio, fija tu distancia mínima abajo.</p>';
    return `<div class="var-dato">
        <p class="var-dist">${fmtDist(q.distanciaM)} <small>en línea recta</small></p>
        <p class="var-nombre">${esc(q.nombre)}${q.tipo ? ` (${esc(q.tipo.toLowerCase())})` : ''}</p>
      </div>
      ${explica}
      ${umbralFormHtml(q)}
      <dl class="var-detalle">
        <div><dt>Fuente</dt><dd>${esc(q.fuente)}</dd></div>
        <div><dt>Fecha de los datos</dt><dd>${esc(fmtFechaDato(q.fecha))} (extracción)${q.elaboracion ? `. Elaboración: ${esc(q.elaboracion)}` : ''}</dd></div>
        <div><dt>Método</dt><dd>${esc(q.metodo)}</dd></div>
        <div><dt>Qué no cubre</dt><dd>${cubre}</dd></div>
      </dl>`;
  }

  function renderQuebradas() {
    const host = $('card-quebradas');
    if (!host) return;
    const q = state.cauce;
    if (!q) { host.innerHTML = '<p class="zon-msg loading"><span class="spinner"></span>Buscando la quebrada o el río más cercano…</p>'; return; }
    const abierta = host.querySelector('details') && host.querySelector('details').open;
    host.innerHTML = tarjetaVariable(VARIABLES.quebradas, q.estado, resumenQuebradas(q), cuerpoQuebradas(q), q.segunUmbralUsuario ? `${q.estado} (tu umbral)` : q.estado === 'INFORMATIVO' ? 'Informativo' : null);
    if (abierta) host.querySelector('details').open = true;
    actualizarToggleTarjetas();
  }

  // «Mis umbrales»: guardar o quitar la distancia mínima. La tarjeta se recalcula con la distancia ya conocida.
  async function aplicarUmbral(valor) {
    state.umbrales = Umbrales.guardar(almacen(), { quebradaMinM: valor });
    if (!state.point) return;
    const seq = state.contextoSeq;
    const q = await Contexto.quebradas(state.point.lat, state.point.lon, state.umbrales.quebradaMinM);
    if (seq !== state.contextoSeq) return;
    state.cauce = q;
    renderQuebradas();
    const abierta = $('card-quebradas').querySelector('details');
    if (abierta) abierta.open = true;
    const campo = $('umbral-quebrada');
    if (campo) campo.focus();
    anunciar(state.umbrales.quebradaMinM === null ? 'Umbral quitado. La distancia a quebradas vuelve a ser informativa.' : `Umbral guardado: ${fmtUmbral(state.umbrales.quebradaMinM)}. Estado: ${q.estado === 'CUMPLE' ? 'cumple' : q.estado === 'NO CUMPLE' ? 'no cumple' : 'informativo'} según tu umbral.`);
    CompararUI.refrescar();
  }

  $('entorno').addEventListener('submit', (e) => {
    const f = e.target.closest('.umbral-form');
    if (!f) return;
    e.preventDefault();
    const crudo = f.elements.quebradaMinM.value.trim();
    const valido = Umbrales.normalizar({ quebradaMinM: crudo }).quebradaMinM;
    const err = f.querySelector('.umbral-error');
    if (crudo === '' || valido === null) {
      err.textContent = `Escribe una distancia entre 1 y ${fmtNum(Umbrales.MAXIMO_M)} m, o pulsa «Quitar».`;
      err.hidden = false;
      return;
    }
    err.hidden = true;
    aplicarUmbral(valido);
  });
  $('entorno').addEventListener('click', (e) => {
    if (e.target.closest('[data-umbral-quitar]')) aplicarUmbral(null);
  });

  // ------------------------------------------------------ Contexto de riesgo (informativo)
  function tarjetaPeligros(p) {
    if (p.estado === 'SIN DATO') {
      return tarjetaVariable(VARIABLES.peligros, 'SIN DATO', 'Sin dato: no se pudo leer el inventario', `<p class="zon-msg error"><strong>No se pudo obtener el dato.</strong> ${esc(p.error || '')}</p>`);
    }
    const resumen = `${p.total} a ${fmtUmbral(p.radioM)} o menos${p.masCercano ? ` · el más cercano a ${fmtDist(p.distanciaM)} en línea recta` : ''}`;
    const m = p.masCercano;
    const tipos = p.porTipo.length ? `<ul class="pel-tipos">${p.porTipo.map(([tp, n]) => `<li>${esc(tp)} · ${fmtNum(n)}</li>`).join('')}</ul>` : '';
    const cuerpo = `<div class="var-dato">
        <p class="var-dist">${fmtNum(p.total)} <small>registrado${p.total === 1 ? '' : 's'} a ${fmtUmbral(p.radioM)} o menos</small></p>
        ${m ? `<p class="var-nombre">El más cercano: ${esc(m.subtipo || m.tipo)}, a ${fmtDist(p.distanciaM)} en línea recta${m.anio ? ` (registrado en ${esc(m.anio)})` : ''}${m.sector ? `. Sector: ${esc(m.sector)}` : ''}</p>` : ''}
      </div>
      <p class="var-explica"><strong>Informativo.</strong> Es un inventario de eventos documentados, no una evaluación del lugar.</p>
      ${tipos}
      <dl class="var-detalle">
        <div><dt>Fuente</dt><dd>${esc(p.fuente)}</dd></div>
        <div><dt>Fecha de los datos</dt><dd>Inventario de ${esc(p.anioDesde)} a ${esc(p.anioHasta)} (${fmtNum(p.registros)} registros en Arequipa metropolitana). Datos congelados el ${esc(fmtFechaDato(p.fecha))}</dd></div>
        <div><dt>Método</dt><dd>${esc(p.metodo)}</dd></div>
        <div><dt>Qué no cubre</dt><dd>No es un mapa de susceptibilidad: que no haya registros cerca no significa que el lugar sea seguro, solo que nadie documentó un evento ahí. Un registro es un sector inspeccionado, no el alcance real del evento. Faltan los eventos posteriores al inventario y los de erosión o inundación que no estén en él.</dd></div>
      </dl>`;
    return tarjetaVariable(VARIABLES.peligros, 'INFORMATIVO', resumen, cuerpo, 'Informativo');
  }

  function tarjetaSismos(s) {
    if (s.estado === 'SIN DATO') {
      return tarjetaVariable(VARIABLES.sismos, 'SIN DATO', 'Sin dato: no se pudo leer el archivo de sismos', `<p class="zon-msg error"><strong>No se pudo obtener el dato.</strong> ${esc(s.error || '')}</p>`);
    }
    const km = s.radioM / 1000;
    const resumen = `${s.total} sismo${s.total === 1 ? '' : 's'} a ${km} km o menos entre el ${fmtFechaDato(s.desde)} y el ${fmtFechaDato(s.hasta)}${s.magnitudMaxima !== null ? ` · magnitud máxima ${String(s.magnitudMaxima).replace('.', ',')}` : ''}`;
    const cuerpo = `<div class="var-dato">
        <p class="var-dist">${fmtNum(s.total)} <small>sismo${s.total === 1 ? '' : 's'} reportado${s.total === 1 ? '' : 's'} a ${km} km o menos</small></p>
        <p class="var-nombre">Periodo: ${esc(fmtFechaDato(s.desde))} a ${esc(fmtFechaDato(s.hasta))}${s.magnitudMaxima !== null ? `. Magnitud máxima: ${esc(String(s.magnitudMaxima).replace('.', ','))}` : ''}${s.masReciente ? `. El más reciente: ${esc(fmtFechaDato(s.masReciente))}` : ''}</p>
      </div>
      <p class="var-explica"><strong>Informativo.</strong> Es actividad reciente reportada: no predice sismos ni mide el peligro del lugar.</p>
      <dl class="var-detalle">
        <div><dt>Fuente</dt><dd>${esc(s.fuente)}</dd></div>
        <div><dt>Fecha de los datos</dt><dd>Sismos del ${esc(fmtFechaDato(s.desde))} al ${esc(fmtFechaDato(s.hasta))}. Datos congelados el ${esc(fmtFechaDato(s.fecha))}</dd></div>
        <div><dt>Método</dt><dd>${esc(s.metodo)}</dd></div>
        <div><dt>Qué no cubre</dt><dd>No es el catálogo histórico: solo cubre el periodo indicado, así que un conteo bajo no dice nada del pasado. El radio de ${km} km es una convención del proyecto para dar contexto. El peligro sísmico para construir lo fija la zona sísmica de la Norma E.030, que depende del distrito, y el Estudio de Mecánica de Suelos.</dd></div>
      </dl>`;
    return tarjetaVariable(VARIABLES.sismos, 'INFORMATIVO', resumen, cuerpo, 'Informativo');
  }

  function renderContexto() {
    const host = $('contexto-cuerpo');
    const c = state.contextoRiesgo;
    if (!c) {
      host.setAttribute('aria-busy', 'true');
      host.innerHTML = '<p class="zon-msg loading"><span class="spinner"></span>Buscando peligros registrados y sismos reportados…</p>';
      return;
    }
    const abiertas = [...host.querySelectorAll('details.var-card')].map((d) => d.open);
    host.innerHTML = tarjetaPeligros(c.peligros) + tarjetaSismos(c.sismos);
    host.querySelectorAll('details.var-card').forEach((d, i) => { d.open = Boolean(abiertas[i]); });
    host.setAttribute('aria-busy', 'false');
    $('contexto-fuente').textContent = 'Contexto informativo, no una evaluación de peligro. Distancias en línea recta. Para decidir, consulta SIGRID (CENEPRED) y al IMPLA.';
  }

  async function updateContexto() {
    const seq = ++state.contextoSeq;
    const { lat, lon } = state.point;
    state.cauce = null;
    state.contextoRiesgo = null;
    renderQuebradas();
    renderContexto();
    const r = await Contexto.evaluar(lat, lon, state.umbrales.quebradaMinM); // nunca rechaza: cada variable devuelve SIN DATO con su causa
    if (seq !== state.contextoSeq) return; // la persona ya eligió otro punto
    state.cauce = r.quebradas;
    state.contextoRiesgo = { peligros: r.peligros, sismos: r.sismos };
    renderQuebradas();
    renderContexto();
    renderResumen();
  }

  // «Abrir todas» / «Cerrar todas» las tarjetas de servicios.
  const tarjetas = () => [...$('entorno').querySelectorAll('details.var-card')];
  function actualizarToggleTarjetas() {
    const t = tarjetas();
    $('entorno-toggle').textContent = t.length > 0 && t.every((d) => d.open) ? 'Cerrar todas' : 'Abrir todas';
  }
  $('entorno-toggle').addEventListener('click', () => {
    const t = tarjetas();
    const abrir = !t.every((d) => d.open);
    t.forEach((d) => { d.open = abrir; });
    actualizarToggleTarjetas();
  });
  $('entorno').addEventListener('toggle', actualizarToggleTarjetas, true); // `toggle` no burbujea: se escucha en captura

  // Marcadores y línea recta hacia lo más cercano de cada variable (el área verde se dibuja como polígono).
  function limpiarEntornoMapa() {
    if (state.entornoLayer) { map.removeLayer(state.entornoLayer); state.entornoLayer = null; }
  }

  function dibujarEntorno() {
    limpiarEntornoMapa();
    const e = state.entorno;
    const { lat, lon } = state.point;
    const grupo = L.layerGroup();
    const color = colorMapa('--map-poi');
    const verde = colorMapa('--map-verde');
    const filas = [
      { v: VARIABLES.salud, r: e.salud, rotulo: 'Salud' },
      ...Equipamiento.NIVELES.map((n) => ({ v: VARIABLES.educacion, r: e.educacion[n], rotulo: `Colegio ${n}` })),
      { v: VARIABLES.transporte, r: e.transporte, rotulo: 'Paradero' },
      { v: VARIABLES.areaVerde, r: e.areaVerde, rotulo: 'Área verde' },
    ].filter((f) => f.r.lat !== null && f.r.lat !== undefined);
    // Un mismo colegio puede ser el más cercano de varios niveles: un solo marcador con todos los rótulos.
    const porElemento = new Map();
    filas.forEach((f) => {
      const k = f.r.osm || `${f.r.lat},${f.r.lon}`;
      if (!porElemento.has(k)) porElemento.set(k, { ...f, rotulos: [] });
      porElemento.get(k).rotulos.push(`${f.rotulo}: ${f.r.estado.toLowerCase()}`);
    });
    const cercanos = [[lat, lon]];
    porElemento.forEach(({ v, r, rotulos }) => {
      const c = v.icono === 'verde' ? verde : color;
      if (r.forma) L.geoJSON({ type: 'Feature', geometry: r.forma }, { style: { color: c, weight: 2, fillOpacity: 0.2 }, interactive: false }).addTo(grupo);
      else L.polyline([[lat, lon], [r.lat, r.lon]], { color: c, weight: 2, dashArray: '4 6', interactive: false }).addTo(grupo);
      const enlace = r.osm ? `<br><small><a href="https://www.openstreetmap.org/${esc(r.osm)}" target="_blank" rel="noopener">${esc(r.osm)} en openstreetmap.org</a></small>` : '';
      const dist = r.distanciaM === 0 ? 'el punto está dentro del área' : `${fmtDist(r.distanciaM)} en línea recta`;
      L.marker([r.lat, r.lon], { icon: poiIcon(v), title: r.nombre || v.titulo })
        .bindPopup(`<strong>${esc(r.nombre)}</strong><br>${rotulos.map(esc).join('<br>')}<br>${dist}${enlace}`)
        .addTo(grupo);
      if (r.distanciaM <= 1500) cercanos.push([r.lat, r.lon]);
    });
    state.entornoLayer = grupo.addTo(map);
    // El mapa acompaña al reporte: encuadra el punto y lo que tiene cerca.
    requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      if (cercanos.length > 1) map.fitBounds(L.latLngBounds(cercanos), { padding: [48, 48], maxZoom: 17, animate: !sinMovimiento() });
      else map.setView([lat, lon], 17, { animate: !sinMovimiento() });
    });
  }

  async function updateEntorno() {
    const seq = ++state.entornoSeq;
    const { lat, lon } = state.point;
    state.entorno = null;
    state.entornoStatus = 'loading';
    limpiarEntornoMapa();
    $('entorno').setAttribute('aria-busy', 'true');
    $('entorno-toggle').hidden = true;
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
      if (e.transporte.rutas && !e.transporte.rutas.error) resumen.push(['Líneas de transporte', Rutas.resumen(e.transporte.rutas, 12)]);
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
      cauce: state.cauce,                 // quebradas: INFORMATIVO, o cumple / no cumple según el umbral de la persona
      contextoRiesgo: state.contextoRiesgo, // peligros geológicos y sismos (informativo)
      verificaciones: { calculado: Verificaciones.CALCULADO, items: Verificaciones.ITEMS, aviso: Verificaciones.AVISO },
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

  // ------------------------------------------------------------- Asistente de chat
  // «Consultar ese punto» desde el chat: deja el punto elegido y abre su reporte, como si se hubiera pulsado «Sí, verificar».
  function consultarPunto(lat, lon, etiqueta) {
    EspacioUI.abrirPunto({ foco: false });
    if (state.flujo.paso === 'reporte') {
      limpiarMapa();
      aplicarFlujo(Onboarding.transicion(state.flujo, 'cambiar'), { foco: false });
    }
    colocarPunto(lat, lon, { etiqueta, vista: 16 });
    const nuevo = Onboarding.transicion(state.flujo, 'confirmar');
    if (nuevo.paso !== 'reporte') return;
    aplicarFlujo(nuevo);
    consultar();
  }
  // El chat es lo principal. Dibuja en el mapa las entidades de cada búsqueda y de cada conteo (CapasUI) y puede pedir que se vea el mapa.
  AsistenteUI.iniciar({
    map,
    obtenerPunto: () => state.point,
    consultarPunto,
    umbrales: () => state.umbrales,
    mostrarMapa: () => EspacioUI.mostrarMapa(),
    mapaVisible: () => EspacioUI.mapaVisible(),
    alBuscar: (que) => CapasUI.mostrar(que),
    verSector: (n) => CapasUI.enfocarSector(n),
    abrirFicha: () => { EspacioUI.abrirPunto({ foco: false }); $('resultado').scrollIntoView({ block: 'start' }); },
    abrirVerificaciones: () => { EspacioUI.abrirPunto({ foco: false }); $('verif-detalle').open = true; $('verif-detalle').scrollIntoView({ block: 'start' }); },
    guardarParaComparar: () => {
      const b = $('btn-guardar');
      if (b.dataset.modo === 'guardar' && !b.disabled) { b.click(); return 'Guardé este punto para comparar. Puedes verlo junto con los otros en «Comparar».'; }
      if (b.dataset.modo === 'quitar') return 'Este punto ya está guardado. Lo ves en «Comparar».';
      return 'Todavía no puedo guardarlo: espera a que termine de calcular el punto o revisa si ya tienes el máximo de puntos guardados.';
    },
  });
  CapasUI.iniciar({ map, datos: () => AsistenteUI.datosParaMapa(), mapaVisible: () => EspacioUI.mapaVisible() });
  EspacioUI.iniciar({ map, enfocarPunto: () => $(PASO_TITULO[state.flujo.paso]) });

  // ------------------------------------------------------------- Comparar puntos
  // Instantánea del punto actual con lo que la ficha ya calculó; null mientras la consulta no termina.
  function candidatoActual() {
    if (!state.point || !state.entorno || !state.cauce || !state.contextoRiesgo || state.zonaStatus === 'loading' || state.zonaStatus === 'none') return null;
    const distrito = state.distritoStatus === 'ok' ? capitalizar(state.distrito.distrito) : '';
    return Comparar.crearCandidato({
      lat: state.point.lat,
      lon: state.point.lon,
      etiqueta: state.etiqueta || (distrito ? `Punto en ${distrito}` : 'Punto elegido en el mapa'),
      distrito,
      zona: state.zonaStatus === 'ok' ? state.zona : null,
      entorno: state.entorno,
      cauce: state.cauce,
      contexto: state.contextoRiesgo,
    });
  }
  CompararUI.iniciar({ punto: () => state.point, candidatoActual, umbrales: () => state.umbrales });

  // ------------------------------------------------------------- Verificaciones antes de comprar
  // Lista estática de verificaciones.js: para agregar una basta con sumarla allí.
  const enlaceVerif = (e) => `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.texto)}<span class="sr-only"> (se abre en una pestaña nueva)</span></a>`;
  $('verif-lista').innerHTML = Verificaciones.ITEMS.map((it) => `<li>
      <span class="verif-marca" aria-hidden="true"></span>
      <div>
        <p class="verif-titulo">${esc(it.titulo)}</p>
        <p class="verif-entidad">${esc(it.entidad)}</p>
        <p>${esc(it.queConfirma)}</p>
        ${it.nota ? `<p class="small muted">${esc(it.nota)}</p>` : ''}
        ${it.enlaces.length ? `<p class="small">${it.enlaces.map(enlaceVerif).join(' · ')}</p>` : ''}
      </div>
    </li>`).join('');
  $('verif-calculado').innerHTML = Verificaciones.CALCULADO.map((c) => `<li><strong>${esc(c.titulo)}.</strong> ${esc(c.texto)}</li>`).join('');
  $('verif-aviso').textContent = Verificaciones.AVISO;

  // La guía (TourUI) la inicia EspacioUI: va después del Inicio.

  // Ayuda para verificar desde la consola del navegador (F12)
  window.osmDebug = { map, state, MODULOS, Calculos, Services, Zonificacion, Equipamiento, Peligros, Distritos, Riesgos, Delitos, Asistente, Entidades, Sectores, Capas, CapasUI, EspacioUI };
})();
