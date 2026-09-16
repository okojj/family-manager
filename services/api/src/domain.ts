import { Prisma, PrismaClient, type User } from '@prisma/client';
export class AppError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const fail = (status: number, code: string, message: string): never => { throw new AppError(status, code, message); };
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const familyOf = (u: User) => u.familyId || fail(403, 'NO_FAMILY', '가족 초대를 수락해 주세요.');
export const parentOnly = (u: User) => { familyOf(u); if (u.role !== 'PARENT') fail(403, 'FORBIDDEN', '부모만 처리할 수 있습니다.'); };
export const defaults = [
 { title: '스스로 일어나기', description: '오전 7:30에 스스로 일어나기', weekdays: '1,2,3,4,5', dueTime: '07:30', reward: 5, penalty: 5 },
 { title: '등교 시간 지키기', description: '오전 8:30까지 집에서 나가기', weekdays: '1,2,3,4,5', dueTime: '08:30', reward: 5, penalty: 5 },
 { title: '잠들 준비 마치기', description: '밤 10:50까지 잘 준비하고 눕기', weekdays: '1,2,3,4,5,6,0', dueTime: '22:50', reward: 5, penalty: 5 },
 { title: '오늘 할 일 마무리', description: '학교·학원 숙제는 하루 전날까지 마치기', weekdays: '1,2,3,4,5,6,0', dueTime: '23:59', reward: 10, penalty: 10 },
];
export async function transaction<T>(db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
 for (let n=0;;n++) { try { return await db.$transaction(fn, { maxWait: 5000, timeout: 10000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); } catch(e) { if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034'].includes(e.code) && n<2) continue; throw e; } }
}
export async function lockWallet(tx: Prisma.TransactionClient, userId: string, familyId: string) {
 await tx.$queryRaw`SELECT userId FROM Wallet WHERE userId = ${userId} AND familyId = ${familyId} FOR UPDATE`;
 const wallet = await tx.wallet.findUnique({ where: { userId } });
 if (!wallet || wallet.familyId !== familyId) fail(404, 'NOT_FOUND', '지갑을 찾을 수 없습니다.');
 return wallet!;
}
export async function ensureMissions(db: PrismaClient, familyId: string, date = today()) {
 const [templates, kids] = await Promise.all([db.missionTemplate.findMany({where:{ familyId, active:true }}), db.user.findMany({where:{familyId,role:'CHILD',active:true}})]);
 const day = String(new Date(`${date}T12:00:00+09:00`).getUTCDay());
 const data = templates.filter(t=>t.weekdays.split(',').includes(day)).flatMap(t=>kids.map(k=>({familyId,userId:k.id,templateId:t.id,date,title:t.title,description:t.description,dueTime:t.dueTime,reward:t.reward,penalty:t.penalty})));
 if(data.length) await db.mission.createMany({data,skipDuplicates:true});
}
export async function review(db: PrismaClient, actor: User, id: string, input: { version: number; decision: 'SUCCEEDED'|'FAILED'|'EXEMPT'; note: string }) {
 parentOnly(actor); const familyId = familyOf(actor);
 return transaction(db, async tx=>{
  const m=await tx.mission.findFirst({where:{id,familyId}}); if(!m) return fail(404,'NOT_FOUND','미션을 찾을 수 없습니다.');
  await lockWallet(tx,m.userId,familyId);
  if(['SUCCEEDED','FAILED','EXEMPT'].includes(m.status)) { if(m.status===input.decision) return m; return fail(409,'FINALIZED','이미 확정된 결과입니다. 정정 기능은 다음 단계에서 지원합니다.'); }
  if(m.version!==input.version) return fail(409,'CONFLICT','다른 가족이 변경했습니다. 새로 확인해 주세요.');
  if(input.decision==='SUCCEEDED' && m.status!=='SUBMITTED') return fail(409,'NOT_SUBMITTED','완료 제출된 미션만 승인할 수 있습니다.');
  if(input.decision==='EXEMPT' && !input.note.trim()) return fail(422,'REASON_REQUIRED','예외 사유를 입력해 주세요.');
  if(input.decision==='FAILED' && !input.note.trim()) return fail(422,'REASON_REQUIRED','미수행 확인 사유를 입력해 주세요.');
  const changed=await tx.mission.updateMany({where:{id,familyId,version:input.version},data:{status:input.decision,note:input.note,version:{increment:1}}});
  if(!changed.count) return fail(409,'CONFLICT','이미 처리되었습니다.');
  const points=input.decision==='SUCCEEDED'?m.reward:input.decision==='FAILED'?-m.penalty:0;
  if(points) { await tx.pointEntry.create({data:{familyId,userId:m.userId,points,kind:points>0?'EARN':'PENALTY',title:m.title,sourceKey:`mission:${m.id}`,actorId:actor.id}}); await tx.wallet.update({where:{userId:m.userId},data:{balance:{increment:points}}}); }
  await tx.notification.create({data:{userId:m.userId,title:`${m.title} · ${input.decision==='EXEMPT'?'예외 승인':`${points>0?'+':''}${points}P`}`,link:'/wallet'}});
  await tx.auditLog.create({data:{familyId,actorId:actor.id,action:input.decision,entityId:m.id,note:input.note}});
  return tx.mission.findUnique({where:{id}});
 });
}
export async function requestRedemption(db: PrismaClient, actor: User, points: number, key: string) {
 if(actor.role!=='CHILD') return fail(403,'FORBIDDEN','아이 계정에서 신청해 주세요.'); const familyId=familyOf(actor); const requestKey=`${actor.id}:${key}`;
 return transaction(db, async tx=>{
  const w=await lockWallet(tx,actor.id,familyId);
  const existing=await tx.redemption.findUnique({where:{requestKey}});
  if(existing) { if(existing.points!==points) return fail(409,'KEY_REUSED','같은 요청 키로 금액을 변경할 수 없습니다.'); return existing; }
  if(w.balance-w.held<points) return fail(422,'INSUFFICIENT_POINTS','인출 가능한 포인트가 부족합니다.');
  await tx.wallet.update({where:{userId:actor.id},data:{held:{increment:points}}});
  const result=await tx.redemption.create({data:{familyId,userId:actor.id,points,requestKey}});
  const parents=await tx.user.findMany({where:{familyId,role:'PARENT',active:true}});
  await tx.notification.createMany({data:parents.map(p=>({userId:p.id,title:`${actor.name} · ${points}P 인출 신청`,link:'/admin/payments'}))});
  return result;
 });
}
export async function redemptionAction(db:PrismaClient, actor:User,id:string, action:'cancel'|'approve'|'reject'|'start-payment'|'mark-paid') {
 const familyId=familyOf(actor); if(action!=='cancel') parentOnly(actor);
 return transaction(db,async tx=>{
  const initial=await tx.redemption.findFirst({where:{id,familyId}}); if(!initial) return fail(404,'NOT_FOUND','신청을 찾을 수 없습니다.');
  const w=await lockWallet(tx,initial.userId,familyId);
  const r=(await tx.redemption.findUnique({where:{id}}))!;
  const target={cancel:'CANCELLED',approve:'APPROVED',reject:'REJECTED','start-payment':'PAYING','mark-paid':'PAID'}[action];
  if(action==='cancel' && r.userId!==actor.id) return fail(403,'FORBIDDEN','본인 신청만 취소할 수 있습니다.');
  if(r.status===target) { if(action==='start-payment'&&r.payingParentId!==actor.id) return fail(409,'OWNED','다른 부모가 지급 중입니다.'); return r; }
  const allowed={cancel:['REQUESTED','APPROVED'],approve:['REQUESTED'],reject:['REQUESTED','APPROVED'],'start-payment':['APPROVED'],'mark-paid':['PAYING']}[action];
  if(!allowed.includes(r.status)) return fail(409,'INVALID_STATE','현재 상태에서는 처리할 수 없습니다.');
  if(action==='start-payment' && (w.balance<w.held || await tx.redemption.count({where:{userId:r.userId,status:'PAYING'}}))) return fail(409,'PAYMENT_BLOCKED','잔액 부족 또는 다른 지급이 진행 중입니다.');
  if(action==='mark-paid' && r.payingParentId!==actor.id) return fail(403,'PAYMENT_OWNER','지급을 시작한 부모만 완료할 수 있습니다.');
  if(['cancel','reject'].includes(action)) await tx.wallet.update({where:{userId:r.userId},data:{held:{decrement:r.points}}});
  if(action==='mark-paid') { await tx.pointEntry.create({data:{familyId,userId:r.userId,points:-r.points,kind:'PAYOUT',title:'용돈 지급',sourceKey:`payout:${r.id}`,actorId:actor.id}}); await tx.wallet.update({where:{userId:r.userId},data:{held:{decrement:r.points},balance:{decrement:r.points}}}); }
  const result=await tx.redemption.update({where:{id},data:{status:target,...(action==='start-payment'?{payingParentId:actor.id}:{}),...(action==='mark-paid'?{paidAt:new Date()}: {})}});
  const labels:Record<string,string>={CANCELLED:'취소',APPROVED:'승인',REJECTED:'거절',PAYING:'지급 진행',PAID:'지급 완료'};
  await tx.notification.create({data:{userId:r.userId,title:`용돈 신청 · ${labels[target]}`,link:'/wallet'}});
  await tx.auditLog.create({data:{familyId,actorId:actor.id,action:`REDEMPTION_${target}`,entityId:r.id,note:''}});
  return result;
 });
}
