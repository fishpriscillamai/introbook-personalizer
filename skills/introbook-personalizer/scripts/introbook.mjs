#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register, prepare, apply, validate, deliver, readJson } from './core.mjs';
import { annotate, inventory } from './html.mjs';
import { bundleHtml } from './resources.mjs';
import { searchPlan, normalizeSource } from './knowledge.mjs';

const defaults = fileURLToPath(new URL('../assets/templates/', import.meta.url));
export async function listTemplates(templates=defaults) {
  const entries=[];
  for(const brand of ['mingdao','nocoly']) {
    let versions=[]; try { versions=await fs.readdir(path.join(templates,brand)); } catch(e) { if(e.code!=='ENOENT') throw e; }
    for(const version of versions) {
      try { entries.push({ ...await readJson(path.join(templates,brand,version,'manifest.json')),dir:path.join(templates,brand,version) }); }
      catch(e) { if(e.code!=='ENOENT') throw e; }
    }
  }
  return {templates:entries,missingBrands:['mingdao','nocoly'].filter(b=>!entries.some(t=>t.brand===b)),ready:entries.length>0};
}
function args(argv) {
  const out={};
  for(let i=0;i<argv.length;i++) {
    const a=argv[i]; if(!a.startsWith('--')) throw Error(`Unexpected argument ${a}`);
    const k=a.slice(2); if(Object.hasOwn(out,k)) throw Error(`Duplicate option ${a}`);
    out[k]=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;
  }
  return out;
}
const need=(o,k)=>{if(typeof o[k]!=='string')throw Error(`Missing --${k}`);return o[k];};
async function templateFor(o,r) {
  if(o.template) return o.template;
  const all=await listTemplates(o.templates??defaults);
  const matches=all.templates.filter(t=>t.brand===(r.brand??'mingdao')&&(!o.version||t.version===o.version)).sort((a,b)=>b.registeredAt.localeCompare(a.registeredAt));
  if(!matches.length) throw Error('No current standard template is registered for this brand. Obtain the latest source from the user; do not substitute historical IntroBooks.');
  return matches[0].dir;
}
export async function main(argv=process.argv.slice(2)) {
  const [command,...rest]=argv,o=args(rest);
  switch(command) {
    case 'status': return listTemplates(o.templates??defaults);
    case 'adapt-web': { const {adaptOfficialWeb}=await import('./official-web.mjs'); return adaptOfficialWeb({input:need(o,'input'),root:o.root??path.dirname(o.input),brand:need(o,'brand'),output:need(o,'output')}); }
    case 'inspect': return inventory(annotate(await bundleHtml(need(o,'input'),o.root??path.dirname(o.input)),o.locale??'zh'));
    case 'register': return register({input:need(o,'input'),root:o.root??path.dirname(o.input),templates:o.templates??defaults,brand:need(o,'brand'),version:need(o,'version'),locale:o.locale??'zh',policy:o.policy?await readJson(o.policy):undefined,provenance:o.provenance?await readJson(o.provenance):undefined});
    case 'prepare': { const request=await readJson(need(o,'request')); return prepare({template:await templateFor(o,request),workdir:need(o,'workdir'),request}); }
    case 'search-plan': return searchPlan(await readJson(need(o,'request')));
    case 'normalize-source': { let raw; if(o.stdin) { const chunks=[]; for await(const c of process.stdin) chunks.push(c); raw=Buffer.concat(chunks).toString('utf8'); } else raw=await fs.readFile(need(o,'input'),'utf8'); return normalizeSource(need(o,'kind'),JSON.parse(raw)); }
    case 'apply': { const workdir=need(o,'workdir'); return apply({workdir,changes:await readJson(o.changes??path.join(workdir,'changes.json')),sources:await readJson(o.sources??path.join(workdir,'sources.json'))}); }
    case 'validate': return validate(need(o,'workdir'));
    case 'deliver': return deliver({workdir:need(o,'workdir'),output:need(o,'output'),review:need(o,'review')});
    default: throw Error('Commands: status, adapt-web, inspect, register, prepare, search-plan, normalize-source, apply, validate, deliver. See references/workflow.md.');
  }
}
if(process.argv[1]&&await fs.realpath(process.argv[1])===await fs.realpath(fileURLToPath(import.meta.url))) {
  try { process.stdout.write(JSON.stringify(await main(),null,2)+'\n'); }
  catch(e) { process.stderr.write(e.message+'\n'); process.exitCode=1; }
}
