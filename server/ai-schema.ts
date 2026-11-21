const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const text={type:'string'},integer={type:'integer',minimum:0};
const requestId={type:'string',minLength:1,maxLength:80,pattern:'^[A-Za-z0-9._:-]+$'};
export const mutationSchema=object({request_id:requestId,expected_revision:integer});
export const createRunSchema=object({request_id:requestId,level_key:{type:'string',minLength:1,maxLength:100}});
export const actionSchema=object({...mutationSchema.properties,action:{oneOf:[
  object({type:{const:'toggle_edge'},edge_id:{type:'integer',minimum:0,maximum:15}}),object({type:{const:'reset'}}),
]}});
export const pagingSchema=object({offset:{type:'string',pattern:'^[0-9]{1,8}$'},limit:{type:'string',pattern:'^([1-9]|[1-4][0-9]|50)$'}},[]);
const ref=(name:string)=>({$ref:'#/components/schemas/'+name});
const array=(items:unknown)=>({type:'array',items});
const nullable=(schema:object)=>({anyOf:[schema,{type:'null'}]});
const schemas={
  Error:object({api_version:{const:'1'},error:object({code:text,message:text})}),
  State:object({nodes:array(object({id:integer,water:text})),edges:array(object({id:integer,from:integer,to:integer,open:{type:'boolean'}})),scoring_node_id:integer,score:text,step_count:integer}),
  Run:object({api_version:{const:'1'},run_id:{type:'string',format:'uuid'},level_key:text,level_hash:text,rules_version:text,revision:integer,status:{const:'active'},expires_at:{type:'string',format:'date-time'},state:ref('State')}),
  Leaderboard:object({api_version:{const:'1'},rank:nullable(integer),total:integer,unlocked:{type:'boolean'},offset:integer,limit:integer,
    mine:nullable(object({player_id:text,score:text,rank:integer,moves:array(integer)})),records:array(object({rank:integer,player_id:text,score:nullable(text),hidden:{type:'boolean'},is_mine:{type:'boolean'}}))}),
  Submission:object({api_version:{const:'1'},submitted_score:text,submitted_rank:integer,ranked_at:{type:'string',format:'date-time'},best:object({score:text,rank:integer,improved:{type:'boolean'}}),leaderboard:ref('Leaderboard'),run:ref('Run')}),
  Level:object({api_version:{const:'1'},level_key:text,level_hash:text,rules_version:text,source:{enum:['official','workshop']},name:text,author_id:nullable(text),author_message:nullable(text),initial_state:ref('State')}),
  Levels:object({api_version:{const:'1'},total:integer,offset:integer,limit:integer,levels:array(object({level_key:text,source:{enum:['official','workshop']},name:text,author_id:nullable(text),level_hash:text}))}),
  Mutation:mutationSchema,Action:actionSchema,CreateRun:createRunSchema,
};
const json=(schema:unknown)=>({'application/json':{schema}});
const pageParameters=Object.entries(pagingSchema.properties).map(([name,schema])=>({name,in:'query',required:false,schema}));
const pathParameter=(name:string)=>({name,in:'path',required:true,schema:text});
const response=(name:string)=>({description:'Success',content:json(ref(name))});
const operation=(operationId:string,summary:string,responseSchema:unknown,body?:unknown,parameters:unknown[]=[],created=false)=>({
  operationId,summary,...(parameters.length?{parameters}:{}),...(body?{requestBody:{required:true,content:json(body)}}:{}),
  responses:{[created?'201':'200']:typeof responseSchema==='string'?response(responseSchema):{description:'Success',content:json(responseSchema)},
    ...Object.fromEntries([400,401,404,409,410,429,503].map(code=>[code,{description:'Request failed',content:json(ref('Error'))}]))},
});
export const aiOpenApi={
  openapi:'3.1.0',info:{title:'Waterline AI API',version:'1.0.0',description:'Free play with exact rational water, a shared human/AI leaderboard, and server-side score masking. Create API keys in the signed-in player account menu. Bearer keys only grant access to this API.'},
  servers:[{url:'/api/ai/v1'}],security:[{apiKey:[]}],
  components:{securitySchemes:{apiKey:{type:'http',scheme:'bearer',bearerFormat:'wl_...'}},schemas},
  paths:{
    '/openapi.json':{get:{...operation('getOpenApi','Read the API contract',{type:'object'}),security:[]}},
    '/rules':{get:operation('getRules','Read deterministic game rules',{type:'object'})},
    '/me':{get:operation('getMe','Read your public player ID',object({api_version:{const:'1'},player_id:text}))},
    '/levels':{get:operation('listLevels','List current official and published workshop levels','Levels',undefined,[...pageParameters,{name:'source',in:'query',schema:{enum:['official','workshop']}},{name:'author_id',in:'query',schema:text}])},
    '/levels/{key}':{get:operation('getLevel','Read a fixed version of a level','Level',undefined,[pathParameter('key')])},
    '/levels/{key}/leaderboard':{get:operation('getLeaderboard','Read the masked live leaderboard; visibility uses your submitted best','Leaderboard',undefined,[pathParameter('key'),...pageParameters])},
    '/runs':{post:operation('createRun','Start a challenge; request_id deduplicates creation','Run',ref('CreateRun'),[],true)},
    '/runs/{id}':{
      get:operation('getRun','Read your challenge state','Run',undefined,[pathParameter('id')]),
      delete:operation('closeRun','Discard a challenge without changing submitted records',object({api_version:{const:'1'},ok:{const:true}}),undefined,[pathParameter('id')]),
    },
    '/runs/{id}/actions':{post:operation('act','Toggle a valve or reset; retries with the same request_id return the original response','Run',ref('Action'),[pathParameter('id')])},
    '/runs/{id}/submit':{post:operation('submit','Submit the current state; preserve the best and keep playing','Submission',ref('Mutation'),[pathParameter('id')])},
  },
};
