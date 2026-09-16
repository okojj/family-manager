import 'dotenv/config';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { startCalendarScheduler } from './google-calendar.js';
import { buildApp } from './app.js';
const db=new PrismaClient();
const production=process.env.NODE_ENV==='production';
const origin=process.env.APP_ORIGIN||'http://localhost:5173';
if(production && !origin.startsWith('https://'))throw new Error('Production APP_ORIGIN must use HTTPS.');
const config={origin,googleClientId:process.env.GOOGLE_CLIENT_ID||'',bootstrapEmail:process.env.BOOTSTRAP_PARENT_EMAIL||'',production,demo:process.env.DEMO_MODE==='true',databaseUrl:process.env.DATABASE_URL||'',googleClientSecret:process.env.GOOGLE_CLIENT_SECRET||'',calendarEncryptionKey:process.env.CALENDAR_TOKEN_KEY||'',initialFamilyId:process.env.INITIAL_FAMILY_ID||''};
const app=await buildApp(db,config);
// Production serves Vue and API from the same origin and process.
if(production){
 await app.register(fastifyStatic,{root:fileURLToPath(new URL('../web/',import.meta.url)),wildcard:false});
 app.setNotFoundHandler((req,res)=>{
  const path=req.url.split('?')[0];
  if((req.method==='GET'||req.method==='HEAD') && !path.startsWith('/api/') && path!=='/api' && !path.startsWith('/assets/') && !path.split('/').pop()?.includes('.'))return res.type('text/html').sendFile('index.html');
  return res.code(404).send({error:{code:'NOT_FOUND',message:'찾을 수 없습니다.'}});
 });
}
await db.$connect();
await app.listen({host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||3001)});
const stopCalendarScheduler=startCalendarScheduler(db,config);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{stopCalendarScheduler();await app.close();await db.$disconnect();process.exit(0);});
