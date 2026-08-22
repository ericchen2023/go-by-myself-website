/**
 * Small safe DOM factory. User-provided strings are always assigned as text,
 * never interpreted as HTML.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, unknown>} [attributes]
 * @param {...(Node|string|number|null|undefined|false)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'className') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'htmlFor' && node instanceof HTMLLabelElement) node.htmlFor = String(value);
    else if (key === 'checked' && node instanceof HTMLInputElement) node.checked = Boolean(value);
    else if (key === 'disabled' && 'disabled' in node) node.disabled = Boolean(value);
    else if (key === 'value' && 'value' in node) node.value = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return /** @type {HTMLElementTagNameMap[K]} */ (node);
}

/** @param {string} label */
export function projectMark(label = 'GBM') {
  return el('span', { className: 'project-mark', 'aria-label': 'go by myself 專案標誌' }, label);
}

/**
 * Complete official mark downloaded from the NDHU visual identity page.
 * The asset is never recolored, cropped, or used as a CSS background.
 * @param {'header'|'hero'|'compact'} [size]
 */
export function ndhuEmblem(size = 'header') {
  const pixels = size === 'hero' ? 76 : size === 'compact' ? 36 : 48;
  return el('img', {
    className: `ndhu-emblem ndhu-emblem--${size}`,
    src: '/brand/ndhu-emblem.svg',
    alt: '國立東華大學校徽',
    width: String(pixels),
    height: String(pixels),
    decoding: 'async'
  });
}

/** @param {string} message @param {'polite'|'assertive'} [mode] */
export function liveRegion(message, mode = 'polite') {
  return el('div', { className: 'sr-only', 'aria-live': mode, 'aria-atomic': 'true' }, message);
}
