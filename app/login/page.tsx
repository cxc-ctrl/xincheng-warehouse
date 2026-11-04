import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {SESSION_COOKIE,passwordLoginEnabled,validSession} from '../../lib/warehouse-auth';
import LoginForm from './login-form';
export const dynamic='force-dynamic';
export default async function Login(){if(!passwordLoginEnabled()||validSession((await cookies()).get(SESSION_COOKIE)?.value))redirect('/');return <LoginForm/>;}
