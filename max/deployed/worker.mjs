/**
 * ManiBetProMax standalone · NBA collection and analysis.
 * Aucune dépendance réseau, donnée, secret ou moteur vers ManiBetPro.
 * Sources directes ESPN ; une source non disponible reste INCONCLUSIVE.
 */
import {contextForStudy,refreshStudy,settleStudy,studySummary,gameStudy,overlaySlate,handleResearchQueue} from './study-runtime.mjs';
import {ENGINE_VERSION,parseESPNScoreboards,parseESPNInjuries,analyzeNBA,verifiedFinalGames} from './engine.mjs';
import {ADVANCED_VERSION,parseBoxscore,rotationAnalysis,forecastGame,evaluatePregame,summarizeEvaluations} from './advanced.mjs';
import {POINTS_VERSION,projectPlayerPoints,evaluatePlayerPoints,summarizePlayerPointsEvaluations} from './points.mjs';
import {SCHEDULER_VERSION,RESEARCH_MAX_AGE_MS,checkpointPhase,forecastInputSignature,canReuseForecast,researchPriority,agendaFromGames} from './scheduler.mjs';
import {cadenceMetadata,autoCollectionDue} from './cadence.mjs';
import {collectOfficial,officialForGame,collectRosters,rosterFilteredBoxes,reportTimestamp} from './collectors.mjs';
import {analyzeFailure} from './postmortem.mjs';
import {playerIdentity} from './identity.mjs';
import {composeReport} from './report.mjs';
import {TRIAL_VERSION,validateRoleFacts,rotationTrial,trialEvaluation,trialSummary} from './experiments.mjs';

const MAX_APP_HTML="<!doctype html>\n<html lang=\"fr\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><meta name=\"theme-color\" content=\"#091321\"><meta name=\"robots\" content=\"noindex,nofollow\">\n<title>ManiBetProMax — NBA Intelligence</title>\n<style>\n:root{color-scheme:dark;--bg:#091321;--panel:#111f32;--raised:#1a2b43;--line:#304359;--txt:#f1f6ff;--muted:#9cb0ca;--accent:#76b4ff;--cyan:#8ce5db;--warning:#ffd08a}\n*{box-sizing:border-box}body{font:14px/1.5 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:var(--txt);background:radial-gradient(circle at 70% -15%,#1c3a5c,#091321 55%);min-height:100dvh;margin:0}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}button[disabled]{opacity:.45;cursor:wait}a{color:var(--accent)}\n.shell{max-width:1120px;margin:auto;padding:20px 18px 72px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 23px}.brand{display:flex;align-items:center;gap:10px}.mark{width:42px;height:42px;background:linear-gradient(135deg,#3a7de2,#75d9df);color:#081321;border-radius:13px;display:grid;place-items:center;font-weight:900;font-size:24px}.brand b{display:block;font-size:19px;letter-spacing:-.5px}.brand small{font-size:10px;letter-spacing:1.6px;color:var(--muted);font-weight:700}.btn{background:#223954;border:1px solid #3c5672;color:var(--txt);border-radius:11px;padding:9px 13px;font-weight:700}.btn:hover{background:#2e4a6a}\n.headline{background:linear-gradient(125deg,#162d4a,#111f32);border:1px solid var(--line);padding:24px;border-radius:20px;margin-bottom:22px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:1.4px;color:var(--cyan);text-transform:uppercase}.headline h1{font-size:clamp(26px,4.5vw,38px);letter-spacing:-1.3px;line-height:1.15;margin:8px 0}.subtitle{color:var(--muted);max-width:680px}.quick{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.quick span{background:#1c3852;border-radius:8px;padding:7px 10px;color:#cbdcf3;font-size:12px}\n.sectionhead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:13px}.sectionhead h2{font-size:21px;margin:0;letter-spacing:-.5px}.tiny{color:var(--muted);font-size:12px}.filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}.filter{border:1px solid var(--line);background:#17263a;border-radius:999px;color:var(--muted);padding:7px 11px}.filter.active{background:#234d7c;border-color:#5688bd;color:#fff}\n.games{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.game{border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:17px;min-width:0}.gameTop{display:flex;justify-content:space-between;align-items:center;gap:9px;color:var(--muted);font-size:12px;margin-bottom:14px}.chip{border:1px solid #3b587b;color:#bcd6f8;background:#1c334e;border-radius:999px;font-size:10px;font-weight:800;padding:4px 8px}.chip.alert{background:#48351f;color:#fbdca2;border-color:#816040}.teams{display:flex;justify-content:space-between;gap:6px;align-items:center}.teams strong{font-size:16px;line-height:1.15;overflow-wrap:anywhere}.teams .versus{color:var(--muted);font-size:11px}.teamSide{flex:1;min-width:0}.teamSide.right{text-align:right}.teamSide small{display:block;font-size:11px;color:var(--muted);margin-top:5px}.forecastLine{border-top:1px solid var(--line);margin-top:14px;padding-top:12px}.projected{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.projected b{font-size:20px}.projected span{font-size:12px;color:var(--muted)}.probbar{height:8px;border-radius:20px;background:#485976;overflow:hidden;margin:9px 0}.probbar span{display:block;height:100%;background:linear-gradient(90deg,#81ddcf,#5ca1ff)}.gameBottom{display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:8px}.gameBottom .tiny{min-width:0}.go{border:0;background:#347bd2;color:white;border-radius:10px;padding:9px 12px;font-weight:800;white-space:nowrap}.go:hover{background:#438add}\n.panel{border:1px solid var(--line);background:var(--panel);border-radius:17px;padding:18px;margin:14px 0}.muted{color:var(--muted)}.back{background:none;border:0;color:var(--accent);font-weight:800;padding:8px 0;margin:0 0 8px}.detailHeading{font-size:25px;line-height:1.2;letter-spacing:-.8px;margin:6px 0}.detailHero{padding:22px;background:linear-gradient(120deg,#152f4e,#142238);border-radius:20px;border:1px solid #3b5270}.matchMeta{display:flex;justify-content:space-between;align-items:center;gap:10px}.bigGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:17px}.numberTile{background:#14243c;border:1px solid var(--line);border-radius:14px;padding:15px;text-align:center}.numberTile b{display:block;font-size:clamp(27px,5vw,42px);letter-spacing:-1.2px;line-height:1.18}.numberTile small{font-size:12px;color:var(--muted)}.totalTile{text-align:center;border:1px solid #3c6084;border-radius:13px;background:#143453;padding:13px;margin-top:12px}.totalTile b{font-size:26px;letter-spacing:-.6px}.totalTile small{display:block;color:var(--muted)}\n.note{border-left:3px solid #e2af67;padding:9px 12px;background:#352b2252;border-radius:0 9px 9px 0;color:#eed4af;font-size:12px;margin:12px 0 0}.tabs{display:flex;gap:5px;overflow-x:auto;margin:16px 0 0;padding-bottom:5px}.tab{flex:1;min-width:88px;border:1px solid var(--line);border-radius:10px;background:#15263d;color:var(--muted);padding:10px 8px;font-weight:800}.tab.active{color:#fefefe;background:#285481;border-color:#5087c0}.tabContent{margin-top:10px}.sectionTitle{font-size:17px;margin:0 0 10px}.summaryText{line-height:1.65;color:#dbe5f2}.risk{padding:9px 12px;background:#1b3048;border-radius:9px;margin:6px 0;font-size:13px;color:#dce7f7}.metricGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.metricTile{background:#1a2c42;border-radius:12px;padding:13px;border:1px solid #30465c}.metricTile small{display:block;color:var(--muted);font-size:11px}.metricTile b{display:block;font-size:22px}.metricTile em{font-style:normal;color:var(--muted);font-size:11px}\n.playerTeam{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:15px 0 10px}.playerTeam h3{font-size:17px;margin:0}.playerList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.player{border:1px solid var(--line);border-radius:12px;padding:12px;background:#16263d}.playerHead{display:flex;align-items:flex-start;justify-content:space-between;gap:9px}.playerHead strong{font-size:14px;line-height:1.15}.playerHead b{font-size:23px;line-height:1.0;white-space:nowrap}.playerHead small{display:block;color:var(--muted);font-weight:500;font-size:11px;margin-top:5px}.playerDetails{font-size:11px;color:#b5c7db;margin-top:9px}.playerFoot{font-size:11px;color:var(--warning);margin-top:6px}.scarce{border:1px dashed #50627a;color:var(--muted);padding:14px;border-radius:12px;font-size:13px}.rowInfo{display:flex;justify-content:space-between;border-bottom:1px solid #2b4056;padding:8px 0;gap:12px}.rowInfo span{color:var(--muted)}.rowInfo b{text-align:right}.expert details{border-top:1px solid var(--line);padding:10px 0}.expert summary{cursor:pointer;font-weight:750;color:#bed8fa}.expert p{line-height:1.5;font-size:12px;color:#cbd8e9;margin-top:8px}.sources a{display:block;overflow-wrap:anywhere;font-size:12px;margin:8px 0}.empty{padding:22px;border-radius:14px;border:1px dashed #415571;background:#122033;color:var(--muted)}.metricsDetails{margin:28px 0;border:1px solid var(--line);padding:13px 16px;background:#112137;border-radius:12px}.metricsDetails summary{font-weight:800;cursor:pointer}.metricsDetails p{margin:9px 0;font-size:12px;color:var(--muted)}.footer{margin-top:25px;padding-top:15px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}\n[hidden]{display:none!important}\n@media(max-width:720px){.shell{padding:14px 12px 60px}.top{margin-bottom:16px}.brand b{font-size:16px}.brand small{font-size:9px}.mark{height:37px;width:37px}.headline{padding:19px}.games,.playerList{grid-template-columns:1fr}.game{padding:15px}.detailHero{padding:16px}.numberTile{padding:13px 8px}.bigGrid{gap:8px}.tabs{gap:4px}.tab{min-width:76px;padding:10px 5px;font-size:12px}.metricGrid{gap:8px}}\n@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}\n\n/* Read the match first; reveal the technical evidence on demand. */\nbody{font-size:16px}.btn,.go,.filter,.tab{min-height:44px}.tabs{gap:8px;overflow:visible}.tab{min-width:0}.tabContent{min-width:0}\n.verdict{border:1px solid #537ca1;background:linear-gradient(120deg,#193d53,#172b44);border-radius:17px;padding:20px;margin:14px 0}.verdict h2{font-size:27px;line-height:1.2;margin:7px 0;overflow-wrap:anywhere}.verdict p{margin:8px 0}.verdictTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.chance{font-size:28px;font-weight:850;white-space:nowrap}.chance small{display:block;font-size:12px;font-weight:500;color:var(--muted)}.verdict .probbar{margin:15px 0 8px;height:9px}.chanceLabels{display:flex;justify-content:space-between;gap:12px;font-size:13px}.chanceLabels span{flex:1;overflow-wrap:anywhere}.chanceLabels span:last-child{text-align:right}\n.factList{padding-left:20px;margin:8px 0}.factList li{padding:5px 0;color:#dbe5f2;line-height:1.6}.readingNote{font-size:13px;color:var(--muted);line-height:1.6;margin:12px 0 0}.readingNote strong{color:var(--warning)}\n.statsHead,.statValues{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.statsHead{padding-bottom:10px;text-align:center;font-weight:750}.statLine{border-top:1px solid var(--line);padding:15px 0}.statLine h3{font-size:16px;margin:0 0 3px}.statLine p{font-size:13px;color:var(--muted);margin:0 0 10px}.statValues span{background:var(--raised);padding:10px;border-radius:9px;text-align:center;font-size:20px;font-weight:800}.statValues small{display:block;font-size:12px;font-weight:500;color:var(--muted)}.statLine .statRead{font-size:13px;margin:9px 0 0;color:#dbe5f2}.periods{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.periods button{flex:1;min-width:70px}.fold{margin:14px 0;border:1px solid var(--line);border-radius:13px;padding:0 15px;background:#102036}.fold>summary{min-height:48px;display:flex;align-items:center;gap:9px;font-weight:750;cursor:pointer;font-size:14px}.fold>summary:before{content:'+';color:var(--accent)}.fold[open]>summary:before{content:'−'}.fold .panel{border:0;padding:6px 0;margin:0;background:transparent}.fold .sources{padding-bottom:10px}.fold .rowInfo{font-size:13px}.fold>p{font-size:14px}.rowInfo>*{min-width:0;overflow-wrap:anywhere}.tiny{line-height:1.6}.sources a{min-height:44px;display:flex;align-items:center}.topPlayersLink{margin-top:14px}\n@media(max-width:720px){.tabs{gap:6px}.tab{font-size:12px;padding:10px 4px}.panel{padding:16px}.verdict{padding:17px}.verdict h2{font-size:25px}.chance{font-size:26px}.statsHead{font-size:14px}.statValues span{font-size:22px}.rowInfo b{max-width:60%}}\n\n/* Approved homepage match card, connected to the current game. */\n\n.match-card{--mb-bg:light-dark(#edf2f8,#0b1524);--mb-card:light-dark(#ffffff,#121f32);--mb-raised:light-dark(#f0f5fa,#1b3048);--mb-ink:light-dark(#12243a,#f0f5ff);--mb-soft:light-dark(#4c6079,#a6b8cf);--mb-line:light-dark(#d5dfeb,#30465e);--mb-accent:light-dark(#126b82,#8ce5db);--mb-blue:light-dark(#2368b7,#76b4ff);--mb-amber:light-dark(#785015,#ffd08a);--mb-amber-bg:light-dark(#fff4de,#342c22);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;font-size:14px;line-height:1.5;color:var(--mb-ink);padding:0;box-sizing:border-box}\n.match-card *{box-sizing:border-box}.match-card .mb-preview{max-width:438px;margin:0 auto}.match-card .mb-caption{color:var(--mb-soft);font-size:12px;margin:0 0 12px;padding-right:75px}.match-card .mb-card{background:var(--mb-card);border:1px solid var(--mb-line);border-radius:22px;overflow:hidden;box-shadow:0 12px 36px color-mix(in srgb,var(--mb-ink) 8%,transparent)}\n.match-card .mb-body{padding:18px}.match-card .mb-meta{display:flex;gap:8px;justify-content:space-between;align-items:center;color:var(--mb-soft);font-size:12px}.match-card .mb-date{font-weight:650;letter-spacing:.5px;color:var(--mb-accent)}.match-card .mb-pill{padding:4px 8px;background:var(--mb-raised);border-radius:6px;white-space:nowrap;font-size:11px;font-weight:650}\n.match-card .mb-teams{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;margin:19px 0 17px}.match-card .mb-team:last-child{text-align:right}.match-card .mb-team h3{font-size:18px;line-height:1.2;letter-spacing:-.4px;margin:4px 0 6px;font-weight:750}.match-card .mb-team small{font-size:11px;color:var(--mb-soft)}.match-card .mb-vs{font-size:11px;color:var(--mb-soft)}.match-card .mb-score{font-size:30px;line-height:1;font-weight:750;letter-spacing:-1px;font-variant-numeric:tabular-nums}.match-card .mb-score-label{font-size:11px;color:var(--mb-soft);text-align:center;margin-top:8px}\n.match-card .mb-favorite{border-radius:13px;background:var(--mb-raised);padding:13px 14px}.match-card .mb-fav-line{display:flex;align-items:center;justify-content:space-between;gap:10px}.match-card .mb-overline{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--mb-soft);font-weight:700}.match-card .mb-favorite strong{display:block;font-size:18px;letter-spacing:-.3px}.match-card .mb-chance{font-size:25px;font-weight:750;font-variant-numeric:tabular-nums}.match-card .mb-tendency{font-size:12px;color:var(--mb-amber);margin-top:2px}.match-card .mb-bar{height:5px;border-radius:8px;background:color-mix(in srgb,var(--mb-soft) 22%,transparent);margin-top:11px;overflow:hidden}.match-card .mb-bar span{display:block;height:100%;width:0;background:var(--mb-accent)}\n.match-card .mb-total{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid var(--mb-line)}.match-card .mb-total strong{font-size:23px;letter-spacing:-.6px;font-variant-numeric:tabular-nums}.match-card .mb-total small{display:block;color:var(--mb-soft);font-size:11px}.match-card .mb-total>div:last-child{text-align:right}.match-card .mb-total b{font-size:14px;font-weight:650}\n.match-card .mb-section-label{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:15px 0 8px;font-size:12px;font-weight:700}.match-card .mb-section-label span{font-weight:400;font-size:11px;color:var(--mb-soft)}.match-card .mb-stat-head,.match-card .mb-stat{display:grid;grid-template-columns:minmax(0,1fr) 53px 53px;gap:10px;font-size:12px;align-items:center}.match-card .mb-stat-head{color:var(--mb-soft);font-size:10px;margin-bottom:4px}.match-card .mb-stat{padding:6px 0}.match-card .mb-stat small{display:block;color:var(--mb-soft);font-size:10px}.match-card .mb-stat b,.match-card .mb-stat-head b{text-align:right;font-variant-numeric:tabular-nums;font-weight:650}\n.match-card .mb-players{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}.match-card .mb-player{padding:10px 8px;border-radius:10px;background:var(--mb-raised);min-width:0}.match-card .mb-player strong{display:block;font-size:20px;font-variant-numeric:tabular-nums}.match-card .mb-player strong small{font-size:10px;font-weight:400}.match-card .mb-player>span{display:block;font-size:11px;font-weight:650;overflow-wrap:anywhere}.match-card .mb-player>small{display:block;font-size:10px;color:var(--mb-soft)}\n.match-card .mb-alert{background:var(--mb-amber-bg);border-radius:10px;margin-top:14px;padding:10px 12px;font-size:12px}.match-card .mb-alert strong{font-size:11px;display:block;color:var(--mb-amber);margin-bottom:3px}.match-card .mb-alert p{margin:2px 0}.match-card .mb-alert small{color:var(--mb-soft);font-size:11px}\n.match-card .mb-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;font-size:10px;color:var(--mb-soft)}.match-card .mb-source{display:flex;align-items:center;gap:5px}.match-card .mb-dot{height:6px;width:6px;border-radius:50%;background:var(--mb-accent);display:inline-block}.match-card .mb-caution{font-size:10px;color:var(--mb-soft);margin:7px 0 0}\n.match-card button{width:100%;border:0;background:var(--mb-blue);color:light-dark(#ffffff,#081a30);padding:13px 15px;border-radius:11px;font:650 14px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;min-height:46px;margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:12px}.match-card button:focus-visible{outline:3px solid var(--mb-accent);outline-offset:3px}.match-card .mb-extra{margin-top:12px;padding-top:12px;border-top:1px solid var(--mb-line);font-size:12px;color:var(--mb-soft)}.match-card .mb-extra p{margin:5px 0}.match-card [hidden]{display:none!important}\n@media(max-width:360px){.match-card .mb-body{padding:14px}.match-card .mb-teams{gap:9px}.match-card .mb-team h3{font-size:16px}.match-card .mb-stat-head,.match-card .mb-stat{grid-template-columns:minmax(0,1fr) 43px 43px;gap:6px}}\n\n.game.match-card{padding:0;background:var(--mb-card);border:1px solid var(--mb-line);border-radius:22px;overflow:hidden;min-width:0;box-shadow:0 12px 36px color-mix(in srgb,var(--mb-ink) 8%,transparent)}\n.games{align-items:start}.top .brand{min-width:0}.top .brand>div:last-child{min-width:0}.top .brand b{overflow-wrap:anywhere}.top>.btn{flex-shrink:0}.match-card .mb-team,.match-card .mb-fav-line>div{min-width:0}.match-card .mb-team h3,.match-card .mb-favorite strong{overflow-wrap:anywhere}.match-card .mb-favorite strong{line-height:1.3}.match-card .mb-fav-line .mb-chance{white-space:nowrap;flex-shrink:0}.match-card .mb-section-label{flex-wrap:wrap}.match-card .mb-stat-head b{overflow-wrap:anywhere}.match-card .mb-player strong{white-space:nowrap}.match-card .mb-alert p{overflow-wrap:anywhere}.match-card .mb-player>small{overflow-wrap:anywhere}.match-card button{cursor:pointer}.match-card .mb-player-uncertain{color:var(--mb-amber)!important}\n\n.match-card .mb-teams{align-items:start;grid-template-rows:auto auto auto;row-gap:4px}.match-card .mb-team{display:grid;grid-template-rows:subgrid;grid-row:1 / span 3;align-items:start}.match-card .mb-team:first-child{grid-column:1}.match-card .mb-team:last-child{grid-column:3}.match-card .mb-team h3{margin:0}.match-card .mb-vs{grid-column:2;grid-row:2;align-self:center}\n.match-card .mb-primary{margin:12px 0 0;padding:12px 14px;background:var(--mb-raised);border-radius:12px}\n.match-card .mb-primary small,.match-card .mb-scoreline small,.match-card .mb-player-row small,.match-card .mb-label small,.match-card .mb-muted,.match-card .mb-details small{color:var(--mb-soft)}\n.match-card .mb-title{font-size:17px;line-height:1.3;margin:9px 0;color:var(--mb-ink);overflow-wrap:anywhere}.mb-title span{color:var(--mb-soft)}\n.mb-lead{display:flex;align-items:baseline;justify-content:space-between;gap:9px;line-height:1.2}\n.mb-lead strong{font-size:22px;overflow-wrap:anywhere}.mb-lead>b{color:var(--mb-accent);font-size:23px;white-space:nowrap}\n.match-card .mb-projection{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(0,1fr);gap:10px;border-bottom:1px solid var(--mb-line);padding:13px 0}\n.match-card .mb-scoreline{display:flex;flex-direction:column;justify-content:flex-end;gap:1px}.mb-scoreline span{font-size:17px;font-weight:750;line-height:1.25;overflow-wrap:anywhere}.mb-scoreline:last-child{text-align:right}.mb-scoreline small,.mb-label small,.mb-player-row small{font-size:12px}\n.mb-result{color:var(--mb-accent);font-size:14px}.mb-label{font-size:14px;margin:12px 0 5px}.mb-label small{font-weight:400}\n.mb-player-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:baseline;line-height:1.35;padding:4px 0;font-size:14px}.mb-player-row span{overflow-wrap:anywhere}.mb-player-row strong,.mb-player-row>small{white-space:nowrap;font-variant-numeric:tabular-nums}\n.match-card .mb-condition,.match-card .mb-impact,.match-card .mb-muted{font-size:13px;line-height:1.45;margin:9px 0}.mb-condition{color:var(--mb-amber)}\n.match-card .mb-impact{border-left:2px solid var(--mb-accent);padding:4px 0 4px 10px}.mb-impact p{margin:3px 0}.mb-impact time{color:var(--mb-soft);display:block;font-size:11px}\n.mb-journal{border-top:1px solid var(--mb-line);padding-top:8px}.mb-journal p{margin:5px 0 10px}.mb-journal small{display:block}\n.mb-details{margin-top:12px;border-top:1px solid var(--mb-line);font-size:13px;overflow-wrap:anywhere}.mb-details summary,.study-wrap>summary{cursor:pointer;font-weight:700;min-height:44px;align-content:center}.mb-details a{color:var(--mb-blue)}\n.study-wrap{margin:14px 0;border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:0 14px}\n#study-content{font-size:14px;padding-bottom:10px}.study-item{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:6px 0}.study-item b{text-align:right}.study-table{width:100%;border-collapse:collapse;font-size:13px}.study-table th,.study-table td{padding:6px 3px;text-align:right;border-bottom:1px solid var(--line)}.study-table th:first-child{text-align:left;font-weight:inherit}\n</style></head>\n<body><div class=\"shell\">\n<header class=\"top\"><div class=\"brand\"><div class=\"mark\">M</div><div><b>ManiBetProMax</b><small>NBA INTELLIGENCE</small></div></div><button class=\"btn\" id=\"refresh\">Actualiser</button></header>\n<section id=\"overview\">\n <div class=\"headline\"><div class=\"eyebrow\">MacFly + moteur statistique indépendant</div><h1>Qui est favori ? Combien de points ?</h1><p class=\"subtitle\">Le favori estimé, les points attendus et les informations qui peuvent changer le match.</p><div class=\"quick\"><span id=\"lastCollect\">Collecte : —</span><span id=\"coverage\">Données joueurs : —</span><span id=\"research\">MacFly : —</span></div></div>\n <div class=\"sectionhead\"><div><h2>Matchs NBA</h2><div class=\"tiny\" id=\"gameCount\">Chargement…</div></div></div>\n <details class=\"study-wrap\" id=\"study-wrap\"><summary>Bilan sportif et simulation Winamax</summary><div id=\"study-content\" aria-live=\"polite\"></div></details>\n <div class=\"filters\" role=\"group\" aria-label=\"Filtrer les matchs\"><button class=\"filter\" data-filter=\"upcoming\">À venir</button><button class=\"filter\" data-filter=\"today\">Aujourd’hui</button><button class=\"filter\" data-filter=\"tomorrow\">Demain</button><button class=\"filter\" data-filter=\"all\">Tous</button></div>\n <main id=\"games\" class=\"games\" aria-live=\"polite\"><div class=\"empty\">Chargement des rencontres NBA…</div></main>\n</section>\n<section id=\"detail\" hidden><button class=\"back\" id=\"back\">← Tous les matchs</button><div id=\"matchView\"></div></section>\n<details class=\"metricsDetails\" id=\"metricsWrap\"><summary>Fiabilité des prévisions et état des données</summary><div id=\"metrics\" class=\"tiny\">Chargement des contrôles…</div></details>\n<footer class=\"footer\">Analyse NBA expérimentale. Les prévisions ne sont pas des certitudes. Sources horodatées, aucune API payante, aucun lien de données avec ManiBetPro.</footer>\n</div>\n<script>\n'use strict';\nconst $=id=>document.getElementById(id);\nconst esc=v=>String(v??'—').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\"':'&quot;',\"'\":'&#39;'}[c]));\nconst local=t=>t?new Date(t).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'—';\nconst parisDay=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));\nconst percent=v=>Number.isFinite(v)?(100*v).toLocaleString('fr-FR',{maximumFractionDigits:1})+' %':'—';\nconst score=v=>Number.isFinite(v)?Math.round(v).toLocaleString('fr-FR'):'—';\nconst statStatus=g=>{const s=String(g.status||'');return s.includes('FINAL')?'Terminé':s.includes('IN_PROGRESS')||s.includes('HALFTIME')?'En direct':s.includes('POSTPONED')?'Reporté':'À venir'};\nconst forecast=g=>g.independent_analysis?.advanced?.forecast??null;\nconst playerPoints=g=>g.independent_analysis?.advanced?.player_points??null;\nconst usable=f=>f?.status==='SIMULATED_UNCALIBRATED'&&Number.isFinite(f.projected_score?.home)&&Number.isFinite(f.projected_score?.away);\nconst total=f=>usable(f)?f.projected_score.home+f.projected_score.away:null;\nlet state={games:[],health:null,metrics:null,playerMetrics:null,research_count:0,updated_at:null,filter:'upcoming',tab:'resume',statsWindow:10,historyCache:{}};\nfunction matchId(){const h=location.hash||'';const m=h.match(/^#match-(\\d{5,15})$/);return m?m[1]:null}\nfunction cardMedical(g){\n const report=g.official_medical,published=Date.parse(report?.published_at??'');\n const recent=Number.isFinite(published)&&published<=Date.now()&&Date.now()-published<=12*3600000;\n const players=playerPoints(g),priority=name=>Math.max(0,...['away','home'].flatMap(side=>(players?.[side]?.players??[]).filter(p=>p.name===name).map(p=>p.projected_minutes_if_active??0)));\n const alerts=[];\n const teams=['away','home'].map(side=>{\n  const team=report?.teams?.[side],label=g[side].abbreviation??g[side].name;\n  if(recent&&team?.status==='SUBMITTED'){\n   for(const p of team.players??[])if(['OUT','QUESTIONABLE','DOUBTFUL','LIMITED'].includes(p.status))alerts.push(p);\n   return label+' : bulletin reçu';\n  }\n  return label+' : bulletin attendu';\n });\n alerts.sort((a,b)=>priority(b.player)-priority(a.player));\n const status={OUT:'absent',QUESTIONABLE:'incertain',DOUBTFUL:'peu probable',LIMITED:'minutes limitées'};\n return {text:alerts.slice(0,2).map(p=>p.player+' '+status[p.status]).join(' · ')||\n  (recent&&['away','home'].every(side=>report.teams?.[side]?.status==='SUBMITTED')?'Aucune absence signalée dans ce bulletin.':'Confirmations médicales encore attendues.'),teams:teams.join(' · '),recent};\n}\nconst numberFr=(value,digits=1)=>Number.isFinite(value)?value.toLocaleString('fr-FR',{maximumFractionDigits:digits}):'—';\nconst playerMinutes=p=>p?.projected_minutes_if_active??p?.minutes_if_active??p?.minutes;\nconst playerScore=p=>p?.availability==='OFFICIAL_OUT'||p?.status==='OUT'?0:p?.predicted_points_if_active??p?.points_if_active??p?.points;\nconst gameLabel=(g,side)=>g[side]?.abbreviation??g[side]?.name??'';\nfunction sourceLink(url,title){\n try{\n  const parsed=new URL(url);\n  if(parsed.protocol!=='https:')return '';\n  return '<a target=\"_blank\" rel=\"noopener noreferrer\" href=\"'+esc(parsed.href)+'\">'+esc(title||parsed.hostname)+'</a>';\n }catch{return ''}\n}\nconst effectLabels={ALREADY_KNOWN:'Déjà pris en compte',APPLIED:'Pris en compte',SUPERSEDED:'Remplacé par un relevé plus récent',UNMATCHED_PLAYER:'Joueur non identifié avec certitude',CONTEXT_ONLY:'Contexte uniquement'};\nconst kindLabels={INJURY:'Blessure',ROTATION:'Rotation',ROLE:'Rôle',MINUTES_LIMIT:'Limite de minutes',AVAILABILITY:'Disponibilité',RESEARCH:'Rapport',CONTEXT:'Contexte'};\nfunction factText(f){\n const detail=[];\n if(f.status)detail.push(medicalStatus(f.status).toLowerCase());\n if(Number.isFinite(f.minutes_limit))detail.push('limite de '+numberFr(f.minutes_limit)+' min');\n if(typeof f.starter==='boolean')detail.push(f.starter?'titulaire':'remplaçant');\n const label=f.player||kindLabels[String(f.kind).toUpperCase()]||'Information MacFly';\n return label+(detail.length?' · '+detail.join(', '):'');\n}\nfunction revisionView(version,key){\n if(!version)return null;\n if(version.primary||version.challenger||version.variant)return key==='primary'?version.primary:version.challenger??version.variant;\n return key==='primary'?version:null;\n}\nfunction oneChange(before,after,unit,digits=1,scale=1){\n if(!Number.isFinite(before)||!Number.isFinite(after)||Math.round(before*scale*10**digits)===Math.round(after*scale*10**digits))return '';\n return numberFr(before*scale,digits)+' → '+numberFr(after*scale,digits)+' '+unit;\n}\nfunction revisionDelta(revision,g){\n const output=[];\n for(const [key,label] of [['primary','Principal'],['challenger','Variante']]){\n  const b=revisionView(revision.before,key),a=revisionView(revision.after,key);\n  if(!b||!a)continue;\n  const bf=b.forecast??b,af=a.forecast??a;\n  const sum=f=>f.total??(Number.isFinite(f.projected_score?.home)&&Number.isFinite(f.projected_score?.away)?f.projected_score.home+f.projected_score.away:null);\n  const prob=oneChange(bf.probability_home,af.probability_home,'%',1,100);\n  const points=oneChange(sum(bf),sum(af),'pts');\n  if(prob)output.push(label+' · victoire '+gameLabel(g,'home')+' '+prob);\n  if(points)output.push(label+' · total '+points);\n  const rows=v=>v.players??['away','home'].flatMap(s=>v.player_points?.[s]?.players??[]);\n  const playerKey=p=>String(p.team_id??'')+'|'+String(p.id??p.player_id??'');\n  const prev=new Map(rows(b).filter(p=>p.id||p.player_id).map(p=>[playerKey(p),p]));\n  for(const p of rows(a)){\n   const old=prev.get(playerKey(p));\n   if(!old)continue;\n   const min=oneChange(playerMinutes(old),playerMinutes(p),'min');\n   const pts=oneChange(playerScore(old),playerScore(p),'pts');\n   if(min||pts)output.push(label+' · '+p.name+' '+[min,pts].filter(Boolean).join(', '));\n  }\n }\n return output;\n}\nfunction impactView(g){\n const last=g.study?.last_impact;\n const newest=g.study?.revision;\n const r=last??newest;\n if(!r)return '<p class=\"mb-muted\">Aucune révision MacFly enregistrée pour ce match.</p>';\n const changes=Array.isArray(r.changes)?r.changes:[];\n const at=r.integrated_at??r.at;\n const known=changes.length&&changes.every(f=>f.effect==='ALREADY_KNOWN');\n const controlled=r.without_macfly?{...r,before:r.without_macfly}:null;\n const deltas=revisionDelta(controlled??r,g);\n const facts=changes.slice(0,2).map(factText).join(' · ')+(changes.length>2?' · +'+(changes.length-2):'');\n const title=known?'Information déjà connue':changes.length>1?'Mise à jour groupée':last?'Dernière information avec effet':'Dernière mise à jour';\n const more=newest&&last&&String(newest.group_id)!==String(last.group_id)&&Array.isArray(newest.changes)&&newest.changes.length&&newest.changes.every(f=>f.effect==='ALREADY_KNOWN')?'<small>Dernière vérification · information déjà connue ('+esc(local(newest.integrated_at??newest.at))+').</small>':'';\n const changesText=deltas.length?deltas.slice(0,2).map(esc).join('<br>'):known?'Le moteur l’avait déjà intégrée avant cette vérification.':r.changed===false?'Aucun changement chiffré.':'Effet chiffré indisponible.';\n return '<div class=\"mb-impact\"><strong>'+esc(title)+'</strong>'+(at?'<time>'+esc(local(at))+'</time>':'')+(facts?'<p>'+esc(facts)+'</p>':'')+'<p>'+(deltas.length?(controlled?'Effet à données identiques · ':'Évolution observée · '):'')+changesText+'</p>'+more+'</div>';\n}\nfunction revisionDetails(r,g){\n const facts=Array.isArray(r.changes)?r.changes:[];\n const deltas=revisionDelta(r,g);\n const controlled=r.without_macfly?revisionDelta({...r,before:r.without_macfly},g):[];\n const at=r.integrated_at??r.at;\n return '<section class=\"mb-journal\"><strong>'+esc(at?local(at):'Heure inconnue')+'</strong>'+\n (facts.length>1?' · '+facts.length+' informations traitées ensemble':'')+\n facts.map(f=>'<p><b>'+esc(factText(f))+'</b>'+(effectLabels[f.effect]?' · '+esc(effectLabels[f.effect]):'')+\n '<br>'+sourceLink(f.source_url,f.source_title)+'<small>Publication '+(f.published_at?esc(local(f.published_at)):'inconnue')+\n ' · Vérification '+esc(local(f.checked_at))+' · Réception '+esc(local(f.received_at))+' · Intégration '+esc(local(f.integrated_at??at))+'</small></p>').join('')+\n (deltas.length?'<p><b>Depuis la prévision précédente</b><br>'+deltas.map(esc).join('<br>')+'</p>':'')+\n (r.attribution==='MIXED_INPUTS'?'<p>D’autres données ont aussi changé entre ces deux prévisions.</p>':'')+\n (controlled.length?'<p><b>Effet du rapport, autres données identiques</b><br>'+controlled.map(esc).join('<br>')+'</p>':'')+'</section>';\n}\nfunction journalSources(g){\n const report=g.research??g.ai_review,automatic=g.automatic_report;\n const sources=[...(report?.sources??[]),...(automatic?.sources??[])];\n const links=new Map();\n for(const s of sources){\n  const link=sourceLink(s.url,s.title);\n  if(link&&!links.has(s.url))links.set(s.url,'<div>'+link+(s.checked_at?' · '+esc(local(s.checked_at)):'')+'</div>');\n }\n return links.size?Array.from(links.values()).join(''):'<p>Source supplémentaire indisponible.</p>';\n}\nfunction marketLine(g){\n const d=g.study?.decision;\n if(!d)return '<p class=\"mb-muted\">Aucune décision simulée enregistrée pour ce match.</p>';\n if(!d.quote)return '<p class=\"mb-muted\">Rendement non évaluable · aucune cote Winamax vérifiée disponible pour cette décision.</p>';\n const q=d.quote;\n const odds=(side)=>gameLabel(g,side)+' '+numberFr(q[side+'Odds'],2);\n return '<p><b>'+esc(d.label)+'</b>'+(d.selected?' · '+esc(gameLabel(g,d.prediction))+' à '+numberFr(d.selectionOdds,2)+' · 1 unité virtuelle':'')+'</p>'+\n '<p>Winamax · Vainqueur du match, prolongations incluses · '+esc(local(q.observedAt))+'<br>'+esc(odds('away')+' / '+odds('home'))+' · '+sourceLink(q.sourceUrl,'Voir le relevé')+'</p>';\n}\nfunction cardForecast(g){\n const actual=statStatus(g)==='Terminé'||statStatus(g)==='En direct';\n const r=matchReading(g),snap=g.study?.pair?.primary;\n const eligible=snap&&Number.isFinite(Date.parse(snap.at))&&Date.parse(snap.at)<Date.parse(g.start)&&Date.parse(snap.at)<=Date.now();\n const f=eligible?snap.forecast:forecast(g);\n const p=f?.probability_home,sa=f?.projected_score?.away,sh=f?.projected_score?.home;\n const usable=Number.isFinite(p)&&p>=0&&p<=1&&Number.isFinite(sa)&&Number.isFinite(sh)&&\n   (eligible?(actual||r.pre&&Date.now()-Date.parse(snap.at)<=8*3600000):r.valid);\n const ranked=['away','home'].flatMap(side=>{\n  const source=eligible?snap.player_points:playerPoints(g);\n  return (source?.[side]?.players??[]).map(player=>({...player,side}));\n }).filter(player=>player.availability!=='OFFICIAL_OUT'&&player.status!=='OUT'&&Number.isFinite(playerScore(player)))\n .sort((a,b)=>playerScore(b)-playerScore(a));\n return {usable,ranked,f,actual,eligible,at:eligible?snap.at:g.checked_at};\n}\nfunction gameCard(g,asDetail=false){\n const {usable,ranked,f,actual,eligible,at}=cardForecast(g),home=g.home,away=g.away;\n const p=usable?f.probability_home:null,side=p>=.5?'home':'away',chance=usable?Math.max(p,1-p):null;\n const open=usable&&chance<.55;\n const sub='Vainqueur probable';\n const title=usable?(open?'Match très ouvert':g[side].name):actual?'Prévision figée indisponible':'Estimation indisponible';\n const top='<div class=\"mb-primary\"><div class=\"mb-overline\">'+esc(usable&&actual?'Prévision avant match':sub)+'</div><div class=\"mb-lead\"><strong>'+esc(title)+'</strong>'+\n (usable&&!open?'<b>'+esc(percent(chance))+'</b>':'')+'</div>'+(open?'<small>'+esc(away.name+' '+percent(1-p)+' · '+home.name+' '+percent(p))+'</small>':'')+'</div>';\n const scoreLine=usable?'<div class=\"mb-scoreline\"><span>'+esc(gameLabel(g,'away'))+' '+score(f.projected_score.away)+' – '+score(f.projected_score.home)+' '+esc(gameLabel(g,'home'))+'</span><small>Score projeté</small></div>'+\n '<div class=\"mb-scoreline\"><span>'+score(f.projected_score.home+f.projected_score.away)+' pts</span><small>Total projeté</small></div>':'<p class=\"mb-muted\">Score et total projetés indisponibles.</p>';\n const picks=usable?ranked.slice(0,3):[];\n const rows=picks.map(x=>'<div class=\"mb-player-row\"><span>'+esc(x.name)+' <small>'+esc(gameLabel(g,x.side))+'</small></span><strong>'+numberFr(playerScore(x))+' pts</strong><small>'+numberFr(playerMinutes(x))+' min</small></div>').join('');\n const doubtful=usable?ranked.filter(x=>x.availability==='OFFICIAL_UNCERTAIN'||['QUESTIONABLE','DOUBTFUL','LIMITED'].includes(x.status)):[]; \n const conditional=doubtful.slice(0,2).map(x=>{\n  const limited=x.scenarios?.limited;\n  return '<p class=\"mb-condition\"><strong>'+esc(x.name)+'</strong> · '+numberFr(playerScore(x))+' pts s’il joue'+\n    (Number.isFinite(limited?.points)?', '+numberFr(limited.points)+' pts dans le scénario limité':'')+', 0 en cas d’absence.</p>';\n }).join('');\n const result=actual&&Number.isFinite(away.score)&&Number.isFinite(home.score)?'<p class=\"mb-result\">'+(statStatus(g)==='Terminé'?'Score final':'En direct')+' · '+esc(gameLabel(g,'away'))+' '+score(away.score)+' – '+score(home.score)+' '+esc(gameLabel(g,'home'))+'</p>':'';\n const links=asDetail?'':'<button type=\"button\" data-game=\"'+esc(g.id)+'\">Ouvrir la fiche complète <span aria-hidden=\"true\">→</span></button>';\n return '<article class=\"game match-card\" aria-label=\"'+esc(away.name+' contre '+home.name)+'\"><div class=\"mb-body\">'+\n  '<div class=\"mb-meta\"><time datetime=\"'+esc(g.start)+'\">'+esc(local(g.start))+'</time><span class=\"mb-pill\">'+esc(statStatus(g))+'</span></div>'+\n  '<h2 class=\"mb-title\">'+esc(away.name)+' <span>–</span> '+esc(home.name)+'</h2>'+top+\n  '<div class=\"mb-projection\">'+scoreLine+'</div>'+result+'<h3 class=\"mb-label\">Marqueurs attendus <small>si participation</small></h3>'+\n  (rows||'<p class=\"mb-muted\">Projections joueurs indisponibles.</p>')+conditional+impactView(g)+\n  '<details class=\"mb-details\"><summary>Sources et détail de la prévision</summary>'+\n  (usable?'<p>Principal · estimation '+(eligible?'figée ':'')+'du '+esc(local(at))+'. Probabilités en cours d’évaluation.</p>':'')+\n  (g.study?.revision?revisionDetails(g.study.revision,g):'')+journalSources(g)+marketLine(g)+links+'</details></div></article>';\n}\n\nfunction renderOverview(){\n const now=new Date(),today=parisDay(now),tomorrow=parisDay(new Date(Date.now()+86400000));\n const valid=state.games.filter(g=>state.filter==='all'||(state.filter==='upcoming'&&Date.parse(g.start)>Date.now())||(state.filter==='today'&&parisDay(g.start)===today)||(state.filter==='tomorrow'&&parisDay(g.start)===tomorrow));\n valid.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));\n $('games').innerHTML=valid.length?valid.map(g=>gameCard(g)).join(''):'<div class=\"empty\">Aucune rencontre pour cette période. Sélectionne « Tous » pour consulter les autres matchs.</div>';\n $('gameCount').textContent=valid.length+' rencontre(s) affichée(s) · '+state.games.length+' suivie(s)';\n document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));\n}\nfunction hero(g){\n const finished=statStatus(g)==='Terminé';\n return '<div class=\"detailHero\"><div class=\"matchMeta\"><span class=\"eyebrow\">NBA · '+esc(local(g.start))+'</span><span class=\"chip\">'+esc(statStatus(g))+'</span></div><h1 class=\"detailHeading\">'+esc(g.away.name)+' <span class=\"muted\">vs</span> '+esc(g.home.name)+'</h1>'+(finished?'<p>Score final : '+score(g.away.score)+' – '+score(g.home.score)+'</p>':'')+'</div>';\n}\nfunction scorePanel(g){\n const f=forecast(g);if(!matchReading(g).valid)return '';\n return '<section class=\"panel\">'+heading('Les points attendus')+'<div class=\"bigGrid\">'+['away','home'].map(side=>'<div class=\"numberTile\"><small>'+esc(g[side].name)+'</small><b>'+score(f.projected_score[side])+'</b><small>points estimés</small></div>').join('')+'</div><div class=\"totalTile\"><small>Total du match</small><b>'+score(total(f))+' points</b></div><p class=\"readingNote\">Fourchette simulée du total : '+esc((f.interval_80?.total??[]).map(score).join(' à '))+' points. Cette fourchette reste à valider sur les résultats réels.</p></section>';\n}\nconst heading=(t,p)=>'<div class=\"sectionhead\"><div><h2>'+esc(t)+'</h2>'+(p?'<p class=\"tiny\">'+esc(p)+'</p>':'')+'</div></div>';\nfunction macfly(g,short){\n const m=g.ai_review??g.research;\n if(!m)return '<p class=\"summaryText muted\">MacFly n’a pas encore publié de rapport sourcé utilisable pour cette rencontre.</p>';\n const risks=(m.key_risks||[]).slice(0,short?3:6).map(x=>'<div class=\"risk\">'+esc(x)+'</div>').join('');\n return '<p class=\"summaryText\">'+esc(m.summary)+'</p>'+risks+\n '<p class=\"tiny\" style=\"margin-top:9px\">Recherche du '+esc(local(m.generated_at))+' · '+esc(m.coverage_sections??0)+'/16 sections · '+esc(m.status||'PARTIEL')+'</p>';\n}\nconst reportSection=(g,id)=>g.automatic_report?.sections?.find(x=>x.section_id===id);\nconst teamWindow=(g,side,n=10)=>reportSection(g,4)?.data?.windows?.[side]?.['last'+n]??null;\nconst medicalStatus=s=>({OUT:'Absent confirmé',QUESTIONABLE:'Participation incertaine',DOUBTFUL:'Participation peu probable',PROBABLE:'Participation probable',AVAILABLE:'Disponible',LIMITED:'Temps de jeu limité'}[s]??'Statut à confirmer');\nconst riskLabel=s=>({FIVE_STARTERS_NON_CONFIRMES:'Les cinq joueurs de départ ne sont pas encore confirmés.',MATCHUP_TACTIQUE_NON_VERIFIE:'Les choix tactiques ne sont pas encore vérifiés.',RATINGS_ESTIMES_NON_AJUSTES:'Les statistiques ne sont pas corrigées selon la difficulté des adversaires.',MODEL_UNCALIBRATED:'La précision des probabilités reste à valider.',OFFICIAL_MEDICAL_INCOMPLETE:'Le bulletin médical est incomplet pour cette rencontre.',CURRENT_ROSTER_UNVERIFIED:'Un effectif actuel reste à vérifier.'}[s]??'Certaines données nécessaires à une analyse complète restent à vérifier.');\nfunction matchReading(g){\n const f=forecast(g),a=g.independent_analysis?.advanced;\n const at=Date.parse(g.checked_at??state.health?.last_success??state.updated_at??'');\n const fresh=Number.isFinite(at)&&at<=Date.now()+300000&&Date.now()-at<=8*3600000;\n const pre=g.status==='STATUS_SCHEDULED'&&Date.parse(g.start)>Date.now();\n const probs=Number.isFinite(f?.probability_home)&&Number.isFinite(f?.probability_away)&&f.probability_home>=0&&f.probability_home<=1&&f.probability_away>=0&&f.probability_away<=1&&Math.abs(f.probability_home+f.probability_away-1)<0.001;\n const valid=pre&&fresh&&usable(f)&&probs;\n const side=valid?(f.probability_home===f.probability_away?null:f.probability_home>f.probability_away?'home':'away'):null;\n const chance=side?f['probability_'+side]:null;\n const reasons=[],watch=[];\n if(valid){\n  const margin=Math.abs(f.projected_score.home-f.projected_score.away);\n  reasons.push('Score estimé : '+g.away.name+' '+score(f.projected_score.away)+' – '+score(f.projected_score.home)+' '+g.home.name+'.'+(side?' Écart moyen de '+margin.toLocaleString('fr-FR',{maximumFractionDigits:1})+' points.':''));\n  const h=teamWindow(g,'home',5),v=teamWindow(g,'away',5);\n  if(Number.isFinite(h?.points)&&Number.isFinite(v?.points))reasons.push('Attaque récente : '+g.away.name+' marque '+v.points+' points par match, contre '+h.points+' pour '+g.home.name+' ('+v.observed+' et '+h.observed+' matchs observés).');\n  const b=f.advanced;\n  if(Number.isFinite(b?.home?.def_rating)&&Number.isFinite(b?.away?.def_rating))reasons.push('Défense : '+g.away.name+' concède '+b.away.def_rating+' points pour 100 possessions, contre '+b.home.def_rating+' pour '+g.home.name+'. Le plus bas est le meilleur.');\n }\n const med=g.official_medical;\n for(const side of ['away','home']){\n  const xs=med?.teams?.[side];\n  if(xs?.status!=='SUBMITTED')watch.push(g[side].name+' : bulletin médical non confirmé pour ce match.');\n  else{\n   const players=a?.player_points?.[side]?.players??[];\n   const priority=name=>players.find(p=>p.name===name)?.projected_minutes_if_active??0;\n   const selected=(xs.players??[]).filter(p=>['OUT','QUESTIONABLE','DOUBTFUL','LIMITED'].includes(p.status)).sort((x,y)=>priority(y.player)-priority(x.player)).slice(0,2);\n   for(const p of selected)watch.push(p.player+' : '+medicalStatus(p.status).toLowerCase()+' ('+g[side].name+').');\n  }\n }\n const editorial=g.ai_review??g.research;\n const checked=Date.parse(editorial?.generated_at??'');\n if(checked<=Date.now()&&Date.now()-checked<=12*3600000)for(const r of (editorial.key_risks??[]).slice(0,2))watch.push(r);\n if(!fresh)watch.unshift('La dernière collecte date de plus de huit heures ou son heure est inconnue. Estimation à réactualiser.');\n if(valid&&Math.max(f.probability_home,f.probability_away)<0.55)watch.unshift('Les deux équipes sont très proches dans les simulations : aucun avantage net.');\n return {valid,side,chance,reasons:reasons.slice(0,3),watch:[...new Set(watch)].slice(0,4),fresh,pre};\n}\nfunction verdict(g){\n const r=matchReading(g),f=forecast(g);\n if(!r.valid)return '<section class=\"verdict\" data-verdict=\"unavailable\"><div class=\"eyebrow\">Estimation du vainqueur</div><h2>'+(!r.pre?(statStatus(g)==='Terminé'?'Match terminé':'Pas de nouvelle estimation avant-match'):!r.fresh?'Estimation à réactualiser':'Pas assez de données')+'</h2><p class=\"readingNote\">'+(!r.pre?'Les prévisions enregistrées avant le début restent consultables dans les détails.':'Je ne désigne pas de favori sans une projection exploitable et des données récentes.')+'</p></section>';\n const title=r.side?g[r.side].name:'Aucun favori';\n const tendency=!r.side?'Match à égalité dans le modèle':r.chance<0.55?'Match très serré · léger avantage':r.chance<0.65?'Avantage modéré dans le modèle':'Avantage plus marqué dans le modèle';\n return '<section class=\"verdict\" data-verdict=\"available\"><div class=\"eyebrow\">Vainqueur probable</div><div class=\"verdictTop\"><div><h2>'+esc(title)+'</h2><p class=\"tiny\">'+esc(tendency)+'</p></div><div class=\"chance\">'+(r.side?Math.round(r.chance*100)+' %':'50 / 50')+'<small>estimation du modèle</small></div></div>'+\n '<div class=\"probbar\" role=\"img\" aria-label=\"'+esc(g.away.name+' '+percent(f.probability_away)+' ; '+g.home.name+' '+percent(f.probability_home))+'\"><span style=\"width:'+Math.round(f.probability_away*100)+'%\"></span></div><div class=\"chanceLabels\"><span>'+esc(g.away.name)+' · '+Math.round(f.probability_away*100)+' %</span><span>'+esc(g.home.name)+' · '+Math.round(f.probability_home*100)+' %</span></div>'+\n '<p class=\"readingNote\">Basé sur la forme, les scores et, lorsque les données le permettent, l’attaque, la défense et le rythme. <strong>Les blessures et les informations qualitatives sont à lire en complément : leur effet n’est pas intégré au pourcentage.</strong> Précision encore à valider.</p></section>';\n}\nfunction shortReasons(g){const r=matchReading(g);return '<ul class=\"factList\">'+(r.reasons.length?r.reasons:['Les données disponibles ne permettent pas encore de dégager une tendance chiffrée.']).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';}\nfunction shortRisks(g){const r=matchReading(g);return '<ul class=\"factList\">'+(r.watch.length?r.watch:['Aucun changement médical majeur relevé dans les données disponibles ; les compositions et les minutes peuvent encore évoluer.']).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';}\nfunction renderSummary(g){return gameCard(g,true)}\nfunction playerCard(x){\n const out=x.availability==='OFFICIAL_OUT',uncertain=x.availability==='OFFICIAL_UNCERTAIN';\n const v=out?'0':score(x.predicted_points_if_active);\n const rng=x.predicted_interval_80_if_active?.length?x.predicted_interval_80_if_active.map(score).join(' à '):'—';\n const cond=x.caution==='ESPN_STATUS_NOT_CONFIRMED_FOR_THIS_GAME'?'Statut ESPN à confirmer pour CE match':x.caution==='SAMPLE_TOO_SMALL'?'Historique individuel insuffisant':\n out?'Absence confirmée sur rapport officiel':uncertain?'Participation incertaine selon rapport officiel':'Participation non officiellement confirmée';\n const points=Number.isFinite(x.predicted_points_if_active)?esc(x.predicted_points_if_active.toFixed(1)):'—';\n const info=out?'Absent confirmé':uncertain?'Si joue (incertain)':'Si joue';\n return '<article class=\"player\"><div class=\"playerHead\"><div><strong>'+esc(x.name)+'</strong><small>'+esc(info)+'</small></div><div style=\"text-align:right\"><b>'+esc(v)+'</b><small>points '+(out?'attendus':'si joue')+'</small></div></div>'+\n '<div class=\"playerDetails\">Moyenne '+esc(x.historical_points_per_game??'—')+' pts · '+esc(x.projected_minutes_if_active??'—')+' min estimées · '+esc(x.recent_games)+' matchs</div>'+\n (x.recent_windows?'<div class=\"playerDetails\">'+[3,5,10].map(n=>{const w=x.recent_windows['last'+n];return n+' derniers : '+esc(w?.points??'—')+' pts / '+esc(w?.minutes??'—')+' min ('+esc(w?.observed??0)+' observés)';}).join('<br>')+'</div>':'')+\n (out?'':('<div class=\"playerDetails\">Intervalle 80 % si joue : '+esc(rng)+' points · projection exacte : '+points+'</div>'))+\n (x.scenarios?'<div class=\"playerDetails\">Scénarios : normal '+esc(x.scenarios.available.points)+' · limité '+esc(x.scenarios.limited.points)+' · absent 0 pts</div>':'')+\n '<div class=\"playerFoot\">'+esc(cond)+'</div></article>';\n}\nfunction playerGroup(grp,label){\n const xs=grp?.players||[];\n const withSample=xs.filter(x=>Number.isFinite(x.predicted_points_if_active)||x.availability==='OFFICIAL_OUT');\n const noSample=xs.filter(x=>!Number.isFinite(x.predicted_points_if_active)&&x.availability!=='OFFICIAL_OUT');\n return '<section class=\"panel\"><div class=\"playerTeam\"><h3>'+esc(label)+'</h3><span class=\"tiny\">'+esc(grp?.boxscore_games??0)+' feuilles de match disponibles</span></div>'+\n '<p class=\"tiny\" style=\"margin-bottom:9px\">Points estimés par joueur SI IL JOUE. Ce ne sont pas des prévisions de présence sur le parquet.</p>'+\n (withSample.length?'<div class=\"playerList\">'+withSample.map(playerCard).join('')+'</div>':'<div class=\"scarce\">Pas assez d’apparitions récentes pour calculer les points des joueurs de cette équipe.</div>')+\n (noSample.length?'<details class=\"expert\"><summary>'+noSample.length+' joueur(s) sans projection suffisante</summary><p>'+noSample.map(x=>esc(x.name)).join(' · ')+'</p></details>':'')+'</section>';\n}\nfunction renderPlayers(g){\n const p=playerPoints(g);\n if(!p)return '<div class=\"panel\"><div class=\"scarce\">Le module de points des joueurs n’a pas encore terminé sa première collecte pour cette rencontre.</div></div>';\n if(p.status==='NO_PREMATCH')return '<div class=\"panel\"><div class=\"scarce\">Les nouvelles projections individuelles ne sont calculées qu’avant le match. Les prévisions figées avant le coup d’envoi restent consultables dans les détails de l’analyse.</div></div>';\n return '<div class=\"panel\"><div class=\"note\">Les données ESPN « Out » sont des signaux à revérifier : seule une confirmation officielle reliée à ce match peut établir une absence. Les scénarios restent des estimations.</div></div>'+\n playerGroup(p.away,g.away.name)+playerGroup(p.home,g.home.name)+\n '<div class=\"panel\"><p class=\"tiny\">Méthode : points par minute récents × minutes estimées, ajustement modéré sur la projection de points de l’équipe, intervalle de dispersion empirique. Projections non calibrées ; ne pas additionner les points des joueurs pour obtenir un total d’équipe.</p></div>';\n}\nfunction automaticDetails(g){\n const report=g.automatic_report;if(!report)return '';\n const team=report.sections.find(x=>x.section_id===4)?.data?.windows;\n const windows=team?['away','home'].map(side=>'<h3 class=\"sectionTitle\">'+esc(g[side].name)+'</h3>'+[5,10,20].map(n=>{\n  const w=team[side]?.['last'+n];return '<div class=\"rowInfo\"><span>'+n+' matchs · '+esc(w?.observed??0)+' observés</span><b class=\"tiny\">Off '+esc(w?.off_rating_estimated??'—')+' · Def '+esc(w?.def_rating_estimated??'—')+'<br>TS '+esc(w?.ts_pct??'—')+' % · eFG '+esc(w?.efg_pct??'—')+' %</b></div>';\n }).join('')).join(''):'';\n const med=g.official_medical;\n const medical=med?['away','home'].map(side=>'<h3 class=\"sectionTitle\">'+esc(g[side].name)+'</h3>'+(\n  med.teams[side]?.status==='SUBMITTED'?(med.teams[side].players||[]).map(p=>'<div class=\"rowInfo\"><span>'+esc(p.player)+'</span><b class=\"tiny\">'+esc(p.status)+'</b></div>').join(''):\n  '<p class=\"tiny\">Déclaration officielle non remise ou non rattachée à ce match.</p>')).join(''):'<p class=\"tiny\">Aucun bulletin récent rattaché automatiquement à ce match.</p>';\n const scenarios=report.sections.find(x=>x.section_id===6)?.data?.scenarios?.players??[];\n const whatifs=scenarios.map(p=>'<details class=\"expert\"><summary>'+esc(p.player)+' · '+esc(p.official_status)+'</summary><p class=\"tiny\">Hypothèses non causales ; remplaçants non confirmés ; score principal inchangé.</p>'+Object.entries(p.variants).map(([key,v])=>\n  '<div class=\"rowInfo\"><span>'+esc({present:'Présent',limited:'Limité',absent:'Absent'}[key])+' · '+esc(v.player_minutes)+' min</span><b class=\"tiny\">'+esc(v.player_points_if_active)+' pts joueur<br>Équipe : '+esc(v.projected_score_hypothesis[p.team])+' pts</b></div>'+\n  '<p class=\"tiny\">Candidats : '+esc(v.replacement_candidates.map(x=>x.player+' +'+x.extra_minutes+' min').join(' ; ')||'aucun documenté')+' · Minutes non réparties : '+esc(v.unallocated_minutes)+'</p>').join('')+'</details>').join('');\n return '<div class=\"panel\">'+heading('Forme et efficacité sur 5/10/20 matchs','Calculs sur les feuilles réellement disponibles ; ratings estimés')+windows+'</div>'+\n '<div class=\"panel\">'+heading('Bulletin NBA officiel',med?'Publié le '+local(med.published_at):'Confirmation médicale indisponible')+medical+'</div>'+\n (whatifs?'<div class=\"panel\">'+heading('Scénarios de disponibilité','Simulations conditionnelles, sans probabilité médicale')+whatifs+'</div>':'');\n}\nfunction readableStats(g){\n const n=state.statsWindow??10,windows=['away','home'].map(side=>teamWindow(g,side,n));\n const cols=windows.map((w,i)=>w??(n===10?{...forecast(g)?.advanced?.[['away','home'][i]],observed:forecast(g)?.advanced?.[['away','home'][i]]?.games}:{}));\n const num=v=>Number.isFinite(v)?v.toLocaleString('fr-FR',{maximumFractionDigits:1}):'—';\n const definitions=[\n ['points','Points marqués par match','La moyenne réelle des points inscrits. Plus haut = attaque plus productive.','pts',true],\n ['off_rating_estimated','Efficacité de l’attaque','Points marqués pour 100 possessions. Cela compare l’attaque à rythme égal.','pts / 100',true,'off_rating'],\n ['def_rating_estimated','Solidité de la défense','Points encaissés pour 100 possessions. Plus bas = meilleure défense.','pts / 100',false,'def_rating'],\n ['pace_estimated','Rythme du jeu','Nombre estimé de possessions par match. Plus haut = davantage d’occasions de marquer.','possessions',null,'possessions'],\n ['tov_pct','Ballons perdus','Part des possessions qui se terminent par une perte de balle. Plus bas = meilleure maîtrise.','%',false]\n ];\n return '<section class=\"panel\">'+heading('Les équipes en clair','Des moyennes récentes pour comprendre le match')+\n '<div class=\"periods\" role=\"group\" aria-label=\"Période des statistiques\">'+[5,10,20].map(x=>'<button class=\"filter '+(x===n?'active':'')+'\" data-window=\"'+x+'\" aria-pressed=\"'+(x===n)+'\">'+x+' matchs</button>').join('')+'</div>'+\n '<div class=\"statsHead\">'+['away','home'].map((side,i)=>'<div>'+esc(g[side].name)+'<br><span class=\"tiny\">'+esc(cols[i]?.observed??0)+' matchs observés sur '+n+'</span></div>').join('')+'</div>'+\n definitions.map(([key,title,help,unit,higher,alias])=>{\n const vals=cols.map(w=>w?.[key]??w?.[alias]);let read='Données insuffisantes pour comparer.';\n if(vals.every(Number.isFinite))read=higher===null?'Le rythme le plus élevé est celui de '+g[vals[0]>=vals[1]?'away':'home'].name+'. Ce n’est pas un avantage en soi.':vals[0]===vals[1]?'Les deux équipes sont à égalité sur cet indicateur.':'Avantage sur cet indicateur : '+g[(higher?vals[0]>vals[1]:vals[0]<vals[1])?'away':'home'].name+'.';\n return '<div class=\"statLine\"><h3>'+esc(title)+'</h3><p>'+esc(help)+'</p><div class=\"statValues\">'+vals.map(v=>'<span>'+esc(num(v))+'<small>'+esc(unit)+'</small></span>').join('')+'</div><p class=\"statRead\">'+esc(read)+'</p></div>';\n }).join('')+'<p class=\"readingNote\">Possessions et efficacité estimées à partir des feuilles de match. Les adversaires rencontrés ne sont pas corrigés ; une moyenne ne suffit pas à prédire le vainqueur.</p></section>';\n}\nfunction medicalPanel(g){\n const med=g.official_medical;\n return '<section class=\"panel\">'+heading('Les absences à connaître',med?'Bulletin NBA publié le '+local(med.published_at):'Confirmation officielle encore attendue')+\n ['away','home'].map(side=>{const team=med?.teams?.[side];return '<h3 class=\"sectionTitle\">'+esc(g[side].name)+'</h3>'+(team?.status==='SUBMITTED'?(team.players?.length?team.players.map(p=>'<div class=\"rowInfo\"><span>'+esc(p.player)+'</span><b class=\"tiny\">'+esc(medicalStatus(p.status))+'</b></div>').join(''):'<p class=\"tiny\">Aucun joueur signalé dans ce bulletin pour cette équipe.</p>'):'<p class=\"tiny\">Déclaration non remise ou non confirmée pour ce match.</p>');}).join('')+'</section>';\n}\nfunction renderAnalysis(g){\n return readableStats(g)+medicalPanel(g)+'<details class=\"fold\"><summary>Voir les statistiques avancées et les scénarios</summary>'+automaticDetails(g)+'</details>';\n}\nfunction renderExpert(g){\n const audit=state.errorAudit?.records?.find(r=>r.match_id===String(g.id));\n const report=g.automatic_report??g.ai_review??g.research;\n const rows=(report?.sections||[]).map(x=>'<details><summary>'+esc(x.section_id)+'. '+esc(x.title)+'</summary><p>'+esc((x.findings||[]).join(' | '))+'</p><p>À compléter : '+esc((x.missing||[]).join(' · ')||'Aucun manque signalé')+'</p></details>').join('');\n const seen=new Set();const sources=(report?.sources||[]).filter(x=>{if(!/^https:\\/\\//.test(x.url)||seen.has(x.url))return false;seen.add(x.url);return true;}).map(x=>'<a target=\"_blank\" rel=\"noopener noreferrer\" href=\"'+esc(x.url)+'\">'+esc(x.title)+(x.checked_at?' · '+esc(local(x.checked_at)):'')+'</a>').join('');\n const risks=[...new Set((g.coverage?.missing??[]).map(riskLabel))].slice(0,3);\n return (audit?'<section class=\"panel\">'+heading('Pourquoi la prévision a échoué','Constats après match, sans réécriture du pronostic')+'<ul class=\"factList\">'+[...audit.diagnosis.slice(0,2),...audit.observed_drivers.slice(0,2),...(audit.individual_surprises??[]).slice(0,1).map(p=>p.player+' : '+p.predicted+' points prévus, '+p.actual+' réels ; '+p.projected_minutes+' minutes prévues, '+p.actual_minutes+' réelles.')].map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p class=\"readingNote\">'+esc(audit.causal_attribution)+'</p></section>':'')+'<section class=\"panel\">'+heading('L’essentiel de l’analyse','Une lecture courte, avec les preuves accessibles en dessous')+\n '<h3 class=\"sectionTitle\">La tendance</h3>'+shortReasons(g)+'<h3 class=\"sectionTitle\">Les points de vigilance</h3>'+shortRisks(g)+\n '<p class=\"readingNote\">'+esc(risks.join(' ')||'Toutes les informations utiles ne sont pas nécessairement disponibles.')+' Le modèle reste expérimental. Les annonces médicales ne modifient pas automatiquement sa probabilité.</p></section>'+\n '<details class=\"fold\"><summary>Sources et dates de vérification</summary><div class=\"sources\">'+(sources||'<p>Aucune source supplémentaire enregistrée.</p>')+'</div></details>'+\n '<details class=\"fold\"><summary>Comparer les prévisions avant le match</summary><div id=\"timeline\"><p class=\"tiny\">Chargement des prévisions enregistrées…</p></div></details>'+\n '<details class=\"fold expert\" data-full-report><summary>Ouvrir le rapport technique complet</summary><p class=\"tiny\">Les seize rubriques restent disponibles pour examiner les données en détail.</p>'+rows+'</details>';\n}\nfunction tabView(g){\n if(state.tab==='joueurs')return renderPlayers(g);\n if(state.tab==='analyse')return renderAnalysis(g);\n if(state.tab==='expert')return renderExpert(g);\n return renderSummary(g);\n}\nfunction renderDetail(g){\n const buttons=[['resume','Résumé'],['joueurs','Points joueurs'],['analyse','Statistiques'],['expert','Analyse']].map(v=>\n '<button class=\"tab '+(state.tab===v[0]?'active':'')+'\" data-tab=\"'+v[0]+'\">'+v[1]+'</button>').join('');\n $('matchView').innerHTML=(state.tab==='resume'?'':hero(g))+'<div class=\"tabs\" role=\"tablist\" aria-label=\"Sections du match\">'+buttons+'</div><div class=\"tabContent\">'+tabView(g)+'</div>';\n if(state.tab==='expert')loadTimeline(g.id);\n}\nfunction render(){\n const id=matchId(),g=id?state.games.find(x=>String(x.id)===id):null;\n $('overview').hidden=!!g;$('detail').hidden=!g;\n if(g)renderDetail(g);else renderOverview();\n $('lastCollect').textContent='Collecte : '+local(state.health?.last_success||state.updated_at);\n $('coverage').textContent='Boxscores : '+(state.health?.sources?.player_boxes?.cached??0);\n $('research').textContent='Rapports : '+state.games.filter(g=>g.status==='STATUS_SCHEDULED'&&g.automatic_report).length+' · MacFly : '+(state.research_coverage?.available??state.research_count??0)+' / '+(state.research_coverage?.eligible??state.research_agenda?.eligible??0)+' · passage toutes les 6 h';\n const metric=state.metrics||{},pm=state.playerMetrics||{};\n $('metrics').innerHTML='<p>Prévisions de victoire évaluées : '+esc(metric.games_evaluated??0)+' matchs · Brier '+esc(metric.brier??'—')+' · Log Loss '+esc(metric.log_loss??'—')+'</p>'+\n '<p>Version actuelle : '+esc(metric.calibration_readiness?.current_version??'—')+' · '+esc(metric.calibration_readiness?.current_version_sample??0)+' matchs évalués. Les anciens résultats ne sont pas attribués à cette version.</p>'+\n '<p>Points des joueurs évalués : '+esc(pm.players_evaluated??0)+' projections sur '+esc(pm.games_evaluated??0)+' matchs · erreur absolue moyenne '+esc(pm.mae??'—')+' pts · RMSE '+esc(pm.rmse??'—')+'</p>'+\n '<p>Sur la dernière collecte : '+esc(state.forecast_efficiency?.recalculated??'—')+' simulation(s) complète(s) relancée(s), '+esc(state.forecast_efficiency?.reused??'—')+' résultat(s) réutilisé(s) sans calcul redondant.</p>'+\n '<p>Recherche ciblée : '+esc(state.research_agenda?.due_count??'—')+' sujet(s) pour le prochain passage groupé. Collecte et MacFly toutes les 6 heures ; contrôle de santé quotidien.</p>'+\n '<p>Statut : NON CALIBRÉ. Évaluation fondée sur des projections réellement enregistrées avant le début des matchs. Historique archivé : '+esc(state.health?.sources?.archive?.days??0)+' / '+esc(state.health?.sources?.archive?.target??'—')+' journées.</p>';\n}\nfunction timelineHtml(data){\n const lines=(data.timeline||[]).filter(x=>x.at).map(x=>{\n  const f=x.forecast,p=x.player_points;\n  return '<div class=\"rowInfo\"><span>'+esc(x.checkpoint)+' · '+esc(local(x.at))+'</span><b>'+\n   (Number.isFinite(f?.probability_home)?percent(f.probability_home):'sans probabilité')+\n   (p?' · '+esc((p.home?.projectable_players??0)+(p.away?.projectable_players??0))+' joueurs':'')+'</b></div>';\n }).join('');\n const e=data.evaluation,pe=data.player_evaluation;\n const journal=(data.study?.revisions??[]).map(item=>item.revision??item).sort((a,b)=>Date.parse(b.integrated_at??b.at)-Date.parse(a.integrated_at??a.at));\n const game=state.games.find(g=>String(g.id)===String(data.game?.id??matchId()));\n const history=game&&journal.length?'<h3>Versions MacFly</h3>'+journal.map(r=>revisionDetails(r,game)).join(''):'';\n return history+(lines||'<div class=\"scarce\">Aucun relevé pré-match disponible pour cette rencontre.</div>')+\n (e?'<div class=\"risk\">Évaluation du vainqueur : Brier '+esc(e.brier)+' · Log Loss '+esc(e.log_loss)+'</div>':'')+\n (pe?'<div class=\"risk\">Prédictions individuelles : MAE '+esc(pe.mae)+' points · '+esc(pe.matched)+' joueurs vérifiés.</div>':'')+\n '<p class=\"tiny\" style=\"margin-top:10px\">Les anciens relevés ne sont jamais recalculés après le résultat.</p>';\n}\nasync function loadTimeline(id){\n const target=$('timeline');if(!target)return;\n if(state.historyCache[id]){target.innerHTML=timelineHtml(state.historyCache[id]);return}\n try{\n  const res=await fetch('/api/game?id='+encodeURIComponent(id),{cache:'no-store'});\n  if(!res.ok)throw new Error('HTTP '+res.status);\n  const data=await res.json();state.historyCache[id]=data;\n  const live=$('timeline');if(live&&matchId()===id)live.innerHTML=timelineHtml(data);\n }catch(err){const live=$('timeline');if(live)live.textContent='Historique indisponible : '+err.message}\n}\nasync function load(){\n $('refresh').disabled=true;\n try{\n  const [a,b,c,d,e]=await Promise.all([\n   fetch('/api/slate',{cache:'no-store'}),fetch('/api/health',{cache:'no-store'}),\n   fetch('/api/metrics',{cache:'no-store'}),fetch('/api/player-metrics',{cache:'no-store'}),fetch('/api/error-audit',{cache:'no-store'})]);\n  if(!a.ok||!b.ok)throw Error('Collecte indisponible');\n  const slate=await a.json(),health=await b.json(),metrics=c.ok?await c.json():null,playerMetrics=d.ok?await d.json():null;\n  state={...state,...slate,historyCache:{},health,metrics,playerMetrics,errorAudit:e.ok?await e.json():null};render();\n }catch(err){\n  if(!state.games.length)$('games').innerHTML='<div class=\"empty\">Impossible de charger les données : '+esc(err.message)+'</div>';\n  $('lastCollect').textContent='État à vérifier';\n }finally{$('refresh').disabled=false}\n}\ndocument.addEventListener('click',event=>{\n const game=event.target.closest('[data-game]');\n if(game){state.tab='resume';location.hash='#match-'+game.dataset.game;render();window.scrollTo({top:0,behavior:'instant'});return}\n const filter=event.target.closest('[data-filter]');\n if(filter){state.filter=filter.dataset.filter;renderOverview();return}\n const period=event.target.closest('[data-window]');\n if(period){state.statsWindow=Number(period.dataset.window);render();return}\n const tab=event.target.closest('[data-tab]');\n if(tab){state.tab=tab.dataset.tab;render();return}\n});\n$('back').addEventListener('click',()=>{location.hash='';state.tab='resume';render();window.scrollTo({top:0,behavior:'instant'})});\n$('refresh').addEventListener('click',load);\nwindow.addEventListener('hashchange',render);\nconst impactNames={injury:'absence ou disponibilité',availability:'disponibilité',role:'rôle du joueur',rotation:'rotation',minutes_limit:'limite de minutes',research:'rapport',context:'contexte'};\nconst impactKind=k=>impactNames[String(k).toLowerCase()]??String(k).replace(/_/g,' ').toLowerCase();\nfunction marketStudy(m){\n if(!m)return '<p>Bilan des cotes indisponible.</p>';\n const row=(label,value)=>'<div class=\"study-item\"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';\n const pct=x=>Number.isFinite(x)?percent(x):'—';\n const units=x=>Number.isFinite(x)?numberFr(x,2)+' u':'—';\n const c=m.comparedWithFavorite;\n const decisions=(m.rows??[]).slice().reverse().map(d=>{\n  const g=state.games.find(game=>String(game.id)===d.gameId);\n  const away=g?.away?.name??d.awayTeamName,home=g?.home?.name??d.homeTeamName;\n  const name=away&&home?away+' – '+home:'Match '+d.gameId;\n  const price=d.quote?('Winamax · vainqueur avec prolongations · '+local(d.quote.observedAt)+' · visiteur '+numberFr(d.quote.awayOdds,2)+' / domicile '+numberFr(d.quote.homeOdds,2)):'Rendement non évaluable';\n  const pick=d.prediction?(d.prediction==='home'?(home??'Domicile'):(away??'Visiteur')):'Égalité dans le modèle';\n  return '<details class=\"mb-journal\"><summary>'+esc(name)+' · '+esc(d.label)+'</summary><p>'+\n   esc(local(d.decisionAt))+' · '+esc(pick)+(typeof d.sportHit==='boolean'?' · '+(d.sportHit?'Pronostic juste':'Pronostic manqué'):'')+\n   '</p><p>'+esc(price)+(d.quote?' · '+sourceLink(d.quote.sourceUrl,'Source du relevé'):'')+'</p>'+\n   (d.selected?'<p>1 unité engagée · '+(Number.isFinite(d.netUnits)?'Résultat '+units(d.netUnits):'Résultat en attente')+'</p>':'')+'</details>';\n }).join('');\n return '<h3>Décisions à une unité virtuelle</h3>'+\n  row('Matchs analysés',numberFr(m.analyzedGames))+row('Matchs avec cote exploitable',numberFr(m.pricedGames))+\n  row('Sélections retenues',numberFr(m.selections))+row('Unités engagées',units(m.stakedUnits))+\n  row('Sélections réglées / en cours',numberFr(m.settledSelections)+' / '+numberFr(m.pendingSelections))+\n  row('Résultat cumulé',units(m.netUnits))+row('Rendement des unités réglées',m.roi==null?'Rendement non évaluable':pct(m.roi))+\n  row('Plus forte baisse cumulée',units(m.maxDrawdownUnits))+\n  (c?.games?'<p>Sur '+esc(c.games)+' matchs avec un favori de marché, Max en a trouvé '+esc(c.maxCorrect)+' et le favori en a gagné '+esc(c.favoriteCorrect)+'.</p>':'<p>Comparaison avec le favori du marché en attente de résultats communs.</p>')+\n  (m.rule?.description?'<p>Règle figée · '+esc(m.rule.description)+'</p>':'')+\n  (decisions?'<details class=\"fold\"><summary>Décisions par match</summary>'+decisions+'</details>':'');\n}\nfunction sportStudy(sport){\n if(!sport)return '<p>Comparaison sportive indisponible.</p>';\n const b=sport.primary??{},v=sport.variant??{},n=sport.paired_games??0;\n const row=(label,k,suffix='',digits=2)=>'<tr><th scope=\"row\">'+esc(label)+'</th><td>'+numberFr(b[k],digits)+(Number.isFinite(b[k])?suffix:'')+'</td><td>'+numberFr(v[k],digits)+(Number.isFinite(v[k])?suffix:'')+'</td></tr>';\n const reasons=sport.excluded??{};\n const ctl=[...(sport.primary_macfly?.controlled??[]).map(g=>({...g,engine:'Principal'})),...(sport.macfly?.controlled??[]).map(g=>({...g,engine:'Variante'}))];\n const met={brier:'erreur de probabilité (Brier)',total_mae:'erreur du total (pts)',player_mae:'erreur joueur (pts)',minutes_mae:'erreur de minutes',production_mae:'erreur de production'};\n const calibration=[['Principal',b],['Variante',v]].map(([label,engine])=>{\n  const rows=(engine.calibration??[]).filter(bin=>bin.n>0).map(bin=>'<tr><th scope=\"row\">'+esc(label)+'</th><td>'+percent(bin.announced)+'</td><td>'+percent(bin.observed)+'</td><td>'+esc(bin.n)+'</td></tr>');\n  return rows.join('');\n }).join('');\n const audits=(sport.audits??[]).map(a=>{\n  const g=state.games.find(game=>String(game.id)===a.game_id);\n  const label=g?g.away.name+' – '+g.home.name:'Match '+a.game_id;\n  return '<p><b>'+esc(label)+'</b> · '+(typeof a.primary_correct==='boolean'?(a.primary_correct?'Vainqueur bien prévu':'Vainqueur manqué'):'Égalité dans le modèle')+\n    ' · erreur de marge '+numberFr(a.primary_margin_error)+' pts · erreur du total '+numberFr(a.primary_total_error)+' pts</p>';\n }).join('');\n const controlled=ctl.map(group=>{\n  const title=(group.kinds??[]).map(impactKind).join(' + ');\n  const result=Object.entries(met).filter(([k])=>Number.isFinite(group.gain?.[k])).map(([k,label])=>\n   '<li>'+esc(label)+' · '+(group.gain[k]>0?'baisse de ':group.gain[k]<0?'hausse de ':'écart ')+numberFr(Math.abs(group.gain[k]),3)+'</li>').join('');\n  return '<p><strong>'+esc(group.engine+' · '+title)+'</strong> · '+numberFr(group.games)+' match(s), '+numberFr(group.groups)+' mise(s) à jour.</p><ul>'+result+'</ul>';\n }).join('');\n return '<h3>Principal et variante rotations</h3><p>'+numberFr(n)+' match(s) comparables · '+numberFr(sport.player_pairs)+' projection(s) joueur appariée(s). Variante expérimentale.</p>'+\n  '<table class=\"study-table\"><thead><tr><th>Mesure</th><th>Principal</th><th>Variante</th></tr></thead><tbody>'+\n  row('Vainqueurs justes','accuracy_pct',' %',1)+row('Erreur de probabilité (Brier)','brier','',3)+row('Perte logarithmique','log_loss','',3)+\n  row('Erreur du total','total_mae',' pts')+row('Erreur sur les points joueur','player_mae',' pts')+\n  row('Erreur de temps de jeu','minutes_mae',' min')+row('Erreur de production','production_mae',' pts')+'</tbody></table>'+\n  (calibration?'<details class=\"fold\"><summary>Probabilités annoncées et fréquences observées</summary><table class=\"study-table\"><thead><tr><th>Moteur</th><th>Annoncé</th><th>Observé</th><th>Matchs</th></tr></thead><tbody>'+calibration+'</tbody></table></details>':'')+\n  (audits?'<details class=\"fold\"><summary>Examiner les pronostics justes et manqués</summary>'+audits+'</details>':'')+\n  '<p>Paires écartées pour plus de 15 minutes de décalage · '+esc(reasons.OVER_15_MINUTES??0)+'.</p>'+\n  '<h3>Effet mesuré des informations MacFly</h3>'+(controlled||'<p>Aucun groupe d’informations évalué à entrées identiques pour le moment.</p>');\n}\nasync function loadStudy(){\n const target=$('study-content');\n if(!target)return;\n target.textContent='Chargement des résultats…';\n try{\n  const response=await fetch('/api/study',{cache:'no-store'});\n  if(!response.ok)throw Error('HTTP '+response.status);\n  const data=await response.json();\n  const legacy=data.legacy_audit;\n  const quality=legacy?'<p>Contrôle du '+esc(legacy.date)+' · '+numberFr(legacy.over_15_minutes)+' paires sur '+numberFr(legacy.compared_checkpoints)+' espacées de plus de 15 minutes, '+numberFr(legacy.unpaired)+' captures sans paire. Le bilan prospectif commence avec les nouvelles captures synchronisées.</p>':'';\n  target.innerHTML=sportStudy(data.sport)+quality+marketStudy(data.market);\n }catch{\n  target.textContent='Bilan momentanément indisponible. Referme puis ouvre le bilan pour réessayer.';\n }\n}\n$('study-wrap').addEventListener('toggle',()=>{if($('study-wrap').open)loadStudy()});\n\nload();setInterval(load,60000);\n</script></body></html>\n";
const MAX_ANALYST_PROMPT="PROMPT MAÎTRE — NBA QUANTITATIVE INTELLIGENCE\n\n1. IDENTITÉ ET MISSION\n\nTu es un analyste quantitatif NBA de très haut niveau, spécialisé dans la modélisation probabiliste, l’analyse statistique avancée, la performance individuelle, les stratégies collectives et la prévision des résultats sportifs.\n\nTu combines les compétences de :\n\n* Data scientist spécialisé en prédiction sportive.\n* Statisticien expert en probabilités et séries temporelles.\n* Analyste tactique NBA.\n* Expert en biomécanique et impact fonctionnel des blessures, sans poser de diagnostic médical.\n* Spécialiste des rotations, du rythme et des interactions entre joueurs.\n* Expert en simulation de Monte-Carlo, modèles bayésiens et apprentissage statistique.\n* Auditeur indépendant chargé de vérifier chaque hypothèse.\n\nMission : analyser chaque match NBA avec le maximum de précision statistique possible et produire les prévisions les plus fiables, les mieux calibrées et les plus explicables.\n\nTu dois rechercher ce qui peut réellement changer le résultat d’un match, y compris les éléments qui ne sont pas correctement représentés dans les statistiques traditionnelles.\n\nTu ne dois jamais chercher à me satisfaire en annonçant un pronostic spectaculaire. Tu dois rechercher la vérité statistique.\n\n2. RÈGLES ABSOLUES\n\n1. Ne jamais inventer une donnée, une blessure, une composition, une cote ou une probabilité calculée.\n2. Consulter les sources actualisées disponibles et mentionner leur date de dernière vérification.\n3. Privilégier NBA.com/stats, les rapports officiels NBA, les données de play-by-play, les informations officielles des franchises et les bases statistiques spécialisées fiables.\n4. Distinguer systématiquement un fait confirmé, une estimation statistique et une hypothèse.\n5. Ne jamais utiliser une information publiée après le début du match pour établir un pronostic prétendument réalisé avant celui-ci.\n6. Ne pas considérer automatiquement les dix derniers matchs comme plus représentatifs que les performances à long terme.\n7. Ne pas attribuer deux fois l’influence d’un même facteur.\n8. Quantifier l’incertitude et la qualité des données.\n9. Ne pas affirmer avoir exécuté des modèles ou simulations si aucun calcul réel n’a été effectué.\n10. Si les informations ne permettent pas de conclure, répondre clairement : PRONOSTIC NON FIABLE — ABSTENTION.\n\n3. COLLECTE ET QUALITÉ DES DONNÉES\n\nPour chaque rencontre, identifier :\n\n* Les équipes, le domicile, la date et l’heure exacte.\n* La saison et la phase de compétition.\n* Les effectifs actuels et les transferts récents.\n* Les joueurs disponibles, incertains et absents.\n* Les cinq majeurs probables et confirmés.\n* Les rotations prévisionnelles.\n* Les statistiques disponibles avant le coup d’envoi.\n* Les éventuelles cotes et lignes du marché.\n* La date de collecte et la fiabilité des sources.\n\nClasser les données selon leur fiabilité et leur fraîcheur.\n\nSignaler toute divergence entre deux sources. En début de saison, utiliser des estimations prudentes fondées sur plusieurs saisons, ajustées pour les changements d’effectif et de rôle.\n\n4. ANALYSE STATISTIQUE DES ÉQUIPES\n\nA. Niveau général\n\nÉtudier les statistiques suivantes, en privilégiant les métriques ajustées par possession et par qualité d’adversaire :\n\n* Offensive Rating (OffRtg).\n* Defensive Rating (DefRtg).\n* Net Rating.\n* Pace et possessions projetées.\n* Points inscrits et encaissés par possession.\n* True Shooting Percentage (TS%).\n* Effective Field Goal Percentage (eFG%).\n* Taux de balles perdues (TOV%).\n* Offensive Rebound Percentage (OREB%).\n* Defensive Rebound Percentage (DREB%).\n* Free Throw Rate (FTr).\n* Three-Point Attempt Rate (3PAr).\n* Ratio passes décisives / pertes de balle.\n* Qualité des tirs créés et concédés.\n* Différentiel de tirs ouverts, contestés et de tirs près du cercle.\n\nB. Fenêtres temporelles\n\nComparer :\n\n* Saison actuelle.\n* 20 derniers matchs.\n* 10 derniers matchs.\n* 5 derniers matchs.\n* Performances à domicile et à l’extérieur.\n* Performances contre les équipes de niveau similaire.\n* Performances avec l’effectif actuellement disponible.\n\nPondérer les périodes en fonction de leur pouvoir prédictif démontré et de leur taille d’échantillon.\n\nC. Régression statistique\n\nDétecter :\n\n* Les équipes dont l’adresse à trois points est temporairement anormalement élevée ou faible.\n* Les performances extrêmes peu susceptibles de se maintenir.\n* Les résultats favorisés par un calendrier facile.\n* Les équipes dont le bilan victoires-défaites masque un Net Rating médiocre.\n* Les équipes dont les résultats sont affectés par des blessures ou des changements de rotation.\n\nNe jamais confondre une série de victoires avec une amélioration démontrée du niveau réel.\n\n5. ANALYSE INDIVIDUELLE DES JOUEURS\n\nPour chaque joueur susceptible d’avoir un impact significatif sur la rencontre, analyser :\n\nA. Production individuelle\n\n* Points, rebonds, passes décisives.\n* Minutes prévues.\n* Usage Rate (USG%).\n* TS%, eFG% et volume de tirs.\n* Passes potentielles et création offensive.\n* Efficacité sur tirs contestés et non contestés.\n* Impact défensif.\n* Fautes commises et provoquées.\n* Fatigue et évolution des performances.\n* Régularité et dispersion statistique.\n* Performance contre les profils défensifs comparables.\n\nB. Valeur réelle du joueur\n\nLorsque les données le permettent, comparer :\n\n* EPM.\n* DARKO / DPM.\n* RAPM et autres adjusted plus-minus.\n* BPM.\n* On/Off Rating corrigé des effets de composition.\n* Performances des combinaisons de cinq joueurs.\n\nÉviter de traiter les indicateurs corrélés comme des preuves indépendantes.\n\nC. Projection\n\nEstimer :\n\n* Les minutes probables.\n* L’utilisation offensive future.\n* L’efficacité attendue.\n* Les changements de rôle.\n* L’impact sur le collectif.\n* Les interactions positives ou négatives entre joueurs.\n\nPrivilégier les projections fondées sur plusieurs matchs et plusieurs saisons plutôt qu’une performance isolée.\n\n6. BLESSURES ET ABSENCES — ANALYSE PRIORITAIRE\n\nC’est l’un des domaines auxquels tu dois accorder une attention particulière.\n\nA. Vérification des disponibilités\n\nConsulter en priorité le rapport officiel des blessures NBA.\n\nIdentifier :\n\n* Out.\n* Doubtful.\n* Questionable.\n* Probable.\n* Available.\n* Limitations de minutes confirmées ou probables.\n* Retour après blessure.\n* Gestion de charge.\n* Absence de dernière minute.\n\nDocumenter l’heure de confirmation.\n\nB. Impact réel d’une absence\n\nPour chaque joueur concerné, analyser :\n\n1. Sa contribution offensive et défensive estimée par 100 possessions.\n2. Son temps de jeu habituel et les minutes qu’il aurait probablement jouées.\n3. Le niveau du joueur qui le remplace.\n4. La modification des rotations.\n5. Le changement de rythme attendu.\n6. La redistribution des tirs et du taux d’utilisation.\n7. La création offensive perdue ou redistribuée.\n8. L’impact sur la protection du cercle, les rebonds et la défense extérieure.\n9. Les interactions avec les autres titulaires.\n10. L’adéquation des remplaçants à l’adversaire du jour.\n\nUne absence ne doit jamais être évaluée uniquement à partir de la moyenne de points du joueur.\n\nC. Effet indirect des blessures\n\nDéterminer si l’absence :\n\n* Libère davantage de possessions à un joueur performant.\n* Oblige un joueur à changer de position.\n* Affaiblit la deuxième unité.\n* Augmente les minutes et la fatigue des titulaires.\n* Modifie les systèmes offensifs.\n* Rend une faiblesse défensive plus exploitable.\n* Réduit la capacité à défendre une star adverse.\n\nD. Modèle de scénarios\n\nSi une participation demeure incertaine, produire séparément :\n\n* Scénario : joueur présent sans restriction.\n* Scénario : joueur présent avec minutes limitées.\n* Scénario : joueur absent.\n\nCalculer les conséquences estimées sur le score, l’écart et la probabilité de victoire.\n\nAssocier des probabilités aux scénarios seulement si les informations disponibles permettent de les justifier. Sinon, présenter une fourchette et signaler l’incertitude.\n\nNe jamais présenter un seul chiffre comme fiable lorsqu’une blessure majeure reste non résolue.\n\n7. CONFRONTATIONS TACTIQUES ET MATCHUPS\n\nAnalyser le basket réellement pratiqué par les deux équipes.\n\nA. Attaque contre défense\n\n* Pick-and-roll porteur et poseur d’écran.\n* Isolation.\n* Post-up.\n* Catch-and-shoot.\n* Jeu de transition.\n* Attaque du cercle.\n* Tirs à mi-distance.\n* Tirs à trois points et corners.\n* Coupes sans ballon.\n* Secondes chances.\n* Systèmes offensifs et efficacité en demi-terrain.\n\nB. Adaptation défensive\n\nÉtudier :\n\n* Défense individuelle et switches.\n* Drop coverage.\n* Défense haute et blitz.\n* Aides défensives.\n* Défense du périmètre.\n* Protection du cercle.\n* Défense des joueurs dominants.\n* Capacité à limiter les tirs préférentiels de l’adversaire.\n* Risque de fautes et de déséquilibre au rebond.\n\nC. Confrontations individuelles\n\nIdentifier les duels susceptibles d’avoir un impact majeur.\n\nPour chaque duel :\n\n* Avantage physique.\n* Taille, mobilité et position.\n* Profil offensif et défensif.\n* Difficulté des tirs générés.\n* Risque de mismatch.\n* Possibilité d’adaptation tactique.\n* Probabilité que les joueurs se confrontent réellement sur le terrain.\n\nNe pas accorder trop d’importance aux confrontations directes anciennes si les effectifs ont changé.\n\nD. Entraîneurs et rotations\n\nAnalyser :\n\n* Rotations habituelles.\n* Utilisation des remplaçants.\n* Ajustements tactiques récents.\n* Répartition du temps de jeu.\n* Réaction face aux adversaires aux profils similaires.\n* Possibilité d’un changement de cinq majeur.\n* Gestion des fins de match.\n\n8. FATIGUE, CALENDRIER ET CONDITIONS EXTÉRIEURES\n\nÉvaluer systématiquement :\n\n* Nombre de jours de repos.\n* Back-to-back.\n* Trois matchs en quatre jours.\n* Quatre matchs en six jours.\n* Minutes accumulées récemment.\n* Prolongations récentes.\n* Distance de déplacement.\n* Changement de fuseau horaire.\n* Déplacements successifs.\n* Avantage du terrain.\n* Altitude, notamment à Denver.\n* Heure locale du match.\n* Fatigue comparative des deux équipes.\n\nAnalyser l’effet potentiel sur :\n\n* L’adresse au tir.\n* L’intensité défensive.\n* Le nombre de possessions.\n* Les pertes de balle.\n* Les rotations.\n* La performance en fin de rencontre.\n\nLes ajustements doivent provenir d’observations historiques validées, et non d’une pénalité arbitraire attribuée à chaque déplacement.\n\n9. CONTEXTE SPORTIF ET PSYCHOLOGIQUE\n\nExaminer avec prudence :\n\n* Importance sportive du match.\n* Course aux playoffs.\n* Situation en tournoi NBA ou autre phase particulière.\n* Risque de repos stratégique.\n* Retour d’un joueur majeur.\n* Changement récent d’entraîneur.\n* Transformation des responsabilités dans l’équipe.\n* Motivation ou tension rapportée par des sources crédibles.\n\nNe jamais attribuer un avantage chiffré à des notions vagues comme « envie de gagner », « revanche » ou « mentalité » sans validation statistique.\n\nLes arbitres et leurs tendances peuvent être examinés uniquement si les informations sont confirmées et si un effet prédictif robuste a été démontré.\n\n10. MODÉLISATION PRÉDICTIVE AVANCÉE\n\nConstruire plusieurs estimations indépendantes dans la mesure du possible.\n\nModèle A — Force collective\n\nProjeter les possessions et les efficacités offensives/défensives des deux équipes, avec ajustement pour le niveau des adversaires précédemment rencontrés.\n\nModèle B — Contribution des joueurs\n\nProjeter la performance des équipes à partir des minutes attendues, du niveau individuel des joueurs, des cinq majeurs et des rotations.\n\nIntégrer les absences et les remplacements.\n\nModèle C — Confrontation tactique\n\nEstimer l’effet des caractéristiques de jeu des deux équipes sur le rythme, le volume et la qualité des tirs, les rebonds et les balles perdues.\n\nModèle D — Référence de marché\n\nUtiliser les lignes et probabilités du marché comme référence comparative, après correction de la marge des opérateurs.\n\nDistinguer un modèle indépendant du marché d’un modèle qui utilise les cotes en entrée, afin d’éviter de surestimer un éventuel avantage.\n\nFusion des modèles\n\nCombiner les estimations selon leurs performances historiques hors échantillon.\n\nNe pas inventer de coefficients optimaux. Si aucun modèle entraîné n’est disponible, présenter une estimation exploratoire explicitement non validée.\n\nSimulations\n\nSi un moteur de calcul est disponible :\n\n* Simuler un nombre suffisant de rencontres, par exemple 50 000 ou davantage si nécessaire pour stabiliser les estimations.\n* Utiliser des distributions de scores compatibles avec les données NBA.\n* Intégrer l’incertitude sur le rythme, les efficacités, les compositions et les événements de match.\n* Préserver les dépendances statistiques entre les scores des équipes.\n* Tester plusieurs scénarios de disponibilité et de rotation.\n* Mesurer la sensibilité des prédictions aux paramètres.\n\nSi aucune simulation n’a réellement été exécutée, ne pas annoncer de résultats simulés.\n\nRésultats attendus\n\nProduire :\n\n* Points attendus de chaque équipe.\n* Total attendu.\n* Écart attendu.\n* Probabilité de victoire.\n* Distribution des écarts.\n* Fourchettes de scores plausibles.\n* Intervalles de prédiction.\n* Sensibilité aux blessures.\n* Principales causes d’incertitude.\n\nDistinguer la confiance dans le modèle de la probabilité qu’une équipe gagne.\n\n11. ANALYSE DES PRONOSTICS ET DES MARCHÉS\n\nLorsque des cotes réelles, datées et vérifiables sont disponibles, analyser :\n\n* Moneyline.\n* Handicap / Spread.\n* Over / Under.\n* Totaux individuels des équipes.\n* Marchés par quart-temps ou mi-temps, uniquement si le modèle les couvre.\n* Statistiques individuelles des joueurs lorsque des projections spécifiques sont disponibles.\n\nPour chaque marché :\n\n1. Calculer la probabilité prévisionnelle.\n2. Calculer la probabilité implicite de la cote.\n3. Corriger, si possible, la marge intégrée au marché.\n4. Calculer la cote théorique.\n5. Mesurer l’écart entre le modèle et le marché.\n6. Calculer l’espérance de rendement en tenant compte des règles de règlement, notamment des égalités ou remboursements éventuels.\n7. Quantifier l’incertitude de cette espérance.\n8. Déterminer si l’écart est suffisamment robuste pour justifier une recommandation.\n\nPour une issue binaire sans remboursement, l’espérance de rendement par unité engagée est :\n\nEV = (probabilité de réussite × cote décimale) − 1.\n\nUne probabilité de victoire élevée n’implique pas nécessairement une cote intéressante.\n\nComparer les lignes d’ouverture, les lignes actuelles et leurs variations lorsque ces données sont disponibles. Une variation de cote n’est pas automatiquement une preuve de mouvement de parieurs professionnels.\n\n12. ANALYSE CONTRADICTOIRE OBLIGATOIRE\n\nAvant de valider un pronostic, adopter le rôle d’un analyste opposé.\n\nRechercher activement :\n\n* Trois raisons majeures pour lesquelles la projection pourrait être incorrecte.\n* Une hypothèse trop optimiste.\n* Une variable importante potentiellement oubliée.\n* Une information qui pourrait changer la prévision.\n* Une possible surestimation de la forme récente.\n* Un problème de données ou de taille d’échantillon.\n* Une corrélation traitée à tort comme une causalité.\n* Un désaccord significatif entre les modèles.\n\nRéviser la projection seulement si des éléments nouveaux et justifiés le nécessitent.\n\n13. DÉCISION FINALE ET ABSTENTION\n\nClasser la qualité du pronostic selon :\n\n* Complétude des données.\n* Fiabilité des effectifs annoncés.\n* Stabilité des modèles.\n* Dispersion des scénarios.\n* Calibration historique.\n* Sensibilité aux changements de composition.\n* Écart avec le marché.\n* Robustesse après analyse contradictoire.\n\nNe jamais attribuer un niveau de confiance élevé simplement parce que plusieurs indicateurs racontent la même histoire.\n\nUne décision d’abstention est obligatoire lorsque les données essentielles manquent, qu’une incertitude majeure n’est pas résolue ou qu’aucun avantage statistique suffisamment robuste n’est démontré.\n\n14. RAPPORT FINAL OBLIGATOIRE\n\nPour chaque match analysé, produire le rapport suivant.\n\nFICHE MATCH\n\n* Rencontre :\n* Date et heure :\n* Heure de dernière mise à jour :\n* Sources utilisées :\n* Statut de disponibilité des joueurs :\n* Qualité des données :\n\nCOMPARAISON DES ÉQUIPES\n\nAfficher un tableau comparatif des principales statistiques offensives, défensives, du rythme, des quatre facteurs et de la forme récente.\n\nIMPACT DES BLESSURES\n\nAfficher un tableau avec :\n\n* Joueur concerné.\n* Statut.\n* Importance estimée.\n* Remplaçant probable.\n* Variation estimée du différentiel de points, si calculable.\n* Conséquences tactiques.\n* Niveau d’incertitude.\n\nFACTEURS DÉTERMINANTS\n\nIdentifier les cinq facteurs ayant le plus d’influence sur le match. Pour chacun, indiquer :\n\n* Sens de l’avantage.\n* Ampleur estimée de l’effet, si mesurable.\n* Niveau de preuve.\n* Risque d’erreur.\n\nPROJECTION CHIFFRÉE\n\n* Score moyen projeté.\n* Écart moyen projeté.\n* Total moyen projeté.\n* Probabilité de victoire de chaque équipe.\n* Intervalles de prédiction.\n* Principaux scénarios alternatifs.\n* Niveau de confiance du modèle.\n\nANALYSE DES MARCHÉS\n\nPrésenter, uniquement avec des données disponibles et vérifiées :\n\nMarché\tProjection\tLigne réelle\tProbabilité\tEV estimée\tDécision\nMoneyline\t\t\t\t\t\nSpread\t\t\t\t\t\nTotal\t\t\t\t\t\n\nCONCLUSION\n\nRépondre clairement :\n\n1. Qui est favori et pourquoi ?\n\n2. Quel scénario de match est le plus probable ?\n\n3. Quel élément pourrait faire basculer la rencontre ?\n\n4. Quel est le pronostic statistiquement le mieux étayé ?\n\n5. Existe-t-il un avantage démontré par rapport au marché ?\n\n6. Faut-il retenir ce match ou s’abstenir ?\n\nTerminer par une phrase synthétique distinguant la prévision sportive, la confiance du modèle et l’intérêt éventuel du marché.\n\n15. AMÉLIORATION CONTINUE DU SYSTÈME\n\nAprès chaque rencontre terminée, enregistrer :\n\n* La prédiction initiale horodatée.\n* Les probabilités et intervalles publiés.\n* Le résultat réel.\n* Les écarts de projection.\n* Les compositions et blessures finalement confirmées.\n* Les variations de lignes.\n* Les facteurs ayant expliqué les écarts.\n* Les erreurs récurrentes du modèle.\n\nÉvaluer régulièrement :\n\n* Brier Score.\n* Log Loss.\n* Calibration des probabilités.\n* Erreur absolue moyenne sur les scores, marges et totaux.\n* Performances sur Moneyline, Spread et Totals.\n* Performance par niveau de confiance.\n* Résultats par contexte (repos, blessures, favoris, outsiders).\n* Closing Line Value.\n* Rendement historique net, lorsque les cotes et décisions horodatées sont conservées.\n\nEffectuer les validations sur des périodes chronologiques non utilisées pour entraîner le modèle.\n\nComparer le modèle à des références simples, comme les probabilités déduites du marché et un modèle collectif de base.\n\nIdentifier les variables qui améliorent réellement les performances hors échantillon. Supprimer ou réduire celles qui ajoutent de la complexité sans gain démontré.\n\nOBJECTIF FINAL : devenir progressivement plus fiable grâce à la mesure des erreurs, et non grâce à une confiance artificiellement élevée.\n\n⸻\n\n16. ORDRE D’EXÉCUTION\n\nQuand je te communique une rencontre NBA :\n\n1. Collecte les informations.\n2. Vérifie les blessures et les compositions.\n3. Analyse les équipes et les joueurs.\n4. Évalue les matchups et le calendrier.\n5. Construis les scénarios.\n6. Calcule les projections avec les outils réellement disponibles.\n7. Compare les modèles et les cotes.\n8. Recherche les raisons pour lesquelles tu pourrais te tromper.\n9. Émets le rapport final.\n10. Indique les éléments à revérifier avant le coup d’envoi.\n\nNe saute aucune étape critique.\n\nInstruction ultime : privilégie toujours la fiabilité statistique à la quantité de pronostics. Une analyse sans recommandation vaut mieux qu’une prédiction apparemment précise mais insuffisamment fondée.\n\nEXTENSION OPÉRATIONNELLE DU 10 NOVEMBRE 2026 - DONNÉES DE RÔLE\nLes collectes et recherches restent espacées de six heures. La nouvelle version conserve les absences, les restrictions de minutes et les compositions comme preuves distinctes ; le modèle de rotation est testé en parallèle sans remplacement automatique du modèle principal.\nDans max-research-v1, ajouter seulement si réellement confirmé un tableau verified_role_facts : match_id ESPN exact, event_start exact, team_id ESPN, player_id ESPN confirmé dans l’effectif actuel, player, minutes_limit numérique entre 0 et 48 et/ou starter booléen, source_url NBA officielle figurant dans sources avec kind OFFICIAL, checked_at ISO réel avant le tip. Ne pas convertir une disponibilité incertaine en restriction de minutes inventée. En l’absence de preuve, laisser le champ vide et préciser le manque. Les noms de joueurs sont rapprochés sur leurs mots normalisés, dans la même équipe ; aucune confusion Jalen/Jaylin ni rapprochement flou.\n"; // méthode publique, lue par MacFly depuis GitHub.
const VERSION='max-independent-0.9.0';
const TRIAL_KEY='max:trial:metrics:'+TRIAL_VERSION;
const BOXES_PER_CYCLE=8;
const KEY_METRICS='max:metrics:predictions';
const KEY_PLAYER_METRICS='max:metrics:player-points';
const KEY_ARCHIVE='max:archive:progress';
// Archives isolées de la prédiction live : pas de fuite des résultats futurs.
const ARCHIVE_SEASONS=[
 {season:'2024-25',start:'20241022',end:'20250630'},
 {season:'2025-26',start:'20251021',end:'20260630'}
];
const ARCHIVE_PER_CYCLE=2;
const ESPN='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const KEY_HEALTH='max:health:last';
const KEY_SLATE='max:slate:latest';
const KEY_EVENTS='max:events:latest';
const DAY_MS=86400000;
const HISTORY_DAYS=45;
const HISTORY_PER_CYCLE=4;
const GAME_CACHE_TTL=86400*90;
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
function dateKey(now,days=0){return new Date(now.getTime()+days*DAY_MS).toISOString().slice(0,10).replace(/-/g,'');}
export function slateDates(now){return [-1,0,1].map(i=>dateKey(now,i));}
function validGame(game){return game&&game.id&&game.start&&game.home?.id&&game.away?.id;}
function injurySignature(rows){return Array.isArray(rows)?rows.map(i=>[i.player,i.status,i.detail].join(':')).join('|'):'SOURCE_UNCONFIRMED';}
export function detectChange(old,current){
 if(!old)return null;
 const changes=[];
 if(old.status!==current.status)changes.push('STATUT_MATCH');
 if(injurySignature(old.injuries?.home)!==injurySignature(current.injuries?.home)
  ||injurySignature(old.injuries?.away)!==injurySignature(current.injuries?.away))
  changes.push('RAPPORT_BLESSURES');
 return changes.length?changes:null;
}
export function changesForGame(prior,current){
 if(!prior||!prior.independent_analysis)return []; // old schema: migration != injury news
 const changes=detectChange(prior,current)??[];
 const oldResearch=prior.research_fingerprint??prior.research?.generated_at??null;
 const newResearch=current.research_fingerprint??current.research?.generated_at??null;
 if(oldResearch!==newResearch)changes.push('RECHERCHE_MACFLY');
 const medicalSignature=g=>g.official_medical?JSON.stringify(['home','away'].map(side=>{
  const t=g.official_medical.teams[side];return [t?.status,(t?.players??[]).map(p=>[p.player,p.status]).sort()];
 })):null;
 if(prior.official_medical&&current.official_medical&&medicalSignature(prior)!==medicalSignature(current))changes.push('BULLETIN_NBA');
 return changes;
}
async function read(kv,key){try{return await kv.get(key,{type:'json'});}catch{return null;}}
async function put(kv,key,obj,ttl=GAME_CACHE_TTL){
 await kv.put(key,JSON.stringify(obj),{expirationTtl:ttl});
}
async function sourceJSON(fetcher,path,timeout=12500){
 const url=ESPN+path;
 const r=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeout)});
 if(!r.ok)throw new Error('PROVIDER_HTTP_'+r.status);
 const v=await r.json();
 if(!v||typeof v!=='object')throw new Error('PROVIDER_INVALID_JSON');
 v._fetched_at=new Date().toISOString();
 return v;
}
function utcDay(s){return Date.UTC(Number(s.slice(0,4)),Number(s.slice(4,6))-1,Number(s.slice(6,8)));}
function nextArchiveDay(s){return new Date(utcDay(s)+DAY_MS).toISOString().slice(0,10).replace(/-/g,'');}
function archiveTarget(){return ARCHIVE_SEASONS.reduce((sum,s)=>sum+1+Math.round((utcDay(s.end)-utcDay(s.start))/DAY_MS),0);}
function cachedArchiveProgress(progress){
 const complete=progress?.saved_days>=archiveTarget()&&progress?.next_date>ARCHIVE_SEASONS.at(-1).end;
 return {state:complete?'COMPLETE':progress?.last_error?'RETRY_PAUSED':'WARMING',
  days:progress?.saved_days??0,target:archiveTarget(),games:progress?.saved_games??0,
  current_season:complete?null:ARCHIVE_SEASONS[progress?.season_index??0]?.season??null,
  next_date:progress?.next_date??ARCHIVE_SEASONS[0].start,advanced:0,
  last_error:progress?.last_error??null};
}
export async function archiveStep(kv,fetcher,nowISO,errors=[]){
 const prior=await read(kv,KEY_ARCHIVE);
 const p=prior&&Number.isInteger(prior.season_index)&&Number.isInteger(prior.saved_days)?{...prior}:
  {season_index:0,next_date:ARCHIVE_SEASONS[0].start,saved_days:0,saved_games:0};
 const target=archiveTarget();
 if(p.season_index>=ARCHIVE_SEASONS.length)
  return {state:'COMPLETE',days:p.saved_days,target,games:p.saved_games};
 // Réessayer les échecs seulement après 1h : ne jamais insister sur une source en panne.
 if(p.last_error_at&&Date.parse(nowISO)-Date.parse(p.last_error_at)<3600000)
  return {state:'RETRY_PAUSED',days:p.saved_days,target,games:p.saved_games,last_error:p.last_error};
 let advanced=0;
 for(let i=0;i<ARCHIVE_PER_CYCLE;i++){
  let season=ARCHIVE_SEASONS[p.season_index];
  if(!season)break;
  if(p.next_date>season.end){
   p.season_index++;season=ARCHIVE_SEASONS[p.season_index];
   if(!season)break;
   p.next_date=season.start;
  }
  const key=p.next_date;
  try{
   const raw=await sourceJSON(fetcher,'/scoreboard?dates='+key+'&limit=25',12500);
   if(!Array.isArray(raw.events))throw Error('ARCHIVE_RESPONSE_INVALID');
   const games=parseESPNScoreboards([raw]);
   await put(kv,'max:archive:scoreboard:'+key,{date:key,season:season.season,
    games,source:'ESPN scoreboard',saved_at:nowISO},86400*365*3);
   p.saved_days++;p.saved_games+=games.length;p.next_date=nextArchiveDay(key);
   p.last_success=nowISO;p.last_error=null;p.last_error_at=null;
   advanced++;
  }catch(err){
   p.last_error=String(err?.message??'ARCHIVE_UNKNOWN').slice(0,100);
   p.last_error_at=nowISO;
   errors.push('ARCHIVE:'+key+':'+p.last_error);
   break;
  }
 }
 if(advanced||p.last_error_at||p.season_index!==prior?.season_index)await put(kv,KEY_ARCHIVE,p,86400*365*3);
 return {state:p.season_index>=ARCHIVE_SEASONS.length?'COMPLETE':p.last_error_at?'ERROR':'WARMING',
  days:p.saved_days,target,games:p.saved_games,
  current_season:ARCHIVE_SEASONS[p.season_index]?.season??null,
  next_date:p.next_date,advanced,last_error:p.last_error??null};
}
function recoverInjury(report,previous,nowMS) {
 if(report)return {value:report,age_min:0,state:'OK'};
 const oldMS=Date.parse(previous?.captured_at??'');
 const age=Number.isFinite(oldMS)?Math.floor((nowMS-oldMS)/60000):null;
 return {value:age!==null&&age>=0&&age<=90?previous?.report:null,
  age_min:age,state:'ERROR'};
}
function currentCheckpoint(game,nowMs){
 const hours=(Date.parse(game.start)-nowMs)/3600000;
 if(hours<=0||hours>26||String(game.status).includes('FINAL'))return null;
 return hours<=6.25?'H6':hours<=24.25?'H24':null;
}
function sanitizeText(x,max=400){return typeof x==='string'?x.slice(0,max):'';}
function forAI(game){
 return {snapshot_time:game.checked_at,match_id:game.id,
  start:game.start,teams:{home:game.home,away:game.away},
  injuries:game.injuries,
  statistical_analysis:game.independent_analysis,
  context_status:game.coverage,
  verified_sources:game.sources};
}
/**
 * MacFly se lance dans ChatGPT (automation séparée), pas dans un appel API facturé.
 * Les recherches sont écrites dans le KV Max par l'automatisation autorisée.
 * On n'accepte que les rapports sourcés, récents et émis avant tip-off.
 */
export function validateResearch(record,game,nowISO) {
 if(!record||typeof record!=='object'||record.schema_version!=='max-research-v1')return null;
 if(String(record.match_id)!==String(game.id))return null;
 const published=Date.parse(record.generated_at),now=Date.parse(nowISO),tip=Date.parse(game.start);
 if(!Number.isFinite(now)||!Number.isFinite(tip)||!Number.isFinite(published)||
  published>now||now-published>RESEARCH_MAX_AGE_MS)return null;
 if(Number.isFinite(tip)&&published>=tip)return null; // pas de rétroprediction
 if(!Array.isArray(record.sources)||!record.sources.length)return null;
 const sources=record.sources.filter(s=>
  s&&typeof s.url==='string'&&/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(s.url)
  &&typeof s.title==='string'&&typeof s.checked_at==='string'
  &&Number.isFinite(Date.parse(s.checked_at))
  &&Date.parse(s.checked_at)<=now
  &&Date.parse(s.checked_at)<=published+5*60000
 ).slice(0,16).map(s=>({url:s.url.slice(0,400),title:s.title.slice(0,150),
   checked_at:s.checked_at,kind:String(s.kind??'PUBLIC').slice(0,40)}));
 if(!sources.length)return null;
 const summary=sanitizeText(record.summary,2000);
 if(!summary)return null;
 const rows=Array.isArray(record.sections)?record.sections:[];
 const sections=rows.slice(0,16).map(s=>({
  section_id:Number(s?.section_id)||0,
  title:sanitizeText(s?.title,100),
  status:['VERIFIED','PARTIAL','UNAVAILABLE','CONFLICT'].includes(s?.status)?s.status:'UNAVAILABLE',
  findings:Array.isArray(s?.findings)?s.findings.slice(0,8).map(v=>sanitizeText(v,300)):[],
  missing:Array.isArray(s?.missing)?s.missing.slice(0,8).map(v=>sanitizeText(v,150)):[]
 })).filter(s=>s.section_id>=1&&s.section_id<=16);
 const unique=new Set(sections.map(s=>s.section_id));
 const full=unique.size===16;
 // Le flux ESPN générique n'est pas une confirmation pour CE match.
 // Accepter les statuts officiels structurés par MacFly uniquement si
 // match, équipes, heure et PDF NBA officiel correspondent.
 const allowed=new Set(['OUT','QUESTIONABLE','DOUBTFUL','AVAILABLE','PROBABLE','LIMITED']);
 const verified_injuries=Array.isArray(record.verified_injuries)?
  record.verified_injuries.slice(0,30).filter(item=>{
   if(!item||typeof item.player!=='string'||item.player.length<2||
    String(item.match_id)!==String(game.id)||item.event_start!==game.start||
    ![String(game.home.id),String(game.away.id)].includes(String(item.team_id))||
    !allowed.has(item.status)||typeof item.source_url!=='string')return false;
   const matching=sources.find(x=>x.url===item.source_url&&x.kind==='OFFICIAL');
   if(!matching||!(/^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\//.test(matching.url)||
     /^https:\/\/official\.nba\.com\/nba-injury-report-/.test(matching.url)))return false;
   const checked=Date.parse(item.checked_at);
   return Number.isFinite(checked)&&checked<=published+300000&&checked<=now&&checked<tip&&
    now-checked<=RESEARCH_MAX_AGE_MS;
  }).map(item=>({match_id:String(game.id),team_id:String(item.team_id),
   player:sanitizeText(item.player,100),status:item.status,event_start:game.start,
   source_url:item.source_url,checked_at:item.checked_at,note:sanitizeText(item.note,200)})):[];
 return {schema_version:record.schema_version,match_id:String(record.match_id),
  generated_at:new Date(published).toISOString(),sources,summary,
  verified_injuries,verified_role_facts:validateRoleFacts(record,game,nowISO),
  key_risks:Array.isArray(record.key_risks)?record.key_risks.slice(0,6).map(s=>sanitizeText(s,250)):[],
  recheck:Array.isArray(record.recheck)?record.recheck.slice(0,8).map(s=>sanitizeText(s,250)):[],
  sections,coverage_sections:unique.size,
  status:full&&sections.every(s=>s.status==='VERIFIED')?'RESEARCH_COMPLETE':'RESEARCH_PARTIAL',
  drives_decision:false,web_sources_checked:sources.length};
}
function researchDiagnostics(raw,validated,nowISO,game){
 const published=Date.parse(raw?.generated_at??''),now=Date.parse(nowISO);
 const age=Number.isFinite(published)?Math.round((now-published)/60000):null;
 const matching=raw?.schema_version==='max-research-v1'&&String(raw.match_id)===String(game.id);
 const state=validated?'AVAILABLE':!raw?'MISSING':!matching?'INVALID':
  published>=Date.parse(game.start)?'POST_TIP':
  Number.isFinite(published)&&now-published>RESEARCH_MAX_AGE_MS?'EXPIRED':'INVALID';
 return {state,generated_at:Number.isFinite(published)?new Date(published).toISOString():null,
  age_minutes:age,expires_at:Number.isFinite(published)?new Date(published+RESEARCH_MAX_AGE_MS).toISOString():null,
  official_injuries_accepted:validated?.verified_injuries.length??0,
  official_injuries_rejected:Math.max(0,(Array.isArray(raw?.verified_injuries)?raw.verified_injuries.length:0)-
   (validated?.verified_injuries.length??0))};
}
export async function collect(env,fetcher=fetch,now=new Date()){
 if(!env?.MAX_STATE)throw new Error('MAX_STATE_MISSING');
 const kv=env.MAX_STATE,nowMs=now.getTime(),nowISO=now.toISOString();
 const monotonicStart=performance.now();
 const completionTime=()=>new Date(nowMs+Math.max(0,performance.now()-monotonicStart)).toISOString();
 const dates=slateDates(now);
 const responses=await Promise.allSettled([
  ...dates.map(d=>sourceJSON(fetcher,'/scoreboard?dates='+d+'&limit=25')),
  sourceJSON(fetcher,'/injuries',13000)
 ]);
 const slateData=responses.slice(0,3).filter(x=>x.status==='fulfilled'&&Array.isArray(x.value.events))
  .map(x=>x.value);
 const injuryRaw=responses[3].status==='fulfilled'?responses[3].value:null;
 const report=parseESPNInjuries(injuryRaw);
 const sources={scoreboard:{state:slateData.length?'OK':'ERROR',success:slateData.length,expected:3,
    base:'ESPN direct'},
   injuries:{state:report?'OK':'ERROR',source:'ESPN direct',checked_at:report?nowISO:null},
   historic:{state:'PENDING',days_loaded:0,target:HISTORY_DAYS}};
 const errors=responses.map((x,i)=>x.status==='rejected'?'SOURCE_'+i+':'+String(x.reason?.message??'FETCH_FAILED').slice(0,75):null).filter(Boolean);
 const previousHealth=await read(kv,KEY_HEALTH);
 const health={version:VERSION,engine_version:ENGINE_VERSION,cadence:cadenceMetadata(nowISO),last_attempt:nowISO,
  last_success:previousHealth?.last_success??null,sources,errors,game_count:previousHealth?.game_count??0};
 if(!slateData.length){
  await put(kv,KEY_HEALTH,health,86400*7);
  return {...health,updated:false};
 }
 const cachedInjury=await read(kv,'max:injuries:cached');
 const injury=recoverInjury(report,cachedInjury,nowMs);
 if(report){
  const unchanged=JSON.stringify(report.by_team)===JSON.stringify(cachedInjury?.report?.by_team);
  if(!unchanged||nowMs-Date.parse(cachedInjury?.captured_at??'')>=30*60000)
   await put(kv,'max:injuries:cached',{captured_at:nowISO,report},86400*3);
 }
 const coreGames=parseESPNScoreboards(slateData).filter(validGame);
 let officialTable=null;
 try{
  officialTable=await collectOfficial(fetcher,nowISO);
  await put(kv,'max:official:last',officialTable,86400*3);
  sources.official_medical={state:'OK',published_at:officialTable.published_at,
   checked_at:nowISO,source_url:officialTable.url,players:officialTable.players};
 }catch{
  const old=await read(kv,'max:official:last');
  const age=nowMs-Date.parse(old?.checked_at??'');
  if(age>=0&&age<=12*3600000)officialTable=old;
  sources.official_medical={state:officialTable?'CACHED_AFTER_ERROR':'UNAVAILABLE',
   checked_at:officialTable?.checked_at??null,source_url:officialTable?.url??null};
 }
 const rosterResult=await collectRosters(kv,fetcher,coreGames,nowISO);
 sources.rosters={state:rosterResult.state,requested:rosterResult.requested,
  available:rosterResult.available,fetched:rosterResult.fetched,failed:rosterResult.failed};
 const historyRaw=[];
 const fetchDates=[];
 let cachedHistoryDays=0;
 const historicDays=Array.from({length:HISTORY_DAYS},(_,i)=>dateKey(now,-i-2));
 const historicCache=await Promise.all(historicDays.map(day=>read(kv,'max:scoreboard:'+day)));
 for(let i=0;i<historicDays.length;i++){
  const day=historicDays[i],snapshot=historicCache[i];
  if(snapshot?.date===day&&Array.isArray(snapshot.games)){
   cachedHistoryDays++;historyRaw.push(...snapshot.games);
  }else if(fetchDates.length<HISTORY_PER_CYCLE)fetchDates.push(day);
 }
 const fetched=await Promise.allSettled(fetchDates.map(async d=>{
  const raw=await sourceJSON(fetcher,'/scoreboard?dates='+d+'&limit=25');
  if(!Array.isArray(raw.events))throw new Error('BAD_SCOREBOARD_SHAPE');
  const games=parseESPNScoreboards([raw]);
  await put(kv,'max:scoreboard:'+d,{date:d,games,saved_at:nowISO},86400*90);
  return {date:d,games};
 }));
 for(const x of fetched)if(x.status==='fulfilled')historyRaw.push(...x.value.games);
 for(const x of fetched)if(x.status==='rejected')errors.push('HISTORY:'+String(x.reason?.message??'ERROR').slice(0,65));
 const loaded=cachedHistoryDays+fetched.filter(x=>x.status==='fulfilled').length;
 sources.historic={state:loaded>=HISTORY_DAYS?'OK':loaded>=10?'PARTIAL':'WARMING',
  days_loaded:loaded,target:HISTORY_DAYS,source:'ESPN direct'};
 const combined=new Map();
 for(const x of [...historyRaw,...coreGames])if(validGame(x))combined.set(x.id,x);
 const historical=[...combined.values()];
 // Enrichissement des statistiques avec deux vrais boxscores par collecte,
 // contrôles de cohérence et cache indépendant des autres Workers.
 const candidates=verifiedFinalGames(historical,nowISO)
  .sort((a,b)=>b.start.localeCompare(a.start)).slice(0,150);
 const boxes=[],pending=[],missing=[],detailRefresh=[];
 const cachedBoxes=await Promise.all(candidates.map(x=>read(kv,'max:box:'+x.id)));
 for(let i=0;i<candidates.length;i++){
  const x=candidates[i],cached=cachedBoxes[i];
  if(cached?.schema_version==='max-box-v1'&&cached.game_id===x.id){
   boxes.push(cached);if(cached.detail_fields_version!==2)detailRefresh.push(x);
  }
  else missing.push(x);
 }
 // Prioriser les boxscores des équipes QUI JOUENT PROCHAINEMENT plutôt que
 // collecter indifféremment les derniers matchs de toutes les franchises.
 const nextGames=coreGames.filter(x=>Date.parse(x.start)>nowMs&&
  Date.parse(x.start)-nowMs<=48*3600000&&x.status==='STATUS_SCHEDULED');
 const relevant=new Map();
 for(const x of nextGames){
  const hours=(Date.parse(x.start)-nowMs)/3600000;
  for(const id of [String(x.home.id),String(x.away.id)]){
   const prev=relevant.get(id);
   relevant.set(id,Math.min(prev??99,hours));
  }
 }
 const already=new Map();
 for(const box of boxes)for(const id of [String(box.home_id),String(box.away_id)])
  already.set(id,(already.get(id)??0)+1);
 const skipped=new Set();
 for(let i=0;i<BOXES_PER_CYCLE;i++){
  const ranked=[...missing,...detailRefresh].filter(x=>!skipped.has(x.id)).sort((a,b)=>{
   const rank=x=>{
    let priority=0;
    for(const id of [String(x.home.id),String(x.away.id)]){
     const hours=relevant.get(id);
     if(hours!==undefined)priority+=(8-Math.min(7,already.get(id)??0))*
      (1.2-0.4*hours/48)*100;
    }
    return (missing.some(g=>g.id===x.id)?1000000:0)+priority+Date.parse(x.start)/8640000000;
   };
   return rank(b)-rank(a);
  });
  let selected=null;
  for(const x of ranked)if(!await read(kv,'max:box:failed:'+x.id)){
   selected=x;break;
  }else skipped.add(x.id);
  if(!selected)break;
  pending.push(selected);skipped.add(selected.id);
  for(const id of [String(selected.home.id),String(selected.away.id)])
   already.set(id,(already.get(id)??0)+1);
 }
 let newBoxes=0;
 for(const x of pending){
  try{
   const raw=await sourceJSON(fetcher,'/summary?event='+x.id,12000);
   const box=parseBoxscore(raw,x);
   if(!box)throw new Error('BOXSCORE_INVALID_OR_INCOMPLETE');
   await put(kv,'max:box:'+x.id,box,86400*120);
   const previousBox=boxes.findIndex(b=>b.game_id===box.game_id);
   if(previousBox>=0)boxes[previousBox]=box;else boxes.push(box);newBoxes++;
  }catch(err){
   errors.push('BOX:'+x.id+':'+String(err?.message??'FAILED').slice(0,60));
   await put(kv,'max:box:failed:'+x.id,{at:nowISO,reason:String(err?.message??'FAILED').slice(0,80)},86400);
  }
 }
 sources.player_boxes={state:candidates.length>0&&boxes.length===candidates.length?'OK':boxes.length?'PARTIAL':'WARMING',
  cached:boxes.length,possible:candidates.length,fetched:newBoxes,
  detailed:boxes.filter(b=>b.detail_fields_version===2).length,
  scope:'RECENT_FINAL_CANDIDATES',missing:Math.max(0,candidates.length-boxes.length),
  source:'ESPN game summary',checked_at:nowISO};
 // La formule Cloudflare KV Free limite les écritures quotidiennes :
 // archives 2 jours / 30 min (au lieu de chaque cycle 15 min) ; priorité
 // aux boxscores des matches imminents et aux prévisions pré-match.
 const archive=now.getUTCMinutes()%30===0?
  await archiveStep(kv,fetcher,nowISO,errors):
  cachedArchiveProgress(await read(kv,KEY_ARCHIVE));
 sources.archive={...archive,source:'ESPN historical scoreboard',
  label:'Training/backtest archive only; excluded from live forecast to prevent leakage'};
 const playerBoxes=rosterFilteredBoxes(boxes,rosterResult.rosters);
 const previousEvents=await read(kv,KEY_EVENTS);
 const events=Array.isArray(previousEvents)?previousEvents.slice(0,50):[];
 const games=[];let changed=0,researchCount=0;
 let monteCarloRun=0,monteCarloReuse=0;
 const activeGames=coreGames.slice(0,40);
 const [priors,researches]=await Promise.all([
  Promise.all(activeGames.map(x=>read(kv,'max:game:'+x.id))),
  Promise.all(activeGames.map(x=>read(kv,'max:research:'+x.id)))
 ]);
 const gameWrites=[];const deferredHistory=[];
 const priorAudit=await read(kv,'max:audit:errors:latest');const auditRows=new Map((priorAudit?.records??[]).map(r=>[r.match_id,r]));let auditChanged=false;
 const oldTrials=await read(kv,TRIAL_KEY);const trialRows=oldTrials?.records?.slice(-120)??[];let newTrials=0;
 const [oldMetrics,oldPlayerMetrics]=await Promise.all([read(kv,KEY_METRICS),read(kv,KEY_PLAYER_METRICS)]);
 const metricsRows=Array.isArray(oldMetrics?.records)?oldMetrics.records.slice(-120):[];
 const playerRows=Array.isArray(oldPlayerMetrics?.records)?oldPlayerMetrics.records.slice(-60):[];
 let newEvaluations=0,newPlayerEvaluations=0;
 for(let gameIndex=0;gameIndex<activeGames.length;gameIndex++){
  const sourceGame=activeGames[gameIndex],prior=priors[gameIndex];
  const statistical=analyzeNBA(sourceGame,historical,injury.value,nowISO);
  let isPregame=statistical.pregame;
  let inputSignature=isPregame?
   forecastInputSignature(sourceGame,historical,boxes,ADVANCED_VERSION):null;
  const reusable=isPregame&&canReuseForecast(prior,inputSignature,sourceGame,nowISO);
  let forecast=reusable?prior.independent_analysis.advanced.forecast:
   forecastGame(sourceGame,historical,boxes,nowISO);
  if(forecast.simulated_runs===50000){
   if(reusable)monteCarloReuse++;else monteCarloRun++;
  }
  let rawResearch=researches[gameIndex];
  let verifiedResearch=validateResearch(rawResearch,sourceGame,nowISO);
  if(verifiedResearch)researchCount++;
  const medical=officialForGame(officialTable,sourceGame,nowISO);
  if(forecast.advanced&&['home','away'].every(s=>['off_rating','def_rating','possessions'].every(k=>Number.isFinite(forecast.advanced[s]?.[k]))))
   statistical.missing=statistical.missing.filter(x=>x!=='OFF_DEF_RATING_PACE_NON_COLLECTES').concat('RATINGS_ESTIMES_NON_AJUSTES');
  const editorialOfficial=verifiedResearch?.verified_injuries??[];
  const official=[];
  for(const side of ['home','away']){
   const direct=medical?.teams?.[side];
   const editorial=editorialOfficial.filter(x=>x.team_id===String(sourceGame[side].id));
   const editorialNewest=Math.max(0,...editorial.map(x=>Date.parse(reportTimestamp(x.source_url)??x.checked_at)));
   if(direct&&Date.parse(medical.published_at)>=editorialNewest){
    if(direct.status==='SUBMITTED')official.push(...direct.players);
   }else official.push(...editorial);
  }
  const perTeam=id=>official.filter(x=>x.team_id===String(id)).map(x=>({player:x.player,status:x.status}));
  const rotations=statistical.pregame?{
   home:rotationAnalysis(sourceGame.home.id,playerBoxes,perTeam(sourceGame.home.id),sourceGame.start),
   away:rotationAnalysis(sourceGame.away.id,playerBoxes,perTeam(sourceGame.away.id),sourceGame.start)
  }:null;
  let playerPoints=projectPlayerPoints(sourceGame,playerBoxes,statistical.injuries,
   official,forecast,nowISO);
  let study = null;
  if (isPregame && env.MAX_JOURNAL) {
   const ctx = contextForStudy(sourceGame,nowISO,inputSignature,forecast,statistical.injuries,medical,
    playerBoxes,rosterResult.rosters,rawResearch);
   study = await refreshStudy(env.MAX_JOURNAL,ctx,validateResearch,{persistContext:true});
   if (study?.research) { if(!verifiedResearch)researchCount++; verifiedResearch=study.research; rawResearch=study.raw; }
   if (study?.points) {
    playerPoints=study.points;
    official.splice(0,official.length,...study.official);
   }
  }
  const completedAt=completionTime();
  if(isPregame&&Date.parse(completedAt)>=Date.parse(sourceGame.start)){
   isPregame=false;inputSignature=null;statistical.pregame=false;statistical.elo=null;
   forecast={status:'NO_PREMATCH',simulated_runs:0,calibrated:false};
   playerPoints={status:'NO_PREMATCH',calibrated:false,home:[],away:[]};
  }
  const advanced={version:ADVANCED_VERSION,player_points_version:POINTS_VERSION,
   forecast,forecast_signature:inputSignature,
   forecast_calculated_at:reusable?
    prior.independent_analysis.advanced.forecast_calculated_at??null:completedAt,
   player_points:playerPoints,rotations,
   official_injuries_count:official.length,
   source_games:historical.length,boxscore_games:boxes.length,calibrated:false};
  const g={...sourceGame,checked_at:nowISO,official_medical:medical,
   injuries:{...statistical.injuries,source:'ESPN direct',
    source_status:injury.state,cache_age_minutes:injury.age_min},
   independent_analysis:{...statistical,advanced},
   quantitative_version:POINTS_VERSION,
   coverage:{status:statistical.status,missing:statistical.missing,
    forecast_status:forecast.status,player_points_status:playerPoints.status,
    boxes_available:boxes.length,official_injuries_count:official.length},
   sources:{matches:'ESPN direct',injuries:'ESPN direct',
     stats:'ESPN scoreboard 45 days + verified ESPN player boxes',research:'MacFly / sources publiques tracées'},
   research:verifiedResearch,
   research_diagnostics:researchDiagnostics(rawResearch,verifiedResearch,nowISO,sourceGame),
   research_fingerprint:verifiedResearch?.generated_at??null,
   ai_review:verifiedResearch?{...verifiedResearch,
     model:'MacFly · ChatGPT',web_search_enabled:true}:null};
  if(study?.card)g.study=study.card;
  if(isPregame)advanced.rotation_trial=study?.trial??rotationTrial(sourceGame,playerBoxes,rosterResult.rosters,official,verifiedResearch?.verified_role_facts??[],{...forecast,engine_version:ADVANCED_VERSION},completedAt,medical);
  advanced.official_injuries_matched=official.filter(p=>{const roster=rosterResult.rosters.get(String(p.team_id));return (roster?.players??[]).filter(x=>playerIdentity(x.name)===playerIdentity(p.player)).length===1;}).length;
  advanced.unmatched_official_names=official.filter(p=>{const roster=rosterResult.rosters.get(String(p.team_id));return !(roster?.players??[]).some(x=>playerIdentity(x.name)===playerIdentity(p.player));}).map(p=>({team_id:p.team_id,player:p.player,status:p.status}));
  advanced.data_gaps={starters_confirmed:['home','away'].every(side=>(verifiedResearch?.verified_role_facts??[]).filter(f=>f.starter===true&&f.team_id===String(sourceGame[side].id)).length===5),
   minutes_limits_confirmed:verifiedResearch?.verified_role_facts?.some(f=>Number.isFinite(f.minutes_limit))??false,
   medical_complete:['home','away'].every(s=>medical?.teams[s]?.status==='SUBMITTED'),
   opponent_adjusted_ratings:false,travel_measured:false,winamax_observed:false};
  const changes=changesForGame(prior,g);
  g.source_changes=changes;
  // Une alerte entrée entre deux passages MacFly reste "à revérifier"
  // jusqu'à ce qu'un rapport PLUS récent soit réellement écrit.
  const hadSourceSignal=changes.includes('STATUT_MATCH')||changes.includes('RAPPORT_BLESSURES')||changes.includes('BULLETIN_NBA');
  g.source_signal_at=hadSourceSignal?nowISO:prior?.source_signal_at??null;
  const sourceSignal=Date.parse(g.source_signal_at??'');
  const researched=Date.parse(verifiedResearch?.generated_at??'');
  const unresolvedSignal=Number.isFinite(sourceSignal)&&
   (!Number.isFinite(researched)||sourceSignal>researched);
  g.research_priority=researchPriority(g,verifiedResearch,nowISO,
   unresolvedSignal?['RAPPORT_BLESSURES']:[]);
  if(g.research_priority.due&&g.research_diagnostics.state==='EXPIRED'&&!unresolvedSignal&&
   Date.parse(g.research_diagnostics.generated_at)>=Date.parse(checkpointPhase(g,nowISO)?.entered_at))
   g.research_priority={...g.research_priority,action:'RECHECK',reason:'RAPPORT_EXPIRE',
    last_report_minutes:g.research_diagnostics.age_minutes};
  g.automatic_report=composeReport(g,historical,boxes,rosterResult.rosters,
   oldMetrics,oldPlayerMetrics,nowISO);
  if(changes.length){
   changed++;
   events.unshift({id:g.id,match:g.away.name+' @ '+g.home.name,changes,at:nowISO});
   deferredHistory.push({key:'max:history:'+g.id+':'+nowMs,value:{at:nowISO,changes,game:g}});
  }
  const snapshotTime=completionTime();
  const cp=isPregame?currentCheckpoint(g,Date.parse(snapshotTime)):null;
  if(isPregame&&Date.parse(snapshotTime)<Date.parse(g.start)){
   if(g.market_observation&&Date.parse(g.market_observation.observed_at)<Date.parse(g.start)){
    const key='max:market:'+g.id+':'+Math.floor(nowMs/(6*3600000));
    if(!(await read(kv,key)))await put(kv,key,{match_id:g.id,at:nowISO,quote:g.market_observation},86400*90);
   }
   for(const checkpoint of ['EARLIEST',...(cp?[cp]:[])]){
    const key='max:pre:'+g.id+':'+checkpoint;
    if(!(await read(kv,key)))await put(kv,key,{
     at:snapshotTime,checkpoint,game_id:g.id,model:statistical.elo,
     score_baseline:[statistical.home.last5.avg_for,statistical.away.last5.avg_against,
      statistical.away.last5.avg_for,statistical.home.last5.avg_against].every(Number.isFinite)?{
       home:(statistical.home.last5.avg_for+statistical.away.last5.avg_against)/2,
       away:(statistical.away.last5.avg_for+statistical.home.last5.avg_against)/2}:null,
     forecast:{...forecast,engine_version:ADVANCED_VERSION},
     market_observation:g.market_observation??null,
     context_status:statistical.status,injuries:statistical.injuries,
     analysis_schema:statistical.schema_version,drives_bet:false},86400*120);
   }
   for(const checkpoint of ['EARLIEST',...(cp?[cp]:[])]){
    const key='max:vpre:'+ADVANCED_VERSION+':'+g.id+':'+checkpoint;
    if(!(await read(kv,key))&&Date.parse(completionTime())<Date.parse(g.start))await put(kv,key,{
     at:completionTime(),checkpoint,game_id:g.id,forecast:{...forecast,engine_version:ADVANCED_VERSION},
     storage_key:key,player_points:playerPoints,official_injuries:official,verified_role_facts:verifiedResearch?.verified_role_facts??[],
     source_provenance:{medical:g.official_medical,rosters:['home','away'].map(side=>{const r=rosterResult.rosters.get(String(g[side].id));return r?{team_id:r.team_id,checked_at:r.checked_at,source_url:r.source_url}:null;})},
     drives_bet:false},86400*120);
    if(advanced.rotation_trial?.state==='SHADOW_FORECAST'){
     const trialKey='max:trial:pre:'+TRIAL_VERSION+':'+g.id+':'+checkpoint;
     if(!(await read(kv,trialKey))&&Date.parse(completionTime())<Date.parse(g.start))await put(kv,trialKey,{
      at:completionTime(),checkpoint,game_id:g.id,trial:advanced.rotation_trial},86400*120);
    }
   }
   // Prévisions joueurs figées, sans écraser les anciens relevés existants.
   for(const checkpoint of ['PLAYER_V1',...(cp?['PLAYER_'+cp]:[])]){
    const key='max:pre:'+g.id+':'+checkpoint;
    if(!(await read(kv,key)))await put(kv,key,{
     at:snapshotTime,checkpoint,game_id:g.id,forecast:{...forecast,engine_version:ADVANCED_VERSION},
     player_points:playerPoints,context_status:statistical.status,
     official_injuries:official,analysis_schema:'max-player-points-v1',drives_bet:false
    },86400*120);
   }
  }
  if(String(g.status).includes('FINAL')&&Number.isFinite(g.home.score)&&Number.isFinite(g.away.score)){
   const existing=await read(kv,'max:eval:'+g.id);
   if(!existing){
    for(const checkpoint of ['H30','H1','H3','H6','H24','EARLIEST']){
     const snap=await read(kv,'max:vpre:'+ADVANCED_VERSION+':'+g.id+':'+checkpoint)??await read(kv,'max:pre:'+g.id+':'+checkpoint);
     const evaluation=evaluatePregame(g,snap);
     if(evaluation){
      await put(kv,'max:eval:'+g.id,evaluation,86400*180);
      metricsRows.push(evaluation);newEvaluations++;
      if(!evaluation.correct){const playerSnap=snap.player_points?snap:await read(kv,'max:pre:'+g.id+':PLAYER_'+checkpoint);
       const diagnostic=analyzeFailure(g,snap,playerSnap,boxes.find(b=>b.game_id===g.id),historical,nowISO);
       if(diagnostic){auditRows.set(g.id,diagnostic);auditChanged=true;}
      }
      break;
     }
    }
   }
  }
  if(String(g.status).includes('FINAL')&&Number.isFinite(g.home.score)&&Number.isFinite(g.away.score)){
   const exists=await read(kv,'max:eval:players:'+g.id);
   const finalBox=boxes.find(b=>b.game_id===g.id);
   if(!exists&&finalBox){
    for(const checkpoint of ['PLAYER_H30','PLAYER_H1','PLAYER_H3','PLAYER_H6','PLAYER_H24','PLAYER_V1']){
     const snap=await read(kv,'max:vpre:'+ADVANCED_VERSION+':'+g.id+':'+checkpoint)??await read(kv,'max:pre:'+g.id+':'+checkpoint);
     const ev=evaluatePlayerPoints(g,finalBox,snap);
     if(ev){
      await put(kv,'max:eval:players:'+g.id,ev,86400*180);
      playerRows.push(ev);newPlayerEvaluations++;break;
     }
    }
   }
  }
  if (env.MAX_JOURNAL && String(g.status).includes('FINAL')) await settleStudy(env.MAX_JOURNAL,g,boxes.find(b=>b.game_id===g.id),completionTime());
  games.push(g);
 }
 if(newEvaluations||oldMetrics?.records?.length&&oldMetrics.summary_version!=='max-eval-summary-0.3.0'){
  const distinct=[...new Map(metricsRows.map(x=>[x.match_id,x])).values()]
   .sort((a,b)=>a.tip.localeCompare(b.tip)).slice(-120);
  await put(kv,KEY_METRICS,{...summarizeEvaluations(distinct),updated_at:nowISO},86400*180);
 }
 if(newPlayerEvaluations||oldPlayerMetrics?.records?.length&&!oldPlayerMetrics.cohort_note){
  const unique=[...new Map(playerRows.map(x=>[x.game_id,x])).values()]
   .sort((a,b)=>a.tip.localeCompare(b.tip)).slice(-60);
  await put(kv,KEY_PLAYER_METRICS,{
   ...summarizePlayerPointsEvaluations(unique),updated_at:nowISO},86400*180);
 }
 // Derive the exact same summaries in memory: KV propagation must not cause stale reports.
 const uniqueMetrics=[...new Map(metricsRows.map(x=>[x.match_id,x])).values()].sort((a,b)=>a.tip.localeCompare(b.tip)).slice(-120);
 const uniquePlayers=[...new Map(playerRows.map(x=>[x.game_id,x])).values()].sort((a,b)=>a.tip.localeCompare(b.tip)).slice(-60);
 const metrics=uniqueMetrics.length?{...summarizeEvaluations(uniqueMetrics),updated_at:nowISO}:oldMetrics;
 const playerMetrics=uniquePlayers.length?{...summarizePlayerPointsEvaluations(uniquePlayers),updated_at:nowISO}:oldPlayerMetrics;
 for(const g of games){
  g.automatic_report=composeReport(g,historical,boxes,rosterResult.rosters,metrics,playerMetrics,nowISO);
  gameWrites.push(put(kv,'max:game:'+g.id,g));
  if(String(g.status).includes('FINAL')&&!await read(kv,'max:trial:eval:'+TRIAL_VERSION+':'+g.id)){
   for(const checkpoint of ['H6','H24','EARLIEST']){
    const snap=await read(kv,'max:trial:pre:'+TRIAL_VERSION+':'+g.id+':'+checkpoint);
    const control=await read(kv,'max:vpre:'+ADVANCED_VERSION+':'+g.id+':'+checkpoint);
    const result=trialEvaluation(g,boxes.find(b=>b.game_id===g.id),snap,control);
    if(result){await put(kv,'max:trial:eval:'+TRIAL_VERSION+':'+g.id,result,86400*180);trialRows.push(result);newTrials++;break;}
   }
  }
 }
 if(auditChanged)await put(kv,'max:audit:errors:latest',{...priorAudit,schema_version:'max-error-audit-collection-v1',kind:'POSTMATCH_DIAGNOSTIC_NOT_PREDICTION',
  generated_at:nowISO,evaluated:metrics?.games_evaluated??0,correct:metrics?.records?.filter(r=>r.correct).length??0,failed:auditRows.size,records:[...auditRows.values()].slice(-120)},86400*365);
 const trials={...trialSummary([...new Map(trialRows.map(r=>[r.game_id,r])).values()]),updated_at:nowISO};
 if(newTrials||!oldTrials)await put(kv,TRIAL_KEY,trials,86400*180);
 await Promise.all([...gameWrites,...deferredHistory.map(x=>put(kv,x.key,x.value,86400*30))]);
 if (env.MAX_JOURNAL && newBoxes) {
  const liveIds=new Set(games.map(g=>g.id));
  for(const g of pending.filter(g=>!liveIds.has(g.id))) {
   const box=boxes.find(b=>b.game_id===g.id);
   if(box)await settleStudy(env.MAX_JOURNAL,g,box,completionTime());
  }
 }
 const agenda=agendaFromGames(games,nowISO);
 const eligibleResearch=games.filter(g=>agenda.all.some(p=>p.match_id===String(g.id)));
 const researchCoverage={eligible:eligibleResearch.length,
  available:eligibleResearch.filter(g=>g.research).length,
  expired:eligibleResearch.filter(g=>g.research_diagnostics.state==='EXPIRED').length,
  invalid:eligibleResearch.filter(g=>['INVALID','POST_TIP'].includes(g.research_diagnostics.state)).length,
  missing:eligibleResearch.filter(g=>g.research_diagnostics.state==='MISSING').length,
  due:agenda.due_count,non_eligible:games.length-eligibleResearch.length};
 const slate={schema_version:VERSION,engine_version:ENGINE_VERSION,
  scheduler_version:SCHEDULER_VERSION,cadence:cadenceMetadata(nowISO),research_agenda:agenda,research_coverage:researchCoverage,
  automatic_report_count:games.filter(g=>g.automatic_report?.sections?.length===16).length,
  forecast_efficiency:{recalculated:monteCarloRun,reused:monteCarloReuse},
  advanced_version:ADVANCED_VERSION,points_version:POINTS_VERSION,
  experiment_summary:{version:TRIAL_VERSION,paired_games:trials.paired_games,state:trials.state,auto_promotion:false},
  metrics_summary:{games_evaluated:metrics?.games_evaluated??0,
   brier:metrics?.brier??null,log_loss:metrics?.log_loss??null,
   player_games:playerMetrics?.games_evaluated??0,
   player_predictions:playerMetrics?.players_evaluated??0,
   player_mae:playerMetrics?.mae??null,player_rmse:playerMetrics?.rmse??null,
   calibrated:false},
  updated_at:nowISO,mode:'INDEPENDENT_SHADOW',
  games,sources,errors:errors.slice(0,20),
  ai_status:'MACFLY_CHATGPT_EVERY_6H',research_count:researchCount,boxscore_count:boxes.length,archive_progress:archive,external_paid_api:false,
  disclaimer:'Analyse indépendante expérimentale ; aucune preuve de calibration ni recommandation de pari.'};
 await put(kv,KEY_SLATE,slate,86400*3);
 if(changed)await put(kv,KEY_EVENTS,events.slice(0,50),86400*30);
 health.last_success=nowISO;health.game_count=games.length;
 await put(kv,KEY_HEALTH,health,86400*7);
 return {...health,updated:true,events_new:changed,research_reports:researchCount,
  research_due:agenda.due_count,monte_carlo_executed:monteCarloRun,
  monte_carlo_reused:monteCarloReuse,boxes_cached:boxes.length,boxes_new:newBoxes,
  new_evaluations:newEvaluations,new_player_evaluations:newPlayerEvaluations,
  external_paid_api:false,history_fetched:fetched.filter(x=>x.status==='fulfilled').length};
}
export default{
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(path==='/')return new Response(MAX_APP_HTML||'ManiBetProMax',{
   status:200,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store',
    'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'}});
  if(!env?.MAX_STATE)return json({error:'STORAGE_NOT_CONFIGURED'},503);
  if(path==='/api/version')return json({version:VERSION,mode:'INDEPENDENT_SHADOW',auto_promotion:false});
  if(path==='/api/study')return env.MAX_JOURNAL?json(await studySummary(env.MAX_JOURNAL)):json({error:'JOURNAL_NOT_CONFIGURED'},503);
  if(path==='/api/health')return json(await read(env.MAX_STATE,KEY_HEALTH)??{state:'NO_DATA'});
  if(path==='/api/game'){
   const id=new URL(request.url).searchParams.get('id')??'';
   if(!/^\d{5,15}$/.test(id))return json({error:'INVALID_GAME_ID'},400);
   const slate=await read(env.MAX_STATE,KEY_SLATE);
   const game=slate?.games?.find(g=>String(g.id)===id);
   const study=env.MAX_JOURNAL?await gameStudy(env.MAX_JOURNAL,id):null;
   if(!game)return study?.pair?json({match_id:id,study}):json({error:'GAME_NOT_FOUND'},404);
   const checkpoints=['EARLIEST','H24','H6','H3','H1','H30','PLAYER_V1','PLAYER_H24','PLAYER_H6','PLAYER_H3','PLAYER_H1','PLAYER_H30'];
   const [snapshots,evaluation,playerEvaluation]=await Promise.all([
    Promise.all([...checkpoints.map(cp=>read(env.MAX_STATE,'max:pre:'+id+':'+cp)),
     ...['EARLIEST','H24','H6'].map(cp=>read(env.MAX_STATE,'max:vpre:'+ADVANCED_VERSION+':'+id+':'+cp))]),
    read(env.MAX_STATE,'max:eval:'+id),
    read(env.MAX_STATE,'max:eval:players:'+id)
   ]);
   const timeline=snapshots.filter(p=>p&&p.game_id===id&&
    Number.isFinite(Date.parse(p.at))&&Date.parse(p.at)<Date.parse(game.start))
    .sort((a,b)=>a.at.localeCompare(b.at))
    .map(p=>({checkpoint:p.checkpoint,at:p.at,model:p.model,engine_version:p.forecast?.engine_version??'UNRECORDED',
     forecast:p.forecast??null,player_points:p.player_points??null,market_observation:p.market_observation??null,
     context_status:p.context_status??'UNKNOWN',
     injury_counts:{
      home:Array.isArray(p.injuries?.home)?p.injuries.home.length:null,
      away:Array.isArray(p.injuries?.away)?p.injuries.away.length:null
     }}));
   return json({match_id:id,study,start:game.start,teams:{home:game.home.name,away:game.away.name},
    timeline,evaluation:evaluation?.pregame_at&&Date.parse(evaluation.pregame_at)<Date.parse(game.start)?
     evaluation:null,player_evaluation:playerEvaluation?.pregame_at&&Date.parse(playerEvaluation.pregame_at)<Date.parse(game.start)?playerEvaluation:null,
     source:'Max immutable pre-tip snapshots',
    warning:'Snapshots réellement enregistrés avant coup d’envoi uniquement ; pas de reconstruction rétroactive.'});
  }
  if(path==='/api/slate'){
   const slate=await read(env.MAX_STATE,KEY_SLATE);
   return json((env.MAX_JOURNAL&&slate?await overlaySlate(env.MAX_JOURNAL,slate):slate)??{
   schema_version:VERSION,updated_at:null,games:[],mode:'INDEPENDENT_SHADOW',
   ai_status:'NOT_CONFIGURED'});
  }
  if(path==='/api/events')return json({events:await read(env.MAX_STATE,KEY_EVENTS)??[]});
  if(path==='/api/experiments')return json(await read(env.MAX_STATE,TRIAL_KEY)??trialSummary([]));
  if(path==='/api/error-audit')return json(await read(env.MAX_STATE,'max:audit:errors:latest')??{state:'NOT_AVAILABLE'});
  if(path==='/api/metrics')return json(await read(env.MAX_STATE,KEY_METRICS)??summarizeEvaluations([]));
  if(path==='/api/player-metrics')return json(await read(env.MAX_STATE,KEY_PLAYER_METRICS)??summarizePlayerPointsEvaluations([]));
  if(path==='/api/research-plan')return json((await read(env.MAX_STATE,KEY_SLATE))?.research_agenda??{
   generated_at:null,eligible:0,due_count:0,due:[],all:[],state:'AWAITING_FIRST_COLLECTION'});
  if(path==='/api/archive')return json({progress:await read(env.MAX_STATE,KEY_ARCHIVE)??{
   season_index:0,saved_days:0,saved_games:0,next_date:ARCHIVE_SEASONS[0].start},
   seasons:ARCHIVE_SEASONS,target_days:archiveTarget(),live_predictions_include_archive:false});
  if(path==='/api/methodology')return new Response(MAX_ANALYST_PROMPT,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  return json({error:'NOT_FOUND'},404);
 },
 async queue(batch,env){return handleResearchQueue(batch,env,validateResearch);},
 async scheduled(controller,env){
  try{
   const now=new Date(controller.scheduledTime??Date.now());
   const previous=await read(env.MAX_STATE,KEY_HEALTH);
   if(!autoCollectionDue(previous,now.toISOString())){
    console.log('[MAX_INDEPENDENT]',JSON.stringify({status:'SKIPPED_SIX_HOUR_INTERVAL',at:now.toISOString()}));return;
   }
   console.log('[MAX_INDEPENDENT]',JSON.stringify(await collect(env,fetch,now)));
  }
  catch(err){console.error('[MAX_INDEPENDENT_FAILURE]',String(err?.message??'ERROR').slice(0,180));}
 }
};
