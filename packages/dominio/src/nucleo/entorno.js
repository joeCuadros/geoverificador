// GENERADO por scripts/generar-dominio.mjs. No editar.
/**
 * entorno.js — Lo que en el navegador eran variables globales (CONFIG, Services) y aquí se entrega una sola vez con configurar().
 * Mientras no se llame a configurar(), CONFIG y Services valen undefined, igual que cuando las bibliotecas se cargaban solas en una prueba.
 * Calculos y Rutas son los del paquete salvo que una prueba entregue un doble.
 */
import CalculosDelNucleo from './calculos.js';
import RutasDelNucleo from './rutas.js';

export let CONFIG;
export let Services;
export let Calculos = CalculosDelNucleo;
export let Rutas = RutasDelNucleo;

/** Entrega la configuración y los servicios de red a las bibliotecas del núcleo. Cada campo es opcional. */
export function configurar(entorno = {}) {
  if ('CONFIG' in entorno) CONFIG = entorno.CONFIG;
  if ('Services' in entorno) Services = entorno.Services;
  if ('Calculos' in entorno) Calculos = entorno.Calculos;
  if ('Rutas' in entorno) Rutas = entorno.Rutas;
}
