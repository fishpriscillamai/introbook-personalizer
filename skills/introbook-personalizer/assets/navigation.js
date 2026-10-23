/* Optional source adapter: bind existing brand controls using data-ib-* attributes. */
(() => {
  function boot() {
    const all = [...document.querySelectorAll('[data-page-id]')];
    if (!all.length || !document.querySelector('[data-ib-next], [data-ib-directory]')) return;
    const locales = [...new Set(all.map(p => p.dataset.pageLocale))];
    let locale = locales.includes(document.documentElement.lang) ? document.documentElement.lang : locales[0];
    let index = 0;
    const pick = selector => [...document.querySelectorAll(selector)];
    const pages = () => all.filter(p => p.dataset.pageLocale === locale);
    function show(next) {
      const current = pages(); index = Math.max(0, Math.min(next, current.length - 1));
      all.forEach(p => { p.hidden = p !== current[index]; p.setAttribute('aria-hidden', String(p.hidden)); });
      pick('[data-ib-position]').forEach(e => { e.textContent = `${index + 1} / ${current.length}`; });
      pick('[data-ib-directory]').forEach(e => { e.value = current[index].dataset.pageId; });
      pick('[data-ib-prev]').forEach(e => { e.disabled = index === 0; });
      pick('[data-ib-next]').forEach(e => { e.disabled = index === current.length - 1; });
    }
    function menu() {
      pick('[data-ib-directory]').forEach(e => {
        e.replaceChildren(...pages().map((p, n) => {
          const o = document.createElement('option'); o.value = p.dataset.pageId;
          o.textContent = `${n + 1}. ${p.querySelector('h1,h2,h3,[data-page-title]')?.textContent?.trim() ?? p.dataset.pageId}`;
          return o;
        }));
      });
    }
    pick('[data-ib-next]').forEach(e => e.addEventListener('click', () => show(index + 1)));
    pick('[data-ib-prev]').forEach(e => e.addEventListener('click', () => show(index - 1)));
    pick('[data-ib-directory]').forEach(e => e.addEventListener('change', () => show(pages().findIndex(p => p.dataset.pageId === e.value))));
    pick('[data-ib-locale]').forEach(e => {
      e.replaceChildren(...locales.map(l => { const o = document.createElement('option'); o.value = l; o.textContent = l === 'zh' ? '中文' : 'English'; return o; }));
      e.value = locale; e.hidden = locales.length < 2;
      e.addEventListener('change', () => { locale = e.value; document.documentElement.lang = locale; menu(); show(Math.min(index, pages().length - 1)); });
    });
    pick('[data-ib-fullscreen]').forEach(e => e.addEventListener('click', async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
      catch { /* Browser may decline; navigation remains available. */ }
    }));
    document.addEventListener('keydown', e => {
      if (e.target instanceof HTMLElement && (e.target.matches('input,textarea,select') || e.target.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); show(index + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(index - 1); }
    });
    menu(); show(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
