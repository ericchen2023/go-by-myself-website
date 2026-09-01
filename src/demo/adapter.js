import { DomainError } from '../domain/errors.js';
import { applyDeliveryEvent, allowedEvents } from '../domain/state-machine.js';
import { assertValidDeliveryInput } from '../domain/validation.js';
import { DEMO_SCENARIO_IDS } from '../domain/scenarios.js';
import { locationByCode, positionAlongRoute, shortestRoute, stagingOriginFor } from '../map/route-graph.js';
import { DeterministicClock } from './fake-clock.js';

const STORAGE_KEY = 'go-by-myself:demo:v1';
export const DEMO_PICKUP_CODE = 'NDHU 4826';

/** @returns {any} */
/** demo 的開艙指令狀態，欄位形狀與正式環境 projection 的 command 相同。
 * @param {string} state */
const demoCommand = (state) => ({ type: 'OPEN_COMPARTMENT', state, errorCode: null });

function initialState(scenario = 'happy-path') {
  return {
    mode: 'demo',
    session: null,
    wizardStep: 1,
    scenario,
    draft: {
      pickupCode: '',
      dropoffCode: '',
      recipientName: '',
      recipientPhone: '',
      recipientEmail: '',
      itemType: 'document',
      note: ''
    },
    delivery: null,
    telemetry: {
      position: null,
      vehiclePosition: null,
      observedAt: null,
      connectivity: 'online',
      positionQuality: 'pending',
      activeEdgeIds: []
    },
    commandState: null,
    // 展示模式照著實際開的線走 —— 教一個現實中走不了的流程沒有意義。
    servicePairs: [
      { fromStopCode: 'LIBRARY', toStopCode: 'HSS2' }, { fromStopCode: 'HSS2', toStopCode: 'LIBRARY' },
      { fromStopCode: 'HSS2', toStopCode: 'HSS1' }, { fromStopCode: 'HSS1', toStopCode: 'HSS2' },
      { fromStopCode: 'HSS1', toStopCode: 'ADMIN' }, { fromStopCode: 'ADMIN', toStopCode: 'HSS1' },
      { fromStopCode: 'LIBRARY', toStopCode: 'ADMIN' }, { fromStopCode: 'ADMIN', toStopCode: 'LIBRARY' }
    ],
    notificationState: null,
    recipientAttempt: {
      attempts: 0,
      verified: false,
      phase: 'idle',
      error: ''
    },
    actionError: null,
    command: null,
    vehicle: null,
    pickupCode: null,
    notification: null,
    manualLoadEvidence: false
  };
}

/** @param {Storage | null} storage */
function loadState(storage) {
  if (!storage) return initialState();
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    return value?.mode === 'demo' ? { ...initialState(value.scenario), ...value } : initialState();
  } catch {
    return initialState();
  }
}

export class DemoAdapter {
  /** @param {{storage?: Storage|null, timerScale?: number}} [options] */
  constructor(options = {}) {
    this.mode = 'demo';
    this.storage = options.storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
    this.timerScale = options.timerScale ?? 1;
    this.clock = new DeterministicClock();
    this.state = loadState(this.storage);
    this.listeners = new Set();
    this.timers = new Set();
    this.processedKeys = new Map();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  /** @param {(state: ReturnType<DemoAdapter['snapshot']>) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** @param {Partial<ReturnType<typeof initialState>>} patch */
  #patch(patch) {
    this.state = { ...this.state, ...patch };
    this.#emit();
  }

  /** @param {() => void} callback @param {number} milliseconds */
  #later(callback, milliseconds) {
    const handle = globalThis.setTimeout(() => {
      this.timers.delete(handle);
      callback();
    }, milliseconds * this.timerScale);
    this.timers.add(handle);
  }

  #clearTimers() {
    for (const timer of this.timers) globalThis.clearTimeout(timer);
    this.timers.clear();
  }

  /** @param {string} event @param {'sender'|'recipient'|'robot'|'gateway'|'system'|'operator'} actor @param {Record<string, unknown>} [metadata] */
  #transition(event, actor, metadata = {}) {
    if (!this.state.delivery) throw new DomainError('DELIVERY_NOT_FOUND', '找不到目前投遞。');
    const at = this.clock.now();
    this.state = {
      ...this.state,
      delivery: applyDeliveryEvent(this.state.delivery, event, actor, { ...metadata, at }),
      actionError: null
    };
    this.#emit();
  }

  authenticateGuest() {
    this.#patch({
      session: {
        id: 'demo-student-001',
        displayName: '展示學生',
        email: 'demo.student@gms.ndhu.edu.tw',
        assurance: 'demo_synthetic'
      },
      wizardStep: 2,
      actionError: null
    });
  }

  beginNewDelivery() {
    this.reset();
    this.authenticateGuest();
  }

  /** @param {'login'|'signup'} _intent */
  async signInWithGoogle(_intent) {
    void _intent;
    this.authenticateGuest();
  }

  /** @param {string} _email */
  async signInWithMagicLink(_email) {
    void _email;
    throw new DomainError('AUTH_DEMO_NO_PASSWORD', '展示模式不使用密碼或 magic link。');
  }

  /** demo 沒有真的代號簿，直接交回這一輪那筆的 publicRef。 */
  async resolvePickupRef() {
    return this.state.delivery?.publicRef ?? 'DEMO-PICKUP-0001';
  }

  /** @param {string} _publicRef */
  async loadPickupContext(_publicRef) {
    void _publicRef;
    return this.snapshot();
  }

  signOut() {
    this.reset();
  }

  /** @param {Record<string, unknown>} patch */
  saveDraft(patch) {
    this.#patch({ draft: { ...this.state.draft, ...patch }, actionError: null });
  }

  /** @param {number} step */
  setWizardStep(step) {
    if (step < 1 || step > 4) return;
    this.#patch({ wizardStep: step, actionError: null });
  }

  /** @param {string} scenario */
  setScenario(scenario) {
    if (!DEMO_SCENARIO_IDS.has(scenario)) {
      throw new DomainError('DEMO_SCENARIO_UNKNOWN', '找不到指定的展示情境。');
    }
    this.reset(scenario);
  }

  confirmDraft() {
    const input = assertValidDeliveryInput(this.state.draft);
    const at = this.clock.now();
    const draftDelivery = {
      id: 'demo-delivery-0001',
      publicRef: 'DEMO-PICKUP-0001',
      status: 'draft',
      version: 1,
      ...input,
      createdAt: at,
      updatedAt: at,
      completedAt: null,
      terminalReason: null,
      history: []
    };
    this.state = { ...this.state, delivery: draftDelivery, wizardStep: 5 };
    this.#transition('CONFIRM', 'sender');
  }

  startDispatch(idempotencyKey = 'demo-dispatch-1') {
    if (!this.state.delivery) return;
    if (this.processedKeys.has(idempotencyKey)) return;
    this.processedKeys.set(idempotencyKey, this.state.delivery.version);

    if (this.state.scenario === 'vehicle-busy') {
      this.#patch({
        actionError: { code: 'VEHICLE_UNAVAILABLE', message: '目前沒有可用車輛。展示資料未建立派車結果。', retryable: true }
      });
      return;
    }
    if (this.state.scenario === 'robot-offline-before-dispatch') {
      this.#patch({
        telemetry: { ...this.state.telemetry, connectivity: 'offline' },
        actionError: { code: 'ROBOT_OFFLINE', message: '車輛離線，尚未送出派車命令。', retryable: true }
      });
      return;
    }

    this.#transition('REQUEST_DISPATCH', 'sender');
    this.#patch({ commandState: 'accepted' });
    const pickup = locationByCode(this.state.delivery?.pickupCode ?? '');
    if (!pickup) return;
    this.#animateRoute(shortestRoute(stagingOriginFor(pickup.routeNodeId), pickup.routeNodeId), 'pickup');
  }

  /** @param {ReturnType<typeof shortestRoute>} route @param {'pickup'|'dropoff'} destination */
  #animateRoute(route, destination) {
    const edgeIds = route.map((part) => part.edgeId);
    this.#patch({
      telemetry: {
        ...this.state.telemetry,
        connectivity: 'online',
        positionQuality: 'valid',
        activeEdgeIds: edgeIds,
        position: positionAlongRoute(route, 0),
        observedAt: this.clock.now()
      }
    });

    // A dense deterministic frame sequence makes the schematic vehicle visibly
    // travel the route while preserving the same final state and fake clock.
    const frames = Array.from({ length: 24 }, (_, index) => (index + 1) / 24);
    frames.forEach((progress, index) => {
      this.#later(() => {
        if (this.state.scenario === 'telemetry-stale' && progress >= 0.48) {
          this.#patch({ telemetry: { ...this.state.telemetry, connectivity: 'stale' } });
          return;
        }
        if (this.state.scenario === 'telemetry-off-route' && progress >= 0.48) {
          this.#patch({
            telemetry: { ...this.state.telemetry, positionQuality: 'off_route' },
            actionError: { code: 'ROUTE_MAP_MATCH_FAILED', message: '未驗證位置已隱藏，等待操作人員處理。', retryable: false }
          });
          return;
        }
        if (this.state.telemetry.connectivity !== 'online' || this.state.telemetry.positionQuality === 'off_route') return;
        this.#patch({
          telemetry: {
            ...this.state.telemetry,
            position: positionAlongRoute(route, progress),
            observedAt: this.clock.now()
          }
        });
        if (progress === 1) {
          this.#patch({ commandState: 'completed' });
          if (destination === 'pickup') this.#transition('VEHICLE_ARRIVED_PICKUP', 'gateway');
          else this.#arriveDropoff();
        }
      }, 160 * (index + 1));
    });
  }

  requestSenderOpen(idempotencyKey = 'demo-open-sender-1') {
    if (!this.state.delivery || this.processedKeys.has(idempotencyKey)) return;
    this.processedKeys.set(idempotencyKey, this.state.delivery.version);
    this.#patch({ commandState: 'accepted', command: demoCommand('accepted'), actionError: null });
    const delay = this.state.scenario === 'command-timeout-late-ack' ? 2600 : 550;
    if (this.state.scenario === 'command-timeout-late-ack') {
      this.#later(() => this.#patch({
        commandState: 'unknown',
        command: demoCommand('unknown'),
        actionError: {
          code: 'COMPARTMENT_ACK_TIMEOUT',
          message: '尚未確認艙門已開啟，請勿強行操作；相同命令正在安全恢復。',
          retryable: true
        }
      }), 650);
    }
    this.#later(() => {
      if (this.state.delivery?.status !== 'arrived_pickup') return;
      this.#patch({ commandState: 'completed', command: demoCommand('completed'), actionError: null });
      this.#transition('SENDER_OPEN_COMPLETED', 'gateway');
    }, delay);
  }

  confirmLoaded() {
    if (this.state.delivery?.status !== 'compartment_open_for_sender') return;
    const manual = this.state.scenario === 'compartment-sensor-missing';
    this.#transition('LOAD_CONFIRMED', manual ? 'sender' : 'robot', {
      evidence: manual ? 'audited_manual_confirmation' : 'item_sensor_confirmed'
    });
    this.#patch({ manualLoadEvidence: manual, commandState: 'accepted' });
    this.#later(() => {
      if (this.state.delivery?.status !== 'loaded') return;
      this.#transition('DOOR_CLOSED_AND_DEPARTED', 'gateway', { evidence: 'door_closed' });
      const delivery = this.state.delivery;
      const pickup = locationByCode(delivery.pickupCode);
      const dropoff = locationByCode(delivery.dropoffCode);
      if (!pickup || !dropoff) return;
      this.#animateRoute(shortestRoute(pickup.routeNodeId, dropoff.routeNodeId), 'dropoff');
    }, 650);
  }

  #arriveDropoff() {
    if (this.state.delivery?.status !== 'in_transit') return;
    this.#transition('VEHICLE_ARRIVED_DROPOFF', 'gateway');
    const unconfigured = this.state.scenario === 'notification-provider-unconfigured';
    this.#patch({
      notificationState: unconfigured ? 'unconfigured' : 'queued',
      // 形狀與正式環境 projection 的 notification 相同，寄件人畫面才會照同一套規則走。
      notification: {
        state: unconfigured ? 'unconfigured' : 'queued',
        channel: 'email',
        maskedDestination: unconfigured ? '' : 'n***@example.com'
      }
    });
    this.#later(() => {
      if (this.state.delivery?.status !== 'arrived_dropoff') return;
      this.#transition('CREDENTIALS_ACTIVE', 'system');
      if (this.state.notificationState !== 'unconfigured') this.#patch({ notificationState: 'accepted' });
    }, 600);
  }

  /** @param {string} rawCode */
  redeemCredential(rawCode) {
    const normalized = rawCode.toUpperCase().replace(/[\s-]/g, '');
    const recipientAttempt = { ...this.state.recipientAttempt };
    if (recipientAttempt.attempts >= 5) {
      recipientAttempt.error = '嘗試次數過多，展示取件憑證已鎖定。';
      recipientAttempt.phase = 'locked';
      this.#patch({ recipientAttempt });
      return false;
    }
    if (normalized !== 'NDHU4826') {
      recipientAttempt.attempts += 1;
      recipientAttempt.error = '取件資訊無效或已失效。';
      recipientAttempt.phase = recipientAttempt.attempts >= 5 ? 'locked' : 'idle';
      this.#patch({ recipientAttempt });
      return false;
    }
    if (this.state.delivery?.status !== 'awaiting_recipient') {
      recipientAttempt.error = '車輛尚未準備好，請稍候再試。';
      this.#patch({ recipientAttempt });
      return false;
    }
    recipientAttempt.verified = true;
    recipientAttempt.phase = 'opening';
    recipientAttempt.error = '';
    this.#patch({ recipientAttempt, commandState: 'accepted' });
    this.#later(() => {
      if (this.state.delivery?.status !== 'awaiting_recipient') return;
      this.#transition('RECIPIENT_OPEN_COMPLETED', 'gateway');
      this.#patch({
        commandState: 'completed',
        recipientAttempt: { ...this.state.recipientAttempt, phase: 'open' }
      });
    }, 650);
    return true;
  }

  confirmPickup() {
    if (this.state.delivery?.status !== 'compartment_open_for_recipient') return;
    this.#patch({ recipientAttempt: { ...this.state.recipientAttempt, phase: 'confirming' } });
    this.#transition('ITEM_REMOVED_AND_DOOR_CLOSED', 'robot', {
      evidence: 'demo_item_removed_and_door_closed'
    });
    this.#later(() => {
      if (this.state.delivery?.status !== 'picked_up') return;
      this.#transition('CUSTODY_CONFIRMED', 'system');
      this.#patch({ recipientAttempt: { ...this.state.recipientAttempt, phase: 'confirmed' } });
    }, 500);
  }

  requestCancel() {
    const status = this.state.delivery?.status;
    if (!status) return;
    if (status === 'draft') return this.#transition('CANCEL_DRAFT', 'sender');
    if (status === 'confirmed') return this.#transition('CANCEL_UNRESERVED', 'sender');
    if (!allowedEvents(status).includes('REQUEST_CANCEL')) {
      this.#patch({
        actionError: { code: 'DELIVERY_INVALID_TRANSITION', message: '目前狀態不能由寄件人直接取消，請使用協助流程。', retryable: false }
      });
      return;
    }
    this.#transition('REQUEST_CANCEL', 'sender');
    this.#later(() => {
      if (this.state.delivery?.status !== 'cancel_requested') return;
      this.#transition('SAFE_RETURN_SELECTED', 'operator', { evidence: 'demo_safe_return_policy' });
    }, 500);
    this.#later(() => {
      if (this.state.delivery?.status !== 'returning_to_base') return;
      this.#transition('ITEM_CUSTODY_RESOLVED', 'operator', { reason: 'demo_custody_resolved' });
    }, 1200);
  }

  clearError() {
    this.#patch({ actionError: null });
  }

  /** @param {string} [scenario] */
  reset(scenario = this.state.scenario) {
    this.#clearTimers();
    this.clock = new DeterministicClock();
    this.processedKeys.clear();
    this.state = initialState(scenario);
    this.storage?.removeItem(STORAGE_KEY);
    this.#emit();
  }
}

export function createRuntimeAdapter() {
  return new DemoAdapter();
}
