/**
 * asistente-ui.js — Vista de chat del asistente: panel, mensajes, menús para armar una búsqueda y marcadores en el mapa.
 *
 * Toda la lógica (entender el texto, responder, buscar zonas, armar la consulta desde los menús, explicar cada respuesta)
 * está en asistente.js. Aquí solo se conecta con la página: lee los mismos datos que la ficha (Zonificacion,
 * Equipamiento, Distritos) y dibuja los resultados en el mapa. Los menús desplegables producen la MISMA consulta que el
 * intérprete saca de una frase (Asistente.construirConsulta), así que hay un solo motor de decisión.
 * Nada de lo que se escribe sale del navegador y no se guarda: al recargar la página la conversación empieza de cero.
 */
const AsistenteUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_MENSAJES = 60;
  const NIVELES = ['inicial', 'primaria', 'secundaria'];

  let api = null; // { map, obtenerPunto, consultarPunto, umbrales }
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

  const bloqueLista = (titulo, items) => (items.length ? `<p class="chat-mas-t">${titulo}</p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');

  /** Apartado desplegable «Por qué, fuente y límites» (texto fijo de Asistente.explicar, más el detalle de una búsqueda). */
  function masHtml(explicacion, detalle = []) {
    if (!explicacion) return '';
    const porque = [...detalle.filter((l) => !/^Resultado referencial/.test(l)), ...explicacion.porque];
    const cuerpo = bloqueLista('Por qué', porque) + bloqueLista('Fuente', explicacion.fuente) + bloqueLista('Límites', explicacion.limites);
    return cuerpo ? `<details class="chat-mas"><summary>Por qué, fuente y límites</summary><div class="chat-mas-cuerpo">${cuerpo}</div></details>` : '';
  }

  function filaHtml(f, i) {
    const pct = Number.isFinite(f.pctCumpleTodo) ? `${Math.round(f.pctCumpleTodo)} % del suelo cumple todo` : '';
    const acciones = f.mejor
      ? `<div class="chat-acc">
          <button type="button" class="ghost" data-accion="ver" data-lat="${f.mejor.lat}" data-lon="${f.mejor.lon}" data-i="${i + 1}">Ver en el mapa</button>
          <button type="button" class="ghost" data-accion="consultar" data-lat="${f.mejor.lat}" data-lon="${f.mejor.lon}" data-nombre="${esc(f.titulo)}">Consultar ese punto</button>
        </div>`
      : '';
    return `<li class="chat-fila"><details class="chat-distrito"${i === 0 ? ' open' : ''}>
      <summary><span class="chat-fila-n" aria-hidden="true">${i + 1}</span><span class="chat-fila-t"><strong>${esc(f.titulo)}</strong>${pct ? `<span class="chat-fila-pct">${esc(pct)}</span>` : ''}</span></summary>
      <div class="chat-fila-cuerpo"><span class="chat-fila-det">${esc(f.detalle)}</span><small>${esc(f.nota)}</small>${acciones}</div>
    </details></li>`;
  }

  /** Agrega un mensaje al registro. Devuelve el elemento (para poder quitar el aviso de «buscando»). */
  function mensaje(rol, { texto, filas = [], sugerencias = [], espera = false, explicacion = null, detalle = [] }) {
    const log = $('asistente-log');
    const el = document.createElement('div');
    el.className = `chat-msg chat-${rol}`;
    if (espera) el.dataset.espera = 'true';
    const quien = rol === 'usuario' ? 'Tú: ' : 'Asistente: ';
    el.innerHTML = `<span class="sr-only">${quien}</span><div class="chat-burbuja">${rol === 'usuario' ? `<p>${esc(texto)}</p>` : textoAHtml(texto)}${filas.length ? `<ol class="chat-filas">${filas.map(filaHtml).join('')}</ol>` : ''}${masHtml(explicacion, detalle)}</div>`
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
    const umbral = api.umbrales ? api.umbrales().quebradaMinM : null; // «Mis umbrales»: cambia el estado de quebradas
    const clave = `${p.lat},${p.lon},${umbral}`;
    if (cacheContexto && cacheContexto.clave === clave) return cacheContexto.ctx;
    const [zona, entorno, dis, riesgo] = await Promise.all([
      Zonificacion.lookup(p.lat, p.lon).catch(() => null),
      Equipamiento.evaluar(p.lat, p.lon), // nunca rechaza: cada variable devuelve SIN DATO con su causa
      Distritos.lookup(p.lat, p.lon).catch(() => null),
      Contexto.evaluar(p.lat, p.lon, umbral), // quebradas, peligros y sismos: contexto informativo
    ]);
    const ctx = { ...base, punto: { lat: p.lat, lon: p.lon }, distrito: dis ? dis.distrito : null, zona, entorno, cauce: riesgo.quebradas, sismos: riesgo.sismos, peligros: riesgo.peligros };
    cacheContexto = { clave, ctx };
    return ctx;
  }

  // -------------------------------------------------------------------- Búsqueda

  /** Ordena los archivos congelados y el plano una sola vez; si falta equipamiento, no se puede buscar. */
  function preparar() {
    if (!preparado) {
      preparado = (async () => {
        const [zonas, congelados, cauces] = await Promise.all([Zonificacion.zonas(), Equipamiento.datosCongelados(), Distritos.load().catch(() => null), Contexto.cauces().catch(() => null)]);
        if (!congelados) throw new Error('Faltan los archivos de equipamiento de OpenStreetMap (public/data/equipamiento); sin ellos no puedo buscar zonas.');
        const datos = Asistente.prepararDatos({
          salud: congelados.salud.features, educacion: congelados.educacion.features, transporte: congelados.transporte.features, areasVerdes: congelados.areasVerdes.features,
          cauces: cauces ? cauces.lista : [],
        }, zonas, umbrales());
        return { zonas, datos, fecha: congelados.salud.fecha, hayCauces: Boolean(cauces) };
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
      mensaje('asistente', { texto: 'Con eso no quedó ningún criterio para buscar. Dime qué te importa, por ejemplo «cerca de un colegio y un parque».', sugerencias: Asistente.SUGERENCIAS_BASE, explicacion: Asistente.explicar('desconocido') });
      return;
    }
    // «Lejos de quebradas» solo vale con la distancia mínima de la persona: ninguna norma la fija, así que no se usa un valor por defecto.
    if (Asistente.criteriosSinUmbral(criterios).length > 0) {
      mensaje('asistente', {
        texto: 'Para buscar «lejos de quebradas» necesito la distancia mínima que tú quieras: no existe una distancia oficial. Dime, por ejemplo, «lejos de quebradas a más de 200 m», o elígela en el menú «Armar una búsqueda sin escribir».',
        sugerencias: ['Busco lejos de quebradas a más de 200 m', 'Busco lejos de quebradas a más de 500 m'],
        explicacion: Asistente.explicar('quebrada'),
      });
      return;
    }
    const punto = api.obtenerPunto();
    const limitar = Boolean(intencion.limitarAlPunto && punto);
    const radioGlobalM = limitar ? null : (intencion.radioGlobalM ?? (anterior ? anterior.radioGlobalM : null));
    const radioAreaM = limitar ? (intencion.radioGlobalM ?? CONFIG.asistente.radioAreaM) : null;
    const incluirCondicional = Boolean(intencion.incluirCondicional || (anterior && anterior.incluirCondicional));

    const espera = mensaje('asistente', { texto: 'Buscando zonas con los datos de la ficha…', espera: true });
    try {
      const { zonas, datos, fecha, hayCauces } = await preparar();
      if (!hayCauces && criterios.some((c) => c.id === 'lejosQuebrada')) {
        espera.remove();
        mensaje('asistente', { texto: 'No pude leer el archivo de quebradas de la ANA, así que no puedo buscar «lejos de quebradas» sin inventar datos. Prueba con los demás criterios.', explicacion: Asistente.explicar('quebrada') });
        return;
      }
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
      sincronizarFormulario(ultimaBusqueda);
      espera.remove();
      const filas = f.filas.map((fila) => ({ ...fila, mejor: (resultado.areas.find((a) => a.nombre === fila.distrito) || {}).mejor }));
      // Lo esencial queda a la vista; cómo se calculó y los avisos de método van en «Por qué, fuente y límites».
      mensaje('asistente', {
        texto: `${f.lineas.principal.join('\n')}\n${notas.join('\n')}`,
        filas,
        sugerencias: f.sugerencias,
        explicacion: Asistente.explicar('buscar', { fecha, aproximados, cauce: criterios.some((c) => c.id === 'lejosQuebrada') }),
        detalle: f.lineas.detalle,
      });
      dibujar(resultado.areas.slice(0, filas.length), resultado.criterios);
    } catch (err) {
      espera.remove();
      console.error('[Asistente] búsqueda', err);
      mensaje('asistente', { texto: `No pude hacer la búsqueda: ${err.message}` });
    }
  }

  // -------------------------------------------------------------------- Turnos

  function ocupar(si) {
    ocupado = si;
    $('asistente-enviar').disabled = si;
    $('cons-buscar').disabled = si;
  }

  async function enviar(texto) {
    const limpio = String(texto || '').trim();
    if (!limpio || ocupado) return;
    ocupar(true);
    mensaje('usuario', { texto: limpio });
    try {
      const intencion = Asistente.interpretar(limpio, { hayPunto: Boolean(api.obtenerPunto()), ultimaBusqueda });
      if (intencion.tipo === 'buscar') await ejecutarBusqueda(intencion);
      else {
        const ctx = ['ficha', 'servicio', 'zona', 'construir', 'quebrada', 'sismos', 'peligros'].includes(intencion.tipo) ? await contexto() : { estadoPDM: CONFIG.estadoPDM, potencial: Zonificacion.potencial, punto: api.obtenerPunto() };
        mensaje('asistente', { ...Asistente.responder(intencion, ctx), explicacion: Asistente.explicar(intencion.tipo) });
      }
    } catch (err) {
      console.error('[Asistente]', err);
      mensaje('asistente', { texto: 'Algo falló al responder. Intenta de nuevo; si sigue, recarga la página.' });
    } finally {
      ocupar(false);
    }
  }

  /** Una consulta armada con los menús: se muestra como frase y se ejecuta sin pasar por el intérprete. */
  async function enviarConsulta(consulta) {
    if (ocupado || consulta.tipo !== 'buscar') return;
    ocupar(true);
    mensaje('usuario', { texto: Asistente.textoDeConsulta(consulta) });
    try {
      await ejecutarBusqueda(consulta);
    } catch (err) {
      console.error('[Asistente]', err);
      mensaje('asistente', { texto: 'Algo falló al buscar. Intenta de nuevo; si sigue, recarga la página.' });
    } finally {
      ocupar(false);
    }
  }

  // --------------------------------------------------- Menús para armar la búsqueda

  const checks = () => [...document.querySelectorAll('#constructor-form input[name="cons-criterio"]')];
  const elegidos = () => checks().filter((c) => c.checked).map((c) => c.value);
  const etiquetaCorta = (id) => {
    if (id === 'lejosQuebrada') return 'Lejos de quebradas';
    const o = [...Asistente.OPCIONES.servicios, ...Asistente.OPCIONES.zonas].find((x) => x.id === id);
    return o ? o.etiqueta.split(' (')[0] : id;
  };
  const etiquetaRadio = (m) => (m === null ? 'Según la ficha (cada servicio con su distancia)' : m < 1000 ? `${m} m` : `${String(m / 1000).replace('.', ',')} km`);

  function leerFormulario() {
    const prio = $('cons-prio').value;
    return {
      lejosQuebradaM: $('cons-cauce').value ? Number($('cons-cauce').value) : null,
      cercaDeMiPunto: $('cons-punto').checked && !$('cons-punto').disabled,
      criterios: elegidos(),
      prioridades: prio ? [prio] : [],
      nivel: $('cons-nivel').value,
      radioM: $('cons-radio').value ? Number($('cons-radio').value) : null,
      incluirCondicional: $('cons-cond').checked,
    };
  }

  /** Mantiene al día lo que depende de lo elegido: el resumen del desplegable, el nivel educativo y las opciones de prioridad. */
  function actualizarFormulario() {
    const ids = elegidos();
    const nombres = ids.map(etiquetaCorta);
    $('cons-que-n').textContent = nombres.length === 0 ? 'Elige uno o más' : nombres.length <= 2 ? nombres.join(', ') : `${nombres.slice(0, 2).join(', ')} y ${nombres.length - 2} más`;
    $('cons-nivel-campo').hidden = !ids.includes('colegio');
    const prevista = $('cons-prio').value;
    const conCauce = $('cons-cauce').value ? [...ids, 'lejosQuebrada'] : ids;
    $('cons-prio').innerHTML = `<option value="">Ninguna</option>${conCauce.map((id) => `<option value="${id}">${esc(etiquetaCorta(id))}</option>`).join('')}`;
    $('cons-prio').value = conCauce.includes(prevista) ? prevista : '';
    $('cons-error').hidden = true;
    actualizarPunto();
  }

  /**
   * «Solo cerca de mi punto» solo se puede elegir con un punto en el mapa. Con la casilla marcada, la distancia máxima pasa a
   * ser el radio del área alrededor del punto: se dice en la etiqueta y en la ayuda.
   */
  function actualizarPunto() {
    const hay = Boolean(api && api.obtenerPunto());
    const c = $('cons-punto');
    c.disabled = !hay;
    if (!hay) c.checked = false;
    const cerca = c.checked;
    $('cons-radio-l').textContent = cerca ? 'Radio alrededor de mi punto' : 'Distancia máxima';
    $('cons-punto-ayuda').textContent = !hay
      ? 'Disponible cuando eliges un punto en el mapa.'
      : cerca
        ? `Solo miro celdas dentro de ese radio (${Asistente.fmtDist(CONFIG.asistente.radioAreaM)} si no eliges uno). Los servicios se miden con la distancia de cada uno en la ficha.`
        : 'Limita la búsqueda a lo que rodea el punto que elegiste.';
  }

  /** Pone en los menús lo que se buscó (también cuando se pidió escribiendo: «agrega transporte», «prioriza el parque»…). */
  function sincronizarFormulario(b) {
    if (!b || !$('constructor-form')) return;
    const esColegio = (id) => id === 'colegio' || NIVELES.includes(id);
    const ids = new Set(b.criterios.map((c) => (esColegio(c.id) ? 'colegio' : c.id)));
    ids.delete('lejosQuebrada'); // no es una casilla: se elige con su propia distancia
    checks().forEach((c) => { c.checked = ids.has(c.value); });
    const nivel = b.criterios.find((c) => esColegio(c.id));
    $('cons-nivel').value = nivel && nivel.id !== 'colegio' ? nivel.id : 'colegio';
    actualizarFormulario();
    const lejos = b.criterios.find((c) => c.id === 'lejosQuebrada');
    $('cons-cauce').value = lejos && Asistente.OPCIONES.cauces.includes(lejos.umbralM) ? String(lejos.umbralM) : '';
    actualizarFormulario();
    const prio = b.criterios.find((c) => c.prioridad > 1);
    $('cons-prio').value = prio ? (esColegio(prio.id) ? 'colegio' : prio.id) : '';
    const radio = Asistente.OPCIONES.radios.includes(b.radioGlobalM) ? String(b.radioGlobalM ?? '') : '';
    $('cons-radio').value = radio;
    $('cons-cond').checked = Boolean(b.incluirCondicional);
  }

  function limpiarFormulario() {
    checks().forEach((c) => { c.checked = false; });
    $('cons-nivel').value = 'colegio';
    $('cons-radio').value = '';
    $('cons-cauce').value = '';
    $('cons-punto').checked = false;
    $('cons-cond').checked = false;
    actualizarFormulario();
  }

  function cerrarMulti({ devolverFoco = false } = {}) {
    const m = $('cons-que');
    if (!m.open) return;
    m.open = false;
    if (devolverFoco) m.querySelector('summary').focus();
  }

  function iniciarConstructor() {
    const casilla = (o) => `<label class="check multi-op"><input type="checkbox" name="cons-criterio" value="${o.id}"><span>${esc(o.etiqueta)}</span></label>`;
    $('cons-servicios').innerHTML = Asistente.OPCIONES.servicios.map(casilla).join('');
    $('cons-zonas').innerHTML = Asistente.OPCIONES.zonas.map(casilla).join('');
    $('cons-nivel').innerHTML = Asistente.OPCIONES.niveles.map((n) => `<option value="${n.id}">${esc(n.etiqueta)}</option>`).join('');
    $('cons-radio').innerHTML = Asistente.OPCIONES.radios.map((m) => `<option value="${m ?? ''}">${esc(etiquetaRadio(m))}</option>`).join('');
    $('cons-cauce').innerHTML = Asistente.OPCIONES.cauces.map((m) => `<option value="${m ?? ''}">${m === null ? 'No me importa' : `A más de ${m < 1000 ? `${m} m` : '1 km'}`}</option>`).join('');
    $('presets').innerHTML = Asistente.PRESETS.map((p) => `<button type="button" class="ghost" data-preset="${p.id}">${esc(p.etiqueta)}</button>`).join('');
    actualizarFormulario();

    const form = $('constructor-form');
    form.addEventListener('change', actualizarFormulario);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = Asistente.construirConsulta(leerFormulario());
      if (q.tipo !== 'buscar') {
        $('cons-error').textContent = 'Elige al menos un servicio, un tipo de zona o una distancia a quebradas para buscar.';
        $('cons-error').hidden = false;
        $('cons-que').open = true;
        $('cons-que').querySelector('summary').focus();
        return;
      }
      $('constructor').open = false;
      $('constructor').querySelector('summary').focus();
      enviarConsulta(q);
    });
    $('cons-limpiar').addEventListener('click', limpiarFormulario);
    $('presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]');
      const preset = b && Asistente.PRESETS.find((p) => p.id === b.dataset.preset);
      if (!preset) return;
      const q = Asistente.construirConsulta(preset.consulta);
      sincronizarFormulario({ criterios: q.criterios, radioGlobalM: q.radioGlobalM, incluirCondicional: q.incluirCondicional });
      $('constructor').open = false;
      enviarConsulta(q);
    });

    // El desplegable de varias opciones se cierra con Escape (sin cerrar todo el asistente) y al tocar fuera.
    $('cons-que').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('cons-que').open) { e.stopPropagation(); cerrarMulti({ devolverFoco: true }); }
    });
    $('cons-que').addEventListener('toggle', () => {
      $('cons-que').querySelector('summary').setAttribute('aria-expanded', String($('cons-que').open));
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#cons-que')) cerrarMulti(); });
  }

  // ----------------------------------------------------------------- Abrir y cerrar

  function abrir() {
    const panel = $('asistente');
    panel.hidden = false;
    $('asistente-btn').setAttribute('aria-expanded', 'true');
    if (esMovil()) $('app').inert = true; // en el móvil el chat cubre toda la pantalla: el teclado no debe llegar a lo que queda detrás
    if (!saludado) {
      saludado = true;
      mensaje('asistente', { ...Asistente.responder({ tipo: 'saludo', criterios: [] }, {}), explicacion: Asistente.explicar('saludo') }); // trae sus sugerencias
    }
    actualizarPunto(); // el punto pudo cambiar desde la última vez
    $('asistente-texto').focus();
  }

  function cerrar({ devolverFoco = true } = {}) {
    $('asistente').hidden = true;
    $('app').inert = false;
    $('asistente-btn').setAttribute('aria-expanded', 'false');
    if (devolverFoco) $('asistente-btn').focus();
  }

  function iniciar(opciones) {
    api = opciones;
    capaMapa = L.layerGroup().addTo(api.map);
    iniciarConstructor();

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
