# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individuals and families deciding where to live or buy in Arequipa, Peru (Spanish-speaking, mostly on a phone, sometimes on a desktop). They arrive with a few priorities ("school nearby, a park, a bus stop") and no way to check them against official zoning and real service locations. A secondary audience is the project team and evaluators (GSTI course work). Inferred from the team's design brief; not re-confirmed by an interview.

## Product Purpose

GeoVerificador shows what the official zoning plan (PDM 2016-2025) and public services say about a point or a zone in Arequipa, measured against thresholds the person controls. It does not decide for the person: it states what meets their criteria, what does not, and what is unknown, with a source for every number. Success: a person can reach a shortlist of zones that fit their stated priorities and understand why, without leaving the chat.

## Positioning

Not a listings portal and not a score. It is a verifiable, source-backed fit check: every figure traces to a dataset or a norm, "no data" is its own state, and nothing ranks places with a hidden global score.

## Operating Context

- Static front end in `public/` (Leaflet map, vanilla JS), served by NestJS locally and by Vercel in production (https://geoverificador-nine.vercel.app).
- Chat assistant: deterministic rule engine plus an optional Gemini layer that only interprets and rephrases; it never invents figures and falls back to rules on any failure.
- Data: PDM 2016-2025 zoning polygons, health facilities (RENIPRESS, SUSALUD) and schools (ESCALE padrón, MINEDU) as the primary sources with OpenStreetMap only as a backup where no official point lies within 200 m, plus bus stops and green areas (OpenStreetMap); every facility shows its source and official code. Medical offices (consultorios, 162 from RENIPRESS plus 32 from OpenStreetMap, dental-only offices excluded by name in both sources) are a separate category from health facilities (256 plus 24): informative only, with no distance threshold (a pending product decision, `CONFIG.umbrales.consultorio` is `null`), so they show the nearest office and its distance, never pass/fail, never enter a score or the assistant zone search, and the chat never treats them as "health nearby"; deduplication against OpenStreetMap runs per category. The decision follows the OSM-versus-official check in `docs/VALIDACION.md` §3.4, INGEMMET hazards, IGP earthquakes, ANA quebradas. A precomputed grid of 2,358 cells backs the search criteria.
- Commerce is organized by need, not by OpenStreetMap tag, in three informative-only groups: **abastecimiento** (food supply, neighborhood scale: markets `amenity=marketplace`, 89, plus supermarkets `shop=supermarket`, 32 in the file and 31 counted, because one natural-products shop, Santa Natura, is excluded by name at runtime (`Calculos.COMERCIO_EXCLUIDOS`) from every group, so abastecimiento is 120; a supermarket inside a mall polygon is the supply point and says which mall it is in, the mall itself is not supply), **compras y ocio** (shopping and leisure, metropolitan scale: only the curated malls confirmed with a source URL, Mall Aventura, Real Plaza, OutletArauco, Arequipa Center; Mallplaza is confirmed but absent from OSM) and **comercio de barrio** (the remaining `shop=mall` features, i.e. galleries and small shopping centers, 47 of the 51). The grouping is computed at runtime by `Calculos.agruparComercio` from the existing `verificado` flag and the polygons (the geojson files are unchanged), and built by `pnpm datos:comercio` (one Overpass query, cached). Same rules as the consultorio: nearest element and distance, never pass/fail, no score, no zone search, and the thresholds `CONFIG.umbrales.abastecimiento`, `compras_ocio`, `comercio_barrio` (and `mercado`, `supermercado`, `mall`) are `null` pending a product decision (no sourced distance exists: the 2011 MVCS national urban standards draft sets population per facility, not meters). Distance to a mall or market polygon is measured to its edge. The chat answers "where can I buy food" and market/supermarket questions with abastecimiento, mall/shopping/outlet questions with compras y ocio, and gallery questions with comercio de barrio. The 2016 market census (CENAMA, INEI/PRODUCE) has no names or coordinates, so it is used only to compare counts per district (OSM and the census agree in 3 of 17 districts). The old chat shortcut "mall = near a PDM commercial zone" was removed.
- Combi/bus trips: "which combi takes me from this point to my work?" (`public/js/viaje.js`). Direct routes over OpenStreetMap route=bus relations (241, 12 SIT lines, ODbL, `pnpm datos:rutas-osm`; from/to, operator, duration and interval tags; the only route source: the former SmartBus layer, which had only verbal permission, was removed) plus 411 OSM bus stops linked to routes by proximity (25 m) and operator (partial: a route with no linked stop reads "paradas no mapeadas", no stop is ever invented) and an official SIT registry of 2017 (`public/data/sit_registro_oficial.json`: 12 business units, concessionaires and route codes from the Municipalidad Provincial de Arequipa; used only to validate OSM coverage: 10 of 12 units present, operator matches the contract in 231 of 231 routes). A route is direct if: a route is direct if it passes within 400 m on foot (the paradero threshold) of both points and the origin comes before the destination along the route (each relation is one direction; the opposite order is reported as "al revés"). Walking distance at each end and km on board are straight-line figures; no stop locations, no timetable, no transfers. Destinations come from `CONFIG.destinos` (Parque Industrial = OSM way/491224938 centre; Ciudad Blanca is a neighbourhood and a route terminus, not a company) or any geocoded address via the "Ir al trabajo" card. Opt-in zone search "zonas con ruta directa a X" runs on the same 250 m grid, is deterministic and separate from the criteria scoring (not a criterion, no score effect). Chat: "trabajo en el Parque Industrial", "tomo la C10", "el carro de Ciudad Blanca". Approximate travel time (not a measurement, assumptions always shown): walking = straight-line distance at the MUTCD design speed (1.07 m/s, no detour factor because no source applies to Arequipa), on board = the duration OSM tags for the whole route prorated by distance (null when OSM does not tag it), waiting = half the tagged interval, shown separately and not summed.
- Daily-life services (informative only), three more needs in the same commerce-by-need taxonomy: **finanzas** (banks `amenity=bank`, ATMs `amenity=atm`: 145 in the file), **comida fuera de casa** (restaurants and cafés: 631) and **recreación** (playgrounds `leisure=playground`: 49), from OpenStreetMap (ODbL, `pnpm datos:servicios`). Same rules as the rest of the commerce group: nearest element and distance, never pass/fail, no score, no zone search, thresholds `null`. Parks and gardens are NOT repeated here: they already are the "área verde" criterion (300 m, 0.5 ha, WHO Europe 2016), so "parque infantil" and "juegos infantiles" map to recreación while a plain "parque" stays the green-space criterion.
- Water (informative only), in the "Servicios básicos" card, map, chat and report: (a) the nearest SEDAPAR water collection point ("punto de acopio": a place where tanker-truck distribution was planned during a shortage; 575 points from a directory published on gob.pe on 2024-02-16 whose data are from April-June 2017, always labelled "datos de 2017"; not the network, not guaranteed water), (b) interruptions of the water service that SEDAPAR reported to SUNASS in the district (ODC-By, 2019-10 to 2024-04; yearly average over the complete years 2020-2023, partial years shown apart; hours counted once per interruption, never weighted by households; districts are not compared), (c) a buyer checklist: ask for the latest SEDAPAR and SEAL bills with the supply number, ask SEDAPAR about service feasibility (gob.pe procedure "Solicitar certificado de factibilidad para servicio de agua potable y alcantarillado"), and per-plot connection data is not public (Ley N.° 29733, Ley de Protección de Datos Personales). None says whether a plot has water.
- Block-level services from the census (informative only):
- Mining concessions (informative only): the INGEMMET Catastro Minero (GEOCATMIN, frozen copy, 425 polygons, no holder names) says whether the point lies inside a concession (titulada, en trámite, other; extinguished ones ignored) or how far the nearest one is. A concession is a right to explore and exploit the minerals, separate from the land (Ley General de Minería art. 9): it never says there is mining on the plot, who owns it or what can be built; the cadastre is referential. No threshold, no score, no zone search (`CONFIG.umbrales.mineria` is `null`); map layer, chat intent, report section.
- Electricity (informative only):
- Optional Google sign-in exists

## Capabilities and Constraints

- Criteria the assistant can search: health (facilities only, not consultorios, markets, supermarkets or malls), inicial, primaria, secundaria, colegio, transporte, area verde, residencial, tranquilo, campina, comercial, historico, lejos de quebradas (some are zoning approximations).
- Thresholds: 500/1500/3000 m for inicial/primaria/secundaria are the referential distances of MINEDU's design norms (RVM 104-2019 and RVM 208-2019, article 7.1, Cuadro N.° 1); 300 m and 0.5 ha for green space is the WHO Europe (2016) monitoring indicator, not a Peruvian norm; others are project conventions. Weights and tolerances belong to the person; no unsourced default.
- Not available and must be stated honestly: security, noise, school quality, bus travel times, per-property prices.
- Hazards, quakes and quebradas are informative context, not criteria, unless the person sets a distance.
- Comparator holds up to 3 points and never names a winner.
- Privacy: coordinates and data files stay local; with Gemini on, the chat text goes to the model provider. UI copy must say so.
- Open decision: 1-5 stars as a first ordinal pass versus real weighting.

## Brand Commitments

Name "GeoVerificador", subtitle "Predios de Arequipa". Identity to preserve: white-sillar ground with faint block joints, plan-blueprint ink blue for action and the top band, amber only for the "consulta referencial" notice, Public Sans (interface) and Source Serif 4 (headings, zone codes, figures), 12px card radius, light and dark themes on the same tokens, status always icon plus text. Spanish, tuteo, short sentences, never "la mejor zona".

## Evidence on Hand

`docs/VALIDACION.md` (793=793 polygons, 99.97% points, 98.1% labels; OSM versus RENIPRESS and ESCALE in §3.4, which led to making the registers the primary source); `docs/INVESTIGACION-VARIABLES.md` (sources of each variable); real test runs (1,254 unit tests with `pnpm test` plus 4 e2e tests with `pnpm test:e2e`, counted on 2026-11-10; 167 data and calculation checks with `pnpm datos:verificar`, all 167 passing on 2026-11-10; in earlier runs on 2026-11-09 two of them, speed limits of the assistant search on the dev machine (2.7-4.7 s against 2 s, and 1.0-1.2 s against 1 s), failed and are not correctness checks). No photo of Arequipa for the landing exists in the repo; none may be fabricated.

## Product Principles

1. The chat is the main way in; the point-search sidebar is secondary and hidden by default.
2. The person sets weights and tolerances; the system asks instead of presetting.
3. Every number shows its source; "no data" is never zero or "meets".
4. Informative context never scores; comparison never names a winner.
5. Show only what the person asked for: the map paints the criterion they chose, nothing more.

## Accessibility & Inclusion

44px touch targets, visible focus, AA contrast in light and dark, keyboard and screen-reader support (chat as `role="log"`), `prefers-reduced-motion`, mobile first, graceful degradation when the network or the model is down.
