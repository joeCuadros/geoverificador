# Diseño de inicio a fin: asistente de decisión para elegir dónde vivir

> Estado: **especificación para diseñar**, no código. Referencia: rama `main` en el commit `c9508f7` (2026-11-02, tras el PR #7). Este documento parte de lo que **ya existe** (sección 6) y define lo que falta.
> Las claves `[E#]` remiten a `03-EVIDENCIA.md`. Lo marcado **(decisión abierta)** puede cambiarse al diseñar.
> Lo que existe se resume así: ficha de variables, asistente de reglas, **capa opcional con Gemini** (interpreta y redacta, con verificador y respaldo a reglas), **comparador de hasta 3 puntos**, quebradas/sismos/peligros como **contexto informativo**, tour de inicio y lista de verificaciones. Lo que este diseño **añade** y no existe: perfil de hogar con anclas por persona, tiempos por red, funciones de valor con ideal y máximo tolerable, elicitación de pesos, robustez del ranking y verificador numérico estricto.

## 1. Qué problema resuelve

Una persona o familia quiere decidir **dónde vivir o comprar en Arequipa** y hoy compara a ojo. Cada hogar pesa distinto la cercanía al colegio, al trabajo, a un parque o a una posta. El sistema debe:

1. recoger **sus** requisitos, anclas y prioridades (no las de un modelo);
2. evaluarlos con **datos verificables** (zonificación, servicios, rutas, y precios solo si es posible);
3. mostrar **qué zonas o predios encajan mejor**, cuán **robusto** es ese orden y **por qué**;
4. responder en lenguaje natural sin inventar nada.

**No es:** un dictamen de compra, un tasador, ni un sustituto de los certificados municipales (Certificado de Parámetros Urbanísticos y Edificatorios, vigencia de 36 meses, y Certificado de Zonificación y Vías).

## 2. Principios no negociables

1. **Los pesos y los umbrales los pone la persona.** El sistema solo propone un valor si tiene **fuente** (MINEDU, OMS) y lo muestra como «sugerido por X; cámbialo». Si no hay fuente, **pregunta**. [E1–E6]
2. **El LLM no calcula, no decide y no inventa datos.** Entiende, pregunta, redacta y explica; los números salen del motor. [E19][E20]
3. **Todo número tiene fuente y fecha** y se puede abrir («cómo se calculó»).
4. **Restricciones duras ≠ pesos.** Lo no negociable (p. ej. no vivir en zona de riesgo muy alto) **filtra**; no se «compensa» con puntos.
5. **Robustez antes que falsa precisión.** Un ranking se presenta con su nivel de robustez frente a cambios de pesos. [E7]
6. **El hogar son varias personas.** Perfil por persona y vista de hogar; no se promedia a ciegas. [E10][E11]
7. **Decir «sin dato» y «no sé».** Un vacío se muestra como vacío, nunca como cero ni como «cumple».
8. **Minimización de datos personales.** Direcciones de trabajo y colegio **no salen del dispositivo ni llegan al LLM**; el LLM solo ve identificadores («ancla_trabajo_ana») y tiempos derivados.

## 3. Modelo de decisión

### 3.1 Alternativas
- **Zonas:** celdas de 250 m sobre las zonas construibles del plano, agrupadas por distrito (ya implementado).
- **Predios:** un punto elegido en el mapa (ya implementado: la ficha de 5 variables).

### 3.2 Variables

| Tipo | Variables | Quién fija qué |
|---|---|---|
| **Fijas** (siempre se evalúan; **no pesan**: filtran o avisan) | Zonificación vigente (zona, si es construible, parámetros); estado del plan (PDM 2016-2025 vencido, PDM 2026-2046 sin aprobar); zonas `ZRE-RI1/RI2` (riesgo) | La norma. La persona puede elegir **excluir** categorías. |
| **Contexto informativo** (se muestra, **nunca pesa**) | Peligros geológicos cercanos (INGEMMET, radio 500 m); sismos recientes (IGP, radio 100 km); quebradas y ríos mientras la persona no fije una distancia | Hoy ya existe como estado «INFORMATIVO». Solo pasa a criterio si la persona fija una distancia mínima (no hay una oficial). |
| **Base** (criterios con peso) | Salud; educación por nivel (inicial, primaria, secundaria); transporte (paradero); área verde; campiña; zona residencial; **lejos de quebradas** (con distancia que fija la persona) | La persona fija **peso, ideal y máximo tolerable**. Defaults solo donde hay fuente. |
| **Anclas** (criterios con peso, **por persona**) | Tiempo por red a: trabajo de cada adulto, colegio de cada hijo, cuidado/familia, otros fijos | La persona define ubicación, modo, ventana horaria, máximo tolerable y peso. |
| **Opcionales** (si hay datos) | Rango de precios de oferta **del distrito** [E24]; calidad escolar (hoy no existe); seguridad (fuera de alcance) | Presupuesto como **restricción**, no como peso. |

### 3.3 Funciones de valor (cómo un número se vuelve «qué tan bien»)
Para cada criterio, valor entre 0 y 1 con dos parámetros de la persona:
- **ideal:** hasta aquí vale 1;
- **máximo tolerable:** desde aquí vale 0;
- entre ambos, baja de forma lineal **(decisión abierta: curva suave)**.

El «ideal» puede venir con fuente (p. ej. 500 m para inicial, MINEDU). El «máximo tolerable» **siempre lo elige la persona**; el sistema le muestra contexto (p. ej. «los estudios sitúan entre 1 y 3 km el punto en que más desalienta caminar al colegio» [E12]) pero **no lo precarga**.

### 3.4 Agregación
- Se aplican primero las **restricciones duras** (filtran alternativas).
- Después, **suma ponderada** de los valores, con pesos que suman 1, **por persona**.
- **Vista de hogar:** muestra el puntaje de cada miembro lado a lado y dónde discrepan. El «puntaje del hogar» solo existe si el hogar fija explícitamente cuánto pesa cada miembro **(decisión abierta)**. [E10]
- No hay un «puntaje global» escondido: el desglose por criterio y por persona está siempre a un clic.

### 3.5 Robustez
Se muestrean pesos compatibles con lo que la persona declaró (orden y rango ±X) y se mide en qué fracción el top-1 se mantiene. Etiquetas: **«Robusta»**, **«Sensible a tus pesos»**, **«Depende de tus pesos»**. El umbral de cada etiqueta es editable y está documentado **(decisión abierta)**. [E7]

### 3.6 Elicitación de pesos (el corazón de la experiencia)
Flujo en capas, siempre **jerárquico** [E2]:

1. **Grupos:** *Movilidad diaria* (anclas, transporte) · *Servicios cercanos* (salud, colegios) · *Entorno* (verde, campiña, tranquilidad) · *Norma y precio* (zonificación, presupuesto).
2. **Orden:** ordenar los grupos de más a menos importante (rápido, ordinal).
3. **Cuánto más:** por defecto **swing weighting** con rangos **reales** («de a 1,5 km a a 300 m del parque, ¿qué mejora te importa más?») [E1][E3]. Alternativa: **BWM** (mejor y peor criterio, pocas comparaciones) [E2].
4. **Verificar:** el sistema devuelve los pesos en lenguaje natural y con barras («el colegio pesa el doble que el parque») y la persona confirma o corrige. Se avisan **inconsistencias** (p. ej. dijo que A > B, B > C y C > A).
5. **Guardar** el perfil en el dispositivo (sin servidor), exportable.

El LLM puede **conducir esta conversación**, pero **la siguiente pregunta la elige el motor** (la más informativa) y el LLM solo la redacta [E21]. Cada respuesta se convierte en **JSON estructurado** y se valida; si el LLM propone un peso, se descarta.

## 4. Arquitectura: qué hace el LLM y qué hace el motor

```
Persona ──▶ Interfaz (chat + pantallas) ──▶ Orquestador (función de servidor)
                                              │
                          ┌───────────────────┼────────────────────┐
                          ▼                   ▼                    ▼
                    LLM (Claude)        MOTOR DETERMINISTA     DATOS
                 entender · preguntar    filtros · valores ·    zonificación · OSM
                 explicar · traducir     pesos · robustez ·     rutas (servidor propio)
                          │              trazabilidad           precios distritales
                          └────── herramientas (tool use) ◀────┘
                                              │
                                    Verificador de salida
```

**Herramientas que el LLM puede llamar (propuesta):**

| Herramienta | Qué hace | Devuelve |
|---|---|---|
| `leer_perfil` / `actualizar_perfil` | Lee y modifica anclas, restricciones y pesos **ya validados** | Perfil actual |
| `siguiente_pregunta` | El motor elige la pregunta de elicitación más informativa | Pregunta estructurada |
| `evaluar_predio` | Las 5 variables de un punto + tiempos a las anclas | JSON con fuente y fecha por dato |
| `buscar_zonas` | Ranking de distritos o zonas con robustez | JSON ordenado |
| `explicar_resultado` | Desglose por criterio y persona | JSON |
| `precio_distrito` | Rango de oferta del distrito (si hay dato) | JSON con tamaño de muestra |
| `consultar_norma` | Recupera fragmentos del reglamento o de normas con cita | Texto y fuente |

**Reglas anti-alucinación:**
1. **Toda cifra del texto** debe estar en la salida de una herramienta de ese turno. Un **verificador** compara números y nombres; si no coinciden, reemplaza la frase por una plantilla.
2. **El estado vive en el motor**, no en la memoria del modelo: criterios, umbrales y pesos se reinyectan en cada turno. [E19]
3. **Salida estructurada** (esquema JSON) para toda preferencia que el LLM extrae.
4. **Abstención:** si falta el dato, el modelo dice «no tengo ese dato» (seguridad, ruido, calidad escolar, buses).
5. **Citas obligatorias** cuando se explica una norma.

**Modelo (decisión abierta):** hoy la capa conversacional usa **Gemini** (`gemini-3.5-flash-lite` por defecto). El diseño debe ser **independiente del proveedor**: lo que importa es el contrato de herramientas y el verificador, no la marca del modelo. Validar costo y latencia antes de cambiar o mantener. Clave en variable de entorno del servidor; límite de uso por IP; sin guardar conversaciones.

### 4.1 Qué hace hoy la capa con LLM y qué falta (verificado en el código de `main`)

| Aspecto | Hoy en `main` | Lo que propone este diseño |
|---|---|---|
| Función del modelo | **Interpretar** la frase (llamada obligatoria a una única herramienta `consulta_asistente`, con validación de campos, enumeraciones y rangos) y **redactar** respuestas que no son búsquedas | Igual, ampliado a la elicitación de pesos y a explicar rankings |
| Quién calcula | El motor determinista del navegador (`asistente.js`) con datos congelados | Igual; más tiempos por red desde un servidor de rutas |
| Verificador de salida | `verificarTexto`: rechaza texto vacío, de más de 1 500 caracteres o con enlaces; **cifras** o **nombres propios** que no estén en los hechos; si se pierde la palabra «referencial»; recomendaciones de comprar, vivir o construir | Mantener; sumar trazabilidad por herramienta (K5) |
| Respaldo | Sin clave (503), error, tiempo agotado (8 s al interpretar, 6 s al redactar), spec inválido o texto que no pasa el verificador → **reglas** sin interrumpir. La cabecera dice «Modo: Gemini» o «Modo: reglas» | Mantener y hacerlo **visible y comprensible** |
| Resultados de búsqueda | **No** se reescriben con el modelo (siempre determinista) | Mantener |
| Pesos | La búsqueda usa **prioridad = 2, resto = 1** («coincidencia ponderada»), como convención del asistente. El comparador **no tiene pesos ni puntaje global** | Pesos que pone la persona, con elicitación y verificación; ver 3.6 |
| Privacidad | Al modelo viajan: el mensaje (≤ 300 caracteres, puede incluir lo que la persona escriba, como una dirección), hasta 6 turnos previos, si hay un punto y los criterios previos; al redactar, el texto determinista (nombre del distrito, zona, nombres de servicios cercanos, distancias, área de lote). **No** viajan coordenadas ni archivos de datos | Más estricto: solo identificadores de ancla y tiempos derivados; **avisar** que lo escrito en el chat llega a un tercero |
| Límite de uso | 20 solicitudes por minuto por IP, en memoria de cada instancia (no es un límite global) | Revisar si basta |
| Memoria del estado | Historial corto; el estado vive en el navegador | Perfil estructurado persistente en el dispositivo |

**Texto interno desactualizado en el repositorio** (no del diseño): el encabezado de `asistente.js` y el paso 4 del tour dicen que el asistente «no usa un modelo de lenguaje ni envía lo que escribes»; eso ya no es cierto cuando Gemini está activo. El diseño debe resolverlo con un aviso de privacidad honesto.

## 5. Recorrido de la persona, de inicio a fin

> **Dirección del equipo (2026-11-03, prevalece sobre la tabla):** el orden es **página de inicio con foto → tutorial → chatbot como función principal**. La búsqueda por punto pasa a ser **secundaria y escondida**; la barra lateral actual se oculta; el chat debe ser **grande y agrandable**. Detalle y referencias en `04-DIRECCION-DEL-EQUIPO.md`.

| # | Pantalla / estado | Qué logra | Notas de diseño |
|---|---|---|---|
| 0 | **Entrada** | Entiende qué hace y qué no; ve la privacidad | Dos caminos: «Quiero encontrar zonas» y «Quiero evaluar un predio» |
| 1 | **Mi hogar** | Miembros y anclas (trabajo, colegio, cuidado, otros) con modo y ventana horaria | Anclas opcionales; ubicación por dirección o clic; **no sale del dispositivo** |
| 2 | **No negociables** | Restricciones duras: excluir zonas de riesgo, tipo de uso, presupuesto distrital opcional | Se explica por qué una restricción **no se compensa** |
| 3 | **Qué te importa** | Elegir y ordenar los grupos | Ver sección 3.6 |
| 4 | **Cuánto te importa** | Swing o BWM con rangos reales; umbrales ideal y máximo; confirmación | Muestra siempre el **contexto con fuente** de cada umbral |
| 5 | **Resultados** | Mapa + ranking de zonas con **robustez**; comparador de 2 a 3 | Etiquetas de robustez; qué cambiaría el orden |
| 6 | **Detalle de zona / predio** | Ficha de 5 variables + tiempos a las anclas + fuente por dato | «Cómo se calculó» en cada tarjeta |
| 7 | **Chat** (panel permanente) | Preguntas, «¿y si el parque pesa menos?», explicaciones | **Maneja y explica todas las pantallas**; no es un juguete aparte |
| 8 | **Informe y siguientes pasos** | PDF, exportar perfil, trámites (certificados) | Recordar que es referencial |

**Qué existe hoy en cada pantalla** (para no rehacerlo; todo es mejorable):

| # | Hoy en `main` |
|---|---|
| 0 | Tour de 6 pasos (alcance, punto, tarjetas, asistente, comparar, verificar) en la primera visita; se reabre con «¿Cómo funciona?»; `?tour=no` lo desactiva |
| 1 | No hay perfil de hogar ni anclas. Hay «solo cerca de mi punto» (radio de 3 000 m) |
| 2 | Parcial: «Incluir zonas condicionales» y, en el comparador, «Mis umbrales» (solo distancia mínima a quebradas, sin valor por defecto) |
| 3 | El constructor «Armar una búsqueda sin escribir» (desplegables: qué quieres cerca, nivel educativo, lo más importante, distancia máxima) y búsquedas rápidas |
| 4 | **No existe**: la persona marca prioridades (peso 2 o 1) pero no hay swing, ni ideal/máximo, ni verificación |
| 5 | Búsqueda por distrito con % que cumple todo y coincidencia ponderada; **comparador de hasta 3 puntos** (tabla y tarjetas apiladas ≤ 480 px) con prioridades marcadas, filas por variable y dominancias que **no nombran un ganador** |
| 6 | Ficha de variables en tarjetas desplegables, con «Por qué, fuente y límites» |
| 7 | Panel de chat con modo Gemini o reglas, sugerencias y «Por qué, fuente y límites» |
| 8 | Informe PDF (con quebradas, contexto de riesgo y verificaciones) y lista de «qué debes verificar antes de comprar» (certificados, SUNARP, COFOPRI, licencias, servicios, peligros) |

**Casos borde que hay que diseñar:** ningún resultado (criterios muy exigentes → sugerir cuál relajar); ancla fuera del área; datos viejos; miembros en desacuerdo; PDM cambia; el servidor de rutas no responde; el LLM no está disponible (el sistema sigue funcionando con el asistente de reglas actual).

## 6. Qué ya existe (para no rehacerlo)

- Ficha de variables, mapa, flujo de 3 pasos, tema claro y oscuro, informe PDF. Sitio publicado: <https://geoverificador-nine.vercel.app> (**ojo:** esa versión se desplegó antes del PR #7; `main` tiene más).
- Asistente de **reglas** (`public/js/asistente.js`): entiende frases, busca zonas y ajusta («agrega…», «quita…», «prioriza…»). Sigue siendo el **plan B** cuando no hay modelo.
- Capa con **LLM** opcional (`public/js/asistente-llm.js`, `api/chat.js`, `api/_lib/gemini.js`, `src/chat.controller.ts`): ver 4.1.
- **Comparador** (`comparar.js`, `comparar-ui.js`): hasta 3 puntos, prioridades que marca la persona, sin puntaje global.
- **Contexto de riesgo** (`contexto.js`): peligros, sismos y quebradas; **Verificaciones** (`verificaciones.js`); **Tour** (`tour.js`).
- Datos y cálculos verificados (ver `02-DATOS.md`).

## 7. Cómo sabremos que funciona (KPI)

Se mantienen K1 a K4 del proyecto y se agregan dos propios del asistente de decisión:

| KPI | Qué mide | Criterio propuesto |
|---|---|---|
| K1 | Concordancia de zonificación con documentos oficiales | ≥ 90 % |
| K2 | Completitud de OSM frente a RENIPRESS y ESCALE | ≥ 70 % (convención) |
| K3 | Tiempo de respuesta (local ≤ 1 s; búsqueda ≤ 10 s; **chat**: a definir) | por módulo, mediana y p90 |
| K4 | Usabilidad (SUS) | ≥ 70 con 5 a 8 personas |
| **K5** | **Trazabilidad numérica del chat:** % de cifras del texto que aparecen en la salida de una herramienta | **100 %** (cualquier fallo se corrige) |
| **K6** | **Estabilidad de pesos:** acuerdo entre dos elicitaciones de la misma persona (test-retest) | a definir con la prueba piloto |

## 8. Fases

1. **Ya existe en `main`:** ficha, asistente de reglas, capa opcional con Gemini (interpreta y redacta con verificador y respaldo), comparador de 3 puntos, contexto de riesgo, verificaciones, tour.
2. **Fase 1:** perfil de hogar con **anclas** y **tiempo por red** (servidor de rutas propio); funciones de valor con ideal y máximo tolerable; elicitación por swing con confirmación; ranking con robustez.
3. **Fase 2:** ampliar el LLM de «interpretar y redactar» a **conducir la elicitación y explicar rankings**, con herramientas, perfil estructurado y verificador numérico por herramienta (K5).
4. **Fase 3 (si hay datos y muestra):** DCE, calidad escolar, precios por zona, seguridad.

## 9. Riesgos y lo que no se sabe

- **Costo y latencia del LLM**: no medidos.
- **Servidor de rutas propio**: hay que alojarlo y mantenerlo; hoy el frontend es estático y solo hay una función de servidor (`/api/chat`).
- **Privacidad del chat actual**: lo que la persona escribe llega a un tercero (el proveedor del modelo) y el texto de la interfaz dice lo contrario; hay que alinear el mensaje.
- **Límite de uso por IP en memoria**: se reinicia por instancia; no protege el costo si hay mucho tráfico.
- **Convención de peso 2 / 1** en la búsqueda: no tiene respaldo; convive con el comparador, que no usa pesos. El diseño debe unificar el criterio.
- **Pocos precios por distrito** y solo de oferta: pueden confundir si se muestran como «precio del predio».
- **Elicitación con personas reales**: no probada en Perú; puede ser larga o confusa.
- **Transporte público informal:** sin horarios no se pueden prometer tiempos en bus.
- **Datos personales** (direcciones de trabajo y colegio): requieren una decisión de privacidad y revisión legal antes de guardarlas en servidor.
