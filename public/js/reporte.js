/**
 * reporte.js — Ficha del predio en PDF.
 *
 * Arma un informe legible con los mismos datos que muestra la aplicación (sin calcular nada nuevo) y abre el diálogo
 * de impresión del navegador, donde se elige «Guardar como PDF». Así no hace falta ninguna librería: el diseño del
 * informe está en las reglas @media print de styles.css.
 *
 * Incluye las variables del alcance: zonificación vigente, zonificación proyectada, salud, educación, transporte y
 * área verde, más quebradas y cauces (INFORMATIVO, o cumple / no cumple «según tu umbral» si la persona fijó el suyo), el
 * contexto de riesgo (peligros geológicos y sismos, siempre informativo), el precio de oferta por m² del distrito (informativo) y las verificaciones recomendadas antes de comprar
 * (lo que la herramienta calculó frente a lo que la persona debe comprobar; las URL se imprimen como texto). Los módulos fuera de alcance (peligros, zona sísmica, denuncias, registro de riesgos) solo aparecen si
 * están activos (`d.modulos`, ver CONFIG.modulos y ?modulos=todos); con los módulos ocultos el informe no los menciona.
 *
 * Recibe un objeto `d` con lo que ya calculó app.js (ver app.js, datosReporte). Las funciones que arman el HTML de cada
 * sección son puras (no tocan el DOM) y se prueban en test/reporte.spec.ts; solo `imprimir` usa document y window.
 */
const Reporte = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(n).toLocaleString('es-PE');
  const dist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`);
  const coma = (n) => String(n).replace('.', ',');
  const fila = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const P = typeof Precios !== 'undefined' ? Precios : require('./precios.js'); // eslint-disable-line no-undef
  const NIVELES = ['inicial', 'primaria', 'secundaria'];
  const nombreNivel = (n) => n[0].toUpperCase() + n.slice(1);

  function seccion(titulo, color, cuerpo, fuente) {
    return `
      <section class="rp-sec${titulo.includes('Verificaciones') ? ' rp-largo' : ''}" style="--rp-c:${color}">
        <h2>${esc(titulo)}</h2>
        ${cuerpo}
        ${fuente ? `<p class="rp-fuente">Fuente: ${esc(fuente)}</p>` : ''}
      </section>`;
  }

  // ------------------------------------------------------------ V1a y V1b: zonificación
  function zonificacion(d) {
    let html = '';
    if (d.zonaStatus === 'outside') html += '<p>El punto está <strong>fuera del área zonificada</strong> del plano: no tiene zona asignada.</p>';
    else if (d.zonaStatus !== 'ok') html += '<p class="rp-muted">No se pudo consultar la zonificación.</p>';
    else {
      const z = d.zona;
      const r = z.regla || {};
      const b = z.borde;
      if (b && b.alerta) {
        html += `<p class="rp-alerta">Punto cerca del borde de la zona: a ${dist(b.distanciaM)} en línea recta hay otra zona (${esc(b.codigo)}). Cerca de un borde el resultado puede no ser exacto; confirma la zona con el certificado municipal (aviso a ${b.umbralM} m o menos, convención del proyecto).</p>`;
      }
      const filas = [
        fila('Zona', `<strong>${esc(z.codigo)}</strong> · ${esc(r.nombre || 'código sin reglas en la tabla')}`),
        fila('Condición', esc(d.badgeZona || '—')),
      ];
      const has = (v) => v !== null && v !== undefined && v !== '';
      const bm = (a, b2) => (has(b2) && b2 !== a ? `${a} (hasta ${b2})` : `${a}`);
      if (has(r.pisos_base)) filas.push(fila('Pisos', esc(bm(r.pisos_base, r.pisos_max))));
      if (has(r.coef_base)) filas.push(fila('Coeficiente de edificación', esc(bm(r.coef_base, r.coef_max))));
      if (has(r.area_libre_pct)) filas.push(fila('Área libre mínima', `${esc(r.area_libre_pct)} %`));
      if (has(r.lote_min_m2)) filas.push(fila('Lote mínimo', `${num(r.lote_min_m2)} m²`));
      if (has(r.frente_min_m)) filas.push(fila('Frente mínimo', `${esc(r.frente_min_m)} m`));
      let calc = '';
      if (d.lote && d.potencial) {
        const [b0, m] = d.potencial.construible;
        calc = `<p class="rp-destacado">Con un lote de ${num(d.lote)} m²: <strong>hasta ${num(b0)} m² techados</strong>${m > b0 ? ` (${num(m)} m² en el caso máximo)` : ''}${d.potencial.ocupable ? `; el primer piso puede ocupar ${d.potencial.ocupable[0] === d.potencial.ocupable[1] ? `hasta ${num(d.potencial.ocupable[1])}` : `entre ${num(d.potencial.ocupable[0])} y ${num(d.potencial.ocupable[1])}`} m²` : ''}.${d.potencial.bajoLoteMinimo ? ' El lote es menor que el mínimo de la zona.' : ''}</p>`;
      } else if (d.lote) {
        calc = '<p class="rp-muted">No se calculan m² construibles: la zona no fija un coeficiente o no es construible.</p>';
      }
      html += `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">Parámetros del Reglamento del PDM Arequipa 2016-2025, Título III${r.articulo ? ` (${esc(r.articulo)})` : ''}.</p>${r.nota ? `<p class="rp-nota">${esc(r.nota)}</p>` : ''}${calc}`;
    }
    // V1b: solo texto, y solo si hay fuente y fecha (d.avisoPDM es null en caso contrario).
    if (d.avisoPDM) {
      const a = d.avisoPDM;
      html += `<p class="rp-destacado"><strong>Zonificación proyectada (PDM nuevo).</strong> ${esc(a.texto)} <span class="rp-muted">Fuente: ${esc(a.fuente)}, ${esc(a.fecha)}${a.url ? ` · ${esc(a.url)}` : ''}. Nota de prensa, no un documento oficial.</span></p>`;
    }
    return html;
  }

  // ------------------------------------------------------- V2 a V5: servicios
  const ESTADO_CLS = { CUMPLE: 'rp-bajo', 'SIN DATO': 'rp-medio', 'NO CUMPLE': 'rp-alto', INFORMATIVO: 'rp-info' };
  const estado = (e) => `<span class="rp-niv ${ESTADO_CLS[e] || 'rp-medio'}">${esc(e)}</span>`;
  const estadoHtml = estado;
  const fuenteDe = (r) => `${r.fuente}${r.fecha ? `, datos extraídos el ${r.fecha}` : ''}`;
  const sinResultado = '<p class="rp-muted">No se calcularon los servicios cercanos.</p>';

  function filasDe(r, fuenteUmbral) {
    if (r.error) return [fila('Resultado', `No se pudo obtener el dato: ${esc(r.error)}`)];
    const f = [fila('Estado', estado(r.estado))];
    if (r.nombre) f.push(fila('Más cercano', esc(r.nombre)));
    f.push(fila('Distancia', r.distanciaM === null ? 'Sin dato' : r.distanciaM === 0 ? 'El punto está dentro del área' : `${dist(r.distanciaM)} en línea recta`));
    f.push(fila('Umbral', `${dist(r.umbralM)} (${esc(fuenteUmbral)})`));
    return f;
  }

  function salud(d) {
    const r = d.variables && d.variables.salud;
    if (!r) return sinResultado;
    return `<table class="rp-tabla">${filasDe(r, d.fuentesUmbral.salud).join('')}</table><p class="rp-nota">${esc(r.metodo)}</p>`;
  }

  function educacion(d) {
    const e = d.variables && d.variables.educacion;
    if (!e) return sinResultado;
    const filas = NIVELES.flatMap((n) => {
      const r = e[n];
      if (r.error) return [fila(nombreNivel(n), `No se pudo obtener el dato: ${esc(r.error)}`)];
      const det = r.nombre ? `${esc(r.nombre)} · ${r.distanciaM === null ? 'sin distancia' : `${dist(r.distanciaM)} en línea recta`} · umbral ${dist(r.umbralM)}` : `Sin dato · umbral ${dist(r.umbralM)}`;
      return [fila(nombreNivel(n), `${estado(r.estado)} ${det}`)];
    });
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Umbrales: ${esc(d.fuentesUmbral.educacion)}. OpenStreetMap casi no etiqueta el nivel de los colegios: uno sin nivel se toma como candidato a primaria y secundaria; los jardines (amenity=kindergarten) cuentan como inicial.</p>`;
  }

  function transporte(d) {
    const r = d.variables && d.variables.transporte;
    if (!r) return sinResultado;
    return `<table class="rp-tabla">${filasDe(r, d.fuentesUmbral.transporte).join('')}</table><p class="rp-nota">${esc(r.metodo)}</p>`;
  }

  function areaVerde(d) {
    const r = d.variables && d.variables.areaVerde;
    if (!r) return sinResultado;
    const u = d.umbrales.areaVerde;
    const filas = filasDe(r, d.fuentesUmbral.areaVerde);
    if (!r.error && r.estado !== 'SIN DATO') {
      if (r.areaM2) filas.splice(3, 0, fila('Superficie', `${num(r.areaM2)} m² (${(r.areaM2 / 10000).toFixed(2).replace('.', ',')} ha)`));
      filas.push(fila('Criterio más estricto (≥ 1 ha)', r.cumple1ha ? `También hay una a ${dist(r.distancia1haM)} (${esc(r.nombre1ha)})` : `Ninguna de al menos ${num(u.areaGrandeM2)} m² a ${u.distanciaM} m o menos`));
    }
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">Criterio: un área verde de al menos ${num(u.areaMinM2)} m² a ${u.distanciaM} m o menos. ${esc(r.metodo)}</p>`;
  }

  // ------------------------------------------------ Quebradas y cauces (ANA)
  const QUEBRADAS_CITADAS = ['Añashuayco', 'San Lázaro']; // las que citan los informes de INGEMMET (docs/INVESTIGACION-VARIABLES.md)
  const sinTildes = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function seccionQuebradas(d) {
    const q = d.cauce;
    if (!q) return '<p class="rp-muted">No se calcularon las quebradas y los cauces cercanos.</p>';
    if (q.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Estado', estado('SIN DATO'))}${fila('Resultado', `No se pudo obtener el dato${q.error ? `: ${esc(q.error)}` : ''}`)}</table>
        <p class="rp-nota">Que no haya dato no significa que no haya una quebrada cerca: consulta SIGRID (CENEPRED) y al IMPLA.</p>`;
    }
    const nombres = q.nombres || [];
    const ausentes = QUEBRADAS_CITADAS.filter((n) => !nombres.some((x) => sinTildes(x).includes(sinTildes(n))));
    const filas = [
      fila('Estado', estado(q.estado) + (q.segunUmbralUsuario ? ' <span class="rp-muted">según tu umbral</span>' : '')),
      fila('Cauce más cercano', `${esc(q.nombre)}${q.tipo ? ` (${esc(String(q.tipo).toLowerCase())})` : ''}`),
      fila('Distancia', `${dist(q.distanciaM)} en línea recta`),
      fila('Umbral', q.segunUmbralUsuario ? `Según tu umbral: al menos ${dist(q.umbralM)} de un cauce (es tu criterio, no una norma)` : 'Sin umbral normativo: no existe una distancia oficial a una quebrada, así que el dato es solo informativo'),
    ];
    const cubre = `La red hidrográfica de la ANA es de escala nacional${q.elaboracion ? ` (elaboración: ${esc(q.elaboracion)})` : ''}: no incluye todas las quebradas urbanas${ausentes.length ? ` (en el archivo no figura${ausentes.length > 1 ? 'n' : ''} ${ausentes.join(' ni ')}, que citan los informes de INGEMMET)` : ''}. La red no es un mapa de peligro de huaicos ni de inundación y no delimita la faja marginal. La distancia es a la línea del mapa, no al cauce real.`;
    return `<table class="rp-tabla">${filas.join('')}</table><p class="rp-nota">${cubre}</p>${q.metodo ? `<p class="rp-nota">${esc(q.metodo)}</p>` : ''}`;
  }

  // ------------------------------------------ Contexto de riesgo (informativo)
  const NO_CALCULADO = '<p class="rp-muted">No se calculó el contexto de riesgo.</p>';

  function bloquePeligros(p) {
    if (!p || p.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Peligros geológicos registrados', `${estado('SIN DATO')} ${p && p.error ? esc(p.error) : ''}`)}</table>`;
    }
    const m = p.masCercano;
    const filas = [
      fila(`Peligros geológicos registrados a ${num(p.radioM)} m o menos`, `${estado('INFORMATIVO')} <strong>${num(p.total)}</strong>${p.porTipo && p.porTipo.length ? ` (${p.porTipo.map(([tp, n]) => `${esc(tp)} ${n}`).join(', ')})` : ''}`),
    ];
    if (m) filas.push(fila('Registro más cercano', `${dist(p.distanciaM)} en línea recta · ${esc(m.subtipo || m.tipo)}${m.sector ? ` · «${esc(m.sector)}»` : ''}${m.anio ? ` · ${esc(m.anio)}` : ''}`));
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Es un inventario de eventos documentados (${esc(p.anioDesde)}–${esc(p.anioHasta)}, ${num(p.registros)} registros en Arequipa metropolitana), no un mapa de susceptibilidad: que no haya registros cerca no significa que el lugar sea seguro. Datos congelados el ${esc(p.fecha || 'sin fecha')}.</p>`;
  }

  function bloqueSismos(s) {
    if (!s || s.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Sismos reportados', `${estado('SIN DATO')} ${s && s.error ? esc(s.error) : ''}`)}</table>`;
    }
    const km = coma(s.radioM / 1000);
    const filas = [
      fila(`Sismos reportados a ${km} km o menos (en línea recta)`, `${estado('INFORMATIVO')} <strong>${num(s.total)}</strong>`),
      fila('Periodo que cubre', `${esc(s.desde)} a ${esc(s.hasta)}`),
    ];
    if (s.magnitudMaxima !== null && s.magnitudMaxima !== undefined) filas.push(fila('Magnitud máxima', coma(s.magnitudMaxima)));
    if (s.masReciente) filas.push(fila('Más reciente', esc(s.masReciente)));
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Es actividad reciente reportada por el IGP en el periodo indicado: no predice sismos ni mide el peligro del lugar, y un conteo bajo no dice nada de otros periodos. Para construir, la referencia normativa es la zona sísmica de la Norma E.030, que depende del distrito, y el Estudio de Mecánica de Suelos. El radio es una convención del proyecto. Datos congelados el ${esc(s.fecha || 'sin fecha')}.</p>`;
  }

  function seccionContexto(d) {
    const c = d.contextoRiesgo;
    if (!c) return NO_CALCULADO;
    return `<p class="rp-nota">Datos de contexto, no una evaluación de peligro: no hay umbral que diga si un lugar es seguro. Que algo no aparezca aquí no significa que el lugar esté libre de riesgo.</p>${bloquePeligros(c.peligros)}${bloqueSismos(c.sismos)}`;
  }

  // ------------------------------- Precio de oferta del distrito (Aptología, CC BY 4.0)
  const QUE_NO_CUBRE_PRECIO = 'Son precios pedidos en avisos de venta, no de cierre ni una tasación. Es la mediana del distrito, no el precio de este inmueble: una vivienda concreta puede costar mucho más o menos según su estado, tamaño, piso y ubicación exacta. Solo cubre departamentos y los distritos con al menos 30 avisos; no hay cifra para casas ni terrenos. Refleja un periodo corto, así que no muestra tendencia.';

  function seccionPrecio(d) {
    const p = d.precio;
    if (!p) return '<p class="rp-muted">No se calculó el precio de oferta del distrito.</p>';
    if (p.estado === 'SIN DATO') {
      return `<table class="rp-tabla">${fila('Precio de oferta por m² del distrito', `${estado('SIN DATO')} ${esc(p.causa || '')}`)}</table>
        <p class="rp-nota">${esc(QUE_NO_CUBRE_PRECIO)}</p>`;
    }
    const filas = [
      fila('Precio de oferta por m² (venta)', `${estado('INFORMATIVO')} <strong>${esc(P.formatearSoles(p.precioM2.venta))}</strong> por m², mediana de ${num(p.nAvisos.venta)} avisos de departamentos en ${esc(p.distrito)}`),
      fila('Periodo de los datos', esc(P.textoPeriodo(p.periodo))),
    ];
    if (p.arriendoMensual !== null && p.arriendoMensual !== undefined) filas.push(fila('Arriendo mensual (mediana)', `${esc(P.formatearSoles(p.arriendoMensual))} por mes, sin administración ni gastos comunes (${num(p.nAvisos.arriendo ?? 0)} avisos)`));
    filas.push(fila('Atribución', `${esc(p.atribucion)}${p.url ? ` (${esc(p.url)})` : ''} · licencia ${esc(p.licencia)}`));
    return `<table class="rp-tabla">${filas.join('')}</table>
      <p class="rp-nota">Informativo: es lo que piden los vendedores en el distrito, no el valor de este inmueble. No dice si un precio es caro o barato y no entra en ningún puntaje. ${esc(QUE_NO_CUBRE_PRECIO)} Datos congelados el ${esc(p.fechaDescarga || 'sin fecha')}. Valores redondeados a soles enteros.</p>`;
  }

  // ------------------------------- Verificaciones recomendadas antes de comprar
  // En papel no se puede hacer clic: las URL se imprimen como texto, sin enlaces.
  function seccionVerificaciones(d) {
    const v = d.verificaciones;
    if (!v) return '';
    const calc = (v.calculado || []).map((c) => `<li><strong>${esc(c.titulo)}.</strong> ${esc(c.texto)}</li>`).join('');
    const items = (v.items || []).map((it) => `<li class="rp-verif">
        <span class="rp-caja" aria-hidden="true">☐</span>
        <div>
          <strong>${esc(it.titulo)}</strong>
          <div class="rp-muted">${esc(it.entidad)}</div>
          <div>${esc(it.queConfirma)}</div>
          ${it.nota ? `<div class="rp-muted">${esc(it.nota)}</div>` : ''}
          ${(it.enlaces || []).length ? `<div class="rp-url">${it.enlaces.map((e) => `${esc(e.texto)}: ${esc(e.url)}`).join(' · ')}</div>` : ''}
        </div>
      </li>`).join('');
    return `<div class="rp-grupo">
        <h3>Lo que GeoVerificador ya calculó <span class="rp-etiqueta">Referencial</span></h3>
        <ul>${calc}</ul>
      </div>
      <div class="rp-grupo rp-grupo-fuerte">
        <h3>Lo que debes comprobar tú <span class="rp-etiqueta">Fuera de esta herramienta</span></h3>
        <ul class="rp-verifs">${items}</ul>
      </div>
      <p class="rp-nota">${esc(v.aviso || '')}</p>`;
  }

  // ------------------------------------------------------------ Resumen, secciones y límites
  /** Filas que se suman al resumen: quebradas y contexto (solo si ya se calcularon). */
  function filasResumenExtra(d) {
    const out = [];
    const q = d.cauce;
    if (q) {
      let v;
      if (q.estado === 'SIN DATO') v = 'SIN DATO';
      else {
        v = `${q.estado} · ${q.nombre} a ${dist(q.distanciaM)} en línea recta`;
        v += q.segunUmbralUsuario ? ` (según tu umbral de ${dist(q.umbralM)})` : ' (sin umbral normativo)';
      }
      out.push(['Quebradas y cauces', v]);
    }
    const c = d.contextoRiesgo;
    if (c) {
      const p = c.peligros;
      out.push(['Peligros geológicos registrados (contexto)', !p || p.estado === 'SIN DATO' ? 'SIN DATO' : `INFORMATIVO · ${num(p.total)} a ${num(p.radioM)} m o menos${p.masCercano ? `; el más cercano a ${dist(p.distanciaM)} en línea recta` : ''}`]);
      const s = c.sismos;
      out.push(['Sismos recientes (contexto)', !s || s.estado === 'SIN DATO' ? 'SIN DATO' : `INFORMATIVO · ${num(s.total)} a ${coma(s.radioM / 1000)} km o menos entre el ${s.desde} y el ${s.hasta}${s.magnitudMaxima !== null && s.magnitudMaxima !== undefined ? `; magnitud máxima ${coma(s.magnitudMaxima)}` : ''}`]);
    }
    const pr = d.precio;
    if (pr) out.push(['Precio de oferta del distrito (informativo)', pr.estado === 'INFORMATIVO' ? `INFORMATIVO · ${P.formatearSoles(pr.precioM2.venta)} por m² (mediana de ${num(pr.nAvisos.venta)} avisos en ${pr.distrito}; oferta, no cierre; ${P.textoPeriodo(pr.periodo)})` : 'SIN DATO']);
    return out;
  }

  const fuenteCauce = (q) => (q ? `${q.fuente}${q.fecha ? `, datos extraídos el ${q.fecha}` : ''}` : '');
  const fuenteContexto = (c) => (c ? [c.peligros && c.peligros.fuente, c.sismos && c.sismos.fuente].filter(Boolean).join('; ') : '');

  const fuentePrecio = (p) => (p && p.estado === 'INFORMATIVO' ? `${p.atribucion} — ${p.fuente}, licencia ${p.licencia}, descargado el ${p.fechaDescarga}` : '');

  /** Las secciones del informe en orden: [{ titulo, color, cuerpo, fuente }]. */
  function construirSecciones(d) {
    const m = d.modulos || {};
    const lista = [
      ['Zonificación vigente y proyectada', '#4f46e5', zonificacion(d), d.fuentes.zonificacion],
      ['Salud', '#c2410c', salud(d), d.variables ? fuenteDe(d.variables.salud) : ''],
      ['Educación por nivel', '#7c3aed', educacion(d), d.variables ? fuenteDe(d.variables.educacion.inicial) : ''],
      ['Transporte', '#1d4ed8', transporte(d), d.variables ? fuenteDe(d.variables.transporte) : ''],
      ['Área verde', '#15803d', areaVerde(d), d.variables ? fuenteDe(d.variables.areaVerde) : ''],
      ['Quebradas y cauces', '#0369a1', seccionQuebradas(d), fuenteCauce(d.cauce)],
      ['Contexto de riesgo (informativo)', '#64748b', seccionContexto(d), fuenteContexto(d.contextoRiesgo)],
      ['Precio de oferta del distrito (informativo)', '#a16207', seccionPrecio(d), fuentePrecio(d.precio)],
    ];
    if (m.desastre) lista.push(['Desastre', '#ea580c', desastre(d), [m.desastre.mostrarPeligro ? d.fuentes.peligros : '', m.desastre.mostrarSismica ? d.fuentes.distritos : ''].filter(Boolean).join('; ')]);
    if (m.seguridad) lista.push(['Seguridad', '#dc2626', seguridad(d), d.fuentes.delitos]);
    if (m.riesgos) lista.push(['Registro de riesgos', '#0f766e', registro(d), '']);
    if (d.verificaciones) lista.push(['Verificaciones recomendadas antes de comprar', '#334155', seccionVerificaciones(d), '']);
    return lista.map(([titulo, color, cuerpo, fuente]) => ({ titulo, color, cuerpo, fuente }));
  }

  /** Limitaciones principales del informe. */
  function limites(d) {
    const m = d.modulos || {};
    const l = [
      'La zonificación vigente es la del PDM 2016-2025, cuya vigencia de 10 años se cumplió; hay un PDM nuevo en trámite y una sentencia (183-2019) que suspendió ciertos actos para predios antes agrícolas o de reserva paisajista. La zonificación proyectada no se muestra: solo se advierte su estado, con la fuente indicada.',
      'Los polígonos de la zonificación se extrajeron de un PDF: cerca del borde entre dos zonas el resultado puede no ser exacto (por eso se avisa cuando otra zona queda a 20 m o menos).',
      'Salud, educación, transporte y área verde salen de OpenStreetMap, un mapa colaborativo: algo ausente puede existir. Los datos se extrajeron una vez (fecha indicada en cada sección) y no se actualizan solos.',
      'Todas las distancias son en línea recta, no recorrido a pie. Los umbrales de salud (1000 m), transporte (400 m) y borde de zona (20 m) son convenciones del proyecto; los de educación vienen del Instructivo FTE del MEF/MINEDU y el de área verde, de la OMS Europa (2016).',
      'OpenStreetMap casi no etiqueta el nivel de los colegios: un colegio sin nivel se toma como candidato a primaria y secundaria, lo que puede sobrestimar la oferta de un nivel.',
      'Quebradas y cauces: no existe una distancia normativa a una quebrada, así que el estado es INFORMATIVO salvo que la persona fije su propio umbral («según tu umbral»). La red de la ANA es de escala nacional: no incluye todas las quebradas urbanas, no es un mapa de peligro y no delimita la faja marginal.',
      'El contexto de riesgo (peligros geológicos de INGEMMET y sismos reportados por el IGP en el periodo indicado) es informativo: no es una evaluación, no predice sismos y que no haya registros no significa que el lugar sea seguro.',
      'El precio de oferta por m² del distrito (Aptología, CC BY 4.0) es informativo: son precios pedidos en avisos, no de cierre, y es la mediana del distrito, no el precio de este inmueble. Solo hay cifra en los distritos con al menos 30 avisos.',
    ];
    if (m.desastre) l.push('Los peligros geológicos son un inventario de eventos documentados, no un mapa de susceptibilidad. La zona sísmica es regional y no considera el suelo del predio. No se evalúa el peligro volcánico (Misti).');
    if (m.seguridad) l.push('Las denuncias no son todos los delitos y solo se cuentan las que tienen ubicación.');
    l.push('Metodología, fuentes y validaciones completas: docs/METODOLOGIA.md y docs/VALIDACION.md del proyecto.');
    return l;
  }

  // ------------------------------------------- Módulos fuera de alcance (solo si están activos)
  function desastre(d) {
    const m = d.modulos.desastre;
    let html = '';
    if (m.mostrarPeligro && m.zonaRiesgo) html += `<p class="rp-alerta">El plano de zonificación ubica el punto en zona de riesgo muy alto (${esc(d.zona.codigo)}).</p>`;
    if (m.mostrarPeligro) {
      if (m.peligro) {
        const p = m.peligro;
        const masCercano = p.masCercano;
        html += `<table class="rp-tabla">
        ${fila(`Peligros geológicos registrados a ${p.radio} m`, `<strong>${num(p.total)}</strong>${p.porTipo.length ? ` (${p.porTipo.map(([t, n]) => `${esc(t)} ${n}`).join(', ')})` : ''}`)}
        ${fila('Registro más cercano', `${dist(masCercano.distancia)} · ${esc(masCercano.subtipo || masCercano.tipo)}${masCercano.sector ? ` · «${esc(masCercano.sector)}»` : ''}${masCercano.anio ? ` · ${esc(masCercano.anio)}` : ''}`)}
      </table>
      <p class="rp-nota">Es un inventario de eventos documentados (${esc(p.meta.anioDesde)}–${esc(p.meta.anioHasta)}): que no haya registros no significa que el lugar sea seguro.</p>`;
      } else html += '<p class="rp-muted">No se pudo consultar el inventario de peligros.</p>';
    }
    if (m.mostrarSismica && m.distrito) {
      html += `<table class="rp-tabla">${fila('Zona sísmica (Norma E.030 2026)', `<strong>Zona ${esc(m.distrito.zona)} · Z = ${coma(m.distrito.z)}</strong> (distrito de ${esc(d.distritoNombre)})`)}</table>
      <p class="rp-nota">Z: aceleración máxima horizontal en suelo rígido con 10 % de probabilidad de ser excedida en 50 años, como fracción de la gravedad. No considera el suelo del predio.</p>`;
    }
    return html;
  }

  function seguridad(d) {
    const m = d.modulos.seguridad;
    if (!m.delito) return '<p class="rp-muted">No se pudo calcular el indicador de denuncias.</p>';
    const { total, ROBO, HURTO } = m.delito.conteo;
    return `<table class="rp-tabla">
      ${fila(`Denuncias de robo y hurto a ${m.delito.radio} m`, `<strong>${num(total)}</strong> (${num(ROBO)} robos, ${num(HURTO)} hurtos)`)}
      ${fila('Periodo', `${m.delito.meta.meses} meses (${esc(m.periodo)}); ${Math.round(m.delito.meta.coberturaVentana * 100)} % de las denuncias del periodo trae ubicación`)}
    </table>
    <p class="rp-nota">Son denuncias con ubicación, no todos los delitos. Robo: con violencia o amenaza; hurto: sin violencia.</p>`;
  }

  function matriz(riesgos, ev, nivel) {
    const nombres = ['Baja', 'Media', 'Alta'];
    let celdas = '';
    for (let p = 3; p >= 1; p--) {
      celdas += `<div class="rp-my">${nombres[p - 1]}</div>`;
      for (let i = 1; i <= 3; i++) {
        const n = nivel(p, i);
        const ids = riesgos.filter((r) => ev[r.id]?.p === p && ev[r.id]?.i === i).map((r) => r.id).join(' ');
        celdas += `<div class="rp-celda rp-${n.texto.toLowerCase()}">${esc(ids)}</div>`;
      }
    }
    return `<div class="rp-matriz"><div class="rp-mtit">Probabilidad ↑ · Impacto →</div>${celdas}<div></div>${nombres.map((t) => `<div class="rp-mx">${t}</div>`).join('')}</div>`;
  }

  function registro(d) {
    const { riesgos, evaluacion: ev, nivel, escala, decisiones } = d.modulos.riesgos;
    if (!riesgos.length) return '<p class="rp-muted">No se identificaron riesgos con los datos disponibles.</p>';
    const txt = (v) => escala.find((x) => x.v === v)?.texto || '—';
    const evaluados = riesgos.filter((r) => nivel(ev[r.id]?.p, ev[r.id]?.i)).length;
    const filas = riesgos.map((r) => {
      const e = ev[r.id] || {};
      const n = nivel(e.p, e.i);
      return `<tr>
        <td class="rp-id">${r.id}</td>
        <td><strong>${esc(r.titulo)}</strong><div class="rp-ev">${esc(r.evidencia)}</div></td>
        <td class="rp-c">${txt(e.p)}</td><td class="rp-c">${txt(e.i)}</td>
        <td class="rp-c">${n ? `<span class="rp-niv rp-${n.texto.toLowerCase()}">${n.texto}</span>` : '<span class="rp-muted">Sin evaluar</span>'}</td>
        <td>${e.decision != null ? esc(decisiones[e.decision].split(' (')[0]) : '—'}</td>
      </tr>
      <tr class="rp-acc"><td></td><td colspan="5">${r.acciones.map((a, k) => `${(e.hechas || []).includes(k) ? '☑' : '☐'} ${esc(a.texto)} <span class="rp-muted">(${esc(a.fuente)})</span>`).join('<br>')}</td></tr>`;
    }).join('');
    return `
      <p>${riesgos.length} riesgos identificados a partir de los datos · ${evaluados} evaluados por el usuario. La probabilidad, el impacto y la decisión son del usuario; la herramienta no los asigna.</p>
      ${evaluados ? matriz(riesgos, ev, nivel) : ''}
      <table class="rp-reg">
        <thead><tr><th>Id</th><th>Riesgo y evidencia</th><th>Prob.</th><th>Impacto</th><th>Nivel</th><th>Decisión</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <p class="rp-nota">Nivel = probabilidad × impacto (1–3 cada uno): 1–2 bajo, 3–4 medio, 6–9 alto. Convención del proyecto, no una norma.</p>`;
  }

  /** Construye el informe dentro de `contenedor` y abre el diálogo de impresión. */
  function imprimir(contenedor, d) {
    const m = d.modulos || {};
    const secciones = construirSecciones(d);
    const resumen = [...d.resumen, ...filasResumenExtra(d)];

    const datos = ['MPA/IMPLA (zonificación)', '© colaboradores de OpenStreetMap (ODbL)', 'ANA (red hidrográfica)', 'INGEMMET (peligros geológicos)', 'IGP (sismos reportados)', 'Datos: Aptologia (precio de oferta, CC BY 4.0)'];
    if (m.desastre) datos.push('INGEMMET (GEOCATMIN), INEI, MVCS (E.030)');
    if (m.seguridad) datos.push('MININTER (SIDPOL)');

    contenedor.innerHTML = `
      <header class="rp-head">
        <div>
          <div class="rp-marca">GeoVerificador</div>
          <h1>Ficha del predio</h1>
          <p class="rp-sub">${esc(d.distritoTitulo)} · ${d.punto.lat.toFixed(6)}, ${d.punto.lon.toFixed(6)}</p>
        </div>
        <div class="rp-fecha">Generado el ${esc(d.fecha)}</div>
      </header>
      <p class="rp-aviso">Ficha informativa con datos públicos. No es una recomendación de compra ni reemplaza los certificados municipales. Las distancias son en línea recta.</p>

      <section class="rp-sec rp-resumen">
        <h2>Resumen</h2>
        <table class="rp-tabla">${resumen.map(([k, v]) => fila(k, esc(v))).join('')}</table>
      </section>

      ${secciones.map((s, i) => seccion(`${i + 1}. ${s.titulo}`, s.color, s.cuerpo, s.fuente)).join('')}

      <section class="rp-sec rp-limites">
        <h2>Limitaciones principales</h2>
        <ul>${limites(d).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </section>
      <footer class="rp-pie">GeoVerificador · datos: ${datos.join(', ')}.</footer>`;

    // El título del documento es el nombre de archivo que propone «Guardar como PDF».
    const tituloOriginal = document.title;
    document.title = `ficha-predio_${d.punto.lat.toFixed(5)}_${d.punto.lon.toFixed(5)}`;
    const restaurar = () => { document.title = tituloOriginal; window.removeEventListener('afterprint', restaurar); };
    window.addEventListener('afterprint', restaurar);
    window.print();
  }

  return { imprimir, seccionQuebradas, seccionContexto, seccionPrecio, seccionVerificaciones, filasResumenExtra, construirSecciones, limites, estadoHtml };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Reporte;
