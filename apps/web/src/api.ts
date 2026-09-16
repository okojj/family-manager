import { reactive } from 'vue';
export interface User { id:string; name:string; role:string; familyId:string|null; email:string; }
export interface Mission { id:string; userId:string; date:string; title:string; description:string; dueTime:string; reward:number; penalty:number; status:string; note:string; version:number; }
export interface Wallet { userId:string; balance:number; held:number; }
export interface Entry {id:string;userId:string;points:number;title:string;kind:string;createdAt:string;}
export interface Redemption {id:string;userId:string;points:number;rate:number;status:string;payingParentId:string|null;createdAt:string;}
export interface CalendarEvent {id:string;ownerId:string;title:string;date:string;time:string;kind:string;note:string;source?:'APP'|'GOOGLE';endDate?:string;allDay?:boolean;htmlLink?:string|null;}
export interface Notice {id:string;title:string;link:string;readAt:string|null;createdAt:string;}
export interface Template {id:string;title:string;description:string;weekdays:string;dueTime:string;reward:number;penalty:number;active:boolean;}
export interface Dashboard {family:{name:string};members:{id:string;name:string;role:string}[];missions:Mission[];wallets:Wallet[];entries:Entry[];redemptions:Redemption[];events:CalendarEvent[];notifications:Notice[];templates:Template[];today:string;demo:boolean;}
export const state=reactive({user:null as User|null,csrf:'',data:null as Dashboard|null,loading:true,error:'',toast:'',demo:false,canBootstrap:false});
export async function api<T=unknown>(path:string,method='GET',body?:unknown,key?:string):Promise<T>{
 const res=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&state.csrf?{'X-CSRF-Token':state.csrf}:{}),...(key?{'Idempotency-Key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const result=await res.json();if(!res.ok){if(res.status===401){state.user=null;state.data=null;}throw new Error(result.error?.message||'요청을 처리하지 못했습니다.');}return result;
}
export async function load(){if(!state.user?.familyId)return;state.data=await api<Dashboard>('/dashboard');state.demo=state.data.demo;}
export async function me(){const result=await api<{user:User;csrf:string;canBootstrap:boolean}>('/me');state.user=result.user;state.csrf=result.csrf;state.canBootstrap=result.canBootstrap;await load();}
export async function action(fn:()=>Promise<unknown>,message='저장했습니다.'){state.error='';try{await fn();await load();state.toast=message;setTimeout(()=>state.toast='',3500);}catch(e){state.error=e instanceof Error?e.message:'처리하지 못했습니다.';}}
