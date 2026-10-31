(() => {
  'use strict';

  const LOGIC = window.BuscadorLogica;
  const SCHOOL_NAMES = {
    colegio_inicial: 'Inicial',
    colegio_primaria: 'Primaria',
    colegio_secundaria: 'Secundaria',
  };
  const EXPLANATIONS = {
    salud: 'Puede facilitar consultas y atenciones.',
    colegio_inicial: 'Puede reducir traslados durante los primeros años escolares.',
    colegio_primaria: 'Puede facilitar los traslados diarios a primaria.',
    colegio_secundaria: 'Puede facilitar los traslados diarios a secundaria.',
    paradero: 'Puede acercarte a opciones de transporte público.',
    area_verde: 'Puede facilitar el acceso a recreación y espacios abiertos.',
  };

  function createChat({ root, preferences, onChange, onSearch, onClear }) {
    const log = root.querySelector('#chat-log');
    const content = root.querySelector('#chat-content');
    const actions = root.querySelector('#chat-actions');
    let state = LOGIC.normalizePreferences(preferences);
    let stage = 'checklist';

    function criterionName(criterion) {
      return LOGIC.SCHOOL_LEVELS.includes(criterion)
        ? `Colegios · ${SCHOOL_NAMES[criterion]}`
        : LOGIC.LABELS[criterion];
    }

    function ratingText(value) {
      return `${value} de 5 estrellas`;
    }

    function renderTranscript(message) {
      log.innerHTML = `
        <div class="chat-bubble chat-bubble-assistant">
          <span class="sr-only">Asistente: </span>¡Hola! Te ayudamos a comparar zonas de Arequipa según lo que te importa. Son dos pasos breves y luego podrás revisar tus prioridades.
        </div>
        <div class="chat-bubble chat-bubble-assistant">
          <span class="sr-only">Asistente: </span>${message}
        </div>`;
      log.scrollTop = log.scrollHeight;
    }

    function renderChecklist() {
      renderTranscript('Primero marca solo los criterios que sí quieres considerar. Lo que dejes sin marcar no se usará en la búsqueda.');
      const options = LOGIC.CRITERIA.map((criterion) => `
        <label class="checklist-criterion">
          <input type="checkbox" data-action="criterion" value="${criterion}"
            ${state.selectedCriteria.includes(criterion) ? 'checked' : ''}>
          <span><strong>${criterionName(criterion)}</strong><small>${EXPLANATIONS[criterion]}</small></span>
        </label>`).join('');
      content.innerHTML = `<p class="chat-progreso">Paso 1 de 2 · Elige criterios</p>
        <p class="chat-intro">No hay una respuesta correcta. No pediremos dirección ni datos personales.</p>
        <fieldset class="chat-criterio checklist">
          <legend>¿Qué te importa al elegir dónde vivir?</legend>
          <div class="checklist-items">${options}</div>
        </fieldset>
        <p class="chat-ayuda" id="checklist-help">Marca al menos una opción para continuar.</p>`;
      actions.innerHTML = `<button type="button" class="primary" data-action="prioritize"
          ${state.selectedCriteria.length === 0 ? 'disabled' : ''}>Continuar a priorizar</button>
        <button type="button" class="link" data-action="clear">Borrar preferencias guardadas</button>`;
    }

    function starsControl(criterion) {
      const selected = state.stars[criterion];
      const options = Array.from({ length: 5 }, (_, index) => {
        const value = index + 1;
        return `<button type="button" class="star-option${value === selected ? ' seleccionado' : ''}"
          role="radio" aria-checked="${value === selected}" aria-label="${value} ${value === 1 ? 'estrella' : 'estrellas'}"
          tabindex="${value === selected ? '0' : '-1'}" data-action="star"
          data-criterion="${criterion}" data-value="${value}">
          <span aria-hidden="true">${'★'.repeat(value)}</span><span class="sr-only">${ratingText(value)}</span>
        </button>`;
      }).join('');
      return `<fieldset class="chat-criterio">
        <legend>${criterionName(criterion)}</legend>
        <p class="chat-ayuda">${EXPLANATIONS[criterion]}</p>
        <div class="star-options priority-stars" role="radiogroup" aria-label="Prioridad: ${criterionName(criterion)}">${options}</div>
      </fieldset>`;
    }

    function renderPriorities() {
      renderTranscript('Ahora asigna de 1 a 5 estrellas a cada criterio marcado. Puedes compararlos juntos en esta pantalla.');
      content.innerHTML = `<p class="chat-progreso">Paso 2 de 2 · Prioriza</p>
        <p class="priority-help" id="priority-help">5 = lo más importante para mí.</p>
        <div class="priority-list">${state.selectedCriteria.map(starsControl).join('')}</div>`;
      actions.innerHTML = `<button type="button" class="secondary" data-action="back-checklist">Cambiar checklist</button>
        <button type="button" class="primary" data-action="summary">Revisar resumen</button>`;
    }

    function renderSummary() {
      renderTranscript('Revisa tus prioridades. Puedes cambiar el checklist o volver a ajustar las estrellas antes de buscar.');
      const rows = state.selectedCriteria.map((criterion) => `<li>
        <span>${criterionName(criterion)}</span>
        <strong>${ratingText(state.stars[criterion])}</strong>
      </li>`).join('');
      content.innerHTML = `<p class="chat-progreso">Resumen editable</p>
        <ul class="chat-summary">${rows}</ul>
        <label class="check conditional-choice">
          <input id="chat-condicional" type="checkbox" data-action="conditional" ${state.includeConditional ? 'checked' : ''}>
          <span>Incluir zonas de construcción condicional</span>
        </label>
        <p class="chat-ayuda">Pueden requerir condiciones o revisión adicional; incluirlas no significa que la construcción esté aprobada.</p>`;
      actions.innerHTML = `<button type="button" class="secondary" data-action="back-priorities">Volver a priorizar</button>
        <button type="button" class="secondary" data-action="back-checklist">Cambiar checklist</button>
        <button type="button" class="primary" data-action="search">Buscar zonas</button>
        <button type="button" class="link" data-action="clear">Borrar preferencias guardadas</button>`;
    }

    function render() {
      if (stage === 'checklist') renderChecklist();
      else if (stage === 'priorities') renderPriorities();
      else renderSummary();
    }

    function updatePreferences() {
      onChange(LOGIC.normalizePreferences(state));
    }

    function focusFirstControl() {
      content.querySelector(
        '[data-action="criterion"]:checked, .star-option[tabindex="0"], #chat-condicional, [data-action="criterion"]',
      )?.focus({ preventScroll: true });
    }

    function setStars(criterion, value, focus = false) {
      state.stars[criterion] = value;
      updatePreferences();
      render();
      if (focus) content.querySelector(`[data-action="star"][data-criterion="${criterion}"][data-value="${value}"]`)?.focus();
    }

    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !root.contains(button)) return;
      const action = button.dataset.action;
      if (action === 'criterion' || action === 'conditional') return;
      if (action === 'prioritize') stage = 'priorities';
      else if (action === 'back-checklist') stage = 'checklist';
      else if (action === 'back-priorities') stage = 'priorities';
      else if (action === 'summary') stage = 'summary';
      else if (action === 'star') {
        setStars(button.dataset.criterion, Number(button.dataset.value), true);
        return;
      } else if (action === 'search') {
        if (state.selectedCriteria.length === 0) {
          root.querySelector('#chat-storage-status').textContent = 'Marca al menos un criterio para buscar zonas.';
          return;
        }
        onSearch(LOGIC.normalizePreferences(state));
        return;
      } else if (action === 'clear') {
        onClear();
        return;
      }
      render();
      focusFirstControl();
    });

    root.addEventListener('change', (event) => {
      const control = event.target;
      if (control.matches('[data-action="criterion"]')) {
        const criterion = control.value;
        if (control.checked) {
          if (!state.selectedCriteria.includes(criterion)) state.selectedCriteria.push(criterion);
          if (state.stars[criterion] === 0) state.stars[criterion] = 1;
        } else {
          state.selectedCriteria = state.selectedCriteria.filter((item) => item !== criterion);
          state.stars[criterion] = 0;
        }
        updatePreferences();
        render();
        content.querySelector(`[data-action="criterion"][value="${criterion}"]`)?.focus();
      } else if (control.matches('[data-action="conditional"]')) {
        state.includeConditional = control.checked;
        updatePreferences();
      }
    });

    root.addEventListener('keydown', (event) => {
      const option = event.target.closest('.star-option[role="radio"]');
      if (!option || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const options = [...option.parentElement.querySelectorAll('.star-option')];
      let index = options.indexOf(option);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = options.length - 1;
      else index = (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + options.length) % options.length;
      options[index].click();
    });

    render();
    return {
      getPreferences: () => LOGIC.normalizePreferences(state),
      setPreferences(value) {
        state = LOGIC.normalizePreferences(value);
        stage = 'checklist';
        render();
      },
      showChecklist() {
        stage = 'checklist';
        render();
      },
      showPriorities() {
        stage = 'priorities';
        render();
      },
      showSummary() {
        stage = 'summary';
        render();
      },
    };
  }

  window.GeoChatBuscador = Object.freeze({ createChat });
})();
