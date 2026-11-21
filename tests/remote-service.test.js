import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RemoteService} from '../src/remote-service.js';
const puzzle={id:'intro',version:1,w:['0','8'],e:[[0,1]],t:0};
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};};
const state=()=>({player:{id:'alice',name:'Alice'},levels:[puzzle],progress:{},draft:{puzzle:null,revision:0},records:{},preferences:{}});

test('API keys are requested for the current account and never enter persisted browser storage',async()=>{
  const memory=storage(),calls=[];
  const service=new RemoteService({storage:memory,events:false,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({key:'wl_test_secret'})};}});service.data=state();
  try{
    const result=await service.createApiKey('Model');assert.equal(result.key,'wl_test_secret');assert.equal(calls[0].url,'/api/me/api-keys');assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.headers['X-Waterline-Player'],'alice');
    service.persist();assert.equal(JSON.stringify(service.data).includes('wl_test_secret'),false);assert.equal(memory.getItem(service.journalKey).includes('wl_test_secret'),false);
    await service.getApiKeys();await service.revokeApiKey('key-id');assert.equal(calls[2].options.method,'DELETE');
    service.data.player=null;await assert.rejects(service.getApiKeys(),/登录/);
  }finally{service.close();}
});

test('a late API-key secret cannot be shown under another player account',async()=>{
  let finish;const service=new RemoteService({storage:storage(),events:false,fetch:async()=>{await new Promise(resolve=>finish=resolve);return {ok:true,json:async()=>({key:'private-secret'})};}});service.data=state();
  try{const creating=service.createApiKey('Model');await new Promise(resolve=>setImmediate(resolve));service.generation++;service.data.player={id:'bob',name:'Bob'};finish();await assert.rejects(creating,/原账号/);}finally{service.close();}
});

test('deleting an owned workshop level sends an authenticated request and refreshes the catalog',async()=>{
  const owned={...puzzle,id:'community-owned',source:'community',authorId:'alice'};
  const requests=[];
  const service=new RemoteService({storage:storage(),events:false,fetch:async(url,options)=>{
    requests.push({url,options});return {ok:true,json:async()=>url==='/api/bootstrap'?state():{ok:true}};
  }});
  service.data={...state(),levels:[puzzle,owned]};
  service.boards.set('community-owned@1',{mine:{playerId:'alice'},rank:1});
  try {
    await service.deleteLevel('community-owned@1');
    assert.equal(requests[0].url,'/api/levels/community-owned%401');
    assert.equal(requests[0].options.method,'DELETE');
    assert.equal(requests[0].options.headers['X-Waterline-Player'],'alice');
    assert.equal(service.getLevel('community-owned@1'),null);
    assert.equal(service.boards.has('community-owned@1'),false);
    assert.equal(requests[1].url,'/api/bootstrap');
    service.data.levels.push({...owned,authorId:'bob'});
    await assert.rejects(service.deleteLevel('community-owned@1'),/自己发布/);
    await assert.rejects(service.deleteLevel('intro@1'),/自己发布/);
    service.data.player=null;await assert.rejects(service.deleteLevel('community-owned@1'),/登录/);
    assert.equal(requests.length,2);
  } finally {service.close();}
});

test('a late deletion response cannot remove data belonging to a newly active account',async()=>{
  const owned={...puzzle,id:'community-owned',source:'community',authorId:'alice'};let finish;
  const service=new RemoteService({storage:storage(),events:false,fetch:async()=>{
    await new Promise(resolve=>finish=resolve);return {ok:true,json:async()=>({ok:true})};
  }});
  service.data={...state(),levels:[owned]};
  try {
    const deleting=service.deleteLevel('community-owned@1');
    await new Promise(resolve=>setImmediate(resolve));
    service.generation++;service.data={...state(),player:{id:'bob',name:'Bob'},levels:[owned],records:{'community-owned@1':{playerId:'bob',score:'2'}}};
    finish();await assert.rejects(deleting,/原账号/);
    assert.equal(service.getLevel('community-owned@1').id,owned.id);
    assert.equal(service.data.records['community-owned@1'].playerId,'bob');
  } finally {service.close();}
});
test('attempts never enter the persistence journal, even after refreshing',async()=>{
  const calls=[],memory=storage();const service=new RemoteService({storage:memory,events:false,fetch:async(url)=>{calls.push(url);return {ok:true,json:async()=>({...state(),progress:{'intro@1':{moves:[0],revision:2}}})};}});
  service.data=state();try{service.saveProgress(puzzle,[0]);await service.flush();assert.deepEqual(calls,[]);assert.deepEqual(service.items(),{});await service.refresh();assert.deepEqual(service.getProgress(puzzle),[]);}finally{service.close();}
});

test('draft autosave serializes concurrent edits and retains unsynced conflicts',async()=>{
  let finish;const calls=[],memory=storage();const service=new RemoteService({storage:memory,events:false,fetch:async(_url,options)=>{
    calls.push(JSON.parse(options.body));if(calls.length===1)await new Promise(resolve=>finish=resolve);return {ok:true,json:async()=>({revision:calls.length})};
  }});service.data=state();
  try{service.saveDraft({...puzzle,description:'one'});const saving=service.flush();service.saveDraft({...puzzle,description:'two'});finish();await saving;assert.deepEqual(calls.map(item=>item.revision),[0,1]);assert.equal(service.getDraft().description,'two');
    service.fetch=async()=>({ok:false,status:409,json:async()=>({message:'other device'})});service.saveDraft({...puzzle,description:'three'});await assert.rejects(service.flush(),/other device/);assert.equal(service.items().draft.blocked,true);
    const restored=new RemoteService({storage:memory,events:false});try{restored.data=state();assert.equal(restored.items().draft.body.puzzle.description,'three');}finally{restored.close();}
  }finally{service.close();}
});

test('old pending attempts are archived for export instead of being silently uploaded',async()=>{
  const memory=storage();memory.setItem('waterline-pending-v1',JSON.stringify({alice:{'intro@1':{path:'/me/progress/intro%401',body:{moves:[0],revision:0}}}}));
  const service=new RemoteService({storage:memory,events:false});service.data=state();
  try{assert.deepEqual(service.items(),{});assert.deepEqual(service.pendingBackup().archivedAttempts['intro@1'].body.moves,[0]);service.persist();assert.ok(memory.getItem('waterline-archived-attempts-v1'));}finally{service.close();}
});

test('personal dense rank loads and updates on refresh',async()=>{
  const service=new RemoteService({storage:storage(),events:false});service.data=state();
  service.boards.set('intro@1',{rank:101,mine:{playerId:'alice',score:'4',rank:101},total:201});
  service.fetch=async()=>({ok:true,json:async()=>({rank:102,mine:{playerId:'alice',score:'4',rank:102},total:202})});
  try {assert.equal(service.getMyRecord('intro@1').rank,101);assert.equal(service.getRank('intro@1'),101);assert.equal(service.getSubmissionCount('intro@1'),201);await service.loadLeaderboard('intro@1');assert.equal(service.getRank('intro@1'),102);assert.deepEqual(service.getLeaderboard('intro@1'),[]);}
  finally {service.close();}
});

test('a profile response prepared for a previous account cannot reveal its scores after switching',async()=>{
  let finish;
  const service=new RemoteService({storage:storage(),events:false,fetch:async()=>{await new Promise(resolve=>finish=resolve);return {ok:true,json:async()=>({player:{username:'target'},records:[{score:'99'}]})};}});
  service.data=state();
  try {
    const reading=service.getPlayerProfile('target');await new Promise(resolve=>setImmediate(resolve));
    service.generation++;service.data={...state(),player:{id:'bob',name:'Bob'}};finish();
    await assert.rejects(reading,/账号已切换/);
  }finally{service.close();}
});
test('expired sessions preserve draft changes but clear private scores and rankings',async()=>{
  const service=new RemoteService({storage:storage(),events:false,fetch:async()=>({ok:false,status:401,json:async()=>({message:'请重新登录'})})});service.data=state();service.saveDraft({...puzzle,description:'private'});
  try{await assert.rejects(service.flush(),/登录/);assert.equal(service.getProfile(),null);assert.equal(service.pending.alice.draft.body.puzzle.description,'private');assert.equal(service.boards.size,0);}finally{service.close();}
});

test('a late submission response cannot replace the new account private record or leaderboard',async()=>{
  let finish;const requests=[];
  const service=new RemoteService({storage:storage(),events:false,fetch:async(_url,options)=>{
    requests.push(options);await new Promise(resolve=>finish=resolve);
    return {ok:true,json:async()=>({record:{playerId:'alice',score:'4'},rank:1,leaderboard:{mine:{playerId:'alice',score:'4'},rank:1,total:1}})};
  }});
  service.data=state();
  try {
    const saving=service.submitRun({key:'intro@1',moves:[0]});
    await new Promise(resolve=>setImmediate(resolve));
    service.generation++;service.data={...state(),player:{id:'bob',name:'Bob'},records:{'intro@1':{playerId:'bob',score:'2'}}};
    service.boards.set('intro@1',{mine:{playerId:'bob',score:'2'},rank:2,total:2});
    finish();await assert.rejects(saving,/回到原账号/);
    assert.equal(requests[0].headers['X-Waterline-Player'],'alice');
    assert.equal(service.getMyRecord('intro@1').playerId,'bob');
    assert.equal(service.data.records['intro@1'].playerId,'bob');
    assert.equal(service.getRank('intro@1'),2);
  } finally {service.close();}
});

test('account switches during pending saves prevent sending a publication under the new account',async()=>{
  let finish;const requests=[];
  const service=new RemoteService({storage:storage(),events:false,fetch:async(url,options)=>{
    requests.push(url);await new Promise(resolve=>finish=resolve);return {ok:true,json:async()=>({revision:1})};
  }});
  service.data=state();service.saveDraft(puzzle);
  try {
    const publishing=service.publishLevel(puzzle,[0]);
    await new Promise(resolve=>setImmediate(resolve));
    service.generation++;service.data={...state(),player:{id:'bob',name:'Bob'}};
    finish();await assert.rejects(publishing,/当前账号重新发布/);
    assert.deepEqual(requests,['/api/me/draft']);
  } finally {service.close();}
});

test('a late publication response does not refresh or replace the new account draft',async()=>{
  let finish;const requests=[];
  const service=new RemoteService({storage:storage(),events:false,fetch:async(url,options)=>{
    requests.push({url,options});await new Promise(resolve=>finish=resolve);
    return {ok:true,json:async()=>({level:{...puzzle,id:'community-created',source:'community'}})};
  }});
  service.data=state();
  try {
    const publishing=service.publishLevel(puzzle,[0]);
    await new Promise(resolve=>setImmediate(resolve));
    service.generation++;service.data={...state(),player:{id:'bob',name:'Bob'},draft:{puzzle:{name:'Bob draft'},revision:3}};
    finish();await assert.rejects(publishing,/原账号查看/);
    assert.equal(requests.length,1);assert.equal(requests[0].options.headers['X-Waterline-Player'],'alice');
    assert.equal(service.getDraft().name,'Bob draft');assert.equal(service.data.draft.revision,3);
  } finally {service.close();}
});

test('publication refresh ignores a response from the account active before the refresh',async()=>{
  let finish;
  const service=new RemoteService({storage:storage(),events:false,fetch:async url=>{
    if (url==='/api/levels') return {ok:true,json:async()=>({level:{...puzzle,id:'community-created',source:'community'}})};
    await new Promise(resolve=>finish=resolve);return {ok:true,json:async()=>state()};
  }});
  service.data=state();
  try {
    const publishing=service.publishLevel(puzzle,[0]);
    await new Promise(resolve=>setImmediate(resolve));
    service.generation++;service.data={...state(),player:{id:'bob',name:'Bob'},draft:{puzzle:{name:'Bob draft'},revision:2}};
    finish();await assert.rejects(publishing,/原账号查看/);
    assert.equal(service.getProfile().id,'bob');assert.equal(service.getDraft().name,'Bob draft');
  } finally {service.close();}
});
