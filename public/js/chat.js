(() => {
  'use strict';

  const LOGIC = window.BuscadorLogica;
  const SCHOOL_NAMES = {
    colegio_inicial: 'Inicial',
    colegio_primaria: 'Primaria',
    colegio_secundaria: 'Secundaria',
  };

  function createChat({ root, preferences, onChange, onSearch, onClose, onClear }) {
    const log = root.querySelector('#chat-log');
    const content = root.querySelector('#chat-content');
    const actions = root.querySelector('#chat-actions');
    let state = LOGIC.normalizePreferences(preferences);
    let currentStep = -1;

    function questionText(step) {
      return [
        '¿Qué tan cerca te gustaría tener un centro de salud? Puede facilitar consultas y atenciones.',
        '¿Necesitas colegios? Elige primero los niveles que te interesan; la distancia se evalúa por separado.',
        '¿Qué tan cerca te gustaría tener un paradero? La distancia puede ayudarte a comparar opciones de transporte público.',
        '¿Qué tan cerca te gustaría tener un área verde grande? Los espacios verdes pueden apoyar la recreación y el bienestar.',
      ][step];
    }

    function stepAnswer(step) {
      if (step === 0) return `Salud: ${ratingText(state.stars.salud)}.`;
      if (step === 1) {
        if (!state.needsSchools) return 'No necesito considerar colegios ahora.';
        if (state.schoolLevels.length === 0) return 'Sí necesito colegios, pero aún no elegí niveles.';
        return `Colegios ${state.schoolLevels.map((level) => `${SCHOOL_NAMES[level]}: ${ratingText(state.stars[level])}`).join('; ')}.`;
      }
      if (step === 2) return `Paraderos: ${ratingText(state.stars.paradero)}.`;
      return `Áreas verdes: ${ratingText(state.stars.area_verde)}.`;
    }

    function ratingText(value) {
      return value === 0 ? 'No me importa' : `${value} de 5 estrellas`;
    }

    function renderTranscript() {
      const entries = [{
        role: 'assistant',
        text: '¡Hola! Te ayudaré a comparar zonas según lo que te importa. Son cuatro preguntas breves, toma menos de un minuto.',
      }];
      if (currentStep >= 0) {
        for (let step = 0; step < Math.min(currentStep, 4); step += 1) {
          entries.push({ role: 'assistant', text: questionText(step) });
          entries.push({ role: 'user', text: stepAnswer(step) });
        }
        entries.push({
          role: 'assistant',
          text: currentStep < 4
            ? questionText(currentStep)
            : 'Revisa tus preferencias. Puedes cambiar cualquier respuesta antes de buscar.',
        });
      }
      log.innerHTML = entries.map((entry) => `
        <div class="chat-bubble ${entry.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant'}">
          <span class="sr-only">${entry.role === 'user' ? 'Tú: ' : 'Asistente: '}</span>${entry.text}
        </div>`).join('');
      log.scrollTop = log.scrollHeight;
    }

    function starsControl(criterion, title) {
      const selected = state.stars[criterion];
      const options = Array.from({ length: 6 }, (_, value) => {
        const label = value === 0 ? 'No me importa' : `${value} ${value === 1 ? 'estrella' : 'estrellas'}`;
        const visible = value === 0 ? '<span class="star-zero-label">No me importa</span>' : `<span aria-hidden="true">${'★'.repeat(value)}</span><span class="sr-only">${value} de 5 estrellas</span>`;
        return `<button type="button" class="star-option${value === selected ? ' seleccionado' : ''}" role="radio"
          aria-checked="${value === selected}" aria-label="${label}" tabindex="${value === selected ? '0' : '-1'}"
          data-action="star" data-criterion="${criterion}" data-value="${value}">${visible}</button>`;
      }).join('');
      return `<fieldset class="chat-criterio">
        <legend>${title}</legend>
        <div class="star-options" role="radiogroup" aria-label="Preferencia: ${title}">${options}</div>
        <p class="chat-ayuda">0 significa “No me importa”.</p>
      </fieldset>`;
    }

    function renderWelcome() {
      renderTranscript();
      const saved = Object.values(state.stars).some((value) => value > 0)
        || state.includeConditional
        || state.schoolLevels.length > 0;
      content.innerHTML = `<p class="chat-intro">No hay una respuesta correcta: compara las zonas con tus prioridades. No pediremos dirección ni datos personales.</p>`;
      actions.innerHTML = `<button type="button" class="primary" data-action="start">${saved ? 'Empezar con estas preferencias' : 'Empezar'}</button>
        ${saved ? '<button type="button" class="secondary" data-action="reset">Empezar de nuevo</button>' : ''}
        ${saved ? '<button type="button" class="link" data-action="clear">Borrar preferencias guardadas</button>' : ''}
        <button type="button" class="link" data-action="close">Volver</button>`;
      root.querySelector('#chat-content').focus?.({ preventScroll: true });
    }

    function renderSchoolQuestion() {
      const yes = state.needsSchools;
      const needSchool = `<fieldset class="chat-criterio">
        <legend>¿Necesitas tener colegios cerca?</legend>
        <div class="choice-row" role="radiogroup" aria-label="¿Necesitas colegios cerca?">
          <button type="button" class="choice-option${yes ? ' seleccionado' : ''}" role="radio" aria-checked="${yes}" tabindex="0" data-action="school-need" data-value="yes">Sí, necesito colegios</button>
          <button type="button" class="choice-option${!yes ? ' seleccionado' : ''}" role="radio" aria-checked="${!yes}" tabindex="${yes ? '-1' : '0'}" data-action="school-need" data-value="no">No por ahora</button>
        </div>
      </fieldset>`;
      if (!yes) return needSchool;
      const levels = LOGIC.SCHOOL_LEVELS.map((level) => `
        <label class="school-level">
          <input type="checkbox" data-action="school-level" value="${level}" ${state.schoolLevels.includes(level) ? 'checked' : ''}>
          <span>${SCHOOL_NAMES[level]}</span>
        </label>`).join('');
      const ratings = state.schoolLevels.map((level) => starsControl(level, `¿Qué tan cerca de colegios de nivel ${SCHOOL_NAMES[level].toLowerCase()}?`)).join('');
      return `${needSchool}<fieldset class="chat-criterio"><legend>¿Qué niveles te interesan?</legend><div class="school-levels">${levels}</div></fieldset>${ratings}`;
    }

    function renderQuestion() {
      renderTranscript();
      const sections = [
        starsControl('salud', '¿Qué tan cerca de un centro de salud?'),
        renderSchoolQuestion(),
        starsControl('paradero', '¿Qué tan cerca de un paradero?'),
        starsControl('area_verde', '¿Qué tan cerca de un área verde grande?'),
      ];
      content.innerHTML = `<p class="chat-progreso">Pregunta ${currentStep + 1} de 4</p>${sections[currentStep]}`;
      const canContinue = currentStep !== 1 || !state.needsSchools || state.schoolLevels.length > 0;
      actions.innerHTML = `<button type="button" class="secondary" data-action="back">Atrás</button>
        <button type="button" class="primary" data-action="next" ${canContinue ? '' : 'disabled'}>${currentStep === 3 ? 'Revisar respuestas' : 'Continuar'}</button>`;
    }

    function summaryRows() {
      return LOGIC.CRITERIA.map((criterion) => `<li>
        <span>${LOGIC.LABELS[criterion]}</span><strong>${ratingText(state.stars[criterion])}</strong>
        <button type="button" class="link" data-action="edit" data-step="${criterion === 'salud' ? 0 : LOGIC.SCHOOL_LEVELS.includes(criterion) ? 1 : criterion === 'paradero' ? 2 : 3}">Cambiar</button>
      </li>`).join('');
    }

    function renderSummary() {
      renderTranscript();
      content.innerHTML = `<ul class="chat-summary">${summaryRows()}</ul>
        <label class="check conditional-choice">
          <input id="chat-condicional" type="checkbox" data-action="conditional" ${state.includeConditional ? 'checked' : ''}>
          <span>Incluir zonas de construcción condicional</span>
        </label>
        <p class="chat-ayuda">Son zonas que pueden requerir condiciones o revisión adicional; incluirlas no significa que la construcción esté aprobada.</p>`;
      actions.innerHTML = `<button type="button" class="secondary" data-action="back">Atrás</button>
        <button type="button" class="primary" data-action="search">Buscar zonas</button>
        <button type="button" class="link" data-action="clear">Borrar preferencias guardadas</button>
        <button type="button" class="link" data-action="close">Volver</button>`;
    }

    function render() {
      if (currentStep < 0) renderWelcome();
      else if (currentStep < 4) renderQuestion();
      else renderSummary();
      if (currentStep >= 0) log.scrollTop = log.scrollHeight;
    }

    function focusFirstControl() {
      content.querySelector(
        '.star-option[tabindex="0"], .choice-option[tabindex="0"], [data-action="school-level"], #chat-condicional, [data-action="edit"]',
      )?.focus({ preventScroll: true });
    }

    function updatePreferences() {
      onChange(LOGIC.normalizePreferences(state));
    }

    function setStars(criterion, value, focus = false) {
      state.stars[criterion] = value;
      updatePreferences();
      render();
      if (focus) {
        content.querySelector(`[data-action="star"][data-criterion="${criterion}"][data-value="${value}"]`)?.focus();
      }
    }

    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !root.contains(button)) return;
      const action = button.dataset.action;
      if (action === 'school-level' || action === 'conditional') return;
      if (action === 'start') currentStep = 0;
      else if (action === 'reset') {
        state = LOGIC.normalizePreferences({});
        currentStep = 0;
        updatePreferences();
      } else if (action === 'next') currentStep = Math.min(4, currentStep + 1);
      else if (action === 'back') currentStep = Math.max(0, currentStep - 1);
      else if (action === 'edit') currentStep = Number(button.dataset.step);
      else if (action === 'star') {
        setStars(button.dataset.criterion, Number(button.dataset.value), true);
        return;
      } else if (action === 'school-need') {
        state.needsSchools = button.dataset.value === 'yes';
        if (!state.needsSchools) {
          state.schoolLevels = [];
          LOGIC.SCHOOL_LEVELS.forEach((level) => { state.stars[level] = 0; });
        }
        updatePreferences();
        render();
        focusFirstControl();
        return;
      } else if (action === 'search') {
        if (Object.values(state.stars).every((value) => value === 0)) {
          root.querySelector('#chat-storage-status').textContent = 'Asigna al menos una estrella a un criterio para buscar zonas.';
          root.querySelector('#chat-storage-status').classList.add('error');
          return;
        }
        onSearch(LOGIC.normalizePreferences(state));
        return;
      } else if (action === 'clear') {
        onClear();
        return;
      } else if (action === 'close') {
        onClose();
        return;
      }
      render();
      focusFirstControl();
    });

    root.addEventListener('change', (event) => {
      const control = event.target;
      if (control.matches('[data-action="school-level"]')) {
        const level = control.value;
        if (control.checked) state.schoolLevels = [...new Set([...state.schoolLevels, level])];
        else {
          state.schoolLevels = state.schoolLevels.filter((item) => item !== level);
          state.stars[level] = 0;
        }
        updatePreferences();
        render();
        content.querySelector(`[data-action="school-level"][value="${level}"]`)?.focus();
      } else if (control.matches('[data-action="conditional"]')) {
        state.includeConditional = control.checked;
        updatePreferences();
      }
    });

    root.addEventListener('keydown', (event) => {
      const choice = event.target.closest('.choice-option[role="radio"]');
      if (choice && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const options = [...choice.parentElement.querySelectorAll('.choice-option')];
        const index = options.indexOf(choice);
        const next = (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + options.length) % options.length;
        options[next].click();
        return;
      }
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

    return {
      getPreferences: () => LOGIC.normalizePreferences(state),
      setPreferences(value) {
        state = LOGIC.normalizePreferences(value);
        currentStep = 4;
        render();
      },
      showWelcome() {
        currentStep = -1;
        render();
      },
      showSummary() {
        currentStep = 4;
        render();
      },
    };
  }

  window.GeoChatBuscador = Object.freeze({ createChat });
})();
