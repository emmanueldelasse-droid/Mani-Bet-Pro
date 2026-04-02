/**
 * MANI BET PRO — ui.dashboard.js
 *
 * Responsabilité unique : afficher le dashboard.
 * Ne touche pas aux données, ne calcule rien.
 * Délègue tout chargement à DataOrchestrator.
 */

import { router }           from './ui.router.js';
import { DataOrchestrator } from '../orchestration/data.orchestrator.js';
import { EngineCore }       from '../engine/engine.core.js';
import { LoadingUI }        from './ui.loading.js';
import { Logger }           from '../utils/utils.logger.js';

// ── POINT D'ENTRÉE ────────────────────────────────────────────────────────

export async function render(container, storeInstance) {
  // Date sélectionnée — par défaut aujourd'hui
  let selectedDate = storeInstance.get('dashboardFilters')?.selectedDate ?? _getTodayDate();

  container.innerHTML = renderShell(selectedDate);
  bindFilterEvents(container, storeInstance);
  bindDateSelector(container, storeInstance, selectedDate, async (newDate) => {
    selectedDate = newDate;
    storeInstance.set({ 'dashboardFilters.selectedDate': newDate });
    await _loadAndDisplay(container, storeInstance, newDate);
  });
  await _loadAndDisplay(container, storeInstance, selectedDate);
  return { destroy() {} };
}

// ── CHARGEMENT ────────────────────────────────────────────────────────────

async function _loadAndDisplay(container, storeInstance, date = null) {
  const list = container.querySelector('#matches-list');
  date = date ?? _getTodayDate();

  try {
    LoadingUI.show();

    // Délègue tout à l'orchestrateur
    const result = await DataOrchestrator.loadAndAnalyze(date, storeInstance);

    if (!result?.matches?.length) {
      renderEmptyState(list);
      updateSummary(container, 0, 0, 0);
      return;
    }

    // Rendu des cartes
    renderMatchCards(list, result.matches, storeInstance);

    // Mise à jour des badges avec les analyses
    let conclusive = 0, rejected = 0;
    result.matches.forEach(match => {
      const analysis = result.analyses[match.id];
      if (!analysis) return;
      updateMatchCard(list, match.id, analysis);
      if (analysis.confidence_level === 'INCONCLUSIVE') rejected++;
      else conclusive++;
    });

    updateSummary(container, result.matches.length, conclusive, rejected);

  } catch (err) {
    Logger.error('DASHBOARD_RENDER_ERROR', { message: err.message });
    renderError(list);
  } finally {
    LoadingUI.hide();
  }
}

// ── SHELL ─────────────────────────────────────────────────────────────────

function renderShell(selectedDate) {
  const displayDate = new Date(selectedDate + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const today    = _getTodayDate();
  const tomorrow = _offsetDate(today, 1);
  const yesterday = _offsetDate(today, -1);

  return `
    <div class="dashboard">

      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Dashboard</div>
        <div class="page-header__sub">${displayDate}</div>
      </div>

      <!-- Sélecteur de date -->
      <div class="date-selector" id="date-selector" style="
        display:flex; gap:8px; margin-bottom:var(--space-4); flex-wrap:wrap;
      ">
        <button class="chip ${selectedDate === yesterday ? 'chip--active' : ''}"
          data-date="${yesterday}">Hier</button>
        <button class="chip ${selectedDate === today ? 'chip--active' : ''}"
          data-date="${today}">Aujourd'hui</button>
        <button class="chip ${selectedDate === tomorrow ? 'chip--active' : ''}"
          data-date="${tomorrow}">Demain</button>
        <input type="date" id="date-picker" value="${selectedDate}"
          style="
            background:var(--color-card);
            border:1px solid var(--color-border);
            color:var(--color-text);
            border-radius:20px;
            padding:4px 12px;
            font-size:12px;
            cursor:pointer;
          "
        />
      </div>

      <div class="dashboard__summary" id="day-summary">
        <div class="summary-card" id="summary-total">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Matchs chargés</div>
        </div>
        <div class="summary-card summary-card--success" id="summary-conclusive">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Concluants</div>
        </div>
        <div class="summary-card summary-card--muted" id="summary-rejected">
          <div class="summary-card__value">—</div>
          <div class="summary-card__label">Rejetés</div>
        </div>
      </div>

      <div class="dashboard__filters">
        <div class="filter-row">
          <span class="filter-label">Sport</span>
          <div class="filter-chips" id="filter-sports">
            <button class="chip chip--active" data-sport="ALL">Tous</button>
            <button class="chip" data-sport="NBA">NBA</button>
          </div>
        </div>
        <div class="filter-row">
          <span class="filter-label">Statut</span>
          <div class="filter-chips" id="filter-status">
            <button class="chip chip--active" data-status="ALL">Tous</button>
            <button class="chip" data-status="CONCLUSIVE">Concluants</button>
            <button class="chip" data-status="INCONCLUSIVE">Inconclus</button>
          </div>
        </div>
      </div>

      <div class="dashboard__matches" id="matches-list">
        <div class="loading-state">
          <div class="loader__spinner"></div>
          <span class="text-muted" style="font-size:13px">Chargement ESPN…</span>
        </div>
      </div>

    </div>
  `;
}

// ── CARTES MATCH ──────────────────────────────────────────────────────────

function renderMatchCards(list, matches, storeInstance) {
  list.innerHTML = '';
  if (!matches.length) { renderEmptyState(list); return; }

  const frag = document.createDocumentFragment();
  matches.forEach(match => frag.appendChild(_createMatchCard(match)));
  list.appendChild(frag);
}

function _createMatchCard(match) {
  const card           = document.createElement('div');
  card.className       = 'match-card';
  card.dataset.matchId = match.id;

  const time = match.datetime
    ? new Date(match.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—';

  const homeEfg    = match.home_season_stats?.efg_pct;
  const awayEfg    = match.away_season_stats?.efg_pct;
  const homeWin    = match.home_season_stats?.win_pct;
  const awayWin    = match.away_season_stats?.win_pct;
  const homeRecord = match.home_team?.record ?? '—';
  const awayRecord = match.away_team?.record ?? '—';
  const odds       = match.odds;
  const spread     = odds?.spread !== null && odds?.spread !== undefined
    ? (odds.spread > 0 ? `+${odds.spread}` : String(odds.spread))
    : '—';
  const ou = odds?.over_under ?? '—';

  card.innerHTML = `
    <div class="match-card__header">
      <span class="sport-tag sport-tag--nba">NBA</span>
      <span class="match-card__time text-muted">${time}</span>
      <span class="match-card__status-badge badge badge--inconclusive" id="status-${match.id}">
        Analyse…
      </span>
    </div>

    <div class="match-card__teams">
      <div class="match-card__team">
        <span class="match-card__team-abbr">${match.home_team?.abbreviation ?? '—'}</span>
        <span class="match-card__team-name truncate">${match.home_team?.name ?? '—'}</span>
        <span class="match-card__team-record text-muted mono">${homeRecord}</span>
      </div>
      <div class="match-card__vs">VS</div>
      <div class="match-card__team match-card__team--away">
        <span class="match-card__team-abbr">${match.away_team?.abbreviation ?? '—'}</span>
        <span class="match-card__team-name truncate">${match.away_team?.name ?? '—'}</span>
        <span class="match-card__team-record text-muted mono">${awayRecord}</span>
      </div>
    </div>

    <div class="match-card__stats-inline text-muted" style="font-size:11px; display:flex; gap:12px; margin-bottom:8px;">
      ${homeEfg !== null ? `<span>eFG% ${_toP(homeEfg)} / ${_toP(awayEfg)}</span>` : ''}
      ${homeWin !== null ? `<span>Win% ${_toP(homeWin)} / ${_toP(awayWin)}</span>` : ''}
      ${odds ? `<span class="mono">Spread ${spread} · O/U ${ou}</span>` : ''}
    </div>

    <div class="match-card__scores" id="scores-${match.id}">
      <div class="score-bar score-bar--signal">
        <div class="score-bar__header">
          <span class="score-bar__label">Signal</span>
          <span class="score-bar__value text-muted mono">—</span>
        </div>
        <div class="score-bar__track">
          <div class="score-bar__fill" style="width: 0%"></div>
        </div>
      </div>
      <div class="score-bar score-bar--robust">
        <div class="score-bar__header">
          <span class="score-bar__label">Robustesse</span>
          <span class="score-bar__value text-muted mono">—</span>
        </div>
        <div class="score-bar__track">
          <div class="score-bar__fill" style="width: 0%"></div>
        </div>
      </div>
    </div>

    <button class="btn btn--ghost match-card__cta" data-match-id="${match.id}">
      → Analyser
    </button>
  `;

  card.querySelector('.match-card__cta').addEventListener('click', (e) => {
    e.stopPropagation();
    router.navigate('match', { matchId: e.currentTarget.dataset.matchId });
  });

  return card;
}

function updateMatchCard(list, matchId, analysis) {
  const badge  = list.querySelector(`#status-${matchId}`);
  const scores = list.querySelector(`#scores-${matchId}`);
  if (!badge || !scores) return;

  const interp      = EngineCore.interpretConfidence(analysis.confidence_level);
  badge.textContent = interp.label;
  badge.className   = `match-card__status-badge badge ${interp.cssClass}`;

  const bars = scores.querySelectorAll('.score-bar');

  if (bars[0] && analysis.predictive_score !== null) {
    const pct = Math.round(analysis.predictive_score * 100);
    bars[0].querySelector('.score-bar__value').textContent = `${pct}%`;
    bars[0].querySelector('.score-bar__fill').style.width  = `${pct}%`;
    bars[0].querySelector('.score-bar__value').className   = 'score-bar__value mono text-signal';
  }

  if (bars[1] && analysis.robustness_score !== null) {
    const pct = Math.round(analysis.robustness_score * 100);
    const cls = pct >= 75 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-danger';
    bars[1].querySelector('.score-bar__value').textContent = `${pct}%`;
    bars[1].querySelector('.score-bar__fill').style.width  = `${pct}%`;
    bars[1].querySelector('.score-bar__value').className   = `score-bar__value mono ${cls}`;
    bars[1].querySelector('.score-bar__fill').style.background =
      pct >= 75 ? 'var(--color-robust-high)'
      : pct >= 50 ? 'var(--color-robust-mid)'
      : 'var(--color-robust-low)';
  }

  if (analysis.rejection_reason) {
    const el       = document.createElement('div');
    el.className   = 'match-card__rejection text-muted';
    el.textContent = `↳ ${_formatRejection(analysis.rejection_reason)}`;
    scores.after(el);
  }
}

// ── RÉSUMÉ ────────────────────────────────────────────────────────────────

function updateSummary(container, total, conclusive, rejected) {
  const t = container.querySelector('#summary-total .summary-card__value');
  const c = container.querySelector('#summary-conclusive .summary-card__value');
  const r = container.querySelector('#summary-rejected .summary-card__value');
  if (t) t.textContent = total;
  if (c) c.textContent = conclusive;
  if (r) r.textContent = rejected;
}

// ── FILTRES ───────────────────────────────────────────────────────────────

function bindDateSelector(container, storeInstance, initialDate, onDateChange) {
  const selector = container.querySelector('#date-selector');
  const picker   = container.querySelector('#date-picker');
  if (!selector) return;

  // Chips de date
  selector.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-date]');
    if (!chip) return;
    const newDate = chip.dataset.date;
    selector.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    if (picker) picker.value = newDate;
    onDateChange(newDate);
  });

  // Input date picker
  if (picker) {
    picker.addEventListener('change', (e) => {
      const newDate = e.target.value;
      selector.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
      onDateChange(newDate);
    });
  }
}

function bindFilterEvents(container, storeInstance) {
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const parent = chip.closest('.filter-chips');
    if (!parent) return;
    parent.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
    const sport  = chip.dataset.sport;
    const status = chip.dataset.status;
    if (sport)  _applyFilter(container, storeInstance, 'sport', sport);
    if (status) _applyFilter(container, storeInstance, 'status', status);
  });
}

function _applyFilter(container, storeInstance, filterType, value) {
  container.querySelectorAll('.match-card').forEach(card => {
    const matchId  = card.dataset.matchId;
    const match    = storeInstance.get('matches')?.[matchId];
    const analyses = storeInstance.get('analyses') ?? {};
    const analysis = Object.values(analyses).find(a => a.match_id === matchId);

    let visible = true;
    if (filterType === 'sport' && value !== 'ALL')  visible = match?.sport === value;
    if (filterType === 'status' && value !== 'ALL') {
      if (!analysis)                   visible = false;
      else if (value === 'CONCLUSIVE') visible = analysis.confidence_level !== 'INCONCLUSIVE';
      else if (value === 'INCONCLUSIVE') visible = analysis.confidence_level === 'INCONCLUSIVE';
    }
    card.style.display = visible ? '' : 'none';
  });
}

// ── ÉTATS VIDES ───────────────────────────────────────────────────────────

function renderEmptyState(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">◎</div>
      <div class="empty-state__text">
        Aucun match NBA aujourd'hui.<br>
        <span style="font-size:11px">Vérifie la connexion au Worker Cloudflare.</span>
      </div>
    </div>
  `;
}

function renderError(container) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">⚠</div>
      <div class="empty-state__text">
        Erreur lors du chargement.<br>
        <span style="font-size:11px">Consulte la console (F12) pour plus de détails.</span>
      </div>
    </div>
  `;
}

// ── HELPERS PRIVÉS ────────────────────────────────────────────────────────

function _getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function _offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function _toP(v) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(1) + '%';
}

function _formatRejection(reason) {
  const labels = {
    WEIGHTS_NOT_CALIBRATED:          'Pondérations non calibrées',
    MISSING_CRITICAL_DATA:           'Données critiques manquantes',
    DATA_QUALITY_BELOW_THRESHOLD:    'Qualité données insuffisante',
    ROBUSTNESS_BELOW_THRESHOLD:      'Robustesse insuffisante',
    SPORT_NOT_SUPPORTED_OR_DISABLED: 'Sport non activé',
    ENGINE_NOT_IMPLEMENTED:          'Moteur non implémenté',
    ABSENCES_NOT_CONFIRMED:          'Absences non confirmées',
  };
  return labels[reason] ?? reason;
}
