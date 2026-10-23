#!/usr/bin/env node
// Development-only behavioural verification. It never registers a real brand standard.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { fixture,PNG } from '../tests/fixtures.mjs';
import { register,prepare,apply,validate } from '../skills/introbook-personalizer/scripts/core.mjs';
import { config } from '../skills/introbook-personalizer/scripts/knowledge.mjs';

const moduleDir=process.env.INTROBOOK_PLAYWRIGHT_DIR;
if(!moduleDir) throw Error('Set INTROBOOK_PLAYWRIGHT_DIR to the installed Playwright package directory');
const {chromium}=await import(pathToFileURL(path.join(moduleDir,'index.mjs')).href);
const root=path.resolve('.work/browser-check');
await fs.rm(root,{recursive:true,force:true});await fs.mkdir(root,{recursive:true});
const input=await fixture(path.join(root,'source'));
const template=await register({input,root:path.dirname(input),templates:path.join(root,'templates'),brand:'mingdao',version:'test-only'});
const workdir=path.join(root,'run');
await prepare({template:template.dir,workdir,request:{industry:'制造业',scenarios:['质量追溯'],locale:'bilingual'}});
const sources=[{id:'cases:fixture',kind:'cases',rowId:'fixture',appId:config.cases.appId,worksheetId:config.cases.worksheetId,statusKey:config.cases.publicStatusKey,status:'发布中',title:'TEST FIXTURE',publicUrl:'https://www.mingdao.com/case/001',body:[{text:'TEST FIXTURE'}],brand:'mingdao',verifiedAt:new Date().toISOString()}];
const value=locale=>({title:{text:locale==='zh'?'新增案例（测试）':'Added case (test)'},copy:{text:locale==='zh'?'从批次记录到异常处理，串联质量追溯流程。':'Connect batch records and exception handling for quality traceability.'},logo:{dataUri:`data:image/png;base64,${PNG}`,alt:'Test image'}});
const changes={pages:[{pageId:'zh-product',values:{copy:{text:'用业务语言解释跨车间质量协同与批次追溯。'}}},{pageId:'en-product',values:{copy:{text:'Coordinate quality processes and batch records across workshops.'}}}],remove:[],add:['zh','en'].map(l=>({templatePageId:`${l}-case`,newPageId:`new-${l}`,afterPageId:`${l}-case`,values:value(l),sourceIds:['cases:fixture']})),gaps:[]};
await apply({workdir,changes,sources});const verified=await validate(workdir);
const browser=await chromium.launch({headless:true,...(process.env.INTROBOOK_BROWSER_EXECUTABLE?{executablePath:process.env.INTROBOOK_BROWSER_EXECUTABLE}:{})});
const results=[];
try {
  const context=await browser.newContext();await context.setOffline(true);
  const network=[],errors=[];
  context.on('request',r=>{if(/^https?:/i.test(r.url()))network.push(r.url());});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const [width,height] of [[1920,1080],[1280,720],[390,844]]) {
    await page.setViewportSize({width,height});await page.goto(pathToFileURL(path.join(workdir,'index.html')).href);
    await page.locator('[data-ib-position]').waitFor();
    assert.equal(await page.locator('[data-ib-position]').textContent(),'1 / 5');
    assert.equal(await page.locator('[data-ib-directory] option').count(),5);
    await page.locator('[data-ib-next]').click();assert.equal(await page.locator('[data-ib-directory]').inputValue(),'zh-architecture');
    await page.locator('[data-ib-directory]').selectOption('new-zh');assert.equal(await page.locator('[data-ib-position]').textContent(),'4 / 5');
    await page.locator('[data-ib-locale]').selectOption('en');assert.equal(await page.locator('[data-ib-directory]').inputValue(),'new-en');
    assert.match(await page.locator('[data-page-id="new-en"]').innerText(),/Added case/);
    await page.evaluate(async()=>{for(const img of document.images) await img.decode();});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.screenshot({path:path.join(root,`generated-${width}.png`)});
    results.push({width,height,offline:true,navigation:true,imagesDecoded:true,overflow:false});
  }
  await page.setViewportSize({width:1920,height:1080});
  await page.goto(pathToFileURL(path.join(template.dir,'index.html')).href);await page.locator('[data-ib-directory]').selectOption('zh-architecture');
  const before=await page.locator('[data-page-id="zh-architecture"]').screenshot();
  await page.goto(pathToFileURL(path.join(workdir,'index.html')).href);await page.locator('[data-ib-directory]').selectOption('zh-architecture');
  const after=await page.locator('[data-page-id="zh-architecture"]').screenshot({path:path.join(root,'architecture.png')});
  assert(before.equals(after),'Protected architecture rendering differs from baseline');
  // Single-language output must expose no other language and retain dynamic navigation.
  const single=path.join(root,'single');await prepare({template:template.dir,workdir:single,request:{industry:'服务业',scenarios:['门店运营'],locale:'en'}});
  await apply({workdir:single,changes:{pages:[],remove:[],add:[],gaps:[]},sources:[]});
  await page.goto(pathToFileURL(path.join(single,'index.html')).href);
  assert.equal(await page.locator('[data-ib-locale]').isHidden(),true);assert.equal(await page.locator('[data-ib-position]').textContent(),'1 / 4');
  assert.equal(network.length,0);assert.deepEqual(errors,[]);
  const report={fixtureOnly:true,htmlSha256:verified.sha256,checks:results,lockedPagePixelIdentical:true,singleLanguage:true,networkRequests:network.length,pageErrors:errors};
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
