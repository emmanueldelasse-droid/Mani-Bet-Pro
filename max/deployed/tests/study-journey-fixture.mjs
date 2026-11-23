// Synthetic game, league data and local D1 adapter used by the Worker journeys.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {contextForStudy} from '../study-runtime.mjs';

export function d1() {
  const sqlite=new DatabaseSync(':memory:');
  // Make SQLite's server clock advance with the deterministic Worker clock.
  sqlite.function('strftime',{deterministic:true},(format,value) => {
    const ms=value==='now'?Date.now():Date.parse(value);
    if(!Number.isFinite(ms))return null;
    if(format==='%s')return String(Math.floor(ms/1000));
    if(format==='%Y-%m-%dT%H:%M:%fZ')return new Date(ms).toISOString();
    throw Error('Unhandled test SQL time format: '+format);
  });
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=ON');
  const directory=new URL('../',import.meta.url);
  const schemaFiles=['research-journal.sql','market-study.sql','study-runtime.sql',
    ...readdirSync(directory).filter(name=>(name.startsWith('prompt-lab')||name.startsWith('published')||name==='odds-study.sql')&&name.endsWith('.sql')).sort(),'learning.sql','player-odds-coverage.sql'];
  for(const file of schemaFiles) sqlite.exec(readFileSync(new URL(file,directory),'utf8'));
  function statement(sql,args) {
    return {
      bind(...values){ return statement(sql,values); },
      all(){
        const results=sqlite.prepare(sql).all(...args);
        const {changes,last_row_id}=sqlite.prepare('SELECT changes() AS changes,last_insert_rowid() AS last_row_id').get();
        return {success:true,results,meta:{changes,last_row_id}};
      },
      first(column){
        const row=sqlite.prepare(sql).get(...args);
        return (column ? row?.[column] : row) ?? null;
      },
      run(){
        const {changes,lastInsertRowid}=sqlite.prepare(sql).run(...args);
        return {success:true,results:[],meta:{changes,last_row_id:lastInsertRowid}};
      }
    };
  }
  return {prepare(sql){return statement(sql,[]);},withSession(){return this;},batch(statements){
    sqlite.exec('BEGIN');
    try{const results=statements.map(s=>s.all());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
}

export const h=3600000, tip=Date.parse('2030-11-24T01:00:00Z'), iso=n=>new Date(n).toISOString();
export const source='https://official.nba.com/nba-injury-report-test/';
const oddsSource='https://www.winamax.fr/paris-sportifs/match/123456/';
export const teams=[{id:'10',name:'Équipe test domicile',score:null},{id:'20',name:'Équipe test visiteuse',score:null}];
export const g={id:'900000001',start:iso(tip),status:'STATUS_SCHEDULED',home:teams[0],away:teams[1],source:'ESPN scoreboard'};
export const players=Object.fromEntries(teams.map(team=>[team.id,Array.from({length:12},(_,i)=>({
  id:team.id+String(i+1).padStart(2,'0'),name:'Joueur '+team.id+' '+(i+1),
  minutes:20,points:i===0?24:i===1?13:i===2?4:8
}))]));
export function fixture(game = g) {
  const tip=Date.parse(game.start);
  const sourceAt=iso(tip-7*h);
  const rosters=new Map(teams.map(t=>[t.id,{team_id:t.id,checked_at:sourceAt,players:players[t.id].map(({id,name})=>({id,name}))}]));
  const boxes=Array.from({length:7},(_,i)=>({game_id:'80000000'+i,start:iso(tip-(i+1)*24*h),fetched_at:iso(tip-(i+1)*24*h+3*h),
    teams:Object.fromEntries(teams.map(t=>[t.id,{minutes:240,totals:{points:113},players:players[t.id]}]))}));
  const known={player:players['10'][1].name,team_id:'10',match_id:game.id,event_start:game.start,status:'OUT',
    source_url:source,published_at:sourceAt,checked_at:sourceAt};
  const medical={source_url:source,published_at:sourceAt,checked_at:sourceAt,teams:{
    home:{status:'SUBMITTED',players:[known]},away:{status:'SUBMITTED',players:[]}}};
  const forecast={status:'SIMULATED_UNCALIBRATED',probability_home:.58,projected_score:{home:115,away:110},
    interval_80:{home:[98,132],away:[93,127]}};
  return contextForStudy(game,sourceAt,'test-before-match',forecast,{home:[],away:[]},medical,boxes,rosters,null);
}
// The full collection object and the cached slate are independent in the deployed Worker.
export function fixtureState(games,slate={games}){
  const cards=new Map(games.map(game=>{
    const ctx=fixture(game);
    return [game.id,{...game,checked_at:ctx.sourceAt,official_medical:ctx.medical,injuries:ctx.injuries,
      independent_analysis:{advanced:{forecast:ctx.forecast,forecast_signature:ctx.signature}}}];
  }));
  return {async get(key){
    if(key==='max:slate:latest')return structuredClone(slate);
    const card=key.startsWith('max:game:')?cards.get(key.slice('max:game:'.length)):null;
    return card?structuredClone(card):null;
  }};
}

export function report(at,injuries,quote=false,game=g) {
  const checked_at=iso(at-60000);
  return {schema_version:'max-research-v1',match_id:game.id,generated_at:iso(at),summary:'Exemple synthétique de validation locale.',
    sources:[{url:source,title:'Bulletin fictif du test',kind:'OFFICIAL',published_at:iso(at-120000),checked_at},
      ...(quote?[{url:oddsSource,title:'Cote fictive du test',kind:'BOOKMAKER',checked_at}]:[])],
    verified_injuries:injuries.map(({n,status})=>({match_id:game.id,event_start:game.start,team_id:'10',
      player_id:players['10'][n].id,player:players['10'][n].name,source_url:source,status,checked_at})),
    verified_winamax_quotes:quote?[{verified:true,bookmaker:'Winamax',market:'MONEYLINE_OT',
      sourceUrl:oddsSource,observedAt:checked_at,gameId:game.id,homeTeamId:'10',awayTeamId:'20',homeOdds:2,awayOdds:1.8}]:[]};
}
