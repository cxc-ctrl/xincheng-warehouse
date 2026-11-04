import {createHmac,randomBytes,timingSafeEqual,scrypt} from 'node:crypto';
import {promisify} from 'node:util';
export const SESSION_COOKIE='warehouse_session';
export const SESSION_SECONDS=7*24*3600;
export const passwordLoginEnabled=()=>process.env.WAREHOUSE_PASSWORD_LOGIN==='1';
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function signature(payload:string){const secret=process.env.WAREHOUSE_SESSION_SECRET;if(!secret||secret.length<32)throw new Error('登录配置未完成');return createHmac('sha256',secret).update(payload).digest('base64url');}
export function createSession(now=Date.now()){
 const payload=Buffer.from(JSON.stringify({exp:Math.floor(now/1000)+SESSION_SECONDS,nonce:randomBytes(24).toString('hex')})).toString('base64url');return payload+'.'+signature(payload);
}
export function validSession(token:string|undefined,now=Date.now()){
 if(!token||token.length>1000)return false;try{const [payload,sig,...rest]=token.split('.');if(rest.length||!sig||!equal(sig,signature(payload)))return false;const value=JSON.parse(Buffer.from(payload,'base64url').toString());return Number.isSafeInteger(value.exp)&&value.exp>Math.floor(now/1000)&&value.exp<=Math.floor(now/1000)+SESSION_SECONDS&&typeof value.nonce==='string';}catch{return false;}
}
export async function checkPassword(password:string){
 const salt=process.env.WAREHOUSE_PASSWORD_SALT,hash=process.env.WAREHOUSE_PASSWORD_HASH;if(!salt||!hash)throw new Error('登录配置未完成');const derived=await promisify(scrypt)(password,salt,64) as Buffer;return equal(derived.toString('hex'),hash);
}
export function trustedSync(req:Request){const expected=process.env.WAREHOUSE_SYNC_TOKEN,provided=req.headers.get('x-warehouse-sync-token');return !!expected&&expected.length>=32&&!!provided&&provided.length<=200&&equal(expected,provided);}
export function sessionUser(){return {userId:'local_seedy',displayName:'仓库管理员',email:'warehouse@local.internal',fullName:'仓库管理员'};}
export function allowedOrigin(req:Request){const origin=req.headers.get('origin');return !!origin&&(origin===new URL(req.url).origin||origin===process.env.WAREHOUSE_PUBLIC_URL);}
export function cookieOptions(){return {httpOnly:true,sameSite:'lax' as const,secure:process.env.WAREHOUSE_PUBLIC_URL?.startsWith('https://')??false,path:'/',maxAge:SESSION_SECONDS};}
// One self-hosted process. Fixed-length windows avoid retaining arbitrary addresses.
const failures=new Map<string,{count:number;until:number}>();
export function loginRateLimited(ip:string,now=Date.now()){
 for(const [key,value] of failures)if(value.until<=now)failures.delete(key);
 return (failures.get(ip)?.count??0)>=10||(failures.get('*')?.count??0)>=100;
}
export function loginFailure(ip:string,now=Date.now()){for(const key of [ip,'*']){const old=failures.get(key);failures.set(key,{count:(old&&old.until>now?old.count:0)+1,until:old&&old.until>now?old.until:now+15*60000});}}
export function loginSuccess(ip:string){failures.delete(ip);}
