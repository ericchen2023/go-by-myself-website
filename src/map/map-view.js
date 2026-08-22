import { el } from '../app/dom.js';
import { DELIVERY_LOCATIONS, ROUTE_EDGES, ROUTE_NODES, shortestRoute } from './route-graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const nodeById = new Map(ROUTE_NODES.map((node) => [node.id, node]));
const edgeById = new Map(ROUTE_EDGES.map((edge) => [edge.id, edge]));
const priorVehiclePoints = new Map();

const LABEL_PLATES = Object.freeze({
  HSS2: { x: 72, y: 145, width: 200, height: 76, title: '人社二館', code: 'HSS / 02' },
  HSS1: { x: 72, y: 365, width: 200, height: 76, title: '人社一館', code: 'HSS / 01' },
  LIBRARY: { x: 625, y: 112, width: 220, height: 76, title: '圖資中心', code: 'LIBRARY' },
  ADMIN: { x: 752, y: 455, width: 190, height: 76, title: '行政大樓', code: 'ADMIN' }
});

/** @param {string} name @param {Record<string, string|number>} attributes */
function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** @param {SVGSVGElement} svg */
function appendMapTexture(svg) {
  const defs = svgElement('defs');
  const patternId = `${svg.id || 'route'}-grid`;
  const pattern = svgElement('pattern', { id: patternId, width: 32, height: 32, patternUnits: 'userSpaceOnUse' });
  pattern.append(svgElement('path', { d: 'M 32 0 L 0 0 0 32', class: 'map-grid-line' }));
  defs.append(pattern);
  svg.append(defs, svgElement('rect', { width: 1000, height: 650, class: 'map-grid', fill: `url(#${patternId})`, 'aria-hidden': 'true' }));
}

/** @param {SVGSVGElement} svg */
function appendOrigin(svg) {
  const group = svgElement('g', { class: 'origin-capsule', 'aria-hidden': 'true' });
  group.append(
    svgElement('rect', { x: 402, y: 478, width: 76, height: 118, rx: 22 }),
    svgElement('text', { x: 440, y: 548, 'text-anchor': 'middle' })
  );
  group.querySelector('text').textContent = 'P';
  svg.append(group);
}

/** @param {SVGSVGElement} svg */
function appendLabelPlates(svg) {
  const layer = svgElement('g', { class: 'map-label-plates', 'aria-hidden': 'true' });
  for (const plate of Object.values(LABEL_PLATES)) {
    const group = svgElement('g', { class: 'map-label-plate' });
    group.append(
      svgElement('rect', { x: plate.x, y: plate.y, width: plate.width, height: plate.height }),
      svgElement('text', { x: plate.x + 18, y: plate.y + 33, class: 'map-label-title' }),
      svgElement('text', { x: plate.x + 18, y: plate.y + 57, class: 'map-label-code' })
    );
    const texts = group.querySelectorAll('text');
    texts[0].textContent = plate.title;
    texts[1].textContent = plate.code;
    layer.append(group);
  }
  svg.append(layer);
}

/**
 * Fallback geometry used in unit tests and browsers without SVGGeometryElement.
 * @param {{segmentId: string, progress: number}} position
 */
export function markerPointForPosition(position) {
  const edge = edgeById.get(position.segmentId);
  if (!edge) return null;
  const from = nodeById.get(edge.fromNodeId);
  const to = nodeById.get(edge.toNodeId);
  if (!from || !to) return null;
  const progress = Math.max(0, Math.min(1, position.progress));
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress
  };
}

/** @param {SVGSVGElement} svg @param {{segmentId:string,progress:number}} position */
function markerPointFromSvg(svg, position) {
  const path = /** @type {SVGPathElement|undefined} */ ([...svg.querySelectorAll('.route-edge')].find((candidate) => candidate.getAttribute('data-edge-id') === position.segmentId));
  if (path && typeof path.getTotalLength === 'function' && typeof path.getPointAtLength === 'function') {
    const length = path.getTotalLength();
    const point = path.getPointAtLength(length * Math.max(0, Math.min(1, position.progress)));
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: point.x, y: point.y };
  }
  return markerPointForPosition(position);
}

/** @param {SVGSVGElement} svg @param {Set<string>} activeEdges @param {string} id */
function appendRouteLayer(svg, activeEdges, id) {
  const routeLayer = svgElement('g', { class: 'route-layer', 'aria-hidden': 'true' });
  for (const edge of ROUTE_EDGES) {
    routeLayer.append(svgElement('path', {
      id: `${id}-${edge.id}`,
      d: edge.svgPathD,
      class: activeEdges.has(edge.id) ? 'route-edge is-active' : 'route-edge',
      'data-edge-id': edge.id
    }));
  }
  svg.append(routeLayer);
}

/** @param {SVGSVGElement} svg @param {string} id @param {{segmentId:string,progress:number}|null|undefined} position */
function appendVehicle(svg, id, position) {
  if (!position) {
    priorVehiclePoints.delete(id);
    return;
  }
  const point = markerPointFromSvg(svg, position);
  if (!point) return;
  const previous = priorVehiclePoints.get(id) ?? point;
  priorVehiclePoints.set(id, point);
  const marker = svgElement('g', {
    class: 'vehicle-marker',
    transform: `translate(${point.x} ${point.y})`,
    role: 'img',
    'aria-label': '車輛在核准路線上的動態示意位置'
  });
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!reduced && (previous.x !== point.x || previous.y !== point.y)) {
    marker.append(svgElement('animateTransform', {
      attributeName: 'transform',
      type: 'translate',
      from: `${previous.x} ${previous.y}`,
      to: `${point.x} ${point.y}`,
      dur: '180ms',
      fill: 'freeze'
    }));
  }
  marker.append(
    svgElement('circle', { class: 'vehicle-halo', r: 31, 'aria-hidden': 'true' }),
    svgElement('rect', { class: 'vehicle-body', x: -21, y: -15, width: 42, height: 29, rx: 10, 'aria-hidden': 'true' }),
    svgElement('circle', { class: 'vehicle-wheel', cx: -12, cy: 15, r: 5, 'aria-hidden': 'true' }),
    svgElement('circle', { class: 'vehicle-wheel', cx: 12, cy: 15, r: 5, 'aria-hidden': 'true' }),
    svgElement('path', { class: 'vehicle-signal', d: 'M -8 -5 L 2 -5 M 7 -5 L 12 -5', 'aria-hidden': 'true' })
  );
  svg.append(marker);
}

/** @param {ReturnType<typeof shortestRoute>} route */
function continuousRoutePath(route) {
  if (!route.length) return '';
  const start = nodeById.get(route[0].fromNodeId);
  if (!start) return '';
  return route.reduce((path, part) => {
    const next = nodeById.get(part.toNodeId);
    return next ? `${path} L ${next.x} ${next.y}` : path;
  }, `M ${start.x} ${start.y}`);
}

/**
 * Brand-scale preview built from the same graph as every delivery screen.
 * @returns {HTMLElement}
 */
export function createRoutePreview() {
  const wrapper = el('div', { className: 'route-preview' });
  const svg = /** @type {SVGSVGElement} */ (svgElement('svg', {
    id: 'home-route-preview',
    viewBox: '0 0 1000 650',
    role: 'img',
    'aria-label': '東華校園固定路線示意：圖資中心、人社二館、人社一館、行政大樓與車輛起點 P'
  }));
  appendMapTexture(svg);
  appendOrigin(svg);
  appendRouteLayer(svg, new Set(), 'home-preview');
  appendLabelPlates(svg);

  for (const location of DELIVERY_LOCATIONS) {
    const node = nodeById.get(location.routeNodeId);
    if (!node) continue;
    svg.append(svgElement('circle', { class: 'preview-stop', cx: node.x, cy: node.y, r: 15, 'aria-hidden': 'true' }));
  }

  const route = shortestRoute('P_ORIGIN', 'LIBRARY');
  const motionPath = continuousRoutePath(route);
  const vehicle = svgElement('g', { class: 'preview-vehicle', 'aria-hidden': 'true' });
  vehicle.append(
    svgElement('rect', { x: -18, y: -12, width: 36, height: 24, rx: 9 }),
    svgElement('circle', { cx: -10, cy: 13, r: 4 }),
    svgElement('circle', { cx: 10, cy: 13, r: 4 })
  );
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!reduced && motionPath) {
    vehicle.append(svgElement('animateMotion', { dur: '7s', repeatCount: 'indefinite', path: motionPath }));
  } else {
    const start = nodeById.get('P_ORIGIN');
    vehicle.setAttribute('transform', `translate(${start?.x ?? 0} ${start?.y ?? 0})`);
  }
  svg.append(vehicle);
  wrapper.append(svg);
  return wrapper;
}

/**
 * @param {{
 *  id: string,
 *  label: string,
 *  selectedCode?: string,
 *  pickupCode?: string,
 *  dropoffCode?: string,
 *  disabledCodes?: string[],
 *  interactive?: boolean,
 *  activeEdgeIds?: string[],
 *  vehiclePosition?: {segmentId: string, progress: number}|null,
 *  onSelect?: (code: string) => void
 * }} options
 */
export function createRouteSelector(options) {
  const disabled = new Set(options.disabledCodes ?? []);
  const activeEdges = new Set(options.activeEdgeIds ?? []);
  const interactive = options.interactive ?? true;
  const headingId = `${options.id}-heading`;
  const heading = el('h2', { id: headingId, className: 'section-title' }, options.label);
  const mapHint = el('p', { className: 'map-hint', id: `${options.id}-hint` }, interactive
    ? '地圖與站點列表同步。方向鍵切換站點，Enter 或空白鍵選取。'
    : '車輛只顯示在核准路線上；schematic projection 不公開原始座標。');

  const svg = /** @type {SVGSVGElement} */ (svgElement('svg', {
    id: `${options.id}-svg`,
    viewBox: '0 0 1000 650',
    class: 'route-map',
    role: interactive ? 'group' : 'img',
    'aria-labelledby': headingId,
    'aria-describedby': `${options.id}-hint`
  }));
  appendMapTexture(svg);
  appendOrigin(svg);
  appendRouteLayer(svg, activeEdges, options.id);
  appendLabelPlates(svg);

  const stopLayer = svgElement('g', { class: 'stop-layer' });
  const enabledLocations = DELIVERY_LOCATIONS.filter((location) => !disabled.has(location.code));
  let rovingIndex = Math.max(0, enabledLocations.findIndex((location) => location.code === options.selectedCode));
  /** @type {SVGGElement[]} */
  const stopGroups = [];

  DELIVERY_LOCATIONS.forEach((location) => {
    const node = nodeById.get(location.routeNodeId);
    if (!node) return;
    const isDisabled = disabled.has(location.code);
    const isPickup = location.code === options.pickupCode;
    const isDropoff = location.code === options.dropoffCode;
    const isSelected = location.code === options.selectedCode;
    const group = /** @type {SVGGElement} */ (svgElement('g', {
      class: ['map-stop', isPickup ? 'is-pickup' : '', isDropoff ? 'is-dropoff' : '', isSelected ? 'is-selected' : '', isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' '),
      transform: `translate(${node.x} ${node.y})`,
      role: interactive ? 'button' : 'img',
      tabindex: interactive && !isDisabled && enabledLocations[rovingIndex]?.code === location.code ? '0' : '-1',
      'aria-label': `${location.name}，${location.detail}${isDisabled ? '，不可選，與放件地點相同' : ''}`,
      'aria-disabled': isDisabled ? 'true' : 'false',
      'data-location-code': location.code
    }));
    const hit = svgElement('circle', { class: 'stop-hit', r: 28, 'aria-hidden': 'true' });
    const circle = svgElement('circle', { class: 'stop-dot', r: isSelected || isPickup || isDropoff ? 15 : 11, 'aria-hidden': 'true' });
    const badge = svgElement('text', { class: 'stop-badge', x: 0, y: 5, 'text-anchor': 'middle', 'aria-hidden': 'true' });
    badge.textContent = isPickup ? '放' : isDropoff ? '收' : '';
    group.append(hit, circle, badge);

    if (interactive && !isDisabled) {
      const choose = () => options.onSelect?.(location.code);
      group.addEventListener('click', choose);
      group.addEventListener('keydown', (event) => {
        const keyboardEvent = /** @type {KeyboardEvent} */ (event);
        if (['Enter', ' '].includes(keyboardEvent.key)) {
          keyboardEvent.preventDefault();
          choose();
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(keyboardEvent.key)) return;
        keyboardEvent.preventDefault();
        const direction = ['ArrowRight', 'ArrowDown'].includes(keyboardEvent.key) ? 1 : -1;
        const current = enabledLocations.findIndex((item) => item.code === location.code);
        rovingIndex = (current + direction + enabledLocations.length) % enabledLocations.length;
        for (const candidate of stopGroups) candidate.setAttribute('tabindex', '-1');
        const target = stopGroups.find((candidate) => candidate.dataset.locationCode === enabledLocations[rovingIndex]?.code);
        target?.setAttribute('tabindex', '0');
        target?.focus();
      });
      stopGroups.push(group);
    }
    stopLayer.append(group);
  });
  svg.append(stopLayer);
  appendVehicle(svg, options.id, options.vehiclePosition);

  const list = el('fieldset', { className: `location-list${interactive ? '' : ' location-list--legend'}` },
    el('legend', { className: 'sr-only' }, options.label),
    ...DELIVERY_LOCATIONS.map((location) => {
      const inputId = `${options.id}-${location.code}`;
      const input = el('input', {
        type: 'radio',
        id: inputId,
        name: options.id,
        value: location.code,
        checked: options.selectedCode === location.code,
        disabled: !interactive || disabled.has(location.code),
        onchange: () => options.onSelect?.(location.code)
      });
      return el('label', {
        className: `location-option${options.selectedCode === location.code ? ' is-selected' : ''}${disabled.has(location.code) ? ' is-disabled' : ''}`,
        htmlFor: inputId
      },
      input,
      el('span', { className: 'location-symbol', 'aria-hidden': 'true' }, options.pickupCode === location.code ? '放' : options.dropoffCode === location.code ? '收' : '站'),
      el('span', { className: 'location-copy' },
        el('strong', {}, location.name),
        el('span', {}, location.detail),
        disabled.has(location.code) ? el('small', {}, '與放件地點相同，不可選') : null
      ));
    })
  );

  return el('section', { className: 'route-selector', 'aria-labelledby': headingId },
    el('div', { className: 'route-selector__heading' }, heading, mapHint),
    el('div', { className: 'map-list-layout' },
      el('div', { className: 'map-panel' }, svg),
      el('div', { className: 'list-panel' }, list)
    )
  );
}
