// Small DOM helpers shared by the modes. No framework: el() builds elements, and a few
// ready-made pieces (button, card, toast, modal, stage layout, form controls) keep the
// look consistent. Styles live in css/app.css. Nothing runs at import time.

const SVGNS = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'selected', 'indeterminate']);
let uidCounter = 0;

/** Unique id for aria wiring: uid('panel') → 'panel-3'. */
export const uid = (prefix = 'id') => `${prefix}-${++uidCounter}`;

function applyAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') {
      const cls = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      if (cls) node.setAttribute('class', cls);
    } else if (k === 'text') node.textContent = String(v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else node.style[sk] = sv;
      }
    } else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
}

function appendChildren(node, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    node.append(c instanceof Node ? c : String(c));
  }
}

/**
 * Create an element.
 * attrs: `class` (string or array), `text`, `dataset`, `style` (string or object; '--custom' props ok),
 * `onclick`-style handlers, `value`/`checked` as properties; `true` → empty attribute; false/null → skipped.
 * children: strings, nodes, arrays (nested), null/false skipped.
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

/** Same as el() for SVG elements. */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVGNS, tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

// 24 x 24 stroke icons drawn for fotbol (currentColor, no fills unless noted).
const ICONS = {
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  learn: '<path d="M3 5.5c2.5-1 5.5-1 9 1 3.5-2 6.5-2 9-1V19c-2.5-1-5.5-1-9 1-3.5-2-6.5-2-9-1z"/><path d="M12 6.5V20"/>',
  explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  drill: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  live: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  progress: '<path d="M5 20v-8M12 20V5M19 20v-9"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  chevron: '<path d="m6 15 6-6 6 6"/>',
  code: '<path d="m9 7-5 5 5 5M15 7l5 5-5 5"/>',
  pitch: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};

/** Inline SVG icon (decorative: aria-hidden). */
export function icon(name, { size = 20, className = '' } = {}) {
  const node = document.createElementNS(SVGNS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('class', `icon ${className}`.trim());
  node.innerHTML = ICONS[name] ?? '';
  return node;
}

/**
 * Button. variant: 'primary' | 'secondary' | 'ghost'. Pass `icon` for a leading icon.
 * Extra attrs go straight to el().
 */
export function button(label, { onClick, variant = 'secondary', icon: iconName, iconOnly = false, className, ...attrs } = {}) {
  return el('button', {
    type: 'button',
    class: ['btn', `btn--${variant}`, iconOnly && 'btn--icon', className],
    'aria-label': iconOnly ? label : null,
    title: iconOnly ? label : null,
    onclick: onClick,
    ...attrs,
  }, [iconName && icon(iconName), iconOnly ? null : el('span', { text: label })]);
}

/** Link styled as a button. */
export function linkButton(label, href, { variant = 'secondary', icon: iconName, className, ...attrs } = {}) {
  return el('a', { href, class: ['btn', `btn--${variant}`, className], ...attrs }, [iconName && icon(iconName), el('span', { text: label })]);
}

/**
 * Card: { title, body, actions, tag, className, headingLevel }.
 * body and actions accept anything el() accepts as children.
 */
export function card({ title, body, actions, tag = 'section', className, headingLevel = 2 } = {}) {
  const id = title ? uid('card') : null;
  return el(tag, { class: ['card', className], 'aria-labelledby': id }, [
    title && el(`h${headingLevel}`, { class: 'card-title', id, text: title }),
    body && el('div', { class: 'card-body' }, body),
    actions && el('div', { class: 'card-actions' }, actions),
  ]);
}

/** Friendly empty/missing-content state. */
export function notice({ title, text, actions, tone = 'info' } = {}) {
  return el('div', { class: ['notice', `notice--${tone}`] }, [
    title && el('h2', { class: 'notice-title', text: title }),
    text && el('p', { text }),
    actions && el('div', { class: 'card-actions' }, actions),
  ]);
}

/** Say something to screen readers (polite). Repeated messages are re-announced. */
export function announce(message) {
  let region = document.getElementById('sr-live');
  if (!region) {
    region = el('div', { id: 'sr-live', class: 'visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
    document.body.append(region);
  }
  region.textContent = '';
  setTimeout(() => { region.textContent = message; }, 30);
}

/**
 * Transient message at the bottom of the screen. tone: 'info' | 'good' | 'bad'.
 * @returns {() => void} dismiss
 */
export function toast(message, { tone = 'info', timeout = 3500 } = {}) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = el('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const t = el('div', { class: ['toast', `toast--${tone}`], text: message });
  box.append(t);
  const dismiss = () => {
    t.classList.add('is-leaving');
    setTimeout(() => t.remove(), 200);
  };
  if (timeout > 0) setTimeout(dismiss, timeout);
  return dismiss;
}

/**
 * Modal dialog built on <dialog> (focus trap and Esc for free). A dialog belongs to the page that opened it:
 * any route change (Back, a link) closes it with the value 'route', so it can never be confirmed over
 * another page.
 * @param {{ title: string, content?: any, actions?: (close) => any[] | any[], onClose?: (value) => void, className?: string }} opts
 * @returns {{ el: HTMLDialogElement, close: (value?: string) => void }}
 */
export function openModal({ title, content, actions = [], onClose, className } = {}) {
  const titleId = uid('modal-title');
  const dlg = el('dialog', { class: ['modal', className], 'aria-labelledby': titleId });
  const close = (value = '') => {
    if (dlg.open) dlg.close(value);
    else if (dlg.isConnected) { dlg.returnValue = value; dlg.dispatchEvent(new Event('close')); } // no showModal(): the fallback
  };
  dlg.append(
    el('div', { class: 'modal-head' }, [
      el('h2', { id: titleId, class: 'modal-title', text: title }),
      button('Close', { iconOnly: true, icon: 'close', variant: 'ghost', onClick: () => close('dismiss') }),
    ]),
    el('div', { class: 'modal-body' }, content),
    el('div', { class: 'modal-actions' }, typeof actions === 'function' ? actions(close) : actions),
  );
  const onRoute = () => close('route');
  window.addEventListener('hashchange', onRoute);
  document.addEventListener('fotbol:route', onRoute); // replace navigations fire no hashchange (main.js navigateTo)
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close('dismiss'); });
  dlg.addEventListener('close', () => {
    window.removeEventListener('hashchange', onRoute);
    document.removeEventListener('fotbol:route', onRoute);
    dlg.remove();
    onClose?.(dlg.returnValue);
  }, { once: true });
  document.body.append(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  return { el: dlg, close };
}

/**
 * Board + panel layout used by the board modes. On wide screens the panel is a side column;
 * on narrow screens it is a bottom sheet whose collapsed height shows the head and actions,
 * and the board fills the space above it.
 *
 *   const { board, panel } = stageLayout(root, { label: 'Drill' });
 *   const b = app.createBoard(board);
 *   panel.head.append(...); panel.actions.append(...); panel.feedback.append(...);  // feedback is aria-live
 *
 * @returns {{ root, board, panel: { root, head, actions, feedback, body }, expand, collapse, toggle, destroy }}
 */
export function stageLayout(root, { label = 'Instructions and feedback', expanded = false } = {}) {
  const bodyId = uid('sheet-body');
  const board = el('div', { class: 'stage-board' });
  const handle = el('button', { type: 'button', class: 'sheet-handle', 'aria-controls': bodyId, 'aria-expanded': 'false' }, [
    el('span', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    el('span', { class: 'visually-hidden', text: 'Show more' }),
  ]);
  const head = el('div', { class: 'panel-head' });
  const actions = el('div', { class: 'panel-actions' });
  const feedback = el('div', { class: 'panel-feedback', 'aria-live': 'polite' });
  const body = el('div', { class: 'panel-body' });
  const scroll = el('div', { class: 'panel-scroll', id: bodyId }, [feedback, body]);
  const panelRoot = el('aside', { class: 'stage-panel', 'aria-label': label }, [handle, head, actions, scroll]);
  const stage = el('div', { class: 'stage' }, [board, panelRoot]);
  root.append(stage);

  let autoExpanded = false; // expanded because keyboard focus moved into the part of the sheet below the fold
  const setExpanded = (on) => {
    autoExpanded = false;
    panelRoot.classList.toggle('is-expanded', on);
    handle.setAttribute('aria-expanded', String(on));
    handle.lastChild.textContent = on ? 'Show less' : 'Show more';
  };
  setExpanded(expanded);

  // Narrow screens: the collapsed sheet shows only the handle, head and actions; the rest sits below the
  // screen. Focus moving there (Tab past the actions) opens the sheet so the focused control is visible,
  // and focus leaving that part closes it again (unless the learner opened it themselves).
  const isSheet = () => { try { return window.matchMedia('(max-width: 899.98px)').matches; } catch { return false; } };
  panelRoot.addEventListener('focusin', (e) => {
    if (!scroll.contains(e.target) || panelRoot.classList.contains('is-expanded') || !isSheet()) return;
    setExpanded(true);
    autoExpanded = true;
  });
  panelRoot.addEventListener('focusout', (e) => {
    if (!autoExpanded || scroll.contains(e.relatedTarget)) return;
    // Focus left the lower part (to the actions, the board, or out of the page): put the sheet back.
    if (!e.relatedTarget) return; // the page lost focus (another window): leave the sheet as it is
    setExpanded(false);
  });

  // Tap toggles; a swipe on the handle expands (up) or collapses (down) and swallows the click that follows.
  let y0 = null, swiped = false;
  handle.addEventListener('pointerdown', (e) => { y0 = e.clientY; swiped = false; });
  handle.addEventListener('pointerup', (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0;
    y0 = null;
    if (Math.abs(dy) > 24) { swiped = true; setExpanded(dy < 0); }
  });
  handle.addEventListener('click', () => {
    if (swiped) { swiped = false; return; }
    setExpanded(!panelRoot.classList.contains('is-expanded'));
  });
  panelRoot.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelRoot.classList.contains('is-expanded')) setExpanded(false); });

  // Collapsed sheet height = handle + head + actions, so the primary action is always reachable.
  const updatePeek = () => {
    const h = handle.offsetHeight + head.offsetHeight + actions.offsetHeight;
    stage.style.setProperty('--sheet-peek', `${Math.max(64, Math.min(h + 16, window.innerHeight * 0.45))}px`);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(updatePeek) : null;
  for (const n of [handle, head, actions]) ro?.observe(n);
  updatePeek();

  return {
    root: stage,
    board,
    panel: { root: panelRoot, head, actions, feedback, body },
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
    toggle: () => setExpanded(!panelRoot.classList.contains('is-expanded')),
    destroy: () => { ro?.disconnect(); stage.remove(); },
  };
}

/**
 * Segmented control (a radio group that looks like joined buttons).
 * @param {{ legend: string, name?: string, options: {value:string,label:string}[], value: string, onChange: (v) => void, hideLegend?: boolean }} opts
 */
export function segmented({ legend, name = uid('seg'), options, value, onChange, hideLegend = false }) {
  return el('fieldset', { class: 'segmented' }, [
    el('legend', { class: hideLegend ? 'visually-hidden' : 'segmented-legend', text: legend }),
    el('div', { class: 'segmented-options' }, options.map((o) =>
      el('label', { class: 'segmented-option' }, [
        el('input', { type: 'radio', name, value: o.value, checked: o.value === value, onchange: (e) => e.target.checked && onChange?.(o.value) }),
        el('span', { text: o.label }),
      ]))),
  ]);
}

/** Checkbox styled as a switch. */
export function toggleSwitch({ label, checked = false, onChange, hint }) {
  const hintId = hint ? uid('hint') : null;
  return el('label', { class: 'switch' }, [
    el('input', { type: 'checkbox', role: 'switch', checked, 'aria-describedby': hintId, onchange: (e) => onChange?.(e.target.checked) }),
    el('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    el('span', { class: 'switch-label' }, [label, hint && el('small', { id: hintId, class: 'switch-hint', text: hint })]),
  ]);
}

/** Labelled <select>. options: [{ value, label }]. */
export function selectField({ label, options, value, onChange }) {
  const id = uid('select');
  return el('div', { class: 'field' }, [
    el('label', { for: id, class: 'field-label', text: label }),
    el('select', { id, class: 'field-select', onchange: (e) => onChange?.(e.target.value) },
      options.map((o) => el('option', { value: o.value, selected: o.value === value, text: o.label }))),
  ]);
}
