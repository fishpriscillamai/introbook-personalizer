import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, patches, attrPatch, annotate, inventory, pageNodes, escapeText } from './html.mjs';
import { bundleHtml, assertOffline, assetUri, inside } from './resources.mjs';
import { validateRequest, assertSource } from './knowledge.mjs';

export const sha = text => crypto.createHash('sha256').update(text).digest('hex');
export const readJson = async file => JSON.parse(await fs.readFile(file,'utf8'));
export async function json(file,value) { await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'}); }
const token = value => { if (typeof value !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,95}$/u.test(value) || value.includes('..')) throw Error('Use a short identifier without paths'); return value; };
const ARCH = /技术架构|系统架构|产品架构|平台架构|technical\s+architecture|system\s+architecture|platform\s+architecture|\barchitecture\b/i;
const FACT = /\d|认证|信创|安全|部署|技术|兼容|价格|员工|合作伙伴|荣誉|专利|certif|security|deployment|pricing|patent|copyright|iso\b|soc\s*2/i;
const MODES = ['locked','partial','rewrite','replaceable'];

export function classify(book, override = {pages:[]}) {
  const supplied = new Map();
  for (const p of override.pages ?? []) { if (supplied.has(p.id) || !book.some(b => b.id === p.id)) throw Error('Unknown/duplicate page policy'); supplied.set(p.id,p); }
  return { schemaVersion:1, pages:book.map(p => {
    const o = supplied.get(p.id);
    // Reviewed case narratives can mention IT architecture without being architecture diagrams.
    const architecture = p.role === 'architecture' || ARCH.test(p.title) || (p.role !== 'case' && ARCH.test(p.text));
    const casePage = /客户案例|案例概览|客户挑战|case study|customer case|customer challenges/i.test(p.title);
    let mode = o?.mode ?? (casePage ? 'replaceable' : /定位|能力|价值|平台|positioning|capabilit|platform|value/i.test(p.title) ? 'rewrite' : 'locked');
    if (!MODES.includes(mode)) throw Error(`Unknown page mode ${mode}`);
    if (architecture) mode = 'locked';
    let editable = o?.editable ?? (mode === 'replaceable' ? p.slots.map(s => s.id) : p.slots.filter(s => s.kind === 'text' && !FACT.test(s.text)).map(s => s.id));
    if (mode === 'locked') editable = [];
    for (const slotId of editable) {
      const s = p.slots.find(s => s.id === slotId);
      if (!s) throw Error(`Unknown slot ${p.id}/${slotId}`);
      if (mode !== 'replaceable' && (s.kind === 'image' || FACT.test(s.text))) throw Error(`Product fact/image slot cannot be unlocked: ${p.id}/${slotId}`);
    }
    if (new Set(editable).size !== editable.length) throw Error('Duplicate editable slots');
    const decorative = o?.decorative ?? [];
    if (decorative.some(id => !editable.includes(id) || p.slots.find(s => s.id === id)?.kind !== 'image')) throw Error('Only editable case images can be marked decorative');
    return { id:p.id, locale:p.locale, mode, reason:architecture ? 'Technical architecture: preserve whole page' : o?.reason ?? (mode === 'locked' ? 'Uncertain or factual content: preserve by default' : mode === 'replaceable' ? 'Customer evidence may be replaced using verified publication records' : 'Rewrite business language only; facts and visuals remain fixed'), editable, decorative };
  }) };
}

export async function register({input,root,templates,brand,version,locale='zh',policy,provenance}) {
  if (!['mingdao','nocoly'].includes(brand)) throw Error('Choose mingdao or nocoly');
  token(version);
  if (!['zh','en'].includes(locale)) throw Error('Default source locale must be zh or en; bilingual is inferred from page decks');
  const html = annotate(await bundleHtml(input,root),locale), book = inventory(html), classified = classify(book,policy);
  const dir = path.resolve(templates,brand,version);
  await fs.mkdir(path.dirname(dir),{recursive:true}); await fs.mkdir(dir); // Existing versions are immutable.
  const policyText = JSON.stringify(classified,null,2)+'\n';
  const manifest = {schemaVersion:1,brand,version,registeredAt:new Date().toISOString(),sourceFile:path.basename(input),sourceSha256:sha(await fs.readFile(input)),templateSha256:sha(html),policySha256:sha(policyText),locales:[...new Set(book.map(p=>p.locale))],pages:book.length};
  if(provenance)manifest.sourceProvenance=provenance;
  await fs.writeFile(path.join(dir,'index.html'),html,{flag:'wx'});
  await fs.writeFile(path.join(dir,'policy.json'),policyText,{flag:'wx'});
  await json(path.join(dir,'manifest.json'),manifest);
  return {dir,manifest,policy:classified};
}
export async function loadTemplate(dir) {
  const [html, policyText, manifest] = await Promise.all([fs.readFile(path.join(dir,'index.html'),'utf8'),fs.readFile(path.join(dir,'policy.json'),'utf8'),readJson(path.join(dir,'manifest.json'))]);
  if (sha(html) !== manifest.templateSha256 || sha(policyText) !== manifest.policySha256) throw Error('Standard template or page policy has been modified');
  const policy = JSON.parse(policyText), book = inventory(html);
  if (JSON.stringify(classify(book,policy)) !== JSON.stringify(policy)) throw Error('Page policy violates hard protection rules');
  assertOffline(html); return {html,policy,manifest,book};
}
export async function prepare({template,workdir,request}) {
  const t = await loadTemplate(template), r = validateRequest(request);
  if (r.brand !== t.manifest.brand) throw Error('Request and template brand differ');
  const wanted = r.locale === 'bilingual' ? ['zh','en'] : [r.locale];
  if (wanted.some(l=>!t.manifest.locales.includes(l))) throw Error('This source version does not contain the requested language');
  await fs.mkdir(workdir,{recursive:false});
  // A generation carries an immutable baseline snapshot, independent of any install path.
  await fs.cp(template,path.join(workdir,'baseline'),{recursive:true,errorOnExist:true,force:false});
  const run = {schemaVersion:1,createdAt:new Date().toISOString(),request:r,templateSha256:t.manifest.templateSha256,brand:r.brand,version:t.manifest.version};
  await json(path.join(workdir,'run.json'),run);
  await fs.mkdir(path.join(workdir,'materials'));
  await json(path.join(workdir,'changes.json'),{pages:[],remove:[],add:[],gaps:[]});
  await json(path.join(workdir,'sources.json'),[]);
  return {workdir,run,policy:t.policy};
}
function setValues(html,pageId,values,rule) {
  const {nodes}=parse(html), page=nodes.find(n=>n.attrs['data-page-id']===pageId);
  if (!page) throw Error(`Missing page ${pageId}`);
  const edits=[];
  for (const [id,value] of Object.entries(values)) {
    if (!rule.editable.includes(id)) throw Error(`Locked slot ${pageId}/${id}`);
    const n=nodes.find(n=>n.start>page.start&&n.end<=page.end&&n.attrs['data-slot-id']===id);
    if (!n) throw Error('Slot missing from baseline');
    if (value.preserve === true) { if (!rule.decorative.includes(id)) throw Error('Customer content cannot preserve donor material'); continue; }
    if (n.tag==='img') {
      if (typeof value.dataUri!=='string') throw Error('An image requires an embedded asset');
      edits.push(attrPatch(n,'src',value.dataUri));
      if (typeof value.alt!=='string') throw Error('Provide replacement image alt text');
      edits.push(attrPatch(n,'alt',value.alt));
    } else {
      if (typeof value.text!=='string' || n.children.some(c=>c.tag!=='br')) throw Error('Only plain leaf text can be changed');
      edits.push({start:n.openEnd,end:n.closeStart,value:escapeText(value.text)});
    }
  }
  return patches(html,edits);
}
function renamePage(html,newPageId) {
  token(newPageId);
  const {nodes}=parse(html), ids=new Map(nodes.filter(n=>n.attrs.id).map(n=>[n.attrs.id,`${newPageId}-${n.attrs.id}`])), edits=[];
  for (const n of nodes) {
    for (const key of ['id','data-object-id']) if (n.attrs[key]) edits.push(attrPatch(n,key,key==='id'?ids.get(n.attrs[key]):`${newPageId}-${n.attrs[key]}`));
    for (const key of ['href','xlink:href']) if (n.attrs[key]?.startsWith('#')&&ids.has(n.attrs[key].slice(1))) edits.push(attrPatch(n,key,'#'+ids.get(n.attrs[key].slice(1))));
    for (const key of ['aria-labelledby','aria-describedby','for']) if (n.attrs[key]) edits.push(attrPatch(n,key,n.attrs[key].split(' ').map(id=>ids.get(id)??id).join(' ')));
    for (const [key,value] of Object.entries(n.attrs)) if (/url\(\s*['"]?#/.test(value)) edits.push(attrPatch(n,key,value.replace(/url\(\s*(['"]?)#([^\s)'";]+)\1\s*\)/g,(_,q,id)=>`url(#${ids.get(id)??id})`)));
    if(n.attrs['data-page-id']) edits.push(attrPatch(n,'data-page-id',newPageId));
  }
  return patches(html,edits);
}
function addPartnerCompany(html,pageId,company) {
  if (company === undefined) return html;
  const {nodes}=parse(html),page=nodes.find(n=>n.attrs['data-page-id']===pageId);
  const within=n=>n.start>page.start&&n.end<=page.end;
  const canvas=nodes.find(n=>within(n)&&/(?:^|\s)slide-canvas(?:\s|$)/.test(n.attrs.class??''));
  const title=nodes.find(n=>within(n)&&n.attrs['data-slot-id']===page.attrs['data-directory-title-slot']);
  if(page.attrs['data-source-slide']!=='17'||!canvas||!title) throw Error('Partner company subtitle requires the reviewed flow-page layout');
  let titleBlock=title;
  while(titleBlock.parent&&titleBlock.parent!==canvas) titleBlock=titleBlock.parent;
  if(titleBlock.parent!==canvas) throw Error('Partner subtitle title must be inside the page canvas');
  const id=`${pageId}-partner-company`;
  // Local header addition: the existing flow title, diagram and standard CSS stay intact.
  const subtitle=`<div id="${id}" data-partner-company data-slot-id="partner-company" style="position:absolute;left:3.92cqw;top:8.4cqw;width:92.16cqw;font-family:&quot;Helvetica Neue&quot;,Arial,sans-serif;font-size:1.2cqw;line-height:1.45;font-weight:400;color:var(--md-text-secondary,#546E7A)">${escapeText(company)}</div>`;
  return patches(html,[{start:titleBlock.end,end:titleBlock.end,value:subtitle},attrPatch(canvas,'aria-describedby',[canvas.attrs['aria-describedby'],id].filter(Boolean).join(' '))]);
}
function sourceCheck(edit,rule,sources,request,createdAt) {
  if (rule.mode==='locked') throw Error(`Page ${rule.id} is locked`);
  if (rule.mode==='replaceable') {
    if (!edit.sourceIds?.length) throw Error('Customer/solution pages require verified source IDs');
    if (rule.editable.some(id=>!Object.hasOwn(edit.values??{},id))) throw Error('Replace every donor content slot on a case page');
  }
  for (const id of edit.sourceIds??[]) {
    const source=sources.find(s=>s.id===id); if (!source) throw Error(`Missing source ${id}`);
    assertSource(source,request,createdAt);
  }
  if (edit.partnerCompany !== undefined) {
    if(rule.mode!=='replaceable'||typeof edit.partnerCompany!=='string'||!edit.partnerCompany.trim()||edit.partnerCompany.length>80||/[\r\n]/.test(edit.partnerCompany)) throw Error('Partner company must be a short plain subtitle on a solution page');
    const verified=(edit.sourceIds??[]).some(id=>{
      const source=sources.find(s=>s.id===id);
      return source.kind==='solutions'&&source.partnerCompany===edit.partnerCompany&&source.body.some(p=>p.text.includes(edit.partnerCompany));
    });
    if(!verified) throw Error('Partner company subtitle must match the verified solution company');
  }
  const digitTokens = text => String(text).match(/\d+(?:[.,]\d+)*(?:[%％])?/g)??[];
  const evidenceNumbers = new Set((edit.sourceIds??[]).flatMap(id=>sources.find(s=>s.id===id).body.flatMap(p=>digitTokens(p.text))));
  for (const value of Object.values(edit.values??{})) if(typeof value.text==='string') {
    const numbers=digitTokens(value.text);
    if(rule.mode!=='replaceable'&&numbers.length) throw Error('Do not introduce numeric facts into editable product copy');
    if(rule.mode==='replaceable'&&numbers.some(n=>!evidenceNumbers.has(n))) throw Error('Case numbers must occur in the verified source text');
  }
}
export function render(t,run,changes,sources) {
  if (run.templateSha256!==t.manifest.templateSha256) throw Error('Run baseline fingerprint mismatch');
  if (!Array.isArray(sources)||!Array.isArray(changes.pages)||!Array.isArray(changes.remove)||!Array.isArray(changes.add)) throw Error('Invalid change/source documents');
  let html=t.html;
  const requested=run.request.locale==='bilingual'?['zh','en']:[run.request.locale];
  const removed=new Set(), changed=new Set();
  for(const id of changes.remove) {
    if(removed.has(id)) throw Error('Duplicate removed page'); removed.add(id);
    const rule=t.policy.pages.find(p=>p.id===id); if(!rule||rule.mode!=='replaceable') throw Error(`Cannot remove protected page ${id}`);
  }
  for (const edit of changes.pages) {
    const rule=t.policy.pages.find(p=>p.id===edit.pageId);
    if (!rule||removed.has(edit.pageId)||changed.has(edit.pageId)||!requested.includes(rule.locale)) throw Error('Unknown, duplicate, removed or unrequested page edit');
    changed.add(edit.pageId); sourceCheck(edit,rule,sources,run.request,run.createdAt);
    html=setValues(html,edit.pageId,edit.values??{},rule);
    html=addPartnerCompany(html,edit.pageId,edit.partnerCompany);
  }
  // Additions clone only existing case pages. All donor text/customer images must be replaced.
  const addedIds=new Set(t.book.map(p=>p.id));
  for(const edit of changes.add) {
    const rule=t.policy.pages.find(p=>p.id===edit.templatePageId);
    if(!rule||rule.mode!=='replaceable'||!requested.includes(rule.locale)||addedIds.has(edit.newPageId)) throw Error('New pages must use a case template and unique page ID');
    sourceCheck(edit,rule,sources,run.request,run.createdAt);
    let fragment=t.html.slice(pageNodes(t.html).find(p=>p.attrs['data-page-id']===rule.id).start,pageNodes(t.html).find(p=>p.attrs['data-page-id']===rule.id).end);
    fragment=setValues(fragment,rule.id,edit.values??{},rule); fragment=renamePage(fragment,edit.newPageId);
    fragment=addPartnerCompany(fragment,edit.newPageId,edit.partnerCompany);
    const after=pageNodes(html).find(p=>p.attrs['data-page-id']===edit.afterPageId);
    if(!after||removed.has(edit.afterPageId)||after.attrs['data-page-locale']!==rule.locale) throw Error('Invalid insertion position');
    html=html.slice(0,after.end)+'\n'+fragment+html.slice(after.end); addedIds.add(edit.newPageId);
  }
  const edits=pageNodes(html).filter(p=>removed.has(p.attrs['data-page-id'])||!requested.includes(p.attrs['data-page-locale'])).map(p=>({start:p.start,end:p.end,value:''}));
  html=patches(html,edits);
  const pages=pageNodes(html), renumber=[], totals={};
  for(const p of pages) totals[p.attrs['data-page-locale']]=(totals[p.attrs['data-page-locale']]??0)+1;
  if(requested.some(l=>!totals[l])) throw Error('Requested language has no pages');
  if(requested.length===2&&totals.zh!==totals.en) throw Error('Bilingual output must have equal page counts');
  const counters={};
  for(const p of pages) {
    const l=p.attrs['data-page-locale'], n=counters[l]=(counters[l]??0)+1;
    if(p.attrs['data-slide']!==undefined) renumber.push(attrPatch(p,'data-slide',n));
    if(p.attrs['aria-label']!==undefined) renumber.push(attrPatch(p,'aria-label',l==='zh'?`第 ${n} 页，共 ${totals[l]} 页`:`Slide ${n} of ${totals[l]}`));
  }
  html=patches(html,renumber); inventory(html); assertOffline(html); return html;
}
export async function loadRun(workdir) {
  const [t,run]=await Promise.all([loadTemplate(path.join(workdir,'baseline')),readJson(path.join(workdir,'run.json'))]);
  return {t,run};
}
export async function apply({workdir,changes,sources}) {
  const {t,run}=await loadRun(workdir), normalized=structuredClone(changes);
  for(const edit of [...normalized.pages,...normalized.add]) for(const value of Object.values(edit.values??{})) {
    if(value.image) { value.dataUri=await assetUri(path.resolve(workdir,'materials',value.image),path.join(workdir,'materials')); delete value.image; }
  }
  const html=render(t,run,normalized,sources);
  const applied={changes:normalized,sources,htmlSha256:sha(html),appliedAt:new Date().toISOString()};
  await fs.writeFile(path.join(workdir,'index.html'),html);
  await fs.writeFile(path.join(workdir,'applied.json'),JSON.stringify(applied,null,2)+'\n');
  return {htmlSha256:applied.htmlSha256,pages:inventory(html).length};
}
export async function validate(workdir) {
  const {t,run}=await loadRun(workdir), applied=await readJson(path.join(workdir,'applied.json')), html=await fs.readFile(path.join(workdir,'index.html'),'utf8');
  const expected=render(t,run,applied.changes,applied.sources);
  if(html!==expected||sha(html)!==applied.htmlSha256) throw Error('Generated HTML differs from permitted changes: protected content, shared CSS/JS or resources may have changed');
  return {ok:true,brand:run.brand,version:run.version,pages:inventory(html).length,sha256:sha(html),gaps:applied.changes.gaps??[]};
}
export async function deliver({workdir,output,review}) {
  const result=await validate(workdir), r=await readJson(review);
  if(r.htmlSha256!==result.sha256||r.offline!==true||r.desktop!==true||r.mobile!==true||r.navigation!==true||r.content!==true||!r.reviewer||!Number.isFinite(Date.parse(r.reviewedAt))) throw Error('A visual/content review for this exact HTML is required');
  if(!output.endsWith('.html')) throw Error('Delivery must be one .html file');
  const resolved=path.resolve(output), baseline=path.resolve(workdir,'baseline');
  if(resolved.startsWith(baseline+path.sep)) throw Error('Cannot overwrite a standard template');
  await fs.mkdir(path.dirname(resolved),{recursive:true});
  await fs.copyFile(path.join(workdir,'index.html'),resolved,1); // COPYFILE_EXCL
  return {...result,output:resolved};
}
