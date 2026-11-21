import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../server/app.js';
import { VerificationPool } from '../server/workers.js';
import { validateDraft } from '../server/draft.js';

const url = process.env.DATABASE_URL;
test('exact worker verification, canonical edge mapping and fraction ranking', async () => {
  const pool = new VerificationPool(2);
  try {
    const result = await pool.run('publish', {puzzle:{id:'x',name:'x',w:['1','0','1'],e:[[1,2],[0,1]],t:1},moves:[1,1,0]});
    assert.equal(result.score,'3/4'); assert.deepEqual(result.moves,[0,0,1]);
    assert.equal(result.puzzle.goalWater,undefined);
    const initial=await pool.run('publish',{puzzle:{w:['0','8'],e:[[0,1]],t:0,goalWater:'999'},moves:[]});
    assert.equal(initial.score,'0');assert.equal(initial.puzzle.goalWater,undefined);
    assert.equal((await pool.run('replay',{puzzle:{...initial.puzzle,source:'community',goalWater:'4'},moves:[0]})).completionMoves,null);
    const completion=await pool.run('replay',{puzzle:{source:'official',goalWater:'4',w:['0','8'],e:[[0,1]],t:0},moves:[0,0]});
    assert.deepEqual(completion.completionMoves,[0]);
    const ranked = await pool.run('rank',[
      {id:'a',score:'9007199254740992/9007199254740993',achievedAt:1},
      {id:'b',score:'9007199254740993/9007199254740994',achievedAt:9},
      {id:'c',score:'1/2',achievedAt:3},{id:'d',score:'1/2',achievedAt:2}
    ]);
    assert.deepEqual(ranked.map((row:any)=>row.id),['b','a','d','c']);
    assert.deepEqual(ranked.map((row:any)=>row.rank),[1,2,3,3]);
    await assert.rejects(pool.run('replay',{puzzle:{w:['0','8'],e:[[0,1]],t:0},moves:[2]}));
  } finally {await pool.close();}
});

test('workshop drafts discard legacy finish lines and validate node water',()=>{
  const raw={name:'草稿',w:['0','8'],e:[[0,1]],t:0,pos:[[100,200],[600,200]],goalWater:'4/6'};
  assert.equal(validateDraft(raw)?.goalWater,undefined);
  assert.equal(validateDraft({...raw,goalWater:''})?.goalWater,undefined);
  assert.equal(validateDraft({...raw,goalWater:'-1'})?.goalWater,undefined);
  assert.throws(()=>validateDraft({...raw,w:['-1','8']}));
});


const withDatabase=async(run:(server:any,options:any,restart:()=>Promise<void>)=>Promise<void>)=>{
  const admin=new pg.Pool({connectionString:url}),schema='waterline_submit_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const options={databaseUrl:url!,workers:2,poolOptions:{options:`-c search_path=${schema}`}};
  const holder={current:await createApp(options)};
  try{await run(holder,options,async()=>{await holder.current.app.close();holder.current=await createApp(options);});}
  finally{await holder.current.app.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
};

test('legacy best records survive the submission-only migration without restoring old attempts',{skip:!url,timeout:30000},async()=>withDatabase(async(holder,_options,restart)=>{
  let response=await holder.current.app.inject({method:'POST',url:'/api/auth/register',headers:{'x-waterline-request':'1'},payload:{username:'legacy_player',password:'testing-password'}});
  const cookie=response.headers['set-cookie']!.toString().split(';')[0],id=response.json().player.id;
  const old={id:'legacy',source:'community',version:1,name:'旧作品名称',w:['0','8'],e:[[0,1]],t:0,goalWater:'4',authorScore:'4',referenceMoves:[0],pos:[[180,240],[620,240]]};
  await holder.current.store.pool.query("INSERT INTO levels(key,author_id,source,puzzle,published_at) VALUES('legacy@1',$1,'community',$2,1)",[id,JSON.stringify(old)]);
  response=await holder.current.app.inject({method:'POST',url:'/api/runs',headers:{cookie,'x-waterline-request':'1'},payload:{key:'legacy@1',moves:[0]}});
  assert.equal(response.statusCode,200);
  await holder.current.store.pool.query("INSERT INTO progress(player_id,level_key,moves,updated_at) VALUES($1,'intro@1','[0]',1)",[id]);
  await holder.current.app.close();
  const admin=new pg.Pool({connectionString:url,options:holder.current.store.pool.options.options});
  try {await admin.query('ALTER TABLE levels DROP COLUMN author_sequence, DROP COLUMN featured_at, DROP COLUMN deleted_at');}
  finally{await admin.end();}
  holder.current=await createApp(_options);
  const bootstrap=(await holder.current.app.inject({url:'/api/bootstrap',headers:{cookie}})).json();
  assert.equal(bootstrap.levels.find((p:any)=>p.id==='legacy').name,'legacy_player-1');
  assert.equal(bootstrap.levels.find((p:any)=>p.id==='legacy').goalWater,undefined);
  assert.deepEqual(bootstrap.records['legacy@1'].moves,[0]);assert.equal(bootstrap.records['legacy@1'].score,'4');
  assert.deepEqual(bootstrap.progress,{});assert.deepEqual(bootstrap.completions,{});
  assert.equal((await holder.current.store.pool.query('SELECT count(*)::int AS n FROM progress')).rows[0].n,1);
  await restart();
  const again=(await holder.current.app.inject({url:'/api/bootstrap',headers:{cookie}})).json();
  assert.equal(again.levels.find((p:any)=>p.id==='legacy').name,'legacy_player-1');
  assert.equal(again.records['legacy@1'].score,'4');
}));

test('submission-led accounts, masked ranks, public player profiles and workshop ownership',{skip:!url,timeout:45000},async t=>withDatabase(async(holder,options,restart)=>{
  const api=async(method:string,path:string,body?:unknown,cookie?:string,extra:Record<string,string>={})=>{
    const response=await holder.current.app.inject({method:method as any,url:'/api'+path,headers:{'x-waterline-request':'1',...(cookie?{cookie}:{}),...extra},...(body===undefined?{}:{payload:body})});
    return {status:response.statusCode,data:response.json(),cookie:response.headers['set-cookie']?.toString().split(';')[0]};
  };
  const alice=await api('POST','/auth/register',{username:'alice',password:'testing-password'});
  const bob=await api('POST','/auth/register',{username:'bob',password:'testing-password'});
  const carol=await api('POST','/auth/register',{username:'carol',password:'testing-password'});
  const key='p1@1',raw={w:['1','0','1'],e:[[1,2],[0,1]],t:1,pos:[[180,240],[400,240],[620,240]],description:'留给玩家的话'};
  let publicationKey:string,first:any;
  await t.test('old auto-save requests cannot write attempts, and public puzzles carry no answers',async()=>{
    assert.equal(alice.status,201);assert.equal(bob.status,201);
    const hashes=await holder.current.store.pool.query('SELECT password_hash FROM players');assert.ok(hashes.rows.every((row:any)=>row.password_hash.startsWith('scrypt:')));
    assert.equal((await api('POST','/auth/login',{username:'alice',password:'wrong-password'})).status,401);
    assert.equal((await api('POST','/auth/register',{username:'ALICE',password:'testing-password'})).status,409);
    assert.equal((await api('PUT','/me/progress/'+key,{moves:[0],revision:0},alice.cookie)).status,410);
    assert.equal((await api('POST','/me/import-local',{progress:{[key]:[0]}},alice.cookie)).status,410);
    assert.equal((await api('POST','/runs',{key,moves:[0]})).status,401);
    assert.equal((await api('POST','/runs',{key,moves:[0]},bob.cookie,{'x-waterline-player':alice.data.player.id})).status,409);
    assert.equal((await api('POST','/runs',{key,moves:[0]},alice.cookie,{origin:'https://evil.test'})).status,403);
    const bootstrap=(await api('GET','/bootstrap',undefined,alice.cookie)).data;
    assert.deepEqual(bootstrap.progress,{});assert.deepEqual(bootstrap.records,{});
    for(const level of bootstrap.levels)for(const field of ['goalWater','optimalWater','plan','referenceMoves','authorScore','lesson'])assert.equal(level[field],undefined);
    assert.equal((await holder.current.store.pool.query('SELECT count(*)::int AS n FROM progress')).rows[0].n,0);
  });
  await t.test('only the best exact score and its corresponding moves are retained',async()=>{
    first=await api('POST','/runs',{key,moves:[0,0,1],score:'999'},alice.cookie);assert.equal(first.status,400);
    first=await api('POST','/runs',{key,moves:[0,0,1]},alice.cookie);assert.equal(first.status,200);assert.equal(first.data.record.score,'3/4');
    const same=await api('POST','/runs',{key,moves:[0,0,1,1,1]},alice.cookie),worse=await api('POST','/runs',{key,moves:[]},alice.cookie);
    assert.equal(same.data.improved,false);assert.equal(worse.data.improved,false);
    assert.equal(worse.data.record.achievedAt,first.data.record.achievedAt);assert.deepEqual(worse.data.record.moves,[0,0,1]);
    assert.equal((await api('POST','/runs',{key,moves:[99]},alice.cookie)).status,400);
    const bootstrap=(await api('GET','/bootstrap',undefined,alice.cookie)).data;
    assert.equal(bootstrap.records[key].score,'3/4');assert.deepEqual(bootstrap.records[key].moves,[0,0,1]);assert.equal(bootstrap.records[key].rank,1);
    assert.deepEqual(bootstrap.progress,{});assert.deepEqual(bootstrap.completions,{});
  });
  await t.test('masked boards share dense ranks and do not expose higher scores on any page',async()=>{
    const before=(await api('GET','/levels/'+key+'/leaderboard',undefined,bob.cookie)).data;
    assert.equal(before.unlocked,false);assert.deepEqual(before.records,[]);
    assert.equal((await api('POST','/runs',{key,moves:[0]},bob.cookie)).data.rank,2);
    assert.equal((await api('POST','/runs',{key,moves:[0,0]},carol.cookie)).data.rank,2);
    const board=(await api('GET','/levels/'+key+'/leaderboard',undefined,bob.cookie)).data;
    assert.deepEqual(board.records.map((row:any)=>row.rank),[1,2,2]);
    assert.deepEqual(board.records.map((row:any)=>row.score),[null,'1/2','1/2']);
    assert.equal(board.records[0].playerId,'alice');assert.equal(JSON.stringify(board).includes('3/4'),false);
    assert.equal(JSON.stringify(board.records).includes('moves'),false);assert.equal(board.mine.playerId,bob.data.player.id);
    const page=(await api('GET','/levels/'+key+'/leaderboard?offset=0&limit=1',undefined,bob.cookie)).data;
    assert.equal(page.records.length,1);assert.equal(page.records[0].score,null);
    assert.equal((await api('GET','/levels/'+key+'/leaderboard?offset=1&limit=1',undefined,bob.cookie)).data.records[0].score,'1/2');
    assert.equal((await api('GET','/levels/'+key+'/leaderboard?offset=-1',undefined,bob.cookie)).status,400);
    assert.equal((await api('GET','/levels/'+key+'/leaderboard?limit=51',undefined,bob.cookie)).status,400);
    const guest=(await api('GET','/levels/'+key+'/leaderboard')).data;assert.deepEqual(guest.records,[]);assert.equal(guest.mine,null);
  });
  await t.test('player ID searches and profiles respect the same score visibility',async()=>{
    assert.equal((await api('GET','/players?q=ali',undefined,bob.cookie)).data.players[0].username,'alice');
    const profile=(await api('GET','/players/alice',undefined,bob.cookie)).data;
    assert.equal(profile.records[0].score,null);assert.equal(profile.records[0].rank,1);
    assert.equal(JSON.stringify(profile).includes('3/4'),false);assert.equal(JSON.stringify(profile).includes('moves'),false);
    assert.equal((await api('GET','/players/alice',undefined,alice.cookie)).data.records[0].score,'3/4');
    assert.equal((await api('GET','/players/alice')).data.records[0].score,null);
    assert.equal((await api('GET','/players/nobody')).status,404);
  });
  await t.test('a delayed cache notification never pairs a previous best score with newer replay moves',async()=>{
    const viewer=await api('POST','/auth/register',{username:'cache_race',password:'testing-password'});
    await api('POST','/runs',{key,moves:[0]},viewer.cookie);
    // Simulate a second writer committing before its NOTIFY is delivered here.
    await holder.current.store.pool.query("UPDATE records SET score='3/4',moves='[0,0,1]' WHERE player_id=$1 AND level_key=$2",[viewer.data.player.id,key]);
    const board=await holder.current.store.leaderboard(key,viewer.data.player.id);
    assert.equal(board.mine.score,'3/4');assert.equal(board.rank,1);
    assert.deepEqual(board.mine.moves,[0,0,1]);
  });
  await t.test('drafts have no title or goal and concurrent publications receive unique stable names',async()=>{
    const draft=await api('PUT','/me/draft',{puzzle:{...raw,name:'ignored',goalWater:'9'},revision:0},alice.cookie);
    assert.equal(draft.status,200);assert.equal(draft.data.puzzle.name,'');assert.equal(draft.data.puzzle.goalWater,undefined);
    assert.equal((await api('GET','/bootstrap',undefined,bob.cookie)).data.draft.puzzle,null);
    assert.equal((await api('PUT','/me/draft',{puzzle:raw,revision:0},alice.cookie)).status,409);
    const published=await api('POST','/levels',{puzzle:raw,moves:[1,1,0],draftRevision:1},alice.cookie);
    assert.equal(published.status,200);assert.equal(published.data.level.name,'alice-1');publicationKey=published.data.level.id+'@1';
    assert.equal(published.data.level.referenceMoves,undefined);assert.equal(published.data.level.authorScore,undefined);
    assert.equal((await api('GET','/bootstrap',undefined,alice.cookie)).data.records[publicationKey],undefined);
    assert.equal((await api('GET','/bootstrap',undefined,alice.cookie)).data.draft.puzzle,null);
    const parallel=await Promise.all([api('POST','/levels',{puzzle:raw,moves:[],draftRevision:0},alice.cookie),api('POST','/levels',{puzzle:raw,moves:[],draftRevision:0},alice.cookie)]);
    assert.deepEqual(parallel.map(result=>result.data.level.name).sort(),['alice-2','alice-3']);
    assert.equal((await api('GET','/players/alice',undefined,bob.cookie)).data.levels.length,3);
    assert.equal((await api('POST','/levels',{puzzle:{...raw,e:[]},moves:[],draftRevision:0},alice.cookie)).status,400);
  });
  await t.test('author deletion preserves history and never reuses a publication number',async()=>{
    await api('POST','/runs',{key:publicationKey,moves:[0,0,1]},alice.cookie);
    assert.equal((await api('DELETE','/levels/'+publicationKey)).status,401);
    assert.equal((await api('DELETE','/levels/'+publicationKey,undefined,bob.cookie)).status,403);
    assert.equal((await api('DELETE','/levels/intro@1',undefined,alice.cookie)).status,403);
    assert.equal((await api('DELETE','/levels/'+publicationKey,undefined,alice.cookie)).status,200);
    assert.equal((await api('GET','/levels/'+publicationKey+'/leaderboard',undefined,alice.cookie)).status,404);
    assert.equal((await api('POST','/runs',{key:publicationKey,moves:[]},alice.cookie)).status,404);
    assert.equal((await api('GET','/levels')).data.levels.some((p:any)=>p.id+'@1'===publicationKey),false);
    const next=await api('POST','/levels',{puzzle:raw,moves:[],draftRevision:0},alice.cookie);assert.equal(next.data.level.name,'alice-4');
    assert.equal((await holder.current.store.pool.query('SELECT count(*)::int AS n FROM records WHERE level_key=$1',[publicationKey])).rows[0].n,1);
  });
  await t.test('live score events reach a second server and a weaker concurrent run cannot replace a best',async()=>{
    const second=await createApp(options);await second.app.listen({host:'127.0.0.1',port:0});const abort=new AbortController();
    const stream=await fetch(second.app.listeningOrigin+'/api/events?key='+key,{signal:abort.signal}),reader=stream.body!.getReader();await reader.read();
    const event=reader.read();
    try {
      await Promise.all([api('POST','/runs',{key,moves:[0,0,1]},bob.cookie),api('POST','/runs',{key,moves:[]},bob.cookie)]);
      const timer=AbortSignal.timeout(5000);const update=await Promise.race([event,new Promise<never>((_,reject)=>timer.addEventListener('abort',()=>reject(Error('SSE timeout'))))]);
      assert.match(new TextDecoder().decode(update.value),/"kind":"score"/);
      assert.equal((await api('GET','/bootstrap',undefined,bob.cookie)).data.records[key].score,'3/4');
    } finally {abort.abort();await reader.cancel().catch(()=>{});await second.app.close();}
  });
  await t.test('restart preserves submitted moves, identities, private drafts and stable catalog names',async()=>{
    await api('PUT','/me/draft',{puzzle:{...raw,description:'Bob private draft'},revision:0},bob.cookie);await restart();
    const aliceState=(await api('GET','/bootstrap',undefined,alice.cookie)).data,bobState=(await api('GET','/bootstrap',undefined,bob.cookie)).data;
    assert.deepEqual(aliceState.records[key].moves,[0,0,1]);assert.equal(aliceState.records[key].score,'3/4');
    assert.deepEqual(aliceState.progress,{});assert.equal(bobState.draft.puzzle.description,'Bob private draft');
    assert.deepEqual(aliceState.levels.filter((p:any)=>p.source==='community').map((p:any)=>p.name).sort(),['alice-2','alice-3','alice-4']);
    assert.equal((await holder.current.app.inject('/.env')).statusCode,404);assert.equal((await holder.current.app.inject('/server/schema.sql')).statusCode,404);
    assert.equal((await api('POST','/auth/logout',undefined,alice.cookie)).status,200);
    assert.equal((await api('GET','/bootstrap',undefined,alice.cookie)).data.player,null);
  });
}));
