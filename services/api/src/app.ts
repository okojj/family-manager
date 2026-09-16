import { registerCalendarRoutes } from './google-calendar.js';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient, type User } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes, createHash } from 'node:crypto';
import { z, ZodError } from 'zod';
import { AppError, fail, familyOf, parentOnly, defaults, today, ensureMissions, review, requestRedemption, redemptionAction, transaction } from './domain.js';
const token=()=>randomBytes(32).toString('hex');
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const uuid=z.string().uuid();
const idOf=(r:FastifyRequest)=>uuid.parse((r.params as {id:string}).id);
const keyOf=(r:FastifyRequest)=>uuid.parse(r.headers['idempotency-key']);
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(`${v}T00:00:00Z`);return !isNaN(+d)&&d.toISOString().startsWith(v)},'유효한 날짜를 입력해 주세요.');
const publicUser=(u:User)=>({id:u.id,name:u.name,role:u.role,familyId:u.familyId,email:u.email});
export interface Config { origin:string; googleClientId:string; bootstrapEmail:string; production:boolean; demo:boolean; databaseUrl:string; googleClientSecret?:string; calendarEncryptionKey?:string; initialFamilyId?:string; }
export async function buildApp(db:PrismaClient, cfg:Config) {
 if(cfg.demo && (cfg.production || !new URL(cfg.databaseUrl).pathname.startsWith('/demo_'))) throw new Error('Demo requires non-production and a demo_ database.');
 const app=Fastify({logger:{serializers:{req:(r:any)=>({method:r.method,url:r.url?.split('?')[0]})},redact:['req.headers.cookie','req.headers.authorization','res.headers.set-cookie']},bodyLimit:16384});
 await app.register(cookie); await app.register(rateLimit,{max:120,timeWindow:'1 minute'});
 const google=new OAuth2Client(cfg.googleClientId);
 const cookieOpts={path:'/',httpOnly:true,secure:cfg.production,sameSite:'lax' as const};
 app.setErrorHandler((e,_req,res)=>{
  if(e instanceof ZodError) return res.code(422).send({error:{code:'INVALID_INPUT',message:'입력한 값을 확인해 주세요.'}});
  if(e instanceof AppError) return res.code(e.status).send({error:{code:e.code,message:e.message}});
  const statusCode = (e as {statusCode?:number})?.statusCode;
  if(statusCode && statusCode<500) return res.code(statusCode).send({error:{code:'REQUEST_FAILED',message:statusCode===429?'잠시 후 다시 시도해 주세요.':'요청을 처리할 수 없습니다.'}});
  app.log.error({err:e},'request failed'); return res.code(500).send({error:{code:'SERVER_ERROR',message:'처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'}});
 });
 app.addHook('onRequest',async(req,res)=>{
  res.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin!==cfg.origin) fail(403,'ORIGIN','허용되지 않은 요청입니다.');
 });
 const authenticate=async(req:FastifyRequest)=>{
  const raw=req.cookies.family_session; if(!raw) return fail(401,'UNAUTHENTICATED','로그인이 필요합니다.');
  const session=await db.session.findUnique({where:{tokenHash:hash(raw)}});
  if(!session||session.expiresAt<new Date()) return fail(401,'EXPIRED','다시 로그인해 주세요.');
  if(req.method!=='GET' && req.headers['x-csrf-token']!==session.csrf) return fail(403,'CSRF','화면을 새로고침하고 다시 시도해 주세요.');
  const user=await db.user.findUnique({where:{id:session.userId}}); if(!user||!user.active) return fail(401,'INACTIVE','사용할 수 없는 계정입니다.');
  return {user,session};
 };
 await registerCalendarRoutes(app,db,cfg,authenticate);
 const signIn=async(user:User,req:FastifyRequest,res:FastifyReply)=>{
  if(req.cookies.family_session) await db.session.deleteMany({where:{tokenHash:hash(req.cookies.family_session)}});
  const raw=token(),csrf=token(); await db.session.create({data:{tokenHash:hash(raw),userId:user.id,csrf,expiresAt:new Date(Date.now()+7*86400000)}});
  res.setCookie('family_session',raw,{...cookieOpts,maxAge:7*86400}); return {user:publicUser(user),csrf};
 };
 app.get('/api/health',async()=>({status:'ok'}));
 app.get('/api/auth/config',async(req,res)=>{
  const raw=token(),nonce=token();
  await db.loginChallenge.deleteMany({where:{OR:[{expiresAt:{lt:new Date()}},...(req.cookies.login_challenge?[{tokenHash:hash(req.cookies.login_challenge)}]:[])]}});
  await db.loginChallenge.create({data:{tokenHash:hash(raw),nonce,expiresAt:new Date(Date.now()+10*60000)}});
  res.setCookie('login_challenge',raw,{...cookieOpts,maxAge:600});
  return {clientId:cfg.googleClientId,nonce,demo:cfg.demo};
 });
 app.post('/api/auth/google',{config:{rateLimit:{max:15,timeWindow:'1 minute'}}},async(req,res)=>{
  if(!cfg.googleClientId) return fail(503,'NOT_CONFIGURED','Google 로그인 연결 설정이 필요합니다.');
  const {credential}=z.object({credential:z.string().min(10).max(8192)}).parse(req.body);
  const raw=req.cookies.login_challenge; if(!raw) return fail(403,'LOGIN_EXPIRED','로그인 화면을 새로 열어 주세요.');
  const challenge=await db.loginChallenge.findUnique({where:{tokenHash:hash(raw)}});
  if(!challenge || challenge.expiresAt<new Date()) return fail(403,'LOGIN_EXPIRED','로그인 요청이 만료되었습니다.');
  let payload;
  try { payload=(await google.verifyIdToken({idToken:credential,audience:cfg.googleClientId})).getPayload(); } catch { return fail(401,'GOOGLE_TOKEN','Google 계정을 확인하지 못했습니다.'); }
  if(!payload || (payload as typeof payload & {nonce?:string}).nonce!==challenge.nonce || !payload.email_verified || !payload.email) return fail(401,'GOOGLE_TOKEN','Google 계정 확인에 실패했습니다.');
  // Membership is keyed by Google's stable subject, never a client-supplied role.
  const email=payload.email.toLowerCase();
  const user=await transaction(db,async tx=>{
   const used=await tx.loginChallenge.deleteMany({where:{tokenHash:hash(raw),expiresAt:{gt:new Date()}}}); if(!used.count) return fail(409,'REPLAY','이미 사용된 로그인 요청입니다.');
   return tx.user.upsert({where:{googleSub:payload!.sub},create:{googleSub:payload!.sub,email,name:(payload!.name||email.split('@')[0]).slice(0,80)},update:{email}});
  });
  if(!user.active) return fail(403,'INACTIVE','비활성화된 계정입니다.');
  res.clearCookie('login_challenge',{path:'/'}); return signIn(user,req,res);
 });
 if(cfg.demo) {
  app.get('/api/demo/users',async()=> (await db.user.findMany({where:{googleSub:{startsWith:'demo:'}},orderBy:{createdAt:'asc'}})).map(publicUser));
  app.post('/api/demo/login',async(req,res)=>{ const {userId}=z.object({userId:uuid}).parse(req.body); const u=await db.user.findFirst({where:{id:userId,googleSub:{startsWith:'demo:'}}}); if(!u)return fail(404,'NOT_FOUND','시험 계정이 없습니다.'); return signIn(u,req,res); });
 }
 app.get('/api/me',async req=>{const {user,session}=await authenticate(req); return {user:publicUser(user),csrf:session.csrf,canBootstrap:!!cfg.bootstrapEmail&&user.email===cfg.bootstrapEmail.toLowerCase()&&!user.familyId};});
 app.post('/api/logout',async(req,res)=>{await authenticate(req);await db.session.deleteMany({where:{tokenHash:hash(req.cookies.family_session!)}});res.clearCookie('family_session',{path:'/'});return {ok:true};});
 app.post('/api/families',async req=>{
  const {user}=await authenticate(req); const {name}=z.object({name:z.string().trim().min(1).max(80)}).parse(req.body);
  if(user.familyId||!cfg.bootstrapEmail||user.email!==cfg.bootstrapEmail.toLowerCase())return fail(403,'BOOTSTRAP_ONLY','설정된 첫 부모 계정만 가족을 만들 수 있습니다.');
  return transaction(db,async tx=>{ const reserved=cfg.initialFamilyId?await tx.family.findUnique({where:{id:cfg.initialFamilyId}}):null; const f=reserved||await tx.family.create({data:{name}}); const updated=await tx.user.updateMany({where:{id:user.id,familyId:null},data:{familyId:f.id,role:'PARENT'}});if(!updated.count)return fail(409,'ALREADY_JOINED','이미 가족에 가입했습니다.');if(!reserved)await tx.missionTemplate.createMany({data:defaults.map(d=>({...d,familyId:f.id}))});return f;});
 });
 app.post('/api/invitations',async req=>{
  const {user}=await authenticate(req);parentOnly(user);
  const data=z.object({email:z.string().email().max(255),name:z.string().trim().min(1).max(80),role:z.enum(['CHILD','PARENT'])}).parse(req.body);
  const raw=token();await db.invitation.create({data:{...data,email:data.email.toLowerCase(),familyId:familyOf(user),tokenHash:hash(raw),expiresAt:new Date(Date.now()+86400000)}});return {token:raw,expiresInHours:24};
 });
 app.post('/api/invitations/accept',async req=>{
  const {user}=await authenticate(req);const {token:raw}=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(req.body);
  if(user.familyId)return fail(409,'ALREADY_JOINED','이미 가족에 가입했습니다.');
  return transaction(db,async tx=>{
   const inv=await tx.invitation.findUnique({where:{tokenHash:hash(raw)}});
   if(!inv||inv.consumedAt||inv.expiresAt<new Date()||inv.email!==user.email)return fail(403,'INVALID_INVITE','만료되었거나 이 Google 계정의 초대가 아닙니다.');
   const used=await tx.invitation.updateMany({where:{id:inv.id,consumedAt:null},data:{consumedAt:new Date()}});if(!used.count)return fail(409,'USED_INVITE','이미 사용된 초대입니다.');
   const changed=await tx.user.updateMany({where:{id:user.id,familyId:null},data:{familyId:inv.familyId,role:inv.role,name:inv.name}});if(!changed.count)return fail(409,'ALREADY_JOINED','이미 가입한 계정입니다.');
   if(inv.role==='CHILD')await tx.wallet.create({data:{userId:user.id,familyId:inv.familyId}});return {ok:true};
  });
 });
 app.get('/api/dashboard',async req=>{
  const {user}=await authenticate(req),familyId=familyOf(user);await ensureMissions(db,familyId);
  const scope=user.role==='PARENT'?{familyId}:{familyId,userId:user.id};
  const [family,members,missions,wallets,entries,redemptions,events,notifications,templates]=await Promise.all([
   db.family.findUnique({where:{id:familyId}}),db.user.findMany({where:{familyId,active:true},select:{id:true,name:true,role:true}}),
   db.mission.findMany({where:{...scope,OR:[{date:today()},{status:{in:['OPEN','SUBMITTED','EXCEPTION_PENDING']},date:{lte:today()}}]},orderBy:[{date:'asc'},{dueTime:'asc'}]}),
   db.wallet.findMany({where:scope}),db.pointEntry.findMany({where:scope,orderBy:{createdAt:'desc'},take:100}),db.redemption.findMany({where:scope,orderBy:{createdAt:'desc'},take:100}),
   db.event.findMany({where:{familyId},orderBy:[{date:'asc'},{time:'asc'}],take:500}),db.notification.findMany({where:{userId:user.id},orderBy:{createdAt:'desc'},take:50}),
   user.role==='PARENT'?db.missionTemplate.findMany({where:{familyId}}):Promise.resolve([])
  ]);
  const imported=await db.googleCalendarEvent.findMany({where:{familyId},orderBy:[{date:'asc'},{time:'asc'}]});
  const merged=[...events.map(e=>({...e,source:'APP'})),...imported.map(e=>({...e,source:'GOOGLE',kind:'EVENT',ownerId:''}))];
  return {family,members,missions,wallets,entries,redemptions,events:merged,notifications,templates,today:today(),demo:cfg.demo};
 });
 app.post('/api/missions/:id/submit',async req=>{
  const {user}=await authenticate(req),id=idOf(req);const {version,note}=z.object({version:z.number().int().nonnegative(),note:z.string().trim().max(500).default('')}).parse(req.body);
  const familyId=familyOf(user);
  return transaction(db,async tx=>{
   const m=await tx.mission.findFirst({where:{id,familyId,userId:user.id}});if(!m)return fail(404,'NOT_FOUND','본인 미션만 제출할 수 있습니다.');if(m.status==='SUBMITTED')return {ok:true};
   if(!['OPEN'].includes(m.status))return fail(409,'INVALID_STATE','현재 상태에서는 제출할 수 없습니다.');
   const result=await tx.mission.updateMany({where:{id,userId:user.id,version,status:'OPEN'},data:{status:'SUBMITTED',note,submittedAt:new Date(),version:{increment:1}}});if(!result.count)return fail(409,'CONFLICT','미션이 변경되었습니다.');
   const parents=await tx.user.findMany({where:{familyId,role:'PARENT',active:true}});await tx.notification.createMany({data:parents.map(p=>({userId:p.id,title:`${user.name} · ${m.title} 완료 확인`,link:'/admin/reviews'}))});return {ok:true};
  });
 });
 app.post('/api/missions/:id/exception',async req=>{
  const {user}=await authenticate(req);const {note,version}=z.object({note:z.string().trim().min(1).max(500),version:z.number().int().nonnegative()}).parse(req.body);
  return transaction(db,async tx=>{
   const familyId=familyOf(user),id=idOf(req);
   const count=await tx.mission.updateMany({where:{id,familyId,userId:user.id,status:'OPEN',version},data:{status:'EXCEPTION_PENDING',note,version:{increment:1}}});if(!count.count)return fail(409,'CONFLICT','신청할 수 없는 미션입니다.');
   const parents=await tx.user.findMany({where:{familyId,role:'PARENT',active:true}});
   await tx.notification.createMany({data:parents.map(p=>({userId:p.id,title:`${user.name} · 미션 예외 신청`,link:'/admin/reviews'}))});return {ok:true};
  });
 });
 app.post('/api/missions/:id/review',async req=>{const {user}=await authenticate(req);return review(db,user,idOf(req),z.object({version:z.number().int().nonnegative(),decision:z.enum(['SUCCEEDED','FAILED','EXEMPT']),note:z.string().trim().max(500).default('')}).parse(req.body));});
 app.post('/api/redemptions',async req=>{const {user}=await authenticate(req);const {points}=z.object({points:z.number().int().min(1).max(1000000)}).parse(req.body);return requestRedemption(db,user,points,keyOf(req));});
 app.post('/api/redemptions/:id/:action',async req=>{const {user}=await authenticate(req);const action=z.enum(['cancel','approve','reject','start-payment','mark-paid']).parse((req.params as {action:string}).action);return redemptionAction(db,user,idOf(req),action);});
 const templateInput=z.object({title:z.string().trim().min(1).max(120),description:z.string().trim().max(500),weekdays:z.string().regex(/^[0-6](,[0-6])*$/),dueTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),reward:z.number().int().min(0).max(10000),penalty:z.number().int().min(0).max(10000)});
 app.post('/api/templates',async req=>{const {user}=await authenticate(req);parentOnly(user);return db.missionTemplate.create({data:{...templateInput.parse(req.body),familyId:familyOf(user)}});});
 app.patch('/api/templates/:id',async req=>{const {user}=await authenticate(req);parentOnly(user);const {active}=z.object({active:z.boolean()}).parse(req.body);const result=await db.missionTemplate.updateMany({where:{id:idOf(req),familyId:familyOf(user)},data:{active}});if(!result.count)return fail(404,'NOT_FOUND','미션이 없습니다.');return {ok:true};});
 app.post('/api/events',async req=>{
  const {user}=await authenticate(req);const familyId=familyOf(user);
  const data=z.object({title:z.string().trim().min(1).max(120),date:dateSchema,time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),kind:z.enum(['EVENT','ANNIVERSARY']),note:z.string().trim().max(500).default('')}).parse(req.body);
  if(data.kind==='ANNIVERSARY')parentOnly(user);const requestKey=`${user.id}:${keyOf(req)}`;
  const existing=await db.event.findUnique({where:{requestKey}});if(existing){if(Object.entries(data).some(([k,v])=>(existing as unknown as Record<string,unknown>)[k]!==v))return fail(409,'KEY_REUSED','같은 요청으로 다른 일정을 만들 수 없습니다.');return existing;}
  return db.event.create({data:{...data,familyId,ownerId:user.id,requestKey}});
 });
 app.delete('/api/events/:id',async req=>{const {user}=await authenticate(req);const result=await db.event.deleteMany({where:{id:idOf(req),familyId:familyOf(user),...(user.role==='PARENT'?{}:{ownerId:user.id})}});if(!result.count)return fail(404,'NOT_FOUND','일정을 찾을 수 없습니다.');return {ok:true};});
 app.post('/api/notifications/:id/read',async req=>{const {user}=await authenticate(req);await db.notification.updateMany({where:{id:idOf(req),userId:user.id},data:{readAt:new Date()}});return {ok:true};});
 return app;
}
