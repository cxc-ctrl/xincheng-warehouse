import { requireChatGPTUser } from "./chatgpt-auth";
import Warehouse from "./warehouse";
export const dynamic="force-dynamic";
export default async function Page(){await requireChatGPTUser("/");return <Warehouse/>;}
