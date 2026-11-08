/**
 * JavaScript evaluated inside the page over CDP. Kept as plain JS strings (not TS functions) so
 * transpiler helpers can't leak into the injected source.
 *
 * `__fl0w.snapshot()` numbers every visible interactive element and stores them on
 * `window.__fl0wRefs`, so later click/fill calls can address an element by its ref until the page
 * navigates or the next snapshot.
 */
export const PAGE_PRELUDE = String.raw`
if (!window.__fl0w) {
  const SELECTOR = [
    'a[href]', 'button', 'input:not([type=hidden])', 'textarea', 'select', 'summary', '[contenteditable=""]',
    '[contenteditable=true]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
    ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'treeitem'].map((r) => '[role=' + r + ']'),
  ].join(',');
  const clean = (s, max = 80) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  };
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const isToggle = (el) => el.tagName === 'INPUT' && ['checkbox', 'radio', 'file'].includes(el.type);
  const collect = (root, out) => {
    for (const el of root.querySelectorAll(SELECTOR)) out.push(el);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) collect(el.shadowRoot, out);
    return out;
  };
  const interactive = () => [...new Set(collect(document, []))].filter((el) =>
    isVisible(el) || (isToggle(el) && [...(el.labels ?? [])].some(isVisible)));
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && clean(aria)) return clean(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ');
      if (clean(t)) return clean(t);
    }
    if (el.labels?.length) {
      const t = [...el.labels].map((l) => l.innerText).join(' ');
      if (clean(t)) return clean(t);
    }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
      if (['submit', 'button', 'reset'].includes(el.type) && el.value) return clean(el.value);
      return clean(el.placeholder || el.getAttribute('name') || el.title || el.id);
    }
    return clean(el.innerText || el.title || el.getAttribute('alt') || el.querySelector?.('img[alt]')?.alt
      || el.querySelector?.('svg title')?.textContent || el.getAttribute('name') || '');
  };
  const brief = (el, ref) => {
    const tag = el.tagName.toLowerCase();
    const kind = el.getAttribute('role') ?? (tag === 'input' ? 'input[' + el.type + ']' : tag);
    return (ref >= 0 ? '[' + ref + '] ' : '') + kind + ' "' + labelOf(el) + '"';
  };
  const describe = (el, ref) => {
    const tag = el.tagName.toLowerCase();
    const parts = [brief(el, ref)];
    if (tag === 'select') {
      const options = [...el.options];
      parts.push('selected="' + clean(options.filter((o) => o.selected).map((o) => o.text).join(', ')) + '"');
      parts.push('options: ' + options.slice(0, 25).map((o) => clean(o.text, 40)).join(' | ')
        + (options.length > 25 ? ' | …+' + (options.length - 25) + ' more' : ''));
    } else if (isToggle(el) && el.type !== 'file') {
      parts.push(el.checked ? 'checked' : 'unchecked');
    } else if (tag === 'input' || tag === 'textarea') {
      if (el.type !== 'file' && !['submit', 'button', 'reset'].includes(el.type)) {
        parts.push('value="' + (el.type === 'password' && el.value ? '••••' : clean(el.value, 60)) + '"');
      }
      if (el.placeholder && clean(el.placeholder) !== labelOf(el)) parts.push('placeholder="' + clean(el.placeholder, 40) + '"');
    } else if (el.isContentEditable) {
      parts.push('value="' + clean(el.innerText, 60) + '"');
    }
    const checked = el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected');
    if (checked && !isToggle(el)) parts.push(el.hasAttribute('aria-checked') ? 'checked=' + checked : 'selected=' + checked);
    if (el.getAttribute('aria-expanded')) parts.push('expanded=' + el.getAttribute('aria-expanded'));
    if (tag === 'a') parts.push('href=' + clean(el.getAttribute('href'), 80));
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled');
    if (el.required) parts.push('required');
    if (el.readOnly) parts.push('readonly');
    return parts.join(' ');
  };
  window.__fl0w = {
    snapshot(maxElements, maxText) {
      const els = interactive();
      window.__fl0wRefs = els;
      const lines = els.slice(0, maxElements).map((el, i) => describe(el, i));
      const text = (document.body?.innerText ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      return {
        url: location.href,
        title: document.title,
        elements: lines,
        omitted: Math.max(0, els.length - maxElements),
        text: text.length > maxText ? text.slice(0, maxText) + '\n…(page text truncated)' : text,
      };
    },
    resolve(target) {
      if (target.ref !== undefined && target.ref !== null) {
        const el = (window.__fl0wRefs ?? [])[target.ref];
        if (!el || !el.isConnected) throw new Error('Element ref ' + target.ref + ' is stale or unknown; call browser_snapshot for fresh refs');
        return el;
      }
      if (target.selector) {
        const el = document.querySelector(target.selector);
        if (!el) throw new Error('No element matches selector ' + target.selector);
        return el;
      }
      if (target.text) {
        const want = clean(target.text, 1000).toLowerCase();
        const els = interactive();
        const el = els.find((e) => labelOf(e).toLowerCase() === want) ?? els.find((e) => labelOf(e).toLowerCase().includes(want));
        if (!el) throw new Error('No visible interactive element with text "' + target.text + '"');
        return el;
      }
      throw new Error('Provide ref, selector, or text to target an element');
    },
    brief(el) { return brief(el, (window.__fl0wRefs ?? []).indexOf(el)); },
    center(el) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const reachable = !!hit && (hit === el || el.contains(hit) || hit.contains(el)
        || [...(el.labels ?? [])].some((l) => l === hit || l.contains(hit)));
      return { x, y, reachable, visible: rect.width > 0 && rect.height > 0 };
    },
  };
}
`;

export const pageScript = (body: string) => `(() => {${PAGE_PRELUDE}\n${body}\n})()`;
