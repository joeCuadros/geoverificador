/**
 * tour.js — Contenido y lógica del recorrido guiado de la primera visita (sin DOM, sin red).
 *
 * El recorrido explica qué hace y qué NO hace la herramienta, cómo elegir un punto, cómo leer una tarjeta, cómo usar
 * el asistente y cómo comparar puntos. Se muestra solo la primera vez, se puede omitir y se vuelve a abrir con el botón
 * «¿Cómo funciona?». Todo el texto vive aquí para que se pueda revisar y probar (test/tour.spec.ts) sin abrir la página.
 *
 *   PASOS[i] = { id, titulo, intro, bloques: [{ titulo?, items: [texto…] }], muestra? }
 *   muestra: 'estados' dibuja los tres estados de ejemplo (CUMPLE, NO CUMPLE, SIN DATO) en la vista.
 *
 * Se carga como script del navegador (define `Tour`) y también como módulo CommonJS para las pruebas.
 */
const Tour = (() => {
  const CLAVE_VISTO = 'geoverificador.tourVisto';

  const PASOS = [
    {
      id: 'alcance',
      titulo: 'Qué hace y qué no hace',
      intro: 'GeoVerificador muestra, con datos públicos, qué zonificación tiene un predio de Arequipa y qué servicios hay cerca. Cada variable se evalúa por separado.',
      bloques: [
        {
          titulo: 'Qué hace',
          items: [
            'Ubica el punto en el plano de zonificación del PDM 2016-2025.',
            'Mide la distancia al establecimiento de salud, los colegios, el paradero y el área verde más cercanos.',
            'Dice de dónde sale cada dato, de qué fecha es y qué no cubre.',
          ],
        },
        {
          titulo: 'Qué no hace',
          items: [
            'No da un puntaje global ni recomienda dónde comprar: no hay base para decidir cuánto pesa cada variable.',
            'No es un certificado. No reemplaza el Certificado de Zonificación y Vías ni el de Parámetros Urbanísticos y Edificatorios.',
            'Las distancias son en línea recta, no recorrido a pie.',
            'Los servicios vienen de OpenStreetMap, un mapa colaborativo: algo que falte en el mapa puede existir.',
          ],
        },
      ],
    },
    {
      id: 'punto',
      titulo: 'Cómo elegir un punto',
      intro: 'La consulta tiene tres pasos: ubicar, confirmar y leer el reporte.',
      bloques: [
        {
          items: [
            'Ubica: escribe una dirección y pulsa «Buscar», usa «Usar mi ubicación» o toca el mapa.',
            'Confirma: revisa que el marcador esté sobre tu predio. Puedes tocar otro lugar, arrastrar el marcador o usar «Mover el punto» (flechas de 10 m o de 50 m).',
            'Lee: pulsa «Sí, verificar» para abrir el reporte. Con «Cambiar» vuelves a elegir el punto.',
          ],
        },
      ],
    },
    {
      id: 'tarjetas',
      titulo: 'Cómo leer cada tarjeta',
      intro: 'Cada servicio y cada dato del entorno tiene una tarjeta con su estado. Tócala para abrirla y ver el detalle.',
      muestra: 'estados',
      bloques: [
        {
          items: [
            'CUMPLE: el más cercano está dentro de la distancia de referencia (el umbral).',
            'NO CUMPLE: está más lejos que el umbral.',
            'SIN DATO: no figura en nuestros datos. No significa que no exista.',
            'INFORMATIVO: dato sin umbral oficial, como la distancia a una quebrada. Se muestra sin decir cumple o no cumple, salvo que tú fijes tu propio umbral en «Mis umbrales».',
            'Colegio muestra PARCIAL cuando cumple en algunos niveles (inicial, primaria, secundaria) pero no en todos.',
            'Al abrir una tarjeta ves el umbral y de dónde sale, la fuente, la fecha del dato, el método y lo que el dato no cubre.',
          ],
        },
      ],
    },
    {
      id: 'asistente',
      titulo: 'Cómo usar el asistente',
      intro: 'El botón «Asistente» responde sobre tu punto y busca zonas según lo que te importa. No usa un modelo de lenguaje ni envía lo que escribes: aplica reglas sobre los mismos datos de la ficha, así que no inventa.',
      bloques: [
        {
          items: [
            'Escribe una frase, por ejemplo «busco cerca de un colegio y un parque», o arma la búsqueda con los menús, sin escribir.',
            'Cada respuesta trae un apartado «Por qué, fuente y límites» que puedes abrir.',
            'Los porcentajes son la parte del suelo habitable de un distrito que cumple lo pedido. No son una probabilidad ni una recomendación.',
            'No sabe de seguridad, precios ni ruido, y lo dice en vez de responder a medias.',
          ],
        },
      ],
    },
    {
      id: 'comparar',
      titulo: 'Cómo comparar puntos',
      intro: 'Si dudas entre varios predios, guárdalos y mira sus variables lado a lado.',
      bloques: [
        {
          items: [
            'En el reporte, pulsa «Guardar para comparar». Puedes guardar hasta 3 puntos.',
            'Abre «Comparar» en la barra superior para ver la tabla con el estado, la distancia y el umbral de cada variable, más un contexto de riesgo informativo.',
            'Marca qué variables son prioridad para ti: la tabla resalta qué punto las cumple. Es tu criterio; no hay pesos ni puntaje global.',
            'Tus prioridades y tus puntos se guardan solo en este navegador.',
          ],
        },
      ],
    },
    {
      id: 'verificar',
      titulo: 'Antes de comprar',
      intro: 'La ficha es un primer filtro, no un trámite.',
      bloques: [
        {
          items: [
            'En el reporte encontrarás «Verificaciones recomendadas antes de comprar»: certificados municipales, partida y cargas en SUNARP, servicios básicos y peligros.',
            'Esos documentos sí tienen valor legal o aportan información que esta herramienta no tiene.',
            'Puedes volver a este recorrido cuando quieras con «¿Cómo funciona?».',
          ],
        },
      ],
    },
  ];

  const total = PASOS.length;
  const limitar = (i) => (Number.isInteger(i) ? Math.min(Math.max(i, 0), total - 1) : 0);
  const siguiente = (i) => limitar(limitar(i) + 1);
  const anterior = (i) => limitar(limitar(i) - 1);
  const esPrimero = (i) => limitar(i) === 0;
  const esUltimo = (i) => limitar(i) === total - 1;
  const progreso = (i) => `Paso ${limitar(i) + 1} de ${total}`;

  // El almacenamiento del navegador puede faltar o lanzar (ventana privada, datos bloqueados): nunca debe romper la página.
  function tourVisto(almacen) {
    try {
      return !!almacen && almacen.getItem(CLAVE_VISTO) === '1';
    } catch (err) {
      return false;
    }
  }

  function marcarTourVisto(almacen) {
    try {
      if (almacen) almacen.setItem(CLAVE_VISTO, '1');
    } catch (err) {
      /* sin almacenamiento: el recorrido volverá a aparecer en la próxima visita, no pasa nada */
    }
  }

  return { CLAVE_VISTO, PASOS, total, limitar, siguiente, anterior, esPrimero, esUltimo, progreso, tourVisto, marcarTourVisto };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Tour;
