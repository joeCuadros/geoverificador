# Evidencia: qué dice la investigación y qué decisión de diseño sale de cada cosa

> Fecha de la revisión: 2026-11-02. Las cifras salen de resúmenes y extractos de los artículos, **no de los textos completos**. Confirmar antes de citar un número exacto en un informe.
> La clave `[E#]` se usa en los demás documentos de esta carpeta.

## Idea central

La literatura no entrega pesos «correctos» para elegir dónde vivir en Arequipa: la importancia de cada factor **depende de la persona y del hogar**, y los pocos valores publicados vienen de otros países. Por eso el sistema **no trae pesos por defecto**: los pone la persona, con un método de elicitación respaldado, y el sistema solo propone valores cuando hay una fuente que los respalde (por ejemplo, los radios del MINEDU).

## 1. Cómo ponderar (pesos)

| Hallazgo | Fuente | Decisión de diseño |
|---|---|---|
| Entre los métodos de elicitación de preferencias evaluados (13 elegidos como prometedores), **el swing weighting obtuvo el mejor desempeño global** entre los de calificación; AHP y la escala visual análoga también salen bien. | [E1] Whichello et al. (2020) | Método principal de pesos: **swing weighting**, con rangos reales de los datos locales. |
| **AHP y BWM tienen menos «sesgo de igualación»** (tendencia a dar el mismo peso a todo) que SMART, Swing y reparto de puntos, y **estructurar el problema en jerarquía reduce ese sesgo en los cinco métodos**. | [E2] Rezaei et al. (2021), 146 estudiantes, elección de modo de transporte | **Estructura jerárquica obligatoria** (grupos → criterios). **BWM** como segundo método (pocas comparaciones: mejor y peor criterio). |
| En una comparación de cuatro métodos de ponderación, los métodos de razón y swing fueron consistentes entre sí, pero con **problemas de validez externa**; el de *trade-off* tuvo la peor consistencia interna. | [E3] Borcherding et al. (1991) | No tratar un solo método como verdad: **mostrar los pesos de vuelta a la persona para que los confirme** y permitir corregir. |
| Swing weighting y experimentos de elección discreta (DCE) **comparten sesgos**; el DCE es propenso a heurísticas simplificadoras con muchos atributos. Entre DCE y swing aparecen **diferencias significativas** en los pesos, y el DCE concentra más peso en un atributo. | [E4] Tervonen et al. (2017); [E5] Veldwijk et al. (2024) | No prometer que el peso es «el verdadero». Informar el método usado. DCE queda como mejora futura (necesita muestra y diseño). |
| DCE y *best-worst scaling* **no son intercambiables** (pueden medir constructos distintos). | [E6] Whitty y Gonçalves (2017) | No mezclar métodos dentro de un mismo perfil sin avisar. |
| Los pesos de swing **dependen de los rangos** que se comparan. | Principio del método [E1][E3] | Cada pregunta de swing muestra el rango concreto («de 1,5 km a 300 m del parque»). Los rangos salen de los datos locales. |

## 2. Cuando los pesos son inciertos: robustez

| Hallazgo | Fuente | Decisión de diseño |
|---|---|---|
| **SMAA-2** explora el espacio de pesos y reporta, para cada alternativa, **con qué parte de los pesos posibles queda en cada lugar** (índice de aceptabilidad de rango) y los pesos «centrales» que la favorecen. Sirve cuando las preferencias son imprecisas. | [E7] Lahdelma y Salminen (2001); Tervonen y Figueira (2007) | Cada ranking trae una **etiqueta de robustez**: «el orden se mantiene si cambias tus pesos hasta ±X» o «depende de tus pesos». Se calcula con muestreo de pesos (Monte Carlo) en el motor. |

## 3. Elegir dónde vivir: qué pesa y cómo se mide

| Hallazgo | Fuente | Decisión de diseño |
|---|---|---|
| Los atributos de transporte tienen efecto significativo en la elección de ubicación residencial; **la calidad de la escuela** tiene efecto positivo. | [E8] Pagliara, Preston y Kim (2006), Oxfordshire | Calidad escolar y viaje al trabajo son criterios habituales. Hoy el sistema **no tiene calidad escolar**: declararlo. |
| Las distancias se expresan mejor **en tiempo de viaje**, porque así las percibe la gente; el equilibrio entre «verde» y «accesibilidad» **cambia según el tipo de vivienda** (departamento, casa). | [E9] Li, Ossokina y Arentze (2024), Países Bajos | Las **anclas se miden en minutos por red**, no en línea recta. Preguntar el tipo de vivienda y no suponer que todos valoran igual. |
| Las preferencias de cada miembro del hogar **difieren estadísticamente de las del hogar**: la hipótesis del «miembro representativo» **no se sostiene**. | [E10] Marcucci, Rotaris y Danielis (2010) | **Perfil por persona** y vista de hogar. No promediar a ciegas; mostrar el desacuerdo. |
| La accesibilidad al trabajo **específica de cada persona** es la consideración más crítica; la accesibilidad a actividades no laborales **también aporta** una vez controlado el trabajo. Hay que reconciliar necesidades de cada persona con la decisión del hogar. | [E11] Lee, Waddell, Wang y Pendyala (2010) | Una **ancla de trabajo por persona** más anclas no laborales (colegio, cuidado, familia). |
| No todas las personas tienen «ancla» de casa, trabajo o colegio; **los padres con hijos pequeños tienen restricciones extra**. | [E16] Zhang et al. (2022) | Anclas **opcionales y editables**; no forzar un trabajo fijo. |
| Las medidas «integrales» de accesibilidad con **un solo origen** ignoran el encadenamiento de viajes. | [E18] Kwan (1998) | Declarar el límite: el sistema evalúa **cada ancla por separado**, no cadenas de viajes. |
| El «espacio-tiempo de acción» (todos los lugares de trabajo/estudio del hogar y el tiempo para llegar) describe el acceso de adultos y niños; hay estudio en **Bogotá**. | [E17] Demoraes, Gouëset y Souris (2023) | Antecedente latinoamericano del concepto de múltiples anclas. |

## 4. Distancias aceptables (cuando la persona no sabe qué poner)

| Hallazgo | Fuente | Uso |
|---|---|---|
| El punto en que **más desalienta caminar al colegio** está entre **1 y 3 km**; los umbrales publicados varían de **875 m a 4 km**. | [E12] Rashidi, Kent y Moylan (2025), 6 629 estudiantes, Australia | Contexto que se **muestra** al elegir el máximo tolerable. **No es un valor por defecto.** |
| La elasticidad del caminar al colegio respecto del tiempo de caminata es **−0,75**. | [E13] McDonald (2007), EE. UU. | Contexto. |
| Muchas caminatas superan el umbral clásico de ¼ de milla (~400 m) y **la mayoría de los viajes a pie cubren menos de 3 km**. | [E14] Iacono, Krizek y El-Geneidy (2008) | Contexto; apoya que 400 m sea conservador. |
| Se usa **≤ 2,25 km** como «distancia caminable» al colegio en adolescentes. | [E15] Mandic et al. (2023), Nueva Zelanda | Contexto. |
| Radios oficiales de influencia: **inicial 500 m, primaria 1 500 m, secundaria 3 000 m** (referenciales; la propia norma pide contrastarlos con topografía y accesibilidad). | Instructivo FTE del MINEDU, Cuadro N.° 4 (RVM 104-2019 y 208-2019): <https://www.mef.gob.pe/contenidos/inv_publica/docs/ficha_tecnica/educacion/2_INSTRUCTIVO_FTE_EBR_MINEDU.PDF> | **Único default con fuente oficial peruana**. Se muestra con su fuente y se puede cambiar. |
| Área verde de ≥ 0,5 ha a ≤ 300 m (meta de planificación de la OMS, no umbral sanitario probado). | OMS Europa (2016); Mudu et al. (2016) | Default con fuente; editable. |

**Regla del sistema:** un valor por defecto solo se precarga si tiene fuente. Para el resto (por ejemplo, el máximo tolerable al trabajo) **se pregunta**. Lo que hoy es «convención del proyecto» (salud 1000 m, paradero 400 m, borde de zona 20 m) se marca como tal y es editable.

## 5. Combinar un LLM con un modelo de decisión

| Hallazgo | Fuente | Decisión de diseño |
|---|---|---|
| Probados en MCDM (método DEX), ChatGPT y DeepSeek **ayudan a estructurar criterios y reunir datos**, pero **fallan en ejecutar el método completo**: **cambian de reglas entre mensajes**, cometen errores de cálculo y **sugieren preferencias «generalizadas» que pueden diferir de las del usuario**. Proponen un flujo híbrido: LLM para ideación, software especializado para el cálculo. | [E19] Bohanec, Rajkovič y Rajkovič (2025) | **El LLM no calcula ni decide.** El estado (criterios, umbrales, pesos) vive en el motor y se reinyecta en cada turno. **Nunca se precargan pesos que sugiera el LLM.** |
| Las alucinaciones suenan coherentes y generan **sesgo de automatización**; quien no conoce el tema las detecta peor. | [E20] Passerini et al. (2025) | Todo número del chat debe ser **trazable a una herramienta**; si no lo es, no se muestra. |
| Un esquema que une un LM con diseño experimental bayesiano (**OPEN**) elige preguntas más informativas que un LM solo, y **un LM solo es peor aprendiendo preferencias**. | [E21] Handa et al. (2024) | **El motor elige la siguiente pregunta** (la más informativa) y el LLM solo la redacta y la contextualiza. |
| Hay trabajo reciente que hace que un LLM recorra el flujo completo de AHP con mejor alineación frente a expertos (solo se leyó el resumen). | [E22] Han, Benamara y Zaraté (2026) | Posible línea futura; **no** se usa en el MVP. |
| La detección y mitigación de alucinaciones en decisiones exige medir **cumplimiento de restricciones**, relevancia y plausibilidad. | [E23] Chakraborty et al. (2025) | Verificador posterior: compara números y nombres del texto con la salida de las herramientas. |

## 6. Datos que se pueden conseguir (precios y rutas)

| Hallazgo | Fuente | Decisión |
|---|---|---|
| Existe un conjunto abierto (**CC BY 4.0**) con **precios de oferta por distrito** en Perú, que incluye Arequipa (p. ej. Cayma, departamentos: mediana S/ 700 000, S/ 4 905/m², 119 avisos, al 18/10/2026). Son **precios pedidos, no de cierre**, y varios distritos tienen pocos avisos (30 a 120). | [E24] Aptología (2026), <https://huggingface.co/datasets/aptologia/microestudios-vivienda-peru-2026> | Usar **solo como contexto distrital** («rango de precios de oferta»), con aviso de muestra pequeña. No por predio. |
| Los índices del BCRP de precios por m² cubren **12 distritos de Lima**, no Arequipa. | [E25] BCRP | No sirven para este proyecto. |
| Un reporte de mercado de Arequipa de otro portal tiene **cifras internas contradictorias** (promedios de USD 1 215/m² y de «USD 7K/m²» en la misma página). | Doomos | **No usar.** |
| Hay actores comerciales que raspan portales inmobiliarios peruanos. Los **términos de uso de esos portales no se verificaron**. | Apify (Urbania) | **No recomendar raspar portales** sin revisar sus términos y la ley de datos personales. |
| Los servidores públicos de rutas son de demostración: Valhalla (FOSSGIS) pide uso justo, ~1 solicitud por segundo y **«no es para producción»**; el demo de OSRM prohíbe uso intensivo; OpenRouteService tiene cuotas y sus resultados se licencian CC BY-SA 4.0. Se recomienda **autoalojar**. | [E26] Valhalla, OSRM, OpenRouteService, wiki de OSM | Rutas y matrices de tiempo con **servidor propio** (Valhalla u OpenRouteService) cargado con el extracto de OSM de Perú. |
| El ruteo de **transporte público** necesita horarios (GTFS). En Arequipa el transporte es en gran parte informal y **no encontré un GTFS** (no verificado). | Wiki de OSM | **No prometer tiempos en bus.** Tratar el transporte público como «paradero cercano», no como ruta. |

## 7. Lo que la evidencia NO resuelve

- No hay estudio que dé **pesos por defecto** para hogares de Arequipa. Los valores monetarios del tiempo de viaje (Oxfordshire, Utah, Vancouver) **no son transferibles**.
- No se encontró evidencia sobre **qué pregunta de elicitación entienden mejor** los usuarios de este perfil en Perú: hay que probarlo con personas.
- La calidad escolar, la seguridad y el ruido **no están en los datos** (la seguridad está fuera de alcance, aunque la literatura dice que pesa).
- La capacidad de un LLM de redactar explicaciones fieles **debe medirse en este sistema**, no suponerse (ver KPI de trazabilidad numérica en `01-DISENO-DE-INICIO-A-FIN.md`).
