/**
 * Fixtures NBA pour test parité backend ↔ frontend.
 *
 * Données déterministes · pas de provider externe · pas de réseau.
 *
 * Format · objet `matchData` consommé par `_botExtractVariables`
 * (backend) et `extractVariables` (frontend). Mêmes clés des 2 côtés.
 *
 * Note · les valeurs PPG des joueurs sont fictives mais réalistes pour
 * valider le `star_absence_modifier`. Aucun nom officiel n'est référencé.
 */

const TEAMS = {
  HOME: { name: 'Home Team', avg_pts: 115 },
  AWAY: { name: 'Away Team', avg_pts: 112 },
};

function seasonStats({ winPct, netRating, efgPct, drtg, homeWinPct, awayWinPct, gamesPlayed = 40, name = 'Team', avgPts = 113 }) {
  return {
    name,
    team_name:     name,
    games_played:  gamesPlayed,
    win_pct:       winPct,
    net_rating:    netRating,
    efg_pct:       efgPct,
    ts_pct:        efgPct + 0.02,
    defensive_rating: drtg,
    home_win_pct:  homeWinPct,
    away_win_pct:  awayWinPct,
    avg_pts:       avgPts,
  };
}

function recentForm(wins, losses, opts = {}) {
  // Construit un historique de 5 matchs · wins=N wins · losses=5-N.
  // Pattern par défaut · alternance simple · dates par défaut espacées de 2j
  // pour éviter back-to-back parasites (sauf si caller veut explicitement).
  const pattern  = opts.pattern  ?? [...Array(wins).fill(true), ...Array(losses).fill(false)];
  const homeMask = opts.homeMask ?? [true, false, true, false, true];
  const dateStep = opts.dateStep ?? 2; // jours d'écart entre matchs
  const dates    = opts.dates ?? Array.from({ length: 5 }, (_, i) =>
    `2026-03-${String(20 - i * dateStep).padStart(2, '0')}`
  );
  const matches = pattern.slice(0, 5).map((won, i) => ({
    date:    dates[i],
    won,
    is_home: homeMask[i],
  }));
  return { matches };
}

/**
 * Recalcule depuis `matches` les champs précalculés que le frontend lit en
 * direct (`home_b2b_last5`, `home_away_games_last5`, etc.) avec la même
 * logique que le backend `_botCountB2BInLast5` / `_botCountAwayGamesInLast5`.
 *
 * Garantit que les 2 moteurs voient la MÊME donnée upstream · isole l'audit
 * de parité au niveau moteur (formules) sans bruit lié à l'orchestrateur.
 *
 * Si en production l'orchestrateur calcule différemment ces champs, c'est un
 * écart hors moteur · à auditer séparément (MBP-A.5 potentiel).
 */
export function deriveLast5Stats(recent) {
  if (!recent?.matches?.length) return { b2b: null, away: null };
  const m = recent.matches.slice(0, 5);
  const withDate = m.filter(x => x.date);
  let b2b = null;
  if (withDate.length >= 2) {
    b2b = 0;
    for (let i = 0; i < withDate.length - 1; i++) {
      const d1 = new Date(withDate[i].date + 'T12:00:00');
      const d2 = new Date(withDate[i + 1].date + 'T12:00:00');
      if (Math.round((d1 - d2) / 86400000) === 1) b2b++;
    }
  }
  const withHomeFlag = m.filter(x => x.is_home !== undefined);
  const away = withHomeFlag.length === 0 ? null : withHomeFlag.filter(x => x.is_home === false).length;
  return { b2b, away };
}

/**
 * Squelette de match · valeurs neutres · à surcharger pour chaque cas.
 */
function baseMatch(overrides = {}) {
  const base = {
    id:   'MBP-PARITY-TEST',
    home_team: TEAMS.HOME.name,
    away_team: TEAMS.AWAY.name,
    home_season_stats: seasonStats({
      winPct: 0.55, netRating: 2.0, efgPct: 0.530, drtg: 112,
      homeWinPct: 0.60, awayWinPct: 0.50, name: TEAMS.HOME.name, avgPts: 115,
    }),
    away_season_stats: seasonStats({
      winPct: 0.50, netRating: 0.0, efgPct: 0.525, drtg: 113,
      homeWinPct: 0.55, awayWinPct: 0.45, name: TEAMS.AWAY.name, avgPts: 112,
    }),
    home_recent:   recentForm(3, 2, { homeMask: [true, false, true, false, true] }),
    away_recent:   recentForm(2, 3, { homeMask: [false, true, false, true, false] }),
    home_injuries: [],
    away_injuries: [],
    home_back_to_back: false,
    away_back_to_back: false,
    home_rest_days:    2,
    away_rest_days:    2,
    advanced_stats: null,
    odds: null,
    market_odds: null,
    ...overrides,
  };
  // Aligner les champs précalculés avec ce que backend recalculerait depuis
  // recent.matches (parité upstream · voir deriveLast5Stats).
  const homeStats = deriveLast5Stats(base.home_recent);
  const awayStats = deriveLast5Stats(base.away_recent);
  base.home_b2b_last5         = homeStats.b2b;
  base.away_b2b_last5         = awayStats.b2b;
  base.home_away_games_last5  = homeStats.away;
  base.away_away_games_last5  = awayStats.away;
  return base;
}

// ── CAS DE TEST ──────────────────────────────────────────────────────────────

export const FIXTURES = [
  {
    id:       'neutral_baseline',
    label:    'baseline neutre · aucun b2b · pas de blessures · stats moyennes',
    data:     baseMatch(),
    expects:  { confidence: 'any', score_delta_max: 0.01 },
  },

  {
    id:       'b2b_home_only',
    label:    'home en back-to-back · away frais · attendu signaler divergence -0.6 (back) vs -1 (front)',
    data:     baseMatch({ home_back_to_back: true, away_back_to_back: false }),
    expects:  { back_to_back_known_divergence: true },
  },

  {
    id:       'b2b_away_only',
    label:    'away en back-to-back · home frais · attendu +0.6 (back) vs +1 (front)',
    data:     baseMatch({ home_back_to_back: false, away_back_to_back: true }),
    expects:  { back_to_back_known_divergence: true },
  },

  {
    id:       'b2b_both',
    label:    'les deux en back-to-back · neutre · valeur = 0 des 2 côtés',
    data:     baseMatch({ home_back_to_back: true, away_back_to_back: true }),
    expects:  { back_to_back_aligned: true },
  },

  {
    id:       'high_signal_home',
    label:    'home largement favori · efg + net rating fort · away faible · attendu HIGH confidence',
    data:     baseMatch({
      home_season_stats: seasonStats({
        winPct: 0.72, netRating: 8.5, efgPct: 0.575, drtg: 108,
        homeWinPct: 0.80, awayWinPct: 0.65, name: TEAMS.HOME.name, avgPts: 119,
      }),
      away_season_stats: seasonStats({
        winPct: 0.35, netRating: -4.0, efgPct: 0.495, drtg: 116,
        homeWinPct: 0.45, awayWinPct: 0.25, name: TEAMS.AWAY.name, avgPts: 108,
      }),
      home_recent: recentForm(4, 1),
      away_recent: recentForm(1, 4),
    }),
    expects:  { confidence: 'HIGH' },
  },

  {
    id:       'balanced_match',
    label:    'match équilibré · score proche de 0.5 · attendu LOW ou INCONCLUSIVE',
    data:     baseMatch({
      home_season_stats: seasonStats({
        winPct: 0.52, netRating: 0.5, efgPct: 0.528, drtg: 112,
        homeWinPct: 0.55, awayWinPct: 0.49, name: TEAMS.HOME.name, avgPts: 113,
      }),
      away_season_stats: seasonStats({
        winPct: 0.50, netRating: 0.0, efgPct: 0.527, drtg: 112,
        homeWinPct: 0.53, awayWinPct: 0.47, name: TEAMS.AWAY.name, avgPts: 112,
      }),
    }),
    expects:  { confidence_in: ['LOW', 'INCONCLUSIVE', 'MEDIUM'] },
  },

  {
    id:       'home_away_split_asymmetric',
    label:    'home très fort à domicile · away très faible à l\'extérieur · valide formule alignée',
    data:     baseMatch({
      home_season_stats: seasonStats({
        winPct: 0.55, netRating: 2.0, efgPct: 0.530, drtg: 112,
        homeWinPct: 0.78, awayWinPct: 0.32, name: TEAMS.HOME.name, avgPts: 115,
      }),
      away_season_stats: seasonStats({
        winPct: 0.50, netRating: 0.0, efgPct: 0.525, drtg: 113,
        homeWinPct: 0.65, awayWinPct: 0.35, name: TEAMS.AWAY.name, avgPts: 112,
      }),
    }),
    expects:  { home_away_split_aligned: true },
  },

  {
    id:       'absences_impact_home_star',
    label:    'star home Out (ppg 28) · vérifie absences_impact + star_absence_modifier',
    data:     baseMatch({
      home_injuries: [
        { name: 'Player A', status: 'Out', ppg: 28, source: 'tank01_roster', impact_weight: 1.0 },
        { name: 'Player B', status: 'Probable', ppg: 9, source: 'espn_injuries' },
      ],
      away_injuries: [],
    }),
    expects:  { absences_impact_aligned: true },
  },

  {
    id:       'missing_critical_data',
    label:    'données critiques manquantes · efg/net null · score doit chuter ou être null',
    data:     baseMatch({
      home_season_stats: seasonStats({
        winPct: 0.55, netRating: null, efgPct: null, drtg: 112,
        homeWinPct: 0.60, awayWinPct: 0.50, name: TEAMS.HOME.name, avgPts: 115,
      }),
      away_season_stats: seasonStats({
        winPct: 0.50, netRating: null, efgPct: null, drtg: 113,
        homeWinPct: 0.55, awayWinPct: 0.45, name: TEAMS.AWAY.name, avgPts: 112,
      }),
    }),
    expects:  { score_method_any: true },
  },
];
