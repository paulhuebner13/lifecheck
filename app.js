(() => {
  'use strict';

  const STORAGE_KEY = 'lifecheck-state-v1';
  const DAY_MS = 86400000;
  const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const WEEKDAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const TINT_COUNT = 6;

  const app = document.getElementById('app');
  const pageTitle = document.getElementById('pageTitle');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modal');
  const importInput = document.getElementById('importInput');

  let activeTab = 'today';
  let selectedDate = currentLifeDateKey();
  let calendarWeeksShown = 12;
  let state = loadState();
  let modalCloseHandler = null;

  ensureStateShape();
  saveState();
  bindShell();
  registerServiceWorker();
  render();

  function defaultState() {
    const start = weekStartKey(currentLifeDateKey());
    return {
      settings: {
        weekBoundaryHour: 4,
        rewardVersions: [{ effectiveFrom: start, monthlyMax: 400 }],
        timeDailyGreenPercent: 80
      },
      habits: [
        makeHabit('uni', start, 'Uni', 'time_weekly', 20, 0, { targetMinutes: 15 * 60, entryMode: 'cumulative' }),
        makeHabit('arbeit', start, 'Arbeit', 'time_weekly', 15, 1, { targetMinutes: 20 * 60, entryMode: 'cumulative' }),
        makeHabit('kein-porn', start, 'Kein Porn', 'daily_boolean', 20, 2, {}),
        makeHabit('aufraeumen', start, 'Aufräumen', 'daily_boolean', 10, 3, {}),
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
      meta: { createdAt: new Date().toISOString(), version: 2 }
    };
  }

  function makeHabit(id, start, name, type, penalty, order, config) {
    return {
      id,
      createdAt: start,
      endedAt: null,
      versions: [{ effectiveFrom: start, name, type, penalty, order, config }]
    };
  }

  function ensureStateShape() {
    if (!state || typeof state !== 'object') state = defaultState();
    state.settings ||= {};
    state.settings.weekBoundaryHour ??= 4;
    state.settings.timeDailyGreenPercent = clamp(Number(state.settings.timeDailyGreenPercent ?? 80), 0, 100);
    state.settings.rewardVersions ||= [{ effectiveFrom: weekStartKey(currentLifeDateKey()), monthlyMax: 400 }];
    state.habits ||= [];
    state.entries ||= {};
    state.transfers ||= [];
    state.meta ||= { createdAt: new Date().toISOString(), version: 2 };
    state.meta.version = 2;

    for (const habit of state.habits) {
      habit.versions ||= [];
      for (const version of habit.versions) {
        version.config ||= {};
        version.penalty = clamp(Number(version.penalty || 0), 0, 100);
        if (version.type === 'daily_boolean') version.config = {};
        if (version.type === 'weekly_count') version.config.targetCount = Math.max(1, Number(version.config.targetCount || 1));
        if (version.type === 'time_weekly') {
          version.config.targetMinutes = Math.max(0, Number(version.config.targetMinutes || 0));
          version.config.entryMode ||= habit.id === 'arbeit' ? 'cumulative' : 'daily';
        }
        if (version.type === 'anchored_cycle') {
          version.config.everyWeeks = Math.max(1, Number(version.config.everyWeeks || 1));
          version.config.anchorDate ||= nextWeekdayKey(version.effectiveFrom || currentLifeDateKey(), 6);
          version.config.windowBefore = Math.max(0, Number(version.config.windowBefore ?? 1));
          version.config.windowAfter = Math.max(0, Number(version.config.windowAfter ?? 2));
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

    document.getElementById('settingsQuick')?.addEventListener('click', () => {
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
    document.querySelector('.app-shell')?.classList.toggle('today-mode', activeTab === 'today');
    if (activeTab === 'today') renderToday();
    else if (activeTab === 'calendar') renderCalendar();
    else if (activeTab === 'rewards') renderRewards();
    else renderHabits();
  }

  // -------------------- Today --------------------

  function renderToday() {
    const today = currentLifeDateKey();
    pageTitle.textContent = '';

    const weekStart = weekStartKey(selectedDate);
    const summary = selectedDate === today ? evaluatePreviewWeek(selectedDate) : evaluateWeek(weekStart);
    const weeklyMax = weeklyRewardForWeek(weekStart);
    const money = roundMoney(weeklyMax * summary.score / 100);
    const habits = activeHabitsOnDate(selectedDate)
      .sort((a,b) => (habitVersion(a, selectedDate)?.order ?? 999) - (habitVersion(b, selectedDate)?.order ?? 999));

    app.innerHTML = `
      <div class="date-switcher">
        <button class="date-arrow" id="prevDay" aria-label="Voriger Tag">‹</button>
        <button class="date-center" id="jumpToday">${formatFullDate(selectedDate)}</button>
        <button class="date-arrow" id="nextDay" aria-label="Nächster Tag" ${selectedDate >= today ? 'disabled' : ''}>›</button>
      </div>

      <div class="today-summary">
        <strong>${numberClean(summary.score)}%</strong>
        <span>${formatMoney(money)} / ${formatMoney(weeklyMax)}</span>
      </div>

      ${habits.length ? `<div class="tile-grid">${habits.map(h => renderHabitTile(h, selectedDate)).join('')}</div>` : `<div class="empty-state">Keine Habits</div>`}
    `;

    document.getElementById('prevDay').onclick = () => {
      selectedDate = addDaysKey(selectedDate, -1);
      renderToday();
    };
    document.getElementById('nextDay').onclick = () => {
      if (selectedDate < today) selectedDate = addDaysKey(selectedDate, 1);
      renderToday();
    };
    document.getElementById('jumpToday').onclick = () => {
      selectedDate = today;
      renderToday();
    };

    document.querySelectorAll('.tile').forEach(tile => {
      tile.addEventListener('click', () => handleTileClick(tile.dataset.habitId, selectedDate));
    });
  }


  function renderHabitTile(habit, dateKey) {
    const v = habitVersion(habit, dateKey);
    if (!v) return '';
    const display = tileDisplay(habit, v, dateKey);
    const preview = impactPreview(habit, dateKey);
    const streak = habitStreak(habit, dateKey);
    const tint = Math.abs(Number(v.order || 0)) % TINT_COUNT;
    const disabledClass = display.disabled ? ' is-disabled' : '';
    const disabledAttr = display.disabled ? ' disabled aria-disabled="true"' : '';

    return `
      <button class="tile tint-${tint} status-${display.status}${disabledClass}" data-habit-id="${escapeAttr(habit.id)}"${disabledAttr}>
        <div class="tile-head">
          <div class="tile-name">${escapeHtml(v.name)}</div>
        </div>
        <div class="tile-body">
          ${display.symbol ? `<div class="tile-symbol" aria-hidden="true">${display.symbol}</div>` : ''}
          ${display.timeRows ? `
            <div class="time-status">
              <div class="time-status-row">
                <span class="time-status-label">Tag</span>
                <span class="time-status-value">${escapeHtml(display.timeRows.dayValue)}</span>
                <span class="time-status-target">/ ${escapeHtml(display.timeRows.dayTarget)}</span>
              </div>
              <div class="time-status-row">
                <span class="time-status-label">Woche</span>
                <span class="time-status-value">${escapeHtml(display.timeRows.weekValue)}</span>
                <span class="time-status-target">/ ${escapeHtml(display.timeRows.weekTarget)}</span>
              </div>
            </div>` : ''}
          ${display.main ? `<div class="tile-main ${display.small ? 'small' : ''}">${escapeHtml(display.main)}</div>` : ''}
          ${display.progress != null ? `<div class="tile-progress"><span style="width:${clamp(display.progress, 0, 100)}%"></span></div>` : ''}
          ${display.sub ? `<div class="tile-sub">${escapeHtml(display.sub)}</div>` : ''}
        </div>
        <div class="tile-streak">Streak ${streak}</div>
        <div class="tile-penalty">
          <span>${escapeHtml(preview.period)}</span>
          <span>${escapeHtml(preview.percentText)}</span>
          <span>${escapeHtml(preview.moneyText)}</span>
        </div>
      </button>
    `;
  }

  function tileDisplay(habit, v, dateKey) {
    const entry = getEntry(dateKey, habit.id);
    const week = weekStartKey(dateKey);

    if (v.type === 'daily_boolean') {
      let status = entry?.status || 'neutral';
      if (!entry && dateKey < currentLifeDateKey()) status = 'missed';
      return {
        status,
        symbol: statusSymbol(status),
        main: '',
        sub: status === 'missed' ? 'nicht eingetragen' : '',
        progress: null
      };
    }

    if (v.type === 'weekly_count') {
      const count = weeklySuccessCount(habit.id, week, habit);
      const target = Math.max(1, Number(v.config.targetCount || 1));
      const clickedToday = entry?.status === 'success';
      return {
        status: clickedToday ? 'success' : 'neutral',
        symbol: clickedToday ? statusSymbol('success') : '',
        main: '',
        sub: `${count} / ${target} diese Woche`,
        progress: (count / target) * 100
      };
    }

    if (v.type === 'time_weekly') {
      const weekMinutes = sumMinutesInWeek(habit.id, week, habit, dateKey);
      const dayMinutes = timeMinutesForDay(habit, dateKey);
      const target = Math.max(0, Number(v.config.targetMinutes || 0));
      const tolerance = timeToleranceFactor();
      const dayNumber = clamp(daysBetweenKeys(week, dateKey) + 1, 1, 7);
      const dailyNominalTarget = target / 7;
      const weeklyNominalTargetToDate = target * dayNumber / 7;
      const dailyGreenTarget = dailyNominalTarget * tolerance * tolerance;
      const weeklyGreenTargetToDate = weeklyNominalTargetToDate * tolerance;
      const hasEntry = hasTimeEntryOnDate(habit, dateKey);
      const dayClosed = dateKey < currentLifeDateKey();
      const green = target <= 0 || dayMinutes >= dailyGreenTarget;
      const status = green
        ? 'success'
        : dayClosed && !hasEntry
          ? 'missed'
          : hasEntry
            ? 'fail'
            : 'neutral';
      return {
        status,
        symbol: '',
        main: '',
        sub: '',
        timeRows: {
          dayValue: formatDurationCompact(dayMinutes),
          dayTarget: formatDurationCompact(dailyNominalTarget),
          weekValue: formatDurationCompact(weekMinutes),
          weekTarget: formatDurationCompact(weeklyNominalTargetToDate)
        },
        progress: weeklyGreenTargetToDate > 0 ? (weekMinutes / weeklyGreenTargetToDate) * 100 : 100
      };
    }

    if (v.type === 'anchored_cycle') {
      const cycle = cycleForDate(habit, dateKey);
      const next = nextCycleForDate(habit, dateKey);
      if (!cycle) {
        const days = next ? daysBetweenKeys(dateKey, next.windowStart) : null;
        return {
          status: 'neutral',
          symbol: '',
          main: '',
          sub: next ? `${days === 0 ? 'ab heute' : days === 1 ? 'ab morgen' : `in ${days} Tagen`} · Termin ${formatShortDate(next.anchor)}` : '',
          progress: null,
          disabled: true
        };
      }
      const successDate = cycleSuccessDate(habit, cycle);
      const closedMiss = !successDate && cycle.windowEnd < currentLifeDateKey();
      const status = successDate ? 'success' : closedMiss ? 'missed' : 'neutral';
      return {
        status,
        symbol: status === 'success' || status === 'missed' ? statusSymbol(status) : '',
        main: '',
        sub: `${successDate ? `erledigt ${formatShortDate(successDate)}` : closedMiss ? 'Zeitraum verpasst' : cycleTimingText(cycle, dateKey)} · Termin ${formatShortDate(cycle.anchor)}`,
        progress: null
      };
    }

    return { status: 'neutral', symbol: '', main: '', sub: '', progress: null };
  }

  function statusSymbol(status) {
    if (status === 'success') return '✓';
    if (status === 'fail') return '×';
    if (status === 'missed') return '!';
    return '?';
  }
  function hasTimeEntryOnDate(habit, dateKey) {
    const v = habitVersion(habit, dateKey);
    const entry = getEntry(dateKey, habit.id);
    return Boolean(v?.type === 'time_weekly' && entry && entry.minutes != null);
  }

  function timeMinutesForDay(habit, dateKey) {
    const v = habitVersion(habit, dateKey);
    const entry = getEntry(dateKey, habit.id);
    if (!v || v.type !== 'time_weekly' || !entry || entry.minutes == null) return 0;
    const mode = entry.timeMode || v.config?.entryMode || 'daily';
    if (mode !== 'cumulative') return Math.max(0, Number(entry.minutes || 0));
    const week = weekStartKey(dateKey);
    const previous = sumMinutesInWeek(habit.id, week, habit, addDaysKey(dateKey, -1));
    return Math.max(0, Number(entry.minutes || 0) - previous);
  }


  function handleTileClick(habitId, dateKey) {
    const habit = state.habits.find(h => h.id === habitId);
    const v = habitVersion(habit, dateKey);
    if (!habit || !v) return;

    if (v.type === 'time_weekly') {
      openTimeModal(habit, dateKey);
      return;
    }

    if (v.type === 'weekly_count') {
      togglePeriodSuccessEntry(dateKey, habitId);
      saveState();
      renderToday();
      return;
    }

    if (v.type === 'anchored_cycle') {
      if (!cycleForDate(habit, dateKey)) return;
      togglePeriodSuccessEntry(dateKey, habitId);
      saveState();
      renderToday();
      return;
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

  function togglePeriodSuccessEntry(dateKey, habitId) {
    const current = getEntry(dateKey, habitId)?.status;
    if (current === 'success') deleteEntry(dateKey, habitId);
    else setEntry(dateKey, habitId, { status: 'success' });
  }

  function timeToleranceFactor() {
    return clamp(Number(state.settings.timeDailyGreenPercent ?? 80), 0, 100) / 100;
  }

  function timeWeekCheckpointTarget(v, dateKey) {
    const target = Math.max(0, Number(v?.config?.targetMinutes || 0));
    const week = weekStartKey(dateKey);
    const dayNumber = clamp(daysBetweenKeys(week, dateKey) + 1, 1, 7);
    return target * dayNumber / 7;
  }

  function previewFailureCount(habit, weekStart, dateKey, targetHabit = null, forceSuccess = null) {
    const ref = evaluationReferenceDate(habit, weekStart);
    const v = habitVersion(habit, ref) || latestHabitVersion(habit);
    if (!v) return 0;
    const isTarget = Boolean(targetHabit && habit.id === targetHabit.id);
    const closedWeek = isClosedWeek(weekStart);
    const today = currentLifeDateKey();

    if (v.type === 'daily_boolean') {
      let failures = 0;
      const cutoff = closedWeek ? addDaysKey(weekStart, 6) : minDateKey(dateKey, today);
      for (const d of datesInWeek(weekStart)) {
        if (d > cutoff) continue;
        if (!habitActiveOnDate(habit, d) || habitVersion(habit, d)?.type !== 'daily_boolean') continue;
        const entry = getEntry(d, habit.id);
        let success = entry?.status === 'success';
        if (isTarget && forceSuccess != null && d === dateKey) success = forceSuccess;
        if (!success) failures += 1;
      }
      return failures;
    }

    if (v.type === 'weekly_count') {
      const cutoff = closedWeek ? addDaysKey(weekStart, 6) : minDateKey(dateKey, today);
      let count = datesInWeek(weekStart).filter(d => {
        if (d > cutoff || !habitActiveOnDate(habit, d)) return false;
        if (habitVersion(habit, d)?.type !== 'weekly_count') return false;
        if (isTarget && forceSuccess != null && d === dateKey) return forceSuccess;
        return getEntry(d, habit.id)?.status === 'success';
      }).length;
      return count >= Math.max(1, Number(v.config.targetCount || 1)) ? 0 : 1;
    }

    if (v.type === 'time_weekly') {
      if (isTarget && forceSuccess != null) return forceSuccess ? 0 : 1;
      const cutoff = closedWeek ? addDaysKey(weekStart, 6) : minDateKey(dateKey, today);
      const minutes = sumMinutesInWeek(habit.id, weekStart, habit, cutoff);
      const nominalTarget = closedWeek
        ? Math.max(0, Number(v.config.targetMinutes || 0))
        : timeWeekCheckpointTarget(v, cutoff);
      const threshold = nominalTarget * timeToleranceFactor();
      return nominalTarget <= 0 || minutes >= threshold ? 0 : 1;
    }

    if (v.type === 'anchored_cycle') {
      if (closedWeek) return Math.max(0, Number(evaluateHabitForWeek(habit, weekStart).failureCount || 0));
      const cycle = cycleForDate(habit, dateKey);
      if (!cycle) return 0;
      let success = Boolean(cycleSuccessDate(habit, cycle));
      if (isTarget && forceSuccess != null) {
        if (forceSuccess) success = true;
        else if (getEntry(dateKey, habit.id)?.status === 'success') {
          success = datesBetweenKeys(cycle.windowStart, cycle.windowEnd)
            .some(d => d !== dateKey && getEntry(d, habit.id)?.status === 'success');
        }
      }
      return success ? 0 : 1;
    }

    return Math.max(0, Number(evaluateHabitForWeek(habit, weekStart).failureCount || 0));
  }

  function evaluatePreviewWeek(dateKey) {
    const weekStart = weekStartKey(dateKey);
    const items = applicableHabitsForWeek(weekStart)
      .map(habit => {
        const ref = evaluationReferenceDate(habit, weekStart);
        const v = habitVersion(habit, ref) || latestHabitVersion(habit);
        if (!v) return null;
        const failureCount = previewFailureCount(habit, weekStart, dateKey, null, null);
        const penalty = clamp(Number(v.penalty || 0), 0, 100);
        const factor = Math.pow((100 - penalty) / 100, failureCount);
        return { habitId: habit.id, name: v.name, order: v.order, penalty, failureCount, factor };
      })
      .filter(Boolean)
      .sort((a,b) => a.order - b.order);
    const rawFactor = items.reduce((product, item) => product * item.factor, 1);
    return { score: clamp(round1(rawFactor * 100), 0, 100), items };
  }

  function previewScore(habit, dateKey, forceSuccess = null) {
    const weekStart = weekStartKey(dateKey);
    const habits = applicableHabitsForWeek(weekStart);
    let product = 1;
    for (const h of habits) {
      const ref = evaluationReferenceDate(h, weekStart);
      const v = habitVersion(h, ref) || latestHabitVersion(h);
      if (!v) continue;
      const failures = previewFailureCount(h, weekStart, dateKey, habit, h.id === habit.id ? forceSuccess : null);
      const penalty = clamp(Number(v.penalty || 0), 0, 100) / 100;
      product *= Math.pow(1 - penalty, failures);
    }
    return clamp(product * 100, 0, 100);
  }

  function impactPreview(habit, dateKey) {
    const v = habitVersion(habit, dateKey) || latestHabitVersion(habit);
    const period = v?.type === 'daily_boolean' ? 'T' : v?.type === 'anchored_cycle' ? 'Z' : 'W';
    const weekStart = weekStartKey(dateKey);
    const weeklyMax = weeklyRewardForWeek(weekStart);
    let deltaScore = 0;

    if (!v) return { period, percentText: '0%', moneyText: formatMoney(0) };

    if (v.type === 'time_weekly') {
      const currentlyPassing = previewFailureCount(habit, weekStart, dateKey, habit, null) === 0;
      const current = previewScore(habit, dateKey, currentlyPassing);
      const changed = previewScore(habit, dateKey, !currentlyPassing);
      deltaScore = changed - current;
    } else if (v.type === 'anchored_cycle' && !cycleForDate(habit, dateKey)) {
      deltaScore = 0;
    } else {
      const currentlySuccess = v.type === 'weekly_count'
        ? getEntry(dateKey, habit.id)?.status === 'success'
        : v.type === 'anchored_cycle'
          ? getEntry(dateKey, habit.id)?.status === 'success'
          : getEntry(dateKey, habit.id)?.status === 'success';
      const current = previewScore(habit, dateKey, currentlySuccess);
      const changed = previewScore(habit, dateKey, !currentlySuccess);
      deltaScore = changed - current;
    }

    const roundedPct = round1(deltaScore);
    const money = roundMoney(weeklyMax * deltaScore / 100);
    const pctSign = roundedPct > 0 ? '+' : roundedPct < 0 ? '−' : '';
    const moneySign = money > 0 ? '+' : money < 0 ? '−' : '';
    return {
      period,
      percentText: `${pctSign}${numberClean(Math.abs(roundedPct))}%`,
      moneyText: `${moneySign}${formatMoney(Math.abs(money))}`
    };
  }

  function datesBetweenKeys(start, end) {
    const result = [];
    let d = start;
    while (d <= end) {
      result.push(d);
      d = addDaysKey(d, 1);
    }
    return result;
  }

  // -------------------- Calendar --------------------

  function renderCalendar() {
    pageTitle.textContent = 'Kalender';
    const currentWeek = weekStartKey(currentLifeDateKey());
    const weeks = Array.from({ length: calendarWeeksShown }, (_, i) => addDaysKey(currentWeek, -7 * i));

    app.innerHTML = `
      <div class="week-list">${weeks.map(renderWeekRow).join('')}</div>
      <button class="secondary-button full" id="moreWeeks">Mehr</button>
    `;

    document.querySelectorAll('.week-row').forEach(row => {
      row.onclick = () => openWeekDetail(row.dataset.weekStart);
    });
    document.getElementById('moreWeeks').onclick = () => {
      calendarWeeksShown += 12;
      renderCalendar();
    };
  }

  function renderWeekRow(weekStart) {
    const ev = evaluateWeek(weekStart);
    const weeklyMax = weeklyRewardForWeek(weekStart);
    const money = roundMoney(weeklyMax * ev.score / 100);
    const statuses = ev.items.map(item => `<span class="mini-status ${item.status}" title="${escapeAttr(item.name)}"></span>`).join('');

    return `
      <button class="week-row" data-week-start="${weekStart}">
        <div class="week-row-head">
          <div>
            <div class="week-date">${formatWeekRange(weekStart)}</div>
            <div class="week-money">${formatMoney(money)} / ${formatMoney(weeklyMax)}</div>
          </div>
          <div class="week-score">${numberClean(ev.score)}%</div>
        </div>
        <div class="mini-grid">${statuses || '<span class="mini-status neutral"></span>'}</div>
      </button>
    `;
  }


  function openWeekDetail(weekStart) {
    const ev = evaluateWeek(weekStart);
    const weeklyMax = weeklyRewardForWeek(weekStart);
    const money = roundMoney(weeklyMax * ev.score / 100);
    const formula = ev.formulaFactors.length
      ? `100% ${ev.formulaFactors.map(f => `× ${numberClean(f)}%`).join(' ')} = ${numberClean(ev.score)}%`
      : `100% = ${numberClean(ev.score)}%`;
    const rows = ev.items.map(item => `
      <div class="detail-row status-${item.status}">
        <div>
          <div class="detail-title">${escapeHtml(item.name)}</div>
          <div class="detail-meta">${escapeHtml(item.detail)}</div>
        </div>
        <div class="detail-result">
          <strong>${item.failureCount ? `×${numberClean(item.factorPercent)}%` : item.status === 'success' ? '100%' : '—'}</strong>
          ${item.moneyLost > 0 ? `<span>−${formatMoney(item.moneyLost)}</span>` : ''}
        </div>
      </div>
    `).join('');

    openModal(`
      <div class="modal-head">
        <div class="modal-title" id="modalTitle">${formatWeekRange(weekStart)}</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Bewertung</div><div class="metric-value">${numberClean(ev.score)}%</div></div>
        <div class="metric-card"><div class="metric-label">Belohnung</div><div class="metric-value">${formatMoney(money)}</div><div class="metric-sub">max. ${formatMoney(weeklyMax)}</div></div>
      </div>
      <div class="calculation-box">
        <div class="calculation-label">Berechnung</div>
        <div class="calculation-formula">${escapeHtml(formula)}</div>
      </div>
      <div class="detail-list">${rows || '<div class="empty-state">Keine Habits</div>'}</div>
    `);
  }

  // -------------------- Rewards --------------------

  function renderRewards() {
    pageTitle.textContent = 'Belohnung';
    const currentWeek = weekStartKey(currentLifeDateKey());
    const currentEval = evaluateWeek(currentWeek);
    const weeklyMax = weeklyRewardForWeek(currentWeek);
    const currentValue = roundMoney(weeklyMax * currentEval.score / 100);
    const earned = totalEarnedClosedWeeks();
    const transferred = roundMoney(state.transfers.reduce((sum, t) => sum + Number(t.amount || 0), 0));
    const available = roundMoney(Math.max(0, earned - transferred));
    const monthly = rewardVersionForWeek(currentWeek)?.monthlyMax || 0;

    const transferRows = [...state.transfers]
      .sort((a,b) => b.date.localeCompare(a.date))
      .slice(0, 12)
      .map(t => `
        <div class="detail-row">
          <div><div class="detail-title">${formatShortDate(t.date)}</div><div class="detail-meta">${escapeHtml(t.note || 'Überweisung')}</div></div>
          <div class="detail-result"><strong>−${formatMoney(t.amount)}</strong></div>
        </div>
      `).join('');

    app.innerHTML = `
      <section class="reward-hero">
        <div class="metric-label">Noch überweisbar</div>
        <div class="reward-balance">${formatMoney(available)}</div>
        <div class="reward-sub">${formatMoney(earned)} verdient · ${formatMoney(transferred)} überwiesen</div>
      </section>

      <div class="metric-grid section-gap">
        <div class="metric-card"><div class="metric-label">Aktueller Stand</div><div class="metric-value">${formatMoney(currentValue)}</div><div class="metric-sub">${numberClean(currentEval.score)}% von ${formatMoney(weeklyMax)}</div></div>
        <div class="metric-card"><div class="metric-label">Monats-Maximum</div><div class="metric-value">${formatMoney(monthly)}</div><div class="metric-sub">${formatMoney(weeklyMax)} / Woche</div></div>
      </div>

      <div class="button-row section-gap">
        <button class="primary-button" id="addTransfer">Überweisung</button>
        <button class="secondary-button" id="editReward">Maximum</button>
      </div>

      <div class="section-gap">
        <div class="section-title">Überweisungen</div>
        <div class="detail-list standalone">${transferRows || '<div class="empty-state">Keine Überweisungen</div>'}</div>
      </div>
    `;

    document.getElementById('addTransfer').onclick = () => openTransferModal(available);
    document.getElementById('editReward').onclick = openRewardModal;
  }

  function openTransferModal(available) {
    openModal(`
      <div class="modal-head">
        <div class="modal-title" id="modalTitle">Überweisung</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <form id="transferForm">
        <div class="form-group"><label class="form-label">Betrag</label><input class="form-input" id="transferAmount" type="number" min="0.01" step="0.01" max="${available}" required /></div>
        <div class="form-group"><label class="form-label">Datum</label><input class="form-input" id="transferDate" type="date" value="${currentLifeDateKey()}" required /></div>
        <div class="form-group"><label class="form-label">Notiz</label><input class="form-input" id="transferNote" /></div>
        <button class="primary-button full" type="submit">Eintragen</button>
      </form>
    `);

    document.getElementById('transferForm').onsubmit = e => {
      e.preventDefault();
      const amount = Number(document.getElementById('transferAmount').value);
      if (!amount || amount <= 0 || amount > available + 0.001) return;
      state.transfers.push({
        id: uid(),
        amount: roundMoney(amount),
        date: document.getElementById('transferDate').value,
        note: document.getElementById('transferNote').value.trim()
      });
      saveState();
      closeModal();
      renderRewards();
    };
  }

  function openRewardModal() {
    const currentWeek = weekStartKey(currentLifeDateKey());
    const current = rewardVersionForWeek(currentWeek)?.monthlyMax || 0;
    openModal(`
      <div class="modal-head">
        <div class="modal-title" id="modalTitle">Maximum</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <form id="rewardForm">
        <div class="form-group"><label class="form-label">Pro Monat</label><input class="form-input" id="monthlyMax" type="number" min="0" step="5" value="${current}" required /></div>
        <div class="modal-mini" id="weeklyMaxPreview">${formatMoney(weeklyRewardFromMonthly(current))} / Woche</div>
        <button class="primary-button full" type="submit">Speichern</button>
      </form>
    `);

    const input = document.getElementById('monthlyMax');
    input.oninput = () => {
      document.getElementById('weeklyMaxPreview').textContent = `${formatMoney(weeklyRewardFromMonthly(Number(input.value || 0)))} / Woche`;
    };
    document.getElementById('rewardForm').onsubmit = e => {
      e.preventDefault();
      upsertRewardVersion(currentWeek, Math.max(0, Number(input.value || 0)));
      saveState();
      closeModal();
      renderRewards();
    };
  }

  // -------------------- Habits --------------------


  function renderHabits() {
    pageTitle.textContent = 'Habits';
    const today = currentLifeDateKey();
    const habits = state.habits
      .filter(h => habitActiveOnDate(h, today))
      .sort((a,b) => (habitVersion(a, today)?.order ?? 999) - (habitVersion(b, today)?.order ?? 999));

    const tolerancePercent = clamp(Number(state.settings.timeDailyGreenPercent ?? 80), 0, 100);
    app.innerHTML = `
      <div class="habit-toolbar">
        <button class="primary-button" id="addHabit">+ Habit</button>
        <button class="secondary-button" id="dataTools">Daten</button>
      </div>
      <div class="global-setting">
        <div>
          <span class="global-setting-label">Zeit-Ziel erfüllt ab</span>
          <strong id="timeToleranceValue">${numberClean(tolerancePercent)}%</strong>
        </div>
        <input class="setting-range" id="timeTolerance" type="range" min="0" max="100" step="5" value="${tolerancePercent}" />
      </div>
      <div class="scoring-note">
        Zeit: Woche ab Toleranzwert grün. Tagesgrün = 1/7 des Wochenziels × Toleranz × Toleranz.
      </div>
      <div class="habit-list" id="habitList">
        ${habits.map(renderHabitRow).join('') || '<div class="empty-state">Keine Habits</div>'}
      </div>
    `;

    document.getElementById('addHabit').onclick = () => openHabitModal(null);
    document.getElementById('dataTools').onclick = openDataTools;
    const toleranceInput = document.getElementById('timeTolerance');
    toleranceInput.oninput = () => {
      state.settings.timeDailyGreenPercent = clamp(Number(toleranceInput.value || 80), 0, 100);
      document.getElementById('timeToleranceValue').textContent = `${numberClean(state.settings.timeDailyGreenPercent)}%`;
      saveState();
    };
    document.querySelectorAll('.habit-edit-area').forEach(btn => {
      btn.onclick = () => openHabitModal(btn.dataset.habitId);
    });
    enableHabitDrag();
  }
  function renderHabitRow(habit) {
    const v = habitVersion(habit, currentLifeDateKey()) || latestHabitVersion(habit);
    if (!v) return '';
    return `
      <div class="habit-row" data-habit-id="${escapeAttr(habit.id)}">
        <button class="drag-handle" type="button" aria-label="Verschieben" data-drag-handle>⋮⋮</button>
        <button class="habit-edit-area" type="button" data-habit-id="${escapeAttr(habit.id)}">
          <span class="habit-row-title">${escapeHtml(v.name)}</span>
          <span class="habit-row-meta">${escapeHtml(habitRuleText(v))} · −${numberClean(v.penalty)}%</span>
        </button>
      </div>
    `;
  }

  function enableHabitDrag() {
    const list = document.getElementById('habitList');
    if (!list) return;

    document.querySelectorAll('[data-drag-handle]').forEach(handle => {
      handle.addEventListener('pointerdown', e => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        const row = handle.closest('.habit-row');
        if (!row) return;
        handle.setPointerCapture?.(e.pointerId);
        row.classList.add('dragging');
        document.body.classList.add('is-reordering');

        const onMove = ev => {
          const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.habit-row');
          if (!target || target === row || target.parentElement !== list) return;
          const rect = target.getBoundingClientRect();
          const before = ev.clientY < rect.top + rect.height / 2;
          list.insertBefore(row, before ? target : target.nextSibling);
        };

        const onEnd = ev => {
          handle.releasePointerCapture?.(ev.pointerId);
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onEnd);
          handle.removeEventListener('pointercancel', onEnd);
          row.classList.remove('dragging');
          document.body.classList.remove('is-reordering');
          const ids = [...list.querySelectorAll('.habit-row')].map(x => x.dataset.habitId);
          applyHabitOrder(ids);
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
      });
    });
  }

  function applyHabitOrder(ids) {
    const today = currentLifeDateKey();
    ids.forEach((id, order) => {
      const habit = state.habits.find(h => h.id === id);
      const v = habitVersion(habit, today);
      if (!v || Number(v.order) === order) return;
      upsertHabitVersion(habit, today, { ...clone(v), order });
    });
    saveState();
  }

  function openHabitModal(habitId) {
    const today = currentLifeDateKey();
    const habit = habitId ? state.habits.find(h => h.id === habitId) : null;
    const existing = habit ? clone(habitVersion(habit, today) || latestHabitVersion(habit)) : null;
    const defaultType = existing?.type || 'daily_boolean';

    openModal(`
      <div class="modal-head">
        <div class="modal-title" id="modalTitle">${habit ? 'Habit' : 'Neues Habit'}</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <form id="habitForm">
        <div class="sheet-section">
          <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="habitName" maxlength="40" value="${escapeAttr(existing?.name || '')}" required /></div>
          <div class="form-group"><label class="form-label">Typ</label>
            <select class="form-select" id="habitType">
              ${typeOption('daily_boolean','Täglich',defaultType)}
              ${typeOption('weekly_count','X-mal pro Woche',defaultType)}
              ${typeOption('time_weekly','Zeit pro Woche',defaultType)}
              ${typeOption('anchored_cycle','Fester Rhythmus',defaultType)}
            </select>
          </div>
          <div id="typeFields"></div>
        </div>

        <div class="sheet-section">
          <div class="form-grid-2">
            <div class="form-group"><label class="form-label">Minus %</label><input class="form-input" id="habitPenalty" type="number" min="0" max="100" step="1" value="${existing?.penalty ?? 10}" required /></div>
            <div class="form-group"><label class="form-label">Gilt ab</label><input class="form-input" id="effectiveFrom" type="date" value="${today}" required /></div>
          </div>
        </div>

        <div class="button-row">
          <button class="primary-button" type="submit">Speichern</button>
          ${habit ? '<button class="danger-button" type="button" id="endHabit">Entfernen</button>' : '<button class="secondary-button" type="button" data-close>Abbrechen</button>'}
        </div>
      </form>
    `);

    const typeSelect = document.getElementById('habitType');
    const renderFields = () => {
      const cfg = existing && typeSelect.value === existing.type ? existing.config : defaultConfigForType(typeSelect.value);
      renderTypeFields(typeSelect.value, cfg);
    };
    typeSelect.onchange = renderFields;
    renderFields();

    document.getElementById('habitForm').onsubmit = e => {
      e.preventDefault();
      const type = typeSelect.value;
      const effectiveFrom = document.getElementById('effectiveFrom').value;
      const name = document.getElementById('habitName').value.trim();
      const penalty = clamp(Number(document.getElementById('habitPenalty').value || 0), 0, 100);
      const config = readTypeConfig(type);
      if (!name || !effectiveFrom) return;

      if (habit) {
        const previous = habitVersion(habit, effectiveFrom) || latestHabitVersion(habit);
        const oldType = previous?.type;
        const updated = { ...clone(previous), effectiveFrom, name, type, penalty, config };
        upsertHabitVersion(habit, effectiveFrom, updated);
        if (oldType && oldType !== type) deleteEntry(effectiveFrom, habit.id);
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

      selectedDate = today;
      saveState();
      closeModal();
      renderHabits();
    };

    if (habit) {
      document.getElementById('endHabit').onclick = () => {
        const effectiveFrom = document.getElementById('effectiveFrom').value;
        openConfirmModal('Habit entfernen?', () => {
          habit.endedAt = effectiveFrom;
          saveState();
          closeModal();
          renderHabits();
        });
      };
    }
  }

  function renderTypeFields(type, config) {
    const box = document.getElementById('typeFields');
    if (!box) return;

    if (type === 'daily_boolean') {
      box.innerHTML = '';
      return;
    }

    if (type === 'weekly_count') {
      box.innerHTML = `<div class="form-group"><label class="form-label">Pro Woche</label><input class="form-input" id="targetCount" type="number" min="1" max="30" step="1" value="${config.targetCount || 1}" required /></div>`;
      return;
    }

    if (type === 'time_weekly') {
      const mins = Number(config.targetMinutes || 60);
      box.innerHTML = `
        <div class="form-grid-2">
          <div class="form-group"><label class="form-label">Stunden</label><input class="form-input" id="targetHours" type="number" min="0" max="168" value="${Math.floor(mins / 60)}" required /></div>
          <div class="form-group"><label class="form-label">Minuten</label><input class="form-input" id="targetMinutesRemainder" type="number" min="0" max="59" value="${mins % 60}" required /></div>
        </div>
        <div class="modal-mini">Eingabe immer als Wochenstand bis heute.</div>`;
      return;
    }

    box.innerHTML = `
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Alle X Wochen</label><input class="form-input" id="everyWeeks" type="number" min="1" max="52" value="${config.everyWeeks || 1}" required /></div>
        <div class="form-group"><label class="form-label">Fester Termin</label><input class="form-input" id="anchorDate" type="date" value="${config.anchorDate || nextWeekdayKey(currentLifeDateKey(), 6)}" required /></div>
      </div>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Tage vorher</label><input class="form-input" id="windowBefore" type="number" min="0" max="30" value="${config.windowBefore ?? 1}" required /></div>
        <div class="form-group"><label class="form-label">Tage danach</label><input class="form-input" id="windowAfter" type="number" min="0" max="30" value="${config.windowAfter ?? 2}" required /></div>
      </div>`;
  }

  function readTypeConfig(type) {
    if (type === 'daily_boolean') return {};
    if (type === 'weekly_count') return { targetCount: Math.max(1, Number(document.getElementById('targetCount').value || 1)) };
    if (type === 'time_weekly') {
      const h = Math.max(0, Number(document.getElementById('targetHours').value || 0));
      const m = clamp(Number(document.getElementById('targetMinutesRemainder').value || 0), 0, 59);
      return { targetMinutes: h * 60 + m, entryMode: 'cumulative' };
    }
    return {
      everyWeeks: Math.max(1, Number(document.getElementById('everyWeeks').value || 1)),
      anchorDate: document.getElementById('anchorDate').value,
      windowBefore: Math.max(0, Number(document.getElementById('windowBefore').value || 0)),
      windowAfter: Math.max(0, Number(document.getElementById('windowAfter').value || 0))
    };
  }

  // -------------------- Time wheel --------------------


  function openTimeModal(habit, dateKey) {
    const v = habitVersion(habit, dateKey);
    const entry = getEntry(dateKey, habit.id);
    const week = weekStartKey(dateKey);
    const mode = 'cumulative';
    const previousWeekMinutes = sumMinutesInWeek(habit.id, week, habit, addDaysKey(dateKey, -1));
    const initialMinutes = mode === 'cumulative'
      ? (entry?.minutes != null ? Number(entry.minutes) : previousWeekMinutes)
      : Number(entry?.minutes || 0);

    const pickerMinutes = clamp(Math.round(initialMinutes / 5) * 5, 0, 168 * 60);
    const initialHours = Math.floor(pickerMinutes / 60);
    const initialMins = pickerMinutes % 60;
    const minuteValues = Array.from({ length: 36 }, (_, i) => (i % 12) * 5);

    openModal(`
      <div class="modal-head wheel-modal-head">
        <div>
          <div class="modal-title" id="modalTitle">${escapeHtml(v.name)}</div>
          <div class="modal-subtitle">${mode === 'cumulative' ? 'Wochenstand' : formatShortDate(dateKey)}</div>
        </div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="wheel-value" id="wheelValue">${formatDuration(pickerMinutes)}</div>
      <div class="wheel-picker">
        ${wheelMarkup('hoursWheel', Array.from({ length: 169 }, (_, i) => i), 'Stunden', false)}
        <div class="wheel-separator">:</div>
        ${wheelMarkup('minutesWheel', minuteValues, 'Minuten', true)}
      </div>
    `, () => {
      const hoursEl = document.getElementById('hoursWheel');
      const minsEl = document.getElementById('minutesWheel');
      if (!hoursEl || !minsEl) return;

      const total = clamp(wheelValue(hoursEl) * 60 + wheelValue(minsEl), 0, 168 * 60);
      if (total === pickerMinutes) return;

      if (mode === 'cumulative') {
        setEntry(dateKey, habit.id, { status: 'success', minutes: total, timeMode: mode });
      } else if (total <= 0) {
        deleteEntry(dateKey, habit.id);
      } else {
        setEntry(dateKey, habit.id, { status: 'success', minutes: total, timeMode: mode });
      }
      saveState();
      renderToday();
    });

    const hoursEl = document.getElementById('hoursWheel');
    const minsEl = document.getElementById('minutesWheel');
    initWheel(hoursEl, initialHours, false);
    initWheel(minsEl, initialMins, true);

    const updateReadout = () => {
      const valueEl = document.getElementById('wheelValue');
      if (!valueEl) return;
      const total = clamp(wheelValue(hoursEl) * 60 + wheelValue(minsEl), 0, 168 * 60);
      valueEl.textContent = formatDuration(total);
    };

    hoursEl.addEventListener('wheelchange', updateReadout);
    minsEl.addEventListener('wheelchange', event => {
      const wrapDelta = Number(event.detail?.wrapDelta || 0);
      const currentHour = wheelValue(hoursEl);
      if (wrapDelta < 0 && currentHour <= 0) {
        minsEl.setWheelValue?.(0, 'auto');
        updateReadout();
        return;
      }
      if (wrapDelta !== 0 && typeof hoursEl.setWheelValue === 'function') {
        const nextHour = clamp(currentHour + wrapDelta, 0, 168);
        hoursEl.setWheelValue(nextHour, 'smooth');
      }
      if (wheelValue(hoursEl) >= 168 && wheelValue(minsEl) > 0) {
        minsEl.setWheelValue?.(0, 'auto');
      }
      updateReadout();
    });
  }

  function wheelMarkup(id, values, label, circular = false) {
    return `
      <div class="wheel-column">
        <div class="wheel-label">${label}</div>
        <div class="wheel-scroll" id="${id}" data-circular="${circular ? 'true' : 'false'}" tabindex="0" role="listbox" aria-label="${label}">
          <div class="wheel-spacer" aria-hidden="true"></div>
          ${values.map(v => `<div class="wheel-item" role="option" data-value="${v}">${String(v).padStart(2, '0')}</div>`).join('')}
          <div class="wheel-spacer" aria-hidden="true"></div>
        </div>
      </div>`;
  }

  function initWheel(el, selectedValue, circular = false) {
    if (!el) return;
    const ITEM = 52;
    const items = [...el.querySelectorAll('.wheel-item')];
    if (!items.length) return;
    const CYCLE_ITEMS = circular ? 12 : 0;
    const CYCLE_HEIGHT = CYCLE_ITEMS * ITEM;
    let raf = 0;

    const nearestIndex = () => clamp(Math.round(el.scrollTop / ITEM), 0, items.length - 1);

    const selectIndex = (index, suppressWrap = false) => {
      const safe = clamp(index, 0, items.length - 1);
      const previousIndex = el.dataset.selectedIndex === undefined
        ? null
        : clamp(Number(el.dataset.selectedIndex || 0), 0, items.length - 1);
      const previousValue = previousIndex == null ? null : Number(items[previousIndex]?.dataset.value || 0);
      const value = Number(items[safe]?.dataset.value || 0);
      let wrapDelta = 0;

      if (circular && !suppressWrap && previousIndex != null) {
        const previousCycle = Math.floor(previousIndex / CYCLE_ITEMS);
        const currentCycle = Math.floor(safe / CYCLE_ITEMS);
        wrapDelta = currentCycle - previousCycle;
      }

      items.forEach((item, i) => {
        const selected = i === safe;
        item.classList.toggle('selected', selected);
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      el.dataset.selectedIndex = String(safe);
      el.dispatchEvent(new CustomEvent('wheelchange', {
        detail: { previousValue, value, wrapDelta }
      }));
    };

    let selectedIndex;
    if (circular) {
      const base = items.slice(0, CYCLE_ITEMS).findIndex(item => Number(item.dataset.value || 0) === Number(selectedValue || 0));
      selectedIndex = CYCLE_ITEMS + (base >= 0 ? base : 0);
    } else {
      selectedIndex = items.reduce((best, item, index) => {
        const distance = Math.abs(Number(item.dataset.value || 0) - Number(selectedValue || 0));
        return distance < best.distance ? { index, distance } : best;
      }, { index: 0, distance: Infinity }).index;
    }

    selectIndex(selectedIndex, true);
    requestAnimationFrame(() => {
      el.scrollTop = selectedIndex * ITEM;
    });

    el.setWheelValue = (value, behavior = 'smooth') => {
      let target;
      if (circular) {
        const base = items.slice(0, CYCLE_ITEMS).findIndex(item => Number(item.dataset.value || 0) === Number(value || 0));
        target = CYCLE_ITEMS + (base >= 0 ? base : 0);
      } else {
        target = items.reduce((best, item, index) => {
          const distance = Math.abs(Number(item.dataset.value || 0) - Number(value || 0));
          return distance < best.distance ? { index, distance } : best;
        }, { index: 0, distance: Infinity }).index;
      }
      selectIndex(target, true);
      el.scrollTo({ top: target * ITEM, behavior });
    };

    const recenterCircular = index => {
      if (!circular) return index;
      if (index < CYCLE_ITEMS / 2) {
        const target = index + CYCLE_ITEMS;
        el.scrollTop += CYCLE_HEIGHT;
        selectIndex(target, true);
        return target;
      }
      if (index >= items.length - CYCLE_ITEMS / 2) {
        const target = index - CYCLE_ITEMS;
        el.scrollTop -= CYCLE_HEIGHT;
        selectIndex(target, true);
        return target;
      }
      return index;
    };

    el.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let index = nearestIndex();
        const recentered = recenterCircular(index);
        if (recentered === index) selectIndex(index);
      });
    }, { passive: true });

    el.addEventListener('click', e => {
      const item = e.target.closest('.wheel-item');
      if (!item) return;
      const index = items.indexOf(item);
      if (index < 0) return;
      el.scrollTo({ top: index * ITEM, behavior: 'smooth' });
    });

    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startTop = el.scrollTop;
      el.classList.add('mouse-dragging');

      const onMove = ev => {
        el.scrollTop = startTop + (startY - ev.clientY);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        el.classList.remove('mouse-dragging');
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once: true });
    });

    el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      let index = nearestIndex() + direction;
      if (circular) {
        if (index <= 0) index += CYCLE_ITEMS;
        if (index >= items.length - 1) index -= CYCLE_ITEMS;
      } else {
        index = clamp(index, 0, items.length - 1);
      }
      el.scrollTo({ top: index * ITEM, behavior: 'smooth' });
    });
  }
  function wheelValue(el) {
    if (!el) return 0;
    const items = [...el.querySelectorAll('.wheel-item')];
    if (!items.length) return 0;
    const index = clamp(Number(el.dataset.selectedIndex || 0), 0, items.length - 1);
    return Number(items[index]?.dataset.value || 0);
  }

  // -------------------- Data --------------------

  function openDataTools() {
    openModal(`
      <div class="modal-head">
        <div class="modal-title" id="modalTitle">Daten</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="stack-buttons">
        <button class="secondary-button full" id="exportData">Backup exportieren</button>
        <button class="secondary-button full" id="importData">Backup importieren</button>
        <button class="danger-button full" id="resetData">Zurücksetzen</button>
      </div>
    `);
    document.getElementById('exportData').onclick = exportData;
    document.getElementById('importData').onclick = () => importInput.click();
    document.getElementById('resetData').onclick = () => openConfirmModal('Alles löschen?', () => {
      state = defaultState();
      saveState();
      closeModal();
      renderHabits();
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
        if (!parsed.habits || !parsed.entries || !parsed.settings) throw new Error('invalid');
        state = parsed;
        ensureStateShape();
        saveState();
        closeModal();
        render();
      } catch (err) {
        toast('Backup ungültig');
      }
      importInput.value = '';
    };
    reader.readAsText(file);
  }

  // -------------------- Evaluation --------------------


  function evaluateWeek(weekStart) {
    const items = applicableHabitsForWeek(weekStart)
      .map(habit => {
        const ev = evaluateHabitForWeek(habit, weekStart);
        if (!ev.applicable) return null;
        const ref = evaluationReferenceDate(habit, weekStart);
        const v = habitVersion(habit, ref) || latestHabitVersion(habit);
        const penalty = clamp(Number(v?.penalty || 0), 0, 100);
        const failureCount = Math.max(0, Number(ev.failureCount || 0));
        const factor = Math.pow((100 - penalty) / 100, failureCount);
        return {
          ...ev,
          habitId: habit.id,
          name: v?.name || 'Habit',
          penalty,
          failureCount,
          factor
        };
      })
      .filter(Boolean)
      .sort((a,b) => a.order - b.order);

    const rawFactor = items.reduce((product, item) => product * item.factor, 1);
    const score = clamp(round1(rawFactor * 100), 0, 100);
    const weeklyMax = weeklyRewardForWeek(weekStart);

    for (const item of items) {
      const otherFactor = items
        .filter(other => other !== item)
        .reduce((product, other) => product * other.factor, 1);
      item.pointsLost = round1(100 * otherFactor * (1 - item.factor));
      item.moneyLost = roundMoney(weeklyMax * item.pointsLost / 100);
      item.factorPercent = round1(item.factor * 100);
    }

    const successCount = items.filter(item => item.status === 'success').length;
    const failCount = items.filter(item => item.status === 'fail').length;
    const missedCount = items.filter(item => item.status === 'missed').length;
    const neutralCount = items.filter(item => item.status === 'neutral').length;
    const formulaFactors = items.flatMap(item =>
      Array.from({ length: item.failureCount }, () => 100 - item.penalty)
    );

    return {
      score,
      items,
      successCount,
      failCount,
      missedCount,
      neutralCount,
      formulaFactors
    };
  }

  function evaluateHabitForWeek(habit, weekStart) {
    const ref = evaluationReferenceDate(habit, weekStart);
    if (!habitActiveOnDate(habit, ref)) return { applicable: false, status: 'neutral', detail: '', order: 999, failureCount: 0 };
    const v = habitVersion(habit, ref);
    if (!v) return { applicable: false, status: 'neutral', detail: '', order: 999, failureCount: 0 };
    const today = currentLifeDateKey();

    if (v.type === 'daily_boolean') {
      const required = datesInWeek(weekStart).filter(d => {
        if (!habitActiveOnDate(habit, d)) return false;
        return habitVersion(habit, d)?.type === 'daily_boolean';
      });
      if (!required.length) return { applicable: false, status: 'neutral', detail: '', order: v.order, failureCount: 0 };

      let green = 0;
      let explicitFails = 0;
      let autoMisses = 0;
      let dueOrEntered = 0;
      let dueOrEnteredSuccess = 0;

      for (const d of required) {
        if (d > today) continue;
        const entry = getEntry(d, habit.id);
        const dayClosed = d < today;
        if (dayClosed || entry) {
          dueOrEntered++;
          if (entry?.status === 'success') dueOrEnteredSuccess++;
        }
        if (entry?.status === 'success') green++;
        else if (entry?.status === 'fail') explicitFails++;
        else if (!entry && dayClosed) autoMisses++;
      }

      const failureCount = explicitFails + autoMisses;
      const status = explicitFails > 0
        ? 'fail'
        : autoMisses > 0
          ? 'missed'
          : dueOrEntered > 0 && dueOrEnteredSuccess === dueOrEntered
            ? 'success'
            : 'neutral';
      const missedText = failureCount ? ` · ${failureCount} verpasst` : '';
      return {
        applicable: true,
        status,
        detail: `${green} grün${missedText} · ${failureCount}× −${numberClean(v.penalty)}%`,
        order: v.order,
        failureCount
      };
    }

    if (v.type === 'weekly_count') {
      const count = weeklySuccessCount(habit.id, weekStart, habit);
      const target = Math.max(1, Number(v.config.targetCount || 1));
      const closed = isClosedWeek(weekStart);
      const success = count >= target;
      const missed = closed && !success;
      return {
        applicable: true,
        status: success ? 'success' : missed ? 'missed' : 'neutral',
        detail: `${count} / ${target}${missed ? ` · einmal −${numberClean(v.penalty)}%` : ''}`,
        order: v.order,
        failureCount: missed ? 1 : 0
      };
    }

    if (v.type === 'time_weekly') {
      const minutes = sumMinutesInWeek(habit.id, weekStart, habit);
      const target = Math.max(0, Number(v.config.targetMinutes || 0));
      const toleranceTarget = target * timeToleranceFactor();
      const closed = isClosedWeek(weekStart);
      const success = target <= 0 || minutes >= toleranceTarget;
      const missed = closed && !success;
      return {
        applicable: true,
        status: success ? 'success' : missed ? 'missed' : 'neutral',
        detail: `${formatDuration(minutes)} / ${formatDuration(toleranceTarget)} (${numberClean(timeToleranceFactor() * 100)}%)${missed ? ` · einmal −${numberClean(v.penalty)}%` : ''}`,
        order: v.order,
        failureCount: missed ? 1 : 0
      };
    }

    if (v.type === 'anchored_cycle') {
      const cycles = cyclesScoredInWeek(habit, weekStart);
      if (!cycles.length) return { applicable: false, status: 'neutral', detail: '', order: v.order, failureCount: 0 };
      const results = cycles.map(cycle => {
        const successDate = cycleSuccessDate(habit, cycle);
        const closed = cycle.windowEnd < today;
        return { cycle, successDate, missed: closed && !successDate };
      });
      const failureCount = results.filter(r => r.missed).length;
      const allSuccess = results.every(r => r.successDate);
      const status = failureCount ? 'missed' : allSuccess ? 'success' : 'neutral';
      const detail = results.map(r =>
        `${formatShortDate(r.cycle.anchor)}${r.successDate ? ` · erledigt ${formatShortDate(r.successDate)}` : r.missed ? ' · verpasst' : ' · offen'}`
      ).join(' · ');
      return { applicable: true, status, detail, order: v.order, failureCount };
    }

    return { applicable: false, status: 'neutral', detail: '', order: v.order, failureCount: 0 };
  }
  function evaluationReferenceDate(habit, weekStart) {
    const end = minDateKey(addDaysKey(weekStart, 6), currentLifeDateKey());
    const dates = datesInWeek(weekStart).filter(d => d <= end && habitActiveOnDate(habit, d));
    return dates.length ? dates[dates.length - 1] : weekStart;
  }

  function applicableHabitsForWeek(weekStart) {
    const end = minDateKey(addDaysKey(weekStart, 6), currentLifeDateKey());
    return state.habits.filter(habit => {
      const anyActive = datesInWeek(weekStart).some(d => d <= end && habitActiveOnDate(habit, d));
      if (!anyActive) return false;
      const ref = evaluationReferenceDate(habit, weekStart);
      const v = habitVersion(habit, ref);
      if (!v) return false;
      if (v.type === 'anchored_cycle') return cyclesScoredInWeek(habit, weekStart).length > 0;
      return true;
    });
  }

  function weeklySuccessCount(habitId, weekStart, habit) {
    return datesInWeek(weekStart).filter(d => {
      if (!habitActiveOnDate(habit, d)) return false;
      if (habitVersion(habit, d)?.type !== 'weekly_count') return false;
      return getEntry(d, habitId)?.status === 'success';
    }).length;
  }

  function sumMinutesInWeek(habitId, weekStart, habit, throughDate = null) {
    let total = 0;
    const end = throughDate ? minDateKey(throughDate, addDaysKey(weekStart, 6)) : addDaysKey(weekStart, 6);
    for (const d of datesInWeek(weekStart)) {
      if (d > end || !habitActiveOnDate(habit, d)) continue;
      if (habitVersion(habit, d)?.type !== 'time_weekly') continue;
      const entry = getEntry(d, habitId);
      if (!entry || entry.minutes == null) continue;
      const mode = entry.timeMode || habitVersion(habit, d)?.config?.entryMode || 'daily';
      if (mode === 'cumulative') total = Number(entry.minutes || 0);
      else total += Number(entry.minutes || 0);
    }
    return Math.max(0, total);
  }

  // -------------------- Streaks --------------------

  function habitStreak(habit, dateKey) {
    const v = habitVersion(habit, dateKey);
    if (!v) return 0;
    if (v.type === 'daily_boolean') return dailyStreak(habit, dateKey);
    if (v.type === 'anchored_cycle') return cycleStreak(habit, dateKey);
    return weeklyStreak(habit, dateKey);
  }


  function dailyStreak(habit, dateKey) {
    let d = minDateKey(dateKey, currentLifeDateKey());
    const currentEntry = getEntry(d, habit.id);
    if (currentEntry?.status === 'fail') return 0;
    if (!currentEntry && d < currentLifeDateKey()) return 0;
    if (currentEntry?.status !== 'success') d = addDaysKey(d, -1);
    let count = 0;
    for (let i = 0; i < 3650; i++) {
      if (!habitActiveOnDate(habit, d) || habitVersion(habit, d)?.type !== 'daily_boolean') break;
      if (getEntry(d, habit.id)?.status !== 'success') break;
      count++;
      d = addDaysKey(d, -1);
    }
    return count;
  }

  function weeklyStreak(habit, dateKey) {
    let week = weekStartKey(minDateKey(dateKey, currentLifeDateKey()));
    const current = evaluateHabitForWeek(habit, week);
    if (current.status === 'fail' || current.status === 'missed') return 0;
    if (current.status !== 'success') week = addDaysKey(week, -7);
    let count = 0;
    for (let i = 0; i < 520; i++) {
      const ev = evaluateHabitForWeek(habit, week);
      if (!ev.applicable || ev.status !== 'success') break;
      count++;
      week = addDaysKey(week, -7);
    }
    return count;
  }
  function cycleStreak(habit, dateKey) {
    const v = habitVersion(habit, dateKey);
    if (!v || v.type !== 'anchored_cycle') return 0;
    const everyDays = Math.max(1, Number(v.config.everyWeeks || 1)) * 7;
    const active = cycleForDate(habit, dateKey);
    let anchor;
    if (active && cycleSuccessDate(habit, active)) anchor = active.anchor;
    else {
      const next = nextCycleForDate(habit, dateKey);
      anchor = next ? addDaysKey(next.anchor, -everyDays) : v.config.anchorDate;
    }

    let count = 0;
    for (let i = 0; i < 520; i++) {
      const cycle = cycleObjectFromAnchor(habit, anchor, habitVersion(habit, anchor));
      if (!cycle || !cycleSuccessDate(habit, cycle)) break;
      count++;
      anchor = addDaysKey(anchor, -everyDays);
    }
    return count;
  }

  // -------------------- Anchored cycles --------------------

  function cyclesScoredInWeek(habit, weekStart) {
    const weekEnd = addDaysKey(weekStart, 6);
    const ref = evaluationReferenceDate(habit, weekStart);
    const v = habitVersion(habit, ref) || latestHabitVersion(habit);
    if (!v || v.type !== 'anchored_cycle' || !v.config.anchorDate) return [];

    const everyDays = Math.max(1, Number(v.config.everyWeeks || 1)) * 7;
    const startProbe = addDaysKey(weekStart, -Math.max(0, Number(v.config.windowAfter || 0)) - everyDays);
    let i = Math.floor(daysBetweenKeys(v.config.anchorDate, startProbe) / everyDays) - 1;
    const results = [];

    for (let guard = 0; guard < 12; guard++, i++) {
      const anchor = addDaysKey(v.config.anchorDate, i * everyDays);
      if (anchor > addDaysKey(weekEnd, everyDays)) break;
      const cycle = cycleObjectFromAnchor(habit, anchor, habitVersion(habit, anchor) || v);
      if (!cycle) continue;
      if (cycle.windowEnd >= weekStart && cycle.windowEnd <= weekEnd && habitActiveOnDate(habit, cycle.anchor)) results.push(cycle);
    }
    return results;
  }

  function cycleForDate(habit, dateKey) {
    const versions = [...habit.versions].sort((a,b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    for (const v of versions) {
      if (v.type !== 'anchored_cycle' || !v.config.anchorDate) continue;
      const everyDays = Math.max(1, Number(v.config.everyWeeks || 1)) * 7;
      const approx = Math.round(daysBetweenKeys(v.config.anchorDate, dateKey) / everyDays);
      for (let i = approx - 2; i <= approx + 2; i++) {
        const anchor = addDaysKey(v.config.anchorDate, i * everyDays);
        const cycle = cycleObjectFromAnchor(habit, anchor, v);
        if (!cycle) continue;
        if (dateKey >= cycle.windowStart && dateKey <= cycle.windowEnd && habitActiveOnDate(habit, cycle.anchor)) return cycle;
      }
    }
    return null;
  }

  function nextCycleForDate(habit, dateKey) {
    const v = habitVersion(habit, dateKey) || latestHabitVersion(habit);
    if (!v || v.type !== 'anchored_cycle' || !v.config.anchorDate) return null;
    const everyDays = Math.max(1, Number(v.config.everyWeeks || 1)) * 7;
    let i = Math.floor(daysBetweenKeys(v.config.anchorDate, dateKey) / everyDays) - 1;
    for (let guard = 0; guard < 30; guard++, i++) {
      const cycle = cycleObjectFromAnchor(habit, addDaysKey(v.config.anchorDate, i * everyDays), v);
      if (cycle && cycle.windowEnd >= dateKey && habitActiveOnDate(habit, cycle.anchor)) return cycle;
    }
    return null;
  }

  function cycleObjectFromAnchor(habit, anchor, explicitVersion) {
    const v = explicitVersion || habitVersion(habit, anchor);
    if (!v || v.type !== 'anchored_cycle') return null;
    const before = Math.max(0, Number(v.config.windowBefore || 0));
    const after = Math.max(0, Number(v.config.windowAfter || 0));
    return {
      anchor,
      windowStart: addDaysKey(anchor, -before),
      windowEnd: addDaysKey(anchor, after),
      version: v
    };
  }

  function cycleSuccessDate(habit, cycle) {
    let d = cycle.windowStart;
    while (d <= cycle.windowEnd) {
      if (habitActiveOnDate(habit, d) && getEntry(d, habit.id)?.status === 'success') return d;
      d = addDaysKey(d, 1);
    }
    return null;
  }

  function cycleHasExplicitFail(habit, cycle) {
    let d = cycle.windowStart;
    while (d <= cycle.windowEnd) {
      if (getEntry(d, habit.id)?.status === 'fail') return true;
      d = addDaysKey(d, 1);
    }
    return false;
  }

  function cycleTimingText(cycle, dateKey) {
    const toAnchor = daysBetweenKeys(dateKey, cycle.anchor);
    const toEnd = daysBetweenKeys(dateKey, cycle.windowEnd);
    if (toAnchor > 1) return `noch ${toAnchor} Tage`;
    if (toAnchor === 1) return 'morgen';
    if (toAnchor === 0) return 'heute';
    if (toEnd > 1) return `noch ${toEnd} Tage`;
    if (toEnd === 1) return 'noch morgen';
    if (toEnd === 0) return 'letzter Tag';
    return '';
  }

  // -------------------- Rewards calculations --------------------

  function weeklyRewardFromMonthly(monthly) {
    return Math.floor(((Number(monthly || 0) * 12 / 52) / 5)) * 5;
  }

  function rewardVersionForWeek(weekStart) {
    const versions = [...state.settings.rewardVersions].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
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
      const ev = evaluateWeek(week);
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
    const versions = [...habit.versions].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
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
    if (type === 'daily_boolean') return {};
    if (type === 'weekly_count') return { targetCount: 1 };
    if (type === 'time_weekly') return { targetMinutes: 10 * 60, entryMode: 'cumulative' };
    return { everyWeeks: 1, anchorDate: nextWeekdayKey(currentLifeDateKey(), 6), windowBefore: 1, windowAfter: 2 };
  }

  function habitRuleText(v) {
    if (v.type === 'daily_boolean') return 'Täglich';
    if (v.type === 'weekly_count') return `${v.config.targetCount}× / Woche`;
    if (v.type === 'time_weekly') return `${formatDuration(v.config.targetMinutes)} / Woche · Wochenstand`;
    if (v.type === 'anchored_cycle') return `alle ${v.config.everyWeeks} Wo. · ${formatShortDate(v.config.anchorDate)} · −${v.config.windowBefore}/+${v.config.windowAfter}`;
    return '';
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

  // -------------------- Modals --------------------

  function openModal(html, onClose = null) {
    modalCloseHandler = onClose;
    modal.innerHTML = html;
    modalBackdrop.classList.remove('hidden');
    modal.querySelectorAll('[data-close]').forEach(btn => btn.onclick = closeModal);
  }

  function closeModal() {
    if (modalBackdrop.classList.contains('hidden')) return;
    const handler = modalCloseHandler;
    modalCloseHandler = null;
    if (handler) handler();
    modalBackdrop.classList.add('hidden');
    modal.innerHTML = '';
  }

  function openConfirmModal(title, onConfirm) {
    openModal(`
      <div class="modal-head">
        <div class="modal-title" id="modalTitle">${escapeHtml(title)}</div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="button-row">
        <button class="danger-button" id="confirmYes">Bestätigen</button>
        <button class="secondary-button" data-close>Abbrechen</button>
      </div>
    `);
    document.getElementById('confirmYes').onclick = onConfirm;
  }

  function toast(text) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  // -------------------- Date helpers --------------------

  function currentLifeDateKey() {
    const now = new Date();
    if (now.getHours() < 4) now.setDate(now.getDate() - 1);
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
    const d = parseKey(key);
    d.setDate(d.getDate() + days);
    return dateToKey(d);
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
    return Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i));
  }

  function isClosedWeek(weekStart) {
    return weekStart < weekStartKey(currentLifeDateKey());
  }

  function nextWeekdayKey(fromKey, targetMon0) {
    const current = weekdayMon0(fromKey);
    return addDaysKey(fromKey, (targetMon0 - current + 7) % 7);
  }

  function minDateKey(a, b) {
    return a <= b ? a : b;
  }

  // -------------------- Formatting / utilities --------------------

  function formatFullDate(key) {
    const d = parseKey(key);
    return `${WEEKDAY_LONG[weekdayMon0(key)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  }

  function formatShortDate(key) {
    const d = parseKey(key);
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`;
  }

  function formatWeekRange(weekStart) {
    const a = parseKey(weekStart);
    const b = parseKey(addDaysKey(weekStart, 6));
    if (a.getMonth() === b.getMonth()) return `${a.getDate()}.–${b.getDate()}. ${MONTHS[b.getMonth()]}`;
    return `${a.getDate()}. ${MONTHS[a.getMonth()].slice(0,3)} – ${b.getDate()}. ${MONTHS[b.getMonth()].slice(0,3)}`;
  }

  function formatDuration(minutes) {
    minutes = Math.max(0, Math.round(Number(minutes || 0)));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return `${h} h ${m} min`;
    if (h) return `${h} h`;
    return `${m} min`;
  }

  function formatDurationCompact(minutes) {
    minutes = Math.max(0, Math.round(Number(minutes || 0)));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  function formatMoney(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: n % 1 ? 2 : 0,
      maximumFractionDigits: 2
    }).format(n);
  }

  function typeOption(value, label, current) {
    return `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, Number(n || 0))); }
  function roundMoney(n) { return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100; }
  function round1(n) { return Math.round(Number(n || 0) * 10) / 10; }
  function numberClean(n) { return Number.isInteger(Number(n)) ? String(Number(n)) : String(Number(n).toFixed(1)); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  function debounce(fn, wait) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }
  }
})();
