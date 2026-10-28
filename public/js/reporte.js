/**
 * reporte.js — Ficha del predio en PDF.
 *
 * Arma un informe legible con los mismos datos que muestra la aplicación (sin calcular nada nuevo) y abre el diálogo
 * de impresión del navegador, donde se elige «Guardar como PDF». Así no hace falta ninguna librería: el diseño del
 * informe está en las reglas @media print de styles.css.
 *
 * Incluye las 5 variables del alcance: zonificación vigente, zonificación proyectada, salud, educación, transporte y
 * área verde. Los módulos fuera de alcance (peligros, zona sísmica, denuncias, registro de riesgos) solo aparecen si
 * están activos (`d.modulos`, ver CONFIG.modulos y ?modulos=todos); con los módulos ocultos el informe no los menciona.
 *
 * Recibe un objeto `d` con lo que ya calculó app.js (ver app.js, datosReporte).
 */
const Reporte = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(n).toLocaleString('es-PE');
  const dist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`);
  const coma = (n) => String(n).replace('.', ',');
  const fila = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const NIVELES = ['inicial', 'primaria', 'secundaria'];
  const nombreNivel = (n) => n[0].toUpperCase() + n.slice(1);

  function seccion(titulo, color, cuerpo, fuente) {
    return `
      <section class="rp-sec" style="--rp-c:${color}">
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
  const ESTADO_CLS = { CUMPLE: 'rp-bajo', 'SIN DATO': 'rp-medio', 'NO CUMPLE': 'rp-alto' };
  const estado = (e) => `<span class="rp-niv ${ESTADO_CLS[e]}">${esc(e)}</span>`;
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
    // Secciones numeradas en orden: primero las 5 variables, luego los módulos activos.
    const secciones = [
      ['Zonificación vigente y proyectada', '#4f46e5', zonificacion(d), d.fuentes.zonificacion],
      ['Salud', '#c2410c', salud(d), d.variables ? fuenteDe(d.variables.salud) : ''],
      ['Educación por nivel', '#7c3aed', educacion(d), d.variables ? fuenteDe(d.variables.educacion.inicial) : ''],
      ['Transporte', '#1d4ed8', transporte(d), d.variables ? fuenteDe(d.variables.transporte) : ''],
      ['Área verde', '#15803d', areaVerde(d), d.variables ? fuenteDe(d.variables.areaVerde) : ''],
    ];
    if (m.desastre) secciones.push(['Desastre', '#ea580c', desastre(d), [m.desastre.mostrarPeligro ? d.fuentes.peligros : '', m.desastre.mostrarSismica ? d.fuentes.distritos : ''].filter(Boolean).join('; ')]);
    if (m.seguridad) secciones.push(['Seguridad', '#dc2626', seguridad(d), d.fuentes.delitos]);
    if (m.riesgos) secciones.push(['Registro de riesgos', '#0f766e', registro(d), '']);

    const limites = [
      'La zonificación vigente es la del PDM 2016-2025, cuya vigencia de 10 años se cumplió; hay un PDM nuevo en trámite y una sentencia (183-2019) que suspendió ciertos actos para predios antes agrícolas o de reserva paisajista. La zonificación proyectada no se muestra: solo se advierte su estado, con la fuente indicada.',
      'Los polígonos de la zonificación se extrajeron de un PDF: cerca del borde entre dos zonas el resultado puede no ser exacto (por eso se avisa cuando otra zona queda a 20 m o menos).',
      'Salud, educación, transporte y área verde salen de OpenStreetMap, un mapa colaborativo: algo ausente puede existir. Los datos se extrajeron una vez (fecha indicada en cada sección) y no se actualizan solos.',
      'Todas las distancias son en línea recta, no recorrido a pie. Los umbrales de salud (1000 m), transporte (400 m) y borde de zona (20 m) son convenciones del proyecto; los de educación vienen del Instructivo FTE del MEF/MINEDU y el de área verde, de la OMS Europa (2016).',
      'OpenStreetMap casi no etiqueta el nivel de los colegios: un colegio sin nivel se toma como candidato a primaria y secundaria, lo que puede sobrestimar la oferta de un nivel.',
    ];
    if (m.desastre) limites.push('Los peligros geológicos son un inventario de eventos documentados, no un mapa de susceptibilidad. La zona sísmica es regional y no considera el suelo del predio. No se evalúa el peligro volcánico (Misti).');
    if (m.seguridad) limites.push('Las denuncias no son todos los delitos y solo se cuentan las que tienen ubicación.');
    limites.push('Metodología, fuentes y validaciones completas: docs/METODOLOGIA.md y docs/VALIDACION.md del proyecto.');

    const datos = ['MPA/IMPLA (zonificación)', '© colaboradores de OpenStreetMap (ODbL)'];
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
        <table class="rp-tabla">${d.resumen.map(([k, v]) => fila(k, esc(v))).join('')}</table>
      </section>

      ${secciones.map(([t, color, cuerpo, fuente], i) => seccion(`${i + 1}. ${t}`, color, cuerpo, fuente)).join('')}

      <section class="rp-sec rp-limites">
        <h2>Limitaciones principales</h2>
        <ul>${limites.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </section>
      <footer class="rp-pie">GeoVerificador · datos: ${datos.join(', ')}.</footer>`;

    // El título del documento es el nombre de archivo que propone «Guardar como PDF».
    const tituloOriginal = document.title;
    document.title = `ficha-predio_${d.punto.lat.toFixed(5)}_${d.punto.lon.toFixed(5)}`;
    const restaurar = () => { document.title = tituloOriginal; window.removeEventListener('afterprint', restaurar); };
    window.addEventListener('afterprint', restaurar);
    window.print();
  }

  return { imprimir };
})();
