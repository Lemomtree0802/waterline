import type { FastifyInstance } from 'fastify';
import { ApiError } from './types.js';
import { AiStore, AI_VERSION, RULES_VERSION } from './ai-store.js';
import type { Store } from './store.js';
import { aiOpenApi, actionSchema, createRunSchema, mutationSchema, pagingSchema } from './ai-schema.js';
import { renderAiDocs } from './ai-docs.js';

export const aiPrefix='/api/ai/v1';
const uuid={type:'string',format:'uuid'};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const keyParams=object({key:{type:'string',minLength:1,maxLength:100}});
const runParams=object({id:uuid});

export async function registerAiApi(app: FastifyInstance, store: Store) {
  const ai=new AiStore(store);
  app.get('/api/me/api-keys',async request=>{
    if(!request.player) throw new ApiError(401,'请先登录');
    if(request.headers['x-waterline-player']&&request.headers['x-waterline-player']!==request.player.id) throw new ApiError(409,'账号已在其他窗口切换，请刷新后重试','account_changed');
    return ai.listKeys(request.player.id);
  });
  app.post<{Body:{name:string}}>('/api/me/api-keys',{schema:{body:object({name:{type:'string',minLength:1,maxLength:50,pattern:'\\S'}})},config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async(request,reply)=>{
    if(!request.player) throw new ApiError(401,'请先登录');
    reply.code(201);return ai.createKey(request.player.id,request.body.name);
  });
  app.delete<{Params:{id:string}}>('/api/me/api-keys/:id',{schema:{params:runParams}},async request=>{
    if(!request.player) throw new ApiError(401,'请先登录');
    return ai.revokeKey(request.player.id,request.params.id);
  });
  await app.register(async api=>{
    api.setNotFoundHandler((_request,reply)=>reply.code(404).send({api_version:AI_VERSION,error:{code:'not_found',message:'API endpoint not found'}}));
    api.addHook('onRequest',async request=>{
      if([aiPrefix+'/openapi.json',aiPrefix+'/docs'].includes(request.url.split('?')[0])) return;
      const header=request.headers.authorization;
      if(!header||!/^Bearer wl_[A-Za-z0-9_-]{43}$/.test(header)) throw new ApiError(401,'请使用 Authorization: Bearer API_KEY','invalid_api_key');
      request.player=await ai.authenticate(header.slice(7));
    });
    api.get('/openapi.json',async()=>aiOpenApi);
    api.get('/docs',async(request,reply)=>reply.type('text/html; charset=utf-8').header('Cache-Control','no-cache').send(renderAiDocs(`${request.protocol}://${request.host}`)));
    api.get('/rules',async()=>({api_version:AI_VERSION,rules_version:RULES_VERSION,mode:'free_play',objective:'maximize_scoring_node_water',
      rules:['All valves start closed.','Opening a valve redistributes water equally across every node in its open connected component.','Closing a valve preserves node water quantities.','Your score is the water at scoring_node_id.','Only explicit submissions update the shared human and AI leaderboard.'],
      water_format:'Exact nonnegative rational strings, for example "2" or "65/32".',actions:['toggle_edge','reset'],ranking:'dense',
      visibility:'Scores above your submitted personal best are hidden. Equal and lower scores are visible.',run_retention_days:7}));
    api.get('/me',async request=>({api_version:AI_VERSION,player_id:request.player!.username}));
    api.get<{Querystring:{source?:string;author_id?:string;offset?:string;limit?:string}}>('/levels',{
      schema:{querystring:object({...pagingSchema.properties,source:{type:'string',enum:['official','workshop']},author_id:{type:'string',minLength:1,maxLength:24}},[])},
    },async request=>ai.levels(request.query.source,request.query.author_id,Number(request.query.offset || 0),Number(request.query.limit || 25)));
    api.get<{Params:{key:string}}>('/levels/:key',{schema:{params:keyParams}},async request=>ai.level(request.params.key));
    api.get<{Params:{key:string};Querystring:{offset?:string;limit?:string}}>('/levels/:key/leaderboard',{schema:{params:keyParams,querystring:pagingSchema}},async request=>ai.leaderboard(request.player!.id,request.params.key,Number(request.query.offset||0),Number(request.query.limit||25)));
    api.post<{Body:{level_key:string;request_id:string}}>('/runs',{schema:{body:createRunSchema},config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async(request,reply)=>{
      reply.code(201);return ai.createRun(request.player!.id,request.body.level_key,request.body.request_id);
    });
    api.get<{Params:{id:string}}>('/runs/:id',{schema:{params:runParams}},async request=>ai.getRun(request.player!.id,request.params.id));
    api.delete<{Params:{id:string}}>('/runs/:id',{schema:{params:runParams}},async request=>ai.closeRun(request.player!.id,request.params.id));
    api.post<{Params:{id:string};Body:{request_id:string;expected_revision:number;action:{type:string;edge_id?:number}}}>('/runs/:id/actions',{
      schema:{params:runParams,body:actionSchema},config:{rateLimit:{max:600,timeWindow:'1 minute'}},
    },async request=>ai.mutate(request.player!.id,request.params.id,request.body));
    api.post<{Params:{id:string};Body:{request_id:string;expected_revision:number}}>('/runs/:id/submit',{
      schema:{params:runParams,body:mutationSchema},config:{rateLimit:{max:120,timeWindow:'1 minute'}},
    },async request=>ai.mutate(request.player!.id,request.params.id,request.body,true));
  },{prefix:aiPrefix});
}
