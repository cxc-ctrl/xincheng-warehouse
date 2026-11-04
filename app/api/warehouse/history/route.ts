import {env} from '../../../../server/runtime';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {readMovementHistory} from '../../../../lib/movement-history';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json({error:'请先登录'},401);
  if(!env.DB)throw new Error('库存数据库暂时不可用');
  return json(await readMovementHistory(env.DB,user.userId,new URL(request.url).searchParams));
 }catch(e){return json({error:e instanceof Error?e.message:'流水加载失败，请重试'},400);}
}
