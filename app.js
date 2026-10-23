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
      habits: [],
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
    const rewardSeed = [...state.settings.rewardVersions].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
    state.settings.weeklyRewardMax = Math.max(0, Number(state.settings.weeklyRewardMax ?? weeklyRewardFromMonthly(rewardSeed?.monthlyMax ?? 400)));
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
          version.config.entryMode = 'cumulative';
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
  const summary = evaluateWeek(weekStart, selectedDate);
  const weeklyMax = weeklyRewardForWeek(weekStart);
  const money = roundMoney(weeklyMax * summary.score / 100);
  const habits = activeHabitsOnDate(selectedDate).sort((a,b) => (habitVersion(a, selectedDate)?.order ?? 999) - (habitVersion(b, selectedDate)?.order ?? 999));
  app.innerHTML = `
    <div class="date-switcher">
      <button class="date-arrow" id="prevDay" aria-label="Voriger Tag">‹</button>
      <button class="date-center" id="jumpToday">${formatFullDate(selectedDate)}</button>
      <button class="date-arrow" id="nextDay" aria-label="Nächster Tag" ${selectedDate >= today ? 'disabled' : ''}>›</button>
    </div>
    <section class="week-overview">
      <div class="week-overview-top">
        <div><div class="week-overview-label">Stand diese Woche</div><div class="week-overview-score">${numberClean(summary.score)}%</div></div>
        <div class="week-overview-money"><strong>${formatMoney(money)}</strong><span>von ${formatMoney(weeklyMax)}</span></div>
      </div>
      <div class="week-overview-bar"><span style="width:${clamp(summary.score,0,100)}%"></span></div>
    </section>
    ${habits.length ? `<div class="tile-grid">${habits.map(h => renderHabitTile(h, selectedDate)).join('')}</div>` : `<div class="empty-state">Keine Habits</div>`}
  `;
  document.getElementById('prevDay').onclick = () => { selectedDate = addDaysKey(selectedDate, -1); renderToday(); };
  document.getElementById('nextDay').onclick = () => { if (selectedDate < today) selectedDate = addDaysKey(selectedDate, 1); renderToday(); };
  document.getElementById('jumpToday').onclick = () => { selectedDate = today; renderToday(); };
  document.querySelectorAll('.tile').forEach(tile => { if (!tile.disabled) tile.addEventListener('click', () => handleTileClick(tile.dataset.habitId, selectedDate)); });
}

  function renderHabitTile(habit, dateKey) {
  const v = habitVersion(habit, dateKey);
  if (!v) return '';
  const display = tileDisplay(habit, v, dateKey);
  const scoreInfo = habitScoreInfo(habit, weekStartKey(dateKey), dateKey);
  const tint = Math.abs(Number(v.order || 0)) % TINT_COUNT;
  const disabledClass = display.disabled ? ' is-disabled' : '';
  const disabledAttr = display.disabled ? ' disabled aria-disabled="true"' : '';
  return `
    <button class="tile tint-${tint} status-${display.status}${disabledClass}" data-habit-id="${escapeAttr(habit.id)}"${disabledAttr}>
      <div class="tile-head"><div class="tile-name">${escapeHtml(v.name)}</div><div class="tile-kind">${escapeHtml(scoreInfo.period)}</div></div>
      <div class="tile-body">
        ${display.symbol ? `<div class="tile-symbol" aria-hidden="true">${display.symbol}</div>` : ''}
        ${display.timeRows ? `<div class="time-status">
          <div class="time-status-row"><span class="time-status-label">Tag</span><span class="time-status-value">${escapeHtml(display.timeRows.dayValue)}</span><span class="time-status-target">/ ${escapeHtml(display.timeRows.dayTarget)}</span></div>
          <div class="time-status-row"><span class="time-status-label">Woche</span><span class="time-status-value">${escapeHtml(display.timeRows.weekValue)}</span><span class="time-status-target">/ ${escapeHtml(display.timeRows.weekTarget)}</span></div>
        </div>` : ''}
        ${display.main ? `<div class="tile-main ${display.small ? 'small' : ''}">${escapeHtml(display.main)}</div>` : ''}
        ${display.sub ? `<div class="tile-sub">${escapeHtml(display.sub)}</div>` : ''}
        ${display.progress != null ? `<div class="tile-progress"><span style="width:${clamp(display.progress, 0, 100)}%"></span></div>` : ''}
      </div>
      <div class="tile-foot">
        <span class="tile-foot-progress">${escapeHtml(scoreInfo.progressText)}</span>
        <span class="tile-foot-deduction ${scoreInfo.deductionPct > 0 ? 'has-loss' : ''}">${scoreInfo.deductionPct > 0 ? `−${numberClean(scoreInfo.deductionPct)}% · −${formatMoney(scoreInfo.moneyLost)}` : 'kein Abzug'}</span>
      </div>
    </button>`;
}

  function tileDisplay(habit, v, dateKey) {
  const entry = getEntry(dateKey, habit.id);
  const week = weekStartKey(dateKey);
  if (v.type === 'daily_boolean') {
    const required = datesInWeek(week).filter(d => habitActiveOnDate(habit,d) && habitVersion(habit,d)?.type === 'daily_boolean');
    const done = required.filter(d => getEntry(d, habit.id)?.status === 'success').length;
    let status = entry?.status || 'neutral';
    if (!entry && dateKey < currentLifeDateKey()) status = 'missed';
    return { status, symbol: statusSymbol(status), main:'', sub:`Woche ${done} / ${required.length}`, progress:required.length ? done/required.length*100 : 100 };
  }
  if (v.type === 'weekly_count') {
    const count = weeklySuccessCount(habit.id, week, habit);
    const target = Math.max(1, Number(v.config.targetCount || 1));
    const clickedToday = entry?.status === 'success';
    return { status:clickedToday?'success':'neutral', symbol:clickedToday?'✓':'', main:`${count} / ${target}`, small:true, sub:'diese Woche', progress:count/target*100 };
  }
  if (v.type === 'time_weekly') {
    const weekMinutes = sumMinutesInWeek(habit.id, week, habit, dateKey);
    const dayMinutes = timeMinutesForDay(habit, dateKey);
    const target = Math.max(0, Number(v.config.targetMinutes || 0));
    const tolerance = timeToleranceFactor();
    const dayNumber = clamp(daysBetweenKeys(week, dateKey) + 1, 1, 7);
    const dailyNominalTarget = target/7;
    const weeklyNominalTargetToDate = target*dayNumber/7;
    const dailyGreenTarget = dailyNominalTarget*tolerance*tolerance;
    const hasEntry = hasTimeEntryOnDate(habit,dateKey);
    const dayClosed = dateKey < currentLifeDateKey();
    const green = target<=0 || dayMinutes>=dailyGreenTarget;
    const status = green?'success':dayClosed&&!hasEntry?'missed':hasEntry?'fail':'neutral';
    return { status, symbol:'', main:'', sub:'', timeRows:{dayValue:formatDurationCompact(dayMinutes),dayTarget:formatDurationCompact(dailyNominalTarget),weekValue:formatDurationCompact(weekMinutes),weekTarget:formatDurationCompact(weeklyNominalTargetToDate)}, progress:weeklyNominalTargetToDate>0?weekMinutes/weeklyNominalTargetToDate*100:100 };
  }
  if (v.type === 'anchored_cycle') {
    const cycle = cycleForDate(habit, dateKey) || nextCycleForDate(habit, dateKey);
    const clickedToday = getEntry(dateKey, habit.id)?.status === 'success';
    if (!cycle) {
      return { status: clickedToday ? 'success' : 'neutral', symbol: clickedToday ? '✓' : '', main: '', sub: 'Rhythmus aktiv', progress: null };
    }
    const missed = !cycle.successDate && cycle.windowEnd < currentLifeDateKey();
    const next = clickedToday ? nextCycleForDate(habit, addDaysKey(dateKey, 1)) : null;
    return {
      status: clickedToday ? 'success' : missed ? 'missed' : 'neutral',
      symbol: clickedToday ? '✓' : missed ? '!' : '',
      main: '',
      sub: clickedToday && next
        ? `erledigt · nächster Solltag ${formatShortDate(next.anchor)}`
        : `${cycleTimingText(cycle, dateKey)} · spätestens ${formatShortDate(cycle.windowEnd)}`,
      progress: null
    };
  }
  return {status:'neutral',symbol:'',main:'',sub:'',progress:null};
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

  function timeToleranceFactor(){ return clamp(Number(state.settings.timeDailyGreenPercent ?? 80),0,100)/100; }

  function habitWeekProgress(habit, weekStart, asOfDate = null) {
  const today=currentLifeDateKey(), weekEnd=addDaysKey(weekStart,6), closed=isClosedWeek(weekStart);
  const cutoff=closed?weekEnd:minDateKey(minDateKey(asOfDate||today,today),weekEnd);
  const activeThroughCutoff=datesInWeek(weekStart).filter(d=>d<=cutoff&&habitActiveOnDate(habit,d));
  const ref=activeThroughCutoff.length?activeThroughCutoff[activeThroughCutoff.length-1]:evaluationReferenceDate(habit,weekStart);
  const v=habitVersion(habit,ref)||latestHabitVersion(habit);
  if(!v)return {applicable:false,status:'neutral',detail:'',order:999,deductionPct:0,progressText:'',penalty:0};
  const penalty=clamp(Number(v.penalty||0),0,100), order=Number(v.order??999);

  if(v.type==='daily_boolean'){
    const required=datesInWeek(weekStart).filter(d=>habitActiveOnDate(habit,d)&&habitVersion(habit,d)?.type==='daily_boolean');
    if(!required.length)return {applicable:false,status:'neutral',detail:'',order,deductionPct:0,progressText:'',penalty};
    const due=required.filter(d=>d<=cutoff);
    const successes=required.filter(d=>getEntry(d,habit.id)?.status==='success').length;
    const misses=due.filter(d=>getEntry(d,habit.id)?.status!=='success');
    const explicitFail=misses.some(d=>getEntry(d,habit.id)?.status==='fail');
    const deductionPct=penalty*misses.length/required.length;
    return {applicable:true,status:misses.length?(explicitFail?'fail':'missed'):(due.length?'success':'neutral'),order,penalty,deductionPct:round1(deductionPct),progressText:`${successes}/${required.length}`,detail:`${successes}/${required.length} erledigt · ${misses.length} nicht erfüllt`};
  }

  if(v.type==='weekly_count'){
    const slots=datesInWeek(weekStart).filter(d=>habitActiveOnDate(habit,d)&&habitVersion(habit,d)?.type==='weekly_count');
    const target=Math.max(1,Number(v.config.targetCount||1));
    if(!slots.length)return {applicable:false,status:'neutral',detail:'',order,deductionPct:0,progressText:'',penalty};
    if(slots.length<target)return {applicable:true,status:'success',order,penalty,deductionPct:0,progressText:'frei',detail:'Diese Woche nicht erfüllbar · kein Abzug',exempt:true};
    const count=slots.filter(d=>d<=cutoff&&getEntry(d,habit.id)?.status==='success').length;
    const missing=Math.max(0,target-count), deductionPct=penalty*missing/target;
    return {applicable:true,status:count>=target?'success':closed?'missed':'neutral',order,penalty,deductionPct:round1(deductionPct),progressText:`${count}/${target}`,detail:`${count}/${target} erledigt`};
  }

  if(v.type==='time_weekly'){
    const active=datesInWeek(weekStart).filter(d=>habitActiveOnDate(habit,d)&&habitVersion(habit,d)?.type==='time_weekly');
    if(!active.length)return {applicable:false,status:'neutral',detail:'',order,deductionPct:0,progressText:'',penalty};
    const target=Math.max(0,Number(v.config.targetMinutes||0));
    if(target<=0)return {applicable:true,status:'success',order,penalty,deductionPct:0,progressText:'0:00/0:00',detail:'Kein Zeitziel'};
    const minutes=sumMinutesInWeek(habit.id,weekStart,habit,cutoff);
    const dayNumber=clamp(daysBetweenKeys(weekStart,cutoff)+1,1,7);
    const nominalTarget=closed?target:target*dayNumber/7;
    const threshold=nominalTarget*timeToleranceFactor();
    const completion=threshold<=0?1:clamp(minutes/threshold,0,1);
    const deductionPct=penalty*(1-completion);
    return {applicable:true,status:completion>=1?'success':closed?'missed':'neutral',order,penalty,deductionPct:round1(deductionPct),progressText:`${formatDurationCompact(minutes)}/${formatDurationCompact(nominalTarget)}`,detail:`${formatDuration(minutes)} / ${formatDuration(nominalTarget)} · Toleranz ${numberClean(timeToleranceFactor()*100)}%`};
  }

  if(v.type==='anchored_cycle'){
    const cycles=cyclesScoredInWeek(habit,weekStart);
    if(!cycles.length)return {applicable:false,status:'neutral',detail:'',order,deductionPct:0,progressText:'',penalty};
    const results=cycles.map(cycle=>{const successDate=cycleSuccessDate(habit,cycle),isClosed=cycle.windowEnd<today;return {cycle,successDate,missed:isClosed&&!successDate};});
    const missed=results.filter(r=>r.missed).length, completed=results.filter(r=>r.successDate).length;
    const deductionPct=results.length?penalty*missed/results.length:0;
    return {applicable:true,status:missed?'missed':completed===results.length?'success':'neutral',order,penalty,deductionPct:round1(deductionPct),progressText:`${completed}/${results.length}`,detail:results.map(r=>`Soll ${formatShortDate(r.cycle.anchor)} · ${r.successDate?`erledigt ${formatShortDate(r.successDate)}`:r.missed?'verpasst':'offen'}`).join(' · ')};
  }
  return {applicable:false,status:'neutral',detail:'',order,deductionPct:0,progressText:'',penalty};
}

  function habitScoreInfo(habit,weekStart,dateKey){
  const v=habitVersion(habit,dateKey)||latestHabitVersion(habit),ev=habitWeekProgress(habit,weekStart,dateKey);
  const period=v?.type==='daily_boolean'?'Tag':v?.type==='weekly_count'?'Woche':v?.type==='time_weekly'?'Zeit':'Rhythmus';
  const deductionPct=round1(Number(ev.deductionPct||0));
  return {period,progressText:ev.progressText||'—',deductionPct,moneyLost:roundMoney(weeklyRewardForWeek(weekStart)*deductionPct/100)};
}

  function datesBetweenKeys(start,end){const result=[];let d=start;while(d<=end){result.push(d);d=addDaysKey(d,1);}return result;}

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
  const ev=evaluateWeek(weekStart),weeklyMax=weeklyRewardForWeek(weekStart),money=roundMoney(weeklyMax*ev.score/100),losses=ev.items.filter(item=>item.deductionPct>0);
  const formula=losses.length?`100% ${losses.map(item=>`− ${numberClean(item.deductionPct)}%`).join(' ')} = ${numberClean(ev.score)}%`:'100%';
  const rows=ev.items.map(item=>`<div class="detail-row status-${item.status}"><div><div class="detail-title">${escapeHtml(item.name)}</div><div class="detail-meta">${escapeHtml(item.detail)}</div></div><div class="detail-result"><strong>${item.deductionPct>0?`−${numberClean(item.deductionPct)}%`:'0%'}</strong><span>${item.moneyLost>0?`−${formatMoney(item.moneyLost)}`:formatMoney(0)}</span></div></div>`).join('');
  openModal(`<div class="modal-head"><div class="modal-title" id="modalTitle">${formatWeekRange(weekStart)}</div><button class="modal-close" data-close>×</button></div><div class="metric-grid"><div class="metric-card"><div class="metric-label">Wochenwert</div><div class="metric-value">${numberClean(ev.score)}%</div></div><div class="metric-card"><div class="metric-label">Belohnung</div><div class="metric-value">${formatMoney(money)}</div><div class="metric-sub">von ${formatMoney(weeklyMax)}</div></div></div><div class="calculation-box"><div class="calculation-label">Einfach gerechnet</div><div class="calculation-formula">${escapeHtml(formula)}</div></div><div class="detail-list">${rows||'<div class="empty-state">Keine Habits</div>'}</div>`);
}

  // -------------------- Rewards --------------------

  function renderRewards() {
  pageTitle.textContent='Belohnung';
  const currentWeek=weekStartKey(currentLifeDateKey()),currentEval=evaluateWeek(currentWeek,currentLifeDateKey()),weeklyMax=weeklyRewardForWeek(currentWeek),currentValue=roundMoney(weeklyMax*currentEval.score/100),earned=totalEarnedClosedWeeks(),transferred=roundMoney(state.transfers.reduce((sum,t)=>sum+Number(t.amount||0),0)),available=roundMoney(Math.max(0,earned-transferred)),monthlyApprox=roundMoney(weeklyMax*52/12);
  const transferRows=[...state.transfers].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12).map(t=>`<div class="detail-row"><div><div class="detail-title">${formatShortDate(t.date)}</div><div class="detail-meta">${escapeHtml(t.note||'Überweisung')}</div></div><div class="detail-result"><strong>−${formatMoney(t.amount)}</strong></div></div>`).join('');
  app.innerHTML=`<section class="reward-hero"><div class="metric-label">Noch überweisbar</div><div class="reward-balance">${formatMoney(available)}</div><div class="reward-sub">${formatMoney(earned)} verdient · ${formatMoney(transferred)} überwiesen</div></section><div class="metric-grid section-gap"><div class="metric-card"><div class="metric-label">Diese Woche</div><div class="metric-value">${formatMoney(currentValue)}</div><div class="metric-sub">${numberClean(currentEval.score)}% von ${formatMoney(weeklyMax)}</div></div><div class="metric-card"><div class="metric-label">Wochenmaximum</div><div class="metric-value">${formatMoney(weeklyMax)}</div><div class="metric-sub">≈ ${formatMoney(monthlyApprox)} / Monat</div></div></div><div class="button-row section-gap"><button class="primary-button" id="addTransfer">Überweisung</button><button class="secondary-button" id="editReward">Wochenmaximum</button></div><div class="section-gap"><div class="section-title">Überweisungen</div><div class="detail-list standalone">${transferRows||'<div class="empty-state">Keine Überweisungen</div>'}</div></div>`;
  document.getElementById('addTransfer').onclick=()=>openTransferModal(available); document.getElementById('editReward').onclick=openRewardModal;
}

  function openRewardModal(){
  const current=weeklyRewardForWeek(weekStartKey(currentLifeDateKey()));
  openModal(`<div class="modal-head"><div><div class="modal-title" id="modalTitle">Wochenmaximum</div><div class="modal-subtitle">Dieser Betrag ist für jede Woche gleich.</div></div><button class="modal-close" data-close>×</button></div><form id="rewardForm"><div class="form-group"><label class="form-label">Euro pro Woche</label><input class="form-input" id="weeklyMax" type="number" min="0" step="5" value="${current}" required /></div><button class="primary-button full" type="submit">Speichern</button></form>`);
  document.getElementById('rewardForm').onsubmit=e=>{e.preventDefault();state.settings.weeklyRewardMax=Math.max(0,Number(document.getElementById('weeklyMax').value||0));saveState();closeModal();renderRewards();};
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


  function renderHabits(){
  pageTitle.textContent='Habits';const today=currentLifeDateKey();const habits=state.habits.filter(h=>habitActiveOnDate(h,today)).sort((a,b)=>(habitVersion(a,today)?.order??999)-(habitVersion(b,today)?.order??999));const tolerancePercent=clamp(Number(state.settings.timeDailyGreenPercent??80),0,100);
  app.innerHTML=`<div class="habit-toolbar"><button class="primary-button" id="addHabit">+ Habit</button><button class="secondary-button" id="dataTools">Daten</button></div><div class="scoring-note"><strong>Einfaches Wochenprinzip:</strong><br>Der Prozentwert eines Habits ist sein maximaler Wochenabzug. Täglich: auf die aktiven Tage verteilt. 3×/Woche: auf 3 Erledigungen verteilt. Zeit: proportional zum Wochenziel. Was diese Woche objektiv nicht erfüllbar ist, kostet 0%.</div><div class="global-setting"><div><span class="global-setting-label">Zeit-Toleranz</span><strong id="timeToleranceValue">${numberClean(tolerancePercent)}%</strong></div><input class="setting-range" id="timeTolerance" type="range" min="50" max="100" step="5" value="${tolerancePercent}" /><div class="setting-help">Ein Wochen-Zeitziel gilt ab diesem Anteil als vollständig erfüllt.</div></div><div class="reorder-hint">Reihenfolge am Griff ziehen</div><div class="habit-list" id="habitList">${habits.map(renderHabitRow).join('')||'<div class="empty-state">Keine Habits</div>'}</div>`;
  document.getElementById('addHabit').onclick=()=>openHabitModal(null);document.getElementById('dataTools').onclick=openDataTools;const toleranceInput=document.getElementById('timeTolerance');toleranceInput.oninput=()=>{state.settings.timeDailyGreenPercent=clamp(Number(toleranceInput.value||80),50,100);document.getElementById('timeToleranceValue').textContent=`${numberClean(state.settings.timeDailyGreenPercent)}%`;saveState();};document.querySelectorAll('.habit-edit-area').forEach(btn=>{btn.onclick=()=>openHabitModal(btn.dataset.habitId);});enableHabitDrag();
}

  function renderHabitRow(habit){const v=habitVersion(habit,currentLifeDateKey())||latestHabitVersion(habit);if(!v)return '';return `<div class="habit-row" data-habit-id="${escapeAttr(habit.id)}"><button class="drag-handle" type="button" aria-label="Reihenfolge ändern" data-drag-handle>≡</button><button class="habit-edit-area" type="button" data-habit-id="${escapeAttr(habit.id)}"><span class="habit-row-title">${escapeHtml(v.name)}</span><span class="habit-row-meta">${escapeHtml(habitRuleText(v))}</span><span class="habit-row-penalty">max. −${numberClean(v.penalty)}% / Woche</span></button></div>`;}

  function enableHabitDrag(){const list=document.getElementById('habitList');if(!list)return;document.querySelectorAll('[data-drag-handle]').forEach(handle=>{handle.addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0)return;e.preventDefault();const row=handle.closest('.habit-row');if(!row)return;row.classList.add('dragging');document.body.classList.add('is-reordering');const onMove=ev=>{ev.preventDefault();const others=[...list.querySelectorAll('.habit-row:not(.dragging)')];const before=others.find(target=>{const rect=target.getBoundingClientRect();return ev.clientY<rect.top+rect.height/2;});if(before)list.insertBefore(row,before);else list.appendChild(row);};const onEnd=()=>{document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onEnd);document.removeEventListener('pointercancel',onEnd);row.classList.remove('dragging');document.body.classList.remove('is-reordering');applyHabitOrder([...list.querySelectorAll('.habit-row')].map(x=>x.dataset.habitId));};document.addEventListener('pointermove',onMove,{passive:false});document.addEventListener('pointerup',onEnd,{once:true});document.addEventListener('pointercancel',onEnd,{once:true});});});}

  function applyHabitOrder(ids){const today=currentLifeDateKey();ids.forEach((id,order)=>{const habit=state.habits.find(h=>h.id===id),v=habitVersion(habit,today)||latestHabitVersion(habit);if(v)v.order=order;});saveState();renderHabits();}

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
            <div class="form-group"><label class="form-label">Max. Wochenabzug %</label><input class="form-input" id="habitPenalty" type="number" min="0" max="100" step="1" value="${existing?.penalty ?? 10}" required /></div>
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
        <div class="form-group"><label class="form-label">Rhythmus · alle X Wochen</label><input class="form-input" id="everyWeeks" type="number" min="1" max="52" value="${config.everyWeeks || 1}" required /></div>
        <div class="form-group"><label class="form-label">Start- & Wunschtermin</label><input class="form-input" id="anchorDate" type="date" value="${config.anchorDate || nextWeekdayKey(currentLifeDateKey(), 6)}" required /></div>
      </div>
      <div class="form-group"><label class="form-label">Nachfrist in Tagen</label><input class="form-input" id="windowAfter" type="number" min="0" max="30" value="${config.windowAfter ?? 2}" required /></div>
      <div class="modal-mini">Jede Erledigung startet den Rhythmus neu. Der nächste Solltermin bewegt sich pro Runde höchstens 2 Tage zurück zum Wochentag des Wunschtermins.</div>`;
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
      windowBefore: 0,
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


  function evaluateWeek(weekStart, asOfDate = null) {
  const weeklyMax=weeklyRewardForWeek(weekStart);
  const items=applicableHabitsForWeek(weekStart).map(habit=>{
    const ev=habitWeekProgress(habit,weekStart,asOfDate); if(!ev.applicable)return null;
    const v=habitVersion(habit,evaluationReferenceDate(habit,weekStart))||latestHabitVersion(habit);
    return {...ev,habitId:habit.id,name:v?.name||'Habit',pointsLost:ev.deductionPct,moneyLost:roundMoney(weeklyMax*ev.deductionPct/100)};
  }).filter(Boolean).sort((a,b)=>a.order-b.order);
  const totalDeduction=items.reduce((sum,item)=>sum+Number(item.deductionPct||0),0);
  const score=clamp(round1(100-totalDeduction),0,100);
  return {score,items,totalDeduction:round1(totalDeduction),successCount:items.filter(i=>i.status==='success').length,failCount:items.filter(i=>i.status==='fail').length,missedCount:items.filter(i=>i.status==='missed').length,neutralCount:items.filter(i=>i.status==='neutral').length};
}

  function evaluateHabitForWeek(habit,weekStart,asOfDate=null){return habitWeekProgress(habit,weekStart,asOfDate);}

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
    const cycles = rhythmCycles(habit, minDateKey(dateKey, currentLifeDateKey()))
      .filter(cycle => cycle.windowEnd <= currentLifeDateKey());
    let count = 0;
    for (let i = cycles.length - 1; i >= 0; i--) {
      if (!cycles[i].successDate) break;
      count++;
    }
    return count;
  }

  // -------------------- Anchored cycles --------------------

  

  function rhythmSuccessDates(habit) {
  return Object.keys(state.entries || {})
    .sort()
    .filter(dateKey =>
      getEntry(dateKey, habit.id)?.status === 'success' &&
      habitActiveOnDate(habit, dateKey) &&
      habitVersion(habit, dateKey)?.type === 'anchored_cycle'
    );
}

function rhythmPreferredWeekday(v) {
  const anchor = v?.config?.anchorDate || v?.effectiveFrom || currentLifeDateKey();
  return weekdayMon0(anchor);
}

function rhythmCorrectDue(nominalDue, v) {
  const wanted = rhythmPreferredWeekday(v);
  const current = weekdayMon0(nominalDue);
  let delta = (wanted - current + 7) % 7;
  if (delta > 3) delta -= 7;
  delta = clamp(delta, -2, 2);
  return addDaysKey(nominalDue, delta);
}

function rhythmNextDue(baseDate, v) {
  const everyDays = Math.max(1, Number(v?.config?.everyWeeks || 1)) * 7;
  return rhythmCorrectDue(addDaysKey(baseDate, everyDays), v);
}

function rhythmCycles(habit, throughDate) {
  const anchoredVersions = [...(habit.versions || [])]
    .filter(v => v.type === 'anchored_cycle' && v.config?.anchorDate)
    .sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (!anchoredVersions.length) return [];

  const first = anchoredVersions[0];
  let openStart = habit.createdAt > first.effectiveFrom ? habit.createdAt : first.effectiveFrom;
  let due = first.config.anchorDate < openStart ? rhythmNextDue(openStart, first) : first.config.anchorDate;
  const successes = rhythmSuccessDates(habit);
  let successIndex = 0;
  const cycles = [];

  for (let guard = 0; guard < 2600; guard++) {
    const v = habitVersion(habit, due) || first;
    if (!v || v.type !== 'anchored_cycle') break;

    const grace = Math.max(0, Number(v.config?.windowAfter ?? 0));
    const deadline = addDaysKey(due, grace);

    while (successIndex < successes.length && successes[successIndex] < openStart) successIndex++;
    const candidate = successes[successIndex];
    const successDate = candidate && candidate <= deadline ? candidate : null;

    const cycle = {
      anchor: due,
      due,
      windowStart: openStart,
      windowEnd: deadline,
      deadline,
      successDate,
      version: v
    };
    cycles.push(cycle);

    if (successDate) {
      successIndex++;
      openStart = addDaysKey(successDate, 1);
      const nextVersion = habitVersion(habit, successDate) || v;
      due = rhythmNextDue(successDate, nextVersion);
    } else if (deadline < throughDate) {
      openStart = addDaysKey(deadline, 1);
      const nextVersion = habitVersion(habit, deadline) || v;
      due = rhythmNextDue(due, nextVersion);
    } else {
      break;
    }

    if (openStart > addDaysKey(throughDate, 400)) break;
  }
  return cycles;
}

function cyclesScoredInWeek(habit, weekStart) {
  const weekEnd = addDaysKey(weekStart, 6);
  return rhythmCycles(habit, weekEnd)
    .filter(cycle => cycle.windowEnd >= weekStart && cycle.windowEnd <= weekEnd);
}

function cycleForDate(habit, dateKey) {
  const cycles = rhythmCycles(habit, dateKey);
  return cycles.find(cycle => {
    const end = cycle.successDate || cycle.windowEnd;
    return dateKey >= cycle.windowStart && dateKey <= end;
  }) || null;
}

function nextCycleForDate(habit, dateKey) {
  const lookAhead = addDaysKey(dateKey, 400);
  const cycles = rhythmCycles(habit, lookAhead);
  return cycles.find(cycle =>
    cycle.windowEnd >= dateKey &&
    (!cycle.successDate || cycle.successDate >= dateKey || cycle.windowStart >= dateKey)
  ) || null;
}

function cycleObjectFromAnchor(habit, anchor, explicitVersion) {
  const v = explicitVersion || habitVersion(habit, anchor);
  if (!v || v.type !== 'anchored_cycle') return null;
  const grace = Math.max(0, Number(v.config?.windowAfter ?? 0));
  return { anchor, due: anchor, windowStart: anchor, windowEnd: addDaysKey(anchor, grace), deadline: addDaysKey(anchor, grace), version: v, successDate: null };
}

function cycleSuccessDate(_habit, cycle) {
  return cycle?.successDate || null;
}

function cycleHasExplicitFail() {
  return false;
}

function cycleTimingText(cycle, dateKey) {
  if (!cycle) return '';
  const toDue = daysBetweenKeys(dateKey, cycle.anchor);
  const toEnd = daysBetweenKeys(dateKey, cycle.windowEnd);
  if (toDue > 1) return `Soll in ${toDue} Tagen`;
  if (toDue === 1) return 'Soll morgen';
  if (toDue === 0) return 'heute fällig';
  if (toEnd > 1) return `Nachfrist · noch ${toEnd} Tage`;
  if (toEnd === 1) return 'Nachfrist · noch 1 Tag';
  if (toEnd === 0) return 'letzter Tag der Nachfrist';
  return 'verpasst';
}


  // -------------------- Rewards calculations --------------------

  // -------------------- Rewards calculations --------------------

  function weeklyRewardFromMonthly(monthly){return Math.floor(((Number(monthly||0)*12/52)/5))*5;}

  function rewardVersionForWeek(){return {monthlyMax:Number(state.settings.weeklyRewardMax||0)*52/12};}

  function weeklyRewardForWeek(){return Math.max(0,Number(state.settings.weeklyRewardMax||0));}

  function upsertRewardVersion(_effectiveFrom,monthlyMax){state.settings.weeklyRewardMax=weeklyRewardFromMonthly(monthlyMax);}

  function totalEarnedClosedWeeks(){const currentWeek=weekStartKey(currentLifeDateKey()),starts=state.habits.map(h=>h.createdAt).filter(Boolean).sort();if(!starts.length)return 0;let week=weekStartKey(starts[0]),total=0,guard=0;while(week<currentWeek&&guard++<5200){const ev=evaluateWeek(week);if(ev.items.length)total+=weeklyRewardForWeek(week)*ev.score/100;week=addDaysKey(week,7);}return roundMoney(total);}

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
    return { everyWeeks: 1, anchorDate: nextWeekdayKey(currentLifeDateKey(), 6), windowBefore: 0, windowAfter: 2 };
  }

  function habitRuleText(v) {
    if (v.type === 'daily_boolean') return 'Täglich';
    if (v.type === 'weekly_count') return `${v.config.targetCount}× / Woche`;
    if (v.type === 'time_weekly') return `${formatDuration(v.config.targetMinutes)} / Woche · Wochenstand`;
    if (v.type === 'anchored_cycle') return `alle ${v.config.everyWeeks} Wo. · Ziel ${WEEKDAYS[weekdayMon0(v.config.anchorDate)]} · +${v.config.windowAfter ?? 0} Tage`;
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
