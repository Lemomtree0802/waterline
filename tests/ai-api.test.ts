import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import Ajv from 'ajv/dist/2020.js';
import {createApp} from '../server/app.js';
import {aiOpenApi} from '../server/ai-schema.js';
import {officialLevels} from '../src/levels.js';

const databaseUrl=process.env.DATABASE_URL;
test('AI API: real database, replayable state, scoped keys and shared masked rankings',{skip:!databaseUrl,timeout:60000},async t=>{
  const admin=new pg.Pool({connectionString:databaseUrl}),schema='waterline_ai_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const options={databaseUrl:databaseUrl!,workers:2,poolOptions:{options:`-c search_path=${schema}`}};
  let server=await createApp(options);
  const ajv=new Ajv({strict:false,validateFormats:false});
  ajv.addSchema({...aiOpenApi,$id:'waterline-contract'});
  const validate=(name:string,value:unknown)=>{const check=ajv.compile({$ref:'waterline-contract#/components/schemas/'+name});assert.ok(check(value),JSON.stringify(check.errors));};
  const web=async(path:string,method='GET',payload?:unknown,cookie?:string)=>server.app.inject({url:'/api'+path,method:method as any,headers:{'x-waterline-request':'1',...(cookie?{cookie}:{})},...(payload===undefined?{}:{payload})});
  const call=async(path:string,method='GET',payload?:unknown,key?:string,extra:Record<string,string>={})=>server.app.inject({url:'/api/ai/v1'+path,method:method as any,headers:{...(key?{authorization:'Bearer '+key}:{}),...extra},...(payload===undefined?{}:{payload})});
  try{
    const registered=await web('/auth/register','POST',{username:'ai_player',password:'test-password'}),human=await web('/auth/register','POST',{username:'human_player',password:'test-password'}),other=await web('/auth/register','POST',{username:'other_player',password:'test-password'});
    const cookie=registered.headers['set-cookie']!.toString().split(';')[0],humanCookie=human.headers['set-cookie']!.toString().split(';')[0],otherCookie=other.headers['set-cookie']!.toString().split(';')[0];
    let key:string,run:any;
    await t.test('keys require the browser account, disclose the secret once, and cannot manage browser resources',async()=>{
      assert.equal((await web('/me/api-keys')).statusCode,401);
      assert.equal((await web('/me/api-keys','POST',{name:'   '},cookie)).statusCode,400);
      const created=await web('/me/api-keys','POST',{name:'Model A'},cookie);assert.equal(created.statusCode,201);key=created.json().key;assert.match(key,/^wl_[A-Za-z0-9_-]{43}$/);
      const list=(await web('/me/api-keys','GET',undefined,cookie)).json();assert.equal(list.keys.length,1);assert.equal(list.keys[0].suffix,key.slice(-4));assert.equal(JSON.stringify(list).includes(key),false);assert.equal(JSON.stringify(list).includes('token_hash'),false);
      const stored=(await server.store.pool.query('SELECT token_hash FROM api_keys')).rows[0].token_hash;assert.notEqual(stored,key);assert.match(stored,/^[0-9a-f]{64}$/);
      assert.equal((await web('/me/api-keys/'+created.json().id,'DELETE',undefined,otherCookie)).statusCode,404);
      const noBearer=await call('/me','GET',undefined,undefined,{cookie});assert.equal(noBearer.statusCode,401);validate('Error',noBearer.json());
      assert.equal((await call('/me','GET',undefined,'invalid')).statusCode,401);
      assert.equal((await call('/me','GET',undefined,key)).json().player_id,'ai_player');
      const oldWrite=await server.app.inject({url:'/api/me/api-keys',method:'POST',headers:{authorization:'Bearer '+key,'x-waterline-request':'1'},payload:{name:'forbidden'}});assert.equal(oldWrite.statusCode,401);
      const switched=await server.app.inject({url:'/api/me/api-keys',headers:{cookie:otherCookie,'x-waterline-player':registered.json().player.id}});assert.equal(switched.statusCode,409);
    });
    await t.test('current official and workshop levels share a sanitized and stable schema',async()=>{
      const published=await web('/levels','POST',{puzzle:{w:['0','8'],e:[[0,1]],t:0,pos:[[100,200],[600,200]],description:'Author message'},moves:[],draftRevision:0},humanCookie);assert.equal(published.statusCode,200);
      const list=(await call('/levels?source=official','GET',undefined,key)).json();validate('Levels',list);assert.equal(list.total,officialLevels.length);
      const workshop=(await call('/levels?source=workshop&author_id=human_player','GET',undefined,key)).json();validate('Levels',workshop);assert.equal(workshop.total,1);
      const level=(await call('/levels/'+encodeURIComponent(workshop.levels[0].level_key),'GET',undefined,key)).json();validate('Level',level);assert.equal(level.author_message,'Author message');assert.equal(level.source,'workshop');assert.equal(JSON.stringify(level).includes('referenceMoves'),false);
      const challenge=await call('/runs','POST',{level_key:level.level_key,request_id:'workshop-run'},key);assert.equal(challenge.statusCode,201);validate('Run',challenge.json());
      const state=(await call('/runs/'+challenge.json().run_id+'/actions','POST',{request_id:'workshop-step',expected_revision:0,action:{type:'toggle_edge',edge_id:0}},key)).json();assert.equal(state.state.score,'4');
      const result=(await call('/runs/'+state.run_id+'/submit','POST',{request_id:'workshop-submit',expected_revision:1},key)).json();validate('Submission',result);assert.equal(result.best.rank,1);
      assert.equal((await web('/levels/'+encodeURIComponent(level.level_key)+'/leaderboard','GET',undefined,humanCookie)).json().total,1);
    });
    await t.test('official pagination and exact submissions on an independent large-water board',async()=>{
      const ids:string[]=[];
      for(let offset=0;offset<officialLevels.length;offset+=50) {
        const response=await call('/levels?source=official&limit=50&offset='+offset,'GET',undefined,key);assert.equal(response.statusCode,200);
        const page=response.json();validate('Levels',page);ids.push(...page.levels.map((p:any)=>p.level_key));
      }
      assert.equal(new Set(ids).size,officialLevels.length);
      assert.deepEqual(ids,officialLevels.map(p=>p.id+'@'+p.version));
      const w=['3','42'+'0'.repeat(109),...Array(10).fill('0')];
      const p={id:'test-large',version:1,source:'official',name:'Large-water fixture',number:0,
        w,e:w.slice(1).map((_,i)=>[i,i+1]),t:0,pos:[]};
      const levelKey=p.id+'@'+p.version;
      const moves=[0,0,1];
      // Only opening the first valve changes the scoring node.
      const score=(BigInt(w[0])+BigInt(w[1])).toString()+'/2';
      await server.store.pool.query("INSERT INTO levels(key,source,puzzle,published_at) VALUES($1,'official',$2,0)",[levelKey,JSON.stringify(p)]);
      const definition=await call('/levels/'+levelKey,'GET',undefined,key);
      assert.equal(definition.statusCode,200);
      const publicLevel=definition.json();
      validate('Level',publicLevel);
      assert.deepEqual(publicLevel.initial_state.nodes.map((n:any)=>n.water),p.w);
      const humanResult=await web('/runs','POST',{key:levelKey,moves},humanCookie);
      assert.equal(humanResult.statusCode,200,humanResult.body);
      let current=(await call('/runs','POST',{level_key:levelKey,request_id:'start-large-fixture'},key)).json();
      validate('Run',current);
      for(const [i,edge] of moves.entries()) {
        const response=await call('/runs/'+current.run_id+'/actions','POST',{
          request_id:'step-'+i,expected_revision:current.revision,action:{type:'toggle_edge',edge_id:edge},
        },key);
        assert.equal(response.statusCode,200,response.body);
        current=response.json();
      }
      assert.equal(current.state.score,score);
      const submitted=await call('/runs/'+current.run_id+'/submit','POST',{
        request_id:'submit-large-fixture',expected_revision:current.revision,
      },key);
      assert.equal(submitted.statusCode,200,submitted.body);
      const result=submitted.json();
      validate('Submission',result);
      assert.equal(result.submitted_score,score);
      assert.equal(result.best.rank,1);

      assert.equal((await web('/runs','POST',{key:levelKey,moves:[]},otherCookie)).statusCode,200);
      const board=(await web('/levels/'+levelKey+'/leaderboard','GET',undefined,otherCookie)).json();
      assert.equal(board.rank,2);
      const leaders=board.records.filter((r:any)=>r.rank===1);
      assert.equal(leaders.length,2);
      assert.ok(leaders.every((r:any)=>r.hidden&&r.score===null));
      assert.equal(board.mine.score,p.w[p.t]);

      const reset=await call('/runs/'+current.run_id+'/actions','POST',{
        request_id:'reset-large-fixture',expected_revision:result.run.revision,action:{type:'reset'},
      },key);
      assert.equal(reset.statusCode,200,reset.body);
      assert.deepEqual(reset.json().state.nodes.map((n:any)=>n.water),p.w);
      assert.equal((await call('/runs/'+current.run_id,'DELETE',undefined,key)).statusCode,200);
    });
    await t.test('moves are deterministic, retried actions execute once, and concurrent stale writes are rejected',async()=>{
      const created=await call('/runs','POST',{level_key:'p1@1',request_id:'official-run'},key);assert.equal(created.statusCode,201);run=created.json();validate('Run',run);assert.equal(run.state.score,'0');
      const duplicate=(await call('/runs','POST',{level_key:'p1@1',request_id:'official-run'},key)).json();assert.equal(duplicate.run_id,run.run_id);
      assert.equal((await call('/runs','POST',{level_key:'intro@1',request_id:'official-run'},key)).statusCode,409);
      const body={request_id:'first',expected_revision:0,action:{type:'toggle_edge',edge_id:0}};
      const [one,two]=await Promise.all([call('/runs/'+run.run_id+'/actions','POST',body,key),call('/runs/'+run.run_id+'/actions','POST',body,key)]);assert.equal(one.statusCode,200);assert.deepEqual(one.json(),two.json());run=one.json();validate('Run',run);assert.equal(run.revision,1);assert.equal(run.state.score,'1/2');
      assert.equal((await call('/runs/'+run.run_id+'/actions','POST',{...body,action:{type:'reset'}},key)).statusCode,409);
      assert.equal((await call('/runs/'+run.run_id+'/actions','POST',{...body,request_id:'stale'},key)).json().error.code,'revision_conflict');
      assert.equal((await call('/runs/'+run.run_id+'/actions','POST',{request_id:'bad-edge',expected_revision:1,action:{type:'toggle_edge',edge_id:15}},key)).statusCode,400);
      const saved=(await call('/runs/'+run.run_id,'GET',undefined,key)).json();assert.equal(saved.revision,1);assert.equal(saved.state.step_count,1);
      assert.equal((await server.store.pool.query("SELECT count(*)::int AS n FROM records WHERE level_key='p1@1'")).rows[0].n,0);
      const anotherKey=(await web('/me/api-keys','POST',{name:'Other'},otherCookie)).json().key;
      assert.equal((await call('/runs/'+run.run_id,'GET',undefined,anotherKey)).statusCode,404);
      assert.equal((await call('/runs/'+run.run_id+'/submit','POST',{request_id:'steal',expected_revision:1},anotherKey)).statusCode,404);
    });
    await t.test('parallel different requests cannot overwrite each other and forged state is rejected',async()=>{
      const fresh=(await call('/runs','POST',{level_key:'intro@1',request_id:'parallel-run'},key)).json();
      const attempts=await Promise.all(['parallel-a','parallel-b'].map(request_id=>call('/runs/'+fresh.run_id+'/actions','POST',{request_id,expected_revision:0,action:{edge_id:0,type:'toggle_edge'}},key)));
      assert.deepEqual(attempts.map(r=>r.statusCode).sort(),[200,409]);
      const state=(await call('/runs/'+fresh.run_id,'GET',undefined,key)).json();assert.equal(state.revision,1);assert.equal(state.state.score,'4');
      const winning=attempts.find(r=>r.statusCode===200)!.json();
      const receipt=(await server.store.pool.query('SELECT request_id FROM ai_run_requests WHERE run_id=$1',[fresh.run_id])).rows[0].request_id;
      assert.deepEqual((await call('/runs/'+fresh.run_id+'/actions','POST',{request_id:receipt,expected_revision:0,action:{type:'toggle_edge',edge_id:0}},key)).json(),winning);
      const forged=await call('/runs/'+fresh.run_id+'/submit','POST',{request_id:'forged',expected_revision:1,score:'999',state:{score:'999'}},key);assert.equal(forged.statusCode,400);validate('Error',forged.json());
      const oldOrigin=await server.app.inject({url:'/api/me/api-keys',method:'POST',headers:{cookie,'x-waterline-request':'1',origin:'https://another.test'},payload:{name:'blocked'}});assert.equal(oldOrigin.statusCode,403);
    });
    await t.test('AI submits to the human board, keeps its best replay, and masks higher scores on every page',async()=>{
      await web('/runs','POST',{key:'p1@1',moves:[0,0,1]},humanCookie);
      const locked=(await call('/levels/p1%401/leaderboard','GET',undefined,key)).json();assert.equal(locked.unlocked,false);assert.deepEqual(locked.records,[]);
      const body={request_id:'submit-1',expected_revision:run.revision};
      const response=await call('/runs/'+run.run_id+'/submit','POST',body,key);assert.equal(response.statusCode,200);const result=response.json();validate('Submission',result);assert.equal(result.submitted_score,'1/2');assert.equal(result.submitted_rank,2);assert.equal(result.best.rank,2);assert.equal(result.best.improved,true);run=result.run;
      assert.deepEqual((await call('/runs/'+run.run_id+'/submit','POST',body,key)).json(),result);
      assert.equal(result.leaderboard.records[0].score,null);assert.equal(JSON.stringify(result).includes('3/4'),false);assert.deepEqual(result.leaderboard.mine.moves,[0]);
      const page=(await call('/levels/p1%401/leaderboard?offset=0&limit=1','GET',undefined,key)).json();validate('Leaderboard',page);assert.equal(page.records[0].score,null);
      assert.equal((await web('/levels/p1@1/leaderboard','GET',undefined,cookie)).json().records[1].playerId,'ai_player');
      run=(await call('/runs/'+run.run_id+'/actions','POST',{request_id:'reset-1',expected_revision:run.revision,action:{type:'reset'}},key)).json();
      const worse=(await call('/runs/'+run.run_id+'/submit','POST',{request_id:'submit-worse',expected_revision:run.revision},key)).json();validate('Submission',worse);assert.equal(worse.submitted_score,'0');assert.equal(worse.submitted_rank,2);assert.equal(worse.best.score,'1/2');assert.equal(worse.best.improved,false);assert.deepEqual(worse.leaderboard.mine.moves,[0]);run=worse.run;
      await web('/runs','POST',{key:'p1@1',moves:[0]},otherCookie);
      const lower=(await call('/runs/'+run.run_id+'/submit','POST',{request_id:'submit-worse-2',expected_revision:run.revision},key)).json();assert.equal(lower.submitted_rank,3);assert.equal(lower.best.rank,2);run=lower.run;
      const board=(await call('/levels/p1%401/leaderboard','GET',undefined,key)).json();assert.deepEqual(board.records.map((r:any)=>r.rank),[1,2,2]);assert.deepEqual(board.records.map((r:any)=>r.score),[null,'1/2','1/2']);
      assert.equal((await call('/levels/p1%401/leaderboard?limit=51','GET',undefined,key)).statusCode,400);
    });
    await t.test('state and receipts survive app restart, API keys can be revoked, and closing a run preserves scores',async()=>{
      await server.app.close();server=await createApp(options);
      const restored=(await call('/runs/'+run.run_id,'GET',undefined,key)).json();assert.deepEqual(restored,run);
      const retried=(await call('/runs/'+run.run_id+'/actions','POST',{request_id:'first',expected_revision:0,action:{type:'toggle_edge',edge_id:0}},key)).json();assert.equal(retried.revision,1);assert.equal(retried.state.score,'1/2');
      assert.equal((await call('/unknown','GET',undefined,key)).statusCode,404);validate('Error',(await call('/unknown','GET',undefined,key)).json());
      assert.equal((await call('/runs/'+run.run_id,'DELETE',undefined,key)).statusCode,200);assert.equal((await call('/runs/'+run.run_id,'GET',undefined,key)).statusCode,404);
      const best=(await web('/bootstrap','GET',undefined,cookie)).json().records['p1@1'];assert.equal(best.score,'1/2');assert.deepEqual(best.moves,[0]);
      const keys=(await web('/me/api-keys','GET',undefined,cookie)).json().keys;assert.equal((await web('/me/api-keys/'+keys[0].id,'DELETE',undefined,cookie)).statusCode,200);
      assert.equal((await call('/me','GET',undefined,key)).statusCode,401);
      const doc=await call('/openapi.json');assert.equal(doc.statusCode,200);assert.ok(doc.json().paths['/runs/{id}/actions']);
      const guide=await call('/docs');assert.equal(guide.statusCode,200);assert.match(String(guide.headers['content-type']),/text\/html/);assert.match(guide.body,/开始调用/);assert.match(guide.body,/并不表示接口正在报错/);assert.match(guide.body,/\/api\/ai\/v1\/openapi\.json/);assert.match(guide.body,/http:\/\/localhost:80\/api\/ai\/v1/);
    });
    await t.test('expired runs never mutate and deleting a workshop level stops further submissions',async()=>{
      const nextKey=(await web('/me/api-keys','POST',{name:'Remaining'},cookie)).json().key;
      const expired=(await call('/runs','POST',{level_key:'intro@1',request_id:'expired'},nextKey)).json();
      await server.store.pool.query('UPDATE ai_runs SET expires_at=0 WHERE id=$1',[expired.run_id]);
      const gone=await call('/runs/'+expired.run_id+'/actions','POST',{request_id:'late',expected_revision:0,action:{type:'toggle_edge',edge_id:0}},nextKey);assert.equal(gone.statusCode,410);assert.equal(gone.json().error.code,'run_expired');
      const level=(await call('/levels?source=workshop','GET',undefined,nextKey)).json().levels[0];
      const active=(await call('/runs','POST',{level_key:level.level_key,request_id:'deleted-workshop'},nextKey)).json();
      assert.equal((await web('/levels/'+encodeURIComponent(level.level_key),'DELETE',undefined,humanCookie)).statusCode,200);
      const moved=await call('/runs/'+active.run_id+'/actions','POST',{request_id:'snapshot-step',expected_revision:0,action:{type:'toggle_edge',edge_id:0}},nextKey);assert.equal(moved.statusCode,200);
      const rejected=await call('/runs/'+active.run_id+'/submit','POST',{request_id:'deleted-submit',expected_revision:1},nextKey);assert.equal(rejected.statusCode,404);validate('Error',rejected.json());
      assert.equal((await call('/runs/'+active.run_id,'GET',undefined,nextKey)).json().revision,1);
      const changed=(await call('/runs','POST',{level_key:'intro@1',request_id:'changed-level'},nextKey)).json();
      await server.store.pool.query("UPDATE levels SET puzzle=jsonb_set(puzzle,'{w}','[\"0\",\"10\"]') WHERE key='intro@1'");
      const mismatch=await call('/runs/'+changed.run_id+'/submit','POST',{request_id:'changed-submit',expected_revision:0},nextKey);assert.equal(mismatch.statusCode,409);assert.equal(mismatch.json().error.code,'level_changed');
    });
  }finally{await server.app.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
