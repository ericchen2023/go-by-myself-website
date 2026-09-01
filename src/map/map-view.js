import { el } from '../app/dom.js';
import { DELIVERY_LOCATIONS, ROUTE_EDGES, ROUTE_NODES, edgePathD, pointAlongEdge, routePathD, shortestRoute } from './route-graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const nodeById = new Map(ROUTE_NODES.map((node) => [node.id, node]));
const vehicleMotionStates = new Map();

const STOP_LABELS = Object.freeze({
  LIBRARY: { x: 128, y: 354, anchor: 'middle' },
  HSS2: { x: 382, y: 472, anchor: 'middle' },
  HSS1: { x: 651, y: 369, anchor: 'middle' },
  ADMIN: { x: 887, y: 94, anchor: 'middle' }
});

/** @param {string} code */
function stopPoint(code) {
  const node = nodeById.get(code);
  return node ? { x: node.x, y: node.y } : null;
}

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
  const marker = svgElement('marker', { id: arrowId, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
  marker.append(svgElement('path', { d: 'M 1 1 L 9 5 L 1 9 z', class: 'route-arrow' }));
  defs.append(marker);
  svg.append(defs, svgElement('rect', { width: 1000, height: 650, class: 'map-paper', 'aria-hidden': 'true' }));
}

/** @param {{segmentId: string, progress: number}} position */
export function markerPointForPosition(position) {
  const point = pointAlongEdge(position.segmentId, position.progress);
  return point ? { x: point.x, y: point.y } : null;
}

/** @param {{segmentId: string, progress: number}} position */
function markerHeading(position) {
  return pointAlongEdge(position.segmentId, position.progress)?.headingDeg ?? 0;
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
function appendRouteNetwork(svg, activeEdges, id, showWholeNetwork = true) {
  const routeLayer = svgElement('g', { class: 'route-layer', 'aria-hidden': 'true' });
  const visibleEdges = showWholeNetwork ? ROUTE_EDGES : ROUTE_EDGES.filter((edge) => activeEdges.has(edge.id));
  for (const edge of visibleEdges) {
    routeLayer.append(svgElement('path', {
      id: `${id}-${edge.id}`,
      d: edge.svgPathD,
      class: activeEdges.has(edge.id) ? 'route-edge is-active' : 'route-edge',
      'data-edge-id': edge.id
    }));
  }
  svg.append(routeLayer);
}

/** @param {{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}} part */
function orientedPartPath(part) {
  return edgePathD(part.edgeId, part.forward);
}

/** @param {SVGSVGElement} svg @param {string} id @param {Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>} parts @param {{segmentId:string,progress:number}|null|undefined} position */
function appendJourneyRoute(svg, id, parts, position) {
  if (!parts?.length) return;
  const layer = svgElement('g', { class: 'journey-route', 'aria-hidden': 'true' });
  const motionPath = continuousRoutePath(parts);
  if (motionPath) layer.append(svgElement('path', { d: motionPath, class: 'journey-motion-path', 'data-route-signature': routeSignature(parts) }));
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

/** @param {Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>} parts */
function routeSignature(parts) {
  return parts.map((part) => `${part.edgeId}:${part.forward ? 'f' : 'r'}`).join('|');
}

/** @param {Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>} parts @param {{segmentId:string,progress:number}} position */
function progressAlongJourney(parts, position) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (!total) return null;
  let traveled = 0;
  for (const part of parts) {
    if (part.edgeId === position.segmentId) {
      const local = part.forward ? position.progress : 1 - position.progress;
      return Math.max(0, Math.min(1, (traveled + Math.max(0, Math.min(1, local)) * part.length) / total));
    }
    traveled += part.length;
  }
  return null;
}

/** @param {SVGPathElement} path @param {number} progress */
function pointAndHeadingOnPath(path, progress) {
  const length = path.getTotalLength();
  const distance = length * Math.max(0, Math.min(1, progress));
  const point = path.getPointAtLength(distance);
  const before = path.getPointAtLength(Math.max(0, distance - 8));
  const after = path.getPointAtLength(Math.min(length, distance + 8));
  return { x: point.x, y: point.y, heading: Math.atan2(after.y - before.y, after.x - before.x) * (180 / Math.PI) };
}

/** @param {number} from @param {number} to */
function nearestHeading(from, to) {
  let result = to;
  while (result - from > 180) result -= 360;
  while (result - from < -180) result += 360;
  return result;
}

/** @param {number} heading */
function vehicleTransform(heading) {
  return `rotate(${heading}) scale(.74)`;
}

/** @param {SVGSVGElement} svg @param {string} id @param {{segmentId:string,progress:number}|null|undefined} position @param {Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>} parts @param {boolean} animateVehicle */
function appendVehicle(svg, id, position, parts, animateVehicle = true) {
  if (!position) {
    const staleState = vehicleMotionStates.get(id);
    if (staleState?.frameId) globalThis.cancelAnimationFrame?.(staleState.frameId);
    vehicleMotionStates.delete(id);
    return;
  }
  const path = /** @type {SVGPathElement|null} */ (svg.querySelector('.journey-motion-path'));
  const targetProgress = progressAlongJourney(parts, position);
  const signature = routeSignature(parts);
  const canSampleJourney = path && targetProgress !== null && typeof path.getTotalLength === 'function';
  const fallback = markerPointFromSvg(svg, position);
  if (!canSampleJourney && !fallback) return;
  const prior = vehicleMotionStates.get(id);
  const now = performance.now();
  let startProgress = targetProgress ?? 0;
  if (animateVehicle && prior && prior.signature === signature && targetProgress !== null && targetProgress >= prior.targetProgress) {
    const elapsed = Math.max(0, now - prior.startedAt);
    const ratio = Math.min(1, elapsed / prior.duration);
    startProgress = prior.startProgress + (prior.targetProgress - prior.startProgress) * easeInOut(ratio);
    if (prior.frameId) globalThis.cancelAnimationFrame?.(prior.frameId);
  }

  const initial = canSampleJourney ? pointAndHeadingOnPath(path, startProgress) : { ...fallback, heading: markerHeading(position) };

  const marker = svgElement('g', {
    class: 'vehicle-marker',
    transform: `translate(${initial.x} ${initial.y})`,
    role: 'img',
    'aria-label': '車輛在固定路線上的動態示意位置'
  });
  const vehicle = svgElement('g', { class: 'vehicle-marker__body', transform: vehicleTransform(initial.heading), 'aria-hidden': 'true' });
  vehicle.append(
    svgElement('circle', { class: 'vehicle-halo', r: 32 }),
    svgElement('rect', { class: 'vehicle-wheel', x: -21, y: -23, width: 12, height: 7, rx: 3 }),
    svgElement('rect', { class: 'vehicle-wheel', x: 8, y: -23, width: 12, height: 7, rx: 3 }),
    svgElement('rect', { class: 'vehicle-wheel', x: -21, y: 16, width: 12, height: 7, rx: 3 }),
    svgElement('rect', { class: 'vehicle-wheel', x: 8, y: 16, width: 12, height: 7, rx: 3 }),
    svgElement('path', { class: 'vehicle-body', d: 'M -18 -18 H 11 Q 22 -18 25 -7 L 28 0 L 25 7 Q 22 18 11 18 H -18 Q -26 18 -26 10 V -10 Q -26 -18 -18 -18 Z' }),
    svgElement('rect', { class: 'vehicle-window', x: -14, y: -11, width: 25, height: 22, rx: 7 }),
    svgElement('circle', { class: 'vehicle-light', cx: 19, cy: 0, r: 3.5 })
  );
  marker.append(vehicle);
  svg.append(marker);

  const routeLength = canSampleJourney ? path.getTotalLength() : 0;
  const distance = targetProgress === null ? 0 : Math.abs(targetProgress - startProgress) * routeLength;
  const duration = Math.max(240, Math.min(620, 220 + distance * 2.4));
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const state = { startProgress, targetProgress: targetProgress ?? startProgress, signature, startedAt: now, duration, frameId: 0, marker, vehicle, lastHeading: initial.heading };
  vehicleMotionStates.set(id, state);
  if (!animateVehicle || !canSampleJourney || reduced || distance < 0.25 || typeof globalThis.requestAnimationFrame !== 'function') {
    const target = canSampleJourney ? pointAndHeadingOnPath(path, state.targetProgress) : initial;
    marker.setAttribute('transform', `translate(${target.x} ${target.y})`);
    state.lastHeading = nearestHeading(state.lastHeading, target.heading);
    vehicle.setAttribute('transform', vehicleTransform(state.lastHeading));
    state.startProgress = state.targetProgress;
    return;
  }
  const animate = (timestamp) => {
    if (vehicleMotionStates.get(id) !== state || !state.marker.isConnected) return;
    const ratio = Math.min(1, Math.max(0, (timestamp - state.startedAt) / state.duration));
    const eased = easeInOut(ratio);
    const visualProgress = state.startProgress + (state.targetProgress - state.startProgress) * eased;
    const sample = pointAndHeadingOnPath(path, visualProgress);
    state.lastHeading = nearestHeading(state.lastHeading, sample.heading);
    state.marker.setAttribute('transform', `translate(${sample.x} ${sample.y})`);
    state.vehicle.setAttribute('transform', vehicleTransform(state.lastHeading));
    if (ratio < 1) state.frameId = requestAnimationFrame(animate);
    else state.startProgress = state.targetProgress;
  };
  state.frameId = requestAnimationFrame(animate);
}

/** @param {Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>} route */
function continuousRoutePath(route) {
  return routePathD(route);
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
  const route = shortestRoute('HSS1', 'LIBRARY');
  appendJourneyRoute(svg, 'home-preview', route, null);
  appendStationLabels(svg);
  for (const location of DELIVERY_LOCATIONS) {
    const point = stopPoint(location.routeNodeId);
    if (!point) continue;
    svg.append(svgElement('circle', { class: 'preview-stop', cx: point.x, cy: point.y, r: 12, 'aria-hidden': 'true' }));
  }
  const motionPath = continuousRoutePath(route);
  const vehicle = svgElement('g', { class: 'preview-vehicle', 'aria-hidden': 'true' });
  vehicle.append(
    svgElement('rect', { class: 'preview-vehicle__wheel', x: -16, y: -17, width: 10, height: 6, rx: 3 }),
    svgElement('rect', { class: 'preview-vehicle__wheel', x: 7, y: -17, width: 10, height: 6, rx: 3 }),
    svgElement('rect', { class: 'preview-vehicle__wheel', x: -16, y: 11, width: 10, height: 6, rx: 3 }),
    svgElement('rect', { class: 'preview-vehicle__wheel', x: 7, y: 11, width: 10, height: 6, rx: 3 }),
    svgElement('path', { class: 'preview-vehicle__body', d: 'M -15 -14 H 8 Q 17 -14 20 -5 L 22 0 L 20 5 Q 17 14 8 14 H -15 Q -21 14 -21 8 V -8 Q -21 -14 -15 -14 Z' }),
    svgElement('rect', { class: 'preview-vehicle__window', x: -11, y: -8, width: 19, height: 16, rx: 5 })
  );
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!reduced && motionPath) vehicle.append(svgElement('animateMotion', { dur: '4.6s', repeatCount: '1', fill: 'freeze', path: motionPath, rotate: 'auto' }));
  else {
    const start = nodeById.get('HSS1');
    vehicle.setAttribute('transform', `translate(${start?.x ?? 0} ${start?.y ?? 0})`);
  }
  svg.append(vehicle);
  wrapper.append(svg);
  return wrapper;
}

/** @param {{id:string,label:string,selectedCode?:string,pickupCode?:string,dropoffCode?:string,disabledCodes?:string[],interactive?:boolean,compact?:boolean,showLocationList?:boolean,footer?:Node|null,activeEdgeIds?:string[],activeRouteParts?:Array<{edgeId:string,fromNodeId:string,toNodeId:string,forward:boolean,length:number}>,vehiclePosition?:{segmentId:string,progress:number}|null,animateVehicle?:boolean,onSelect?:(code:string)=>void}} options */
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
  const journeyParts = options.activeRouteParts ?? [];
  const journeyEdges = new Set([...activeEdges, ...journeyParts.map((part) => part.edgeId)]);
  appendRouteNetwork(svg, journeyEdges, options.id, interactive);
  appendJourneyRoute(svg, options.id, journeyParts, options.vehiclePosition);
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
  appendVehicle(svg, options.id, options.vehiclePosition, journeyParts, options.animateVehicle ?? true);

  const list = el('fieldset', { className: `location-list${interactive ? '' : ' location-list--legend'}` },
    el('legend', { className: 'sr-only' }, options.label),
    ...DELIVERY_LOCATIONS.map((location, index) => {
      const inputId = `${options.id}-${location.code}`;
      const input = el('input', { type: 'radio', id: inputId, name: options.id, value: location.code, checked: options.selectedCode === location.code, disabled: !interactive || disabled.has(location.code), onchange: () => options.onSelect?.(location.code) });
      return el('label', { className: `location-option${options.selectedCode === location.code ? ' is-selected' : ''}${disabled.has(location.code) ? ' is-disabled' : ''}`, htmlFor: inputId },
        input,
        el('span', { className: 'location-symbol', 'aria-hidden': 'true' }, options.pickupCode === location.code ? '放' : options.dropoffCode === location.code ? '收' : String(index + 1).padStart(2, '0')),
        el('span', { className: 'location-copy' },
          el('strong', {}, location.name),
          el('span', {}, location.detail),
          disabled.has(location.code) ? el('small', {}, '與放件地點相同，不可選') : null
        )
      );
    })
  );
  const mapPanel = el('div', { className: 'map-panel' }, svg);
  const listPanel = el('div', { className: 'list-panel' }, list);
  let content;
  if (options.compact) {
    content = el('div', { className: 'compact-destination-layout' },
      listPanel,
      el('details', { className: 'route-overview' },
        el('summary', {}, '查看四站路線'),
        mapPanel
      )
    );
  } else {
    const showLocationList = options.showLocationList ?? true;
    content = el('div', {
      className: [
        'map-list-layout',
        options.footer ? 'map-list-layout--with-footer' : '',
        !showLocationList ? 'map-list-layout--map-only' : ''
      ].filter(Boolean).join(' ')
    }, mapPanel, showLocationList ? listPanel : null, options.footer ?? null);
  }
  return el('section', { className: `route-selector${options.compact ? ' route-selector--compact' : ''}`, 'aria-labelledby': headingId },
    el('div', { className: 'route-selector__heading' }, heading, mapHint, keyboardHint),
    content
  );
}
