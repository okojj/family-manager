import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { defaults, ensureMissions, today } from '../services/api/src/domain.js';
const url=process.env.DATABASE_URL||'';
if(process.env.NODE_ENV==='production'||!new URL(url).pathname.startsWith('/demo_'))throw new Error('Demo seeding requires a dedicated demo_ database.');
const db=new PrismaClient();
try {
 const found=await db.user.findUnique({where:{googleSub:'demo:parent1'}});
 if(found){console.log('Demo already initialized; preserving existing records.');process.exitCode=0;}
 else {
 const f=await db.family.create({data:{name:'우리 가족 · 시험용'}});
 const users=[];
 for(const [sub,name,role] of [['parent1','아빠','PARENT'],['parent2','엄마','PARENT'],['child1','첫째','CHILD'],['child2','둘째','CHILD']]){
  const u=await db.user.create({data:{googleSub:`demo:${sub}`,email:`${sub}@example.test`,name,role,familyId:f.id}});users.push(u);
  if(role==='CHILD'){await db.wallet.create({data:{userId:u.id,familyId:f.id,balance:120}});await db.pointEntry.create({data:{familyId:f.id,userId:u.id,points:120,kind:'OPENING_BALANCE',title:'시험용 시작 포인트 (실제 잔액 아님)',sourceKey:`demo-opening:${u.id}`,actorId:users[0].id}});}
 }
 await db.missionTemplate.createMany({data:defaults.map(d=>({...d,familyId:f.id}))});await ensureMissions(db,f.id);
 await db.event.create({data:{familyId:f.id,ownerId:users[0].id,title:'함께 저녁 먹기',date:today(),time:'19:00',kind:'EVENT',note:'오늘 있었던 일 한 가지씩 이야기해요.',requestKey:'demo-dinner'}});
 console.log('Created isolated sample family. No real balances imported.');
 }
}finally{await db.$disconnect();}
