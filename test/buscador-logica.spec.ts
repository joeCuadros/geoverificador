import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

interface BrowserSearchLogic {
  BANDS: { id: string; label: string; range: string; color: string; dashArray: string | null }[];
  CRITERIA: string[];
  LABELS: Record<string, string>;
  SCHOOL_LEVELS: string[];
  bandForScore(score: number): { id: string; label: string };
  buildRequest(value: unknown): { estrellas: Record<string, number>; incluirCondicional: boolean };
  emptyStars(): Record<string, number>;
  formatArea(areaM2: number): string;
  isInterpretablePreferences(value: unknown): boolean;
  normalizePreferences(value: unknown): {
    stars: Record<string, number>;
    selectedCriteria: string[];
    schoolLevels: string[];
    needsSchools: boolean;
    includeConditional: boolean;
  };
}

function loadSearchLogic(): BrowserSearchLogic {
  const context: { BuscadorLogica?: BrowserSearchLogic } = {};
  const source = readFileSync('public/js/buscador-logica.js', 'utf8');
  runInNewContext(source, context);
  if (!context.BuscadorLogica) throw new Error('No se pudo cargar BuscadorLogica.');
  return context.BuscadorLogica;
}

describe('lógica pura del buscador del navegador', () => {
  const logic = loadSearchLogic();

  it('inicia con todos los criterios en cero', () => {
    expect(JSON.parse(JSON.stringify(logic.emptyStars()))).toEqual({
      salud: 0,
      colegio_inicial: 0,
      colegio_primaria: 0,
      colegio_secundaria: 0,
      paradero: 0,
      area_verde: 0,
    });
    expect(logic.normalizePreferences({}).selectedCriteria).toEqual([]);
  });

  it('migra preferencias de la versión anterior al checklist y conserva criterios interpretables', () => {
    const result = logic.normalizePreferences({
      estrellas: { salud: 5, colegio_primaria: 0, paradero: 6, desconocido: 4 },
      nivelesEscolares: ['colegio_primaria', 'intruso'],
      incluirCondicional: true,
    });

    expect(JSON.parse(JSON.stringify(result))).toEqual({
      stars: {
        salud: 5,
        colegio_inicial: 0,
        colegio_primaria: 1,
        colegio_secundaria: 0,
        paradero: 0,
        area_verde: 0,
      },
      selectedCriteria: ['salud', 'colegio_primaria'],
      schoolLevels: ['colegio_primaria'],
      needsSchools: true,
      includeConditional: true,
    });
  });

  it('ignora preferencias guardadas que no puede interpretar', () => {
    expect(logic.isInterpretablePreferences('no es json')).toBe(false);
    expect(logic.isInterpretablePreferences({ estrellas: { desconocido: 4 } })).toBe(false);
    expect(JSON.parse(JSON.stringify(logic.normalizePreferences({ criteriosSeleccionados: ['intruso'] })))).toEqual({
      stars: {
        salud: 0,
        colegio_inicial: 0,
        colegio_primaria: 0,
        colegio_secundaria: 0,
        paradero: 0,
        area_verde: 0,
      },
      selectedCriteria: [],
      schoolLevels: [],
      needsSchools: false,
      includeConditional: false,
    });
  });

  it('normaliza el checklist y elimina las estrellas de criterios no seleccionados', () => {
    const result = logic.normalizePreferences({
      selectedCriteria: ['salud', 'area_verde', 'intruso'],
      stars: { salud: 4, area_verde: 0, paradero: 5 },
    });
    expect(result.selectedCriteria).toEqual(['salud', 'area_verde']);
    expect(result.stars).toEqual({
      salud: 4,
      colegio_inicial: 0,
      colegio_primaria: 0,
      colegio_secundaria: 0,
      paradero: 0,
      area_verde: 1,
    });
  });

  it('envía únicamente las estrellas y el booleano de construcción condicional', () => {
    const request = logic.buildRequest({
      stars: { salud: 5, colegio_primaria: 4 },
      schoolLevels: ['colegio_primaria'],
      needsSchools: true,
      includeConditional: true,
      district: 'Arequipa',
      home: '-16.4,-71.5',
    });

    expect(Object.keys(request).sort()).toEqual(['estrellas', 'incluirCondicional']);
    expect(JSON.parse(JSON.stringify(request))).toEqual({
      estrellas: {
        salud: 5,
        colegio_inicial: 0,
        colegio_primaria: 4,
        colegio_secundaria: 0,
        paradero: 0,
        area_verde: 0,
      },
      incluirCondicional: true,
    });
  });

  it('asigna bandas legibles con rangos no superpuestos', () => {
    expect(logic.bandForScore(49.99).id).toBe('baja');
    expect(logic.bandForScore(50).id).toBe('media');
    expect(logic.bandForScore(74.99).id).toBe('media');
    expect(logic.bandForScore(75).id).toBe('alta');
  });

  it('formatea superficies en metros cuadrados o kilómetros cuadrados', () => {
    expect(logic.formatArea(120_000)).toContain('m²');
    expect(logic.formatArea(1_200_000)).toContain('km²');
    expect(logic.formatArea(-1)).toBe('Área no disponible');
  });
});
