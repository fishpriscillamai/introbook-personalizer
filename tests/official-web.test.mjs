import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {adaptInteractions,officialPolicy} from '../skills/introbook-personalizer/scripts/official-web.mjs';
import {classify} from '../skills/introbook-personalizer/scripts/core.mjs';

test('reviewed case narrative can mention IT architecture; architecture diagrams stay locked',()=>{
  const page={id:'p-en-15',locale:'en',role:'case',title:'Customer story',text:'IT owns architecture and governance',slots:[{id:'s-1',kind:'text',text:'Customer story'}]};
  assert.equal(classify([page],{pages:[{id:page.id,mode:'replaceable'}]}).pages[0].mode,'replaceable');
  assert.equal(classify([{...page,role:'architecture'}],{pages:[{id:page.id,mode:'replaceable'}]}).pages[0].mode,'locked');
  assert.equal(classify([{...page,title:'System architecture'}],{pages:[{id:page.id,mode:'replaceable'}]}).pages[0].mode,'locked');
});
test('case layout step numbers stay fixed while all customer material must be replaced',()=>{
  const page={id:'p-en-17',locale:'en',role:'case',title:'Case',text:'Case',slots:['01','SCENARIO','Old customer','40%'].map((text,i)=>({id:`s-${i+1}`,kind:'text',text}))};
  const p=officialPolicy([page],'mingdao').pages[0];
  assert.deepEqual(p.editable,['s-3','s-4']);
});
for(const brand of ['mingdao','nocoly'])test(`${brand} official adapter preserves layout and module functions with stable identity`,async t=>{
  const name=brand==='mingdao'?'interactions.js':'interactions-brand-standardized.js';
  let source;try{source=await fs.readFile(new URL(`../materials/web-sources/2026-10-19/${brand}/assets/${name}`,import.meta.url),'utf8');}catch(e){if(e.code==='ENOENT'){t.skip('Archived official source not distributed in repository');return;}throw e;}
  const {js,titles}=adaptInteractions(source);
  assert.equal(titles.zh.length,27);assert.equal(titles.en.length,27);
  assert.match(js,/data-source-object-id/);assert.match(js,/dataset.sourceSlide/);
  assert.match(js,/data-module-trigger/);assert.match(js,/layoutFocusPageRhythm/);
  assert.match(js,/dataset.directoryTitleSlot/);assert.match(js,/decks.has\(preferredLocale\)/);
  assert.doesNotMatch(js,/(?:item|slide)\.dataset\.slide\b|titles\[activeLocale\]\[index\]/);
  assert.equal((js.match(/const preferredLanguage =/g)??[]).length,1);
  // Parse the resulting classic script without executing browser-specific code.
  assert.doesNotThrow(()=>new Function(js));
});

test('standard value-eight page is locked in both brands and languages',()=>{
  for(const brand of ['mingdao','nocoly'])for(const locale of ['zh','en']) {
    const page={id:`p-${locale}-12`,locale,role:'product',title:'HAP value',text:'Value',slots:[{id:'s-3',kind:'text',text:'Business explanation'}]};
    const rule=officialPolicy([page],brand).pages[0];
    assert.equal(rule.mode,'locked');assert.deepEqual(rule.editable,[]);
  }
});
