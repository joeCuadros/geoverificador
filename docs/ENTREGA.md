# GeoVerificador: estado de la entrega

Resumen del estado técnico. El detalle de fuentes y límites está en [`METODOLOGIA.md`](METODOLOGIA.md) y el de validación en [`VALIDACION.md`](VALIDACION.md).

## Qué funciona

- **Cinco variables por separado** con su fuente y umbral: zonificación vigente (V1a), aviso de zonificación proyectada (V1b), salud, educación por nivel, transporte y área verde. Los cálculos se hacen en el navegador, con archivos locales.
- **Verificación automática:** 1 023 pruebas unitarias (`pnpm test`) y 136 comprobaciones de integridad y cálculo (`pnpm datos:verificar`), en la última corrida.
- **Zonificación contrastada:** las reglas coinciden con el Reglamento y con la Memoria oficial (201 valores numéricos, ninguno faltante). Los polígonos se re-extrajeron del PDF del plano con 99,97 % de coincidencia en 13 255 puntos al azar.
- **Equipamiento de OpenStreetMap** congelado en `public/data/equipamiento`, con la fecha de extracción y la atribución ODbL.
- **Líneas de transporte de SmartBus** congeladas en `public/data/rutas_smartbus.geojson` (12 líneas, 241 recorridos, 9 301 paradas; descarga del 2026-11-03), visibles en la ficha, la comparación, el informe y el asistente. Se usan con **autorización verbal de SmartBus; la confirmación escrita está pendiente** (ver Pendiente). Son recorridos publicados: sin frecuencias ni horarios (METODOLOGIA §6c).
- **Frontend estático:** `public/` no depende de rutas absolutas ni de `GET /api`, y se publica en Vercel como sitio estático (`vercel.json`).
- **Integración continua:** flujo de CI (lint, pruebas, build y verificación de datos) en `.github/workflows/ci.yml`.

## Ayudas para decidir y contexto de riesgo

- **Recorrido guiado, tarjetas desplegables, «Comparar puntos», verificaciones antes de comprar y menús del asistente** (ver el [`README.md`](../README.md)).
- **Quebradas y cauces** como variable INFORMATIVA, de tres fuentes unidas sin duplicados y con la fuente de cada tramo: ANA (14 tramos), IGP (231) y OpenStreetMap (20), 265 tramos con 42 nombres, descargados el 2026-11-03. **Ahora figuran Añashuayco (de OpenStreetMap, «Quebrada Anashuayco») y San Lázaro (del IGP).** Con «Mis umbrales» la persona fija su propia distancia mínima. **Contexto de riesgo (informativo):** peligros geológicos de INGEMMET (394 registros, congelados el 2026-10-12), 94 sismos del IGP entre el 2026-01-01 y el 2026-11-02 y **peligro volcánico del Misti** (87 polígonos del IGP de lahares, flujos piroclásticos, lava, avalanchas y ceniza, congelados el 2026-11-03, sin fecha de elaboración en el servicio; mapa oficial de referencia: INGEMMET, Boletín n.° 100 de 2025). Peligro sísmico por punto: el IGP no ofrece uno verificable (METODOLOGIA §12.7). Detalle, fuentes y límites en [`METODOLOGIA.md`](METODOLOGIA.md) §12.
- **Precio de oferta por m² del distrito (informativo).** Aptología, datos abiertos CC BY 4.0 (atribución «Datos: Aptologia»), congelados el 2026-11-03 con `scripts/descargar-precios.mjs`: mediana del precio pedido de departamentos en venta, con corte al 2026-10-18. **Solo 3 de los 25 distritos tienen cifra** (Cayma, Yanahuara y Cerro Colorado, 273 avisos; Aptología publica solo distritos con al menos 30 avisos); el resto es SIN DATO con su causa. Está en la ficha, en «Comparar puntos», en el PDF y en el asistente («¿cuánto cuesta el m² en Cayma?»); el precio de una casa o un alquiler sigue fuera de alcance. Nunca es cumple / no cumple ni puntaje. Detalle, licencia verificada y límites en [`METODOLOGIA.md`](METODOLOGIA.md) §13.
- **Datos sin servicio.** `scripts/descargar-peligros.mjs` apunta al servicio público de INGEMMET, que solo trae 291 de los 394 registros congelados; se conserva el archivo completo y el script no lo sobrescribe sin `--forzar`. El servicio original exige token.

## Pendiente

- **Cobertura de precios.** Solo 3 distritos tienen precio de oferta por m²; no hay precio de alquiler por m² ni serie en el tiempo. Falta una fuente con más distritos (por ejemplo, un extracto agregado de un portal con permiso de uso y atribución) y volver a correr `node scripts/descargar-precios.mjs` cuando Aptología actualice su estudio (se anuncia mensual).

- **Quebradas urbanas.** Aun con las tres fuentes faltan quebradas que nombra el inventario de INGEMMET (hoy: Cabrería, Pajonal, Onda, Honda, Mariano Melgar y Pisac; se calculan, no se escriben a mano). Falta una fuente de peligro delimitado (CENEPRED/SIGRID o los informes de INGEMMET), que no respondió desde la red de prueba; probar desde una red en Perú.
- **Peligro volcánico.** Confirmar con el IGP o INGEMMET de qué edición del mapa del Misti salen las capas del IGP (sin metadatos de fecha) y de qué volcán son las capas de ceniza; si se confirma que son anteriores al Boletín n.° 100 (2025), reemplazarlas con los nuevos mapas de INGEMMET.
- **Catálogo sísmico histórico.** Descargar a mano el catálogo del IGP (datosabiertos.gob.pe) y congelarlo con fecha; la API solo trae 2026.

- **Confirmación escrita de SmartBus.** Los recorridos se descargaron con autorización verbal. Conseguir la confirmación escrita (uso, atribución y si se puede redistribuir el archivo) antes de publicar la herramienta fuera de la demostración; si la negaran, retirar `public/data/rutas_smartbus.geojson`: la ficha avisa «No se pudieron cargar las líneas» y sigue mostrando el paradero de OpenStreetMap.
- **K1. Muestra frente a certificados oficiales.** Comparar la zona mostrada con Certificados de Zonificación y Vías reales de predios conocidos. Hoy solo hay contraste con el plano y el reglamento, no con un documento emitido para un predio.
- **K2. OpenStreetMap frente a registros oficiales.** El script está hecho y probado (`pnpm datos:validar-oficial`, METODOLOGIA/VALIDACION §3.4). Falta **correrlo**: descargar a mano RENIPRESS y el padrón de ESCALE (dónde, en `docs/VALIDACION.md` §3.4), fijar los criterios de aceptación antes de medir y registrar el resultado.
- **K4. Prueba con usuarios.** Medir tiempo y acierto en las tareas y aplicar un cuestionario de usabilidad (SUS), según [`plantillas/prueba-usuarios.csv`](plantillas/prueba-usuarios.csv).
- **Capa vectorial de zonificación del IMPLA.** La capa actual sale del PDF del plano. Falta obtener la capa oficial del IMPLA para reemplazarla o contrastarla.
- **Vigencia del PDM.** El PDM 2016-2025 cumplió diez años de vigencia, hay un PDM nuevo en trámite y una suspensión judicial de ciertos actos. Falta confirmar con el IMPLA o la Municipalidad Provincial de Arequipa qué zonificación aplica hoy.
- **Despliegue automático.** Conectar el repositorio a Vercel (Git integration) para que cada `push` a `main` despliegue solo.
