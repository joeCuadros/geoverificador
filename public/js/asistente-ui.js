/**
 * asistente-ui.js — Vista de chat del asistente: panel, mensajes, botones y marcadores en el mapa.
 *
 * Toda la lógica (entender el texto, responder, buscar zonas) está en asistente.js. Aquí solo se conecta con la página:
 * lee los mismos datos que la ficha (Zonificacion, Equipamiento, Distritos) y dibuja los resultados en el mapa.
 * Nada de lo que se escribe sale del navegador y no se guarda: al recargar la página la conversación empieza de cero.
 */
const AsistenteUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_MENSAJES = 60;

  let api = null; // { map, obtenerPunto, consultarPunto }
  let ultimaBusqueda = null; // { criterios, radioGlobalM, incluirCondicional } para «agrega…», «quita…», «prioriza…»
  let capaMapa = null;
  let preparado = null; // promesa con los datos ya ordenados para buscar
  let cacheContexto = null; // { clave, ctx } del último punto consultado
  let ocupado = false;
  let saludado = false;

  const cacheCeldas = new Map(); // la cuadrícula no depende de los criterios: se arma una vez por tipo de zona
  const celdasDe = (zonas, condicional) => {
    const k = condicional ? 'con' : 'sin';
    if (!cacheCeldas.has(k)) cacheCeldas.set(k, Asistente.generarCeldas(zonas, { pasoM: CONFIG.asistente.pasoCeldaM, incluirCondicional: condicional }));
    return cacheCeldas.get(k);
  };

  const esMovil = () => window.matchMedia('(max-width: 899px)').matches;
  const umbrales = () => ({ ...CONFIG.umbrales, zona: CONFIG.asistente.umbralesZona });
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ Mensajes

  /** Texto con saltos de línea a párrafos; las líneas que empiezan con «• » forman una lista. */
  function textoAHtml(texto) {
    const out = [];
    let lista = [];
    const cerrar = () => { if (lista.length) { out.push(`<ul>${lista.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`); lista = []; } };
    String(texto).split('\n').forEach((l) => {
      if (l.startsWith('• ')) lista.push(l.slice(2));
      else { cerrar(); if (l.trim()) out.push(`<p>${esc(l)}</p>`); }
    });
    cerrar();
    return out.join('');
  }

  function filaHtml(f, i) {
    const acciones = f.mejor
      ? `<div class="chat-acc">
          <button type="button" class="ghost" data-accion="ver" data-lat="${f.mejor.lat}" data-lon="${f.mejor.lon}" data-i="${i + 1}">Ver en el mapa</button>
          <button type="button" class="ghost" data-accion="consultar" data-lat="${f.mejor.lat}" data-lon="${f.mejor.lon}" data-nombre="${esc(f.titulo)}">Consultar ese punto</button>
        </div>`
      : '';
    return `<li class="chat-fila"><span class="chat-fila-n" aria-hidden="true">${i + 1}</span>
      <div><strong>${esc(f.titulo)}</strong><span class="chat-fila-det">${esc(f.detalle)}</span><small>${esc(f.nota)}</small>${acciones}</div></li>`;
  }

  /** Agrega un mensaje al registro. Devuelve el elemento (para poder quitar el aviso de «buscando»). */
  function mensaje(rol, { texto, filas = [], sugerencias = [], espera = false }) {
    const log = $('asistente-log');
    const el = document.createElement('div');
    el.className = `chat-msg chat-${rol}`;
    if (espera) el.dataset.espera = 'true';
    const quien = rol === 'usuario' ? 'Tú: ' : 'Asistente: ';
    el.innerHTML = `<span class="sr-only">${quien}</span><div class="chat-burbuja">${rol === 'usuario' ? `<p>${esc(texto)}</p>` : textoAHtml(texto)}${filas.length ? `<ol class="chat-filas">${filas.map(filaHtml).join('')}</ol>` : ''}</div>`
      + (sugerencias.length ? `<div class="chat-sug" role="group" aria-label="Sugerencias">${sugerencias.map((s) => `<button type="button" class="ghost" data-accion="sugerir" data-texto="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : '');
    log.appendChild(el);
    while (log.children.length > MAX_MENSAJES) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  // ------------------------------------------------------------------- Contexto

  /** Lo ya calculado del punto elegido. Se calcula aquí aunque la persona aún no haya abierto el reporte. */
  async function contexto() {
    const base = { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial };
    const p = api.obtenerPunto();
    if (!p) return { ...base, punto: null };
    const clave = `${p.lat},${p.lon}`;
    if (cacheContexto && cacheContexto.clave === clave) return cacheContexto.ctx;
    const [zona, entorno, dis] = await Promise.all([
      Zonificacion.lookup(p.lat, p.lon).catch(() => null),
      Equipamiento.evaluar(p.lat, p.lon), // nunca rechaza: cada variable devuelve SIN DATO con su causa
      Distritos.lookup(p.lat, p.lon).catch(() => null),
    ]);
    const ctx = { ...base, punto: { lat: p.lat, lon: p.lon }, distrito: dis ? dis.distrito : null, zona, entorno };
    cacheContexto = { clave, ctx };
    return ctx;
  }

  // -------------------------------------------------------------------- Búsqueda

  /** Ordena los archivos congelados y el plano una sola vez; si falta equipamiento, no se puede buscar. */
  function preparar() {
    if (!preparado) {
      preparado = (async () => {
        const [zonas, congelados] = await Promise.all([Zonificacion.zonas(), Equipamiento.datosCongelados(), Distritos.load().catch(() => null)]);
        if (!congelados) throw new Error('Faltan los archivos de equipamiento de OpenStreetMap (public/data/equipamiento); sin ellos no puedo buscar zonas.');
        const datos = Asistente.prepararDatos({
          salud: congelados.salud.features, educacion: congelados.educacion.features, transporte: congelados.transporte.features, areasVerdes: congelados.areasVerdes.features,
        }, zonas, umbrales());
        return { zonas, datos, fecha: congelados.salud.fecha };
      })().catch((err) => { preparado = null; throw err; });
    }
    return preparado;
  }

  function dibujar(areas, criterios) {
    capaMapa.clearLayers();
    const puntos = areas.filter((a) => a.mejor);
    puntos.forEach((a, i) => {
      const icono = L.divIcon({ className: 'chat-marcador', html: `<span>${i + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const lineas = criterios.map((c) => {
        const d = a.mejor.detalle[c.id];
        return `${esc(Asistente.CRITERIOS[c.id].etiqueta.split(' (')[0])}: ${d.cumple ? 'cumple' : 'no cumple'}${d.distanciaM !== null ? ` (${esc(Asistente.fmtDist(d.distanciaM))})` : ''}`;
      });
      L.marker([a.mejor.lat, a.mejor.lon], { icon: icono, title: `${i + 1}. ${Asistente.titulo(a.nombre)}`, keyboard: false })
        .bindPopup(`<strong>${i + 1}. ${esc(Asistente.titulo(a.nombre))}</strong><br>Zona ${esc(a.mejor.zona)}<br>${lineas.join('<br>')}`)
        .addTo(capaMapa);
    });
    if (puntos.length) api.map.fitBounds(L.latLngBounds(puntos.map((a) => [a.mejor.lat, a.mejor.lon])).pad(0.3), { maxZoom: 14, animate: false });
  }

  async function ejecutarBusqueda(intencion) {
    const anterior = intencion.modo !== 'nuevo' ? ultimaBusqueda : null;
    const criterios = intencion.modo === 'nuevo' ? intencion.criterios : Asistente.combinarBusqueda(anterior, intencion);
    if (criterios.length === 0) {
      mensaje('asistente', { texto: 'Con eso no quedó ningún criterio para buscar. Dime qué te importa, por ejemplo «cerca de un colegio y un parque».', sugerencias: Asistente.SUGERENCIAS_BASE });
      return;
    }
    const punto = api.obtenerPunto();
    const limitar = Boolean(intencion.limitarAlPunto && punto);
    const radioGlobalM = limitar ? null : (intencion.radioGlobalM ?? (anterior ? anterior.radioGlobalM : null));
    const radioAreaM = limitar ? (intencion.radioGlobalM ?? CONFIG.asistente.radioAreaM) : null;
    const incluirCondicional = Boolean(intencion.incluirCondicional || (anterior && anterior.incluirCondicional));

    const espera = mensaje('asistente', { texto: 'Buscando zonas con los datos de la ficha…', espera: true });
    try {
      const { zonas, datos, fecha } = await preparar();
      await pausa(30); // deja pintar el aviso antes del cálculo
      const resultado = Asistente.buscar({
        criterios, zonas, datos, umbrales: umbrales(), distritoDe: (la, lo) => Distritos.nombreDe(la, lo),
        pasoM: CONFIG.asistente.pasoCeldaM, minCeldas: CONFIG.asistente.minCeldasArea, maxPuntos: CONFIG.asistente.maxPuntos, separacionM: CONFIG.asistente.separacionPuntosM,
        centro: limitar ? punto : null, radioM: radioAreaM, incluirCondicional, radioGlobalM, celdas: celdasDe(zonas, incluirCondicional),
      });
      const aproximados = criterios.map((c) => c.id).filter((id) => Asistente.CRITERIOS[id].aproximado);
      const f = Asistente.formatearBusqueda(resultado, { aproximados, temaNoSoportado: intencion.temaNoSoportado, radioGlobalM });
      const notas = [];
      if (limitar) notas.push(`Solo miré celdas a ${Asistente.fmtDist(radioAreaM)} o menos de tu punto.`);
      else if (intencion.limitarAlPunto) notas.push('Todavía no elegiste un punto, así que busqué en toda la ciudad.');
      if (incluirCondicional) notas.push('Incluí zonas condicionadas, donde lo que se puede construir depende de la zona vecina o de un plan específico.');
      notas.push(`Datos de OpenStreetMap del ${fecha || 'sin fecha'}. Distancias en línea recta.`);

      ultimaBusqueda = { criterios, radioGlobalM, incluirCondicional };
      espera.remove();
      const filas = f.filas.map((fila) => ({ ...fila, mejor: (resultado.areas.find((a) => a.nombre === fila.distrito) || {}).mejor }));
      mensaje('asistente', { texto: `${f.texto}\n${notas.join('\n')}`, filas, sugerencias: f.sugerencias });
      dibujar(resultado.areas.slice(0, filas.length), resultado.criterios);
    } catch (err) {
      espera.remove();
      console.error('[Asistente] búsqueda', err);
      mensaje('asistente', { texto: `No pude hacer la búsqueda: ${err.message}` });
    }
  }

  // -------------------------------------------------------------------- Turnos

  async function enviar(texto) {
    const limpio = String(texto || '').trim();
    if (!limpio || ocupado) return;
    ocupado = true;
    $('asistente-enviar').disabled = true;
    mensaje('usuario', { texto: limpio });
    try {
      const intencion = Asistente.interpretar(limpio, { hayPunto: Boolean(api.obtenerPunto()), ultimaBusqueda });
      if (intencion.tipo === 'buscar') await ejecutarBusqueda(intencion);
      else {
        const ctx = ['ficha', 'servicio', 'zona', 'construir'].includes(intencion.tipo) ? await contexto() : { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial, punto: api.obtenerPunto() };
        mensaje('asistente', Asistente.responder(intencion, ctx));
      }
    } catch (err) {
      console.error('[Asistente]', err);
      mensaje('asistente', { texto: 'Algo falló al responder. Intenta de nuevo; si sigue, recarga la página.' });
    } finally {
      ocupado = false;
      $('asistente-enviar').disabled = false;
    }
  }

  // ----------------------------------------------------------------- Abrir y cerrar

  function abrir() {
    const panel = $('asistente');
    panel.hidden = false;
    $('asistente-btn').setAttribute('aria-expanded', 'true');
    if (!saludado) {
      saludado = true;
      mensaje('asistente', Asistente.responder({ tipo: 'saludo', criterios: [] }, {})); // trae sus sugerencias
    }
    $('asistente-texto').focus();
  }

  function cerrar({ devolverFoco = true } = {}) {
    $('asistente').hidden = true;
    $('asistente-btn').setAttribute('aria-expanded', 'false');
    if (devolverFoco) $('asistente-btn').focus();
  }

  function iniciar(opciones) {
    api = opciones;
    capaMapa = L.layerGroup().addTo(api.map);

    $('asistente-btn').addEventListener('click', () => { if ($('asistente').hidden) abrir(); else cerrar(); });
    $('asistente-cerrar').addEventListener('click', () => cerrar());
    $('asistente').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } });

    $('asistente-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const campo = $('asistente-texto');
      const t = campo.value;
      campo.value = '';
      enviar(t);
      campo.focus();
    });

    // Un solo oyente para los botones de los mensajes (sugerencias, «Ver en el mapa» y «Consultar ese punto»).
    $('asistente-log').addEventListener('click', (e) => {
      const b = e.target.closest('[data-accion]');
      if (!b) return;
      const { accion } = b.dataset;
      if (accion === 'sugerir') { enviar(b.dataset.texto); return; }
      const lat = Number(b.dataset.lat);
      const lon = Number(b.dataset.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (accion === 'ver') {
        api.map.setView([lat, lon], 15, { animate: false });
        if (esMovil()) cerrar({ devolverFoco: false }); // en el móvil el chat tapa el mapa
      } else if (accion === 'consultar') {
        api.consultarPunto(lat, lon, b.dataset.nombre ? `Mejor punto en ${b.dataset.nombre}` : null);
        if (esMovil()) cerrar({ devolverFoco: false });
      }
    });
  }

  return { iniciar, abrir, cerrar };
})();
