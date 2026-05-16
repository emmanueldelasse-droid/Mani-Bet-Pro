/**
 * Fixtures déterministes pour tests monitoring + mode --demo du report CLI.
 * Pas de réseau · pas de provider · valeurs fictives.
 *
 * Structure aligned sur les vraies clés produites par les handlers
 * `handleBotLogs` (NBA · worker.js:3855), `handleMLBBotLogs` (worker.js:8924)
 * et `handleTennisBotLogs` (worker.js:10558).
 */

function buildLog({
  match_id, sport, logged_at, date, motor_prob, motor_was_right,
  confidence_level, data_quality, recommendations = [], best = null, best_edge = null,
}) {
  return {
    match_id, sport, logged_at, date,
    motor_prob, motor_was_right,
    confidence_level, data_quality,
    betting_recommendations: {
      recommendations,
      all: recommendations,
      best,
    },
    best_edge,
    settled_at: motor_was_right === null ? null : logged_at,
  };
}

function rec(type, side, edge, was_right) {
  return { type, side, edge, was_right };
}

// ── NBA fixtures · 12 logs · couverture HIGH/MEDIUM/LOW/INCONCLUSIVE ───────
export const NBA_FIXTURE_LOGS = [
  // HIGH confidence · settled correct
  buildLog({ match_id: 'NBA-001', sport: 'NBA', logged_at: '2026-05-01T00:00:00Z', date: '20260501',
    motor_prob: 78, motor_was_right: true, confidence_level: 'HIGH', data_quality: 0.91,
    recommendations: [rec('MONEYLINE', 'HOME', 8, true), rec('SPREAD', 'HOME', 4, true)],
    best: rec('MONEYLINE', 'HOME', 8, true), best_edge: 8 }),
  buildLog({ match_id: 'NBA-002', sport: 'NBA', logged_at: '2026-05-02T00:00:00Z', date: '20260502',
    motor_prob: 75, motor_was_right: true, confidence_level: 'HIGH', data_quality: 0.85,
    recommendations: [rec('MONEYLINE', 'HOME', 7, true)],
    best: rec('MONEYLINE', 'HOME', 7, true), best_edge: 7 }),
  // HIGH confidence · settled wrong (one upset)
  buildLog({ match_id: 'NBA-003', sport: 'NBA', logged_at: '2026-05-03T00:00:00Z', date: '20260503',
    motor_prob: 72, motor_was_right: false, confidence_level: 'HIGH', data_quality: 0.80,
    recommendations: [rec('MONEYLINE', 'HOME', 6, false), rec('OVER_UNDER', 'OVER', 5, true)],
    best: rec('MONEYLINE', 'HOME', 6, false), best_edge: 6 }),
  // MEDIUM
  buildLog({ match_id: 'NBA-004', sport: 'NBA', logged_at: '2026-05-04T00:00:00Z', date: '20260504',
    motor_prob: 62, motor_was_right: true, confidence_level: 'MEDIUM', data_quality: 0.65,
    recommendations: [rec('MONEYLINE', 'HOME', 5, true)],
    best: rec('MONEYLINE', 'HOME', 5, true), best_edge: 5 }),
  buildLog({ match_id: 'NBA-005', sport: 'NBA', logged_at: '2026-05-05T00:00:00Z', date: '20260505',
    motor_prob: 60, motor_was_right: false, confidence_level: 'MEDIUM', data_quality: 0.60,
    recommendations: [rec('MONEYLINE', 'HOME', 5, false)],
    best: rec('MONEYLINE', 'HOME', 5, false), best_edge: 5 }),
  // LOW
  buildLog({ match_id: 'NBA-006', sport: 'NBA', logged_at: '2026-05-06T00:00:00Z', date: '20260506',
    motor_prob: 55, motor_was_right: true, confidence_level: 'LOW', data_quality: 0.62,
    recommendations: [rec('MONEYLINE', 'HOME', 3, true)],
    best: null, best_edge: 3 }),
  // INCONCLUSIVE (dq < 0.55 · MBP-P1)
  buildLog({ match_id: 'NBA-007', sport: 'NBA', logged_at: '2026-05-07T00:00:00Z', date: '20260507',
    motor_prob: 51, motor_was_right: false, confidence_level: 'INCONCLUSIVE', data_quality: 0.50,
    recommendations: [], best: null, best_edge: null }),
  buildLog({ match_id: 'NBA-008', sport: 'NBA', logged_at: '2026-05-08T00:00:00Z', date: '20260508',
    motor_prob: 49, motor_was_right: null, confidence_level: 'INCONCLUSIVE', data_quality: 0.42,
    recommendations: [], best: null, best_edge: null }),
  // PLAYER_POINTS reco · settled correct
  buildLog({ match_id: 'NBA-009', sport: 'NBA', logged_at: '2026-05-09T00:00:00Z', date: '20260509',
    motor_prob: 68, motor_was_right: true, confidence_level: 'MEDIUM', data_quality: 0.72,
    recommendations: [rec('PLAYER_POINTS', 'OVER', 6, true)],
    best: rec('PLAYER_POINTS', 'OVER', 6, true), best_edge: 6 }),
  // Non settlé (planifié futur)
  buildLog({ match_id: 'NBA-010', sport: 'NBA', logged_at: '2026-05-15T00:00:00Z', date: '20260515',
    motor_prob: 64, motor_was_right: null, confidence_level: 'MEDIUM', data_quality: 0.68,
    recommendations: [rec('MONEYLINE', 'HOME', 5, null)],
    best: rec('MONEYLINE', 'HOME', 5, null), best_edge: 5 }),
  buildLog({ match_id: 'NBA-011', sport: 'NBA', logged_at: '2026-05-16T00:00:00Z', date: '20260516',
    motor_prob: 70, motor_was_right: null, confidence_level: 'HIGH', data_quality: 0.83,
    recommendations: [rec('MONEYLINE', 'HOME', 7, null)],
    best: rec('MONEYLINE', 'HOME', 7, null), best_edge: 7 }),
  buildLog({ match_id: 'NBA-012', sport: 'NBA', logged_at: '2026-04-30T00:00:00Z', date: '20260430',
    motor_prob: 58, motor_was_right: true, confidence_level: 'LOW', data_quality: 0.59,
    recommendations: [rec('SPREAD', 'AWAY', 3, true)],
    best: null, best_edge: 3 }),
];

// ── MLB fixtures · couvre LOW (MBP-P1 bloque) + MEDIUM/HIGH ────────────────
export const MLB_FIXTURE_LOGS = [
  // HIGH dq · reco settled correct
  buildLog({ match_id: 'MLB-001', sport: 'MLB', logged_at: '2026-05-01T00:00:00Z', date: '20260501',
    motor_prob: 60, motor_was_right: true, confidence_level: 'HIGH', data_quality: 'HIGH',
    recommendations: [rec('MONEYLINE', 'HOME', 7, true)],
    best: rec('MONEYLINE', 'HOME', 7, true), best_edge: 7 }),
  // HIGH · settled wrong
  buildLog({ match_id: 'MLB-002', sport: 'MLB', logged_at: '2026-05-02T00:00:00Z', date: '20260502',
    motor_prob: 58, motor_was_right: false, confidence_level: 'HIGH', data_quality: 'HIGH',
    recommendations: [rec('MONEYLINE', 'HOME', 6, false), rec('OVER_UNDER', 'OVER', 5, true)],
    best: rec('MONEYLINE', 'HOME', 6, false), best_edge: 6 }),
  // MEDIUM · settled correct
  buildLog({ match_id: 'MLB-003', sport: 'MLB', logged_at: '2026-05-03T00:00:00Z', date: '20260503',
    motor_prob: 55, motor_was_right: true, confidence_level: 'MEDIUM', data_quality: 'MEDIUM',
    recommendations: [rec('PITCHER_STRIKEOUTS', 'OVER', 8, true)],
    best: rec('PITCHER_STRIKEOUTS', 'OVER', 8, true), best_edge: 8 }),
  // LOW · post-MBP-P1 · gate force recos=[] et best=null
  buildLog({ match_id: 'MLB-004', sport: 'MLB', logged_at: '2026-05-04T00:00:00Z', date: '20260504',
    motor_prob: 53, motor_was_right: null, confidence_level: 'LOW', data_quality: 'LOW',
    recommendations: [], best: null, best_edge: null }),
  buildLog({ match_id: 'MLB-005', sport: 'MLB', logged_at: '2026-05-05T00:00:00Z', date: '20260505',
    motor_prob: 47, motor_was_right: null, confidence_level: 'LOW', data_quality: 'LOW',
    recommendations: [], best: null, best_edge: null }),
];

// ── Tennis fixtures · couvre dq numérique au-dessus + en-dessous 0.55 ─────
export const TENNIS_FIXTURE_LOGS = [
  // HIGH dq · settled correct
  buildLog({ match_id: 'TEN-001', sport: 'TENNIS', logged_at: '2026-05-01T00:00:00Z', date: '20260501',
    motor_prob: 70, motor_was_right: true, confidence_level: 'HIGH', data_quality: 0.85,
    recommendations: [rec('MONEYLINE', 'HOME', 8, true)],
    best: rec('MONEYLINE', 'HOME', 8, true), best_edge: 8 }),
  buildLog({ match_id: 'TEN-002', sport: 'TENNIS', logged_at: '2026-05-02T00:00:00Z', date: '20260502',
    motor_prob: 65, motor_was_right: false, confidence_level: 'MEDIUM', data_quality: 0.70,
    recommendations: [rec('MONEYLINE', 'HOME', 6, false)],
    best: rec('MONEYLINE', 'HOME', 6, false), best_edge: 6 }),
  // INCONCLUSIVE · dq < 0.55
  buildLog({ match_id: 'TEN-003', sport: 'TENNIS', logged_at: '2026-05-03T00:00:00Z', date: '20260503',
    motor_prob: 50, motor_was_right: null, confidence_level: 'INCONCLUSIVE', data_quality: 0.48,
    recommendations: [], best: null, best_edge: null }),
  // dq exactement 0.55 · autorisé · pas INCONCLUSIVE
  buildLog({ match_id: 'TEN-004', sport: 'TENNIS', logged_at: '2026-05-04T00:00:00Z', date: '20260504',
    motor_prob: 60, motor_was_right: true, confidence_level: 'MEDIUM', data_quality: 0.55,
    recommendations: [rec('MONEYLINE', 'HOME', 5, true)],
    best: rec('MONEYLINE', 'HOME', 5, true), best_edge: 5 }),
];

export const DEMO_LOGS_BY_SPORT = {
  NBA:    NBA_FIXTURE_LOGS,
  MLB:    MLB_FIXTURE_LOGS,
  TENNIS: TENNIS_FIXTURE_LOGS,
};
