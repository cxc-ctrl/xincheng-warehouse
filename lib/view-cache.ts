export type ViewEntry<T>={value:T;updatedAt:number;stale:boolean};
type Ticket={generation:number;sequence:number};

/** Memory-only display snapshots. Writes always use the server's validation. */
export class ViewCache<K extends string,T>{
 private entries=new Map<K,ViewEntry<T>>();
 private tickets=new Map<K,Ticket>();
 private generation=0;
 private sequence=0;
 get(key:K){return this.entries.get(key);}
 needsRefresh(key:K,now=Date.now(),ttl=30000){const e=this.get(key);return !e||e.stale||now-e.updatedAt>=ttl;}
 begin(key:K){const ticket={generation:this.generation,sequence:++this.sequence};this.tickets.set(key,ticket);return ticket;}
 current(key:K,ticket:Ticket){return ticket.generation===this.generation&&this.tickets.get(key)===ticket;}
 commit(key:K,ticket:Ticket,value:T,now=Date.now()){
  if(!this.current(key,ticket))return false;
  this.entries.set(key,{value,updatedAt:now,stale:false});return true;
 }
 patch(key:K,value:T){const old=this.get(key);if(old)this.entries.set(key,{...old,value});}
 /** All warehouse domains may depend on an order, cost or stock mutation.
  * Invalidate snapshots, but only fetch the page actually being viewed. */
 invalidate(){this.generation++;for(const entry of this.entries.values())entry.stale=true;this.tickets.clear();}
}
