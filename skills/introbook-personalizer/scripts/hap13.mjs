import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parse,patches,pageNodes,inventory,escapeText,escapeAttr} from './html.mjs';
import {assertOffline} from './resources.mjs';
import {assertSource} from './knowledge.mjs';

const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
export const SOURCE_SHA='450622ca53b227e48f12aa528afe69f03989d7dc81424ea1057909c32c5f7225';
const REVIEWED_SOURCES=new Map([
  ['2ca6321a4c69aa08f035920c9b59a38d4ce83028b5cf71aec50c8374eb911add',{date:'2026-11-13',skip:'.en-legacy,.restored-content,style,script'}],
  ['d5b2b8a1c87123f4ce6a8cd54e3afd0bbca0f113bfdb47312c5b9df4472a4dd7',{date:'2026-11-16',version:'2026-11-16-hap13',skip:'.en-legacy,.intro-refresh,style,script'}],
  [SOURCE_SHA,{date:'2026-11-16',version:'2026-11-18-hap13',skip:'.en-legacy,.intro-refresh,style,script'}]
]);
export const ANCHOR='hap13-standard-16';
export const FIXED_EXAMPLES=['ex-mfg','ex-dist','ex-med','ex-edu'];
const id=i=>`hap13-standard-${String(i+1).padStart(2,'0')}`;
const slides=html=>parse(html).nodes.filter(n=>n.tag==='section'&&n.attrs.class?.split(/\s+/).includes('slide'));
function once(s,a,b){if(s.split(a).length!==2)throw Error('Unrecognized HAP13 source structure');return s.replace(a,b);}
function policyFor(){return {schemaVersion:1,engine:'hap13',insertionAnchor:ANCHOR,pages:Array.from({length:20},(_,i)=>({id:id(i),locale:'shared',mode:'locked',editable:[],reason:i>=8&&i<=11?'Fixed functional example: preserve whole page':'HAP13 standard content: preserve whole page'}))};}

export async function registerHap13({input,templates,version,brand='mingdao'}){
  if(brand!=='mingdao')throw Error('This HAP13 source is Mingdao only');
  const source=await fs.readFile(input,'utf8');
  const sourceSha256=sha(source),profile=REVIEWED_SOURCES.get(sourceSha256);
  if(!profile)throw Error('HAP13 source fingerprint is not a reviewed standard; review and register a new adapter');
  version??=profile.version??'2026-11-13-hap13-r2';
  if(!/^[\w.-]{1,80}$/.test(version)||version.includes('..'))throw Error('Invalid version');
  const original=slides(source);
  if(original.length!==20||FIXED_EXAMPLES.some((x,i)=>original[i+8].attrs.id!==x)||!original[15].attrs.class.split(/\s+/).includes('case-entry'))throw Error('HAP13 page map mismatch');
  let html=patches(source,original.map((p,i)=>({start:p.openEnd-1,end:p.openEnd-1,value:` data-page-id="${id(i)}" data-page-locale="shared" data-standard-index="${i}"`})));
  html=once(html,profile.skip,profile.skip.replace(',style,script',',[data-custom-lang],style,script'));
  html=once(html,"next==='en'?englishTitles[i]:originalTitles[i]","next==='en'?(s.dataset.standardIndex!==undefined?englishTitles[Number(s.dataset.standardIndex)]:s.dataset.englishTitle):originalTitles[i]");
  const init="let language='zh';try{language=localStorage.getItem('introbook-language')==='en'?'en':'zh'}catch(e){}";
  html=once(html,init,init+"\n  const outputLocale=document.documentElement.dataset.outputLocale||'bilingual';if(outputLocale!=='bilingual')language=outputLocale;");
  const policy=policyFor(), policyText=JSON.stringify(policy,null,2)+'\n';
  const layoutsText=await fs.readFile(fileURLToPath(new URL('../assets/hap13-layouts.json',import.meta.url)),'utf8');
  const layouts=JSON.parse(layoutsText);
  html=once(html,'</head>',`<style id="hap13-approved-layouts">${layouts.css}\n@media(max-width:620px){.bar{padding:0 8px;gap:4px}.bar .mid{position:static;left:auto;transform:none;gap:0;margin-left:auto}.bar .arr{width:28px;padding:0}.bar .cnt{min-width:48px;font-size:12px}.bar .lang-switch{margin-left:4px}.bar .header-brand{width:70px;max-width:70px;margin-left:4px}.bar .tb{padding:6px 8px;font-size:12px}}</style>\n</head>`);
  const standardContentSha256=original.map(p=>sha(source.slice(p.openEnd,p.closeStart)));
  const manifest={schemaVersion:1,engine:'hap13',brand,version,registeredAt:new Date().toISOString(),sourceFile:path.basename(input),sourceSha256,sourceDate:profile.date,templateSha256:sha(html),policySha256:sha(policyText),layoutsSha256:sha(layoutsText),standardContentSha256,locales:['zh','en'],pages:20,fixedExamples:FIXED_EXAMPLES,insertionAnchor:ANCHOR,approvedLayouts:['case-flow','partner-solution']};
  assertOffline(html,{allowInlineMp4:true});inventory(html);
  const dir=path.resolve(templates,brand,version);await fs.mkdir(path.dirname(dir),{recursive:true});await fs.mkdir(dir);
  for(const [name,content] of Object.entries({'index.html':html,'policy.json':policyText,'layouts.json':layoutsText,'manifest.json':JSON.stringify(manifest,null,2)+'\n'}))await fs.writeFile(path.join(dir,name),content,{flag:'wx'});
  return {dir,manifest,policy};
}
export async function loadHap13({dir,html,policy,manifest,book}){
  const text=await fs.readFile(path.join(dir,'layouts.json'),'utf8');
  if(sha(text)!==manifest.layoutsSha256||JSON.stringify(policy)!==JSON.stringify(policyFor())||!REVIEWED_SOURCES.has(manifest.sourceSha256))throw Error('HAP13 layout or protection policy was modified');
  assertStandardPages(html,manifest);assertOffline(html,{allowInlineMp4:true});
  return {html,policy,manifest,book,layouts:JSON.parse(text)};
}
export function assertStandardPages(html,manifest){
  const all=pageNodes(html),standard=all.filter(p=>p.attrs['data-standard-index']!==undefined);
  if(standard.length!==20)throw Error('All twenty HAP13 standard pages must remain');
  for(const [i,p] of standard.entries())if(p.attrs['data-page-id']!==id(i)||Number(p.attrs['data-standard-index'])!==i||sha(html.slice(p.openEnd,p.closeStart))!==manifest.standardContentSha256[i])throw Error(`Protected HAP13 content changed: ${id(i)}`);
}

const limits={category:34,title:100,subtitle:120,flowTitle:70,systemsLabel:22,processSummary:130,takeawayLabel:24,takeaway:200,company:100,exceptionLabel:30,exception:180,objects:150,audienceLabel:24,audienceTitle:80,audience:160};
const fields={
  'case-flow':['category','title','subtitle','flowTitle','systemsLabel','processSummary','takeawayLabel','takeaway','steps','systems','sections'],
  'partner-solution':['category','title','company','flowTitle','exceptionLabel','exception','objects','audienceLabel','audienceTitle','audience','takeawayLabel','takeaway','steps','features']
};
const plain=(v,max=100)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[<>\u0000]/.test(v))throw Error('Layout text must be short plain text');return v;};
function keys(o,wanted){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).length!==wanted.length||wanted.some(k=>!Object.hasOwn(o,k)))throw Error('Unknown or missing layout fields; footers and raw HTML are not supported');}
function sequence(value,count,fieldLimits){if(!Array.isArray(value)||value.length!==count)throw Error('Layout requires the approved number of items');value.forEach(v=>{keys(v,Object.keys(fieldLimits));for(const [k,max]of Object.entries(fieldLimits))plain(v[k],max);});}
function checkContent(c,layout){
  keys(c,fields[layout]);for(const [k,v]of Object.entries(c))if(limits[k])plain(v,limits[k]);
  sequence(c.steps,4,layout==='case-flow'?{title:30,detail:50}:{role:24,title:30,detail:50});
  if(layout==='case-flow'){
    if(!Array.isArray(c.systems)||c.systems.length<3||c.systems.length>5)throw Error('Use three to five systems');c.systems.forEach(s=>plain(s,20));
    sequence(c.sections,3,{label:24,title:60,text:150});
  }else sequence(c.features,2,{title:50,text:100});
}
const fill=(template,values)=>template.replace(/\{\{(\w+)\}\}/g,(_,k)=>{if(values[k]===undefined)throw Error(`Missing layout value ${k}`);return values[k];});
const safe=x=>escapeText(x).replace(/\n/g,'<br>');
function contentHtml(layout,c,spec){
  const v=Object.fromEntries(Object.entries(c).filter(([,x])=>typeof x==='string').map(([k,x])=>[k,safe(x)]));
  const part=(name,values)=>fill(spec.parts[name],Object.fromEntries(Object.entries(values).map(([k,x])=>[k,safe(String(x))])));
  v.steps=c.steps.map((x,i)=>part(layout==='case-flow'?'caseStep':'partnerStep',{...x,number:String(i+1).padStart(2,'0')})).join('');
  if(layout==='case-flow'){v.systems=c.systems.map(text=>part('system',{text})).join('');v.sections=c.sections.map(x=>part('section',x)).join('');}
  else v.features=c.features.map(x=>part('feature',x)).join('');
  return fill(spec.templates[layout],v);
}
function strings(o){return typeof o==='string'?[o]:Array.isArray(o)?o.flatMap(strings):o&&typeof o==='object'?Object.values(o).flatMap(strings):[];}
export function renderHap13(t,run,changes,sources){
  if(changes.pages.length||changes.remove.length)throw Error('HAP13 standard pages and four examples are locked; only add after page 16');
  const requested=run.request.locale==='bilingual'?['zh','en']:[run.request.locale];
  const ids=new Set(t.book.map(p=>p.id)),verified=new Map(sources.map(s=>[s.id,s]));
  if(verified.size!==sources.length)throw Error('Duplicate source IDs');
  let html=t.html,anchor=ANCHOR;
  for(const edit of changes.add){
    const allowed=['newPageId','afterPageId','layout','sourceIds','content','partnerCompany','companyNameIsTranslation'];
    if(Object.keys(edit).some(k=>!allowed.includes(k)))throw Error('Unknown addition field');
    if(!Object.hasOwn(fields,edit.layout))throw Error('Only case-flow and partner-solution are approved');
    if(typeof edit.newPageId!=='string'||!/^custom-[a-z0-9-]{1,70}$/.test(edit.newPageId)||ids.has(edit.newPageId))throw Error('Use a unique custom- page ID');
    if(edit.afterPageId!==anchor)throw Error('Insert contiguous new pages immediately after the original page 16');
    if(!Array.isArray(edit.sourceIds)||!edit.sourceIds.length)throw Error('Additions require verified source IDs');
    const kind=edit.layout==='case-flow'?'cases':'solutions';
    const evidence=edit.sourceIds.map(id=>{const s=verified.get(id);if(!s)throw Error(`Missing source ${id}`);assertSource(s,run.request,run.createdAt);if(s.kind!==kind)throw Error('Source kind does not match the layout');return s;});
    keys(edit.content,requested);for(const lang of requested)checkContent(edit.content[lang],edit.layout);
    if(kind==='solutions'){
      plain(edit.partnerCompany,80);
      if(!evidence.some(s=>s.partnerCompany===edit.partnerCompany&&s.body.some(p=>p.text.includes(edit.partnerCompany))))throw Error('Partner company must match verified public source');
      if(edit.content.zh&&edit.content.zh.company!==edit.partnerCompany)throw Error('Chinese partner subtitle must be the verified company name');
      if(edit.content.en&&edit.content.en.company!==edit.partnerCompany&&edit.companyNameIsTranslation!==true)throw Error('Record translated company names explicitly');
    }else if(edit.partnerCompany!==undefined||edit.companyNameIsTranslation!==undefined)throw Error('Company subtitle applies to partner solutions');
    const numbers=x=>x.match(/\d+(?:[.,]\d+)*(?:[%％])?/g)||[];
    const evidenceNumbers=new Set(evidence.flatMap(s=>s.body.flatMap(p=>numbers(p.text))));
    if(strings(edit.content).flatMap(numbers).some(n=>!evidenceNumbers.has(n)))throw Error('Case numbers must occur in verified source text');
    const first=edit.content.zh||edit.content.en;
    const fragment=`<section class="slide hap13-custom" data-page-id="${edit.newPageId}" data-page-locale="shared" data-title="${escapeAttr(first.title)}" data-english-title="${escapeAttr((edit.content.en||first).title)}" data-sec="客户案例">${requested.map(lang=>`<div data-custom-lang="${lang}">${contentHtml(edit.layout,edit.content[lang],t.layouts)}</div>`).join('')}</section>`;
    const after=pageNodes(html).find(p=>p.attrs['data-page-id']===anchor);
    html=html.slice(0,after.end)+'\n'+fragment+html.slice(after.end);ids.add(edit.newPageId);anchor=edit.newPageId;
  }
  html=html.replace(/<html\b/,`<html data-output-locale="${run.request.locale}"`);
  if(run.request.locale!=='bilingual')html=once(html,'</head>','<style>.lang-switch{display:none!important}</style></head>');
  assertStandardPages(html,t.manifest);inventory(html);assertOffline(html,{allowInlineMp4:true});return html;
}
