import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { newToken, tokenHash } from './auth.js';
import { Store, nowSql } from './store.js';
import { ApiError, type Puzzle } from './types.js';
import { officialLevels } from '../src/levels.js';

export const AI_VERSION = '1';
export const RULES_VERSION = 'waterline-1';
const retention = 7 * 24 * 60 * 60 * 1000;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status: number, code: string, message: string): never => { throw new ApiError(status, message, code); };
const keyView = (row: any) => ({id:row.id,name:row.name,suffix:row.suffix,created_at:new Date(Number(row.created_at)).toISOString(),last_used_at:row.last_used_at ? new Date(Number(row.last_used_at)).toISOString() : null,revoked_at:row.revoked_at ? new Date(Number(row.revoked_at)).toISOString() : null});
const levelKey = (p: Puzzle) => `${p.id}@${p.version}`;
const puzzleHash = (p: Puzzle) => digest({w:p.w,e:p.e,t:p.t});
export const stateView = (puzzle: Puzzle, state: {water:string[];mask:number}, steps: number) => ({
  nodes:state.water.map((water,id)=>({id,water})),
  edges:puzzle.e.map(([from,to],id)=>({id,from,to,open:Boolean(state.mask & (1 << id))})),
  scoring_node_id:puzzle.t,score:state.water[puzzle.t],step_count:steps,
});
const runView = (row: any) => ({api_version:AI_VERSION,run_id:row.id,level_key:row.level_key,level_hash:row.level_hash,rules_version:RULES_VERSION,
  revision:row.revision,status:'active',expires_at:new Date(Number(row.expires_at)).toISOString(),state:stateView(row.puzzle,row.state,row.moves.length)});
const boardView = (board: any) => ({api_version:AI_VERSION,rank:board.rank,total:board.total,unlocked:board.unlocked,offset:board.offset,limit:board.limit,
  mine:board.mine ? {player_id:board.mine.playerUsername || board.mine.playerName,score:board.mine.score,rank:board.rank,moves:board.mine.moves || []} : null,
  records:board.records.map((row:any)=>({rank:row.rank,player_id:row.playerId,score:row.score,hidden:row.hidden,is_mine:row.isMine})),
});

export class AiStore {
  constructor(readonly store: Store) {}
  async listKeys(playerId: string) {
    const rows=await this.store.pool.query('SELECT id,name,suffix,created_at,last_used_at,revoked_at FROM api_keys WHERE player_id=$1 ORDER BY created_at DESC,id',[playerId]);
    return {keys:rows.rows.map(keyView)};
  }
  async createKey(playerId: string, name: string) {
    return this.store.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['api-keys:'+playerId]);
      const count=await client.query('SELECT count(*)::int AS n FROM api_keys WHERE player_id=$1 AND revoked_at IS NULL',[playerId]);
      if(count.rows[0].n>=20) fail(409,'key_limit','最多保留 20 个有效密钥，请先撤销不用的密钥');
      const secret='wl_'+newToken(),id=randomUUID();
      const rows=await client.query(`INSERT INTO api_keys(id,player_id,name,token_hash,suffix,created_at) VALUES($1,$2,$3,$4,$5,${nowSql}) RETURNING *`,[id,playerId,name.trim(),tokenHash(secret),secret.slice(-4)]);
      return {...keyView(rows.rows[0]),key:secret};
    });
  }
  async revokeKey(playerId: string, id: string) {
    const result=await this.store.pool.query(`UPDATE api_keys SET revoked_at=COALESCE(revoked_at,${nowSql}) WHERE id=$1 AND player_id=$2 RETURNING id`,[id,playerId]);
    if(!result.rows[0]) fail(404,'not_found','密钥不存在');
    return {ok:true};
  }
  async authenticate(secret: string) {
    const result=await this.store.pool.query(`UPDATE api_keys k SET last_used_at=${nowSql} FROM players p WHERE k.token_hash=$1 AND k.revoked_at IS NULL AND p.id=k.player_id RETURNING p.id,p.username,p.name`,[tokenHash(secret)]);
    if(!result.rows[0]) fail(401,'invalid_api_key','API Key 无效或已撤销');
    return result.rows[0];
  }
  async levels(source?: string, author?: string, offset=0, limit=25) {
    const catalog=await this.store.catalog();
    const current=new Set(officialLevels.map(p=>levelKey(p as Puzzle)));
    const levels=catalog.filter(p=>(p.source==='community'||current.has(levelKey(p))) && (!source||p.source===(source==='workshop'?'community':source)) && (!author||p.authorUsername===author))
      .sort((a,b)=>a.source===b.source ? a.source==='official' ? Number(a.number)-Number(b.number) : Number(b.publishedAt)-Number(a.publishedAt)||a.id.localeCompare(b.id) : a.source==='official'?-1:1);
    return {api_version:AI_VERSION,total:levels.length,offset,limit,levels:levels.slice(offset,offset+limit).map(p=>({level_key:levelKey(p),source:p.source==='community'?'workshop':'official',name:p.name,author_id:p.authorUsername || null,level_hash:puzzleHash(p)}))};
  }
  async level(key: string) {
    const p=await this.store.level(key);
    const catalog=await this.store.catalog(),meta=catalog.find(x=>levelKey(x)===key);
    if(!meta) return fail(404,'not_found','关卡版本不存在');
    return {api_version:AI_VERSION,level_key:key,level_hash:puzzleHash(p),rules_version:RULES_VERSION,source:p.source==='community'?'workshop':'official',name:meta.name,
      author_id:meta.authorUsername || null,author_message:p.source==='community' ? p.description || '' : null,
      initial_state:stateView(p,{water:p.w,mask:0},0)};
  }
  async createRun(playerId: string, key: string, requestId: string) {
    return this.store.transaction(async client=>{
      // Serialize creates per player so retries and the live-run cap work across replicas.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ai-create:'+playerId]);
      await client.query(`DELETE FROM ai_runs WHERE id IN (SELECT id FROM ai_runs WHERE expires_at<=${nowSql} LIMIT 1000)`);
      const existing=await client.query('SELECT * FROM ai_runs WHERE player_id=$1 AND creation_request_id=$2',[playerId,requestId]);
      if(existing.rows[0]) {
        if(existing.rows[0].level_key!==key) fail(409,'request_id_reused','同一个 request_id 不能用于不同请求');
        return runView(existing.rows[0]);
      }
      const active=await client.query('SELECT puzzle FROM levels WHERE key=$1 AND deleted_at IS NULL FOR SHARE',[key]);
      if(!active.rows[0]) fail(404,'not_found','关卡版本不存在');
      // Use the same public whitelist as /levels without obtaining another pool client.
      const raw=active.rows[0].puzzle;
      const p={id:raw.id,version:raw.version,source:raw.source,name:raw.name,w:raw.w,e:raw.e,t:raw.t} as Puzzle;
      const count=await client.query(`SELECT count(*)::int AS n FROM ai_runs WHERE player_id=$1 AND expires_at>${nowSql}`,[playerId]);
      if(count.rows[0].n>=100) fail(409,'run_limit','最多保留 100 个活动挑战，请关闭不用的挑战');
      const rows=await client.query(`INSERT INTO ai_runs(id,player_id,creation_request_id,level_key,puzzle,level_hash,state,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,${nowSql},${nowSql}+$8) RETURNING *`,
        [randomUUID(),playerId,requestId,key,JSON.stringify(p),puzzleHash(p),JSON.stringify({water:p.w,mask:0}),retention]);
      return runView(rows.rows[0]);
    });
  }
  private async ownedRun(client: PoolClient, id: string, playerId: string, lock=false) {
    const result=await client.query(`SELECT *,expires_at>${nowSql} AS live FROM ai_runs WHERE id=$1 AND player_id=$2${lock?' FOR UPDATE':''}`,[id,playerId]);
    const row=result.rows[0];
    if(!row) fail(404,'not_found','挑战不存在');
    if(!row.live) fail(410,'run_expired','挑战已过期，请重新开始');
    return row;
  }
  async getRun(playerId: string, id: string) {
    return this.store.transaction(async client=>runView(await this.ownedRun(client,id,playerId)));
  }
  async closeRun(playerId: string, id: string) {
    const result=await this.store.pool.query('DELETE FROM ai_runs WHERE id=$1 AND player_id=$2 RETURNING id',[id,playerId]);
    if(!result.rows[0]) fail(404,'not_found','挑战不存在');
    return {api_version:AI_VERSION,ok:true};
  }
  async mutate(playerId: string, id: string, request: {request_id:string;expected_revision:number;action?:{type:string;edge_id?:number}}, submit=false) {
    return this.store.transaction(async client=>{
      const row=await this.ownedRun(client,id,playerId,true);
      const normalizedAction=request.action ? request.action.type==='reset' ? {type:'reset'} : {type:'toggle_edge',edge_id:request.action.edge_id} : null;
      const fingerprint=digest({submit,expected_revision:request.expected_revision,action:normalizedAction});
      const receipt=await client.query('SELECT * FROM ai_run_requests WHERE run_id=$1 AND request_id=$2',[id,request.request_id]);
      if(receipt.rows[0]) {
        if(receipt.rows[0].fingerprint!==fingerprint) fail(409,'request_id_reused','同一个 request_id 不能用于不同请求');
        return receipt.rows[0].response;
      }
      if(row.revision!==request.expected_revision) fail(409,'revision_conflict','状态已更新，请重新读取挑战状态');
      let response;
      if(submit) {
        const live=await client.query('SELECT puzzle FROM levels WHERE key=$1 AND deleted_at IS NULL FOR SHARE',[row.level_key]);
        if(!live.rows[0]) return fail(404,'not_found','关卡版本不存在');
        if(puzzleHash(live.rows[0].puzzle)!==row.level_hash) return fail(409,'level_changed','题面已变更，请重新开始挑战');
        const verified=await this.store.workers.run('replay',{puzzle:row.puzzle,moves:row.moves});
        const saved=await this.store.submit(client,playerId,row.level_key,verified.score,row.moves);
        const records=await client.query('SELECT r.id,r.player_id,r.score,r.achieved_at,p.username FROM records r JOIN players p ON p.id=r.player_id WHERE level_key=$1',[row.level_key]);
        const summary=await this.store.workers.run('ai-ranking',{records:records.rows.map(r=>({id:r.id,playerId:r.player_id,playerUsername:r.username,score:r.score,achievedAt:Number(r.achieved_at)})),playerId,score:verified.score});
        summary.board.mine.moves=saved.record.moves;
        response={api_version:AI_VERSION,submitted_score:verified.score,submitted_rank:summary.submittedRank,ranked_at:new Date().toISOString(),
          best:{score:saved.record.score,rank:summary.board.rank,improved:saved.improved},leaderboard:boardView(summary.board)};
        // Reuse the existing notification channel; every web client sees AI submissions.
        if(saved.improved) this.store.invalidate(row.level_key);
      } else {
        const action=request.action!;
        if(action.type==='reset') {row.moves=[];row.state={water:row.puzzle.w,mask:0};}
        else {
          row.state=await this.store.workers.run('ai-step',{puzzle:row.puzzle,state:row.state,edge:action.edge_id});
          row.moves.push(action.edge_id);
        }
      }
      const updated=await client.query(`UPDATE ai_runs SET state=$2,moves=$3,revision=revision+1,expires_at=${nowSql}+$4 WHERE id=$1 RETURNING *`,[id,JSON.stringify(row.state),JSON.stringify(row.moves),retention]);
      response=submit ? {...response,run:runView(updated.rows[0])} : runView(updated.rows[0]);
      await client.query('INSERT INTO ai_run_requests(run_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[id,request.request_id,fingerprint,JSON.stringify(response)]);
      return response;
    });
  }
  async leaderboard(playerId: string, key: string, offset=0, limit=25) {
    return boardView(await this.store.leaderboard(key,playerId,offset,limit));
  }
}
