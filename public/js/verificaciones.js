/**
 * verificaciones.js — Datos de «Verificaciones recomendadas antes de comprar» (sin DOM, sin red).
 *
 * Es contenido estático: una lista de trámites y consultas que GeoVerificador NO reemplaza. Para agregar una verificación
 * basta con sumar un objeto a ITEMS; la vista (app.js) lo dibuja sola y las pruebas (test/verificaciones.spec.ts) revisan
 * que la forma sea válida.
 *
 *   id          texto único, sin espacios
 *   titulo      nombre corto del trámite o de la consulta
 *   entidad     quién lo emite o dónde se hace
 *   queConfirma qué permite comprobar
 *   nota        (opcional) una aclaración o límite
 *   enlaces     [{ texto, url }] — SOLO si la URL se comprobó que existe; si no, se deja [] y el nombre va como texto
 *
 * Enlaces comprobados al escribir esta lista (noviembre de 2026, todos respondieron HTTP 200): SUNARP (gob.pe/sunarp,
 * visor-bgr, sprl, alertaregistral, sigueloplus y la nota de pasos antes de comprar), COFOPRI (gob.pe/cofopri),
 * muniarequipa.gob.pe, seal.com.pe y sigrid.cenepred.gob.pe/sigridv3. El sitio de SEDAPAR no respondió, así que no lleva enlace.
 * No se citan precios de ningún trámite: cambian y deben consultarse en cada entidad.
 *
 * Hay dos grupos que la vista separa a propósito: CALCULADO es lo que GeoVerificador ya calculó (referencial) e ITEMS es lo
 * que la persona debe comprobar por su cuenta.
 *
 * Se carga como script del navegador (define `Verificaciones`) y también como módulo CommonJS para las pruebas.
 */
const Verificaciones = (() => {
  // Lo que la ficha ya calculó. Sirve de contraste con ITEMS: esto es referencial; aquello hay que comprobarlo.
  const CALCULADO = [
    { titulo: 'La zonificación de tu punto', texto: 'Qué zona le asigna el plano del PDM 2016-2025 y sus parámetros. Es referencial y la vigencia del plan es incierta.' },
    { titulo: 'Las distancias a cuatro servicios', texto: 'Salud, colegios, paradero y área verde más cercanos, en línea recta, con datos de OpenStreetMap.' },
  ];

  const ITEMS = [
    {
      id: 'zonificacion-parametros',
      titulo: 'Certificado de Zonificación y Vías y Certificado de Parámetros Urbanísticos y Edificatorios',
      entidad: 'IMPLA / Municipalidad Provincial de Arequipa (zonificación y vías) y municipalidad distrital (parámetros)',
      queConfirma: 'La zonificación, las vías y los parámetros con valor legal para ese predio: lo que se puede construir y con qué condiciones. La ficha de GeoVerificador es referencial y no los reemplaza.',
      nota: 'El plano usado aquí es el PDM 2016-2025; la vigencia del plan es incierta (ver «Limitaciones de la zonificación»). Pregunta en el IMPLA o en la municipalidad el trámite y los requisitos vigentes.',
      enlaces: [{ texto: 'Municipalidad Provincial de Arequipa', url: 'https://www.muniarequipa.gob.pe/' }],
    },
    {
      id: 'copia-literal-cargas',
      titulo: 'Copia literal de la partida y certificado de cargas y gravámenes',
      entidad: 'SUNARP (Superintendencia Nacional de los Registros Públicos)',
      queConfirma: 'Quién figura como propietario, y si el predio tiene hipotecas, embargos u otras cargas inscritas. El Certificado Registral Inmobiliario informa la titularidad de los últimos 10 años y las cargas y gravámenes de los últimos 30.',
      nota: 'El Visor BGR es solo una consulta referencial (pide DNI y captcha y limita las consultas por día): que un predio no aparezca ahí no prueba que no esté inscrito. Consulta en SUNARP el costo de cada documento.',
      enlaces: [
        { texto: 'Publicidad registral en línea (SUNARP)', url: 'https://sprl.sunarp.gob.pe/' },
        { texto: 'Visor BGR (consulta referencial)', url: 'https://visor-bgr.sunarp.gob.pe/' },
        { texto: 'Pasos de SUNARP antes de comprar', url: 'https://www.gob.pe/institucion/sunarp/noticias/1032824-sunarp-evite-ser-sorprendido-conozca-los-pasos-a-seguir-antes-de-comprar-una-casa-o-departamento' },
      ],
    },
    {
      id: 'alerta-registral',
      titulo: 'Alerta Registral',
      entidad: 'SUNARP',
      queConfirma: 'Servicio de SUNARP que avisa cuando se presenta un título para inscribir en la partida del predio; sirve para detectar cambios mientras se negocia.',
      nota: 'Consulta en SUNARP cómo se solicita y cuánto cuesta.',
      enlaces: [
        { texto: 'Alerta Registral (SUNARP)', url: 'https://alertaregistral.sunarp.gob.pe/alerta/Inicio' },
        { texto: 'Síguelo Plus (seguimiento de títulos)', url: 'https://sigueloplus.sunarp.gob.pe/siguelo/' },
      ],
    },
    {
      id: 'saneamiento-fisico-legal',
      titulo: 'Saneamiento físico-legal',
      entidad: 'Registro (SUNARP), municipalidad y un profesional (abogado o verificador)',
      queConfirma: 'Que el área, los linderos y las medidas de la partida coincidan con el terreno real, y que el predio esté inscrito a nombre de quien lo vende.',
      nota: 'Si el predio es de origen informal, pregunta en COFOPRI si está formalizado.',
      enlaces: [{ texto: 'COFOPRI', url: 'https://www.gob.pe/cofopri' }],
    },
    {
      id: 'licencia-conformidad',
      titulo: 'Licencia de edificación y conformidad de obra',
      entidad: 'Municipalidad distrital',
      queConfirma: 'Si hay construcción: que se hizo con licencia y que tiene conformidad de obra y declaratoria de edificación inscritas.',
      nota: 'Si el predio es un terreno sin construir, no aplica.',
      enlaces: [],
    },
    {
      id: 'servicios-basicos',
      titulo: 'Servicios básicos: agua, alcantarillado y electricidad',
      entidad: 'SEDAPAR (agua y alcantarillado) y SEAL (electricidad)',
      queConfirma: 'Que el predio tenga conexión o factibilidad de servicio, y que no haya deudas pendientes en los recibos.',
      enlaces: [{ texto: 'SEAL', url: 'https://www.seal.com.pe/' }],
    },
    {
      id: 'peligros',
      titulo: 'Peligros y riesgo de desastres',
      entidad: 'SIGRID (CENEPRED)',
      queConfirma: 'Qué información oficial hay sobre peligros y escenarios de riesgo en la zona. GeoVerificador solo muestra una estimación del CENEPRED por distrito ante El Niño y no evalúa el peligro de tu predio: en el visor público del SIGRID puedes ver los mapas y estudios del CENEPRED.',
      nota: 'Para construir, la norma E.030 exige además un Estudio de Mecánica de Suelos.',
      enlaces: [{ texto: 'Visor público del SIGRID (CENEPRED)', url: 'https://sigrid.cenepred.gob.pe/sigridv3/' }],
    },
  ];

  const AVISO = 'Es una orientación general y no es asesoría legal. Confirma requisitos, costos y vigencia con cada entidad.';

  /** Errores de forma de una lista de verificaciones; vacío si es válida. */
  function validar(items) {
    const errores = [];
    const ids = new Set();
    (items || []).forEach((it, i) => {
      const donde = `#${i + 1} (${it && it.id})`;
      if (!it || typeof it.id !== 'string' || !/^[a-z0-9-]+$/.test(it.id)) errores.push(`${donde}: id inválido`);
      else if (ids.has(it.id)) errores.push(`${donde}: id repetido`);
      else ids.add(it.id);
      ['titulo', 'entidad', 'queConfirma'].forEach((k) => {
        if (!it || typeof it[k] !== 'string' || it[k].trim() === '') errores.push(`${donde}: falta ${k}`);
      });
      if (it && it.nota !== undefined && (typeof it.nota !== 'string' || it.nota.trim() === '')) errores.push(`${donde}: nota vacía`);
      if (!it || !Array.isArray(it.enlaces)) errores.push(`${donde}: enlaces debe ser una lista`);
      else it.enlaces.forEach((e) => {
        if (!e || typeof e.texto !== 'string' || !/^https:\/\//.test(e.url || '')) errores.push(`${donde}: enlace inválido (se exige https)`);
      });
    });
    return errores;
  }

  return { CALCULADO, ITEMS, AVISO, validar };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Verificaciones;
