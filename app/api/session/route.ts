import {NextResponse} from 'next/server';
import {SESSION_COOKIE,allowedOrigin,checkPassword,cookieOptions,createSession,loginFailure,loginRateLimited,loginSuccess,passwordLoginEnabled} from '../../../lib/warehouse-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(!passwordLoginEnabled())return NextResponse.json({error:'登录功能尚未启用'},{status:503});
 if(!allowedOrigin(req))return NextResponse.json({error:'请求来源不正确，请刷新登录页'},{status:403});
 const ip=(req.headers.get('x-forwarded-for')?.split(',')[0]??'local').trim().slice(0,100);
 if(loginRateLimited(ip))return NextResponse.json({error:'尝试次数过多，请15分钟后重试'},{status:429,headers:{'Retry-After':'900'}});
 try{const raw=await req.text();if(raw.length>1000)return NextResponse.json({error:'请求过大'},{status:413});const body=JSON.parse(raw);if(typeof body.password!=='string'||body.password.length>200||!(await checkPassword(body.password))){loginFailure(ip);return NextResponse.json({error:'密码不正确，请重试'},{status:401});}
  loginSuccess(ip);const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});response.cookies.set(SESSION_COOKIE,createSession(),cookieOptions());return response;
 }catch{return NextResponse.json({error:'登录失败，请稍后重试'},{status:400});}
}
export async function DELETE(req:Request){if(!allowedOrigin(req))return NextResponse.json({error:'请求来源不正确'},{status:403});const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});response.cookies.set(SESSION_COOKIE,'',{...cookieOptions(),maxAge:0});return response;}
