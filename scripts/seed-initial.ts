import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { defaults } from '../services/api/src/domain.js';
if(process.env.DEMO_MODE==='true')throw new Error('Disable demo mode before initializing real family data.');
if(!process.env.BOOTSTRAP_PARENT_EMAIL)throw new Error('Set BOOTSTRAP_PARENT_EMAIL first.');
let familyId=process.env.INITIAL_FAMILY_ID;
if(!familyId){familyId=randomUUID();const path='.env';let env=readFileSync(path,'utf8');env=env.replace(/^INITIAL_FAMILY_ID=.*\n?/m,'');writeFileSync(path,env.trimEnd()+`\nINITIAL_FAMILY_ID="${familyId}"\n`,{mode:0o600});}
const db=new PrismaClient();
try{await db.$transaction(async tx=>{
 await tx.family.upsert({where:{id:familyId!},create:{id:familyId!,name:'우리집'},update:{}});
 for(const d of defaults){const h=createHash('sha256').update(`${familyId}:${d.title}`).digest('hex');const id=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
 await tx.missionTemplate.upsert({where:{id},create:{id,familyId:familyId!,...d},update:{}});
 }
});console.log('Initial family and four default missions ready. No sample users or balances created.');}finally{await db.$disconnect();}
