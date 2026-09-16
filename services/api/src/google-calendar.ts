import { createCipheriv, createDecipheriv, randomBytes, createHash, randomUUID } from 'node:crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Session, User } from '@prisma/client';
import { z } from 'zod';
import { fail, parentOnly, familyOf } from './domain.js';
export const CALENDAR_SCOPES=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'];
export interface CalendarConfig {origin:string;googleClientId:string;googleClientSecret?:string;calendarEncryptionKey?:string;}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
function encryptionKey(value:string){if(!/^[a-f0-9]{64}$/i.test(value))throw new Error('CALENDAR_TOKEN_KEY must be 64 hexadecimal characters.');return Buffer.from(value,'hex');}
export function seal(value:string,key:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',encryptionKey(key),iv);return [iv,Buffer.concat([c.update(value,'utf8'),c.final()]),c.getAuthTag()].map(x=>x.toString('base64url')).join('.');}
export function unseal(value:string,key:string){const [iv,data,tag]=value.split('.').map(v=>Buffer.from(v,'base64url'));if(!iv||!data||!tag)throw new Error('Invalid encrypted token');const c=createDecipheriv('aes-256-gcm',encryptionKey(key),iv);c.setAuthTag(tag);return Buffer.concat([c.update(data),c.final()]).toString('utf8');}
export interface GoogleEvent {id?:string;status?:string;summary?:string;description?:string;location?:string;htmlLink?:string;start?:{date?:string;dateTime?:string};end?:{date?:string;dateTime?:string};}
export interface CalendarChoice {id:string;summary:string;accessRole?:string;}
export interface CalendarRemote {
 listCalendars(refresh:string):Promise<CalendarChoice[]>;
 listEvents(refresh:string,calendarId:string,min:string,max:string):Promise<GoogleEvent[]>;
}
export function syncWindow(now=new Date()){return {min:new Date(+now-90*86400000).toISOString(),max:new Date(+now+365*86400000).toISOString()};}
function seoulDate(value:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
export function mapGoogleEvent(e:GoogleEvent,familyId:string,calendarId:string){
 if(e.status==='cancelled')return null;
 if(!e.id||!e.start||!e.end)throw new Error('Google event is missing dates or ID.');
 const allDay=!!e.start.date;
 let date:string,endDate:string,time:string;
 if(allDay){if(!e.start.date||!e.end.date||!/^\d{4}-\d{2}-\d{2}$/.test(e.start.date)||!/^\d{4}-\d{2}-\d{2}$/.test(e.end.date))throw new Error('Invalid all-day event');date=e.start.date;endDate=new Date(new Date(e.end.date+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);time='';}
 else {const start=new Date(e.start.dateTime||''),end=new Date(e.end.dateTime||'');if(isNaN(+start)||isNaN(+end)||+end<+start)throw new Error('Invalid timed event');date=seoulDate(start);endDate=seoulDate(new Date(Math.max(+start,+end-1)));time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(start);}
 if(endDate<date)throw new Error('Invalid event range');
 let htmlLink:string|null=null;try{const u=new URL(e.htmlLink||'');if(u.protocol==='https:'&&['calendar.google.com','www.google.com'].includes(u.hostname))htmlLink=u.href.slice(0,2048);}catch{}
 return {id:digest(`${familyId}\n${calendarId}\n${e.id}`),familyId,googleEventId:e.id,title:(e.summary||'제목 없는 일정').slice(0,255),date,endDate,time,allDay,note:[e.location,e.description].filter(Boolean).join('\n').slice(0,10000),htmlLink};
}
export function googleRemote(cfg:CalendarConfig):CalendarRemote {
 const client=(refresh:string)=>{const c=new OAuth2Client(cfg.googleClientId,cfg.googleClientSecret,`${cfg.origin}/api/google-calendar/callback`);c.setCredentials({refresh_token:refresh});return c;};
 async function pages<T>(refresh:string,path:string,params:Record<string,string>,maxItems:number){const c=client(refresh),all:T[]=[];let pageToken:string|undefined;const seen=new Set<string>();
  do{const result=await c.request<{items?:T[];nextPageToken?:string}>({url:`https://www.googleapis.com/calendar/v3/${path}`,method:'GET',params:{...params,...(pageToken?{pageToken}:{})},timeout:20000,retry:false});all.push(...(result.data.items||[]));if(all.length>maxItems)throw new Error('Calendar too large');pageToken=result.data.nextPageToken;if(pageToken){if(seen.has(pageToken))throw new Error('Repeated page token');seen.add(pageToken);}if(seen.size>100)throw new Error('Too many pages');}while(pageToken);return all;
 }
 return {listCalendars:refresh=>pages<CalendarChoice>(refresh,'users/me/calendarList',{minAccessRole:'reader',maxResults:'250',fields:'items(id,summary,accessRole),nextPageToken'},5000),listEvents:(refresh,id,min,max)=>pages<GoogleEvent>(refresh,`calendars/${encodeURIComponent(id)}/events`,{singleEvents:'true',showDeleted:'false',timeMin:min,timeMax:max,timeZone:'Asia/Seoul',maxResults:'2500',fields:'items(id,status,summary,description,location,htmlLink,start,end),nextPageToken'},20000)};
}
export async function syncCalendar(db:PrismaClient,familyId:string,key:string,remote:CalendarRemote){
 const lease=randomUUID(),now=new Date();
 const taken=await db.googleCalendarConnection.updateMany({where:{familyId,calendarId:{not:null},OR:[{syncLeaseUntil:null},{syncLeaseUntil:{lt:now}}]},data:{syncLease:lease,syncLeaseUntil:new Date(+now+5*60000)}});
 if(!taken.count)return fail(409,'SYNC_BUSY','연결된 캘린더가 없거나 이미 가져오는 중입니다.');
 const connection=await db.googleCalendarConnection.findUniqueOrThrow({where:{familyId}});
 try{
  const owner=await db.user.findFirst({where:{id:connection.ownerId,familyId,role:'PARENT',active:true}});if(!owner)throw new Error('Owner unavailable');
  const window=syncWindow();const result=await remote.listEvents(unseal(connection.refreshTokenEncrypted,key),connection.calendarId!,window.min,window.max);
  const mapped=new Map(result.map(e=>mapGoogleEvent(e,familyId,connection.calendarId!)).filter(e=>e!==null).map(e=>[e!.id,e!]));
  await db.$transaction(async tx=>{
   const changed=await tx.googleCalendarConnection.updateMany({where:{familyId,revision:connection.revision,syncLease:lease},data:{lastSyncedAt:new Date(),lastError:null,syncLease:null,syncLeaseUntil:null}});
   if(!changed.count)return fail(409,'CONNECTION_CHANGED','캘린더 연결이 바뀌었습니다. 다시 가져와 주세요.');
   // Replace only after every remote page and every event validates. Native Event rows are untouched.
   await tx.googleCalendarEvent.deleteMany({where:{familyId}});
   const rows=[...mapped.values()];for(let i=0;i<rows.length;i+=250)await tx.googleCalendarEvent.createMany({data:rows.slice(i,i+250)});
  },{timeout:30000});
  return {count:mapped.size};
 }catch(e){await db.googleCalendarConnection.updateMany({where:{familyId,syncLease:lease},data:{syncLease:null,syncLeaseUntil:null,lastError:'가져오지 못했습니다. 다시 시도하거나 Google 연결을 갱신해 주세요.'}});return fail(502,'SYNC_FAILED','가져오지 못했습니다. 이전 일정을 유지합니다. Google 연결을 확인해 주세요.');}
}
export async function registerCalendarRoutes(app:FastifyInstance,db:PrismaClient,cfg:CalendarConfig,authenticate:(r:FastifyRequest)=>Promise<{user:User;session:Session}>,remote=googleRemote(cfg)){
 const configured=!!cfg.googleClientId&&!!cfg.googleClientSecret&&!!cfg.calendarEncryptionKey&&/^[a-f0-9]{64}$/i.test(cfg.calendarEncryptionKey);
 const ready=()=>{if(!configured)fail(503,'CALENDAR_NOT_CONFIGURED','Google 캘린더 연결 설정이 필요합니다.');};
 const authorize=async(req:FastifyRequest)=>{const a=await authenticate(req);parentOnly(a.user);return a;};
 const oauth=()=>new OAuth2Client(cfg.googleClientId,cfg.googleClientSecret,`${cfg.origin}/api/google-calendar/callback`);
 app.get('/api/google-calendar/status',async req=>{const {user}=await authorize(req);const c=await db.googleCalendarConnection.findUnique({where:{familyId:familyOf(user)},select:{calendarId:true,calendarName:true,lastSyncedAt:true,lastError:true}});return {configured,connected:!!c,...c};});
 app.post('/api/google-calendar/authorize',async req=>{
  const {user,session}=await authorize(req);ready();const state=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url');
  await db.calendarOAuthState.deleteMany({where:{OR:[{expiresAt:{lt:new Date()}},{userId:user.id}]}});
  await db.calendarOAuthState.create({data:{tokenHash:digest(state),userId:user.id,familyId:familyOf(user),sessionHash:session.tokenHash,verifier,expiresAt:new Date(Date.now()+600000)}});
  return {url:oauth().generateAuthUrl({access_type:'offline',prompt:'consent',scope:CALENDAR_SCOPES,state,login_hint:user.email,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:CodeChallengeMethod.S256})};
 });
 app.get('/api/google-calendar/callback',async(req,res)=>{
  try{
   const {user,session}=await authorize(req);ready();const q=z.object({state:z.string().regex(/^[a-f0-9]{64}$/),code:z.string().max(4096).optional(),error:z.string().max(200).optional()}).parse(req.query);
   const state=await db.calendarOAuthState.findUnique({where:{tokenHash:digest(q.state)}});
   if(!state||state.userId!==user.id||state.familyId!==familyOf(user)||state.sessionHash!==session.tokenHash||state.expiresAt<new Date())throw new Error('Invalid state');
   const consumed=await db.calendarOAuthState.deleteMany({where:{tokenHash:state.tokenHash,sessionHash:session.tokenHash}});if(!consumed.count||q.error||!q.code)throw new Error('Consent denied');
   const {tokens}=await oauth().getToken({code:q.code,codeVerifier:state.verifier});
   if(!tokens.refresh_token||!CALENDAR_SCOPES.every(s=>tokens.scope?.split(' ').includes(s)))throw new Error('Missing scope or refresh token');
   await db.$transaction(async tx=>{
    await tx.googleCalendarConnection.upsert({where:{familyId:state.familyId},create:{familyId:state.familyId,ownerId:user.id,refreshTokenEncrypted:seal(tokens.refresh_token!,cfg.calendarEncryptionKey!)},update:{ownerId:user.id,refreshTokenEncrypted:seal(tokens.refresh_token!,cfg.calendarEncryptionKey!),calendarId:null,calendarName:null,lastSyncedAt:null,lastError:null,syncLease:null,syncLeaseUntil:null,revision:{increment:1}}});
    await tx.googleCalendarEvent.deleteMany({where:{familyId:state.familyId}});
   });
   return res.redirect(`${cfg.origin}/calendar?google=connected`);
  }catch{return res.redirect(`${cfg.origin}/calendar?google=error`);}
 });
 app.get('/api/google-calendar/calendars',async req=>{const {user}=await authorize(req);ready();const c=await db.googleCalendarConnection.findUnique({where:{familyId:familyOf(user)}});if(!c)return fail(409,'NOT_CONNECTED','Google 계정을 먼저 연결해 주세요.');try{return await remote.listCalendars(unseal(c.refreshTokenEncrypted,cfg.calendarEncryptionKey!));}catch{return fail(502,'CALENDAR_LIST_FAILED','캘린더 목록을 불러오지 못했습니다. 다시 연결해 주세요.');}});
 app.post('/api/google-calendar/select',async req=>{
  const {user}=await authorize(req);ready();const {calendarId}=z.object({calendarId:z.string().min(1).max(1024)}).parse(req.body);const familyId=familyOf(user);
  const c=await db.googleCalendarConnection.findUnique({where:{familyId}});if(!c)return fail(409,'NOT_CONNECTED','Google 계정을 먼저 연결해 주세요.');
  let choices:CalendarChoice[];try{choices=await remote.listCalendars(unseal(c.refreshTokenEncrypted,cfg.calendarEncryptionKey!));}catch{return fail(502,'CALENDAR_LIST_FAILED','Google 연결을 확인해 주세요.');}
  const choice=choices.find(x=>x.id===calendarId);if(!choice)return fail(403,'CALENDAR_FORBIDDEN','선택할 수 없는 캘린더입니다.');
  await db.$transaction(async tx=>{const changed=await tx.googleCalendarConnection.updateMany({where:{familyId,revision:c.revision},data:{calendarId,calendarName:choice.summary.slice(0,255),revision:{increment:1},lastSyncedAt:null,lastError:null,syncLease:null,syncLeaseUntil:null}});if(!changed.count) return fail(409,'CONNECTION_CHANGED','연결이 바뀌었습니다. 다시 확인해 주세요.');await tx.googleCalendarEvent.deleteMany({where:{familyId}});});
  return syncCalendar(db,familyId,cfg.calendarEncryptionKey!,remote);
 });
 app.post('/api/google-calendar/sync',{config:{rateLimit:{max:6,timeWindow:'1 minute'}}},async req=>{const {user}=await authorize(req);ready();return syncCalendar(db,familyOf(user),cfg.calendarEncryptionKey!,remote);});
 app.delete('/api/google-calendar/connection',async req=>{const {user}=await authorize(req);const familyId=familyOf(user);await db.$transaction(async tx=>{await tx.googleCalendarConnection.deleteMany({where:{familyId}});await tx.googleCalendarEvent.deleteMany({where:{familyId}});await tx.calendarOAuthState.deleteMany({where:{familyId}});});return {ok:true};});
}
export function startCalendarScheduler(db:PrismaClient,cfg:CalendarConfig){if(!cfg.googleClientId||!cfg.googleClientSecret||!cfg.calendarEncryptionKey)return ()=>{};let running=false;
 const tick=async()=>{if(running)return;running=true;try{const connections=await db.googleCalendarConnection.findMany({where:{calendarId:{not:null},OR:[{lastSyncedAt:null},{lastSyncedAt:{lt:new Date(Date.now()-15*60000)}}]},select:{familyId:true}});for(const c of connections){try{await syncCalendar(db,c.familyId,cfg.calendarEncryptionKey!,googleRemote(cfg));}catch{/* sanitized error is recorded on the connection */}}}catch{/* retry on the next tick */}finally{running=false;}};
 const timer=setInterval(tick,15*60000);timer.unref();void tick();return ()=>clearInterval(timer);
}
