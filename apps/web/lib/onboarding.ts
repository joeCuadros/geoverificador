/**
 * onboarding.ts — El contenido y las decisiones de la guía de primera visita (sin DOM, sin red): qué pasos tiene, cómo se avanza y cómo se recuerda que ya se vio.
 *
 * Es el equivalente de `onboarding.js` y `tour.js` de la aplicación estática, adaptado a los controles de esta: el buscador, las capas del mapa, la ficha del punto y el
 * asistente. El componente que la dibuja es `app/componentes/Onboarding.tsx`. Todo el texto vive aquí para poder revisarlo y probarlo sin abrir la página.
 *
 *   PASOS[i] = { id, titulo, intro, puntos, objetivo?, aviso?, privacidad? }
 *   objetivo:   selector CSS del control que se resalta mientras se explica (si no existe, el paso se muestra igual).
 *   aviso:      la nota de «consulta referencial» (el único lugar donde la interfaz usa ámbar).
 *   privacidad: el paso que explica qué sale del servidor cuando se usa el asistente.
 */

export const CLAVE_VISTO = 'geoverificador.web.guiaVista';

export interface PasoDeGuia {
  id: string;
  titulo: string;
  intro: string;
  puntos: readonly string[];
  objetivo?: string;
  aviso?: string;
  privacidad?: boolean;
}

export const PASOS: readonly PasoDeGuia[] = [
  {
    id: 'bienvenida',
    titulo: 'Bienvenido a GeoVerificador',
    intro: 'Te muestra qué dicen el plano de zonificación oficial (PDM 2016-2025) y los servicios públicos sobre un punto o una zona de Arequipa, medidos contra lo que tú pidas.',
    puntos: [
      'No decide por ti: dice qué cumple, qué no cumple y qué no se sabe, con la fuente de cada cifra.',
      '«Sin dato» es un estado propio: significa que no figura en los datos, no que no exista.',
      'No da un puntaje ni dice cuál es «la mejor zona»: eso depende de lo que te importe.',
    ],
    aviso: 'Consulta referencial: no reemplaza el Certificado de Zonificación y Vías ni el de Parámetros Urbanísticos y Edificatorios.',
  },
  {
    id: 'buscar',
    titulo: 'Busca un lugar',
    intro: 'Escribe una dirección o el nombre de un lugar en «Buscar un lugar» y elige un resultado.',
    puntos: ['También puedes tocar el mapa para elegir un punto.', 'Al elegir un punto se abre su ficha.'],
    objetivo: 'form[role="search"]',
  },
  {
    id: 'capas',
    titulo: 'Capas del mapa',
    intro: 'Con «Capas del mapa» eliges qué ver sobre el mapa.',
    puntos: ['Cada capa trae su leyenda, una nota con lo que no cubre y su fuente.', 'Se dibuja solo lo que activas.'],
    objetivo: 'button[aria-controls="capas-panel"]',
  },
  {
    id: 'ficha',
    titulo: 'La ficha del punto',
    intro: 'Al elegir un punto o un resultado, su ficha se abre en una columna junto al asistente: arriba el recuento y lo esencial, debajo cada tema plegado.',
    puntos: [
      'Cada dato lleva su estado con icono y texto: Cumple, No cumple, Informativo o Sin dato.',
      'Las distancias son en línea recta, no recorrido a pie.',
    ],
    // Con una ficha abierta se resalta su columna; si no, el botón que abre la del centro del mapa.
    objetivo: '#ficha-panel, button[aria-label="Ver ficha del centro del mapa"]',
  },
  {
    id: 'asistente',
    titulo: 'Conversa con el asistente',
    intro: 'Escribe en «Tu consulta» lo que buscas, por ejemplo un departamento en una zona y cerca de un colegio.',
    puntos: [
      'Las cifras y los enlaces salen de los datos, no de un modelo; si no hay dato, te lo dice.',
      'No sabe de seguridad, ruido ni calidad de los colegios, y lo dice en vez de responder a medias.',
    ],
    objetivo: 'form.mensaje-form',
  },
  {
    id: 'privacidad',
    titulo: 'Tu privacidad con el asistente',
    intro: 'Esto es lo que sale del servidor cuando usas el asistente.',
    puntos: [
      'Si el servidor no tiene una clave de Gemini (GEMINI_API_KEY), tu mensaje no se envía a Google: el asistente responde igual, solo con reglas.',
      'Si la tiene, un modelo de Google (Gemini) redacta la frase con que abre la respuesta. Entonces se envían a Google tu mensaje, lo que se entendió de tu búsqueda y un resumen de lo que devolvieron las herramientas, sin coordenadas.',
      'Lo que escribe el modelo se comprueba contra los datos: si trae una cifra o un enlace que las herramientas no dieron, se descarta y se usa la redacción con reglas.',
      'No escribas datos personales en el chat.',
    ],
    privacidad: true,
  },
];

export const TOTAL = PASOS.length;

export const limitar = (i: number): number => (Number.isInteger(i) ? Math.min(Math.max(i, 0), TOTAL - 1) : 0);
export const siguiente = (i: number): number => limitar(limitar(i) + 1);
export const anterior = (i: number): number => limitar(limitar(i) - 1);
export const esPrimero = (i: number): boolean => limitar(i) === 0;
export const esUltimo = (i: number): boolean => limitar(i) === TOTAL - 1;
export const progreso = (i: number): string => `Paso ${limitar(i) + 1} de ${TOTAL}`;

/** Lo mínimo que se usa del almacenamiento del navegador (`localStorage` lo cumple). */
export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

/**
 * El almacenamiento local, o null si no hay (renderizado en el servidor, ventana privada, datos del sitio bloqueados: hasta leer `localStorage` puede lanzar).
 * La guía nunca debe romper la página por esto.
 */
export function almacenDelNavegador(): Almacen | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function yaVisto(almacen: Almacen | null | undefined): boolean {
  try {
    return !!almacen && almacen.getItem(CLAVE_VISTO) === '1';
  } catch {
    return false;
  }
}

export function marcarVisto(almacen: Almacen | null | undefined): void {
  try {
    almacen?.setItem(CLAVE_VISTO, '1');
  } catch {
    /* sin almacenamiento: la guía volverá a aparecer en la próxima visita, no pasa nada */
  }
}

/** La línea que dice si, en este servidor, el modelo de lenguaje está activo (lo que responde `/api/agente/estado`); null si no se sabe. */
export function textoDelModelo(modelo: boolean | null): string | null {
  if (modelo === null) return null;
  return modelo
    ? 'En este servidor el modelo de lenguaje (Gemini) está activo: el mensaje y un resumen de los resultados se envían a Google.'
    : 'En este servidor el modelo de lenguaje no está activo: tu mensaje no se envía a Google.';
}
