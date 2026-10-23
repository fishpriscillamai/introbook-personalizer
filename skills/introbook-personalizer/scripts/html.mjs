// Source-preserving HTML scanner. No DOM serialization or external dependencies.
export const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
export const escapeText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const escapeAttr = value => escapeText(value).replaceAll('"', '&quot;');
export const decode = value => String(value).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, c) => {
  if (c[0] === '#') return String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : Number(c.slice(1)));
  return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[c.toLowerCase()];
});

export function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [], start: 0, openEnd: 0, closeStart: html.length, end: html.length };
  const stack = [root], nodes = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') { const next = html.indexOf('<', i); i = next < 0 ? html.length : next; continue; }
    if (html.startsWith('<!--', i)) { const end = html.indexOf('-->', i + 4); if (end < 0) throw Error('Unclosed HTML comment'); i = end + 3; continue; }
    let end = i + 1, quote = null;
    for (; end < html.length; end++) {
      const c = html[end];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end === html.length) throw Error('Unclosed HTML tag');
    const raw = html.slice(i, end + 1), match = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/i.exec(raw);
    if (!match) { i = end + 1; continue; }
    const tag = match[2].toLowerCase();
    if (match[1]) {
      const node = stack.at(-1);
      if (node.tag !== tag) throw Error(`HTML must have explicit, balanced tags: unexpected </${tag}>`);
      node.closeStart = i; node.end = end + 1; stack.pop(); i = end + 1; continue;
    }
    const attrs = {}, attrEntries = [];
    const ar = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    ar.lastIndex = match[0].length;
    for (let a; (a = ar.exec(raw));) {
      const name = a[1].toLowerCase();
      if (Object.hasOwn(attrs, name)) throw Error(`Duplicate attribute ${name}`);
      attrs[name] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      attrEntries.push({ name, start: i + a.index, end: i + ar.lastIndex });
    }
    const parent = stack.at(-1);
    const node = { tag, attrs, attrEntries, start: i, openEnd: end + 1, closeStart: end + 1, end: end + 1, parent, children: [] };
    parent.children.push(node); nodes.push(node);
    if (!VOID.has(tag) && !/\/\s*>$/.test(raw)) {
      if (['script', 'style', 'textarea', 'title'].includes(tag)) {
        const closing = new RegExp(`</${tag}\\s*>`, 'ig'); closing.lastIndex = end + 1;
        const close = closing.exec(html);
        if (!close) throw Error(`Missing </${tag}>`);
        node.closeStart = close.index; node.end = closing.lastIndex; i = node.end; continue;
      }
      stack.push(node);
    }
    i = end + 1;
  }
  if (stack.length !== 1) throw Error(`Unclosed <${stack.at(-1).tag}>`);
  return { root, nodes };
}

export function patches(html, edits) {
  const ordered = edits.filter(e => e.start !== e.end || e.value).sort((a, b) => b.start - a.start || b.end - a.end);
  let boundary = html.length + 1;
  for (const e of ordered) {
    if (e.end > boundary) throw Error('Overlapping HTML changes');
    html = html.slice(0, e.start) + e.value + html.slice(e.end); boundary = e.start;
  }
  return html;
}

export function attrPatch(node, name, value) {
  const a = node.attrEntries.find(a => a.name === name);
  return a ? { start: a.start, end: a.end, value: `${name}="${escapeAttr(value)}"` }
    : { start: node.openEnd - 1, end: node.openEnd - 1, value: ` ${name}="${escapeAttr(value)}"` };
}
export const textContent = (html, node) => decode(html.slice(node.openEnd, node.closeStart).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function ancestor(node, predicate) { for (let n = node; n; n = n.parent) if (predicate(n)) return n; }
export const pageNodes = html => parse(html).nodes.filter(n => n.attrs['data-page-id']);

export function annotate(html, defaultLocale = 'zh') {
  let { nodes } = parse(html);
  let pages = nodes.filter(n => n.attrs['data-page-id'] || (n.tag === 'section' && (n.attrs['data-slide'] || /(?:^|\s)slide(?:\s|$)/.test(n.attrs.class ?? ''))));
  if (!pages.length) pages = nodes.filter(n => n.tag === 'section' && !ancestor(n.parent, p => p.tag === 'section'));
  if (!pages.length) throw Error('No pages found. Normalize the source into <section data-page-id="..."> pages first.');
  const edits = [], used = new Set(), counts = {};
  for (const page of pages) {
    const locale = ancestor(page, n => n.attrs?.['data-locale-deck'])?.attrs['data-locale-deck'] ?? page.attrs.lang ?? defaultLocale;
    if (!['zh', 'en'].includes(locale)) throw Error(`Unsupported page locale: ${locale}`);
    const number = counts[locale] = (counts[locale] ?? 0) + 1;
    const pageId = page.attrs['data-page-id'] || `p-${locale}-${number}`;
    if (used.has(pageId)) throw Error(`Duplicate page ID ${pageId}`); used.add(pageId);
    if (!page.attrs['data-page-id']) edits.push(attrPatch(page, 'data-page-id', pageId));
    if (!page.attrs['data-page-locale']) edits.push(attrPatch(page, 'data-page-locale', locale));
    let slotNo = 0;
    const slotIds = new Set(nodes.filter(n => n.start > page.start && n.end <= page.end).map(n => n.attrs['data-slot-id']).filter(Boolean));
    for (const n of nodes.filter(n => n.start > page.start && n.end <= page.end)) {
      const isText = ['p','span','div','h1','h2','h3','h4','li','blockquote','figcaption','td'].includes(n.tag)
        && n.children.every(c => c.tag === 'br') && textContent(html, n);
      if ((isText || n.tag === 'img') && !n.attrs['data-slot-id']) {
        let id; do { id = `s-${++slotNo}`; } while (slotIds.has(id)); slotIds.add(id);
        edits.push(attrPatch(n, 'data-slot-id', id));
      }
    }
  }
  // Attribute insertions at the same position are merged, retaining deterministic order.
  const groups = new Map();
  for (const e of edits) { const k = `${e.start}:${e.end}`; const existing = groups.get(k); if (existing) existing.value += e.value; else groups.set(k, { ...e }); }
  return patches(html, [...groups.values()]);
}

export function inventory(html) {
  const { nodes } = parse(html);
  const allPages = nodes.filter(n => n.attrs['data-page-id']);
  if (!allPages.length) throw Error('Template contains no page IDs');
  if (allPages.some(n => ancestor(n.parent, p => p.attrs?.['data-page-id']))) throw Error('Nested pages require source normalization');
  const ids = nodes.flatMap(n => n.attrs.id ? [n.attrs.id] : []);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate HTML IDs');
  const objects=nodes.map(n=>n.attrs['data-object-id']).filter(Boolean);
  if (new Set(objects).size !== objects.length) throw Error('Duplicate object IDs');
  const pageIds = allPages.map(n => n.attrs['data-page-id']);
  if (new Set(pageIds).size !== pageIds.length) throw Error('Duplicate page IDs');
  return allPages.map(p => {
    const slots = nodes.filter(n => n.start > p.start && n.end <= p.end && n.attrs['data-slot-id']).map(n => ({
      id: n.attrs['data-slot-id'], kind: n.tag === 'img' ? 'image' : 'text', text: n.tag === 'img' ? (n.attrs.alt ?? '') : textContent(html, n),
      ...(n.tag === 'img' ? { embedded: (n.attrs.src ?? '').startsWith('data:') } : {}),
    }));
    if (new Set(slots.map(s => s.id)).size !== slots.length) throw Error(`Duplicate slots on ${p.attrs['data-page-id']}`);
    return { id: p.attrs['data-page-id'], locale: p.attrs['data-page-locale'], ...(p.attrs['data-page-role'] ? {role:p.attrs['data-page-role']} : {}), title: slots.find(s => s.kind === 'text')?.text ?? '', text: textContent(html, p), slots };
  });
}
