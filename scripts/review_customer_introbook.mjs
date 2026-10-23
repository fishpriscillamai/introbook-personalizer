#!/usr/bin/env node
// Browser evidence for a generated work copy; human/agent content and visual review follows.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {loadRun,validate} from '../skills/introbook-personalizer/scripts/core.mjs';
import {pageNodes,inventory} from '../skills/introbook-personalizer/scripts/html.mjs';

const workdir=path.resolve(process.argv[2]);
const output=path.resolve(process.argv[3]??path.join(workdir,'browser-review'));
const checked=await validate(workdir),{t,run}=await loadRun(workdir);
const html=await fs.readFile(path.join(workdir,'index.html'),'utf8'),book=inventory(html);
const sourcePages=pageNodes(t.html),currentPages=pageNodes(html);
const protectedPages=t.policy.pages.filter(p=>p.mode==='locked'&&book.some(b=>b.id===p.id));
for(const rule of protectedPages) {
 const before=sourcePages.find(p=>p.attrs['data-page-id']===rule.id),after=currentPages.find(p=>p.attrs['data-page-id']===rule.id);
 assert.equal(t.html.slice(before.openEnd,before.closeStart),html.slice(after.openEnd,after.closeStart),`Protected content changed: ${rule.id}`);
 const stable=attrs=>Object.fromEntries(Object.entries(attrs).filter(([k])=>!['data-slide','aria-label'].includes(k)));
 assert.deepEqual(stable(before.attrs),stable(after.attrs));
}
await fs.mkdir(output,{recursive:true});
const {chromium}=await import(pathToFileURL(path.join(process.env.INTROBOOK_PLAYWRIGHT_DIR,'index.mjs')).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.INTROBOOK_BROWSER_EXECUTABLE});
const report={htmlSha256:checked.sha256,pages:book.length,protectedPageBodiesIdentical:protectedPages.map(p=>p.id),viewports:[],screenshots:[],partnerSubtitles:[],potentialTextOverflow:[],manualReviewPending:true};
try {
 const context=await browser.newContext({offline:true,locale:run.request.locale==='en'?'en-US':'zh-CN',reducedMotion:'reduce'});
 const page=await context.newPage(),network=[],errors=[];
 context.on('request',r=>{if(/^https?:/i.test(r.url()))network.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 // Source navigation settles after 180 ms, then schedules two typography frames.
 const settle=()=>page.evaluate(()=>new Promise(resolve=>{let n=0;function frame(){if(++n===20)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);}));
 async function ready(file,width,height) {
  await page.setViewportSize({width,height});await page.goto(pathToFileURL(file).href);
  await page.locator('.directory-button').first().waitFor();
  await page.evaluate(async()=>{for(const img of document.images)img.loading='eager';await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
 }
 async function go(id) {
  const p=page.locator(`[data-page-id="${id}"]`),locale=await p.getAttribute('data-page-locale');
  const control=page.locator(`[data-locale-button="${locale}"]`);if(await control.isVisible())await control.click();
  const htmlId=await p.getAttribute('id');await page.locator('.directory-button').first().click();
  await page.locator(`[data-directory-slide="${htmlId}"]`).click();await settle();
 }
 async function architectureShot(id) {
  const canvas=page.locator(`[data-page-id="${id}"] .slide-canvas`);
  await canvas.evaluate(e=>{Object.assign(e.style,{position:'fixed',left:'0px',top:'0px',width:'1600px',height:'900px',transform:'none',zIndex:'2147483647'});document.querySelector('.top-toolbar').style.visibility='hidden';window.dispatchEvent(new Event('resize'));});
  await settle();return canvas.screenshot();
 }
 const architectures=t.book.filter(p=>p.role==='architecture'&&book.some(b=>b.id===p.id));
 for(const p of architectures) {
  await ready(path.join(workdir,'baseline/index.html'),1920,1080);await go(p.id);const original=await architectureShot(p.id);
  await ready(path.join(workdir,'index.html'),1920,1080);await go(p.id);const current=await architectureShot(p.id);
  await fs.writeFile(path.join(output,`${p.id}-architecture-source.png`),original);await fs.writeFile(path.join(output,`${p.id}-architecture-output.png`),current);
  assert(original.equals(current),`Architecture changed on normalized canvas: ${p.id}`);
 }
 report.architectureNormalizedPixelIdentical=true;
 for(const [width,height] of [[1920,1080],[1280,720],[390,844]]) {
  await ready(path.join(workdir,'index.html'),width,height);
  const selected=width===1280?book:book.filter(p=>/^p-(zh|en)-(1|3|12)$/.test(p.id)||p.role==='architecture'||p.role==='case'||p===book.at(-1));
  for(const p of selected) {
   await go(p.id);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const position=(await page.locator('[data-deck-position]').textContent()).trim(),localeBook=book.filter(b=>b.locale===p.locale),number=localeBook.findIndex(b=>b.id===p.id)+1;
   assert.equal(position,`${number} / ${localeBook.length}`);
   assert.equal(await page.locator('#introbook-directory .directory-item').count(),localeBook.length);
   const company=await page.locator(`[data-page-id="${p.id}"]`).evaluate(root=>{
    const subtitle=root.querySelector('[data-partner-company]');if(!subtitle)return null;
    const title=root.querySelector(`[data-slot-id="${root.dataset.directoryTitleSlot}"]`),flow=root.querySelector(`[data-slot-id="${root.dataset.pageLocale==='en'?'s-66':'s-32'}"]`);
    const a=title.getBoundingClientRect(),b=subtitle.getBoundingClientRect(),c=flow.getBoundingClientRect();
    return {company:subtitle.textContent,flowTitle:flow.textContent,titleBottom:a.bottom,companyTop:b.top,companyBottom:b.bottom,flowTop:c.top};
   });
   if(company){assert(company.titleBottom<=company.companyTop&&company.companyBottom<=company.flowTop,`Partner subtitle overlaps title or flow label: ${p.id}`);report.partnerSubtitles.push({pageId:p.id,width,...company});}
   const file=`${String(number).padStart(2,'0')}-${p.id}-${width}.png`;
   await page.locator(`[data-page-id="${p.id}"] .slide-canvas`).screenshot({path:path.join(output,file)});
   report.screenshots.push({pageId:p.id,width,file});
   if(width===1280) {
    const overflow=await page.locator(`[data-page-id="${p.id}"]`).evaluate(root=>[...root.querySelectorAll('[data-slot-id]')].flatMap(e=>{
     if(e.tagName==='IMG'||!e.textContent.trim())return[];
     const box=e.closest('.ppt-element');if(!box)return[];
     const range=document.createRange();range.selectNodeContents(e);const r=range.getBoundingClientRect(),b=box.getBoundingClientRect();
     return r.left<b.left-1||r.right>b.right+1||r.bottom>b.bottom+2?[{slot:e.dataset.slotId,text:e.textContent.trim(),textBounds:{x:r.x,y:r.y,width:r.width,height:r.height},boxBounds:{x:b.x,y:b.y,width:b.width,height:b.height}}]:[];
    }));
    report.potentialTextOverflow.push(...overflow.map(o=>({pageId:p.id,...o})));
   }
  }
  await go(book.find(p=>/^p-(zh|en)-3$/.test(p.id))?.id??book[0].id);
  const module=page.locator('[data-locale-deck]:not([hidden]) [aria-current="page"] [data-module-trigger="worksheet"]');
  if(await module.count()){await module.click();assert.equal(await page.locator('[data-locale-deck]:not([hidden]) [aria-current="page"] [data-module-screen]').getAttribute('data-active-module'),'worksheet');}
  if(run.request.locale!=='bilingual')assert.equal(await page.locator('[data-locale-button]:visible').count(),0);
  report.viewports.push({width,height,pagesChecked:selected.length,navigation:true,moduleSwitch:true,horizontalOverflow:false,imagesDecoded:true});
  console.log(JSON.stringify({width,height,pagesChecked:selected.length}));
 }
 assert.deepEqual(network,[]);assert.deepEqual(errors,[]);report.networkRequests=network.length;report.pageErrors=errors;
 const shots=report.screenshots.filter(s=>s.width===1280);
 const sheet=path.join(output,'contact.html');
 await fs.writeFile(sheet,`<!doctype html><meta charset="utf-8"><style>body{margin:0;display:grid;grid-template-columns:repeat(3,400px);gap:4px;background:#dce4eb;font:12px Arial}figure{margin:0;background:#fff}img{width:400px;height:225px;display:block}figcaption{padding:5px}</style>${shots.map((s,n)=>`<figure><img src="${s.file}"><figcaption>P${n+1} ${s.pageId}</figcaption></figure>`).join('')}`);
 await page.setViewportSize({width:1208,height:900});await page.goto(pathToFileURL(sheet).href);await page.screenshot({path:path.join(output,'contact.png'),fullPage:true});
 await context.close();
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:true,pages:book.length,htmlSha256:checked.sha256,potentialTextOverflow:report.potentialTextOverflow.length,evidence:output,manualReviewPending:true}));
} finally {await browser.close();}
