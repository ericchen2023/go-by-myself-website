import { el } from '../app/dom.js';
import { DELIVERY_LOCATIONS, ROUTE_EDGES, ROUTE_NODES, shortestRoute } from './route-graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const nodeById = new Map(ROUTE_NODES.map((node) => [node.id, node]));
const edgeById = new Map(ROUTE_EDGES.map((edge) => [edge.id, edge]));
const vehicleMotionStates = new Map();

const STOP_LABELS = Object.freeze({
  HSS2: { x: 225, y: 184, anchor: 'middle' },
  HSS1: { x: 225, y: 474, anchor: 'middle' },
  LIBRARY: { x: 720, y: 64, anchor: 'middle' },
  ADMIN: { x: 835, y: 517, anchor: 'middle' }
});

/** @param {string} name @param {Record<string, string|number>} attributes */
function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** @param {SVGSVGElement} svg @param {string} id */
function appendMapFoundation(svg, id) {
  const defs = svgElement('defs');
  const arrowId = `${id}-route-arrow`;
  const patternId = `${id}-paper-dots`;
  const pattern = svgElement('pattern', { id: patternId, width: 28, height: 28, patternUnits: 'userSpaceOnUse' });
  pattern.append(svgElement('circle', { cx: 2, cy: 2, r: 1.25, class: 'map-dot' }));
  const marker = svgElement('marker', { id: arrowId, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
  marker.append(svgElement('path', { d: 'M 1 1 L 9 5 L 1 9 z', class: 'route-arrow' }));
  defs.append(pattern, marker);
  svg.append(defs, svgElement('rect', { width: 1000, height: 650, class: 'map-paper', fill: `url(#${patternId})`, 'aria-hidden': 'true' }));

  const context = svgElement('g', { class: 'map-context', 'aria-hidden': 'true' });
  context.append(
    svgElement('path', { d: 'M 70 84 H 320 V 178 H 128 V 310 H 64' }),
    svgElement('path', { d: 'M 72 486 H 314 V 566 H 110' }),
    svgElement('path', { d: 'M 662 42 H 908 V 188 H 842' }),
    svgElement('path', { d: 'M 690 460 H 936 V 614 H 732' }),
    svgElement('path', { d: 'M 928 34 C 868 148 958 252 902 358 C 874 412 892 488 954 604', class: 'map-context-river' })
  );
  svg.append(context);
}

/** @param {{segmentId: string, progress: number}} position */
export function markerPointForPosition(position) {
  const edge = edgeById.get(position.segmentId);
  if (!edge) return null;
  const from = nodeById.get(edge.fromNodeId);
  const to = nodeById.get(edge.toNodeId);
  if (!from || !to) return null;
  const progress = Math.max(0, Math.min(1, position.progress));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

/** @param {{segmentId: string, progress: number}} position */
function markerHeading(position) {
  const edge = edgeById.get(position.segmentId);
  if (!edge) return 0;
  const from = nodeById.get(edge.fromNodeId);
  const to = nodeById.get(edge.toNodeId);
  return from && to ? Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI) : 0;
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
function appendRouteNetwork(svg, activeEdges, id) {
  const shadowLayer = svgElement('g', { class: 'route-shadow-layer', 'aria-hidden': 'true' });
  const routeLayer = svgElement('g', { class: 'route-layer', 'aria-hidden': 'true' });
  for (const edge of ROUTE_EDGES) {
    shadowLayer.append(svgElement('path', { d: edge.svgPathD, class: 'route-edge-shadow' }));
    routeLayer.append(svgElement('path', {
      id: `${id}-${edge.id}`,
      d: edge.svgPathD,
      class: activeEdges.has(edge.id) ? 'route-edge is-active' : 'route-edge',
      'data-edge-id': edge.id
    }));
  }
  svg.append(shadowLayer, routeLayer);
}

/** @param {{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}} part */
function orientedPartPath(part) {
  const from = nodeById.get(part.fromNodeId);
  const to = nodeById.get(part.toNodeId);
  return from && to ? `M ${from.x} ${from.y} L ${to.x} ${to.y}` : '';
}

/** @param {SVGSVGElement} svg @param {string} id @param {Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>} parts @param {{segmentId:string,progress:number}|null|undefined} position */
function appendJourneyRoute(svg, id, parts, position) {
  if (!parts?.length) return;
  const layer = svgElement('g', { class: 'journey-route', 'aria-hidden': 'true' });
  const currentIndex = position ? parts.findIndex((part) => part.edgeId === position.segmentId) : -1;
  parts.forEach((part, index) => {
    const d = orientedPartPath(part);
    if (!d) return;
    let traveled = 0;
    if (currentIndex >= 0) {
      if (index < currentIndex) traveled = 1;
      else if (index === currentIndex) traveled = Math.max(0, Math.min(1, part.forward ? position.progress : 1 - position.progress));
    }
    layer.append(svgElement('path', {
      d,
      class: 'journey-segment journey-segment--remaining',
      'marker-end': index === parts.length - 1 ? `url(#${id}-route-arrow)` : ''
    }));
    if (traveled > 0) {
      layer.append(svgElement('path', {
        d,
        pathLength: 1,
        class: 'journey-segment journey-segment--traveled',
        'stroke-dasharray': 1,
        'stroke-dashoffset': String(1 - traveled)
      }));
    }
  });
  svg.append(layer);
}

/** @param {SVGSVGElement} svg */
function appendStationLabels(svg) {
  const layer = svgElement('g', { class: 'map-station-labels', 'aria-hidden': 'true' });
  for (const location of DELIVERY_LOCATIONS) {
    const label = STOP_LABELS[location.code];
    if (!label) continue;
    const text = svgElement('text', { x: label.x, y: label.y, 'text-anchor': label.anchor, class: 'map-station-label' });
    text.textContent = location.name;
    layer.append(text);
  }
  svg.append(layer);
}

/** @param {number} value */
function easeInOut(value) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

/** @param {SVGSVGElement} svg @param {string} id @param {{segmentId:string,progress:number}|null|undefined} position */
function appendVehicle(svg, id, position) {
  if (!position) {
    const staleState = vehicleMotionStates.get(id);
    if (staleState?.frameId) globalThis.cancelAnimationFrame?.(staleState.frameId);
    vehicleMotionStates.delete(id);
    return;
  }
  const target = markerPointFromSvg(svg, position);
  if (!target) return;
  const prior = vehicleMotionStates.get(id);
  const now = performance.now();
  let start = prior?.target ?? target;
  if (prior) {
    const elapsed = Math.max(0, now - prior.startedAt);
    const ratio = Math.min(1, elapsed / prior.duration);
    const eased = easeInOut(ratio);
    start = { x: prior.start.x + (prior.target.x - prior.start.x) * eased, y: prior.start.y + (prior.target.y - prior.start.y) * eased };
    if (prior.frameId) globalThis.cancelAnimationFrame?.(prior.frameId);
  }

  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const heading = distance > 0.25
    ? Math.atan2(target.y - start.y, target.x - start.x) * (180 / Math.PI)
    : markerHeading(position);

  const marker = svgElement('g', {
    class: 'vehicle-marker',
    transform: `translate(${start.x} ${start.y})`,
    role: 'img',
    'aria-label': '車輛在固定路線上的動態示意位置'
  });
  const vehicle = svgElement('g', { class: 'vehicle-marker__body', transform: `rotate(${heading})`, 'aria-hidden': 'true' });
  vehicle.append(
    svgElement('circle', { class: 'vehicle-halo', r: 32 }),
    svgElement('path', { class: 'vehicle-body', d: 'M -22 -15 H 13 L 24 0 L 13 15 H -22 Q -28 15 -28 9 V -9 Q -28 -15 -22 -15 Z' }),
    svgElement('rect', { class: 'vehicle-window', x: -10, y: -9, width: 17, height: 18, rx: 4 }),
    svgElement('circle', { class: 'vehicle-wheel', cx: -16, cy: 17, r: 5 }),
    svgElement('circle', { class: 'vehicle-wheel', cx: 13, cy: 17, r: 5 }),
    svgElement('circle', { class: 'vehicle-light', cx: 18, cy: 0, r: 3 })
  );
  marker.append(vehicle);
  svg.append(marker);

  const duration = Math.max(260, Math.min(520, 230 + distance * 3.2));
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const state = { start, target, startedAt: now, duration, frameId: 0, marker };
  vehicleMotionStates.set(id, state);
  if (reduced || distance < 0.25 || typeof globalThis.requestAnimationFrame !== 'function') {
    marker.setAttribute('transform', `translate(${target.x} ${target.y})`);
    state.start = target;
    return;
  }
  const animate = (timestamp) => {
    if (vehicleMotionStates.get(id) !== state || !state.marker.isConnected) return;
    const ratio = Math.min(1, Math.max(0, (timestamp - state.startedAt) / state.duration));
    const eased = easeInOut(ratio);
    const x = state.start.x + (state.target.x - state.start.x) * eased;
    const y = state.start.y + (state.target.y - state.start.y) * eased;
    state.marker.setAttribute('transform', `translate(${x} ${y})`);
    if (ratio < 1) state.frameId = requestAnimationFrame(animate);
    else state.start = state.target;
  };
  state.frameId = requestAnimationFrame(animate);
}

/** @param {Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>} route */
function continuousRoutePath(route) {
  if (!route.length) return '';
  const start = nodeById.get(route[0].fromNodeId);
  if (!start) return '';
  return route.reduce((path, part) => {
    const next = nodeById.get(part.toNodeId);
    return next ? `${path} L ${next.x} ${next.y}` : path;
  }, `M ${start.x} ${start.y}`);
}

/** @returns {HTMLElement} */
export function createRoutePreview() {
  const wrapper = el('div', { className: 'route-preview' });
  const svg = /** @type {SVGSVGElement} */ (svgElement('svg', {
    id: 'home-route-preview',
    viewBox: '0 0 1000 650',
    role: 'img',
    'aria-label': '東華校園固定路線示意，連接圖資中心、人社二館、人社一館與行政大樓'
  }));
  appendMapFoundation(svg, 'home-preview');
  appendRouteNetwork(svg, new Set(), 'home-preview');
  const route = shortestRoute('P_ORIGIN', 'LIBRARY');
  appendJourneyRoute(svg, 'home-preview', route, null);
  appendStationLabels(svg);
  for (const location of DELIVERY_LOCATIONS) {
    const node = nodeById.get(location.routeNodeId);
    if (!node) continue;
    svg.append(svgElement('circle', { class: 'preview-stop', cx: node.x, cy: node.y, r: 12, 'aria-hidden': 'true' }));
  }
  const motionPath = continuousRoutePath(route);
  const vehicle = svgElement('g', { class: 'preview-vehicle', 'aria-hidden': 'true' });
  vehicle.append(
    svgElement('path', { d: 'M -18 -11 H 9 L 19 0 L 9 11 H -18 Q -23 11 -23 6 V -6 Q -23 -11 -18 -11 Z' }),
    svgElement('circle', { cx: -12, cy: 13, r: 4 }),
    svgElement('circle', { cx: 9, cy: 13, r: 4 })
  );
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!reduced && motionPath) vehicle.append(svgElement('animateMotion', { dur: '9s', repeatCount: 'indefinite', path: motionPath, rotate: 'auto' }));
  else {
    const start = nodeById.get('P_ORIGIN');
    vehicle.setAttribute('transform', `translate(${start?.x ?? 0} ${start?.y ?? 0})`);
  }
  svg.append(vehicle);
  wrapper.append(svg);
  return wrapper;
}

/** @param {{id:string,label:string,selectedCode?:string,pickupCode?:string,dropoffCode?:string,disabledCodes?:string[],interactive?:boolean,activeEdgeIds?:string[],activeRouteParts?:Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>,vehiclePosition?:{segmentId:string,progress:number}|null,onSelect?:(code:string)=>void}} options */
export function createRouteSelector(options) {
  const disabled = new Set(options.disabledCodes ?? []);
  const activeEdges = new Set(options.activeEdgeIds ?? []);
  const interactive = options.interactive ?? true;
  const headingId = `${options.id}-heading`;
  const heading = el('h2', { id: headingId, className: 'section-title' }, options.label);
  const mapHint = el('p', { className: 'map-hint', id: `${options.id}-hint` }, interactive
    ? '可以在地圖或站點列表中選擇，兩邊會同步更新。'
    : '車輛位置只會顯示在固定路線上，不公開精確座標。');
  const keyboardHint = interactive ? el('p', { className: 'sr-only' }, '地圖可用方向鍵切換站點，按 Enter 或空白鍵選取。') : null;
  const svg = /** @type {SVGSVGElement} */ (svgElement('svg', {
    id: `${options.id}-svg`, viewBox: '0 0 1000 650', class: 'route-map', role: interactive ? 'group' : 'img', 'aria-labelledby': headingId, 'aria-describedby': `${options.id}-hint`
  }));
  appendMapFoundation(svg, options.id);
  appendRouteNetwork(svg, activeEdges, options.id);
  appendJourneyRoute(svg, options.id, options.activeRouteParts ?? [], options.vehiclePosition);
  appendStationLabels(svg);

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
      transform: `translate(${node.x} ${node.y})`, role: interactive ? 'button' : 'img',
      tabindex: interactive && !isDisabled && enabledLocations[rovingIndex]?.code === location.code ? '0' : '-1',
      'aria-label': `${location.name}，${location.detail}${isDisabled ? '，不可選，與放件地點相同' : ''}`,
      'aria-disabled': isDisabled ? 'true' : 'false', 'data-location-code': location.code
    }));
    const hit = svgElement('circle', { class: 'stop-hit', r: 30, 'aria-hidden': 'true' });
    const circle = svgElement('circle', { class: 'stop-dot', r: isSelected || isPickup || isDropoff ? 15 : 11, 'aria-hidden': 'true' });
    const badge = svgElement('text', { class: 'stop-badge', x: 0, y: 5, 'text-anchor': 'middle', 'aria-hidden': 'true' });
    badge.textContent = isPickup ? '放' : isDropoff ? '收' : '';
    group.append(hit, circle, badge);
    if (interactive && !isDisabled) {
      const choose = () => options.onSelect?.(location.code);
      group.addEventListener('click', choose);
      group.addEventListener('keydown', (event) => {
        const keyboardEvent = /** @type {KeyboardEvent} */ (event);
        if (['Enter', ' '].includes(keyboardEvent.key)) { keyboardEvent.preventDefault(); choose(); return; }
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
      const input = el('input', { type: 'radio', id: inputId, name: options.id, value: location.code, checked: options.selectedCode === location.code, disabled: !interactive || disabled.has(location.code), onchange: () => options.onSelect?.(location.code) });
      return el('label', { className: `location-option${options.selectedCode === location.code ? ' is-selected' : ''}${disabled.has(location.code) ? ' is-disabled' : ''}`, htmlFor: inputId },
        input,
        el('span', { className: 'location-symbol', 'aria-hidden': 'true' }, options.pickupCode === location.code ? '放' : options.dropoffCode === location.code ? '收' : '站'),
        el('span', { className: 'location-copy' },
          el('strong', {}, location.name),
          el('span', {}, location.detail),
          disabled.has(location.code) ? el('small', {}, '與放件地點相同，不可選') : null
        )
      );
    })
  );
  return el('section', { className: 'route-selector', 'aria-labelledby': headingId },
    el('div', { className: 'route-selector__heading' }, heading, mapHint, keyboardHint),
    el('div', { className: 'map-list-layout' }, el('div', { className: 'map-panel' }, svg), el('div', { className: 'list-panel' }, list))
  );
}
