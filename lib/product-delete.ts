// Delete only an unused, unlinked sales SKU. Inventory and business history stay intact.
const unused=`p.stock_mode='recipe' AND p.quantity IS NULL AND p.count_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM stock_rules WHERE scope=p.scope AND sales_code=p.code)
 AND NOT EXISTS(SELECT 1 FROM orders WHERE scope=p.scope AND code=p.code)
 AND NOT EXISTS(SELECT 1 FROM order_stocks WHERE scope=p.scope AND sales_code=p.code)
 AND NOT EXISTS(SELECT 1 FROM movements WHERE scope=p.scope AND code=p.code AND kind='product')
 AND NOT EXISTS(SELECT 1 FROM order_returns WHERE scope=p.scope AND code=p.code AND kind='product')
 AND NOT EXISTS(SELECT 1 FROM retired_recipes WHERE scope=p.scope AND sales_code=p.code)`;

export async function appendProductDelete(b:Record<string,unknown>,d:D1Database,scope:string,rid:string,ss:D1PreparedStatement[],guard:string){
 if(b.confirm!==true)throw new Error('请先确认删除这个待关联商品');
 if(typeof b.code!=='string'||!b.code.trim()||b.code.length>160)throw new Error('商品编码无效');
 const code=b.code.trim();
 if(typeof b.updated_at!=='number'||!Number.isSafeInteger(b.updated_at))throw new Error('请刷新商品资料后重试');
 const product=await d.prepare(`SELECT p.updated_at,(${unused}) AS deletable FROM products p WHERE p.scope=? AND p.code=?`).bind(scope,code).first<{updated_at:number;deletable:number}>();
 if(!product)throw new Error('商品已不存在，请刷新列表');
 if(product.updated_at!==b.updated_at)throw new Error('商品资料已更新，请刷新后重新确认删除');
 if(!product.deletable)throw new Error('只能删除未关联且没有订单或库存记录的商品；已有记录的商品可取消“需要管理库存”');
 // Recheck in the committing transaction in case another user links/imports/edits it.
 ss.push(d.prepare(`SELECT CASE WHEN ${guard} AND NOT EXISTS(SELECT 1 FROM products p WHERE p.scope=? AND p.code=? AND p.updated_at=? AND ${unused}) THEN json('商品状态已变化，请刷新后重试') ELSE 1 END`).bind(scope,rid,scope,code,b.updated_at));
 ss.push(d.prepare(`DELETE FROM products WHERE scope=? AND code=? AND ${guard}`).bind(scope,code,scope,rid));
 ss.push(d.prepare(`DELETE FROM inventory_weights WHERE scope=? AND code=? AND kind='product' AND ${guard}`).bind(scope,code,scope,rid));
 ss.push(d.prepare(`DELETE FROM product_lifecycle WHERE scope=? AND code=? AND ${guard}`).bind(scope,code,scope,rid));
}

export async function deletedProductResult(d:D1Database,scope:string,code:string){
 if(await d.prepare('SELECT 1 FROM products WHERE scope=? AND code=?').bind(scope,code).first())throw new Error('该商品编码已重新建档，请刷新列表核对');
 return {deletedCode:code};
}
