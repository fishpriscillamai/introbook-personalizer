#!/usr/bin/env node
// Verify archived website files and their self-contained copies without changing either.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(pathToFileURL(path.join(process.env.INTROBOOK_PLAYWRIGHT_DIR,'index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.INTROBOOK_BROWSER_EXECUTABLE?{executablePath:process.env.INTROBOOK_BROWSER_EXECUTABLE}:{})});
const dir=path.resolve('.work/web-intake/visual');await fs.mkdir(dir,{recursive:true});
const reports=[];
try {
 for(const brand of process.argv.length>2?process.argv.slice(2):['mingdao','nocoly']) {
  if(!['mingdao','nocoly'].includes(brand)) throw Error('Unknown source brand');
  const context=await browser.newContext({offline:true,locale:'zh-CN',reducedMotion:'reduce'});
  const network=[],errors=[];
  context.on('request',r=>{if(/^https?:/i.test(r.url()))network.push(r.url());});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(15000);
  const raw=path.resolve(`materials/web-sources/2026-10-19/${brand}/index.html`),single=path.resolve(`outputs/standard-web/${brand}-introbook-online-20261019.html`);
  async function ready(file,width=1280,height=720) {
   await page.setViewportSize({width,height});await page.goto(pathToFileURL(file).href);
   await page.locator('.directory-button').first().waitFor();
   await page.evaluate(async()=>{
    for(const img of document.images) img.loading='eager';
    await Promise.race([
     (async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode()));})(),
     new Promise((_,reject)=>setTimeout(()=>reject(Error('Image/font decoding exceeded 20 seconds')),20000)),
    ]);
   });
  }
  async function go(locale,number) {
   await page.locator(`[data-locale-button="${locale}"]`).click();
   await page.locator('.directory-button').first().click();
   await page.locator(`#introbook-directory [data-directory-slide="slide-${locale}-${number}"]`).click();
   await page.evaluate(()=>new Promise(resolve=>{
    let frames=0;function settle(){if(++frames>=8)resolve();else requestAnimationFrame(settle);}requestAnimationFrame(settle);
   }));
  }
  console.log(JSON.stringify({brand,stage:'checking raw source and all lazy images'}));
  await ready(raw,1920,1080);await go('zh',11);
  const architecture=await page.locator('#slide-zh-11 .slide-canvas').screenshot({path:path.join(dir,`${brand}-architecture-raw.png`)});
  await ready(single,1920,1080);await go('zh',11);
  const offlineArchitecture=await page.locator('#slide-zh-11 .slide-canvas').screenshot({path:path.join(dir,`${brand}-architecture.png`)});
  assert(architecture.equals(offlineArchitecture),`${brand} architecture changed while bundling`);
  const viewports=[];
  for(const [width,height] of [[1920,1080],[1280,720],[390,844]]) {
   await ready(single,width,height);
   for(const locale of ['zh','en']) {
    await go(locale,11);assert.match(await page.locator('[data-deck-position]').textContent(),/11\s*\/\s*27/);
    await page.locator('.directory-button').first().click();assert.equal(await page.locator('#introbook-directory .directory-item').count(),27);await page.keyboard.press('Escape');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
   }
   await page.screenshot({path:path.join(dir,`${brand}-${width}.png`)});
   viewports.push({width,height,locales:['zh','en'],navigation:true,imagesDecoded:true});
  }
  console.log(JSON.stringify({brand,stage:'capturing all 54 pages'}));
  await ready(single,960,540);
  for(const locale of ['zh','en']) {
   const screenshots=[];
   for(let n=1;n<=27;n++) {await go(locale,n);const file=`${brand}-${locale}-${n}.png`;await page.locator(`#slide-${locale}-${n} .slide-canvas`).screenshot({path:path.join(dir,file)});screenshots.push(file);}
   const contact=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;display:grid;grid-template-columns:repeat(3,320px);font:12px Arial;background:#dce4eb;gap:4px}figure{margin:0;background:#fff}img{width:320px;height:180px;display:block}figcaption{padding:4px}</style></head><body>${screenshots.map((file,i)=>`<figure><img src="${file}"><figcaption>${brand} ${locale} P${i+1}</figcaption></figure>`).join('')}</body></html>`;
   const html=path.join(dir,`${brand}-${locale}-contact.html`);await fs.writeFile(html,contact);
   const montage=await context.newPage();await montage.setViewportSize({width:968,height:900});await montage.goto(pathToFileURL(html).href);
   await montage.screenshot({path:path.join(dir,`${brand}-${locale}-contact.png`),fullPage:true});await montage.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  reports.push({brand,source:raw,offlineCopy:single,pagesPerLocale:27,locales:['zh','en'],capturedPages:54,viewports,architecturePixelIdentical:true,networkRequests:network.length,pageErrors:errors});
  console.log(JSON.stringify({brand,checked:true,capturedPages:54,architecturePixelIdentical:true}));
  await context.close();
 }
 let previous=[];try{previous=JSON.parse(await fs.readFile(path.join(dir,'report.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const report of reports)await fs.writeFile(path.join(dir,`${report.brand}-report.json`),JSON.stringify(report,null,2));
 const combined=[...new Map([...previous,...reports].map(r=>[r.brand,r])).values()];
 await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(combined,null,2));
}finally{await browser.close();}
