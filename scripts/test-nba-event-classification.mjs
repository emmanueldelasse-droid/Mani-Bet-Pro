#!/usr/bin/env node
/**
 * NBA event classification · preseason / regular / postseason.
 *
 * Vérifie que le type réel ESPN prime sur la date système et que frontend /
 * backend restent alignés sans modifier les poids existants.
 *
 * Aucun réseau · aucun secret · fixtures déterministes.
 */

import './lib/dom-stub.mjs';
import { backend } from './lib/backend-engine.mjs';
import { FIXTURES } from './lib/fixtures.mjs';
import { getNBAPhase, getNBAWeights } from '../src/config/sports.config.js';
import { EngineNBA } from '../src/engine/engine.nba.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, condition) {
  if (condition) pass++;
  else { fail++; failures.push(label); console.error('  ✗', label); }
}
function eq(label, actual, expected) {
  check(`${label} · expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

function makeCompetitor(id, name, abv, homeAway) {
  return {
    id,
    homeAway,
    team: { id, displayName: name, abbreviation: abv },
    records: [],
    statistics: [],
    score: null,
  };
}

function makeEvent(id, seasonType, datetime) {
  return {
    id,
    date: datetime,
    name: 'New York Knicks at Boston Celtics',
    season: { type: seasonType },
    status: { type: { name: 'STATUS_SCHEDULED', detail: 'Scheduled' } },
    competitions: [{
      seasonType,
      competitors: [
        makeCompetitor('2', 'Boston Celtics', 'BOS', 'home'),
        makeCompetitor('18', 'New York Knicks', 'NYK', 'away'),
      ],
      odds: [],
    }],
  };
}

// 1) Parser ESPN conserve le season type et le convertit en event_type canonique.
{
  const parsed = backend.parseESPNMatches({
    events: [
      makeEvent('PRE', 1, '2026-10-03T23:00:00Z'),
      makeEvent('REG', 2, '2026-10-20T23:00:00Z'),
      makeEvent('POST', 3, '2027-04-18T23:00:00Z'),
      makeEvent('OFF', 4, '2027-07-01T23:00:00Z'),
    ],
  }, '20261003');

  eq('parser · preseason', parsed[0]?.event_type, 'PRESEASON');
  eq('parser · preseason season_type', parsed[0]?.season_type, 1);
  eq('parser · regular', parsed[1]?.event_type, 'REGULAR');
  eq('parser · postseason', parsed[2]?.event_type, 'POSTSEASON');
  eq('parser · offseason', parsed[3]?.event_type, 'OFFSEASON');
}

// 2) Le type réel doit primer sur une date calendrier contradictoire.
{
  const may = new Date('2027-05-10T12:00:00Z');
  eq('frontend · regular ESPN prime sur mai playoff', getNBAPhase(may, { season_type: 2, event_type: 'REGULAR' }), 'regular');
  eq('backend · regular ESPN prime sur mai playoff', backend._botGetNBAPhase({ season_type: 2, event_type: 'REGULAR', datetime: may.toISOString() }), 'regular');

  const october = new Date('2026-10-03T12:00:00Z');
  eq('frontend · preseason ESPN prime sur octobre regular', getNBAPhase(october, { season_type: 1, event_type: 'PRESEASON' }), 'preseason');
  eq('backend · preseason ESPN prime sur octobre regular', backend._botGetNBAPhase({ season_type: 1, event_type: 'PRESEASON', datetime: october.toISOString() }), 'preseason');
}

// 3) ESPN POSTSEASON utilise la date du match uniquement pour Play-In vs Playoff.
{
  const playinDate = new Date('2027-04-18T23:00:00Z');
  const playoffDate = new Date('2027-05-01T23:00:00Z');

  eq('frontend · postseason avril → playin', getNBAPhase(playinDate, { season_type: 3, event_type: 'POSTSEASON' }), 'playin');
  eq('backend · postseason avril → playin', backend._botGetNBAPhase({ season_type: 3, event_type: 'POSTSEASON', datetime: playinDate.toISOString() }), 'playin');
  eq('frontend · postseason mai → playoff', getNBAPhase(playoffDate, { season_type: 3, event_type: 'POSTSEASON' }), 'playoff');
  eq('backend · postseason mai → playoff', backend._botGetNBAPhase({ season_type: 3, event_type: 'POSTSEASON', datetime: playoffDate.toISOString() }), 'playoff');
}

// 4) Aucun nouveau poids n'est inventé pour la preseason : elle reste explicitement
// taggée preseason mais utilise temporairement les poids regular existants.
{
  const preFront = getNBAWeights(new Date('2026-10-03T12:00:00Z'), { season_type: 1, event_type: 'PRESEASON' });
  const regFront = getNBAWeights(new Date('2026-10-20T12:00:00Z'), { season_type: 2, event_type: 'REGULAR' });
  eq('frontend · phase preseason exposée', preFront.phase, 'preseason');
  eq('frontend · poids preseason = poids regular existants', preFront.weights, regFront.weights);

  const preBack = backend._botGetWeights({ season_type: 1, event_type: 'PRESEASON', datetime: '2026-10-03T23:00:00Z' });
  const regBack = backend._botGetWeights({ season_type: 2, event_type: 'REGULAR', datetime: '2026-10-20T23:00:00Z' });
  eq('backend · phase preseason exposée', preBack.phase, 'preseason');
  eq('backend · poids preseason = poids regular existants', preBack.weights, regBack.weights);
}

// 5) Les moteurs frontend/backend exposent la même phase pour le même match.
{
  const base = structuredClone(FIXTURES[0].data);
  const preseason = {
    ...base,
    event_type: 'PRESEASON',
    season_type: 1,
    game_datetime: '2026-10-03T23:00:00Z',
    absences_confirmed: false,
  };

  const front = EngineNBA.compute(preseason);
  const back = backend._botEngineCompute(preseason);

  eq('engine parity · frontend phase', front.nba_phase, 'preseason');
  eq('engine parity · backend phase', back.nba_phase, 'preseason');
  eq('engine parity · même phase', front.nba_phase, back.nba_phase);
}

console.log('\nNBA event classification');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\nÉchecs :');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ✓ event type ESPN prioritaire · frontend/backend alignés · poids inchangés\n');
process.exit(0);
