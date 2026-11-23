import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../quality-worker.mjs';
import {d1} from './study-journey-fixture.mjs';

test('la performance relie SQL et MAX_STATE, sans écriture quand on ouvre ou recharge le bilan',async ()=>{
  const db=d1(),kv=new Map(),writes=[];
  const env={MAX_JOURNAL:db,MAX_STATE:{
    get:async key=>kv.has(key)?JSON.parse(kv.get(key)):null,
    put:async(key,value)=>{writes.push(key);kv.set(key,value);}
  }};
  const fetchJSON=async path=>{
    const res=await worker.fetch(new Request('https://max.test'+path),env,{});
    assert.equal(res.status,200);return res.json();
  };
  const original={records:[{game_id:'previous-result'}],summary_version:'historical'};
  kv.set('max:metrics:predictions',JSON.stringify(original));
  const study=await fetchJSON('/api/study');
  assert.equal(study.prompt_lab.eligible_matches,0);
  assert.equal(study.prompt_lab.href,'#experiences-macfly');
  const before=await fetchJSON('/api/metrics');
  assert.equal(before.prompt_lab.last_metrics_publication,null);
  assert.deepEqual(before.records,original.records);
  assert.equal(writes.length,0);
  let ack=0;
  await worker.queue({messages:[{body:{type:'prompt_lab_publish_metrics'},ack(){ack++;}}]},env,{});
  assert.equal(ack,1);
  assert.deepEqual(writes,['max:metrics:macfly-research:v1']);
  const after=await fetchJSON('/api/metrics');
  assert.ok(Date.parse(after.prompt_lab.last_metrics_publication)>0);
  assert.equal(after.prompt_lab.paired_matches,0);
  assert.deepEqual(JSON.parse(kv.get('max:metrics:predictions')),original);
  assert.equal(writes.length,1);
});
