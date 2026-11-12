// Temporary warehouse scope: scent cards are tested by another department.
export const ignoredOrderCode=(code:unknown)=>typeof code==='string'&&code.trim().startsWith('XLXH-HM-XK');
export const IGNORED_ORDER_REASON='香卡测试商品暂不纳入仓库（XLXH-HM-XK）';
