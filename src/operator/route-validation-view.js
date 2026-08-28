import { el } from '../app/dom.js';
import { createRouteSelector } from '../map/map-view.js';
import { locationByCode, shortestRoute } from '../map/route-graph.js';

const terminalStates = new Set(['completed', 'cancelled', 'failed']);

function metric(label, value, tone = '') {
  return el('div', { className: `operator-metric${tone ? ` operator-metric--${tone}` : ''}` },
    el('dt', {}, label),
    el('dd', {}, value ?? '—')
  );
}

function batteryCopy(battery) {
  if (Number.isFinite(battery?.percent)) return `${Math.round(battery.percent)}%`;
  if (Number.isFinite(battery?.voltageV)) return `${Number(battery.voltageV).toFixed(1)} V（百分比尚未校正）`;
  return '尚未校正';
}

/**
 * @param {{workspace:any,selection:{vehicleId:string,legId:string},busy:boolean,onSelection:(patch:Record<string,string>)=>void,onStart:()=>void,onStop:()=>void}} options
 */
export function routeValidationView(options) {
  const workspace = options.workspace;
  const run = workspace.activeRun;
  const job = run?.routeJob;
  const vehicle = run?.vehicle;
  const route = run?.route;
  const mappedLegs = workspace.legs.filter((leg) => leg.mappingApproved);
  const selectedVehicle = options.selection.vehicleId || workspace.vehicles[0]?.id || '';
  const selectedLeg = options.selection.legId || mappedLegs[0]?.legId || '';
  const from = locationByCode(job?.fromStopCode);
  const to = locationByCode(job?.toStopCode);
  const parts = from && to ? shortestRoute(from.routeNodeId, to.routeNodeId) : [];
  const markerAllowed = ['valid', 'degraded'].includes(vehicle?.quality) && route?.segmentId;
  const isRunning = job && !terminalStates.has(job.state);

  const controls = el('form', { className: 'operator-controls', novalidate: true },
    el('div', { className: 'field' },
      el('label', { htmlFor: 'validation-vehicle' }, '驗證車輛'),
      el('select', {
        id: 'validation-vehicle',
        value: selectedVehicle,
        disabled: isRunning || !workspace.vehicles.length,
        onchange: (event) => options.onSelection({ vehicleId: event.currentTarget.value })
      },
      ...workspace.vehicles.map((item) => el('option', { value: item.id, selected: item.id === selectedVehicle }, `${item.displayName}｜${item.operationalStatus}`)))
    ),
    el('div', { className: 'field' },
      el('label', { htmlFor: 'validation-leg' }, '已核准的實體路段'),
      el('select', {
        id: 'validation-leg',
        value: selectedLeg,
        disabled: isRunning || !mappedLegs.length,
        onchange: (event) => options.onSelection({ legId: event.currentTarget.value })
      },
      mappedLegs.length
        ? mappedLegs.map((leg) => el('option', { value: leg.legId, selected: leg.legId === selectedLeg }, `${locationByCode(leg.fromStopCode)?.name ?? leg.physicalFrom} → ${locationByCode(leg.toStopCode)?.name ?? leg.physicalTo}`))
        : el('option', { value: '' }, '尚無已核准路段'))
    ),
    el('div', { className: 'operator-controls__action' },
      isRunning
        ? el('button', { className: 'button button--danger-ghost', type: 'button', disabled: options.busy || job.state === 'safe_stop_requested', onclick: options.onStop }, job.state === 'safe_stop_requested' ? '安全停止要求已送出' : '要求安全停止')
        : el('button', { className: 'button button--primary', type: 'button', disabled: options.busy || !workspace.capabilityEnabled || !selectedVehicle || !selectedLeg, onclick: options.onStart }, '開始路線驗證')
    )
  );

  const gate = !workspace.capabilityEnabled
    ? el('section', { className: 'operator-gate', role: 'status' },
      el('strong', {}, '實機能力目前關閉'),
      el('p', {}, workspace.mappingStatus === 'unapproved'
        ? 'A／B／C／D 與四個公開站點尚未全部簽核。簽核完成前，系統不會建立真車 route job。'
        : '車輛尚未完成 route-validation capability provisioning。'))
    : null;

  const monitor = run ? el('section', { className: 'operator-monitor', 'aria-labelledby': 'route-monitor-title' },
    el('div', { className: 'operator-monitor__heading' },
      el('div', {},
        el('p', { className: 'eyebrow' }, '空載・現場監督'),
        el('h2', { id: 'route-monitor-title' }, `${from?.name ?? job.fromStopCode} → ${to?.name ?? job.toStopCode}`),
        el('p', {}, job.state === 'safe_stop_requested' ? '正在等待車端完成安全停止；這不是遠端緊急停止。' : '此流程只驗證路線、連線與命令，不載物，也不變更任何投遞狀態。')
      ),
      el('span', { className: `status-chip status-chip--${vehicle?.connectivity ?? 'offline'}` }, vehicle?.connectivity ?? 'offline')
    ),
    createRouteSelector({
      id: `route-validation-${job.id}`,
      label: '四站路線與車輛位置',
      pickupCode: job.fromStopCode,
      dropoffCode: job.toStopCode,
      interactive: false,
      activeRouteParts: parts,
      activeEdgeIds: parts.map((part) => part.edgeId),
      vehiclePosition: markerAllowed ? { segmentId: route.segmentId, progress: route.progress } : null,
      animateVehicle: vehicle?.quality === 'valid' && vehicle?.connectivity === 'online'
    }),
    el('dl', { className: 'operator-metrics' },
      metric('車輛狀態', vehicle?.state),
      metric('SLAM 品質', vehicle?.quality, vehicle?.quality === 'valid' ? 'good' : 'warning'),
      metric('目前路段', route?.legId ?? '等待路段'),
      metric('路段進度', Number.isFinite(route?.progress) ? `${Math.round(route.progress * 100)}%` : '等待定位'),
      metric('橫向誤差', Number.isFinite(route?.lateralM) ? `${Number(route.lateralM).toFixed(2)} m` : '—'),
      metric('電池', batteryCopy(vehicle?.battery))
    ),
    el('details', { className: 'operator-diagnostics' },
      el('summary', {}, '工程診斷資料'),
      el('dl', {},
        metric('座標框架', run.diagnostics?.frameId),
        metric('原始位置', Number.isFinite(run.diagnostics?.x) ? `(${run.diagnostics.x}, ${run.diagnostics.y})` : '—'),
        metric('朝向', Number.isFinite(run.diagnostics?.heading) ? `${run.diagnostics.heading}°` : '—'),
        metric('Boot ID', run.diagnostics?.bootId),
        metric('Sequence', run.diagnostics?.sequence)
      )
    )
  ) : el('section', { className: 'operator-empty' },
    el('h2', {}, '尚未開始路線驗證'),
    el('p', {}, '選擇已核准車輛與路段後，才會建立空載 route job。'));

  return el('main', { id: 'main-content', className: 'operator-page' },
    el('header', { className: 'operator-page__intro' },
      el('p', { className: 'eyebrow' }, '受保護的操作人員工作區'),
      el('h1', {}, '路線驗證'),
      el('p', {}, '將控制、定位與公開投遞分開驗證。現場人員必須持有實體 e-stop；網站按鈕只會提出安全停止要求。')
    ),
    gate,
    controls,
    monitor
  );
}
