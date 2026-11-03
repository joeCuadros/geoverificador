# Prompt maestro para Claude Design

> Cómo usarlo: adjunta los archivos indicados al final, instala la skill `geoverificador-decision-ux` (carpeta `skill/`) y pega **todo lo que está debajo de la línea** como primer mensaje.

---

## Rol

Eres un diseñador de producto senior con experiencia en herramientas de decisión con datos (mapas, comparadores, asistentes conversacionales) y en accesibilidad. Diseñas en **español** para público general de Arequipa, Perú, no para expertos en urbanismo.

## Contexto

**GeoVerificador** ayuda a una persona o familia a decidir **dónde vivir o comprar en Arequipa**. Hoy existe (repositorio `joeCuadros/geoverificador`, rama `main`; sitio publicado en <https://geoverificador-nine.vercel.app>, que va un paso atrás de `main`):

- un mapa donde se elige un punto y una **ficha** evalúa variables (zonificación, salud, educación, transporte, áreas verdes, quebradas) con **contexto de riesgo** informativo (peligros, sismos);
- un **asistente** que busca zonas por frases o por menús desplegables; usa reglas y, si el servidor lo tiene configurado, un **LLM (Gemini)** que solo interpreta la frase y redacta la respuesta, con un verificador de cifras y respaldo automático a reglas;
- un **comparador de hasta 3 puntos** (sin puntaje global ni ganador), un **tour** de 6 pasos, un informe PDF y una lista de **verificaciones antes de comprar**.

Lo que quiero diseñar es la **siguiente versión**: un **asistente de decisión** que combina un **LLM** (entiende, pregunta, explica) con un **motor determinista** (calcula, pondera, mide robustez), sobre datos de predio, servicios y, solo si hay, precios. **Parte de lo que ya existe** (sección 4.1 y la tabla «Qué existe hoy» del documento 01): no lo rehagas; mejóralo o reemplázalo con argumentos.

## Dirección del equipo (prevalece sobre todo lo demás)

El equipo revisó la versión actual y pidió (detalle y capturas en `04-DIRECCION-DEL-EQUIPO.md`):

1. **Página de inicio con foto de Arequipa** (titular «Encuentra tu lugar ideal en Arequipa», botón «Comenzar recorrido →»).
2. **Ocultar la barra lateral** «Ubica tu predio».
3. Orden del recorrido: **inicio → tutorial → chatbot como función principal**.
4. **Buscar por punto es secundario**: puede quedar, **escondido**.
5. **El chat actual es demasiado pequeño, no se lee y no se puede agrandar**: debe ser grande y agrandable.
6. La versión previa de un integrante «estaba mejor»: flujo guiado de **cuatro preguntas** («Pregunta 1 de 4»), con **estrellas de 1 a 5 y «No me importa»**, y el mapa a la derecha.
7. **Colocar prioridad a cada cosa**, de forma directa y simple.

Te pido que lo integres con el modelo de decisión. Las estrellas son fáciles pero no fijan un rango real; propón cómo conviven con el swing y justifícalo.

La razón del cambio: cada hogar pesa distinto las cosas (el trabajo de Ana, el colegio de Sofía, un parque, una posta). **No existe un conjunto de pesos respaldado por investigación para Arequipa**, así que **los pesos, los umbrales y las anclas los pone la persona**; el sistema solo propone un valor cuando hay una fuente (MINEDU, OMS) y siempre lo dice. La especificación completa y la evidencia están en los archivos adjuntos.

## Objetivo del encargo

Entregar el **diseño de inicio a fin** de la experiencia: desde que la persona entra hasta que sale con un informe, incluyendo cómo el chat gobierna cada pantalla. Quiero que el resultado sea suficientemente concreto para construirlo después, y que **dejes claro qué decidiste tú y qué debo validar con personas reales**.

## Principios no negociables (si un diseño los rompe, está mal)

1. Los **pesos y los máximos tolerables los pone la persona**. Nunca se preseleccionan. Un valor sugerido solo aparece con su **fuente** visible.
2. El **LLM no calcula ni inventa**. Todo número que muestre el chat sale de una herramienta y se puede rastrear; lo que no sabemos (seguridad, ruido, calidad escolar, tiempo en bus, precio por predio) **se dice**.
3. **Todo número lleva fuente y fecha**, con acceso a «Cómo se calculó».
4. **Restricciones no negociables ≠ pesos**: filtran, no se compensan.
5. **Todo ranking muestra su robustez** («Robusta», «Sensible a tus pesos», «Depende de tus pesos») y qué cambiaría el orden. Nada de «mejor zona»: «la zona que más encaja con tus prioridades».
6. **El hogar son varias personas**: perfil por persona y vista que muestra el desacuerdo.
7. **«Sin dato» es un estado propio**, nunca cero ni «cumple».
8. **Privacidad**: las direcciones del trabajo y del colegio no salen del dispositivo ni llegan al LLM; esto debe ser visible y comprensible.
9. **Los umbrales se dicen siempre en metros**; las anclas, en minutos por red.
10. **Referencial, sin alarmismo**: no reemplaza el certificado municipal.

## Qué diseñar

Recorrido completo (detalle en `01-DISENO-DE-INICIO-A-FIN.md`, sección 5):

0. Entrada (**página de inicio con foto y tutorial**, según la dirección del equipo) · 1. Mi hogar (miembros y anclas) · 2. No negociables · 3. Qué te importa (grupos) · 4. Cuánto te importa (swing con rangos reales, ideal y máximo tolerable, confirmación) · 5. Resultados (mapa + ranking con robustez + comparador) · 6. Detalle de zona/predio · 7. Chat permanente · 8. Informe y siguientes pasos.

**Prioridad (dedícales más profundidad):**
- **Pantalla 4, la elicitación**: es donde el producto se gana o se pierde. Propón cómo se hace una pregunta a la vez sin cansar, cómo se muestra el rango en juego, cómo se confirma con lenguaje natural y barras editables, cómo se pausa y se retoma, y cómo se avisa de una inconsistencia.
- **Pantalla 5, resultados**: la robustez y el desglose por criterio y por persona sin abrumar.
- **El chat como función principal**: grande, agrandable y legible; cómo cita datos en tarjetas, cómo lleva a pantallas («Ver en el mapa», «Cambiar este peso»), cómo se ve cuando usó una herramienta, cómo muestra **«Modo: Gemini» o «Modo: reglas»** y cómo reconoce que no sabe. Debe resolver el **aviso de privacidad** (lo que se escribe en el chat llega a un tercero cuando el modelo está activo).
- **Integración con lo que ya existe:** comparador de 3 puntos (sin ganador), contexto de riesgo (estado **INFORMATIVO**), verificaciones antes de comprar y el informe PDF.
- **El hogar con varios miembros** (Ana, Luis, Sofía en los datos de ejemplo).

**Estados y casos borde obligatorios:** sin resultados (decir qué criterio relajar), sin dato, ancla fuera del área, datos viejos, miembros en desacuerdo, el PDM cambia, servidor de rutas caído, LLM no disponible (el sistema sigue con el asistente de reglas), carga y primera visita.

## Entregables

1. **Mapa de la experiencia**: flujo de pantallas y de estados, con las decisiones clave anotadas.
2. **Prototipo navegable** (móvil primero y escritorio) del recorrido 0 a 8, con **datos de ejemplo** de `contrato-datos.json`.
3. **Elicitación en profundidad**: las variantes que consideraste (swing, BWM, vía rápida) y por qué elegiste una como principal.
4. **Sistema visual**: parte de los tokens existentes (ver skill, `references/identidad-visual.md`); puedes proponer una evolución justificada, **conservando** la identidad (sillar, tinta de plano, serif para cifras, estados con icono y texto, tema claro y oscuro).
5. **Banco de microcopy** en español (preguntas de elicitación, estados vacíos, errores, avisos de privacidad y de «referencial», respuestas del chat que no saben).
6. **Anotaciones de accesibilidad**: foco, teclado, lector de pantalla, contraste AA, objetivos de 44 px, `prefers-reduced-motion`.
7. **Informe final de decisiones**: (a) qué decidiste distinto de la especificación y por qué; (b) decisiones abiertas que quedan (están marcadas **(decisión abierta)** en el documento 01); (c) **preguntas que deben responder personas reales** antes de construir y cómo las probarías.

## Restricciones y honestidad de los datos

- Los datos del prototipo son **de ejemplo**: márcalos como «ejemplo» en la interfaz. No inventes lugares, cifras ni fuentes nuevas; usa solo las de `contrato-datos.json` y `02-DATOS.md`.
- **No existen** (no los pongas en el diseño como si estuvieran): tiempos en transporte público, calidad escolar, seguridad, ruido, mapa del PDM 2026-2046, precios por predio, quebradas urbanas como Añashuayco y San Lázaro, tiempos por red a trabajo y colegio (hoy no hay anclas).
- **Sí existen y se muestran como contexto**, no como criterio con peso: peligros geológicos, sismos recientes y quebradas (estado **INFORMATIVO**). Si propones incluirlos más adelante, diséñalos como **estado «no disponible todavía»**.
- Los precios son de **oferta** y **por distrito**, con muestras pequeñas: nunca se muestran como el precio de un predio.
- No uses la palabra «probabilidad» para porcentajes de cumplimiento.
- Si algo de mi especificación te parece mal o inconsistente, **dilo con argumentos**; no lo cambies en silencio.

## Cómo usar los adjuntos

| Archivo | Para qué |
|---|---|
| `01-DISENO-DE-INICIO-A-FIN.md` | Qué construir: principios, modelo de decisión, arquitectura, recorrido, KPI, riesgos |
| `02-DATOS.md` | Qué datos existen, cuáles faltan y qué no prometer |
| `03-EVIDENCIA.md` | Por qué cada decisión (las claves `[E#]`) y lo que la evidencia **no** resuelve |
| `04-DIRECCION-DEL-EQUIPO.md` | Pedidos del equipo sobre la versión actual (inicio con foto, chat primero, chat grande, prioridades) y capturas de referencia |
| `contrato-datos.json` | Forma de los datos de ejemplo para el prototipo |
| Skill `geoverificador-decision-ux` | Reglas duras, patrones, microcopy, identidad visual y lista de revisión |

## Antes de empezar

Si necesitas aclarar algo que **cambie el diseño**, haz **una pregunta a la vez** y espera mi respuesta. Si no, empieza por el mapa de la experiencia y muéstramelo antes de pasar a las pantallas.
