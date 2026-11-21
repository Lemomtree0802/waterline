import { createApp } from './app.js';
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error('需要设置 DATABASE_URL，请参考 .env.example');
if(process.env.NODE_ENV==='production' && !process.env.PUBLIC_ORIGIN?.startsWith('https://')) throw new Error('生产环境需要 HTTPS PUBLIC_ORIGIN');
const {app}=await createApp({databaseUrl,publicOrigin:process.env.PUBLIC_ORIGIN,secureCookies:process.env.NODE_ENV==='production',logger:true,workers:process.env.VERIFICATION_WORKERS ? Number(process.env.VERIFICATION_WORKERS) : undefined,staticRoot:process.env.STATIC_ROOT || process.cwd(),trustProxy:process.env.TRUST_PROXY?.split(',').map(value=>value.trim()).filter(Boolean)});
const stop=async()=>{await app.close();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
await app.listen({port:Number(process.env.PORT || 4174),host:process.env.HOST || '127.0.0.1'});
