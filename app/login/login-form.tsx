'use client';
import {useState} from 'react';
import {Boxes,LockKeyhole} from 'lucide-react';
import './login.css';
export default function LoginForm(){
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:React.FormEvent){
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
   const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error??'登录失败');window.location.replace('/');
  }catch(e){setError(e instanceof Error?e.message:'无法连接，请稍后重试');setBusy(false)}
 }
 return <main className="warehouse-login"><form onSubmit={submit}>
  <div className="login-mark"><Boxes size={30}/></div><h1>现货仓库</h1><p>请输入密码，进入仓库管理</p>
  <label htmlFor="warehouse-password"><LockKeyhole size={16}/>登录密码</label><input id="warehouse-password" name="password" type="password" autoComplete="current-password" required autoFocus maxLength={200} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} placeholder="输入仓库登录密码"/>
  {error&&<div className="login-error" role="alert">{error}</div>}<button type="submit" disabled={busy||!password}>{busy?'正在登录…':'登录仓库'}</button><small>公共电脑使用完毕后，请退出登录。</small>
 </form></main>;
}
