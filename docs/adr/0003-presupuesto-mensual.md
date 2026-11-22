# 0003 · D3 · Presupuesto mensual

- **Estado:** propuesta. Decide el dueño del producto.
- **Fecha:** 2026-11-16

## Contexto

El plan gratuito de Apify entrega 10 registros por corrida. Con volumen real se estimó entre USD 19 y 35 al mes. Faltaba estimar la base de datos y
el modelo de lenguaje.

## Lo que se puede medir hoy y lo que no

| Partida | Cómo se mide | Estado |
| --- | --- | --- |
| Apify | Cada corrida escribe su gasto en `corrida_avisos.gasto_usd`; el tope por corrida ya existe (`--tope-usd`, 0,50 por defecto). | Medible |
| Modelo de lenguaje | Cada conversación guarda tokens de entrada y salida por paso (`conversacion_uso`). El costo se calcula con la tarifa escrita en `MODELO_USD_POR_MTOK_ENTRADA` y `MODELO_USD_POR_MTOK_SALIDA`. | Medible; **la tarifa no está escrita**: se toma de la página de precios del proveedor al elegir el modelo |
| Base de datos | Depende del proveedor que se elija en el Marketplace de Vercel y de su plan. | **Sin estimar**: no se ha creado la base de producción |
| Vercel | Plan del equipo. | Sin estimar |

No se escribe aquí ninguna cifra que no se haya medido. El tablero (`/tablero`) suma el gasto de Apify y del modelo por día.

## Propuesta

1. Fijar un tope mensual total y repartirlo: recolección, modelo, base de datos.
2. Topes duros en el código (ya implementados, con valores por defecto conservadores que el dueño debe confirmar):
   - `AVISOS_TOPE_USD_CORRIDA` (por defecto 0,50) y `AVISOS_TOPE_USD_MES` (sin valor: la corrida programada no arranca si no está definido).
   - `AGENTE_MAX_MENSAJES_SESION` (por defecto 30) y `AGENTE_MAX_PASOS` (por defecto 8 llamadas a herramientas por mensaje).
3. Revisar el gasto real en el tablero tras el primer mes de beta y ajustar.

## Pendiente de una persona

- Decidir el tope mensual y escribir `AVISOS_TOPE_USD_MES`.
- Elegir proveedor y plan de base de datos.
- Escribir la tarifa del modelo elegido tras la evaluación (tarea 6.6).
