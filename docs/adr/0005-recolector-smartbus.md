# 0005 · Recolector de SmartBus

- **Estado:** propuesta. Decide el dueño del producto (tarea 1.2 del plan).
- **Fecha:** 2026-11-16

## Contexto

`pnpm datos:smartbus` (`scripts/recolectar-smartbus.mjs`, `scripts/lib/smartbus/`) sigue en `main` con sus pruebas. Solo hay permiso verbal de
SmartBus y sus datos no pueden entrar al producto. El archivo `public/data/rutas_smartbus.geojson` y su script de descarga ya no están en `main`:
el borrado prevaleció al integrar las ramas (tarea 1.1). La única fuente de rutas del producto es OpenStreetMap (`rutas_osm.geojson`).

## Opciones

1. **Quitar el recolector.** Menos código que mantener y ninguna posibilidad de que sus datos lleguen al producto por error.
2. **Conservarlo como herramienta interna.** Sirve para contrastar las rutas de OSM. Escribe solo en `.cache-smartbus/` y `datos-crudos/`, ignorados por git.

## Propuesta

Opción 2 hasta que haya permiso por escrito o se decida lo contrario, con una salvaguarda: el cargador de la base de datos **no tiene** un cargador
de SmartBus y `datos:verificar` comprueba que no exista `rutas_smartbus.geojson` en `public/data`.

## Pendiente de una persona

Pedir a SmartBus el permiso por escrito, o confirmar que se borra el recolector.
