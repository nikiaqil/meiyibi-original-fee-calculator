const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const script=html.match(/<script id="fee-engine">([\s\S]*?)<\/script>/)[1];
const E=vm.runInNewContext(script+';FeeEngine');
const C=s=>E.cents(s);
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS',name);}
function calc(kind,side,amount,sell=amount,orders=1,rates=E.defaults){return E.calculate({kind,side,buy:C(amount),sell:C(sell),orders,rates});}
check('A 股买入 1 万元：5.10 元',()=>{const r=calc('stock','buy','10000');assert.equal(r.commission,500n);assert.equal(r.transfer,10n);assert.equal(r.stamp,0n);assert.equal(r.fee,510n);assert.equal(r.cash,1000510n);});
check('A 股卖出 1 万元：10.10 元',()=>{const r=calc('stock','sell','10000');assert.equal(r.stamp,500n);assert.equal(r.fee,1010n);assert.equal(r.cash,998990n);});
check('A 股买卖一轮：15.20 元',()=>{const r=calc('stock','round','10000');assert.equal(r.fee,1520n);assert.equal(r.cash,-1520n);});
check('A 股不同卖价、扣费后盈利',()=>{const r=calc('stock','round','10000','11000');assert.equal(r.fee,1571n);assert.equal(r.cash,98429n);});
check('ETF 买入 1 万元：0.50 元',()=>{assert.equal(calc('etf','buy','10000').fee,50n);});
check('ETF / LOF 买卖均仅收佣金',()=>{for(const k of ['etf','lof'])for(const s of ['buy','sell']){const r=calc(k,s,'10000');assert.equal(r.fee,50n);assert.equal(r.transfer,0n);assert.equal(r.stamp,0n);}});
check('基金小额最低 0.30 元',()=>{assert.equal(calc('etf','buy','1000').fee,30n);assert.equal(calc('lof','sell','1').fee,30n);});
check('基金最低佣金临界点',()=>{assert.equal(calc('etf','buy','6000').fee,30n);assert.equal(calc('etf','buy','6100').fee,31n);});
check('国债佣金率与最低',()=>{for(const k of ['bookBond','certBond']){assert.equal(calc(k,'buy','1000').fee,100n);assert.equal(calc(k,'sell','10000').fee,200n);}});
check('A 股 10 万元按比例计佣金',()=>{assert.equal(calc('stock','buy','100000').fee,791n);assert.equal(calc('stock','sell','100000').fee,5791n);});
check('按每股价格与数量精确计算',()=>{assert.equal(E.turnover('1.235', '100'),12350n);assert.equal(E.turnover('0.0001','150'),2n);});
check('十进制按分四舍五入',()=>{assert.equal(C('1.005'),101n);assert.equal(C('0.004'),0n);});
check('等额拆分最低佣金逐笔计算',()=>{assert.equal(calc('stock','buy','10000','10000',2).fee,1010n);assert.equal(calc('etf','buy','10000','10000',2).fee,60n);});
check('各笔过户费独立取整',()=>{assert.equal(calc('stock','buy','1000','1000',2).transfer,2n);});
check('非整分均分保留成交总额',()=>{const r=calc('etf','buy','10.01','10.01',3);assert.equal(r.amount,1001n);assert.equal(r.commission,90n);});
check('两侧均拆分计费',()=>{assert.equal(calc('etf','round','10000','10000',2).fee,120n);});
check('保本额覆盖全部费用且为最小分值',()=>{for(const k of ['stock','etf','lof','bookBond','certBond'])for(const orders of [1,3]){const buy=C('10000'),sell=E.breakEven(buy,k,orders,E.defaults);assert(calc(k,'round','10000',(Number(sell)/100).toFixed(2),orders).cash>=0n);assert(calc(k,'round','10000',(Number(sell-1n)/100).toFixed(2),orders).cash<0n);}});
check('无费率可精确保本',()=>{const rates=structuredClone(E.defaults);rates.stock.rate='0';rates.stock.min='0';rates.transfer='0';rates.stamp='0';assert.equal(calc('stock','round','10000','10000',1,rates).fee,0n);assert.equal(E.breakEven(C('10000'),'stock',1,rates),C('10000'));});
check('金额与笔数边界验证',()=>{for(const a of ['0','-1','NaN','Infinity','1e9','1000000000000.01'])assert.throws(()=>calc('stock','buy',a));for(const n of [0,-1,1.5,10001])assert.throws(()=>calc('stock','buy','10000','10000',n));assert.throws(()=>calc('stock','buy','0.01','0.01',2));});
check('大额计算不丢分',()=>{assert.equal(C('1000000000000'),100000000000000n);assert.equal(calc('etf','buy','1000000000000').fee,5000000000n);});
check('费率单位为千分之',()=>{const r=structuredClone(E.defaults);r.etf.rate='1';r.etf.min='0';assert.equal(calc('etf','buy','10000','10000',1,r).fee,1000n);});
check('非法费率被拒绝',()=>{for(const val of ['-1','1001','abc']){const r=structuredClone(E.defaults);r.etf.rate=val;assert.throws(()=>E.validateRates(r));}});
check('所有脚本语法及元素 ID 引用',()=>{for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'unique DOM ids');for(const m of html.matchAll(/\$\('([^']+)'\)/g))assert(ids.includes(m[1]),'missing DOM id '+m[1]);});
const t=(patch={})=>E.reverseT({kind:'stock',sellPrice:'10',quantity:'1000',tick:'0.01',...patch});
check('做 T：10 元卖出 1000 股，最高盈利买回价 9.98',()=>{const r=t({buyPrice:'9.98'});assert.equal(r.profitable.price,'9.98');assert.equal(r.profitable.profit,480n);assert.equal(r.planned.profit,480n);assert.equal(r.sold.fee,1010n);assert.equal(r.planned.fee,510n);assert.equal(r.net,998990n);});
check('做 T：较低价格仍可能未覆盖费用',()=>{assert.equal(t({buyPrice:'9.99'}).planned.profit,-520n);assert.equal(t({buyPrice:'10.01'}).planned.profit,-2520n);});
check('做 T：至少净赚 100 元反推 9.88 元',()=>{const r=t({target:'100'});assert.equal(r.profitable.price,'9.88');assert.equal(r.profitable.profit,10480n);assert(t({buyPrice:'9.89'}).planned.profit<10000n);});
check('做 T：ETF 三位报价区分零收益和严格盈利',()=>{const r=t({kind:'etf',tick:'0.001'});assert.equal(r.nonloss.price,'9.999');assert.equal(r.nonloss.profit,0n);assert.equal(r.profitable.price,'9.998');assert.equal(r.profitable.profit,100n);assert.equal(t({kind:'etf',tick:'0.001',buyPrice:'9.999'}).planned.profit,0n);});
check('做 T：小额最低佣金导致无盈利买回价',()=>{const r=t({quantity:'1'});assert.equal(r.profitable,null);assert.equal(r.nonloss,null);});
check('做 T：不可能目标、无可用报价、空买回价',()=>{assert.equal(t({target:'10000'}).profitable,null);assert.equal(t({sellPrice:'0.009',quantity:'100000'}).profitable,null);assert.equal(t().planned,null);});
check('做 T：买回价格精度和输入验证',()=>{for(const p of [{buyPrice:'9.999'},{buyPrice:'0'},{sellPrice:'0'},{quantity:'1.5'},{target:'-1'},{buyOrders:0},{sellOrders:1.5},{kind:'bookBond'},{tick:'0.02'}])assert.throws(()=>t(p));});
check('做 T：成交均价可超过报价小数位',()=>{const r=t({sellPrice:'10.005'});assert.equal(r.sold.amount,1000500n);assert.equal(r.profitable.price,'9.98');});
check('做 T：费率改变同步反映在反推价格',()=>{const r=structuredClone(E.defaults);r.stock.rate='0';r.stock.min='0';r.transfer='0';r.stamp='0';const v=t({rates:r});assert.equal(v.nonloss.price,'10.00');assert.equal(v.nonloss.profit,0n);assert.equal(v.profitable.price,'9.99');assert.equal(v.profitable.profit,1000n);});
check('做 T：卖出和买回独立计费',()=>{const v=t({sellOrders:2,buyOrders:3,buyPrice:'9.90'});const sold=calc('stock','sell','10000','10000',2),bought=calc('stock','buy','9900','9900',3);assert.equal(v.sold.fee,sold.fee);assert.equal(v.planned.fee,bought.fee);assert.equal(v.planned.profit,10000n-sold.fee-bought.fee);});
check('做 T：反推边界和逐个报价穷举结果一致',()=>{
 for(const kind of ['stock','etf','lof'])for(const qty of ['1','100','1000'])for(const sellOrders of [1,2]){
  const tick='0.01',sellPrice='1.05',buyOrders=2,r=t({kind,sellPrice,quantity:qty,sellOrders,buyOrders,tick});
  for(const [goal,candidate]of [[0n,r.nonloss],[1n,r.profitable],...r.targets.map(x=>[x.goal,x.result])]){
   let best=null;
   for(let i=1;i<=105;i++){const price=(i/100).toFixed(2),amount=E.turnover(price,qty);if(amount<2n)continue;const sold=E.calculate({kind,side:'sell',buy:E.turnover(sellPrice,qty),sell:E.turnover(sellPrice,qty),orders:sellOrders}),bought=E.calculate({kind,side:'buy',buy:amount,sell:amount,orders:buyOrders});const profit=sold.cash-bought.cash;if(profit>=goal)best={price,profit};}
   assert.equal(candidate?.price??null,best?.price??null);if(best)assert.equal(candidate.profit,best.profit);
  }
 }
});
const f=(patch={})=>E.forwardT({kind:'stock',buyPrice:'10',quantity:'1000',tick:'0.01',...patch});
check('先买后卖：10元买1000股，10.02元卖净赚4.79元',()=>{const r=f({sellPrice:'10.02'});assert.equal(r.profitable.price,'10.02');assert.equal(r.nonloss.price,'10.02');assert.equal(r.cost,1000510n);assert.equal(r.bought.fee,510n);assert.equal(r.planned.fee,1011n);assert.equal(r.planned.profit,479n);assert.equal(f({sellPrice:'10.01'}).planned.profit,-521n);});
check('先买后卖：目标100元及下一档边界',()=>{const r=f({target:'100'});assert.equal(r.profitable.price,'10.12');assert.equal(r.profitable.profit,10474n);assert(f({sellPrice:'10.11'}).planned.profit<10000n);});
check('先买后卖：ETF零收益与严格盈利，LOF无股票税费',()=>{for(const kind of ['etf','lof']){const r=f({kind,tick:'0.001',sellPrice:'10.001'});assert.equal(r.nonloss.price,'10.001');assert.equal(r.nonloss.profit,0n);assert.equal(r.profitable.price,'10.002');assert.equal(r.planned.profit,0n);assert.equal(r.planned.stamp,0n);assert.equal(r.planned.transfer,0n);}});
check('先买后卖：均价、分笔、改费率、空计划价与非法输入',()=>{assert.equal(f({buyPrice:'10.005'}).bought.amount,1000500n);assert.equal(f().planned,null);const r=f({buyOrders:3,sellOrders:2,sellPrice:'10.10'}),b=calc('stock','buy','10000','10000',3),s=calc('stock','sell','10100','10100',2);assert.equal(r.planned.profit,s.cash-b.cash);const rates=structuredClone(E.defaults);rates.stock={rate:'0',min:'0'};rates.transfer='0';rates.stamp='0';assert.equal(f({rates}).nonloss.price,'10.00');assert.equal(f({rates}).profitable.price,'10.01');for(const p of [{sellPrice:'10.001'},{sellPrice:'0'},{buyPrice:'0'},{quantity:'1.5'},{target:'-1'},{buyOrders:0},{sellOrders:1.5},{kind:'bookBond'},{tick:'0.02'}])assert.throws(()=>f(p));});
check('先买后卖：金额上限、无法达到目标',()=>{const r=f({buyPrice:'100000000',quantity:'10000'});assert.equal(r.nonloss,null);assert.equal(r.profitable,null);assert.equal(f({target:'1000000000000'}).profitable,null);});
check('先买后卖：逐报价穷举验证最小盈利/保本/目标价',()=>{
 const custom=structuredClone(E.defaults);custom.stock={rate:'123.456',min:'0.02'};custom.transfer='234.567';custom.stamp='345.678';
 for(const rates of [E.defaults,custom])for(const kind of ['stock','etf','lof'])for(const quantity of ['1','10','100'])for(const orders of [1,3]){
  const r=f({rates,kind,quantity,buyPrice:'0.035',tick:'0.01',buyOrders:orders,sellOrders:orders,target:'0.05'});
  for(const [goal,candidate]of [[0n,r.nonloss],[5n,r.profitable]]){
   let best=null;
   for(let i=1;i<=5000;i++){const price=(i/100).toFixed(2),amount=E.turnover(price,quantity);if(amount<BigInt(orders))continue;const sold=E.calculate({kind,side:'sell',buy:amount,sell:amount,orders,rates}),profit=sold.cash-r.cost;if(profit>=goal){best={price,profit};break;}}
   assert.equal(candidate?.price??null,best?.price??null);if(best)assert.equal(candidate.profit,best.profit);
  }
 }
});
console.log(`\n${passed} checks passed.`);
