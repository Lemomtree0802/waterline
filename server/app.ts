import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { hashPassword, verifyPassword, newToken, tokenHash } from './auth.js';
import { Store, nowSql } from './store.js';
import { VerificationPool } from './workers.js';
import { validateDraft } from './draft.js';
import { ApiError, type Player } from './types.js';
import { registerAiApi, aiPrefix } from './ai-api.js';
declare module 'fastify' { interface FastifyRequest { player: Player | null; sessionHash: string | null } }
const cookieName = 'waterline_session';
const movesSchema = { type:'array', items:{ type:'integer',minimum:0,maximum:15 } };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type:'object',properties,required,additionalProperties:false });
const credentials = object({ username:{type:'string',minLength:3,maxLength:24}, password:{type:'string',minLength:8,maxLength:128} });
const preferencesSchema = object({ decimal:{type:'boolean'}, tutorialSeen:{type:'boolean'}, numberFormatHintSeen:{type:'boolean'}, explorationHintSeen:{type:'boolean'}, lastLevelKey:{type:'string',maxLength:80} }, []);
type Options = { databaseUrl: string; publicOrigin?: string; secureCookies?: boolean; logger?: boolean; workers?: number; poolOptions?: Record<string, unknown>; staticRoot?: string; trustProxy?: string[] };
const requirePlayer = (request: FastifyRequest) => { if (!request.player) throw new ApiError(401,'请先登录'); return request.player; };
const username = (input: string) => {
  const value = input.trim().normalize('NFKC').toLowerCase();
  if (!/^[\p{L}\p{N}_]{3,24}$/u.test(value)) throw new ApiError(400,'用户名需要 3–24 个字母、汉字、数字或下划线');
  return value;
};

export async function createApp(options: Options) {
  const app = Fastify({ logger: options.logger ? { redact:['req.headers.cookie','req.headers.authorization'] } : false,
    trustProxy:options.trustProxy || false, bodyLimit:16*1024*1024, ajv:{customOptions:{removeAdditional:false,coerceTypes:false}} });
  const workers = new VerificationPool(options.workers);
  const store = new Store(options.databaseUrl, workers, options.poolOptions);
  const streams = new Set<{ key: string; send:(event:unknown)=>void; end:()=>void }>();
  try { await store.initialize(); } catch (error) { await workers.close(); await store.close(); throw error; }
  const secure = options.secureCookies ?? options.publicOrigin?.startsWith('https://') ?? false;
  const cookieOptions = { httpOnly:true, secure, sameSite:'lax' as const, path:'/', maxAge:30*24*60*60 };
  const dummyPassword = await hashPassword(randomUUID());
  await app.register(cookie);
  await app.register(rateLimit, {global:false});
  app.decorateRequest('player', null); app.decorateRequest('sessionHash', null);
  app.addHook('onRequest', async request => {
    if (!request.url.startsWith('/api/')) return;
    // Machine access has its own Bearer authentication. Cookies never authorize it.
    if (request.url.startsWith(aiPrefix+'/')) return;
    if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
      const origin = options.publicOrigin || `${request.protocol}://${request.host}`;
      if (request.headers['x-waterline-request'] !== '1' || (request.headers.origin && request.headers.origin !== origin)) throw new ApiError(403,'请求来源无效，请刷新页面后重试');
    }
    const token = request.cookies[cookieName];
    if (token && token.length <= 128) {
      request.sessionHash = tokenHash(token);
      const result = await store.pool.query(`SELECT p.id,p.username,p.name FROM sessions s JOIN players p ON p.id=s.player_id WHERE s.token_hash=$1 AND s.expires_at>${nowSql}`, [request.sessionHash]);
      request.player = result.rows[0] || null;
    }
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && request.headers['x-waterline-player']) {
      if (!request.player) throw new ApiError(401,'会话已过期，请重新登录');
      if (request.headers['x-waterline-player'] !== request.player.id) throw new ApiError(409,'账号已在其他窗口切换，请刷新后重试','account_changed');
    }
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('Referrer-Policy','same-origin');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control','no-store');
  });
  app.setErrorHandler((error: any, request, reply) => {
    const status = error.statusCode || 500;
    if (status >= 500) request.log.error(error);
    if(request.url.startsWith(aiPrefix+'/')) {
      const code=error instanceof ApiError&&typeof error.details==='string'?error.details:({400:'invalid_request',401:'invalid_api_key',404:'not_found',409:'conflict',410:'gone',429:'rate_limited',503:'unavailable'} as Record<number,string>)[status] || 'internal_error';
      return reply.code(status).send({api_version:'1',error:{code,message:status>=500?'Service temporarily unavailable':error.validation?'Invalid request format':error.message}});
    }
    reply.code(status).send({message:status >= 500 && !(error instanceof ApiError) ? '服务暂时不可用，请稍后重试' : error.validation ? '输入格式不正确，请检查填写内容' : error.message,...(error instanceof ApiError && error.details ? {code:error.details} : {})});
  });
  const createSession = async (id: string, request: FastifyRequest, reply: any) => {
    const token = newToken();
    await store.transaction(async client => {
      if (request.sessionHash) await client.query('DELETE FROM sessions WHERE token_hash=$1',[request.sessionHash]);
      await client.query(`DELETE FROM sessions WHERE expires_at<=${nowSql}`);
      await client.query(`INSERT INTO sessions(token_hash,player_id,expires_at) VALUES($1,$2,${nowSql}+2592000000)`,[tokenHash(token),id]);
    });
    reply.setCookie(cookieName,token,cookieOptions);
  };
  app.get('/api/health', async () => { await store.pool.query('SELECT 1'); return {ok:true,mode:'online'}; });
  app.get('/api/session',async request => ({player:request.player}));
  app.get('/api/bootstrap',async request => store.bootstrap(request.player?.id));
  app.get('/api/levels',async () => ({levels:await store.catalog()}));
  app.get<{Params:{key:string};Querystring:{offset?:string;limit?:string}}>('/api/levels/:key/leaderboard',{
    schema:{querystring:object({offset:{type:'string',pattern:'^[0-9]{1,8}$'},limit:{type:'string',pattern:'^([1-9]|[1-4][0-9]|50)$'}},[])},
  },async request=>store.leaderboard(request.params.key,request.player?.id,Number(request.query.offset || 0),Number(request.query.limit || 25)));
  app.get<{Querystring:{q:string}}>('/api/players',{schema:{querystring:object({q:{type:'string',minLength:1,maxLength:24}})}},async request=>({players:await store.searchPlayers(request.query.q)}));
  app.get<{Params:{username:string}}>('/api/players/:username',async request=>store.playerProfile(request.params.username,request.player?.id));
  app.delete<{Params:{key:string}}>('/api/levels/:key',{schema:{params:object({key:{type:'string',maxLength:100}})}},async request => {
    const account = requirePlayer(request);
    await store.deleteLevel(request.params.key, account.id);
    return { ok: true };
  });
  app.post<{Body:{username:string;password:string}}>('/api/auth/register',{schema:{body:credentials},config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async (request,reply) => {
    const name = username(request.body.username), id=randomUUID(), passwordHash=await hashPassword(request.body.password);
    try { await store.pool.query(`INSERT INTO players(id,username,name,password_hash,created_at) VALUES($1,$2,$3,$4,${nowSql})`,[id,name,name,passwordHash]); }
    catch (error:any) { if (error.code==='23505') throw new ApiError(409,'这个用户名已被注册'); throw error; }
    await createSession(id,request,reply); reply.code(201); return {player:await store.getPlayer(id)};
  });
  app.post<{Body:{username:string;password:string}}>('/api/auth/login',{schema:{body:credentials},config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async (request,reply) => {
    const name=username(request.body.username);
    const result=await store.pool.query('SELECT id,password_hash FROM players WHERE username=$1',[name]);
    const account=result.rows[0];
    const valid=await verifyPassword(request.body.password,account?.password_hash || dummyPassword);
    if (!account || !valid) throw new ApiError(401,'用户名或密码不正确');
    await createSession(account.id,request,reply); return {player:await store.getPlayer(account.id)};
  });
  app.post('/api/auth/logout',async (request,reply) => {
    if (request.sessionHash) await store.pool.query('DELETE FROM sessions WHERE token_hash=$1',[request.sessionHash]);
    reply.clearCookie(cookieName,{path:'/'}); return {ok:true};
  });
  app.patch<{Body:Record<string,boolean|string>}>('/api/me/preferences',{schema:{body:preferencesSchema}},async request => {
    const account=requirePlayer(request);
    await store.pool.query('UPDATE players SET preferences=preferences || $2::jsonb WHERE id=$1',[account.id,JSON.stringify(request.body)]); return {ok:true};
  });
  app.put('/api/me/progress/:key',async request=>{ requirePlayer(request); throw new ApiError(410,'请使用提交成绩保存最佳记录'); });
  app.put<{Body:{puzzle:unknown;revision:number}}>('/api/me/draft',{schema:{body:object({puzzle:{},revision:{type:'integer',minimum:0}})}},async request => {
    const account=requirePlayer(request); return store.saveDraft(account.id,validateDraft(request.body.puzzle),request.body.revision);
  });
  app.post<{Body:{key:string;moves:number[]}}>('/api/runs',{schema:{body:object({key:{type:'string',maxLength:100},moves:movesSchema})},config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async request => {
    const account=requirePlayer(request),level=await store.level(request.body.key);
    const verified=await workers.run('replay',{puzzle:level,moves:request.body.moves});
    const result=await store.transaction(client=>store.submit(client,account.id,request.body.key,verified.score,request.body.moves));
    if (result.improved) store.invalidate(request.body.key);
    const board=await store.leaderboard(request.body.key,account.id);
    return {...result,record:board.mine || result.record,improved:result.improved && board.mine?.score===verified.score,rank:board.rank,leaderboard:board};
  });
  app.post<{Body:{puzzle:any;moves:number[];draftRevision:number}}>('/api/levels',{schema:{body:object({puzzle:{type:'object'},moves:movesSchema,draftRevision:{type:'integer',minimum:0}})},config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async request => {
    const account=requirePlayer(request), raw=validateDraft(request.body.puzzle);
    const verified=await workers.run('publish',{puzzle:raw,moves:request.body.moves});
    return {level:await store.publishLevel(account,raw,verified,request.body.draftRevision)};
  });
  app.post('/api/me/import-local',async request=>{ requirePlayer(request); throw new ApiError(410,'旧尝试不再自动保存，请重新挑战并提交成绩'); });
  await registerAiApi(app,store);
  const change=(event:{kind:string;key?:string})=>{for(const stream of streams) if(['catalog','resync'].includes(event.kind)||stream.key===event.key) stream.send(event);};
  store.on('change',change);
  app.get<{Querystring:{key?:string}}>('/api/events',async (request,reply)=>{
    if (streams.size>=2000) throw new ApiError(503,'连接繁忙，请稍后重试');
    const key=request.query.key || '';
    if(key) await store.level(key);
    reply.hijack(); reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
    const stream={key,send:(event:unknown)=>{if(reply.raw.writableLength>65536) reply.raw.end(); else reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);},end:()=>reply.raw.end()};
    streams.add(stream); reply.raw.write(': connected\n\n');
    const heartbeat=setInterval(()=>{if(!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n');},15000);
    reply.raw.on('close',()=>{clearInterval(heartbeat);streams.delete(stream);});
  });
  const root=options.staticRoot || process.cwd();
  await app.register(staticFiles,{root:path.join(root,'assets'),prefix:'/assets/'});
  await app.register(staticFiles,{root:path.join(root,'src'),prefix:'/src/',decorateReply:false});
  app.get('/',async (_request,reply)=>reply.header('Cache-Control','no-cache').sendFile('index.html',root));
  app.get('/favicon.svg',async (_request,reply)=>reply.sendFile('favicon.svg',root));
  app.addHook('preClose',async()=>{for(const stream of streams) stream.end();});
  app.addHook('onClose',async()=>{store.off('change',change);await workers.close();await store.close();});
  return {app,store,workers};
}
