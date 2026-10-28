# GeoVerificador: estado de la entrega

Resumen del estado técnico. El detalle de fuentes y límites está en [`METODOLOGIA.md`](METODOLOGIA.md) y el de validación en [`VALIDACION.md`](VALIDACION.md).

## Qué funciona

- **Cinco variables por separado** con su fuente y umbral: zonificación vigente (V1a), aviso de zonificación proyectada (V1b), salud, educación por nivel, transporte y área verde. Los cálculos se hacen en el navegador, con archivos locales.
- **Verificación automática:** 86 pruebas unitarias (`pnpm test`) y 64 comprobaciones de integridad y cálculo (`pnpm datos:verificar`), en la última corrida.
- **Zonificación contrastada:** las reglas coinciden con el Reglamento y con la Memoria oficial (201 valores numéricos, ninguno faltante). Los polígonos se re-extrajeron del PDF del plano con 99,97 % de coincidencia en 13 255 puntos al azar.
- **Equipamiento de OpenStreetMap** congelado en `public/data/equipamiento`, con la fecha de extracción y la atribución ODbL.
- **Frontend estático:** `public/` no depende de rutas absolutas ni de `GET /api`, por lo que puede publicarse en GitHub Pages.
- **Integración continua:** flujo de CI (lint, pruebas, build y verificación de datos) y flujo de publicación en Pages definidos en `.github/workflows/`.

## Pendiente

- **K1. Muestra frente a certificados oficiales.** Comparar la zona mostrada con Certificados de Zonificación y Vías reales de predios conocidos. Hoy solo hay contraste con el plano y el reglamento, no con un documento emitido para un predio.
- **K2. OpenStreetMap frente a registros oficiales.** Contrastar los establecimientos de salud y educación con RENIPRESS y ESCALE del MINSA y del MINEDU.
- **K4. Prueba con usuarios.** Medir tiempo y acierto en las tareas y aplicar un cuestionario de usabilidad (SUS), según [`plantillas/prueba-usuarios.csv`](plantillas/prueba-usuarios.csv).
- **Capa vectorial de zonificación del IMPLA.** La capa actual sale del PDF del plano. Falta obtener la capa oficial del IMPLA para reemplazarla o contrastarla.
- **Vigencia del PDM.** El PDM 2016-2025 cumplió diez años de vigencia, hay un PDM nuevo en trámite y una suspensión judicial de ciertos actos. Falta confirmar con el IMPLA o la Municipalidad Provincial de Arequipa qué zonificación aplica hoy.
- **Primera ejecución en GitHub.** Activar GitHub Pages en el repositorio (fuente: GitHub Actions) y comprobar que los flujos de CI y de Pages corren en verde.
