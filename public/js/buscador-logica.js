(() => {
  'use strict';

  const CRITERIA = Object.freeze([
    'salud',
    'colegio_inicial',
    'colegio_primaria',
    'colegio_secundaria',
    'paradero',
    'area_verde',
  ]);
  const SCHOOL_LEVELS = Object.freeze(['colegio_inicial', 'colegio_primaria', 'colegio_secundaria']);
  const CRITERION_SET = new Set(CRITERIA);
  const LABELS = Object.freeze({
    salud: 'Salud',
    colegio_inicial: 'Colegio inicial',
    colegio_primaria: 'Colegio primaria',
    colegio_secundaria: 'Colegio secundaria',
    paradero: 'Paraderos',
    area_verde: 'Áreas verdes',
  });
  const BANDS = Object.freeze([
    Object.freeze({ id: 'baja', label: 'Menor compatibilidad', range: '0–49', color: '#526579', dashArray: '2 5' }),
    Object.freeze({ id: 'media', label: 'Compatibilidad media', range: '50–74', color: '#986000', dashArray: '8 5' }),
    Object.freeze({ id: 'alta', label: 'Alta compatibilidad', range: '75–100', color: '#17603a', dashArray: null }),
  ]);

  function emptyStars() {
    return Object.fromEntries(CRITERIA.map((criterion) => [criterion, 0]));
  }

  function isInterpretablePreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const rawStars = value.estrellas ?? value.stars;
    const hasStars = rawStars && typeof rawStars === 'object' && !Array.isArray(rawStars)
      && CRITERIA.some((criterion) => Number.isInteger(rawStars[criterion]) && rawStars[criterion] >= 0 && rawStars[criterion] <= 5);
    const rawCriteria = value.criteriosSeleccionados ?? value.selectedCriteria;
    const hasCriteria = Array.isArray(rawCriteria) && rawCriteria.some((criterion) => CRITERION_SET.has(criterion));
    const hasLevels = Array.isArray(value.nivelesEscolares)
      && value.nivelesEscolares.some((level) => SCHOOL_LEVELS.includes(level));
    return hasStars || hasCriteria || hasLevels
      || typeof value.necesitaColegios === 'boolean'
      || typeof value.incluirCondicional === 'boolean'
      || typeof value.includeConditional === 'boolean';
  }

  function normalizePreferences(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const rawStars = source.estrellas && typeof source.estrellas === 'object' && !Array.isArray(source.estrellas)
      ? source.estrellas
      : source.stars && typeof source.stars === 'object' && !Array.isArray(source.stars)
        ? source.stars
        : {};
    const stars = emptyStars();
    CRITERIA.forEach((criterion) => {
      const score = rawStars[criterion];
      if (Number.isInteger(score) && score >= 0 && score <= 5) stars[criterion] = score;
    });
    const rawSelected = source.criteriosSeleccionados ?? source.selectedCriteria;
    const hasExplicitSelection = Array.isArray(rawSelected);
    const selectedCriteria = hasExplicitSelection
      ? [...new Set(rawSelected.filter((criterion) => CRITERION_SET.has(criterion)))]
      : CRITERIA.filter((criterion) => stars[criterion] > 0);
    if (!hasExplicitSelection && Array.isArray(source.nivelesEscolares)) {
      source.nivelesEscolares.forEach((level) => {
        if (SCHOOL_LEVELS.includes(level) && !selectedCriteria.includes(level)) selectedCriteria.push(level);
      });
    }
    CRITERIA.forEach((criterion) => {
      if (!selectedCriteria.includes(criterion)) stars[criterion] = 0;
      else if (stars[criterion] === 0) stars[criterion] = 1;
    });
    const selectedLevels = SCHOOL_LEVELS.filter((level) => selectedCriteria.includes(level));
    return {
      stars,
      selectedCriteria,
      schoolLevels: [...new Set(selectedLevels)],
      needsSchools: selectedLevels.length > 0,
      includeConditional: source.incluirCondicional === true || source.includeConditional === true,
    };
  }

  function buildRequest(preferences) {
    const normalized = normalizePreferences(preferences);
    return {
      estrellas: normalized.stars,
      incluirCondicional: normalized.includeConditional,
    };
  }

  function bandForScore(score) {
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return BANDS[0];
    if (numericScore >= 75) return BANDS[2];
    if (numericScore >= 50) return BANDS[1];
    return BANDS[0];
  }

  function formatArea(areaM2) {
    const area = Number(areaM2);
    if (!Number.isFinite(area) || area < 0) return 'Área no disponible';
    const formatter = new Intl.NumberFormat('es-PE', { maximumFractionDigits: area >= 1_000_000 ? 1 : 2 });
    if (area >= 1_000_000) return `≈ ${formatter.format(area / 1_000_000)} km²`;
    return `≈ ${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 }).format(area)} m²`;
  }

  globalThis.BuscadorLogica = Object.freeze({
    BANDS,
    CRITERIA,
    LABELS,
    SCHOOL_LEVELS,
    bandForScore,
    buildRequest,
    emptyStars,
    formatArea,
    isInterpretablePreferences,
    normalizePreferences,
  });
})();
