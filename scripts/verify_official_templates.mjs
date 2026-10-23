#!/usr/bin/env node
// Development QA of reviewed official snapshots. Synthetic cases remain in .work only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {register,prepare,apply,validate,readJson,sha} from '../skills/introbook-personalizer/scripts/core.mjs';
import {parse} from '../skills/introbook-personalizer/scripts/html.mjs';
import {config} from '../skills/introbook-personalizer/scripts/knowledge.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const {chromium}=await import(pathToFileURL(path.join(process.env.INTROBOOK_PLAYWRIGHT_DIR,'index.mjs')).href);
const output=path.resolve(process.argv[2]??'.work/official-template-check');
await fs.mkdir(output,{recursive:false});
const browser=await chromium.launch({headless:true,executablePath:process.env.INTROBOOK_BROWSER_EXECUTABLE});
const reports=[];
try {
 for(const brand of ['mingdao','nocoly']) {
  const adapted=path.resolve(`.work/template-${brand}-final`);
  const input=path.join(adapted,'index.html'),policy=await readJson(path.join(adapted,'policy.json'));
  const template=await register({input,root:adapted,templates:path.join(output,'templates'),brand,version:'candidate-20261022',policy});
  const context=await browser.newContext({offline:true,locale:'zh-CN',reducedMotion:'reduce'});
  const network=[],errors=[];
  const rasterizationDifferences=[];
  context.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  async function ready(file,width=960,height=540) {
   await page.setViewportSize({width,height});await page.goto(pathToFileURL(file).href);
   await page.locator('.directory-button').first().waitFor();
   await page.evaluate(async()=>{for(const img of document.images)img.loading='eager';await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
  }
  async function settle(){await page.evaluate(()=>new Promise(r=>{let n=0;function f(){if(++n===8)r();else requestAnimationFrame(f);}requestAnimationFrame(f);}));}
  async function go(locale,id) {
   const button=page.locator(`[data-locale-button="${locale}"]`);
   if(await button.isVisible())await button.click();
   await page.locator('.directory-button').first().click();
   await page.locator(`#introbook-directory [data-directory-slide="${id}"]`).click();await settle();
  }
  // Compare equally embedded resources: local-file vs data URI icon rasterization can differ.
  const raw=path.resolve(`outputs/standard-web/${brand}-introbook-online-20261019.html`),baseline=new Map(),architectureBaseline=new Map();
  const navReportFile=path.resolve(`.work/official-template-nav-v2/${brand}-report.json`);
  const previousNavigation=process.env.INTROBOOK_REUSE_NAV?await readJson(navReportFile):null;
  if(previousNavigation)assert.equal(previousNavigation.adaptation.htmlSha256,sha(await fs.readFile(input)));
  const resources=async file=>{const h=await fs.readFile(file,'utf8');return parse(h).nodes.flatMap(n=>n.tag==='style'?[sha(h.slice(n.openEnd,n.closeStart))]:n.tag==='img'?[sha(n.attrs.src)]:[]);};
  assert.deepEqual(await resources(input),await resources(raw),'CSS and image bytes must remain identical');
  async function geometry(id) {
   return page.locator(`#${id} .slide-canvas`).evaluate(canvas=>{
    const base=canvas.getBoundingClientRect();
    const rect=e=>{const r=e.getBoundingClientRect();return [r.x-base.x,r.y-base.y,r.width,r.height].map(v=>Math.round(v*32)/32);};
    return {objects:[...canvas.querySelectorAll('.ppt-element,.company-page-title,p,h2,h3,img')].map(e=>({tag:e.tagName,rect:rect(e),text:e.tagName==='IMG'?'':e.textContent})),icons:[...canvas.querySelectorAll('img,svg,[data-align-role="icon"]')].map(rect)};
   });
  }
  async function normalizedArchitecture(id) {
   const viewport=page.viewportSize();await page.setViewportSize({width:1920,height:1080});await settle();
   const canvas=page.locator(`#${id} .slide-canvas`);
   const original=await canvas.getAttribute('style');
   const toolbarVisibility=await page.locator('.top-toolbar').evaluate(e=>e.style.visibility);
   await canvas.evaluate(e=>{Object.assign(e.style,{position:'fixed',left:'0px',top:'0px',width:'1600px',height:'900px',transform:'none',zIndex:'2147483647'});document.querySelector('.top-toolbar').style.visibility='hidden';window.dispatchEvent(new Event('resize'));});
   await settle();const shot=await canvas.screenshot();
   await canvas.evaluate((e,style)=>{if(style===null)e.removeAttribute('style');else e.setAttribute('style',style);},original);
   await page.locator('.top-toolbar').evaluate((e,value)=>e.style.visibility=value,toolbarVisibility);
   await page.setViewportSize(viewport);await settle();return shot;
  }
  async function sameCanvas(shot,id,label,strict=false) {
   assert.deepEqual((await geometry(id)).objects,baseline.get(id).geometry.objects,`${brand} ${label} layout or text changed`);
   if(strict) {
    const controlled=await normalizedArchitecture(id);
    await fs.writeFile(path.join(output,`${brand}-${id}-architecture-normalized-current.png`),controlled);
    assert(controlled.equals(architectureBaseline.get(id)),`${brand} ${label} architecture differs on normalized 1600x900 canvas`);
   }
   if(shot.equals(baseline.get(id).shot))return;
   const baseFile=path.join(output,`${brand}-${id}-comparison-base.png`),currentFile=path.join(output,`${brand}-${id}-comparison-current.png`);
   await fs.writeFile(baseFile,baseline.get(id).shot);await fs.writeFile(currentFile,shot);
   const {stdout}=await execute(process.env.INTROBOOK_PYTHON??'python3',['-c',`from PIL import Image,ImageChops
from PIL import ImageDraw
import json,sys
d=ImageChops.difference(Image.open(sys.argv[1]).convert('RGB'),Image.open(sys.argv[2]).convert('RGB'))
mask=Image.new('L',d.size,255)
draw=ImageDraw.Draw(mask)
for x,y,w,h in json.loads(sys.argv[3]):draw.rectangle((x-2,y-2,x+w+2,y+h+2),fill=0)
outside=Image.composite(d,Image.new('RGB',d.size),mask)
print(json.dumps({'maxChannelDelta':max(v[1] for v in d.getextrema()),'outsideIconMaxDelta':max(v[1] for v in outside.getextrema()),'bounds':d.getbbox()}))`,baseFile,currentFile,JSON.stringify(baseline.get(id).geometry.icons)]);
   const difference=JSON.parse(stdout);
   // The visible deck can rasterize tiny glyph edges differently after horizontal scrolling.
   // Architecture is additionally compared pixel-for-pixel on a controlled canvas above.
   rasterizationDifferences.push({id,label,...difference});
  }
  // Compare every rendered canvas with the original in the same browser and font environment.
  for(const file of process.env.INTROBOOK_NAV_ONLY?[]:[raw,input]) {
   await ready(file);
   for(const locale of ['zh','en']) {
    for(const n of process.env.INTROBOOK_FAST_CHECK?[4,5,6,7,8,9,10,11,12]:Array.from({length:27},(_,i)=>i+1)) {
     const id=`slide-${locale}-${n}`;await go(locale,id);
     const canvas=page.locator(`#${id} .slide-canvas`),shot=await canvas.screenshot();
     if(file===raw){baseline.set(id,{shot,geometry:await geometry(id)});await fs.writeFile(path.join(output,`${brand}-${locale}-${n}-raw.png`),shot);if(n===11){const controlled=await normalizedArchitecture(id);architectureBaseline.set(id,controlled);await fs.writeFile(path.join(output,`${brand}-${id}-architecture-normalized-source.png`),controlled);}}
     else {await fs.writeFile(path.join(output,`${brand}-${locale}-${n}.png`),shot);await sameCanvas(shot,id,id,n===11);}
    }
    console.log(JSON.stringify({brand,stage:file===raw?'original canvases':'adapted canvases match',locale,pages:process.env.INTROBOOK_FAST_CHECK?9:27}));
   }
  }
  const viewports=[];
  for(const [width,height] of previousNavigation?[]:[[1920,1080],[1280,720],[390,844]]) {
   await ready(input,width,height);
   for(const locale of ['zh','en']) {
    await go(locale,`slide-${locale}-3`);
    const slide=page.locator(`#slide-${locale}-3`),trigger=slide.locator('[data-module-trigger="worksheet"]');
    await trigger.click();assert.equal(await slide.locator('[data-module-screen]').getAttribute('data-active-module'),'worksheet');
    await go(locale,`slide-${locale}-11`);assert.equal((await page.locator('[data-deck-position]').textContent()).trim(),'11 / 27');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   }
   await page.screenshot({path:path.join(output,`${brand}-${width}.png`)});viewports.push({width,height,moduleSwitch:true,navigation:true});
  }
  // Exercise both case layouts ahead of product pages so all source layout identities shift.
  const variants=[];
  for(const locale of ['zh','en','bilingual']) {
   const workdir=path.join(output,`${brand}-${locale}`),wanted=locale==='bilingual'?['zh','en']:[locale];
   await prepare({template:template.dir,workdir,request:{brand,industry:'内部版式测试',scenarios:['测试'],locale}});
   const sources=[{id:'cases:layout-fixture',kind:'cases',rowId:'layout-fixture',appId:config.cases.appId,worksheetId:config.cases.worksheetId,statusKey:config.cases.publicStatusKey,status:config.cases.publicStatusName,brand,title:'SYNTHETIC LAYOUT TEST ONLY',publicUrl:'https://www.mingdao.com/case/001',body:[{text:'Synthetic layout test only; no customer claims.'}],verifiedAt:new Date().toISOString()}];
   const changes={pages:[],remove:[],add:[],gaps:['INTERNAL SYNTHETIC LAYOUT TEST; NOT A CUSTOMER DELIVERABLE']};
   for(const l of wanted) {
    changes.remove.push(...[16,18,20].map(n=>`p-${l}-${n}`));
    for(const n of [14,15]) {
     const rule=policy.pages.find(p=>p.id===`p-${l}-${n}`);
     const values=Object.fromEntries(rule.editable.map(s=>[s,{text:l==='zh'?'版式测试':'Layout test'}]));
     changes.add.push({templatePageId:rule.id,newPageId:`test-${l}-${n}`,afterPageId:n===14?`p-${l}-2`:`test-${l}-14`,values,sourceIds:['cases:layout-fixture']});
    }
   }
   await apply({workdir,changes,sources});const validation=await validate(workdir);assert.equal(validation.pages,26*wanted.length);
   const priorVariant=previousNavigation?.variants.find(v=>v.locale===locale);
   if(priorVariant)assert.equal(validation.sha256,priorVariant.sha256,'Navigation evidence must describe this exact HTML');
   const checks=priorVariant?priorVariant.checks:[];
   for(const [width,height] of priorVariant?[]:[[1920,1080],[1280,720],[390,844]]) {
    await ready(path.join(workdir,'index.html'),width,height);
    if(locale!=='bilingual') {
     assert.equal(await page.locator('[data-locale-button]:visible').count(),0);
     assert.equal(await page.locator('[data-locale-deck]:not([hidden])').getAttribute('data-locale-deck'),locale);
    }
    for(const l of wanted) {
     await go(l,`test-${l}-14-slide-${l}-14`);
     assert.equal((await page.locator('[data-deck-position]').textContent()).trim(),'3 / 26');
     assert.equal(await page.locator('#introbook-directory .directory-item').count(),26);
     const title=await page.locator('[data-directory-slide][aria-current="page"]').textContent();assert.match(title,/版式测试|Layout test/);
     const canvas=page.locator(`[data-page-id="test-${l}-14"] .slide-canvas`);
     assert.match(await canvas.getAttribute('aria-labelledby'),new RegExp(`^test-${l}-14-`));
     await go(l,`slide-${l}-3`);const modules=page.locator(`#slide-${l}-3`);
     await modules.locator('[data-module-trigger="worksheet"]').click();assert.equal(await modules.locator('[data-module-screen]').getAttribute('data-active-module'),'worksheet');
     await go(l,`slide-${l}-11`);assert.equal((await page.locator('[data-deck-position]').textContent()).trim(),'13 / 26');
     await go(l,`slide-${l}-24`);assert.equal((await page.locator('[data-deck-position]').textContent()).trim(),'23 / 26');
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    checks.push({width,height,navigation:true,moduleSwitch:true,language:true});
   }
   // All unaffected product canvases remain identical even after changing their positions.
   await ready(path.join(workdir,'index.html'));
   for(const l of process.env.INTROBOOK_NAV_ONLY?[]:wanted)for(let n=4;n<=12;n++) {
    const id=`slide-${l}-${n}`;await go(l,id);
    await sameCanvas(await page.locator(`#${id} .slide-canvas`).screenshot(),id,`${locale} shifted ${id}`,n===11);
   }
   variants.push({locale,pages:validation.pages,sha256:validation.sha256,checks,shiftedProductCanvasesVerified:!process.env.INTROBOOK_NAV_ONLY});
   console.log(JSON.stringify({brand,stage:'add/remove variant passed',locale,pages:validation.pages}));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  // Contact sheets for actual visual inspection of all adapted pages.
  for(const l of process.env.INTROBOOK_FAST_CHECK||process.env.INTROBOOK_NAV_ONLY?[]:['zh','en']) {
   const sheet=path.join(output,`${brand}-${l}-contact.html`);
   await fs.writeFile(sheet,`<!doctype html><style>body{margin:0;display:grid;grid-template-columns:repeat(3,320px);gap:4px;background:#dce4eb;font:12px Arial}figure{margin:0;background:white}img{width:320px;height:180px}figcaption{padding:4px}</style>${Array.from({length:27},(_,i)=>`<figure><img src="${brand}-${l}-${i+1}.png"><figcaption>${brand} ${l} P${i+1}</figcaption></figure>`).join('')}`);
   const sheetPage=await context.newPage();await sheetPage.setViewportSize({width:968,height:900});await sheetPage.goto(pathToFileURL(sheet).href);await sheetPage.screenshot({path:path.join(output,`${brand}-${l}-contact.png`),fullPage:true});await sheetPage.close();
  }
  reports.push({brand,adaptation:await readJson(path.join(adapted,'adaptation.json')),canvasesCompared:baseline.size,allSourceCanvasGeometryAndTextMatched:baseline.size===54,architectureNormalizedPixelIdentical:architectureBaseline.size===2,architectureReviewCanvas:{width:1600,height:900},visualReviewPending:true,unchangedImageBytesAndGeometryChecked:true,rasterizationDifferences,viewports:previousNavigation?previousNavigation.viewports:viewports,variants,...(previousNavigation?{navigationEvidenceSha256:sha(await fs.readFile(navReportFile))}:{}),networkRequests:network.length,pageErrors:errors});
  await fs.writeFile(path.join(output,`${brand}-report.json`),JSON.stringify(reports.at(-1),null,2));
  await context.close();
 }
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(reports,null,2));
} finally {await browser.close();}
