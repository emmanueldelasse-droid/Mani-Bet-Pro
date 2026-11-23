import {readPublishedAssessment} from './published-evaluation.mjs';
import {readLabExperiment} from './prompt-lab-store.mjs';
import {readPromptScore} from './prompt-lab-score.mjs';

const primary=db=>db.withSession?db.withSession('first-primary'):db;
const labels={
  WINNER:'Favori battu',PROBABILITY:'Probabilité annoncée du vainqueur',TEAM_TOTAL:'Total de points du match',
  PLAYER_MINUTES:'Minutes des joueurs',PLAYER_RATE:'Production pendant les minutes jouées',AVAILABILITY:'Présence sur le parquet',
  DATA_GAP:'Données manquantes',CORRECT_WITH_OFFSET:'Prévision juste avec écarts compensés',ON_TARGET:'Prévision proche du résultat'
};
const actions=new Set(['MONITOR','RESEARCH_TEST','MODEL_REVIEW','DATA_REPAIR','NO_ACTION']);
const limit=12;
const isText=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const abs=(x,threshold)=>Number.isFinite(x)&&Math.abs(x)>=threshold;
const links='r.match_id=c.match_id AND r.edition_id=c.edition_id AND r.assessment_key=c.assessment_key';
const currentReviews='learning_current_assessments c JOIN learning_reviews r ON '+links;

export function learningObservations(review){
  if(review?.assessment_state!=='FINAL')return [];
  const out=[];
  const match=(category,measure,details)=>out.push({category,kind:'MATCH',measure,...details});
  const player=(p,category,measure,details)=>out.push({category,kind:'PLAYER',player_id:p.player_id,name:p.name,measure,...details});
  const w=review.game.winner,total=review.game.total;
  if(w.correct===false)match('WINNER','winner',{projected:w.projected,actual:w.actual,probability_home:w.probability_home});
  if(Number.isFinite(w.brier))match('PROBABILITY','single_game_brier',{probability_home:w.probability_home,actual:w.actual,brier:w.brier});
  if(abs(total.error,8))match('TEAM_TOTAL','total_points',total);
  if(w.correct===true)match('ON_TARGET','winner',{projected:w.projected,actual:w.actual});
  if(Number.isFinite(total.error)&&Math.abs(total.error)<=3)match('ON_TARGET','total_points',total);
  const home=review.game.home.error,away=review.game.away.error;
  if(Number.isFinite(total.error)&&Math.abs(total.error)<=3&&abs(home,4)&&abs(away,4)&&home*away<0)
    match('CORRECT_WITH_OFFSET','total_points',{...total,home_points_error:home,away_points_error:away});
  if(!review.coverage.game_projection||!review.coverage.box_available||review.coverage.unknown>0)
    match('DATA_GAP','coverage',{...review.coverage});
  for(const p of review.players){
    if(abs(p.minutes?.error,5))player(p,'PLAYER_MINUTES','minutes',p.minutes);
    if(abs(p.production_error,3))player(p,'PLAYER_RATE','production_points',{error:p.production_error});
    if(p.status_mismatch)player(p,'AVAILABILITY','status',{status:p.status,participation:p.participation});
    if(p.offsetting_errors&&Number.isFinite(p.points?.error)&&Math.abs(p.points.error)<=3)
      player(p,'CORRECT_WITH_OFFSET','player_points',{...p.points,minutes_points:p.minutes_points,production_error:p.production_error});
    if(p.participation==='PLAYED'&&Number.isFinite(p.points?.error)&&Math.abs(p.points.error)<=1)
      player(p,'ON_TARGET','player_points',p.points);
    if(p.participation==='UNKNOWN')player(p,'DATA_GAP','participation',{participation:p.participation});
  }
  return out;
}

class ReviewError extends Error{}
function requireReview(value,reason){if(!value)throw new ReviewError(reason);}
function assessedKey(review){
  return review?review.assessment_key??[review.edition_id,review.final_observation_id,review.box_observation_id??0].join(':'):null;
}
function validate(input,review){
  requireReview(input.author==='Analyste Max','UNKNOWN_REVIEW_AUTHOR');
  requireReview(review?.assessment_state==='FINAL'&&review.edition_id===input.edition_id&&review.match_id===input.match_id&&
    assessedKey(review)===input.assessment_key,'ASSESSMENT_UNAVAILABLE_OR_SUPERSEDED');
  requireReview(isText(input.finding,2500)&&(isText(input.hypothesis,2500)||input.hypothesis===null&&input.action==='NO_ACTION'),'REVIEW_TEXT_REQUIRED');
  requireReview(actions.has(input.action)&&Array.isArray(input.categories)&&input.categories.length>0&&input.categories.length<=9&&
    input.categories.every(c=>Object.hasOwn(labels,c))&&new Set(input.categories).size===input.categories.length&&
    input.categories.includes(input.priority_category),'INVALID_CATEGORY_OR_ACTION');
  requireReview(Array.isArray(input.evidence)&&input.evidence.length>0&&input.evidence.length<=50,'OBSERVATIONS_REQUIRED');
  const seen=new Set(),evidence=input.evidence.map(e=>{
    const valid=e?.kind==='MATCH'||e?.kind==='PLAYER'&&typeof e.player_id==='string'&&/^\d{1,15}$/.test(e.player_id);
    requireReview(valid&&!seen.has(e.kind+':'+(e.player_id??'')),'INVALID_OR_DUPLICATE_EVIDENCE');seen.add(e.kind+':'+(e.player_id??''));
    return e.kind==='MATCH'?{kind:'MATCH'}:{kind:'PLAYER',player_id:e.player_id};
  });
  const observations=learningObservations(review).filter(obs=>input.categories.includes(obs.category)&&
    evidence.some(e=>obs.kind===e.kind&&(e.kind==='MATCH'||obs.player_id===e.player_id)));
  requireReview(input.categories.every(c=>observations.some(o=>o.category===c))&&
    evidence.every(e=>observations.some(o=>e.kind===o.kind&&(e.kind==='MATCH'||o.player_id===e.player_id))),'CATEGORY_OR_PLAYER_NOT_SUPPORTED');
  return {author:input.author,priority_category:input.priority_category,categories:input.categories,action:input.action,
    finding:input.finding,hypothesis:input.hypothesis,evidence,observations,result_source:review.result_source??null,
    score_observed_at:review.score_observed_at,box_observed_at:review.box_observed_at??null};
}
const reviewColumns='r.id,r.match_id,r.edition_id,r.assessment_key,r.reviewed_at,r.payload';
function readReview(row){if(!row)return null;const {payload,current,...rest}=row;
  return {...JSON.parse(payload),...rest,...(current!=null?{current:Boolean(current)}:{})};}

export async function processLearningReview(db,id){
  const store=primary(db);
  const [inbox,done,rejected]=await store.batch([
    store.prepare('SELECT match_id,edition_id,assessment_key,payload FROM learning_inbox WHERE id=?').bind(id),
    store.prepare('SELECT * FROM learning_reviews WHERE id=?').bind(id),
    store.prepare('SELECT reason,checked_at FROM learning_rejections WHERE id=?').bind(id)
  ]);
  if(done.results.length)return {...readReview(done.results[0]),status:'ACCEPTED'};
  if(rejected.results.length)return {id,status:'REJECTED',...rejected.results[0]};
  if(!inbox.results.length)return {id,status:'NOT_RECEIVED'};
  const intake=inbox.results[0],input=JSON.parse(intake.payload);
  let body,reason,assessment;
  try{
    assessment=await readPublishedAssessment(store,input.match_id);
    body=validate(input,assessment);
  }
  catch(error){if(!(error instanceof ReviewError))throw error;reason=error.message;}
  const [,,accepted,refused]=await store.batch([
    store.prepare(`INSERT INTO learning_reviews(id,match_id,edition_id,assessment_key,payload)
      SELECT ?1,c.match_id,c.edition_id,c.assessment_key,?2 FROM learning_current_assessments c
      WHERE ?2 IS NOT NULL AND c.match_id=?3 AND c.edition_id=?4 AND c.assessment_key=?5
      AND NOT EXISTS(SELECT 1 FROM published_final_observations o JOIN learning_inbox i ON i.id=?1
        WHERE o.id IN (?6,?7) AND o.recorded_at>i.received_at)
      AND NOT EXISTS(SELECT 1 FROM learning_reviews WHERE id=?1 OR (match_id=?3 AND edition_id=?4 AND assessment_key=?5))
      AND NOT EXISTS(SELECT 1 FROM learning_rejections WHERE id=?1)`).bind(id,body?JSON.stringify(body):null,intake.match_id,intake.edition_id,intake.assessment_key,
        assessment?.final_observation_id??null,assessment?.box_observation_id??null),
    store.prepare(`INSERT INTO learning_rejections(id,reason) SELECT ?1,?2 WHERE NOT EXISTS(SELECT 1 FROM learning_reviews WHERE id=?1)
      ON CONFLICT(id) DO NOTHING`).bind(id,reason??'ASSESSMENT_UNAVAILABLE_OR_SUPERSEDED'),
    store.prepare('SELECT * FROM learning_reviews WHERE id=?').bind(id),
    store.prepare('SELECT reason,checked_at FROM learning_rejections WHERE id=?').bind(id)
  ]);
  return accepted.results.length?{...readReview(accepted.results[0]),status:'ACCEPTED'}:{id,status:'REJECTED',...refused.results[0]};
}

// A reference in a proposal alone is insufficient. Two distinct independently audited matches
// must appear in the accepted plan's verified evidence before its server registration time.
const acceptedLinks=`SELECT v.id,json_extract(i.payload,'$.learning_ref') ref,json_extract(v.plan_json,'$.metric') metric,
  (SELECT h.status FROM prompt_lab_status_history h WHERE h.experiment_id=v.id ORDER BY h.seq DESC LIMIT 1) status,
  json_extract(e.decision_json,'$.decision') decision,json_extract(e.decision_json,'$.reason') reason,
  json_extract(e.decision_json,'$.gain') gain,json_extract(e.decision_json,'$.evaluated_games') evaluated_games,
  json_extract(e.decision_json,'$.evaluated_cases') evaluated_cases
  FROM prompt_lab_versions v JOIN prompt_lab_inbox i ON i.id=v.id LEFT JOIN prompt_lab_experiments e ON e.id=v.id
  WHERE json_type(i.payload,'$.learning_ref')='text' AND json_extract(v.plan_json,'$.action')='TEST'
    AND (SELECT count(DISTINCT c.match_id) FROM ${currentReviews} JOIN json_each(v.plan_json,'$.evidence') proof
      ON json_extract(proof.value,'$.match_id')=c.match_id
      WHERE json_extract(r.payload,'$.priority_category')||'-'||json_extract(r.payload,'$.action')=json_extract(i.payload,'$.learning_ref')
      AND EXISTS(SELECT 1 FROM learning_reviews prev WHERE prev.match_id=r.match_id AND prev.edition_id=r.edition_id
        AND prev.reviewed_at<=v.registered_at AND json_extract(prev.payload,'$.priority_category')=json_extract(r.payload,'$.priority_category')
        AND json_extract(prev.payload,'$.action')=json_extract(r.payload,'$.action')))>=2
  ORDER BY v.registered_at DESC,v.version DESC`;
async function linkedExperiment(db,row){
  if(!row)return null;
  // The one-active-test constraint bounds this extra read for the entire lessons listing.
  const score=row.status==='ACTIVE'?await readPromptScore(db,await readLabExperiment(db,row.id),new Date().toISOString()):row;
  return {id:row.id,status:row.status,decision:score.decision??null,reason:score.reason??null,metric:row.metric,
    gain:score.gain??null,evaluated_games:score.evaluated_games??0,evaluated_cases:score.evaluated_cases??0,adoption_applied:false};
}

export async function readLearning(db,{queue=false,matchId=null}={}){
  const store=primary(db),scope=matchId==null?null:String(matchId);
  const [stats,groups,recent,candidates,linked]=await store.batch([
    store.prepare(`SELECT count(r.id) audited_matches,count(*)-count(r.id) pending_reviews FROM learning_current_assessments c
      LEFT JOIN learning_reviews r ON ${links}`),
    store.prepare(`WITH observations AS (
        SELECT json_extract(r.payload,'$.priority_category') category,json_extract(r.payload,'$.action') action,
          r.match_id,r.id,r.edition_id,r.assessment_key,r.reviewed_at FROM ${currentReviews}),
      ranked AS (SELECT *,row_number() OVER(PARTITION BY category,action ORDER BY reviewed_at DESC,match_id) ranking FROM observations)
      SELECT category,action,count(*) match_count,max(reviewed_at) updated_at,
        json_group_array(json_object('match_id',match_id,'edition_id',edition_id,'assessment_key',assessment_key,'review_id',id))
        FILTER(WHERE ranking<=12) evidence_json FROM ranked GROUP BY category,action
      HAVING count(*)>=2 AND (?1 IS NULL OR max(match_id=?1)) ORDER BY updated_at DESC,category,action`).bind(scope),
    store.prepare(`SELECT ${reviewColumns},c.match_id IS NOT NULL AS current FROM learning_reviews r LEFT JOIN learning_current_assessments c ON ${links}
      WHERE (?1 IS NULL AND c.match_id IS NOT NULL OR r.match_id=?1) ORDER BY r.reviewed_at DESC,r.rowid DESC LIMIT 50`).bind(scope),
    store.prepare(`SELECT c.*,i.id AS intake_id,i.received_at,k.reason AS rejection,k.checked_at
      FROM learning_current_assessments c LEFT JOIN learning_reviews r ON ${links}
      LEFT JOIN learning_inbox i ON i.rowid=(SELECT j.rowid FROM learning_inbox j
        WHERE j.match_id=c.match_id AND j.edition_id=c.edition_id AND j.assessment_key=c.assessment_key ORDER BY j.rowid DESC LIMIT 1)
      LEFT JOIN learning_rejections k ON k.id=i.id
      WHERE ?1 AND r.id IS NULL AND (?2 IS NULL OR c.match_id=?2)
      ORDER BY (i.id IS NOT NULL),(k.id IS NOT NULL),c.tip DESC,c.match_id LIMIT ?3`).bind(queue?1:0,scope,limit),
    store.prepare(acceptedLinks)
  ]);
  const lessons=[];
  for(const {evidence_json,...group} of groups.results){
    const lesson={...group,id:group.category+'-'+group.action,title:labels[group.category],
      explanation:'Même catégorie prioritaire et même suite proposée par l’agent sur '+group.match_count+' matchs distincts dont le bilan est à jour.'};
    const experiment=await linkedExperiment(store,linked.results.find(r=>r.ref===lesson.id));
    lessons.push({...lesson,evidence:JSON.parse(evidence_json),experiment,experiment_id:experiment?.id??null,
      status:experiment?(['ABANDON','INCONCLUSIVE','PROPOSE_ADOPTION'].includes(experiment.status)?'TEST_REVIEWED':'TEST_REGISTERED'):'RECURRENT'});
  }
  const pending=[];
  for(const c of candidates.results){
    const review=await readPublishedAssessment(store,c.match_id,c.edition_id);
    if(assessedKey(review)===c.assessment_key)pending.push({match_id:c.match_id,edition_id:c.edition_id,
      assessment_key:c.assessment_key,observations:learningObservations(review),review,
      previous_submission:c.intake_id?{id:c.intake_id,status:c.rejection?'REJECTED':'RECEIVED',received_at:c.received_at,
        reason:c.rejection,checked_at:c.checked_at}:null});
  }
  return {agent:'Analyste Max',schedule:'Après les résultats officiels, lors des passages programmés de l’agent.',
    counts:{...stats.results[0],lessons:lessons.length},lessons,reviews:recent.results.map(readReview),...(queue?{pending}:{})};
}
