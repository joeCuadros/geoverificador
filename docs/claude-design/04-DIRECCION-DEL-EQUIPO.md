# Dirección del equipo (feedback del 2026-11-03)

> Origen: mensajes de WhatsApp de un integrante del equipo sobre la versión de `main` (commit `c9508f7`), con capturas de referencia. Son **requisitos de diseño** y tienen prioridad sobre lo que diga la especificación si hay conflicto. Las capturas no están en el repositorio: copiarlas a `docs/claude-design/referencias/` y adjuntarlas a Claude Design.

## Lo que pidió

| # | Pedido | Qué implica para el diseño |
|---|---|---|
| 1 | **Agregar una página de inicio**, «algo así, pero con foto» | Pantalla de entrada tipo *hero* con una **fotografía de Arequipa**. Referencia 1: marca arriba, «Encuentra tu lugar ideal en Arequipa», subtítulo («Cuéntame qué te importa y explora zonas con información pública, sus fuentes y sus límites»), botón «Comenzar recorrido →» y aviso «Recibirás una guía breve de 6 pasos antes de conversar con el asistente» |
| 2 | **Ocultar la barra lateral** («Ubica tu predio») | El panel lateral actual deja de ser la primera cosa que se ve |
| 3 | **Lo que debe salir primero es el tutorial y luego el chatbot (función principal)** | Orden: **inicio → tutorial → chatbot**. El chat es el producto, no un botón más de la barra |
| 4 | **Buscar por punto es secundario** | Se puede conservar, **escondido, no a la vista**; accesible desde un lugar discreto |
| 5 | **El chatbot actual es lo peor**: «ni se lee porque está muy chiquito y no se puede agrandar» | El chat debe tener **tamaño cómodo**, poder **agrandarse** (pantalla completa o panel redimensionable) y ser legible en móvil y escritorio |
| 6 | «Está muy meh; **como yo lo había puesto estaba mejor**» | Referencia 5 (versión previa del integrante): pantalla «Buscar dónde vivir», con título y subtítulo («Cuatro preguntas breves; toma menos de un minuto»), globos de conversación, **«Pregunta 1 de 4»**, una pregunta por vez («¿Qué tan cerca te gustaría tener un centro de salud?»), escala de **estrellas de 1 a 5 con «No me importa»**, botones «Atrás» y «Continuar», y el mapa a la derecha. Es una elicitación **guiada y breve**, más clara que el chat libre actual |
| 7 | «Adjunto referencia, **colocar prioridad a cada cosa**» | Que la persona asigne **una prioridad a cada criterio** (salud, colegio, transporte, área verde…) de forma directa y simple |

## Referencias que el equipo adjuntó (descripción)

1. **Inicio (concepto):** fondo crema, icono de marca, «GEOVERIFICADOR · AREQUIPA», titular serif grande, subtítulo, botón azul «Comenzar recorrido →», nota sobre la guía de 6 pasos. Sin foto: el equipo pide agregarla.
2. **Estado actual con panel lateral:** panel «Ubica tu predio» (dirección, «Usar mi ubicación», ejemplo en la Plaza de Armas) y mapa a pantalla completa; barra superior con «Comparar», «Asistente» y «¿Cómo funciona?». Es lo que se quiere **ocultar**.
3. **Barra superior** con «Comparar» (contador), «Asistente» y «¿Cómo funciona?», y el control de capas.
4. **Chat actual en el mapa:** tarjeta pequeña con «Armar una búsqueda sin escribir», búsquedas rápidas, caja de texto y «Enviar». Es lo que se considera **demasiado pequeño** y ilegible.
5. **Versión previa del integrante («estaba mejor»):** flujo guiado de cuatro preguntas con estrellas y mapa a la derecha, descrito en el punto 6.

## Cómo conviene leerlo (y dónde puede chocar con la especificación)

- **El pedido encaja con el diseño:** el chat pasa a ser el centro, y «prioridad a cada cosa» es el punto de partida de la elicitación de pesos (pantalla 4 de `01`).
- **Estrellas de 1 a 5 frente a swing weighting:** las estrellas son fáciles pero **no fijan un rango real** ni distinguen «cuánto más»; la evidencia [E1][E3] favorece el swing con rangos concretos. **Propuesta para evaluar (decisión abierta):** usar las estrellas como **primera pasada rápida** (rápida, ordinal, con «No me importa») y ofrecer después el refinamiento por swing solo donde la persona lo pida o donde el ranking sea sensible.
- **Cuatro preguntas** son pocas frente a los criterios que existen (servicios, entorno, anclas). Decidir **cuáles** y **cómo se amplía** sin cansar.
- **Buscar por punto escondido** no debe quitar la ficha del predio de las pantallas 6 y 8: sigue siendo el «detalle» al que se llega desde un resultado del chat.
- **El tutorial ya existe** (6 pasos, `tour.js`); hay que **rediseñarlo** para que sea el segundo momento del recorrido y no una ventana emergente aparte.
- **Chat grande y legible** debe respetar las reglas duras de `skill/` (cifras con fuente, estados con icono y texto, 44 px).
