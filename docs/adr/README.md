# Registro de decisiones (ADR)

Cada archivo registra una decisión del producto o de la arquitectura: el contexto, las opciones, la propuesta y su estado.
Un ADR **no se edita para cambiar la decisión**: se escribe otro que lo reemplaza y se enlaza.

Estados: `propuesta` (falta que decida el dueño del producto), `aceptada`, `rechazada`, `reemplazada por NNNN`.

| N.º | Decisión | Estado | Bloquea |
| --- | --- | --- | --- |
| [0001](0001-principios-del-producto.md) | D1 · Cambiar los principios del producto | propuesta | Fase 6 (orden de resultados, mostrar avisos) |
| [0002](0002-base-legal-avisos.md) | D2 · Base legal para mostrar avisos de terceros | propuesta | Fases 3 y 6 (publicar avisos) |
| [0003](0003-presupuesto-mensual.md) | D3 · Presupuesto mensual | propuesta | Fase 3.8 (corrida programada), fase 8 |
| [0004](0004-alcance-marketplace.md) | D4 · Alcance de Marketplace | propuesta | Fase 3.9 |
| [0005](0005-recolector-smartbus.md) | Recolector de SmartBus | propuesta | Tarea 1.2 |
| [0006](0006-base-de-datos.md) | PostgreSQL + PostGIS y la rama `feature/base-de-datos` (MySQL) | propuesta | Fase 2 |
| [0007](0007-paquete-de-dominio.md) | Paquete de dominio generado mientras dure la migración | aceptada (técnica) | Fase 5.2 |

Mientras D1 a D4 estén en `propuesta`, el código nuevo se comporta así:

- Los avisos **no se publican**: `AVISOS_PUBLICOS` no está definido, el agente busca avisos solo en entornos donde alguien lo activa a mano y la
  respuesta lleva siempre fecha y enlace al original.
- El orden de resultados usa la propuesta de D1 (criterios cumplidos, cada uno con su valor), pero `PRODUCT.md` y `docs/METODOLOGIA.md`
  no se han cambiado: el cambio de principios lo firma el dueño del producto.
- La corrida programada de avisos existe pero está apagada (`AVISOS_PROGRAMADOS` no definido) y Marketplace está fuera de las fuentes por defecto.
