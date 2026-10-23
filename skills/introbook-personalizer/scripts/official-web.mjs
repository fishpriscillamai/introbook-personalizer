// Adapt the reviewed 2026-10-19 official HTML snapshots without changing source assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parse, patches, attrPatch, annotate, inventory} from './html.mjs';
import {bundleHtml, inside} from './resources.mjs';
import {sha, classify} from './core.mjs';

const REVIEWED_SOURCE={
  mingdao:'4ca531caba48315f62219b6cbd119fd8bf64340884ad65bf1601a7462ddeb27a',
  nocoly:'2df5a5995160c193a351e03740f90a0629923e1131be733cf25cffd2921fa062',
};

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw Error(`Unsupported official script structure: ${before.slice(0,80)}`);
  return text.replace(before, () => after);
}

export function adaptInteractions(source) {
  let js=source;
  const titleMatch=/  const titles = (\{[\s\S]*?\n  \});/.exec(js);
  if (!titleMatch) throw Error('Official directory titles are missing');
  // The strings are copied into page metadata by the caller, never evaluated as code.
  const titles=Object.fromEntries(['zh','en'].map(l=>{
    const row=new RegExp(`${l}: \\[([^\\n]+)\\]`).exec(titleMatch[1]);
    if(!row)throw Error('Unsupported title list');
    const items=[...row[1].matchAll(/'([^']*)'/g)].map(m=>m[1]);
    if(items.length!==27)throw Error('Expected the reviewed 27-page source');
    return [l,items];
  }));
  js=js.replace(titleMatch[0],'');
  js=replaceOnce(js,"slides: [...deck.querySelectorAll('[data-slide]')],","slides: [...deck.querySelectorAll('[data-page-id]')],");
  js=replaceOnce(js,'  const previousButton =',`  for (const [locale, state] of decks) if (!state.slides.length) { state.deck.remove(); decks.delete(locale); }
  if (!decks.size) return;
  const previousButton =`);
  js=replaceOnce(js,"  let activeLocale = 'en';","  let activeLocale = decks.has('en') ? 'en' : [...decks.keys()][0];");
  js=js.replaceAll('slide.dataset.slide','slide.dataset.sourceSlide').replaceAll('item.dataset.slide','item.dataset.sourceSlide').replaceAll("?.dataset.slide !== '10'","?.dataset.sourceSlide !== '10'");
  js=replaceOnce(js,`const objectById = (deck, id) => deck.querySelector('[data-object-id="' + id + '"]');`,
    `const objectById = (deck, id) => deck.querySelector('[data-source-object-id="' + id + '"]');`);
  js=replaceOnce(js,'    const targetIndex = activeIndex;','    const targetIndex = Math.min(activeIndex, nextState.slides.length - 1);');
  js=replaceOnce(js,"  for (const button of localeButtons) {\n    button.addEventListener",`  for (const button of localeButtons) {
    button.hidden = decks.size < 2 || !decks.has(button.dataset.localeButton);
    button.disabled = !decks.has(button.dataset.localeButton);
    if (button.hidden) button.remove();
    button.addEventListener`);
  const initialLocale=/  showLocale\([^\n]+\);/.exec(js)?.[0];
  if(!initialLocale)throw Error('Missing initial locale selection');
  js=replaceOnce(js,initialLocale,`${js.includes('const preferredLanguage =')?'':"  const preferredLanguage = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase();\n"}  const preferredLocale = preferredLanguage.startsWith('zh') ? 'zh' : 'en';
  showLocale(decks.has(preferredLocale) ? preferredLocale : [...decks.keys()][0]);`);
  js=replaceOnce(js,'      for (const [index, slide] of decks.get(activeLocale).slides.entries()) {\n        if ([0,12,23].includes(index)) {',
    `      let previousGroup = null;
      for (const [index, slide] of decks.get(activeLocale).slides.entries()) {
        const group = Number(slide.dataset.directoryGroup);
        if (group !== previousGroup) {
          previousGroup = group;`);
  js=replaceOnce(js,'groups[index === 0 ? 0 : index === 12 ? 1 : 2]','groups[group]');
  js=replaceOnce(js,"        title.textContent = titles[activeLocale][index] || slide.querySelector('.slide-canvas').getAttribute('aria-label');",
    `        const titleSlot = slide.dataset.directoryTitleSlot;
        title.textContent = (titleSlot && slide.querySelector('[data-slot-id="' + titleSlot + '"]')?.textContent.trim())
          || slide.dataset.directoryTitle || slide.dataset.pageId;`);
  if(/(?:slide|item)\.dataset\.slide\b|titles\[activeLocale\]\[index\]/.test(js))throw Error('Positional source dependency remains');
  return {js,titles};
}

const PRODUCT_SLOTS={
  zh:{1:['s-2','s-3'],3:['s-2','s-5','s-8','s-14','s-17','s-23','s-25'],4:['s-3','s-16','s-17','s-20'],5:['s-8']},
  en:{1:['s-2','s-3'],3:['s-2','s-3','s-6','s-7','s-10','s-11','s-18','s-19','s-22','s-23','s-30','s-32','s-33'],4:['s-3','s-16','s-17','s-20'],5:['s-8']},
};
const CASE_SCAFFOLD=/^(?:0[1-4]|应用场景|核心成果|SCENARIO|KEY ACHIEVEMENT)$/;
export function officialPolicy(book,brand) {
  return classify(book,{pages:book.map(p=>{
    const number=Number(p.id.split('-').at(-1));
    if(number>=14&&number<=23)return {id:p.id,mode:'replaceable',reason:'Reviewed case layout: replace every customer-specific text/image; retain only step numbers and generic column labels.',editable:p.slots.filter(s=>s.kind==='image'||!CASE_SCAFFOLD.test(s.text)).map(s=>s.id)};
    const editable=brand==='nocoly'&&p.locale==='zh'&&number===5?['s-7']:PRODUCT_SLOTS[p.locale][number];
    return {id:p.id,mode:editable?'partial':'locked',editable:editable??[],reason:editable?'Reviewed business explanation slots only; product modules, metrics, security, architecture and images remain fixed.':'Preserve standard product, company, brand and evidence facts in full.'};
  })});
}

export async function adaptOfficialWeb({input,root=path.dirname(input),brand,output}) {
  if(!['mingdao','nocoly'].includes(brand))throw Error('Choose mingdao or nocoly');
  input=await inside(root,input);
  const source=await fs.readFile(input,'utf8');
  if(sha(source)!==REVIEWED_SOURCE[brand])throw Error('This source version needs a fresh page/slot review before adaptation');
  const archive=JSON.parse(await fs.readFile(path.join(root,'fetch-manifest.json'),'utf8'));
  if(!archive.complete||archive.sourceUrl!==`https://www.${brand==='mingdao'?'mingdao':'nocoly'}.com/landing/intro/`)throw Error('Incomplete or different brand source archive');
  for(const file of archive.files) {
    const safe=await inside(root,path.resolve(root,file.path));
    if(sha(await fs.readFile(safe))!==file.sha256)throw Error(`Source dependency fingerprint mismatch: ${file.path}`);
  }
  const outputRelative=path.relative(await fs.realpath(root),path.resolve(output));
  if(!outputRelative||(!outputRelative.startsWith('..'+path.sep)&&outputRelative!=='..'&&!path.isAbsolute(outputRelative)))throw Error('Adaptation output must be outside the source archive');
  let html=annotate(source), {nodes}=parse(html);
  const script=nodes.find(n=>n.tag==='script'&&n.attrs.src);
  if(!script)throw Error('Official interaction script missing');
  const scriptFile=await inside(root,path.resolve(path.dirname(input),script.attrs.src));
  const originalJs=await fs.readFile(scriptFile,'utf8');
  const {js,titles}=adaptInteractions(originalJs);
  const book=inventory(html);
  if(book.length!==54||['zh','en'].some(l=>book.filter(p=>p.locale===l).length!==27))throw Error('Expected 27 pages per language');
  const edits=[];
  for(const p of book) {
    const page=nodes.find(n=>n.attrs['data-page-id']===p.id), number=Number(page.attrs['data-slide']);
    const isCase=number>=14&&number<=23;
    edits.push(attrPatch(page,'data-source-slide',String(number)),attrPatch(page,'data-page-role',number===11?'architecture':isCase?'case':'standard'),attrPatch(page,'data-directory-group',number<13?'0':number<24?'1':'2'));
    const children=nodes.filter(n=>n.start>page.start&&n.end<=page.end);
    if(isCase) {
      const title=number===15?p.slots.find(s=>/^(?:广汽本田：|GAC Honda:)/.test(s.text)):p.slots.find(s=>s.kind==='text');
      if(!title)throw Error(`Missing reviewed case heading ${p.id}`);
      edits.push(attrPatch(page,'data-directory-title-slot',title.id));
      const titleNode=children.find(n=>n.attrs['data-slot-id']===title.id), titleId=titleNode.attrs.id??`ib-title-${p.id}`;
      if(!titleNode.attrs.id)edits.push(attrPatch(titleNode,'id',titleId));
      const canvas=children.find(n=>/\bslide-canvas\b/.test(n.attrs.class??''));
      const label=canvas.attrEntries.find(a=>a.name==='aria-label');
      if(label)edits.push({start:label.start,end:label.end,value:''});
      edits.push(attrPatch(canvas,'aria-labelledby',titleId));
    } else edits.push(attrPatch(page,'data-directory-title',titles[p.locale][number-1]));
  }
  for(const n of nodes)if(n.attrs['data-object-id'])edits.push(attrPatch(n,'data-source-object-id',n.attrs['data-object-id']));
  // Merge metadata added at the same source offset.
  const merged=new Map();for(const e of edits){const k=`${e.start}:${e.end}`;if(merged.has(k)&&e.start===e.end)merged.get(k).value+=e.value;else merged.set(k,{...e});}
  html=patches(html,[...merged.values()]);
  // Bundle with original resources, substituting only the reviewed script in a fresh staging copy.
  await fs.mkdir(output,{recursive:false});
  const stage=path.join(output,'source');await fs.cp(root,stage,{recursive:true,errorOnExist:true,force:false});
  const relativeInput=path.relative(root,input),relativeScript=path.relative(root,scriptFile);
  await fs.writeFile(path.join(stage,relativeInput),html);
  await fs.writeFile(path.join(stage,relativeScript),js);
  const bundled=await bundleHtml(path.join(stage,relativeInput),stage);
  const policy=officialPolicy(inventory(bundled),brand);
  await fs.writeFile(path.join(output,'index.html'),bundled,{flag:'wx'});
  await fs.writeFile(path.join(output,'policy.json'),JSON.stringify(policy,null,2)+'\n',{flag:'wx'});
  const report={brand,sourceSha256:sha(source),sourceFilesVerified:archive.files.length,sourceScriptSha256:sha(originalJs),adaptedScriptSha256:sha(js),htmlSha256:sha(bundled),pages:book.length,modes:policy.pages.reduce((a,p)=>(a[p.mode]=(a[p.mode]??0)+1,a),{}),notes:['Source snapshot remains unchanged','Review browser render and case add/remove before registering']};
  await fs.writeFile(path.join(output,'adaptation.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return report;
}
