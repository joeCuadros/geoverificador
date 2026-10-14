/**
 * riesgos.js — Gestión de riesgos del predio: registro de riesgos (identificación → análisis → tratamiento → seguimiento).
 *
 * Reparto del trabajo (para no inventar datos):
 *   - IDENTIFICAR lo hace la herramienta: cada riesgo del catálogo tiene una regla que se activa con un dato concreto
 *     (zona del plano, peligros registrados, zona sísmica, denuncias) y muestra ese dato como evidencia, con su fuente.
 *   - ANALIZAR (probabilidad e impacto) lo hace el usuario: no hay datos que permitan asignarlos por él, así que la
 *     herramienta no precarga ningún valor. El nivel solo aparece cuando el usuario elige ambos.
 *   - TRATAR: la herramienta propone acciones que son trámites o normas oficiales verificables (con su fuente);
 *     el usuario elige la decisión y marca las acciones que ya hizo (SEGUIMIENTO).
 *   - REGISTRAR: el registro se descarga como CSV con evidencias, fuentes, evaluación y decisiones.
 *
 * El catálogo, las reglas y sus fuentes están documentados en docs/METODOLOGIA.md (Gestión de riesgos).
 */
const Riesgos = (() => {
  // ------------------------------------------------------------------ Fuentes citadas por el catálogo
  const F = {
    reglamento: 'Reglamento del PDM Arequipa 2016-2025, Título III (data/reglas_zonas.json)',
    vigencia: 'Reglamento del PDM, Título Preliminar, numeral 5 «Vigencia»; Municipalidad Provincial de Arequipa: consulta del PDM nuevo (13/10/2025 al 11/12/2025)',
    sentencia: 'Sentencia de Vista N.° 183-2019 (Primera Sala Penal de Apelaciones, CSJ Arequipa), según su transcripción en una presentación del Colegio de Arquitectos del Perú',
    ingemmet: 'Inventario de peligros geológicos, GEOCATMIN (INGEMMET)',
    e030: 'Norma Técnica E.030 Diseño Sismorresistente 2026 (MVCS): Art. 10, Art. 11 y Tabla N.° 1, Anexo II',
    inei: 'Límites distritales (GEOCATMIN, límites remitidos por el INEI)',
    sidpol: 'Mapa del Delito Georreferenciado (MININTER), datos SIDPOL de la PNP',
    ley29090: 'Ley N.° 29090 (Ley de Regulación de Habilitaciones Urbanas y de Edificaciones), art. 14 de su TUO, según fuentes secundarias; confirmar requisitos y vigencia en el TUPA de la municipalidad',
    e030art: 'Norma E.030 2026, Art. 4 (cumplimiento obligatorio en el diseño de edificaciones nuevas) y Art. 16.1 (EMS o ITS conforme a la Norma E.050)',
    cenepred: 'CENEPRED, Manual para la Evaluación de Riesgos originados por Fenómenos Naturales, 2.ª versión, aprobada por la Resolución N.° 112-2014-CENEPRED',
    sigrid: 'SIGRID del CENEPRED (sigrid.cenepred.gob.pe)',
    misti: 'Mapa de peligros del volcán Misti (INGEMMET); la Municipalidad Provincial lo adoptó como documento de gestión mediante la Ordenanza 658-MPA, según informes del INGEMMET y del CENEPRED (no se leyó el texto de la ordenanza)',
  };

  // Acciones de tratamiento reutilizadas (cada una con su fuente).
  const A = {
    certificados: {
      texto: 'Pedir el Certificado de Parámetros Urbanísticos y Edificatorios a la municipalidad distrital (requisito de la licencia de edificación de un predio urbano) o, si el predio es rústico y se va a habilitar, el Certificado de Zonificación y Vías a la municipalidad provincial.',
      fuente: F.ley29090,
    },
    impla: {
      texto: 'Consultar al IMPLA qué zonificación aplica hoy al predio, dado que el PDM 2016-2025 cumplió su vigencia y hay un plan nuevo en trámite.',
      fuente: F.vigencia,
    },
    evar: {
      texto: 'Encargar o consultar una evaluación de riesgo del sector según el manual del CENEPRED antes de invertir.',
      fuente: F.cenepred,
    },
    sigrid: {
      texto: 'Revisar los estudios y mapas de peligro del sector publicados en el SIGRID del CENEPRED.',
      fuente: F.sigrid,
    },
    e030: {
      texto: 'Diseñar la edificación según la Norma E.030 (obligatoria para edificaciones nuevas) con la zona sísmica del distrito.',
      fuente: F.e030art,
    },
    ems: {
      texto: 'Contar con Estudio de Mecánica de Suelos (EMS) o Informe Técnico de Suelos (ITS), que la E.030 exige a todo proyecto de edificación; determina el tipo de suelo del predio.',
      fuente: F.e030art,
    },
    misti: {
      texto: 'Ubicar el predio en el mapa de peligros del volcán Misti del INGEMMET.',
      fuente: F.misti,
    },
    seguridad: {
      texto: 'No hay un trámite oficial asociado. Comparar el punto con el resto de la ciudad en el mapa de calor y decidir medidas según el proyecto (recomendación práctica de esta herramienta, no una norma).',
      fuente: 'Recomendación práctica de GeoVerificador',
    },
  };

  const fmt = (n) => Math.round(n).toLocaleString('es-PE');

  /**
   * Catálogo. `aplica(ctx)` devuelve null si el riesgo no se identifica para el punto, o { evidencia } con el dato
   * que lo activa. ctx = { zonaStatus, zona, lote, peligro, distrito, delito } (ver app.js, contextoRiesgos).
   */
  const CATALOGO = [
    {
      id: 'N1', categoria: 'Normativo', titulo: 'La zona no permite construir', fuente: F.reglamento,
      aplica: (c) => (c.zona?.regla?.edificable === 'no' ? { evidencia: `Zona ${c.zona.codigo} (${c.zona.regla.nombre}): ${c.zona.regla.nota || 'no edificable según el Reglamento'}.` } : null),
      acciones: [A.certificados],
    },
    {
      id: 'N2', categoria: 'Normativo', titulo: 'Los parámetros de construcción no están fijados en el plano', fuente: F.reglamento,
      aplica: (c) => (c.zona?.regla?.edificable === 'condicionado' ? { evidencia: `Zona ${c.zona.codigo} (${c.zona.regla.nombre}): ${c.zona.regla.nota || 'depende de un plan específico o de la zona del entorno'}.` } : null),
      acciones: [A.certificados],
    },
    {
      id: 'N3', categoria: 'Normativo', titulo: 'El lote es menor que el mínimo de la zona', fuente: F.reglamento,
      aplica: (c) => {
        const min = c.zona?.regla?.lote_min_m2;
        return typeof min === 'number' && c.lote > 0 && c.lote < min ? { evidencia: `Lote de ${fmt(c.lote)} m² frente a un mínimo de ${fmt(min)} m² en la zona ${c.zona.codigo}.` } : null;
      },
      acciones: [A.certificados],
    },
    {
      id: 'N4', categoria: 'Normativo', titulo: 'La altura permitida depende del ancho de la vía', fuente: F.reglamento,
      aplica: (c) => (c.zona?.regla?.grupo === 'comercial' ? { evidencia: `Zona ${c.zona.codigo}: ${c.zona.regla.nota}. La herramienta no conoce el ancho de la vía.` } : null),
      acciones: [A.certificados],
    },
    {
      id: 'N5', categoria: 'Normativo', titulo: 'El plan usado cumplió su vigencia y hay uno nuevo en trámite', fuente: F.vigencia,
      aplica: (c) => (c.zonaStatus === 'ok' || c.zonaStatus === 'outside' ? { evidencia: 'El Reglamento fija la vigencia del PDM 2016-2025 en 10 años; la Municipalidad sometió a consulta un PDM nuevo entre octubre y diciembre de 2025.' } : null),
      acciones: [A.impla, A.certificados],
    },
    {
      id: 'N6', categoria: 'Normativo', titulo: 'Posible suspensión judicial si el predio era agrícola o de reserva paisajista', fuente: F.sentencia,
      aplica: (c) => (c.zonaStatus === 'ok' ? { evidencia: 'La Sentencia de Vista 183-2019 suspendió certificados de zonificación y vías y planes específicos en predios que en el PDM 2002-2015 eran zona agrícola o reserva paisajista. La herramienta no sabe la zonificación anterior del predio ni si la suspensión sigue vigente.' } : null),
      acciones: [A.impla],
    },
    {
      id: 'N7', categoria: 'Normativo', titulo: 'El plano no asigna zona a este punto', fuente: F.reglamento,
      aplica: (c) => (c.zonaStatus === 'outside' ? { evidencia: 'El punto está fuera del área zonificada del plano de 2016.' } : null),
      acciones: [A.impla, A.certificados],
    },
    {
      id: 'D1', categoria: 'Desastre', titulo: 'El plano marca la zona como de riesgo muy alto', fuente: F.reglamento,
      aplica: (c) => (c.zona?.regla?.grupo === 'riesgo' ? { evidencia: `Zona ${c.zona.codigo} (${c.zona.regla.nombre}): ${c.zona.regla.nota}.` } : null),
      acciones: [A.evar, A.certificados],
    },
    {
      id: 'D2', categoria: 'Desastre', titulo: 'Hay peligros geológicos documentados cerca', fuente: F.ingemmet,
      aplica: (c) => (c.peligro && c.peligro.total > 0
        ? { evidencia: `${c.peligro.total} registro(s) a ${c.peligro.radio} m: ${c.peligro.porTipo.map(([t, n]) => `${t} ${n}`).join(', ')}. El más cercano está a ${fmt(c.peligro.masCercano.distancia)} m.` }
        : null),
      acciones: [A.sigrid, A.evar],
    },
    {
      id: 'D3', categoria: 'Desastre', titulo: 'Peligro sísmico de la zona', fuente: `${F.e030}; ${F.inei}`,
      aplica: (c) => (c.distrito && c.distrito.zona
        ? { evidencia: `Distrito ${c.distrito.distrito}: zona sísmica ${c.distrito.zona}, Z = ${String(c.distrito.z).replace('.', ',')} (aceleración máxima horizontal en suelo rígido con 10 % de probabilidad de ser excedida en 50 años, como fracción de la gravedad). No considera el suelo del predio.` }
        : null),
      acciones: [A.ems, A.e030],
    },
    {
      id: 'D4', categoria: 'Desastre', titulo: 'Peligro volcánico (Misti) no evaluado por esta herramienta', fuente: F.misti,
      aplica: (c) => (c.distrito ? { evidencia: 'La ficha no incorpora el mapa de peligros del volcán Misti; el riesgo queda sin evaluar.' } : null),
      acciones: [A.misti],
    },
    {
      id: 'S1', categoria: 'Seguridad', titulo: 'Robos y hurtos denunciados en el entorno', fuente: F.sidpol,
      aplica: (c) => (c.delito && c.delito.conteo.total > 0
        ? { evidencia: `${fmt(c.delito.conteo.total)} denuncias con ubicación a ${c.delito.radio} m en ${c.delito.meta.meses} meses (${fmt(c.delito.conteo.ROBO)} robos, ${fmt(c.delito.conteo.HURTO)} hurtos). Son denuncias, no todos los delitos.` }
        : null),
      acciones: [A.seguridad],
    },
  ];

  // ------------------------------------------------------------------ Análisis: matriz cualitativa 3 × 3
  // Convención del proyecto (no sale de una norma): nivel = probabilidad × impacto con escalas 1-3;
  // 1-2 Bajo, 3-4 Medio, 6-9 Alto. Se aplica solo a valores que eligió el usuario.
  const ESCALA = [
    { v: 1, texto: 'Baja' },
    { v: 2, texto: 'Media' },
    { v: 3, texto: 'Alta' },
  ];
  function nivel(p, i) {
    if (!p || !i) return null;
    const s = p * i;
    if (s <= 2) return { texto: 'Bajo', cls: 'ok', puntaje: s };
    if (s <= 4) return { texto: 'Medio', cls: 'warn', puntaje: s };
    return { texto: 'Alto', cls: 'no', puntaje: s };
  }

  // Decisiones de tratamiento: convención del proyecto, a elegir por el usuario.
  const DECISIONES = ['Evitar (no comprar o no construir)', 'Reducir (hacer las acciones de verificación o mitigación)', 'Transferir (seguro o contrato)', 'Aceptar (asumirlo de forma informada)'];

  /** Riesgos identificados para el contexto, en el orden del catálogo. */
  function identificar(ctx) {
    return CATALOGO.map((r) => {
      const hit = r.aplica(ctx);
      return hit ? { id: r.id, categoria: r.categoria, titulo: r.titulo, fuente: r.fuente, evidencia: hit.evidencia, acciones: r.acciones } : null;
    }).filter(Boolean);
  }

  // ------------------------------------------------------------------ Evaluación del usuario (se guarda en el navegador)
  const clave = (lat, lon) => `geoverificador:riesgos:${lat.toFixed(5)},${lon.toFixed(5)}`;
  function leerEvaluacion(lat, lon) {
    try {
      return JSON.parse(localStorage.getItem(clave(lat, lon)) || '{}');
    } catch (_) {
      return {};
    }
  }
  function guardarEvaluacion(lat, lon, ev) {
    try {
      localStorage.setItem(clave(lat, lon), JSON.stringify(ev));
    } catch (_) {
      // Sin almacenamiento disponible: la evaluación vale solo mientras la página está abierta.
    }
  }

  // ------------------------------------------------------------------ Registro descargable (CSV)
  const csvCampo = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  function registroCsv(riesgos, ev, punto) {
    const cab = ['id', 'categoria', 'riesgo', 'evidencia', 'fuente_del_dato', 'probabilidad', 'impacto', 'nivel', 'decision', 'acciones', 'fuentes_de_las_acciones', 'punto', 'fecha'];
    const filas = riesgos.map((r) => {
      const e = ev[r.id] || {};
      const n = nivel(e.p, e.i);
      const acciones = r.acciones.map((a, k) => `[${(e.hechas || []).includes(k) ? 'hecha' : 'pendiente'}] ${a.texto}`).join(' | ');
      return [r.id, r.categoria, r.titulo, r.evidencia, r.fuente,
        ESCALA.find((x) => x.v === e.p)?.texto || 'sin evaluar', ESCALA.find((x) => x.v === e.i)?.texto || 'sin evaluar',
        n ? n.texto : 'sin evaluar', e.decision != null ? DECISIONES[e.decision] : 'sin decidir',
        acciones, r.acciones.map((a) => a.fuente).join(' | '), `${punto.lat.toFixed(6)}, ${punto.lon.toFixed(6)}`, new Date().toISOString()].map(csvCampo).join(',');
    });
    return '﻿' + [cab.join(','), ...filas].join('\r\n');
  }

  return { CATALOGO, ESCALA, DECISIONES, identificar, nivel, leerEvaluacion, guardarEvaluacion, registroCsv };
})();
