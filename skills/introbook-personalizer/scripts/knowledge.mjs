import fs from 'node:fs/promises';
const config = JSON.parse(await fs.readFile(new URL('../references/knowledge-sources.json', import.meta.url),'utf8'));
export { config };
export function validateRequest(value) {
  const r = { ...value, brand:value.brand ?? 'mingdao', locale:value.locale ?? 'zh' };
  if (!['mingdao','nocoly'].includes(r.brand) || !['zh','en','bilingual'].includes(r.locale)) throw Error('Unsupported brand/locale');
  if (typeof r.industry !== 'string' || !r.industry.trim() || !Array.isArray(r.scenarios) || !r.scenarios.length || r.scenarios.some(s => typeof s !== 'string' || !s.trim())) throw Error('Supply industry and at least one scenario');
  return r;
}
export function searchPlan(request) {
  const r = validateRequest(request);
  const query = `${r.industry} ${r.scenarios.join(' ')} ${r.requirements ?? ''}`.trim().slice(0,1200);
  return {
    request:r,
    calls:['cases','solutions'].map(kind => ({ kind, tool:'knowledge_search', args:{ appId:config[kind].appId, knowledgeIds:[config[kind].knowledgeId], query, searchMode:'hybrid', topK:8, filter:{types:['record','record_attachment'],worksheetIds:[config[kind].worksheetId]} } })),
    requiredFollowup:'Read each candidate with get_record_details. Verify current status, content, brand and fit; search scores are not probabilities. Do not persist raw MCP responses.',
  };
}
function unwrap(value) {
  if (value.isError) throw Error('MCP permission/read error; reconnect HAP Personal MCP and verify application access');
  if (value.content) {
    const item = value.content.find(c => c.type === 'text');
    if (!item) throw Error('MCP response contains no record');
    value = JSON.parse(item.text);
  }
  if (value.success === false) throw Error('HAP denied or failed the read; no source may be used');
  return value.data ?? value;
}
const labels = v => Array.isArray(v) ? v.map(i => i.value ?? i.Value).filter(Boolean) : [];
const validPublicUrl = (kind,url) => typeof url==='string' && new RegExp(`^https://www\\.(?:mingdao|nocoly)\\.com/${kind==='cases'?'case':'solution'}/[^?#\\s]+$`).test(url);
export function normalizeSource(kind, response, now = new Date().toISOString()) {
  const c = config[kind]; if (!c) throw Error('Unknown knowledge source kind');
  const d = unwrap(response), rowId = d.rowId;
  if (typeof rowId !== 'string' || !rowId) throw Error('Record response must include rowId from the live read');
  const status = d[c.statusField];
  const key = Array.isArray(status) ? (status[0]?.key ?? status[0]?.Key) : null;
  if (key !== c.publicStatusKey) throw Error(`Excluded ${kind}: current record is not ${c.publicStatusName}`);
  const publicUrl = d[c.urlField];
  if (!validPublicUrl(kind,publicUrl)) throw Error('Missing a public case/solution URL');
  const title = d[c.titleField]; if (typeof title !== 'string' || !title.trim()) throw Error('Source has no title');
  // Deliberately copy only approved publication fields, never owners/contacts/download tokens.
  return { id:`${kind}:${rowId}`, kind, rowId, appId:c.appId, worksheetId:c.worksheetId, status:c.publicStatusName, statusKey:key,
    title, publicUrl, brand:c.brandField ? labels(d[c.brandField])[0] ?? null : null,
    sourceLocale:c.localeField ? labels(d[c.localeField])[0] ?? null : null,
    industries:c.industryField ? labels(d[c.industryField]) : [], scenarios:labels(d[c.scenariosField]),
    body:c.bodyFields.map(field => ({field,text:typeof d[field] === 'string' ? d[field] : ''})).filter(p => p.text), verifiedAt:now };
}
export function assertSource(source, request, createdAt) {
  const c = config[source.kind];
  if (!c || source.id !== `${source.kind}:${source.rowId}` || source.appId !== c.appId || source.worksheetId !== c.worksheetId || source.statusKey !== c.publicStatusKey || source.status !== c.publicStatusName) throw Error('Invalid or nonpublic evidence');
  if (typeof source.rowId!=='string' || !source.title || !source.body?.length || source.body.some(p=>typeof p.text!=='string'||!p.text.trim()) || !validPublicUrl(source.kind,source.publicUrl)) throw Error('Incomplete evidence');
  const verified = Date.parse(source.verifiedAt);
  if (!Number.isFinite(verified) || verified < Date.parse(createdAt) || verified > Date.now() + 60000) throw Error('Read the source again during this generation');
  if (source.brand && source.brand !== request.brand) throw Error('Cross-brand customer evidence requires a separate approved brand source');
}
