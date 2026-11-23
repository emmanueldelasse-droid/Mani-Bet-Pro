import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {processPromptInbox,readActiveExperiment,readLabExperiments,eligibleForExperiment,closePromptExperiment} from '../prompt-lab-store.mjs';

const at='2027-01-06T10:00:00.000Z';
const tip='2027-01-08T23:00:00.000Z';
function setup(){
  const raw=new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=ON');
  let now=at;
  raw.function('strftime',{deterministic:true},(_fmt,x)=>x==='now'?now:new Date(x).toISOString());
  for(const name of ['research-journal','study-runtime','prompt-lab'])raw.exec(readFileSync(new URL('../'+name+'.sql',import.meta.url),'utf8'));
  function statement(q,args=[]){return {bind(...a){return statement(q,a);},first(){return raw.prepare(q).get(...args)??null;},
    run(){return raw.prepare(q).run(...args);},all(){return {results:raw.prepare(q).all(...args)};}};}
  const db={prepare:statement,batch(s){raw.exec('BEGIN');try{const a=s.map(x=>x.all());raw.exec('COMMIT');return a;}catch(e){raw.exec('ROLLBACK');throw e;}}};
  const player=(id)=>({player_id:id,team_id:'45',name:'Athlète '+id,minutes:20,points:12,official_for_game:false,status:'NO_CURRENT_REPORT'});
  const fixture=(gameId,playerId,facts=[])=>{
    const p={after:{primary:{players:[player(playerId)]}},facts,receipts:[]};
    return Number(raw.prepare("INSERT INTO max_forecast_versions(match_id,as_of,tip,integrated_at,payload) VALUES (?,'2027-01-03T09:00:00.000Z','2027-01-03T20:00:00.000Z','2027-01-03T09:00:01.000Z',?)").run(gameId,JSON.stringify(p)).lastInsertRowid);
  };
  fixture('400001','51');fixture('400002','52');
  raw.prepare('INSERT INTO study_context VALUES(?,?,?,?)').run('400004',at,tip,'{}');
  const evidence=[{match_id:'400001',player_id:'51',version_id:1,observation:'Temps de jeu fluctuant. Statut absent.'},
    {match_id:'400002',player_id:'52',version_id:2,observation:'Deuxième match avec la même lacune.'}];
  const proposal={id:'macfly-prompt-01',author:'MacFly',action:'TEST',target:'AVAILABILITY',diagnosis:'MISSING',problem:'Le statut manque pour deux joueurs.',
    hypothesis:'Un statut officiel peut réduire l’erreur de temps de jeu.',prompt:'  Consulter un seul bulletin officiel NBA.\nConserver son heure exacte.  ',
    metric:'minutes_mae',criterion:{min_games:1,min_dates:1,min_gain:0.25},cohort:{start:'2027-01-08T00:00:00Z',end:'2027-01-09T00:00:00Z'},
    targets:[{match_id:'400004',tip}],evidence};
  return {db,raw,proposal,fixture,setClock(v){now=v;},send(p){raw.prepare('INSERT INTO prompt_lab_inbox(payload) VALUES(?) ON CONFLICT(id) DO NOTHING').run(JSON.stringify(p));}};
}

test('MacFly authored prompt and future targets are immutable; competing deliveries cannot start a second treatment',async()=>{
  const {db,raw,proposal,send}=setup();send(proposal);send(proposal);
  assert.throws(()=>send({...proposal,prompt:'Différent'}),/PROMPT_ID_CONFLICT/);
  const other={...proposal,id:'macfly-prompt-02'};send(other);
  const [first,second]=await processPromptInbox(db);
  assert.equal(first.status,'ACTIVE');assert.equal(first.prompt,proposal.prompt);assert.equal(first.evidence[0].classification,'MISSING');
  assert.equal(second.reason,'ANOTHER_PROMPT_ACTIVE');
  assert.equal((await readActiveExperiment(db)).id,proposal.id);
  assert.equal((await readLabExperiments(db)).length,1);
  assert.deepEqual(await processPromptInbox(db),[]);
  assert.ok(eligibleForExperiment(first,{id:'400004',start:tip,status:'STATUS_SCHEDULED'},at));
  assert.equal(eligibleForExperiment(first,{id:'400004',start:tip},tip),false);
  assert.equal(eligibleForExperiment(first,{id:'400004',start:'2027-01-09T01:00:00Z'},at),false);
  assert.throws(()=>raw.prepare("UPDATE prompt_lab_experiments SET plan_json='{}'").run(),/PROMPT_PLAN_FROZEN/);
  assert.throws(()=>raw.prepare("DELETE FROM prompt_lab_inbox").run(),/IMMUTABLE/);
});

test('a linked official fact corroborates NO_PROMPT, a known or misrouted fact cannot justify TEST',async()=>{
  const {db,raw,proposal,send,fixture}=setup();
  const match_id='400003',player_id='53';
  const record={schema_version:'max-research-v1',generated_at:'2027-01-03T08:00:00Z',match_id,
    verified_injuries:[{match_id,player_id,team_id:'45',player:'Athlète 53',status:'OUT',checked_at:'2027-01-03T08:00:00Z',source_url:'https://www.nba.com/report'}],
    sources:[{url:'https://www.nba.com/report',kind:'OFFICIAL'}]};
  raw.prepare('INSERT INTO macfly_inbox(report_json) VALUES(?)').run(JSON.stringify(record));
  const v=fixture(match_id,player_id,[{kind:'INJURY',effect:'ALREADY_KNOWN',player_id,receipt_id:1,source_url:'https://www.nba.com/report'}]);
  const noPrompt={...proposal,id:'no-prompt-01',action:'NO_PROMPT',diagnosis:'ALREADY_USED',prompt:null,reason:'L’information était déjà intégrée.',targets:[],
    evidence:[{match_id,player_id,version_id:v,receipt_id:1,observation:'Absence figurant au journal.'}]};
  send(noPrompt);const [observed]=await processPromptInbox(db);assert.equal(observed.status,'NO_PROMPT');assert.equal(observed.prompt,null);assert.equal(observed.evidence[0].receipt_id,1);
  send({...proposal,evidence:[...proposal.evidence,noPrompt.evidence[0]]});
  assert.equal((await processPromptInbox(db))[0].reason,'DIAGNOSIS_CONTRADICTED_BY_JOURNAL');
  raw.prepare('INSERT INTO macfly_inbox(report_json) VALUES(?)').run(JSON.stringify({...record,match_id:'400001',verified_injuries:[{...record.verified_injuries[0],match_id:'400001',player_id:'51',player:'Athlète 51'}]}));
  send({...noPrompt,id:'transmission-01',diagnosis:'TRANSMISSION',evidence:[{...proposal.evidence[0],receipt_id:2}]});
  const [late]=await processPromptInbox(db);
  assert.equal(late.evidence[0].classification,'TRANSMISSION');
});

test('validation rejects swapped player/match, retroactive targets and fabricated schedules but accepts future published ESPN match identifiers',async()=>{
  const {db,proposal,send}=setup();
  for(const [id,extra,reason] of [
    ['mistaken-match',{evidence:[{...proposal.evidence[0],match_id:'400002'}]},'EVIDENCE_CAPTURE_NOT_VERIFIED'],
    ['past-target',{targets:[{match_id:'400004',tip:at}]},'TARGET_OUTSIDE_FUTURE_COHORT'],
    ['invented-date',{targets:[{match_id:'400004',tip:'2027-01-08T20:00:00Z'}]},'TARGET_SCHEDULE_MISMATCH'],
    ['unlisted-game',{targets:[{match_id:'777777',tip}]},'FUTURE_SCHEDULE_REFERENCE_REQUIRED'],
    ['unchanged-arm',{metric:'brier'},'METRIC_UNAFFECTED_BY_AVAILABILITY_BRANCH'],
    ['bad-metric',{criterion:{min_games:1,min_dates:1,min_gain:0}},'INVALID_DECISION_CRITERION']
  ]){
    send({...proposal,...extra,id});assert.equal((await processPromptInbox(db,id))[0].reason,reason);
  }
  send({...proposal,targets:[{match_id:'400004',tip},{match_id:'400005',tip,source_url:'https://www.espn.com/nba/game/_/gameId/400005'}]});
  assert.equal((await processPromptInbox(db))[0].targets.length,2);
});

test('one immutable measured verdict at the predeclared horizon, with grace for missing outcomes and no automatic adoption',async()=>{
  const {db,proposal,send,setClock}=setup();send(proposal);await processPromptInbox(db);
  const missing={decision:'ABANDONNER',metric:'minutes_mae',target_count:1,evaluated_games:0,evaluated_cases:0,reason:'Aucun match comparable.'};
  assert.equal((await closePromptExperiment(db,proposal.id,'ABANDONNER',missing)).status,'ACTIVE');
  await assert.rejects(closePromptExperiment(db,proposal.id,'PROPOSER_ADOPTION',{...missing,decision:'PROPOSER_ADOPTION'}),/CRITERION_NOT_MET/);
  setClock('2027-01-10T00:00:00.000Z');
  assert.equal((await closePromptExperiment(db,proposal.id,'ABANDONNER',missing)).status,'ACTIVE');
  setClock('2027-01-12T00:00:01.000Z');
  const closed=await closePromptExperiment(db,proposal.id,'ABANDONNER',missing);
  assert.equal(closed.status,'ABANDON');assert.equal(closed.decision.evaluated_games,0);
  assert.equal(await readActiveExperiment(db),null);
  assert.equal((await closePromptExperiment(db,proposal.id,'ABANDONNER',{...missing,reason:'late change'})).decision.reason,missing.reason);
});

test('an older role capture without a cutoff-time inventory is inconclusive; a linked published minutes cap is already used',async()=>{
  const {db,raw,proposal,send,fixture}=setup();
  send({...proposal,target:'MINUTES_LIMIT'});
  assert.equal((await processPromptInbox(db))[0].reason,'DIAGNOSIS_CONTRADICTED_BY_JOURNAL');
  const p={after:{primary:{players:[{player_id:'53',team_id:'45',name:'Athlète 53',official_for_game:false}]}},facts:[],
    pair:{role_evidence_complete:true,known_roles:[{player_id:'53',team_id:'45',minutes_limit:24}]}};
  const v=raw.prepare("INSERT INTO max_forecast_versions(match_id,as_of,tip,integrated_at,payload) VALUES ('400003','2027-01-03T09:00:00.000Z','2027-01-03T20:00:00.000Z','2027-01-03T09:00:01.000Z',?)").run(JSON.stringify(p));
  send({...proposal,id:'no-role-research',action:'NO_PROMPT',prompt:null,targets:[],diagnosis:'ALREADY_USED',reason:'Le plafond était déjà documenté.',target:'MINUTES_LIMIT',evidence:[{match_id:'400003',player_id:'53',version_id:Number(v.lastInsertRowid),observation:'Plafond officiel annoncé de 24 minutes.'}]});
  assert.equal((await processPromptInbox(db))[0].evidence[0].classification,'ALREADY_USED');
  raw.prepare('INSERT INTO study_results VALUES(?,?,?,?)').run('400001','2027-01-03T20:00:00.000Z',1,JSON.stringify({at:'2027-01-03T09:00:00.000Z',observed_at:'2027-01-07T00:00:00.000Z',final_score:{home:110,away:100}}));
  send({...proposal,id:'future-result',evidence:[{...proposal.evidence[0],result_id:'400001'},proposal.evidence[1]]});
  assert.equal((await processPromptInbox(db))[0].reason,'EVIDENCE_RESULT_UNAVAILABLE');
});

test('an isolated collection defect needs a separate official pre-cutoff publication and an actually later pregame verification',async()=>{
  const {db,raw,proposal,send}=setup();
  const src='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2027-01-03_03_00AM.pdf';
  const checked_at='2027-01-03T11:00:00.000Z',match_id='400001';
  const rawReport={schema_version:'max-research-v1',match_id,generated_at:checked_at,
    sources:[{url:src,checked_at,kind:'OFFICIAL'}],verified_injuries:[{
      match_id,team_id:'45',player_id:'51',player:'Athlète 51',status:'OUT',event_start:'2027-01-03T20:00:00.000Z',source_url:src,checked_at}]};
  raw.prepare('INSERT INTO macfly_inbox(report_json) VALUES(?)').run(JSON.stringify(rawReport));
  send({...proposal,id:'single-assertion',evidence:[proposal.evidence[0]]});
  assert.match((await processPromptInbox(db))[0].reason,/REPEATED_OR_CORROBORATED/);
  const e={...proposal.evidence[0],missed_source:{receipt_id:1,source_url:src}};
  send({...proposal,id:'single-unrelated',evidence:[{...e,player_id:'52'}]});
  assert.equal((await processPromptInbox(db))[0].reason,'MISSED_SOURCE_NOT_CORROBORATED');
  send({...proposal,id:'single-verified',evidence:[e]});
  const [exp]=await processPromptInbox(db);
  assert.equal(exp.status,'ACTIVE');assert.equal(exp.evidence[0].missed_source.status,'OUT');
  assert.equal(exp.evidence[0].missed_source.published_at,'2027-01-03T08:00:00.000Z');
  assert.equal(exp.evidence[0].classification,'MISSING');
});
