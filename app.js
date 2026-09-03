(() => {
  'use strict';

  const STORAGE_KEY = 'lifecheck-state-v1';
  const DAY_MS = 86400000;
  const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const WEEKDAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

  const app = document.getElementById('app');
  const pageTitle = document.getElementById('pageTitle');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modal');
  const importInput = document.getElementById('importInput');

  let activeTab = 'today';
  let selectedDate = currentLifeDateKey();
  let calendarWeeksShown = 12;
  let state = loadState();

  ensureStateShape();
  saveState();
  bindShell();
  registerServiceWorker();
  render();

  function defaultState() {
    const today = currentLifeDateKey();
    const currentWeek = weekStartKey(today);
    const start = currentWeek;
    return {
      settings: {
        weekBoundaryHour: 4,
        rewardVersions: [{ effectiveFrom: start, monthlyMax: 400 }]
      },
      habits: [
        makeHabit('uni', start, 'Uni', 'time_weekly', 20, 0, { targetMinutes: 15 * 60, entryMode: 'daily' }),
        makeHabit('arbeit', start, 'Arbeit', 'time_weekly', 15, 1, { targetMinutes: 20 * 60, entryMode: 'cumulative' }),
        makeHabit('kein-porn', start, 'Kein Porn', 'daily_boolean', 20, 2, { weekdays: [0,1,2,3,4,5,6] }),
        makeHabit('aufraeumen', start, 'Aufräumen', 'weekly_count', 10, 3, { targetCount: 5 }),
        makeHabit('waesche', start, 'Wäsche', 'weekly_count', 5, 4, { targetCount: 1 }),
        makeHabit('putzen', start, 'Putzen', 'weekly_count', 10, 5, { targetCount: 1 }),
        makeHabit('bettwaesche', start, 'Bettwäsche', 'anchored_cycle', 5, 6, {
          everyWeeks: 1,
          anchorDate: nextWeekdayKey(start, 6),
          windowBefore: 1,
          windowAfter: 2
        }),
        makeHabit('sport', start, 'Sport', 'weekly_count', 15, 7, { targetCount: 3 })
      ],
      entries: {},
      transfers: [],
      meta: { createdAt: new Date().toISOString(), version: 1 }
    };
  }

  function makeHabit(id, start, name, type, penalty, order, config) {
    return {
      id,
      createdAt: start,
      endedAt: null,
      versions: [{
        effectiveFrom: start,
        name,
        type,
        penalty,
        order,
        config
      }]
    };
  }

  function ensureStateShape() {
    if (!state || typeof state !== 'object') state = defaultState();
    state.settings ||= { weekBoundaryHour: 4, rewardVersions: [] };
    state.settings.weekBoundaryHour ??= 4;
    state.settings.rewardVersions ||= [{ effectiveFrom: weekStartKey(currentLifeDateKey()), monthlyMax: 400 }];
    state.habits ||= [];
    state.entries ||= {};
    state.transfers ||= [];
    state.meta ||= { createdAt: new Date().toISOString(), version: 1 };
    for (const habit of state.habits) {
      for (const version of habit.versions || []) {
        version.config ||= {};
        if (version.type === 'time_weekly' && !version.config.entryMode) {
          version.config.entryMode = habit.id === 'arbeit' ? 'cumulative' : 'daily';
        }
      }
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : defaultState();
    } catch (e) {
      console.warn('Could not load saved data', e);
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function bindShell() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        setActiveNav();
        render();
      });
    });
    document.getElementById('settingsQuick').addEventListener('click', () => {
      activeTab = 'habits';
      setActiveNav();
      render();
    });
    modalBackdrop.addEventListener('click', e => {
      if (e.target === modalBackdrop) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !modalBackdrop.classList.contains('hidden')) closeModal();
    });
    importInput.addEventListener('change', handleImportFile);
  }

  function setActiveNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === activeTab);
    });
  }

  function render() {
    if (activeTab === 'today') renderToday();
    else if (activeTab === 'calendar') renderCalendar();
    else if (activeTab === 'rewards') renderRewards();
    else renderHabits();
  }

  // -------------------- Today --------------------

  function renderToday() {
    pageTitle.textContent = selectedDate === currentLifeDateKey() ? 'Heute' : 'Tag';
    const currentWeekStart = weekStartKey(selectedDate);
    const summary = evaluateWeek(currentWeekStart, isClosedWeek(currentWeekStart));
    const reward = weeklyRewardForWeek(currentWeekStart);
    const money = roundMoney(reward * summary.score / 100);
    const habits = activeHabitsOnDate(selectedDate)
      .sort((a,b) => habitVersion(a, selectedDate).order - habitVersion(b, selectedDate).order);

    app.innerHTML = `
      <div class="date-switcher compact">
        <button class="date-arrow" id="prevDay" aria-label="Voriger Tag">‹</button>
        <button class="date-center" id="jumpToday">
          <strong>${formatFullDate(selectedDate)}</strong>
        </button>
        <button class="date-arrow" id="nextDay" aria-label="Nächster Tag" ${selectedDate >= currentLifeDateKey() ? 'disabled' : ''}>›</button>
      </div>

      <div class="today-summary">
        <strong>${summary.score}%</strong>
        <span>${formatMoney(money)} / ${formatMoney(reward)}</span>
      </div>

      ${habits.length ? `<div class="tile-grid">${habits.map(h => renderHabitTile(h, selectedDate)).join('')}</div>` : `
        <div class="card empty-state">Keine Habits</div>
      `}
    `;

    document.getElementById('prevDay').onclick = () => { selectedDate = addDaysKey(selectedDate, -1); renderToday(); };
    document.getElementById('nextDay').onclick = () => {
      if (selectedDate < currentLifeDateKey()) selectedDate = addDaysKey(selectedDate, 1);
      renderToday();
    };
    document.getElementById('jumpToday').onclick = () => { selectedDate = currentLifeDateKey(); renderToday(); };

    document.querySelectorAll('.tile').forEach(tile => {
      tile.addEventListener('click', () => handleTileClick(tile.dataset.habitId, selectedDate));
    });
  }

  function renderHabitTile(habit, dateKey) {
    const v = habitVersion(habit, dateKey);
    if (!v) return '';
    const display = tileDisplay(habit, v, dateKey);
    return `
      <button class="tile status-${display.status}" data-habit-id="${escapeHtml(habit.id)}">
        <div class="tile-name">${escapeHtml(v.name)}</div>
        <div class="tile-main ${display.small ? 'small' : ''}">${escapeHtml(display.main || '')}</div>
        ${display.footLeft ? `<div class="tile-foot"><span>${escapeHtml(display.footLeft)}</span></div>` : ''}
      </button>
    `;
  }

  function tileDisplay(habit, v, dateKey) {
    const entry = getEntry(dateKey, habit.id);
    const week = weekStartKey(dateKey);
    const weekly = evaluateHabitForWeek(habit, week, isClosedWeek(week));

    if (v.type === 'time_weekly') {
      const weekMinutes = sumMinutesInWeek(habit.id, week, habit, dateKey);
      const status = entry?.status === 'fail' ? 'fail' : entry?.minutes != null ? 'success' : 'neutral';
      return {
        status,
        main: `${formatDuration(weekMinutes)} / ${formatDuration(v.config.targetMinutes)}`,
        footLeft: v.config.entryMode === 'cumulative' ? 'Wochenstand' : ''
      };
    }

    if (v.type === 'daily_boolean') {
      const relevant = (v.config.weekdays || []).includes(weekdayMon0(dateKey));
      const status = relevant ? (entry?.status || 'neutral') : 'neutral';
      const done = dailySuccessCount(habit, week);
      const required = dailyRequiredDates(habit, week).length;
      return {
        status,
        main: relevant ? `${done} / ${required}` : '–',
        footLeft: '',
        small: true
      };
    }

    if (v.type === 'weekly_count') {
      const status = entry?.status || 'neutral';
      const count = weeklySuccessCount(habit.id, week, habit);
      return {
        status,
        main: `${count} / ${v.config.targetCount}`,
        footLeft: '',
        small: true
      };
    }

    if (v.type === 'anchored_cycle') {
      const cycle = cycleForDate(habit, dateKey);
      const next = nextCycleForDate(habit, dateKey);
      if (!cycle) {
        const days = next ? daysBetweenKeys(dateKey, next.windowStart) : null;
        return {
          status: 'neutral',
          main: days === 0 ? 'ab heute' : days === 1 ? 'ab morgen' : days != null ? `in ${days} Tagen` : '–',
          footLeft: next ? `fällig ${formatShortDate(next.anchor)}` : '',
          small: true
        };
      }
      const successDate = cycleSuccessDate(habit, cycle);
      const explicit = entry?.status;
      const status = successDate ? 'success' : (dateKey > cycle.windowEnd ? 'fail' : explicit || 'neutral');
      return {
        status,
        main: successDate ? formatShortDate(successDate) : cycleTimingText(cycle, dateKey),
        footLeft: `fällig ${formatShortDate(cycle.anchor)}`,
        small: true
      };
    }

    return { status: weekly.status, main: '', footLeft: '' };
  }

  function handleTileClick(habitId, dateKey) {
    const habit = state.habits.find(h => h.id === habitId);
    const v = habitVersion(habit, dateKey);
    if (!v) return;

    if (v.type === 'time_weekly') {
      openTimeModal(habit, dateKey);
      return;
    }
    if (v.type === 'anchored_cycle') {
      const cycle = cycleForDate(habit, dateKey);
      if (!cycle) return;
    }
    cycleSimpleEntry(dateKey, habitId);
    saveState();
    renderToday();
  }

  function cycleSimpleEntry(dateKey, habitId) {
    const current = getEntry(dateKey, habitId)?.status || 'neutral';
    const next = current === 'neutral' ? 'success' : current === 'success' ? 'fail' : 'neutral';
    if (next === 'neutral') deleteEntry(dateKey, habitId);
    else setEntry(dateKey, habitId, { status: next });
  }

  // -------------------- Calendar --------------------

  function renderCalendar() {
    pageTitle.textContent = 'Kalender';
    const currentWeek = weekStartKey(currentLifeDateKey());
    const weeks = [];
    for (let i = 0; i < calendarWeeksShown; i++) weeks.push(addDaysKey(currentWeek, -7 * i));

    app.innerHTML = `
      <div class="list">
        ${weeks.map(renderWeekRow).join('')}
      </div>
      <button class="secondary-button full" id="moreWeeks">Mehr Wochen anzeigen</button>
    `;

    document.querySelectorAll('.week-row').forEach(row => {
      row.onclick = () => openWeekDetail(row.dataset.weekStart);
    });
    document.getElementById('moreWeeks').onclick = () => { calendarWeeksShown += 12; renderCalendar(); };
  }

  function renderWeekRow(weekStart) {
    const closed = isClosedWeek(weekStart);
    const ev = evaluateWeek(weekStart, closed);
    const weeklyMax = weeklyRewardForWeek(weekStart);
    const money = roundMoney(weeklyMax * ev.score / 100);
    const items = applicableHabitsForWeek(weekStart)
      .map(h => ({ habit: h, eval: evaluateHabitForWeek(h, weekStart, closed), v: habitVersion(h, evaluationReferenceDate(h, weekStart)) }))
      .filter(x => x.eval.applicable)
      .sort((a,b) => (a.v?.order ?? 999) - (b.v?.order ?? 999));
    const statuses = items.map(x => `<span class="mini-status ${x.eval.status}" title="${escapeHtml(x.v?.name || '')}"></span>`).join('');
    return `
      <button class="week-row" data-week-start="${weekStart}">
        <div class="week-row-head">
          <div>
            <div class="week-date">${formatWeekRange(weekStart)}</div>
            <div class="week-money">${formatMoney(money)} / ${formatMoney(weeklyMax)}</div>
          </div>
          <div class="week-score">${ev.score}%</div>
        </div>
        <div class="mini-grid">${statuses || '<span class="mini-status neutral"></span>'}</div>
      </button>
    `;
  }

  function openWeekDetail(weekStart) {
    const closed = isClosedWeek(weekStart);
    const ev = evaluateWeek(weekStart, closed);
    const weeklyMax = weeklyRewardForWeek(weekStart);
    const money = roundMoney(weeklyMax * ev.score / 100);
    const rows = ev.items.map(item => `
      <div class="detail-row status-${item.status}">
        <div>
          <div class="detail-title">${escapeHtml(item.name)}</div>
          <div class="detail-meta">${escapeHtml(item.detail)}</div>
        </div>
        <div class="detail-result">
          <strong>${item.status === 'success' ? '100%' : `× ${numberClean(100 - item.penalty)}%`}</strong>
        </div>
      </div>
    `).join('');

    openModal(`
      <div class="modal-head">
        <div>
          <div class="modal-title" id="modalTitle">${formatWeekRange(weekStart)}</div>
        </div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Bewertung</div><div class="metric-value">${ev.score}%</div></div>
        <div class="metric-card"><div class="metric-label">Belohnung</div><div class="metric-value">${formatMoney(money)}</div><div class="metric-sub">max. ${formatMoney(weeklyMax)}</div></div>
      </div>
      <div class="detail-list">${rows || '<div class="empty-state">Keine Habits für diese Woche.</div>'}</div>
    `);
  }

  // -------------------- Rewards --------------------

  function renderRewards() {
    pageTitle.textContent = 'Belohnung';
    const currentWeek = weekStartKey(currentLifeDateKey());
    const currentEval = evaluateWeek(currentWeek, false);
    const weeklyMax = weeklyRewardForWeek(currentWeek);
    const currentSecured = roundMoney(weeklyMax * currentEval.score / 100);
    const earned = totalEarnedClosedWeeks();
    const transferred = roundMoney(state.transfers.reduce((sum, t) => sum + Number(t.amount || 0), 0));
    const available = roundMoney(Math.max(0, earned - transferred));
    const rewardV = rewardVersionForWeek(currentWeek);
    const monthly = rewardV?.monthlyMax || 0;

    const transferRows = [...state.transfers]
      .sort((a,b) => b.date.localeCompare(a.date))
      .slice(0, 12)
      .map(t => `
        <div class="detail-row">
          <div><div class="detail-title">${formatShortDate(t.date)}</div><div class="detail-meta">${escapeHtml(t.note || 'Überweisung')}</div></div>
          <div class="detail-result"><strong>−${formatMoney(t.amount)}</strong><span>überwiesen</span></div>
        </div>
      `).join('');

    app.innerHTML = `
      <section class="summary-card">
        <div class="summary-top">
          <div>
            <div class="summary-kicker">Noch überweisbar</div>
            <div class="summary-score">${formatMoney(available)}</div>
          </div>
          <div class="summary-money"><strong>${formatMoney(earned)}</strong><span>insgesamt verdient</span></div>
        </div>
        <div class="summary-meta"><span>${formatMoney(transferred)} bereits überwiesen</span></div>
      </section>

      <section class="section">
        <div class="metric-grid">
          <div class="metric-card"><div class="metric-label">Diese Woche gesichert</div><div class="metric-value">${formatMoney(currentSecured)}</div><div class="metric-sub">${currentEval.score}% von ${formatMoney(weeklyMax)}</div></div>
          <div class="metric-card"><div class="metric-label">Monats-Maximum</div><div class="metric-value">${formatMoney(monthly)}</div><div class="metric-sub">ergibt ${formatMoney(weeklyMax)} / Woche</div></div>
        </div>
      </section>

      <section class="section">
        <div class="button-row">
          <button class="primary-button" id="addTransfer">Überweisung eintragen</button>
          <button class="secondary-button" id="editReward">Maximum ändern</button>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><div class="section-title">Überweisungen</div></div>
        <div class="card">${transferRows || '<div class="empty-state">Keine Überweisungen</div>'}</div>
      </section>
    `;

    document.getElementById('addTransfer').onclick = () => openTransferModal(available);
    document.getElementById('editReward').onclick = openRewardModal;
  }

  function openTransferModal(available) {
    openModal(`
      <div class="modal-head">
        <div><div class="modal-title" id="modalTitle">Überweisung eintragen</div><div class="modal-subtitle">Verfügbar: ${formatMoney(available)}</div></div>
        <button class="modal-close" data-close>×</button>
      </div>
      <form id="transferForm">
        <div class="form-group"><label class="form-label">Betrag in €</label><input class="form-input" id="transferAmount" type="number" min="0.01" step="0.01" max="${available}" required /></div>
        <div class="form-group"><label class="form-label">Datum</label><input class="form-input" id="transferDate" type="date" value="${currentLifeDateKey()}" required /></div>
        <div class="form-group"><label class="form-label">Notiz (optional)</label><input class="form-input" id="transferNote" placeholder="z. B. Spar-/Spaßkonto" /></div>
        <button class="primary-button full" type="submit">Speichern</button>
      </form>
    `);
    document.getElementById('transferForm').onsubmit = e => {
      e.preventDefault();
      const amount = Number(document.getElementById('transferAmount').value);
      if (!amount || amount <= 0) return;
      if (amount > available + 0.001) { toast('Betrag ist höher als dein verfügbares Guthaben.'); return; }
      state.transfers.push({ id: uid(), amount: roundMoney(amount), date: document.getElementById('transferDate').value, note: document.getElementById('transferNote').value.trim() });
      saveState(); closeModal(); renderRewards(); toast('Überweisung gespeichert.');
    };
  }

  function openRewardModal() {
    const currentWeek = weekStartKey(currentLifeDateKey());
    const current = rewardVersionForWeek(currentWeek)?.monthlyMax || 0;
    openModal(`
      <div class="modal-head">
        <div><div class="modal-title" id="modalTitle">Belohnungs-Maximum</div></div>
        <button class="modal-close" data-close>×</button>
      </div>
      <form id="rewardForm">
        <div class="form-group">
          <label class="form-label">Maximal pro Monat</label>
          <input class="form-input" id="monthlyMax" type="number" min="0" step="5" value="${current}" required />
        </div>
        <div class="inline-note">Bei ${formatMoney(current)} pro Monat sind aktuell maximal ${formatMoney(weeklyRewardFromMonthly(current))} pro Woche möglich.</div>
        <button class="primary-button full" style="margin-top:12px" type="submit">Speichern</button>
      </form>
    `);
    const input = document.getElementById('monthlyMax');
    input.addEventListener('input', () => {
      const note = modal.querySelector('.inline-note');
      note.textContent = `Bei ${formatMoney(Number(input.value || 0))} pro Monat sind maximal ${formatMoney(weeklyRewardFromMonthly(Number(input.value || 0)))} pro Woche möglich.`;
    });
    document.getElementById('rewardForm').onsubmit = e => {
      e.preventDefault();
      const monthlyMax = Math.max(0, Number(input.value || 0));
      upsertRewardVersion(currentWeek, monthlyMax);
      saveState(); closeModal(); renderRewards(); toast('Maximum aktualisiert.');
    };
  }

  // -------------------- Habits --------------------

  function renderHabits() {
    pageTitle.textContent = 'Habits';
    const today = currentLifeDateKey();
    const habits = state.habits
      .filter(h => !h.endedAt || h.endedAt > today)
      .sort((a,b) => (habitVersion(a, today)?.order ?? 999) - (habitVersion(b, today)?.order ?? 999));

    app.innerHTML = `
      <div class="button-row compact-actions">
        <button class="primary-button" id="addHabit">+ Habit</button>
        <button class="secondary-button" id="dataTools">Daten</button>
      </div>
      <div class="list habit-list">
        ${habits.map((h,i) => renderHabitRow(h, i, habits.length)).join('') || '<div class="card empty-state">Keine Habits</div>'}
      </div>
    `;

    document.getElementById('addHabit').onclick = () => openHabitModal(null);
    document.getElementById('dataTools').onclick = openDataTools;
    document.querySelectorAll('.habit-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.row-actions')) return;
        openHabitModal(row.dataset.habitId);
      });
    });
    document.querySelectorAll('[data-move]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        moveHabit(btn.dataset.habitId, Number(btn.dataset.move));
      };
    });
  }

  function renderHabitRow(habit, index, total) {
    const v = habitVersion(habit, currentLifeDateKey()) || latestHabitVersion(habit);
    if (!v) return '';
    return `
      <button class="habit-row" data-habit-id="${escapeHtml(habit.id)}">
        <div>
          <div class="habit-row-title">${escapeHtml(v.name)}</div>
          <div class="habit-row-meta">${escapeHtml(habitRuleText(v))} · ×${numberClean(100 - v.penalty)}%</div>
        </div>
        <div class="row-actions">
          <button class="small-button" data-move="-1" data-habit-id="${escapeHtml(habit.id)}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="small-button" data-move="1" data-habit-id="${escapeHtml(habit.id)}" ${index === total - 1 ? 'disabled' : ''}>↓</button>
        </div>
      </button>
    `;
  }

  function moveHabit(habitId, direction) {
    const today = currentLifeDateKey();
    const active = state.habits.filter(h => !h.endedAt || h.endedAt > today)
      .sort((a,b) => (habitVersion(a, today)?.order ?? 999) - (habitVersion(b, today)?.order ?? 999));
    const idx = active.findIndex(h => h.id === habitId);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= active.length) return;
    const a = active[idx], b = active[swap];
    const av = clone(habitVersion(a, today)), bv = clone(habitVersion(b, today));
    const tmp = av.order; av.order = bv.order; bv.order = tmp;
    upsertHabitVersion(a, today, av);
    upsertHabitVersion(b, today, bv);
    saveState(); renderHabits();
  }

  function openHabitModal(habitId) {
    const today = currentLifeDateKey();
    const habit = habitId ? state.habits.find(h => h.id === habitId) : null;
    const existing = habit ? clone(habitVersion(habit, today) || latestHabitVersion(habit)) : null;
    const defaultType = existing?.type || 'daily_boolean';
    const defaultConfig = existing?.config || defaultConfigForType(defaultType);

    openModal(`
      <div class="modal-head">
        <div><div class="modal-title" id="modalTitle">${habit ? 'Habit bearbeiten' : 'Neues Habit'}</div></div>
        <button class="modal-close" data-close>×</button>
      </div>
      <form id="habitForm">
        <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="habitName" maxlength="40" value="${escapeAttr(existing?.name || '')}" placeholder="z. B. Lesen" required /></div>
        <div class="form-grid-2">
          <div class="form-group"><label class="form-label">Typ</label>
            <select class="form-select" id="habitType">
              ${typeOption('daily_boolean','Täglich Ja/Nein',defaultType)}
              ${typeOption('weekly_count','X-mal pro Woche',defaultType)}
              ${typeOption('time_weekly','Zeit pro Woche',defaultType)}
              ${typeOption('anchored_cycle','Fester Rhythmus',defaultType)}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Abwertung in %</label><input class="form-input" id="habitPenalty" type="number" min="0" max="100" step="1" value="${existing?.penalty ?? 10}" required /></div>
        </div>
        <div id="typeFields"></div>
        <div class="form-group"><label class="form-label">Gilt ab</label><input class="form-input" id="effectiveFrom" type="date" value="${today}" required /></div>
        <div class="button-row ${habit ? '' : ''}">
          <button class="primary-button" type="submit">${habit ? 'Änderung speichern' : 'Habit anlegen'}</button>
          ${habit ? '<button class="danger-button" type="button" id="endHabit">Entfernen</button>' : '<button class="secondary-button" type="button" data-close>Abbrechen</button>'}
        </div>
      </form>
    `);

    const typeSelect = document.getElementById('habitType');
    const renderFields = () => renderTypeFields(typeSelect.value, existing && typeSelect.value === existing.type ? existing.config : defaultConfigForType(typeSelect.value));
    typeSelect.onchange = renderFields;
    renderTypeFields(defaultType, defaultConfig);

    document.getElementById('habitForm').onsubmit = e => {
      e.preventDefault();
      const type = typeSelect.value;
      const effectiveFrom = document.getElementById('effectiveFrom').value;
      const name = document.getElementById('habitName').value.trim();
      const penalty = Math.max(0, Math.min(100, Number(document.getElementById('habitPenalty').value || 0)));
      const config = readTypeConfig(type);
      if (!name) return;

      if (habit) {
        const currentV = habitVersion(habit, effectiveFrom) || latestHabitVersion(habit);
        const updated = { ...clone(currentV), effectiveFrom, name, type, penalty, config };
        upsertHabitVersion(habit, effectiveFrom, updated);
        if (habit.endedAt && habit.endedAt <= effectiveFrom) habit.endedAt = null;
      } else {
        const maxOrder = Math.max(-1, ...state.habits.map(h => latestHabitVersion(h)?.order ?? -1));
        state.habits.push({
          id: uid(),
          createdAt: effectiveFrom,
          endedAt: null,
          versions: [{ effectiveFrom, name, type, penalty, order: maxOrder + 1, config }]
        });
      }
      selectedDate = currentLifeDateKey();
      saveState(); closeModal(); renderHabits();
    };

    if (habit) {
      document.getElementById('endHabit').onclick = () => {
        const effectiveFrom = document.getElementById('effectiveFrom').value;
        openConfirmModal('Habit entfernen?', `${existing.name} wird ab ${formatShortDate(effectiveFrom)} nicht mehr angezeigt oder bewertet. Vergangene Daten bleiben erhalten.`, () => {
          habit.endedAt = effectiveFrom;
          selectedDate = currentLifeDateKey();
          saveState(); closeModal(); renderHabits();
        });
      };
    }
  }

  function renderTypeFields(type, config) {
    const box = document.getElementById('typeFields');
    if (!box) return;
    if (type === 'daily_boolean') {
      const weekdays = config.weekdays || [0,1,2,3,4,5,6];
      box.innerHTML = `
        <div class="form-group"><label class="form-label">Relevante Tage</label>
          <div class="weekday-picker">${WEEKDAYS.map((d,i) => `<label><input type="checkbox" name="weekday" value="${i}" ${weekdays.includes(i)?'checked':''}><span>${d}</span></label>`).join('')}</div>
        </div>`;
    } else if (type === 'weekly_count') {
      box.innerHTML = `<div class="form-group"><label class="form-label">Wie oft pro Woche?</label><input class="form-input" id="targetCount" type="number" min="1" max="30" step="1" value="${config.targetCount || 1}" required /></div>`;
    } else if (type === 'time_weekly') {
      const mins = config.targetMinutes || 60;
      const entryMode = config.entryMode || 'daily';
      box.innerHTML = `
        <div class="form-grid-2">
          <div class="form-group"><label class="form-label">Stunden / Woche</label><input class="form-input" id="targetHours" type="number" min="0" max="168" value="${Math.floor(mins/60)}" required /></div>
          <div class="form-group"><label class="form-label">Minuten</label><input class="form-input" id="targetMinutesRemainder" type="number" min="0" max="59" value="${mins%60}" required /></div>
        </div>
        <div class="form-group">
          <label class="form-label">Eingabe</label>
          <select class="form-select" id="timeEntryMode">
            <option value="daily" ${entryMode === 'daily' ? 'selected' : ''}>Zeit dieses Tages</option>
            <option value="cumulative" ${entryMode === 'cumulative' ? 'selected' : ''}>Wochenstand bis zu diesem Tag</option>
          </select>
        </div>`;
    } else {
      const cfg = config || {};
      box.innerHTML = `
        <div class="form-grid-2">
          <div class="form-group"><label class="form-label">Alle X Wochen</label><input class="form-input" id="everyWeeks" type="number" min="1" max="52" value="${cfg.everyWeeks || 1}" required /></div>
          <div class="form-group"><label class="form-label">Erster fester Termin</label><input class="form-input" id="anchorDate" type="date" value="${cfg.anchorDate || nextWeekdayKey(currentLifeDateKey(), 6)}" required /></div>
        </div>
        <div class="form-grid-2">
          <div class="form-group"><label class="form-label">Tage vorher erlaubt</label><input class="form-input" id="windowBefore" type="number" min="0" max="30" value="${cfg.windowBefore ?? 1}" required /></div>
          <div class="form-group"><label class="form-label">Tage danach erlaubt</label><input class="form-input" id="windowAfter" type="number" min="0" max="30" value="${cfg.windowAfter ?? 2}" required /></div>
        </div>
        `;
    }
  }

  function readTypeConfig(type) {
    if (type === 'daily_boolean') {
      return { weekdays: [...document.querySelectorAll('input[name="weekday"]:checked')].map(x => Number(x.value)) };
    }
    if (type === 'weekly_count') return { targetCount: Math.max(1, Number(document.getElementById('targetCount').value || 1)) };
    if (type === 'time_weekly') {
      const h = Math.max(0, Number(document.getElementById('targetHours').value || 0));
      const m = Math.max(0, Math.min(59, Number(document.getElementById('targetMinutesRemainder').value || 0)));
      return { targetMinutes: h * 60 + m, entryMode: document.getElementById('timeEntryMode')?.value || 'daily' };
    }
    return {
      everyWeeks: Math.max(1, Number(document.getElementById('everyWeeks').value || 1)),
      anchorDate: document.getElementById('anchorDate').value,
      windowBefore: Math.max(0, Number(document.getElementById('windowBefore').value || 0)),
      windowAfter: Math.max(0, Number(document.getElementById('windowAfter').value || 0))
    };
  }

  function openTimeModal(habit, dateKey) {
    const v = habitVersion(habit, dateKey);
    const entry = getEntry(dateKey, habit.id);
    const week = weekStartKey(dateKey);
    const mode = v.config.entryMode || 'daily';
    const weekMinutes = sumMinutesInWeek(habit.id, week, habit, dateKey);
    const previousWeekMinutes = sumMinutesInWeek(habit.id, week, habit, addDaysKey(dateKey, -1));
    const minutes = mode === 'cumulative'
      ? (entry?.minutes != null ? Number(entry.minutes) : previousWeekMinutes)
      : Number(entry?.minutes || 0);

    openModal(`
      <div class="modal-head">
        <div>
          <div class="modal-title" id="modalTitle">${escapeHtml(v.name)}</div>
          <div class="modal-subtitle">${mode === 'cumulative' ? 'Wochenstand' : formatShortDate(dateKey)} · ${formatDuration(weekMinutes)} / ${formatDuration(v.config.targetMinutes)}</div>
        </div>
        <button class="modal-close" data-close>×</button>
      </div>
      <form id="timeForm">
        <div class="time-input-wrap">
          <div class="time-box"><label>STUNDEN</label><input id="timeHours" type="number" inputmode="numeric" min="0" max="168" value="${Math.floor(minutes/60)}"></div>
          <div class="time-box"><label>MINUTEN</label><input id="timeMinutes" type="number" inputmode="numeric" min="0" max="59" value="${minutes%60}"></div>
        </div>
        <div class="quick-chips">
          <button type="button" class="quick-chip" data-add-min="30">+30 min</button>
          <button type="button" class="quick-chip" data-add-min="60">+1 h</button>
          <button type="button" class="quick-chip" data-add-min="120">+2 h</button>
        </div>
        <div class="button-row three" style="margin-top:16px">
          <button class="primary-button" type="submit">Speichern</button>
          <button class="danger-button" type="button" id="timeFail">Rot</button>
          <button class="secondary-button" type="button" id="timeReset">Grau</button>
        </div>
      </form>
    `);

    const hours = document.getElementById('timeHours');
    const mins = document.getElementById('timeMinutes');
    document.querySelectorAll('[data-add-min]').forEach(btn => {
      btn.onclick = () => {
        let total = Number(hours.value || 0) * 60 + Number(mins.value || 0) + Number(btn.dataset.addMin);
        hours.value = Math.floor(total / 60);
        mins.value = total % 60;
      };
    });
    document.getElementById('timeForm').onsubmit = e => {
      e.preventDefault();
      const total = Math.max(0, Number(hours.value || 0) * 60 + Math.min(59, Number(mins.value || 0)));
      if (total <= 0) deleteEntry(dateKey, habit.id);
      else setEntry(dateKey, habit.id, { status: 'success', minutes: total, timeMode: mode });
      saveState(); closeModal(); renderToday();
    };
    document.getElementById('timeFail').onclick = () => {
      setEntry(dateKey, habit.id, { status: 'fail', minutes: mode === 'cumulative' ? minutes : 0, timeMode: mode });
      saveState(); closeModal(); renderToday();
    };
    document.getElementById('timeReset').onclick = () => {
      deleteEntry(dateKey, habit.id); saveState(); closeModal(); renderToday();
    };
  }

  function openDataTools() {
    openModal(`
      <div class="modal-head">
        <div><div class="modal-title" id="modalTitle">Daten & Backup</div></div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="list">
        <button class="secondary-button full" id="exportData">Backup exportieren</button>
        <button class="secondary-button full" id="importData">Backup importieren</button>
        <button class="danger-button full" id="resetData">Alle lokalen Daten löschen</button>
      </div>
    `);
    document.getElementById('exportData').onclick = exportData;
    document.getElementById('importData').onclick = () => importInput.click();
    document.getElementById('resetData').onclick = () => openConfirmModal('Wirklich alles löschen?', 'Alle Habits, Einträge und Überweisungen dieses Browsers werden gelöscht.', () => {
      state = defaultState(); saveState(); closeModal(); renderHabits(); toast('Lokale Daten zurückgesetzt.');
    });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifecheck-backup-${currentLifeDateKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.habits || !parsed.entries || !parsed.settings) throw new Error('Ungültiges Backup');
        state = parsed; ensureStateShape(); saveState(); closeModal(); render(); toast('Backup importiert.');
      } catch (err) { toast('Backup konnte nicht gelesen werden.'); }
      importInput.value = '';
    };
    reader.readAsText(file);
  }

  // -------------------- Evaluation --------------------

  function evaluateWeek(weekStart, closed = isClosedWeek(weekStart)) {
    const items = applicableHabitsForWeek(weekStart)
      .map(h => {
        const ev = evaluateHabitForWeek(h, weekStart, closed);
        const ref = evaluationReferenceDate(h, weekStart);
        const v = habitVersion(h, ref) || latestHabitVersion(h);
        return ev.applicable ? { ...ev, habitId: h.id, name: v?.name || 'Habit', penalty: Number(v?.penalty || 0) } : null;
      })
      .filter(Boolean)
      .sort((a,b) => a.order - b.order);

    let score = 100;
    let successCount = 0, failCount = 0, neutralCount = 0;
    for (const item of items) {
      if (item.status === 'success') {
        successCount++;
      } else {
        score *= (100 - clamp(Number(item.penalty || 0), 0, 100)) / 100;
        if (item.status === 'fail') failCount++; else neutralCount++;
      }
    }
    return { score: clamp(Math.round(score * 10) / 10, 0, 100), items, successCount, failCount, neutralCount };
  }

  function evaluateHabitForWeek(habit, weekStart, closed) {
    const activeDates = datesInWeek(weekStart).filter(d => habitActiveOnDate(habit, d));
    if (!activeDates.length) return { applicable: false, status: 'neutral', detail: '', order: 999 };
    const referenceDate = evaluationReferenceDate(habit, weekStart);
    const v = habitVersion(habit, referenceDate) || habitVersion(habit, activeDates[0]);
    if (!v) return { applicable: false, status: 'neutral', detail: '', order: 999 };

    if (v.type === 'daily_boolean') {
      const req = dailyRequiredDates(habit, weekStart);
      if (!req.length) return { applicable: false, status: 'neutral', detail: '', order: v.order };
      const entries = req.map(d => ({ d, e: getEntry(d, habit.id) }));
      const success = entries.filter(x => x.e?.status === 'success').length;
      const explicitFail = entries.some(x => x.e?.status === 'fail');
      const status = explicitFail ? 'fail' : success === req.length ? 'success' : closed ? 'fail' : 'neutral';
      return { applicable: true, status, detail: `${success} / ${req.length} relevante Tage grün`, order: v.order };
    }

    if (v.type === 'weekly_count') {
      const count = weeklySuccessCount(habit.id, weekStart, habit);
      const target = Number(v.config.targetCount || 1);
      const status = count >= target ? 'success' : closed ? 'fail' : 'neutral';
      return { applicable: true, status, detail: `${count} / ${target} diese Woche`, order: v.order };
    }

    if (v.type === 'time_weekly') {
      const minutes = sumMinutesInWeek(habit.id, weekStart, habit);
      const target = Number(v.config.targetMinutes || 0);
      const status = minutes >= target ? 'success' : closed ? 'fail' : 'neutral';
      return { applicable: true, status, detail: `${formatDuration(minutes)} / ${formatDuration(target)}`, order: v.order };
    }

    if (v.type === 'anchored_cycle') {
      const cycles = cyclesScoredInWeek(habit, weekStart);
      if (!cycles.length) return { applicable: false, status: 'neutral', detail: '', order: v.order };
      const results = cycles.map(cycle => ({ cycle, successDate: cycleSuccessDate(habit, cycle) }));
      const allSuccess = results.every(r => r.successDate);
      const today = currentLifeDateKey();
      const allDeadlinesPassed = results.every(r => today > r.cycle.windowEnd || closed);
      const status = allSuccess ? 'success' : allDeadlinesPassed ? 'fail' : 'neutral';
      const details = results.map(r => `Termin ${formatShortDate(r.cycle.anchor)} · Frist ${formatShortDate(r.cycle.windowEnd)}${r.successDate ? ` · erledigt ${formatShortDate(r.successDate)}` : ''}`).join(' · ');
      return { applicable: true, status, detail: details, order: v.order };
    }

    return { applicable: false, status: 'neutral', detail: '', order: v.order };
  }

  function evaluationReferenceDate(habit, weekStart) {
    const active = datesInWeek(weekStart).filter(d => habitActiveOnDate(habit, d));
    return active.length ? active[active.length - 1] : weekStart;
  }

  function applicableHabitsForWeek(weekStart) {
    return state.habits.filter(h => {
      const activeAny = datesInWeek(weekStart).some(d => habitActiveOnDate(h, d));
      if (!activeAny) return false;
      const v = habitVersion(h, evaluationReferenceDate(h, weekStart));
      if (v?.type === 'anchored_cycle') return cyclesScoredInWeek(h, weekStart).length > 0;
      return true;
    });
  }

  function dailyRequiredDates(habit, weekStart) {
    return datesInWeek(weekStart).filter(d => {
      if (!habitActiveOnDate(habit, d)) return false;
      const v = habitVersion(habit, d);
      return v?.type === 'daily_boolean' && (v.config.weekdays || []).includes(weekdayMon0(d));
    });
  }

  function dailySuccessCount(habit, weekStart) {
    return dailyRequiredDates(habit, weekStart).filter(d => getEntry(d, habit.id)?.status === 'success').length;
  }

  function weeklySuccessCount(habitId, weekStart, habit) {
    return datesInWeek(weekStart).filter(d => habitActiveOnDate(habit, d) && getEntry(d, habitId)?.status === 'success').length;
  }

  function sumMinutesInWeek(habitId, weekStart, habit, throughDate = null) {
    let total = 0;
    const limit = throughDate || addDaysKey(weekStart, 6);
    for (const d of datesInWeek(weekStart)) {
      if (d > limit || !habitActiveOnDate(habit, d)) continue;
      const entry = getEntry(d, habitId);
      if (!entry || entry.minutes == null) continue;
      const v = habitVersion(habit, d);
      if (!v || v.type !== 'time_weekly') continue;
      const mode = entry.timeMode || v.config?.entryMode || 'daily';
      if (mode === 'cumulative') total = Number(entry.minutes || 0);
      else total += Number(entry.minutes || 0);
    }
    return Math.max(0, total);
  }

  // Anchored cycles are scored in the week containing the END of the allowed window.
  // This keeps Monday 04:00 payouts deterministic even if the due day is Sunday and grace extends into Tuesday.
  function cyclesScoredInWeek(habit, weekStart) {
    const weekEnd = addDaysKey(weekStart, 6);
    const v = habitVersion(habit, evaluationReferenceDate(habit, weekStart)) || latestHabitVersion(habit);
    if (!v || v.type !== 'anchored_cycle') return [];
    const cfg = v.config;
    const anchor = cfg.anchorDate;
    if (!anchor) return [];
    const results = [];
    const startProbe = addDaysKey(weekStart, -Math.max(0, Number(cfg.windowAfter || 0)) - 14);
    const endProbe = addDaysKey(weekEnd, 14);
    const base = parseKey(anchor);
    const startIndex = Math.floor(daysBetweenKeys(anchor, startProbe) / (7 * Math.max(1, Number(cfg.everyWeeks || 1)))) - 1;
    for (let i = Math.max(-5200, startIndex); i < startIndex + 10; i++) {
      const cycleAnchor = addDaysKey(anchor, i * 7 * Math.max(1, Number(cfg.everyWeeks || 1)));
      if (cycleAnchor < addDaysKey(habit.createdAt, -30)) continue;
      if (cycleAnchor > endProbe) break;
      const cycle = cycleObjectFromAnchor(habit, cycleAnchor);
      if (!cycle) continue;
      if (cycle.windowEnd >= weekStart && cycle.windowEnd <= weekEnd && habitActiveOnDate(habit, cycle.anchor)) results.push(cycle);
    }
    return results;
  }

  function cycleForDate(habit, dateKey) {
    const versions = habit.versions.slice().sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let vi = versions.length - 1; vi >= 0; vi--) {
      const v = versions[vi];
      if (v.type !== 'anchored_cycle') continue;
      const cfg = v.config;
      const everyDays = Math.max(1, Number(cfg.everyWeeks || 1)) * 7;
      const diff = daysBetweenKeys(cfg.anchorDate, dateKey);
      const approx = Math.round(diff / everyDays);
      for (let i = approx - 2; i <= approx + 2; i++) {
        const anchor = addDaysKey(cfg.anchorDate, i * everyDays);
        const cycle = cycleObjectFromAnchor(habit, anchor, v);
        if (!cycle) continue;
        if (dateKey >= cycle.windowStart && dateKey <= cycle.windowEnd && habitActiveOnDate(habit, cycle.anchor)) return cycle;
      }
    }
    return null;
  }

  function nextCycleForDate(habit, dateKey) {
    const v = habitVersion(habit, dateKey) || latestHabitVersion(habit);
    if (!v || v.type !== 'anchored_cycle') return null;
    const cfg = v.config;
    const everyDays = Math.max(1, Number(cfg.everyWeeks || 1)) * 7;
    let i = Math.floor(daysBetweenKeys(cfg.anchorDate, dateKey) / everyDays) - 1;
    for (let k = 0; k < 20; k++, i++) {
      const cycle = cycleObjectFromAnchor(habit, addDaysKey(cfg.anchorDate, i * everyDays), v);
      if (cycle && cycle.windowEnd >= dateKey && habitActiveOnDate(habit, cycle.anchor)) return cycle;
    }
    return null;
  }

  function cycleObjectFromAnchor(habit, anchor, explicitVersion) {
    const v = explicitVersion || habitVersion(habit, anchor);
    if (!v || v.type !== 'anchored_cycle') return null;
    const before = Math.max(0, Number(v.config.windowBefore || 0));
    const after = Math.max(0, Number(v.config.windowAfter || 0));
    return { anchor, windowStart: addDaysKey(anchor, -before), windowEnd: addDaysKey(anchor, after), version: v };
  }

  function cycleSuccessDate(habit, cycle) {
    let d = cycle.windowStart;
    while (d <= cycle.windowEnd) {
      if (habitActiveOnDate(habit, d) && getEntry(d, habit.id)?.status === 'success') return d;
      d = addDaysKey(d, 1);
    }
    return null;
  }

  function cycleTimingText(cycle, today) {
    const toAnchor = daysBetweenKeys(today, cycle.anchor);
    const toEnd = daysBetweenKeys(today, cycle.windowEnd);
    if (today < cycle.windowStart) return `in ${daysBetweenKeys(today, cycle.windowStart)} Tagen`;
    if (toAnchor > 1) return `noch ${toAnchor} Tage`;
    if (toAnchor === 1) return 'morgen fällig';
    if (toAnchor === 0) return 'heute fällig';
    if (toEnd > 1) return `noch ${toEnd} Tage`;
    if (toEnd === 1) return 'nur noch morgen';
    if (toEnd === 0) return 'nur noch heute';
    return 'verpasst';
  }

  // -------------------- Rewards calculations --------------------

  function weeklyRewardFromMonthly(monthly) {
    return Math.floor(((Number(monthly || 0) * 12 / 52) / 5)) * 5;
  }

  function rewardVersionForWeek(weekStart) {
    const versions = state.settings.rewardVersions.slice().sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    let found = versions[0] || { monthlyMax: 0 };
    for (const v of versions) if (v.effectiveFrom <= weekStart) found = v;
    return found;
  }

  function weeklyRewardForWeek(weekStart) {
    return weeklyRewardFromMonthly(rewardVersionForWeek(weekStart)?.monthlyMax || 0);
  }

  function upsertRewardVersion(effectiveFrom, monthlyMax) {
    const list = state.settings.rewardVersions;
    const idx = list.findIndex(v => v.effectiveFrom === effectiveFrom);
    if (idx >= 0) list[idx] = { effectiveFrom, monthlyMax };
    else list.push({ effectiveFrom, monthlyMax });
    list.sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }

  function totalEarnedClosedWeeks() {
    const currentWeek = weekStartKey(currentLifeDateKey());
    const starts = [
      ...state.habits.map(h => h.createdAt),
      ...state.settings.rewardVersions.map(v => v.effectiveFrom)
    ].filter(Boolean).sort();
    if (!starts.length) return 0;
    let week = weekStartKey(starts[0]);
    let total = 0;
    let guard = 0;
    while (week < currentWeek && guard++ < 5200) {
      const ev = evaluateWeek(week, true);
      if (ev.items.length) total += weeklyRewardForWeek(week) * ev.score / 100;
      week = addDaysKey(week, 7);
    }
    return roundMoney(total);
  }

  // -------------------- Habit versions --------------------

  function activeHabitsOnDate(dateKey) {
    return state.habits.filter(h => habitActiveOnDate(h, dateKey) && habitVersion(h, dateKey));
  }

  function habitActiveOnDate(habit, dateKey) {
    return habit.createdAt <= dateKey && (!habit.endedAt || dateKey < habit.endedAt);
  }

  function habitVersion(habit, dateKey) {
    if (!habit) return null;
    const versions = habit.versions.slice().sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    let found = null;
    for (const v of versions) if (v.effectiveFrom <= dateKey) found = v;
    return found;
  }

  function latestHabitVersion(habit) {
    return habit?.versions?.slice().sort((a,b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null;
  }

  function upsertHabitVersion(habit, effectiveFrom, version) {
    const copy = clone(version);
    copy.effectiveFrom = effectiveFrom;
    const idx = habit.versions.findIndex(v => v.effectiveFrom === effectiveFrom);
    if (idx >= 0) habit.versions[idx] = copy;
    else habit.versions.push(copy);
    habit.versions.sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }

  function defaultConfigForType(type) {
    if (type === 'daily_boolean') return { weekdays: [0,1,2,3,4,5,6] };
    if (type === 'weekly_count') return { targetCount: 1 };
    if (type === 'time_weekly') return { targetMinutes: 10 * 60, entryMode: 'daily' };
    return { everyWeeks: 1, anchorDate: nextWeekdayKey(currentLifeDateKey(), 6), windowBefore: 1, windowAfter: 2 };
  }

  function habitRuleText(v) {
    if (v.type === 'daily_boolean') {
      const days = v.config.weekdays || [];
      return days.length === 7 ? 'jeden Tag' : days.map(i => WEEKDAYS[i]).join(', ');
    }
    if (v.type === 'weekly_count') return `${v.config.targetCount}× pro Woche`;
    if (v.type === 'time_weekly') return `${formatDuration(v.config.targetMinutes)} / Woche${v.config.entryMode === 'cumulative' ? ' · Wochenstand' : ''}`;
    if (v.type === 'anchored_cycle') return `alle ${v.config.everyWeeks} Wo. · Termin ${formatShortDate(v.config.anchorDate)} · Fenster −${v.config.windowBefore}/+${v.config.windowAfter} Tage`;
    return v.type;
  }

  // -------------------- Entries --------------------

  function getEntry(dateKey, habitId) {
    return state.entries?.[dateKey]?.[habitId] || null;
  }

  function setEntry(dateKey, habitId, value) {
    state.entries[dateKey] ||= {};
    state.entries[dateKey][habitId] = { ...value, updatedAt: new Date().toISOString() };
  }

  function deleteEntry(dateKey, habitId) {
    if (!state.entries[dateKey]) return;
    delete state.entries[dateKey][habitId];
    if (!Object.keys(state.entries[dateKey]).length) delete state.entries[dateKey];
  }

  // -------------------- Modal helpers --------------------

  function openModal(html) {
    modal.innerHTML = html;
    modalBackdrop.classList.remove('hidden');
    modal.querySelectorAll('[data-close]').forEach(btn => btn.onclick = closeModal);
  }

  function closeModal() {
    modalBackdrop.classList.add('hidden');
    modal.innerHTML = '';
  }

  function openInfoModal(title, text) {
    openModal(`
      <div class="modal-head"><div><div class="modal-title" id="modalTitle">${escapeHtml(title)}</div></div><button class="modal-close" data-close>×</button></div>
      <div class="inline-note">${escapeHtml(text)}</div>
      <button class="primary-button full" data-close style="margin-top:12px">OK</button>
    `);
  }

  function openConfirmModal(title, text, onConfirm) {
    openModal(`
      <div class="modal-head"><div><div class="modal-title" id="modalTitle">${escapeHtml(title)}</div></div><button class="modal-close" data-close>×</button></div>
      <div class="inline-note">${escapeHtml(text)}</div>
      <div class="button-row" style="margin-top:12px"><button class="danger-button" id="confirmYes">Bestätigen</button><button class="secondary-button" data-close>Abbrechen</button></div>
    `);
    document.getElementById('confirmYes').onclick = onConfirm;
  }

  function toast(text) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  // -------------------- Date helpers --------------------

  function currentLifeDateKey() {
    const now = new Date();
    const boundary = 4;
    if (now.getHours() < boundary) now.setDate(now.getDate() - 1);
    return dateToKey(now);
  }

  function parseKey(key) {
    const [y,m,d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function dateToKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function addDaysKey(key, days) {
    const d = parseKey(key); d.setDate(d.getDate() + days); return dateToKey(d);
  }

  function daysBetweenKeys(a, b) {
    const aa = Date.UTC(...a.split('-').map((n,i) => i === 1 ? Number(n)-1 : Number(n)));
    const bb = Date.UTC(...b.split('-').map((n,i) => i === 1 ? Number(n)-1 : Number(n)));
    return Math.round((bb - aa) / DAY_MS);
  }

  function weekdayMon0(key) {
    const js = parseKey(key).getDay();
    return (js + 6) % 7;
  }

  function weekStartKey(key) {
    return addDaysKey(key, -weekdayMon0(key));
  }

  function datesInWeek(weekStart) {
    return Array.from({ length: 7 }, (_,i) => addDaysKey(weekStart, i));
  }

  function isClosedWeek(weekStart) {
    return weekStart < weekStartKey(currentLifeDateKey());
  }

  function nextWeekdayKey(fromKey, targetMon0) {
    const current = weekdayMon0(fromKey);
    const diff = (targetMon0 - current + 7) % 7;
    return addDaysKey(fromKey, diff);
  }

  // -------------------- Formatting --------------------

  function formatFullDate(key) {
    const d = parseKey(key);
    return `${WEEKDAY_LONG[weekdayMon0(key)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  }

  function formatShortDate(key) {
    const d = parseKey(key);
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`;
  }

  function formatWeekRange(weekStart) {
    const a = parseKey(weekStart), b = parseKey(addDaysKey(weekStart, 6));
    if (a.getMonth() === b.getMonth()) return `${a.getDate()}.–${b.getDate()}. ${MONTHS[b.getMonth()]}`;
    return `${a.getDate()}. ${MONTHS[a.getMonth()].slice(0,3)} – ${b.getDate()}. ${MONTHS[b.getMonth()].slice(0,3)}`;
  }

  function formatDuration(minutes) {
    minutes = Math.max(0, Math.round(Number(minutes || 0)));
    const h = Math.floor(minutes / 60), m = minutes % 60;
    if (h && m) return `${h} h ${m} min`;
    if (h) return `${h} h`;
    return `${m} min`;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(Number(value || 0));
  }

  function roundMoney(n) { return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100; }
  function numberClean(n) { return Number.isInteger(Number(n)) ? String(Number(n)) : String(Number(n).toFixed(1)); }
  function statusLabel(s) { return s === 'success' ? 'geschafft' : s === 'fail' ? 'nicht geschafft' : 'offen'; }

  // -------------------- Misc --------------------

  function typeOption(value, label, selected) { return `<option value="${value}" ${value===selected?'selected':''}>${label}</option>`; }
  function clamp(n,min,max){ return Math.min(max,Math.max(min,n)); }
  function uid(){ return 'h_' + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4); }
  function clone(obj){ return JSON.parse(JSON.stringify(obj)); }
  function escapeHtml(value=''){ return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function escapeAttr(value=''){ return escapeHtml(value); }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }
  }
})();
