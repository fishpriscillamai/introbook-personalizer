import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture,PNG } from './fixtures.mjs';
import { register,prepare,apply,validate,deliver,readJson,render,loadRun,sha } from '../skills/introbook-personalizer/scripts/core.mjs';
import { normalizeSource,searchPlan,config } from '../skills/introbook-personalizer/scripts/knowledge.mjs';
import { parse,annotate,inventory } from '../skills/introbook-personalizer/scripts/html.mjs';
import { assertOffline,bundleHtml } from '../skills/introbook-personalizer/scripts/resources.mjs';
import { main } from '../skills/introbook-personalizer/scripts/introbook.mjs';

async function setup(t,brand='mingdao',locale='zh',transform) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'introbook-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const input=await fixture(path.join(root,'source'));
  if(transform)await fs.writeFile(input,transform(await fs.readFile(input,'utf8')));
  const registered=await register({input,root:path.dirname(input),templates:path.join(root,'templates'),brand,version:'test-v1'});
  const workdir=path.join(root,'run');
  const request={industry:'制造业',scenarios:['质量追溯'],brand,locale};
  await prepare({template:registered.dir,workdir,request});
  return {root,input,registered,workdir,request};
}
const empty=()=>({pages:[],remove:[],add:[],gaps:[]});
const source=(kind='cases',brand='mingdao')=>({id:`${kind}:row-1`,kind,rowId:'row-1',appId:config[kind].appId,worksheetId:config[kind].worksheetId,status:config[kind].publicStatusName,statusKey:config[kind].publicStatusKey,title:'公开案例',publicUrl:'https://www.mingdao.com/case/001',body:[{field:'overview',text:'有来源的场景说明'}],brand:kind==='cases'?brand:null,verifiedAt:new Date().toISOString()});
const caseValues=()=>({title:{text:'已核验的新客户案例'},copy:{text:'已验证的质量追溯场景'},logo:{dataUri:`data:image/png;base64,${PNG}`,alt:'新案例图片'}});

test('registration embeds CSS, scripts, images and fonts, and freezes architecture/facts',async t=>{
  const s=await setup(t),html=await fs.readFile(path.join(s.registered.dir,'index.html'),'utf8');
  assertOffline(html);assert.match(html,/data:font\/woff2;base64/);assert.doesNotMatch(html,/<script src=/);
  assert.equal(s.registered.policy.pages.find(p=>p.id==='zh-architecture').mode,'locked');
  assert(!s.registered.policy.pages.find(p=>p.id==='zh-product').editable.includes('fact'));
  await assert.rejects(register({input:s.input,templates:path.join(s.root,'templates'),brand:'mingdao',version:'test-v1'}),/EEXIST/);
});
test('manufacturing copy changes only allowed slot; single-language output is self-contained',async t=>{
  const s=await setup(t),changes=empty();changes.pages.push({pageId:'zh-product',values:{copy:{text:'串联车间质检、批次记录与异常处理'}}});
  await apply({...s,changes,sources:[]});const v=await validate(s.workdir);assert.equal(v.pages,4);
  const html=await fs.readFile(path.join(s.workdir,'index.html'),'utf8');assert.match(html,/串联车间/);assert.match(html,/ISO 27001/);assert(!inventory(html).some(p=>p.locale==='en'));
});
test('service business and Nocoly English use independent template identity',async t=>{
  const s=await setup(t,'nocoly','en'),changes=empty();changes.pages.push({pageId:'en-product',values:{copy:{text:'Connect service requests and branch operations'}}});
  await apply({...s,changes,sources:[]});assert.equal((await validate(s.workdir)).brand,'nocoly');
  await assert.rejects(prepare({template:s.registered.dir,workdir:path.join(s.root,'wrong'),request:{...s.request,brand:'mingdao'}}),/brand differ/);
});
test('unmatched material preserves baseline and reports a gap',async t=>{
  const s=await setup(t),changes=empty();changes.gaps=['未找到公开的同行业案例，保留标准案例'];
  await apply({...s,changes,sources:[]});assert.equal((await validate(s.workdir)).gaps.length,1);
});
test('architecture, fact, CSS, script and embedded image tampering are caught in output',async t=>{
  const s=await setup(t);await apply({...s,changes:empty(),sources:[]});const file=path.join(s.workdir,'index.html'),html=await fs.readFile(file,'utf8');
  for(const [a,b] of [['Immutable architecture diagram','Changed architecture'],['ISO 27001','ISO 99999'],['#2196f3','#000000'],['function boot()','function broken()'],[PNG,PNG.replace('iVBOR','aVBOR')]]) {
    assert(html.includes(a));await fs.writeFile(file,html.replace(a,b));await assert.rejects(validate(s.workdir),/differs|resource/);
  }
  await fs.writeFile(file,html);assert((await validate(s.workdir)).ok);
});
test('protected pages cannot be removed or unlocked',async t=>{
  const s=await setup(t),changes=empty();changes.remove=['zh-architecture'];await assert.rejects(apply({...s,changes,sources:[]}),/protected page/);
  changes.remove=[];changes.pages=[{pageId:'zh-product',values:{fact:{text:'changed'}}}];await assert.rejects(apply({...s,changes,sources:[]}),/Locked slot/);
  const {t:baseline,run}=await loadRun(s.workdir);
  assert.throws(()=>render(baseline,run,{...empty(),pages:[{pageId:'zh-architecture',values:{title:{text:'changed'}}}]},[]),/locked/);
});
test('case replacement and addition require complete values and live evidence',async t=>{
  const s=await setup(t),changes=empty();changes.pages=[{pageId:'zh-case',values:{title:{text:'new'}},sourceIds:['cases:row-1']}];
  await assert.rejects(apply({...s,changes,sources:[source()]}),/every donor/);
  changes.pages[0].values=caseValues();await apply({...s,changes,sources:[source()]});
  let html=await fs.readFile(path.join(s.workdir,'index.html'),'utf8');assert(!html.includes('原客户业务成果'));assert(!html.includes('Original customer logo'));
  changes.add=[{templatePageId:'zh-case',newPageId:'case-new',afterPageId:'zh-case',values:caseValues(),sourceIds:['cases:row-1']}];
  await apply({...s,changes,sources:[source()]});assert.equal((await validate(s.workdir)).pages,5);
  html=await fs.readFile(path.join(s.workdir,'index.html'),'utf8');parse(html);assert.match(html,/case-new-zh-case-title/);
  changes.pages=[];changes.add[0].sourceIds=[];await assert.rejects(apply({...s,changes,sources:[]}),/verified source/);
});
test('nonpublic, stale and cross-brand sources are rejected',async t=>{
  const s=await setup(t),changes=empty();changes.pages=[{pageId:'zh-case',values:caseValues(),sourceIds:['cases:row-1']}];
  for(const bad of [{...source(),status:'不可公开'}, {...source(),verifiedAt:'2020-01-01T00:00:00Z'},source('cases','nocoly')]) await assert.rejects(apply({...s,changes,sources:[bad]}),/nonpublic|again|Cross-brand/);
});
test('bilingual additions must retain equal counts and valid locale insertion',async t=>{
  const s=await setup(t,'mingdao','bilingual'),changes=empty();
  changes.add=[{templatePageId:'zh-case',newPageId:'new-zh',afterPageId:'zh-case',values:caseValues(),sourceIds:['cases:row-1']}];
  await assert.rejects(apply({...s,changes,sources:[source()]}),/equal page counts/);
  changes.add.push({...changes.add[0],templatePageId:'en-case',newPageId:'new-en',afterPageId:'en-case'});
  await apply({...s,changes,sources:[source()]});assert.equal((await validate(s.workdir)).pages,10);
});
test('standard/policy mutations invalidate the baseline snapshot',async t=>{
  const s=await setup(t);await apply({...s,changes:empty(),sources:[]});
  const f=path.join(s.workdir,'baseline','policy.json');await fs.writeFile(f,'{}');await assert.rejects(validate(s.workdir),/modified/);
});
test('resource path traversal, symlinks, network resources and active SVG fail',async t=>{
  const s=await setup(t),dir=path.dirname(s.input),original=await fs.readFile(s.input,'utf8');
  for(const ref of ['https://example.com/logo.png','../outside.png']) {
    await fs.writeFile(s.input,original.replace('src="logo.png"',`src="${ref}"`));await assert.rejects(bundleHtml(s.input,dir));
  }
  await fs.writeFile(path.join(s.root,'outside.png'),Buffer.from(PNG,'base64'));await fs.symlink(path.join(s.root,'outside.png'),path.join(dir,'escape.png'));
  await fs.writeFile(s.input,original.replace('src="logo.png"','src="escape.png"'));await assert.rejects(bundleHtml(s.input,dir),/escapes/);
  await fs.writeFile(path.join(dir,'bad.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await fs.writeFile(s.input,original.replace('src="logo.png"','src="bad.svg"'));await assert.rejects(bundleHtml(s.input,dir),/Active SVG/);
});
test('source normalizer excludes nonpublic/internal records and drops personal/signed fields',()=>{
  for(const kind of ['cases','solutions']) {
    const c=config[kind],record={rowId:'row-1',[c.titleField]:'公开说明',[c.statusField]:[{key:c.publicStatusKey}],[c.urlField]:`https://www.mingdao.com/${kind==='cases'?'case':'solution'}/001`,[c.bodyFields[0]]:'公开业务内容',_owner:{mobilePhone:'PRIVATE'},DownloadUrl:'https://host/?token=SECRET'};
    const good=normalizeSource(kind,{success:true,data:record});assert(!JSON.stringify(good).includes('PRIVATE'));assert(!JSON.stringify(good).includes('SECRET'));
    assert.throws(()=>normalizeSource(kind,{data:{...record,[c.statusField]:[{key:'internal'}]}}),/Excluded/);
  }
  assert.throws(()=>normalizeSource('cases',{isError:true}),/permission/);assert.throws(()=>normalizeSource('cases',{success:false}),/denied/);
});
test('retrieval targets only designated libraries and source types',()=>{
  const plan=searchPlan({industry:'服务业',scenarios:['门店运营']});assert.equal(plan.calls.length,2);
  assert.deepEqual(plan.calls[0].args.knowledgeIds,[config.cases.knowledgeId]);assert.deepEqual(plan.calls[1].args.knowledgeIds,[config.solutions.knowledgeId]);
  assert.deepEqual(plan.calls[0].args.filter.types,['record','record_attachment']);
});
test('new quantitative claims require evidence and cannot enter product copy',async t=>{
  const s=await setup(t),changes=empty();changes.pages=[{pageId:'zh-product',values:{copy:{text:'效率提高99%'}}}];
  await assert.rejects(apply({...s,changes,sources:[]}),/numeric facts/);
  changes.pages=[{pageId:'zh-case',values:{...caseValues(),copy:{text:'效率提高99%'}},sourceIds:['cases:row-1']}];
  await assert.rejects(apply({...s,changes,sources:[source()]}),/verified source text/);
});
test('delivery requires current review, copies HTML only and cannot overwrite',async t=>{
  const s=await setup(t);await apply({...s,changes:empty(),sources:[]});const v=await validate(s.workdir),review=path.join(s.workdir,'review.json'),output=path.join(s.root,'deliver','customer.html');
  await fs.writeFile(review,JSON.stringify({htmlSha256:'stale'}));await assert.rejects(deliver({...s,review,output}),/review/);
  await fs.writeFile(review,JSON.stringify({htmlSha256:v.sha256,offline:true,desktop:true,mobile:true,navigation:true,content:true,reviewer:'test-runner',reviewedAt:new Date().toISOString()}));
  await deliver({...s,review,output});assert.deepEqual(await fs.readdir(path.dirname(output)),['customer.html']);
  assert.equal(sha(await fs.readFile(output)),v.sha256);await assert.rejects(deliver({...s,review,output}),/EEXIST/);
});
test('missing current standards are actionable; quoted tag attributes and Unicode text survive',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'introbook-empty-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const request=path.join(root,'request.json');await fs.writeFile(request,JSON.stringify({industry:'制造',scenarios:['设备']}));
  await assert.rejects(main(['prepare','--templates',path.join(root,'empty'),'--request',request,'--workdir',path.join(root,'run')]),/latest source/);
  const html=annotate('<html><body><section title="a > b"><p>中文 &amp; English</p></section></body></html>');assert.equal(inventory(html)[0].slots[0].text,'中文 & English');
});

test('partner company adds an independent header subtitle and preserves flow title',async t=>{
  const transform=html=>html.replace(/(<section data-page-id="zh-case"[^>]*>)([\s\S]*?)(<\/section>)/,(_,open,body,close)=>open.replace('data-slide=', 'data-source-slide="17" data-directory-title-slot="title" data-slide=')+'<div class="slide-canvas">'+body+'</div>'+close);
  const s=await setup(t,'mingdao','zh',transform),changes=empty();
  const company='公开伙伴公司',evidence={...source('solutions'),publicUrl:'https://www.mingdao.com/solution/001',partnerCompany:company,body:[{field:'partner',text:'伙伴公司：'+company}]};
  changes.add=[{templatePageId:'zh-case',newPageId:'partner-solution',afterPageId:'zh-case',values:{...caseValues(),copy:{text:'订单到入库流程'}},sourceIds:['solutions:row-1'],partnerCompany:company}];
  await apply({...s,changes,sources:[evidence]});assert.equal((await validate(s.workdir)).pages,5);
  const html=await fs.readFile(path.join(s.workdir,'index.html'),'utf8');
  const page=inventory(html).find(p=>p.id==='partner-solution');
  assert.equal(page.slots.find(p=>p.id==='copy').text,'订单到入库流程');
  assert.equal(page.slots.find(p=>p.id==='partner-company').text,company);
  assert.match(html,/aria-describedby="partner-solution-partner-company"/);
  changes.add[0].partnerCompany='未核验公司';
  await assert.rejects(apply({...s,changes,sources:[evidence]}),/match the verified solution company/);
  changes.add[0].partnerCompany=company;changes.add[0].sourceIds=['cases:row-1'];
  await assert.rejects(apply({...s,changes,sources:[source()]}),/match the verified solution company/);
  changes.add=[];changes.pages=[{pageId:'zh-product',values:{copy:{text:'业务说明'}},sourceIds:['solutions:row-1'],partnerCompany:company}];
  await assert.rejects(apply({...s,changes,sources:[evidence]}),/plain subtitle on a solution page/);
});
