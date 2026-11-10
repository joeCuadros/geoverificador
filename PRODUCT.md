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
- Data: PDM 2016-2025 zoning polygons, health facilities (RENIPRESS, SUSALUD) and schools (ESCALE padrón, MINEDU) as the primary sources with OpenStreetMap only as a backup where no official point lies within 200 m, plus bus stops and green areas (OpenStreetMap); every facility shows its source and official code. Medical offices (consultorios, 237 from RENIPRESS plus 31 from OpenStreetMap) are a separate category from health facilities (256 plus 25): informative only, with no distance threshold (a pending product decision, `CONFIG.umbrales.consultorio` is `null`), so they show the nearest office and its distance, never pass/fail, never enter a score or the assistant zone search, and the chat never treats them as "health nearby"; deduplication against OpenStreetMap runs per category. The decision follows the OSM-versus-official check in `docs/VALIDACION.md` §3.4, INGEMMET hazards, IGP earthquakes, ANA quebradas. A precomputed grid of 2,358 cells backs the search criteria.
- Commerce: markets (OpenStreetMap `amenity=marketplace`, 89), supermarkets (`shop=supermarket`, 32) and malls (`shop=mall` plus named retail land or buildings, 51, 28 of them polygons) are three more informative-only categories, built by `pnpm datos:comercio` (one Overpass query, cached). Same rules as the consultorio: nearest element and distance, never pass/fail, no score, no zone search, and the thresholds `CONFIG.umbrales.mercado`, `supermercado` and `mall` are `null` pending a product decision (no sourced distance exists: the 2011 MVCS national urban standards draft sets population per facility, not meters). Distance to a mall or market polygon is measured to its edge. Malls are checked against a curated list (Mall Aventura, Real Plaza, Mallplaza, OutletArauco, Arequipa Center), each with its source URL; the chat gives the confirmed mall first because OSM also tags small galleries `shop=mall`. The 2016 market census (CENAMA, INEI/PRODUCE) has no names or coordinates, so it is used only to compare counts per district (OSM and the census agree in 3 of 17 districts). The old chat shortcut "mall = near a PDM commercial zone" was removed.
- Optional Google sign-in exists on branch `feat/login-google` (name and opaque id only).

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
