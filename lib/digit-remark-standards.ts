// A customer-facing inventory of the existing parser. Examples are executable
// fixtures in digit_remark_standards.cjs; changing copy must not invent behaviour.
export const REMARK_STANDARDS_VERSION='2026-10-24';
// These exports share schema 1; parser explanations are not executable imports.
export const COMPATIBLE_REMARK_STANDARDS_VERSIONS=new Set(['2026-10-21',REMARK_STANDARDS_VERSION]);
export const REMARK_STANDARD_GROUPS=['全部','备注优先级','颜色识别','份数分配','需人工核对','库存与打印'] as const;
export type RemarkExample={buyer:string;seller?:string;quantity?:number;spec?:string;expected:Record<string,number>|null;label?:string};
export type RemarkStandard={id:string;group:Exclude<typeof REMARK_STANDARD_GROUPS[number],'全部'>;name:string;when:string;result:string;detail:string;example?:RemarkExample;color?:string;editRuleId?:string};
export const REMARK_STANDARDS:RemarkStandard[]=[
 {id:'range-then-quantity',group:'份数分配',name:'每种颜色带范围和套数',when:'绿色1-30 8套 黄色1-30 10套',result:'同一规格下绿8套、黄10套，合计18套',detail:'先核对数字范围与当前SKU，再读取各色套数；范围与套数之间的空格不会被合并成一个数字。合计不符或范围有改动仍需人工核对。',example:{buyer:'绿色1-30 8套 黄色1-30 10套',quantity:18,spec:'3cm 1-30',expected:{'绿底白字':8,'黄底白字':10}}},
 {id:'red-short-default',group:'颜色识别',name:'红色默认红底白字',when:'只写红、红色、红底，没有另行指定字色',result:'默认匹配红底白字',detail:'用户确认的默认配色。明确写红底黄字等配色时仍按明确要求；不会把缺货的颜色替换成红色。',example:{buyer:'红色',expected:{'红底白字':1}}},
 {id:'pink-short-default',group:'颜色识别',name:'粉色默认玫红色',when:'粉、粉色、粉底白字等写法',result:'对应玫红底白字',detail:'用户确认粉色与玫红色的对应关系；明确要求不支持的字色仍需核对。',example:{buyer:'粉色',expected:{'玫红底白字':1}}},
 {id:'shared-white-foreground',group:'颜色识别',name:'多种底色统一字色',when:'红底、蓝底、绿底、黄底，都要白字，各两份',result:'四种底色均匹配白字，每色2份',detail:'只把紧邻颜色列表后的统一字色用于该列表；数量总和必须等于本SKU购买份数。不存在的配色继续人工核对。',example:{buyer:'红底 蓝底\n绿底 黄底 都要白字 各两份',quantity:8,expected:{'红底白字':2,'蓝底白字':2,'绿底白字':2,'黄底白字':2}}},
 {id:'background-wording',group:'颜色识别',name:'底色说法兼容',when:'例如玫红底色',result:'对应颜色唯一时匹配玫红底白字',detail:'“底色”表示背景色，不额外新增颜色；仍检查库存对应配色是否唯一。',example:{buyer:'玫红底色',expected:{'玫红底白字':1}}},
 {id:'coffee-short-name',group:'颜色识别',name:'咖色识别为咖啡色',when:'买家或卖家备注写咖色、咖色白字',result:'按咖啡色匹配对应库存',detail:'只写咖色时，仍要求当前尺寸的咖啡色库存颜色可以唯一确定；不会忽略数量、范围或缺货检查。',example:{buyer:'咖色',expected:{'咖啡底白字':1}}},
 {id:'grouped-each-quantity',group:'份数分配',name:'分组各几份，加上单独颜色份数',when:'红、蓝、绿各2份，黄1份',result:'红2份、蓝2份、绿2份、黄1份，合计7份',detail:'“各几份”只作用于前面尚未指定数量的颜色组。支持多个分组；颜色须能唯一识别，总和须与本条SKU的购买份数一致，否则仍需人工核对。每份再按实物关联规则换算扣减数量。',example:{buyer:'红底白字、蓝底白字、绿底白字，各2份 黄底白字1份【流星｜10-15 11:48:54】',quantity:7,expected:{'红底白字':2,'蓝底白字':2,'绿底白字':2,'黄底白字':1}}},
 {id:'invoice-note',group:'备注优先级',name:'忽略发票及开票日期',when:'10-21发票、10-18登记发票、带发票等开票说明',result:'不视为数字贴范围，继续匹配库存或打印',detail:'只忽略开票文字和紧邻的开票日期；保留原始备注，以及真正的颜色、尺寸、数量与数字范围要求。',example:{buyer:'蓝底白字',seller:'10-21发票',expected:{'蓝底白字':1}}},
 {id:'remark-columns',group:'备注优先级',name:'先检查备注列',when:'ERP没有提供买家 / 卖家备注列',result:'人工核对，不能当成没有颜色要求',detail:'备注列存在但内容为空，与没有提供备注列是两回事。'},
 {id:'seller-first',group:'备注优先级',name:'卖家明确要求优先',when:'卖家备注明确写了颜色、规格或份数',result:'优先按卖家发货要求判断；不清楚则核对',detail:'卖家的快递或催发货说明不覆盖买家颜色。客服有效发货要求优先于顾客；客服要求模糊或数量矛盾时人工核对，不回退覆盖。客服没有发货要求才读取顾客备注。',example:{buyer:'红底白字',seller:'蓝底白字',expected:{'蓝底白字':1}}},
 {id:'delivery-only',group:'备注优先级',name:'快递要求不改颜色',when:'只有发中通、不要发圆通快递、请尽快发货等要求',result:'继续读取买家颜色；没有颜色才用默认色',detail:'可以排除的快递名称为圆通、中通、顺丰、申通、韵达、极兔。其他否定语句仍可能要求核对。',example:{buyer:'蓝底白字',seller:'不要发圆通快递',expected:{'蓝底白字':1}}},
 {id:'default-red',group:'备注优先级',name:'无颜色要求默认红底白字',when:'备注列已提供，双方没有可识别的颜色 / 规格变更要求',result:'全部购买份数按红底白字',detail:'不是把所有无法识别的备注都当红色；内部编码、颜色不明、数量矛盾会先被拦下。',example:{buyer:'请尽快发货',quantity:2,expected:{'红底白字':2}}},
 ...[
  ['红底白字','红色白字'],['黄底白字','黄色白字'],['黄底黑字','黄底黑子'],['绿底白字','绿色白字'],['蓝底白字','篮色白字'],['红底黄字','红色黄字'],['玫红底白字','玫红色底白字'],['橙色白字','橙底白字'],['咖啡底白字','褐色白字、棕色白字、咖啡厎白字'],['黑底白字','黑色白字'],['白底黑字','白色黑字'],['紫色白字','紫底白字'],
 ].map(([color,aliases]):RemarkStandard=>({id:'color-'+color,group:'颜色识别',name:color,when:color+'；'+aliases,result:'识别为'+color,detail:'可点击“补充说法”添加你们使用的别名。这里只代表颜色已识别，实际扣库存还要检查尺寸、版面和已盘点余额。',color,example:{buyer:aliases.split('、')[0],expected:{[color]:1}}})),
 {id:'background-only',group:'颜色识别',name:'只写底色 / 颜色简称',when:'例如蓝色、绿色、黑色、白色、咖啡色',result:'可用颜色唯一时才自动匹配',detail:'同一条备注已有该底色的完整颜色时，先用明确颜色；否则按当前尺寸可用颜色判断。“红色”默认红底白字，“黄色”默认黄底白字；明确指定字色时按完整配色。',example:{buyer:'黄色',quantity:2,expected:{'黄底白字':2}}},
 {id:'format-normalization',group:'颜色识别',name:'常见写法与错字整理',when:'厎→底；篮色→蓝色；褐色 / 棕色→咖啡色；浅蓝色→蓝色',result:'整理后继续检查颜色和数量',detail:'支持全角字符和空白整理、备注里的系统时间标记清理，以及“字体白色，底色绿色”等明确写法。浅蓝是原有特殊兼容；其他浅色、深色、荧光色不随意归并。',example:{buyer:'字体白色，底色绿色',expected:{'绿底白字':1}}},
 {id:'single-color',group:'份数分配',name:'单色覆盖全部份数',when:'只识别到一种颜色，备注没有矛盾数量',result:'该颜色 × ERP购买份数',detail:'备注写了数量时，也必须与本条销售SKU的购买份数一致。',example:{buyer:'2份都要黑底白字',quantity:2,expected:{'黑底白字':2}}},
 {id:'named-quantity',group:'份数分配',name:'逐色明确填写份数',when:'蓝底白字2份，红底白字1份；或2份蓝底白字',result:'逐色相加，总和必须等于购买份数',detail:'支持阿拉伯数字、常见中文数量，以及颜色×数量、数量份颜色。相同颜色的明确分配会合并。',example:{buyer:'蓝底白字2份，红底白字1份',quantity:3,expected:{'蓝底白字':2,'红底白字':1}}},
 {id:'each-quantity',group:'份数分配',name:'每个颜色各几份',when:'红底白字、蓝底白字各两份',result:'每色各2份，总和校验后分配',detail:'每组“各几份”分别识别；分组不清或合计不符时转核对。同色重复列出并明确“各一份”时会合并数量。',example:{buyer:'红底白字、蓝底白字各两份',quantity:4,expected:{'红底白字':2,'蓝底白字':2}}},
 {id:'one-each',group:'份数分配',name:'颜色种数等于购买份数',when:'购买3份，备注明确红底白字、绿底白字、蓝底白字，未写各色数量',result:'每种颜色分配1份',detail:'颜色种数与购买份数不相等时，不能自动猜成每色1份。',example:{buyer:'红底白字、绿底白字、蓝底白字',quantity:3,expected:{'红底白字':1,'绿底白字':1,'蓝底白字':1}}},
 {id:'equal-share',group:'份数分配',name:'明确平均分配',when:'写了均分、平均、各一半，而且购买份数能整除颜色种数',result:'按整份平均分配',detail:'未写平均分配，或者不能整除，均交人工核对。',example:{buyer:'红底白字、蓝底白字平均',quantity:6,expected:{'红底白字':3,'蓝底白字':3}}},
 {id:'special-production',group:'需人工核对',name:'特殊制作关键词',when:'命中已启用的“特殊制作先人工核对”规则',result:'按该条已保存的关键词和处理方式执行',detail:'原关键词包括定制、按图、看图、改数字、改编号、额外、另做、加印、多做、粗体、随机、没有就。可以编辑或停用；实时配置以下方关键词规则为准。',editRuleId:'builtin-special-production',example:{buyer:'按图发货',expected:null}},
 {id:'internal-code',group:'需人工核对',name:'只有内部编码',when:'备注像 YH-02-58 这类编码',result:'没有明确发货颜色则人工核对',detail:'不能仅根据内部编码猜颜色；如果卖家补充清楚的发货要求，仍按卖家优先规则处理。',example:{buyer:'YH-02-58',expected:null}},
 {id:'negative',group:'需人工核对',name:'否定、排除和替换',when:'不要、不能、取消、除外、不是、非红、不发、别发等',result:'无法明确确认最终要求时人工核对',detail:'原有例外：“不要发错 / 别弄错”不改变颜色；明确“不要红色底的换蓝色底”可按蓝色处理；部分快递否定要求单独排除。',example:{buyer:'不要红底白字',expected:null}},
 {id:'unknown-color',group:'需人工核对',name:'没有配置或无法唯一识别的颜色',when:'例如金底白字、未支持的深色 / 荧光色、还有未识别的颜色要求',result:'保留备注，人工选择实际发货颜色',detail:'完整颜色不存在时会提示未配置库存；仅写底色但可对应多种颜色时也不能猜测。',example:{buyer:'金底白字',expected:null}},
 {id:'quantity-conflict',group:'需人工核对',name:'数量或颜色种数矛盾',when:'各色份数合计不等于购买份数；多色分配不清；声明的颜色种数不一致',result:'停止自动扣减，提示核对',detail:'“份”是ERP销售数量，不能把备注里的贴数直接当作份数。未识别清楚的数量不自动补齐。',example:{buyer:'红底白字3份，蓝底白字3份',quantity:4,expected:null}},
 {id:'size-range',group:'需人工核对',name:'尺寸、数字范围不一致',when:'备注尺寸或数字范围与本销售SKU不符',result:'人工核对，不按默认范围扣库存',detail:'多SKU要求写在同一备注时，先尝试取本尺寸，再取本数字范围的指令；同范围有多条歧义要求仍需核对。',example:{buyer:'蓝底白字5cm',spec:'3cm 1-10',expected:null}},
 {id:'multi-sku',group:'需人工核对',name:'同一备注涉及多个规格',when:'分别写了1-60发蓝色、1-250发红色',result:'只取本SKU范围的要求；对应不清则核对',detail:'这是原有按尺寸和数字范围选取片段的判断，不会把整条备注的所有颜色都分给每个SKU。',example:{buyer:'1-60发蓝底白字，1-250发红底白字',spec:'3cm 1-60',expected:{'蓝底白字':1}}},
 {id:'custom-keywords',group:'需人工核对',name:'你新增的关键词规则',when:'同一备注命中多个已启用关键词规则',result:'人工核对优先 → 建议整单打印 → 颜色别名',detail:'同一位置别名匹配出不同颜色时转核对。规则还受买家 / 卖家来源、尺寸和排除词限制。建议打印也不会直接创建打印任务。'},
 {id:'stock-conditions',group:'库存与打印',name:'颜色识别后检查数字贴条件',when:'检查该颜色、尺寸是否启用，数字范围是否在备货范围内',result:'条件不完整先核对；超范围按已配置策略处理',detail:'备货范围和超范围策略到“数字贴条件”维护，不由关键词直接决定。'},
 {id:'stock-balance',group:'库存与打印',name:'对应版面、盘点与余额',when:'每一块所需版面已关联、实物存在且已盘点、余额足够',result:'全部通过才允许按对应颜色扣减',detail:'缺少关联、未盘点、库存不足均不默认扣红色，也不自动转打印。库存不足是否建议打印，以“数字贴条件”的策略为准。'},
 {id:'manual-print',group:'库存与打印',name:'打印必须人工整单确认',when:'缺货、超备货范围或关键词命中建议打印',result:'先提示，再由仓库选择整单转打印',detail:'不能自动把“未建立对应库存”都塞进打印列表。整单转入后按打印规则计算生产成本。'},
 {id:'rolling-status',group:'库存与打印',name:'滚动导入和历史保护',when:'ERP状态为已发货 / 已完成；同一订单反复导入',result:'按有效出库处理，重复导入不重复扣减',detail:'取消 / 退款不自动加回实物。修改备注规则不会批量重算已扣库存或已确认成本；待核对订单需明确重新识别或人工确认。'},
];
