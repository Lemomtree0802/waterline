import pg, { type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { officialLevels } from '../src/levels.js';
import { ApiError, type Player, type Puzzle, type RecordRow } from './types.js';
import type { VerificationPool } from './workers.js';
import { leaderboardForViewer } from '../src/ranking.js';
export const nowSql = '(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)';
const player = (row: any): Player => ({ id: row.id, username: row.username, name: row.name });
const record = (row: any): RecordRow => ({ id: row.id, playerId: row.player_id, playerName: row.name, playerUsername:row.username, score: row.score, achievedAt: Number(row.achieved_at), ...(row.moves ? { moves: row.moves } : {}) });
const visiblePuzzle = (raw: any): Puzzle => {
  const fields=['id','version','source','name','description','w','e','t','pos','number','authorId','authorName','authorUsername','authorSequence','publishedAt','featured'];
  const puzzle = Object.fromEntries(fields.filter(key=>raw[key]!==undefined).map(key=>[key,raw[key]]));
  return puzzle as Puzzle;
};

export class Store extends EventEmitter {
  readonly pool: pg.Pool;
  private listener?: PoolClient;
  private reconnect?: NodeJS.Timeout;
  private closed = false;
  private generation = new Map<string, number>();
  private rankings = new Map<string, { generation: number; value: Promise<RecordRow[]> }>();
  constructor(url: string, readonly workers: VerificationPool, options: pg.PoolConfig = {}) {
    super(); this.pool = new pg.Pool({ connectionString: url, max: 12, connectionTimeoutMillis: 5000, ...options });
    this.pool.on('error', () => this.emit('warning', '数据库连接中断'));
  }
  async initialize() {
    await this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('waterline-schema-v1', 0))");
      await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      for (const level of officialLevels) await client.query(
        `INSERT INTO levels(key,source,puzzle,published_at) VALUES($1,'official',$2,0) ON CONFLICT(key) DO UPDATE SET puzzle=EXCLUDED.puzzle WHERE levels.source='official'`,
        [`${level.id}@${level.version || 1}`, JSON.stringify(level)]);
    });
    await this.listen();
  }
  private async listen() {
    if (this.closed) return;
    try {
      const client = await this.pool.connect(); this.listener = client;
      client.on('notification', notification => {
        try {
          const event = JSON.parse(notification.payload || '{}');
          if (event.kind === 'score' && typeof event.key === 'string') this.invalidate(event.key);
          if (event.kind === 'score' || event.kind === 'catalog') this.emit('change', event);
        } catch { /* Ignore notifications outside the application's protocol. */ }
      });
      client.on('error', () => {
        if (this.listener !== client) return;
        this.listener = undefined; client.release(true); this.rankings.clear();
        if (!this.closed) this.reconnect = setTimeout(() => void this.listen(), 3000);
      });
      await client.query('LISTEN waterline_updates');
      this.emit('change', {kind:'resync'});
    } catch {
      this.listener?.release(true); this.listener = undefined;
      if (!this.closed) this.reconnect = setTimeout(() => void this.listen(), 3000);
    }
  }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  invalidate(key: string) { this.generation.set(key, (this.generation.get(key) || 0) + 1); this.rankings.delete(key); }
  async notify(client: PoolClient, event: { kind: string; key?: string }) {
    await client.query('SELECT pg_notify($1,$2)', ['waterline_updates', JSON.stringify(event)]);
  }
  async getPlayer(id: string) {
    const result = await this.pool.query('SELECT id,username,name,preferences FROM players WHERE id=$1', [id]);
    return result.rows[0] ? { ...player(result.rows[0]), preferences: result.rows[0].preferences } : null;
  }
  async catalog() {
    const result = await this.pool.query(`SELECT l.*,p.username,COALESCE(c.count,0)::int AS count FROM levels l LEFT JOIN players p ON p.id=l.author_id LEFT JOIN (SELECT level_key,count(*) FROM records GROUP BY level_key)c ON c.level_key=l.key WHERE l.deleted_at IS NULL ORDER BY l.published_at DESC,l.key`);
    return result.rows.map(row => ({ ...visiblePuzzle(row.puzzle), ...(row.source === 'community' ? {
      name:row.username+'-'+row.author_sequence, authorId:row.author_id, authorName:row.username,
      authorUsername:row.username, authorSequence:row.author_sequence, featured:row.featured_at !== null,
      publishedAt:Number(row.published_at), submissionCount:row.count,
    } : {}) })) as Puzzle[];
  }
  async level(key: string): Promise<Puzzle> {
    const result = await this.pool.query('SELECT puzzle FROM levels WHERE key=$1 AND deleted_at IS NULL', [key]);
    if (!result.rows[0]) throw new ApiError(404, '关卡版本不存在');
    return visiblePuzzle(result.rows[0].puzzle);
  }
  async deleteLevel(key: string, authorId: string) {
    await this.transaction(async client => {
      const result = await client.query('SELECT source,author_id FROM levels WHERE key=$1 AND deleted_at IS NULL FOR UPDATE', [key]);
      const level = result.rows[0];
      if (!level) throw new ApiError(404, '关卡不存在');
      if (level.source !== 'community' || level.author_id !== authorId) throw new ApiError(403, '只能删除自己发布的关卡');
      await client.query(`UPDATE levels SET deleted_at=${nowSql} WHERE key=$1`, [key]);
      await this.notify(client, { kind: 'catalog', key });
    });
    this.invalidate(key);
  }
  async bootstrap(id?: string) {
    const [levels, account, draft, records] = await Promise.all([
      this.catalog(), id ? this.getPlayer(id) : null,
      id ? this.pool.query('SELECT puzzle,revision FROM drafts WHERE player_id=$1', [id]) : null,
      id ? this.pool.query('SELECT r.*,p.name,p.username FROM records r JOIN players p ON p.id=r.player_id JOIN levels l ON l.key=r.level_key WHERE r.player_id=$1 AND l.deleted_at IS NULL', [id]) : null,
    ]);
    const ranked = await Promise.all((records?.rows || []).map(async row => {
      const rank=(await this.rankingsFor(row.level_key)).find(record=>record.playerId===id)?.rank;
      return [row.level_key,{...record(row),rank}];
    }));
    return { player: account ? player(account) : null, preferences: account?.preferences || {}, levels,
      progress: {}, completions: {},
      draft: draft?.rows[0] || { puzzle: null, revision: 0 },
      records: Object.fromEntries(ranked) };
  }
  async publishLevel(account: Player, raw: any, verified: any, draftRevision: number) {
    return this.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['author:'+account.id]);
      const result=await client.query('SELECT COALESCE(max(author_sequence),0)+1 AS sequence FROM levels WHERE author_id=$1',[account.id]);
      const sequence=Number(result.rows[0].sequence);
      const level={...visiblePuzzle(verified.puzzle),id:'community-'+randomUUID(),version:1,source:'community',
        name:account.username+'-'+sequence,description:raw.description,pos:raw.pos,
        authorId:account.id,authorName:account.username,authorUsername:account.username,authorSequence:sequence};
      const key=level.id+'@1';
      await client.query(`INSERT INTO levels(key,author_id,author_sequence,source,puzzle,published_at) VALUES($1,$2,$3,'community',$4,${nowSql})`,[key,account.id,sequence,JSON.stringify(level)]);
      // Publishing is separate from submitting a personal score.
      await client.query(`UPDATE drafts SET puzzle=null,revision=revision+1,updated_at=${nowSql} WHERE player_id=$1 AND revision=$2 AND puzzle=$3::jsonb`,[account.id,draftRevision,JSON.stringify(raw)]);
      await this.notify(client,{kind:'catalog',key});
      return level;
    });
  }
  async saveDraft(id: string, puzzle: unknown, revision: number) {
    const result = revision === 0
      ? await this.pool.query(`INSERT INTO drafts(player_id,puzzle,revision,updated_at) VALUES($1,$2,1,${nowSql}) ON CONFLICT DO NOTHING RETURNING puzzle,revision`, [id, puzzle === null ? null : JSON.stringify(puzzle)])
      : await this.pool.query(`UPDATE drafts SET puzzle=$2,revision=revision+1,updated_at=${nowSql} WHERE player_id=$1 AND revision=$3 RETURNING puzzle,revision`, [id, puzzle === null ? null : JSON.stringify(puzzle), revision]);
    if (!result.rows[0]) throw new ApiError(409, '工坊草稿已在其他设备更新，请刷新后继续');
    return result.rows[0];
  }
  async submit(client: PoolClient, id: string, key: string, score: string, moves: number[]) {
    await this.requireActiveLevel(client, key);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`record:${id}:${key}`]);
    const existing = await client.query('SELECT * FROM records WHERE player_id=$1 AND level_key=$2', [id, key]);
    const old = existing.rows[0];
    const improved = !old || await this.workers.run<number>('compare', { a: score, b: old.score }) > 0;
    let row = old;
    if (improved) {
      const result = await client.query(`INSERT INTO records(id,player_id,level_key,score,moves,achieved_at) VALUES($1,$2,$3,$4,$5,${nowSql}) ON CONFLICT(player_id,level_key) DO UPDATE SET score=EXCLUDED.score,moves=EXCLUDED.moves,achieved_at=EXCLUDED.achieved_at RETURNING *`, [old?.id || randomUUID(), id, key, score, JSON.stringify(moves)]);
      row = result.rows[0]; await this.notify(client, { kind: 'score', key });
    }
    const account = await client.query('SELECT name,username FROM players WHERE id=$1',[id]);
    return { improved, record: record({...row,...account.rows[0]}) };
  }
  private async requireActiveLevel(client: PoolClient, key: string) {
    const result = await client.query('SELECT key FROM levels WHERE key=$1 AND deleted_at IS NULL FOR SHARE', [key]);
    if (!result.rows[0]) throw new ApiError(404, '关卡不存在');
  }
  async rankingsFor(key: string): Promise<RecordRow[]> {
    const generation = this.generation.get(key) || 0;
    if (!this.rankings.has(key)) {
      const value = (async () => {
        const result = await this.pool.query('SELECT r.id,r.player_id,r.score,r.achieved_at,p.name,p.username FROM records r JOIN players p ON p.id=r.player_id WHERE r.level_key=$1', [key]);
        return this.workers.run<RecordRow[]>('rank', result.rows.map(record));
      })();
      this.rankings.set(key, { generation, value });
      value.catch(() => { if (this.rankings.get(key)?.value === value) this.rankings.delete(key); });
    }
    const entry = this.rankings.get(key)!;
    const records = await entry.value;
    if (entry.generation !== (this.generation.get(key) || 0)) return this.rankingsFor(key);
    return records;
  }
  async leaderboard(key: string, id?: string, offset = 0, limit = 25): Promise<ReturnType<typeof leaderboardForViewer>> {
    await this.level(key);
    const records = await this.rankingsFor(key);
    const board=leaderboardForViewer(records,id,offset,limit);
    if (board.mine) {
      const own=await this.pool.query('SELECT r.*,p.name,p.username FROM records r JOIN players p ON p.id=r.player_id WHERE level_key=$1 AND player_id=$2',[key,id]);
      if(own.rows[0]?.score!==board.mine.score){this.invalidate(key);return this.leaderboard(key,id,offset,limit);}
      board.mine={...record(own.rows[0]),rank:board.rank!};
    }
    return board;
  }
  async searchPlayers(query: string) {
    const result=await this.pool.query(`SELECT username FROM players WHERE position($1 in username)>0 ORDER BY CASE WHEN username=$1 THEN 0 ELSE 1 END,username LIMIT 20`,[query.normalize('NFKC').toLowerCase()]);
    return result.rows.map(row=>({id:row.username,username:row.username}));
  }
  async playerProfile(username: string, viewerId?: string) {
    const account=await this.pool.query('SELECT id,username FROM players WHERE username=$1',[username.normalize('NFKC').toLowerCase()]);
    if (!account.rows[0]) throw new ApiError(404,'玩家不存在');
    const target=account.rows[0],catalog=await this.catalog();
    const owned=catalog.filter(level=>level.authorId===target.id);
    const submitted=await this.pool.query('SELECT level_key FROM records r JOIN levels l ON l.key=r.level_key WHERE player_id=$1 AND l.deleted_at IS NULL ORDER BY achieved_at DESC',[target.id]);
    const records=await Promise.all(submitted.rows.map(async ({level_key:key})=>{
      const ranks=await this.rankingsFor(key),row=ranks.find(record=>record.playerId===target.id)!;
      const viewer=ranks.find(record=>record.playerId===viewerId);
      const hidden=!viewer || row.rank! < viewer.rank!;
      return {key,name:catalog.find(level=>`${level.id}@${level.version}`===key)?.name || key,rank:row.rank,score:hidden?null:row.score,hidden};
    }));
    return {player:{id:target.username,username:target.username},levels:owned,records};
  }
  async close() {
    this.closed = true; clearTimeout(this.reconnect);
    if (this.listener) { await this.listener.query('UNLISTEN *').catch(() => {}); this.listener.release(); this.listener = undefined; }
    await this.pool.end();
  }
}
