/**
 * MANI BET PRO — ui.match-detail.tennis.js v1.0
 *
 * Bloc détail match tennis (équivalent ui.match-detail.teamdetail.js pour NBA).
 * Lit `tennisStats[matchId]` depuis le store (pré-chargé par data.orchestrator).
 *
 * 6 sections :
 *   1. 🎾 Elo & classement       — Elo overall/surface, rank ATP/WTA, proba dérivée
 *   2. 🎯 Surface                 — win rate 12 mois sur surface courante
 *   3. 🔥 Forme récente           — EMA 10 derniers matchs
 *   4. ⚔️ H2H                     — bilan face-à-face sur la surface
 *   5. 💥 Service                 — aces/match, double fautes, 1st serve won %
 *   6. ⏱️ Contexte                — fatigue, fraîcheur data, tournoi
 */

import { Logger } from '../utils/utils.logger.js';
import { escapeHtml as _escapeHtml, WORKER_URL } from './ui.match-detail.helpers.js';

export async function loadAndRenderTennisDetail(container, match, storeInstance) {
  const detailEl = container.querySelector('#tennis-detail-container');
  if (!detailEl) return;

  try {
    const tennisStats = storeInstance?.get('tennisStats') ?? {};
    let data = tennisStats[match.id] ?? null;

    // Fallback : fetch direct si pas dans le store (deep-link ou orchestrator pas encore tourné)
    if (!data) {
      data = await _fetchTennisStatsForMatch(match);
      if (data && storeInstance) {
        const updated = { ...(storeInstance.get('tennisStats') ?? {}), [match.id]: data };
        try { storeInstance.set({ tennisStats: updated }); } catch (_) {}
      }
    }

    const hasP1Data = data?.p1 && Object.keys(data.p1).some(k => k !== 'name' && data.p1[k] != null);
    const hasP2Data = data?.p2 && Object.keys(data.p2).some(k => k !== 'name' && data.p2[k] != null);

    if (!data || (!hasP1Data && !hasP2Data)) {
      const p1n = match?.home_team?.name ?? '?';
      const p2n = match?.away_team?.name ?? '?';
      const r = data?.resolved ?? null;
      const diag1 = r ? (r[p1n] ? `✅ trouvé comme "${r[p1n]}"` : '❌ non trouvé dans CSV Sackmann') : '';
      const diag2 = r ? (r[p2n] ? `✅ trouvé comme "${r[p2n]}"` : '❌ non trouvé dans CSV Sackmann') : '';
      const diagHtml = r
        ? `<div style="font-size:11px;color:var(--color-text);margin-top:10px;text-align:left;padding:8px 10px;background:var(--color-bg);border-radius:6px;line-height:1.6">
             <div><strong>${_escapeHtml(p1n)}</strong> : ${diag1}</div>
             <div><strong>${_escapeHtml(p2n)}</strong> : ${diag2}</div>
           </div>`
        : '';
      detailEl.innerHTML = `
        <div class="card match-detail__bloc" style="padding:22px 16px">
          <div style="font-size:13px;color:var(--color-text-secondary);line-height:1.7;text-align:center">
            Stats indisponibles pour ${_escapeHtml(p1n)} vs ${_escapeHtml(p2n)}.
            <br><span style="font-size:11px;color:var(--color-muted)">Source : Jeff Sackmann CSV (lag ~2-3 j). Challengers / juniors absents du tour principal.</span>
          </div>
          ${diagHtml}
        </div>`;
      return;
    }

    detailEl.innerHTML = renderBlocTennisDetail(match, data);
    _attachOpponentModalHandlers(detailEl);
  } catch (err) {
    Logger.warn('TENNIS_DETAIL_RENDER_FAILED', { message: err.message });
    detailEl.innerHTML = `
      <div class="card match-detail__bloc">
        <div style="font-size:12px;color:var(--color-text-secondary);padding:8px 0">
          Stats tennis temporairement indisponibles (${_escapeHtml(err.message ?? 'erreur')}).
        </div>
      </div>`;
  }
}

// Fetch direct /tennis/stats — fallback quand l'orchestrator n'a pas pré-chargé.
// Sur un deep-link vers la fiche match, on n'a pas tourné _loadAndAnalyzeTennis.
// Si première réponse vide (cache obsolète possible), retente avec bust=1.
async function _fetchTennisStatsForMatch(match) {
  const p1 = match?.home_team?.name;
  const p2 = match?.away_team?.name;
  const surface = match?.surface ?? 'Hard';
  const tour    = String(match?.tour ?? 'atp').toLowerCase();
  if (!p1 || !p2) return null;

  const fetchOnce = async (bust = false) => {
    const base = `${WORKER_URL}/tennis/stats?players=${encodeURIComponent(p1)},${encodeURIComponent(p2)}&surface=${encodeURIComponent(surface)}&tour=${tour}`;
    const url  = bust ? `${base}&bust=1` : base;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json?.available || !json.stats) return null;
    const s1 = json.stats[p1], s2 = json.stats[p2];
    const has = (s) => s && Object.keys(s).length > 1;
    return { json, hasAnyStats: has(s1) || has(s2) };
  };

  try {
    let result = await fetchOnce(false);
    if (result && !result.hasAnyStats) {
      result = (await fetchOnce(true)) ?? result;
    }
    if (!result?.json) return null;
    const { json } = result;
    return {
      p1:                { name: p1, ...(json.stats[p1] ?? {}) },
      p2:                { name: p2, ...(json.stats[p2] ?? {}) },
      surface,
      tour,
      tournament_label:  match?.tournament ?? null,
      fetched_at:        json.fetched_at ?? null,
      resolved:          json.resolved ?? null,
    };
  } catch (err) {
    Logger.warn('TENNIS_STATS_FETCH_FAILED', { message: err.message });
    return null;
  }
}

export function renderBlocTennisDetailSkeleton() {
  return `
    <div class="card match-detail__bloc" id="tennis-detail-skeleton" style="padding:20px;text-align:center">
      <div style="font-size:12px;color:var(--color-text-secondary)">Chargement des stats tennis…</div>
    </div>`;
}

export function renderBlocTennisDetail(match, data) {
  return [
    _renderEloRanking(match, data),
    _renderSurface(match, data),
    _renderRecentForm(match, data),
    _renderH2H(match, data),
    _renderService(match, data),
    _renderContext(match, data),
  ].join('');
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function _pct(x) { return x == null ? '—' : `${Math.round(x * 100)}%`; }
function _num(x, d = 1) { return x == null || !Number.isFinite(x) ? '—' : Number(x).toFixed(d); }
function _int(x) { return x == null || !Number.isFinite(x) ? '—' : String(Math.round(x)); }

// Traduction libellé surface pour affichage user. NE PAS utiliser pour les clés
// API (`/tennis/stats?surface=Clay`) qui doivent rester en anglais.
function _surfaceFr(s) {
  return { Clay: 'Terre battue', Hard: 'Dur', Grass: 'Gazon', Carpet: 'Moquette' }[s] ?? s;
}

// Convertit diff Elo en proba attendue P1 (formule Elo standard)
function _eloExpected(e1, e2) {
  if (e1 == null || e2 == null) return null;
  return 1 / (1 + Math.pow(10, (e2 - e1) / 400));
}

function _qualityBadge(quality) {
  if (!quality) return '';
  const map = {
    VERIFIED:     { color: '#22c55e', label: 'fiable' },
    PARTIAL:      { color: '#eab308', label: 'partiel' },
    LOW_SAMPLE:   { color: '#f97316', label: 'éch. faible' },
    MISSING:      { color: '#ef4444', label: 'manquant' },
  };
  const q = map[quality] ?? { color: 'var(--color-muted)', label: quality.toLowerCase() };
  return `<span style="font-size:9px;font-weight:700;color:${q.color};border:1px solid ${q.color};border-radius:3px;padding:1px 5px;letter-spacing:0.04em">${q.label}</span>`;
}

function _statRow(label, v1, v2, opts = {}) {
  const { better = null, fmt = (v) => v ?? '—', raw1 = v1, raw2 = v2 } = opts;
  const n1 = parseFloat(raw1);
  const n2 = parseFloat(raw2);
  const valid = Number.isFinite(n1) && Number.isFinite(n2);
  const avg   = valid ? (Math.abs(n1) + Math.abs(n2)) / 2 : 0;
  const ecart = avg > 0 ? Math.abs(n1 - n2) / avg : 0;
  const tooClose = ecart < 0.03;
  const p1Better = valid && !tooClose && (better === 'high' ? n1 > n2 : better === 'low' ? n1 < n2 : false);
  const p2Better = valid && !tooClose && (better === 'high' ? n2 > n1 : better === 'low' ? n2 < n1 : false);
  const c1 = p1Better ? 'var(--color-signal)' : 'var(--color-text)';
  const c2 = p2Better ? 'var(--color-signal)' : 'var(--color-text)';

  return `
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--color-border)">
      <div style="font-size:12px;font-weight:${p1Better ? '700' : '400'};color:${c1}">${fmt(v1)}</div>
      <div style="font-size:10px;color:var(--color-text-secondary);text-align:center;white-space:nowrap">${label}</div>
      <div style="font-size:12px;font-weight:${p2Better ? '700' : '400'};color:${c2};text-align:right">${fmt(v2)}</div>
    </div>`;
}

// ── SECTION 1 : ELO & RANKING ─────────────────────────────────────────────

function _renderEloRanking(match, data) {
  const p1Name = match?.home_team?.name ?? data.p1?.name ?? 'Joueur 1';
  const p2Name = match?.away_team?.name ?? data.p2?.name ?? 'Joueur 2';
  const surface = data.surface ?? 'Hard';

  const eSurf1 = data.p1?.elo_surface;
  const eSurf2 = data.p2?.elo_surface;
  const nSurf1 = data.p1?.elo_surface_matches ?? 0;
  const nSurf2 = data.p2?.elo_surface_matches ?? 0;

  const eAll1 = data.p1?.elo_overall;
  const eAll2 = data.p2?.elo_overall;

  const rank1 = data.p1?.current_rank;
  const rank2 = data.p2?.current_rank;

  // Proba surface (si assez de matchs), sinon overall
  const useSurf = eSurf1 != null && eSurf2 != null && nSurf1 >= 10 && nSurf2 >= 10;
  const expectedP1 = useSurf ? _eloExpected(eSurf1, eSurf2) : _eloExpected(eAll1, eAll2);
  const quality   = useSurf ? 'VERIFIED' : (eAll1 != null && eAll2 != null ? 'PARTIAL' : 'MISSING');
  const eloLabel  = useSurf ? `Elo ${_surfaceFr(surface)}` : 'Elo global';

  const diffDisplay = expectedP1 != null
    ? `<div style="font-size:20px;font-weight:800;color:var(--color-signal)">${Math.round(expectedP1 * 100)}% — ${Math.round((1 - expectedP1) * 100)}%</div>
       <div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">proba victoire dérivée ${eloLabel}</div>`
    : `<div style="font-size:12px;color:var(--color-muted)">proba non dérivable (data insuffisante)</div>`;

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🎾 Elo &amp; classement</span>
        ${_qualityBadge(quality)}
      </div>
      <div style="text-align:center;padding:8px 0;border-bottom:1px solid var(--color-border);margin-bottom:10px">
        ${diffDisplay}
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:4px;align-items:center;margin-bottom:6px">
        <div style="font-size:12px;font-weight:700;color:var(--color-text)">${_escapeHtml(p1Name)}</div>
        <div style="font-size:9px;color:var(--color-text-secondary);text-align:center">—</div>
        <div style="font-size:12px;font-weight:700;color:var(--color-text);text-align:right">${_escapeHtml(p2Name)}</div>
      </div>
      ${_statRow('Rang ATP/WTA',
        rank1 != null ? `#${rank1}` : '—',
        rank2 != null ? `#${rank2}` : '—',
        { better: 'low', raw1: rank1, raw2: rank2 })}
      ${_statRow(`Elo ${_surfaceFr(surface)}`,
        eSurf1 != null ? _int(eSurf1) : '—',
        eSurf2 != null ? _int(eSurf2) : '—',
        { better: 'high', raw1: eSurf1, raw2: eSurf2 })}
      ${_statRow(`matchs ${_surfaceFr(surface)}`,
        _int(nSurf1), _int(nSurf2),
        { better: 'high', raw1: nSurf1, raw2: nSurf2 })}
      ${_statRow('Elo global',
        eAll1 != null ? _int(eAll1) : '—',
        eAll2 != null ? _int(eAll2) : '—',
        { better: 'high', raw1: eAll1, raw2: eAll2 })}
    </div>`;
}

// ── SECTION 2 : SURFACE ───────────────────────────────────────────────────

function _renderSurface(match, data) {
  const surface = data.surface ?? 'Hard';
  const s1 = data.p1?.surface_stats?.[surface];
  const s2 = data.p2?.surface_stats?.[surface];
  const wr1 = s1?.win_rate;
  const wr2 = s2?.win_rate;
  const n1  = s1?.matches ?? 0;
  const n2  = s2?.matches ?? 0;

  const MIN_SAMPLE = 8;
  const quality = (n1 >= MIN_SAMPLE && n2 >= MIN_SAMPLE) ? 'VERIFIED'
                : (n1 >= 4 && n2 >= 4) ? 'PARTIAL' : 'LOW_SAMPLE';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🎯 Surface · ${_escapeHtml(_surfaceFr(surface))}</span>
        ${_qualityBadge(quality)}
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">Taux de victoires (12 derniers mois) sur ${_escapeHtml(_surfaceFr(surface).toLowerCase())}</div>
      ${_statRow('Taux victoires',
        _pct(wr1), _pct(wr2),
        { better: 'high', raw1: wr1, raw2: wr2 })}
      ${_statRow('Matchs (12 mois)',
        _int(n1), _int(n2),
        { raw1: n1, raw2: n2 })}
    </div>`;
}

// ── SECTION 3 : FORME RÉCENTE ─────────────────────────────────────────────

function _renderRecentForm(match, data) {
  const ema1 = data.p1?.recent_form_ema;
  const ema2 = data.p2?.recent_form_ema;
  const lag1 = data.p1?.csv_lag_days ?? 999;
  const lag2 = data.p2?.csv_lag_days ?? 999;
  const quality = (lag1 > 3 || lag2 > 3) ? 'PARTIAL'
                : (ema1 == null || ema2 == null) ? 'MISSING' : 'VERIFIED';

  const _formLabel = (e) => {
    if (e == null) return '—';
    if (e >= 0.70) return `🔥 en feu`;
    if (e >= 0.55) return `📈 positive`;
    if (e >= 0.45) return `→ neutre`;
    if (e >= 0.30) return `📉 fragile`;
    return `❄️ en crise`;
  };

  // 5 derniers matchs (date + adversaire + score + V/D)
  const last1 = data.p1?.last5_matches ?? [];
  const last2 = data.p2?.last5_matches ?? [];

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}`;
  };

  const surfaceAttr = _escapeHtml(data?.surface ?? 'Hard');
  const tourAttr    = _escapeHtml(data?.tour ?? 'atp');
  const renderMatchRow = (m) => {
    if (!m) return `<div style="font-size:11px;color:var(--color-muted);padding:3px 0">—</div>`;
    const resultColor = m.result === 'W' ? 'var(--color-success)' : 'var(--color-danger)';
    const resultLabel = m.result === 'W' ? 'V' : 'D';
    const opp = m.opponent ?? '—';
    const score = m.score ?? '';
    const oppSafe = _escapeHtml(opp);
    // v6.88 : opponent name cliquable → modal stats joueur
    const oppHtml = opp === '—'
      ? `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text)">${oppSafe}</span>`
      : `<button type="button" class="tennis-opp-link" data-name="${oppSafe}" data-surface="${surfaceAttr}" data-tour="${tourAttr}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text);background:none;border:none;padding:0;text-align:left;cursor:pointer;font:inherit;text-decoration:underline;text-decoration-color:var(--color-text-secondary);text-decoration-style:dotted;text-underline-offset:2px">${oppSafe}</button>`;
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0;color:var(--color-text-secondary)">
      <span style="font-weight:700;color:${resultColor};width:14px;flex-shrink:0">${resultLabel}</span>
      <span style="width:34px;flex-shrink:0;font-variant-numeric:tabular-nums">${fmtDate(m.date)}</span>
      ${oppHtml}
      <span style="font-variant-numeric:tabular-nums;color:var(--color-text-secondary)">${_escapeHtml(score)}</span>
    </div>`;
  };

  const list1 = last1.length > 0 ? last1.slice(0, 5).map(renderMatchRow).join('') : '<div style="font-size:11px;color:var(--color-muted);padding:4px 0">Aucun match recensé</div>';
  const list2 = last2.length > 0 ? last2.slice(0, 5).map(renderMatchRow).join('') : '<div style="font-size:11px;color:var(--color-muted);padding:4px 0">Aucun match recensé</div>';

  const p1Name = match?.home_team?.name ?? data.p1?.name ?? 'Joueur 1';
  const p2Name = match?.away_team?.name ?? data.p2?.name ?? 'Joueur 2';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">🔥 Forme récente</span>
        ${_qualityBadge(quality)}
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">Moyenne pondérée des 10 derniers matchs · 1.00 = 10 victoires sur 10</div>
      ${_statRow('Forme récente',
        ema1 != null ? ema1.toFixed(2) : '—',
        ema2 != null ? ema2.toFixed(2) : '—',
        { better: 'high', raw1: ema1, raw2: ema2 })}
      ${_statRow('Tendance',
        _formLabel(ema1), _formLabel(ema2))}
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--color-border)">
        <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:6px">5 derniers matchs</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div>
            <div style="font-size:11px;font-weight:700;margin-bottom:4px">${_escapeHtml(p1Name)}</div>
            ${list1}
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;margin-bottom:4px">${_escapeHtml(p2Name)}</div>
            ${list2}
          </div>
        </div>
      </div>
    </div>`;
}

// ── SECTION 4 : H2H ───────────────────────────────────────────────────────

function _renderH2H(match, data) {
  const p1Name = match?.home_team?.name ?? data.p1?.name;
  const p2Name = match?.away_team?.name ?? data.p2?.name;
  const surface = data.surface ?? 'Hard';

  // v6.82 surface+overall · v6.84 ajout matches[] avec scores/dates/tournoi
  const h2h = data.p1?.h2h?.[p2Name] ?? null;
  const sw1  = h2h?.p1_wins ?? 0;
  const sw2  = h2h?.p2_wins ?? 0;
  const ow1  = h2h?.p1_wins_overall ?? 0;
  const ow2  = h2h?.p2_wins_overall ?? 0;
  const matches = Array.isArray(h2h?.matches) ? h2h.matches : [];
  const overTotal = ow1 + ow2;

  const overallQuality = overTotal >= 3 ? 'VERIFIED' : overTotal >= 1 ? 'LOW_SAMPLE' : 'MISSING';

  const renderRow = (w1, w2, label) => {
    const total = w1 + w2;
    if (total === 0) {
      return `<div style="font-size:11px;color:var(--color-muted);text-align:center;padding:6px 0">${label} : aucune confrontation</div>`;
    }
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0">
        <span style="font-size:10px;color:var(--color-text-secondary);min-width:90px">${label}</span>
        <span style="font-size:18px;font-weight:800;color:${w1 > w2 ? 'var(--color-signal)' : 'var(--color-text)'}">${w1}</span>
        <span style="font-size:10px;color:var(--color-text-secondary);flex:1;text-align:center">${total} match${total > 1 ? 's' : ''}</span>
        <span style="font-size:18px;font-weight:800;color:${w2 > w1 ? 'var(--color-signal)' : 'var(--color-text)'}">${w2}</span>
      </div>`;
  };

  const fmtDate = (d) => (!d || d.length < 8) ? '—' : `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`;
  const renderMatch = (m) => {
    const dateStr = fmtDate(m.date);
    const winnerName = m.winner === 'p1' ? p1Name : p2Name;
    const winnerColor = m.winner === 'p1' ? 'var(--color-signal)' : 'var(--color-text)';
    const surfTag = m.surface ? `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.06);color:var(--color-text-secondary);margin-left:4px">${_escapeHtml(_surfaceFr(m.surface))}</span>` : '';
    return `
      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:5px 0;border-bottom:1px solid var(--color-border);align-items:center">
        <span style="font-size:10px;color:var(--color-text-secondary);min-width:64px">${dateStr}</span>
        <div style="font-size:11px;line-height:1.3">
          <div style="color:${winnerColor};font-weight:600">${_escapeHtml(winnerName ?? '—')}</div>
          <div style="color:var(--color-text-secondary);font-size:10px">${_escapeHtml(m.tournament ?? '—')} · ${_escapeHtml(m.round ?? '—')}${surfTag}</div>
        </div>
        <span style="font-size:11px;font-family:monospace;color:var(--color-text);text-align:right">${_escapeHtml(m.score ?? '—')}</span>
      </div>`;
  };
  const matchesHtml = matches.length === 0 ? '' : `
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border)">
      <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Détail des matchs</div>
      ${matches.slice(0, 15).map(renderMatch).join('')}
      ${matches.length > 15 ? `<div style="font-size:10px;color:var(--color-text-secondary);text-align:center;padding-top:4px">+ ${matches.length - 15} autres</div>` : ''}
    </div>`;

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">⚔️ Confrontations directes</span>
        ${_qualityBadge(overallQuality)}
      </div>
      ${renderRow(sw1, sw2, `Sur ${_escapeHtml(_surfaceFr(surface).toLowerCase())}`)}
      ${renderRow(ow1, ow2, 'Toutes surfaces')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid var(--color-border)">
        <div style="font-size:11px;text-align:left;color:var(--color-text-secondary)">${_escapeHtml(p1Name ?? '—')}</div>
        <div style="font-size:11px;text-align:right;color:var(--color-text-secondary)">${_escapeHtml(p2Name ?? '—')}</div>
      </div>
      ${matchesHtml}
    </div>`;
}

// ── SECTION 5 : SERVICE ───────────────────────────────────────────────────

function _renderService(match, data) {
  const s1 = data.p1?.service_stats;
  const s2 = data.p2?.service_stats;

  if (!s1 && !s2) {
    return `
      <div class="card match-detail__bloc">
        <div class="bloc-header"><span class="bloc-header__title">💥 Service</span>${_qualityBadge('MISSING')}</div>
        <div style="font-size:12px;color:var(--color-muted);padding:8px 0">Stats service indisponibles.</div>
      </div>`;
  }

  // 1st serve won % = first_serve_won / svpt
  const firstWon = (s) => (s?.svpt > 0 && s?.first_serve_won != null) ? s.first_serve_won / s.svpt : null;
  const fw1 = firstWon(s1);
  const fw2 = firstWon(s2);

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">💥 Service</span>
        ${_qualityBadge('PARTIAL')}
      </div>
      <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">Moyennes 20 derniers matchs gagnés</div>
      ${_statRow('Aces / match',
        _num(s1?.aces), _num(s2?.aces),
        { better: 'high', raw1: s1?.aces, raw2: s2?.aces })}
      ${_statRow('Double fautes',
        _num(s1?.double_faults), _num(s2?.double_faults),
        { better: 'low', raw1: s1?.double_faults, raw2: s2?.double_faults })}
      ${_statRow('1er service gagné',
        _pct(fw1), _pct(fw2),
        { better: 'high', raw1: fw1, raw2: fw2 })}
      ${_statRow('Pts service / match',
        _num(s1?.svpt), _num(s2?.svpt),
        { better: 'high', raw1: s1?.svpt, raw2: s2?.svpt })}
    </div>`;
}

// ── SECTION 6 : CONTEXTE ──────────────────────────────────────────────────

function _renderContext(match, data) {
  const days1 = data.p1?.days_since_last_match;
  const days2 = data.p2?.days_since_last_match;
  const lag1  = data.p1?.csv_lag_days;
  const lag2  = data.p2?.csv_lag_days;
  const tot1  = data.p1?.total_matches;
  const tot2  = data.p2?.total_matches;

  const fatigueLabel = (d) => {
    if (d == null) return '—';
    if (d <= 1) return `🥵 ${d}j (fatigue)`;
    if (d <= 3) return `⚡ ${d}j`;
    if (d <= 7) return `✅ ${d}j`;
    if (d <= 14) return `💤 ${d}j`;
    return `😴 ${d}j (rouille)`;
  };

  const tournamentLine = data.tournament_label
    ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:8px">
         🏆 ${_escapeHtml(data.tournament_label)} · ${_escapeHtml(_surfaceFr(data.surface))} · ${String(data.tour ?? '').toUpperCase()}
       </div>`
    : '';

  return `
    <div class="card match-detail__bloc">
      <div class="bloc-header" style="margin-bottom:var(--space-3)">
        <span class="bloc-header__title">⏱️ Contexte &amp; fatigue</span>
      </div>
      ${tournamentLine}
      ${_statRow('Jours depuis dernier match',
        fatigueLabel(days1), fatigueLabel(days2),
        { raw1: days1, raw2: days2 })}
      ${_statRow('Matchs recensés (2 ans)',
        _int(tot1), _int(tot2),
        { better: 'high', raw1: tot1, raw2: tot2 })}
      ${_statRow('Fraîcheur data (j)',
        _int(lag1), _int(lag2),
        { better: 'low', raw1: lag1, raw2: lag2 })}
      <div style="margin-top:10px;padding:8px 10px;background:var(--color-bg);border-radius:8px;font-size:10px;color:var(--color-text-secondary);line-height:1.5">
        Source : Jeff Sackmann CSV (GitHub, lag ~2-3j). Matchs du tournoi en cours pas encore recensés.
      </div>
    </div>`;
}

// v6.88 : modal stats adversaire au clic sur nom dans "5 derniers matchs"
function _attachOpponentModalHandlers(detailEl) {
  if (!detailEl) return;
  detailEl.querySelectorAll('.tennis-opp-link').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const name    = btn.dataset.name;
      const surface = btn.dataset.surface ?? 'Hard';
      const tour    = btn.dataset.tour    ?? 'atp';
      if (!name) return;
      _openOpponentModal(name, surface, tour);
    });
  });
}

function _openOpponentModal(name, surface, tour) {
  // Modal squelette · contenu rempli après fetch
  const overlay = document.createElement('div');
  overlay.className = 'tennis-opp-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:var(--color-bg);border-radius:12px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span style="font-size:15px;font-weight:700">${_escapeHtml(name)}</span>
        <button type="button" class="tennis-opp-modal-close" style="background:none;border:none;color:var(--color-text-secondary);font-size:20px;line-height:1;cursor:pointer;padding:0">✕</button>
      </div>
      <div class="tennis-opp-modal-body" style="font-size:12px;color:var(--color-text-secondary);text-align:center;padding:24px 0">
        ⏳ Chargement des statistiques…
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.tennis-opp-modal-close')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Fetch stats opponent solo
  const url = `${WORKER_URL}/tennis/stats?players=${encodeURIComponent(name)}&surface=${encodeURIComponent(surface)}&tour=${encodeURIComponent(tour)}`;
  fetch(url, { headers: { Accept: 'application/json' } })
    .then(r => r.ok ? r.json() : null)
    .then(json => {
      const body = overlay.querySelector('.tennis-opp-modal-body');
      if (!body) return;
      const s = json?.stats?.[name];
      if (!s || Object.keys(s).length <= 1) {
        body.innerHTML = `<div style="color:var(--color-text-secondary);padding:12px 0">Aucune statistique disponible (joueur peut-être hors top 200 / qualifié).</div>`;
        return;
      }
      body.innerHTML = _renderOpponentStatsHtml(s, surface);
    })
    .catch(() => {
      const body = overlay.querySelector('.tennis-opp-modal-body');
      if (body) body.innerHTML = `<div style="color:var(--color-danger);padding:12px 0">Erreur de chargement.</div>`;
    });
}

function _renderOpponentStatsHtml(s, surface) {
  const surfaceFr = surface === 'Clay' ? 'Terre battue' : surface === 'Grass' ? 'Gazon' : surface === 'Hard' ? 'Dur' : surface;
  const rank = s.current_rank ?? '—';
  const eloOverall = s.elo_overall ?? '—';
  const eloSurface = s.elo_surface ?? '—';
  const wr = s.surface_stats?.[surface]?.win_rate;
  const wrMatches = s.surface_stats?.[surface]?.matches ?? 0;
  const wrPct = wr != null ? `${Math.round(wr * 100)}% (${wrMatches} matchs)` : '—';
  const form = s.recent_form_ema;
  const formStr = form != null ? form.toFixed(2) : '—';
  const totalMatches = s.total_matches ?? 0;
  const daysSince = s.days_since_last_match;
  const fatigueLabel = daysSince == null
    ? '—'
    : daysSince <= 3 ? `${daysSince}j (frais)`
    : daysSince <= 7 ? `${daysSince}j (rythme)`
    : daysSince <= 14 ? `${daysSince}j (pause)`
    : `${daysSince}j (rouille)`;

  const row = (label, val) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--color-border)">
    <span style="font-size:12px;color:var(--color-text-secondary)">${label}</span>
    <span style="font-size:13px;font-weight:600;color:var(--color-text)">${val}</span>
  </div>`;
  return `
    <div style="text-align:left;padding:4px 0">
      ${row('Rang ATP/WTA', `#${rank}`)}
      ${row(`Elo ${surfaceFr}`, eloSurface)}
      ${row('Elo global', eloOverall)}
      ${row(`Win rate ${surfaceFr} (12 mois)`, wrPct)}
      ${row('Forme récente (EMA 10 matchs)', formStr)}
      ${row('Matchs recensés (2 ans)', totalMatches)}
      ${row('Jours depuis dernier match', fatigueLabel)}
    </div>
    <div style="margin-top:14px;padding:8px 10px;background:var(--color-bg-secondary);border-radius:6px;font-size:10px;color:var(--color-text-secondary);line-height:1.5">
      Source : Jeff Sackmann CSV. Stats sur 12-24 derniers mois.
    </div>`;
}
