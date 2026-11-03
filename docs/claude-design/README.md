# Paquete para Claude Design: asistente de decisión de GeoVerificador

Este paquete reúne todo lo necesario para pasar el diseño a otra cuenta o modelo con un prompt bien hecho. Es **documentación**, no código: no cambia la aplicación publicada.

## Contenido

| Archivo | Qué es |
|---|---|
| `00-PROMPT-CLAUDE-DESIGN.md` | Prompt maestro para pegar como primer mensaje |
| `01-DISENO-DE-INICIO-A-FIN.md` | Especificación: principios, modelo de decisión (LLM + motor), recorrido de 9 pantallas, KPI, fases, riesgos |
| `02-DATOS.md` | Datos existentes con conteos, umbrales y fuentes, datos externos, lo que no existe, privacidad, endpoints |
| `03-EVIDENCIA.md` | Evidencia (E1 a E26) → decisión de diseño, y lo que la evidencia no resuelve |
| `04-DIRECCION-DEL-EQUIPO.md` | Feedback del equipo del 2026-11-03: página de inicio con foto, tutorial y luego chat, chat grande, prioridad por criterio |
| `05-FUENTES-ADICIONALES.md` | Sondeo de fuentes abiertas y sistemas del Estado (nacionales y regionales) que podrían sumarse, con lo verificado y lo que no, y las correcciones a lo dicho antes |
| `referencias/` (por crear) | Capturas que envió el equipo; copiarlas aquí y adjuntarlas (no están en el repositorio) |
| `contrato-datos.json` | Datos de **ejemplo** (marcados `muestra: true`) para prototipar con realismo |
| `skill/geoverificador-decision-ux/` | Skill: `SKILL.md` + `references/identidad-visual.md` |

## Cómo usarlo en Claude Design

1. Abre un proyecto nuevo en Claude Design.
2. Instala la skill: sube la carpeta `skill/geoverificador-decision-ux/` completa (debe conservar `SKILL.md` y `references/`).
3. Adjunta `01`, `02`, `03`, `04`, `contrato-datos.json` y las capturas de referencia.
4. Pega el contenido de `00-PROMPT-CLAUDE-DESIGN.md` (desde la línea `---` hacia abajo).
5. Pide primero el **mapa de la experiencia** y valídalo antes de que genere pantallas.

## Decisiones clave que lleva el paquete

- Los **pesos y máximos tolerables los pone la persona**; no hay valores por defecto sin fuente.
- El **LLM no calcula**: entiende, pregunta y explica; el motor determinista calcula y mide robustez.
- **Anclas por persona** (trabajo, colegio, cuidado) en minutos por red.
- **Robustez** en todo ranking; nada de «mejor zona».
- **Privacidad**: direcciones solo en el dispositivo.

## Lo que no se pudo verificar

- Costo y latencia del LLM y del servidor de rutas propio.
- Existencia de datos GTFS de Arequipa (no se encontraron; sin verificar).
- Términos de uso de los portales inmobiliarios (no se recomienda raspar sin revisarlos).
- Eficacia de la elicitación con personas reales en Perú: es la primera pregunta a probar.
- El umbral de cada etiqueta de robustez es una convención a calibrar.

## Estado de referencia

Actualizado el 2026-11-03 contra `main` en `c9508f7` (PR #7: Gemini, comparador, quebradas, sismos, tour, verificaciones). Archivos **sin commit**, en el árbol de trabajo. El sitio publicado en Vercel se desplegó antes de ese PR.
