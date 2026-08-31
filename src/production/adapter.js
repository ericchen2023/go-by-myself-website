import { createClient } from '@supabase/supabase-js';
import { DomainError } from '../domain/errors.js';
import { assertValidDeliveryInput } from '../domain/validation.js';
import { runtimeConfig, assertProductionBrowserConfig } from '../config/runtime.js';

/** @returns {any} */
/**
 * Recovers the Edge Function's own error envelope from a supabase-js
 * FunctionsHttpError, whose `context` is the unread Response.
 * @param {unknown} error
 */
export async function edgeErrorEnvelope(error) {
  const context = error && typeof error === 'object' ? Reflect.get(error, 'context') : null;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const source = typeof context.clone === 'function' ? context.clone() : context;
    const body = await source.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

/**
 * Reports the cause the Edge Function actually returned. Collapsing every
 * failure into one code makes VEHICLE_UNAVAILABLE, DELIVERY_INVALID_TRANSITION
 * and an expired session indistinguishable to whoever has to act on them.
 * @param {Record<string, any> | null} body
 * @param {{code: string, message: string, retryable: boolean}} fallback
 */
export function domainErrorFrom(body, fallback) {
  const detail = body?.error;
  const code = typeof detail?.code === 'string' && detail.code ? detail.code : fallback.code;
  const message = typeof detail?.message === 'string' && detail.message ? detail.message : fallback.message;
  const reference = typeof body?.requestId === 'string' && body.requestId ? body.requestId : '';
  const retryable = typeof detail?.retryable === 'boolean' ? detail.retryable : fallback.retryable;
  return new DomainError(code, reference ? `${message}（request reference: ${reference}）` : message, { retryable });
}

function initialState() {
  return {
    mode: 'production',
    session: null,
    wizardStep: 1,
    scenario: null,
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
      observedAt: null,
      receivedAt: null,
      connectivity: 'offline',
      positionQuality: 'pending',
      activeEdgeIds: [],
      projectionVersion: 0,
      vehicleState: 'idle',
      routePhase: null,
      routeFromStopCode: null,
      routeToStopCode: null,
      legIndex: null,
      legCount: null
    },
    commandState: null,
    notificationState: null,
    recipientAttempt: { attempts: 0, verified: false, phase: 'idle', error: '' },
    routeValidation: {
      capabilityEnabled: false,
      mappingStatus: 'unapproved',
      vehicles: [],
      legs: [],
      activeRun: null,
      loading: false
    },
    actionError: null,
    manualLoadEvidence: false
  };
}

export class ProductionAdapter {
  constructor() {
    this.mode = 'production';
    this.state = initialState();
    this.listeners = new Set();
    this.supabase = runtimeConfig.supabaseUrl && runtimeConfig.supabasePublishableKey
      ? createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
      : null;
    this.channel = null;
    this.routeValidationChannel = null;
    this.connectivityTimer = null;
    this.deliveryRefreshTimer = null;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  /** @param {(state: ReturnType<ProductionAdapter['snapshot']>) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #patch(patch) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  #withLocalTelemetryReceipt(projection) {
    if (!projection?.telemetry) return projection;
    const receivedAt = projection.telemetry.connectivity === 'online'
      ? new Date().toISOString()
      : this.state.telemetry?.receivedAt ?? null;
    return { ...projection, telemetry: { ...projection.telemetry, receivedAt } };
  }

  #requireClient() {
    try {
      assertProductionBrowserConfig();
    } catch (error) {
      throw new DomainError('ENV_CONFIG_INVALID', error instanceof Error ? error.message : 'Production 環境未設定。');
    }
    if (!this.supabase) throw new DomainError('ENV_CONFIG_INVALID', 'Production Supabase client 尚未設定。');
    return this.supabase;
  }

  async initialize() {
    if (!this.supabase) {
      this.#patch({
        actionError: {
          code: 'ENV_CONFIG_INVALID',
          message: 'Production build 尚未連接 staging/production control plane；guest simulator 已停用。',
          retryable: false
        }
      });
      return;
    }
    const { data, error } = await this.supabase.auth.getSession();
    if (error) throw new DomainError('AUTH_SESSION_EXPIRED', '無法取得登入狀態。', { retryable: true });
    if (data.session) await this.#applySession(data.session);
    this.supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void this.#applySession(session);
      else this.#patch({ session: null, delivery: null, wizardStep: 1 });
    });
  }

  async #applySession(session) {
    let assurance = 'pending';
    if (this.supabase) {
      const assuranceResult = await this.supabase.rpc('finalize_auth_assurance');
      if (!assuranceResult.error && typeof assuranceResult.data === 'string') assurance = assuranceResult.data;
    }
    const workspaceResult = assurance !== 'pending' && this.supabase
      ? await this.supabase.rpc('get_operator_route_validation_workspace')
      : { data: null, error: null };
    const isOperator = !workspaceResult.error && workspaceResult.data && !workspaceResult.data.error;
    this.#patch({
      session: {
        id: session.user.id,
        displayName: String(session.user.user_metadata?.full_name ?? 'Google 使用者'),
        email: session.user.email ?? '',
        assurance,
        roles: isOperator ? ['operator'] : []
      },
      ...(isOperator ? { routeValidation: { ...this.state.routeValidation, ...workspaceResult.data } } : {}),
      wizardStep: 2,
      actionError: assurance === 'pending'
        ? { code: 'AUTH_EMAIL_UNVERIFIED', message: 'Google 尚未確認此帳號的 Email，無法啟用投遞功能。', retryable: false }
        : null
    });
    if (assurance !== 'pending') await this.#loadActiveDelivery();
  }

  async signInWithGoogle() {
    if (!runtimeConfig.googleAuthEnabled) {
      throw new DomainError('AUTH_PROVIDER_UNAVAILABLE', 'Google 登入尚未在此環境啟用。');
    }
    const client = this.#requireClient();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL('/', window.location.origin).toString(),
        queryParams: { prompt: 'select_account' }
      }
    });
    if (error) throw new DomainError('AUTH_PROVIDER_ERROR', '無法啟動 Google 登入。', { retryable: true });
  }

  async signOut() {
    const client = this.#requireClient();
    await client.auth.signOut();
    this.#stopConnectivityClock();
    this.#patch({ ...initialState() });
  }

  /** @param {Record<string, unknown>} patch */
  saveDraft(patch) {
    this.#patch({ draft: { ...this.state.draft, ...patch }, actionError: null });
  }

  /** @param {number} step */
  setWizardStep(step) {
    if (step >= 1 && step <= 4) this.#patch({ wizardStep: step, actionError: null });
  }

  async confirmDraft() {
    const input = assertValidDeliveryInput(this.state.draft);
    const projection = await this.#invoke('CREATE_AND_CONFIRM', { input }, 0);
    this.#patch({ ...this.#withLocalTelemetryReceipt(projection), wizardStep: 5, actionError: null });
    await this.#subscribeToDelivery(projection.delivery.id);
  }

  async startDispatch(idempotencyKey = crypto.randomUUID()) {
    await this.#sendIntent('REQUEST_DISPATCH', idempotencyKey);
  }

  async requestSenderOpen(idempotencyKey = crypto.randomUUID()) {
    await this.#sendIntent('REQUEST_SENDER_OPEN', idempotencyKey);
  }

  async confirmLoaded() {
    await this.#sendIntent('LOAD_CONFIRMED', crypto.randomUUID());
  }

  async requestCancel() {
    await this.#sendIntent('REQUEST_CANCEL', crypto.randomUUID());
  }

  /** @param {string} rawCode */
  async redeemCredential(rawCode) {
    if (!this.state.delivery) return false;
    try {
      const projection = await this.#publicInvoke('REDEEM_PICKUP_CREDENTIAL', {
        publicRef: this.state.delivery.publicRef,
        code: rawCode,
        idempotencyKey: crypto.randomUUID()
      });
      this.#patch({ recipientAttempt: { ...this.state.recipientAttempt, verified: true, phase: 'opening', error: '' }, ...projection });
      return true;
    } catch {
      this.#patch({ recipientAttempt: { ...this.state.recipientAttempt, error: '取件資訊無效或已失效。' } });
      return false;
    }
  }

  async confirmPickup() {
    throw new DomainError('DELIVERY_INVALID_TRANSITION', 'Production pickup completion 只能由 robot evidence 或受稽核 operator intent 建立。');
  }

  /** @param {string} publicRef */
  async loadPickupContext(publicRef) {
    const projection = await this.#publicInvoke('GET_PICKUP_CONTEXT', { publicRef });
    this.#patch({ ...this.#withLocalTelemetryReceipt(projection), actionError: null });
  }

  clearError() {
    this.#patch({ actionError: null });
  }

  async beginNewDelivery() {
    if (this.channel && this.supabase) {
      await this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    if (this.routeValidationChannel && this.supabase) {
      await this.supabase.removeChannel(this.routeValidationChannel);
      this.routeValidationChannel = null;
    }
    this.#stopConnectivityClock();
    const session = this.state.session;
    this.#patch({ ...initialState(), session, wizardStep: session ? 2 : 1 });
  }

  async loadRouteValidationWorkspace() {
    const client = this.#requireClient();
    this.#patch({ routeValidation: { ...this.state.routeValidation, loading: true } });
    const { data, error } = await client.rpc('get_operator_route_validation_workspace');
    if (error || data?.error) throw new DomainError('RLS_DENIED', '此頁面只開放給已授權的操作人員。');
    this.#patch({ routeValidation: { ...this.state.routeValidation, ...data, loading: false } });
    if (data.activeRun?.routeJob?.id) await this.#subscribeToRouteValidation(data.activeRun.routeJob.id);
  }

  async startRouteValidation(vehicleId, legId, idempotencyKey = crypto.randomUUID()) {
    const client = this.#requireClient();
    const { data, error } = await client.rpc('create_route_validation_job', {
      p_vehicle_id: vehicleId,
      p_leg_id: legId,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw new DomainError('PHYSICAL_CAPABILITY_DISABLED', '實體站點對照或車輛能力尚未完成簽核，不能開始路線驗證。');
    this.#patch({ routeValidation: { ...this.state.routeValidation, activeRun: data } });
    await this.#subscribeToRouteValidation(data.routeJob.id);
  }

  async requestRouteValidationStop(idempotencyKey = crypto.randomUUID()) {
    const runId = this.state.routeValidation.activeRun?.routeJob?.id;
    if (!runId) throw new DomainError('DELIVERY_INVALID_TRANSITION', '目前沒有可停止的路線驗證。');
    const client = this.#requireClient();
    const { data, error } = await client.rpc('request_route_validation_stop', {
      p_route_job_id: runId,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw new DomainError('ROBOT_COMMAND_TIMEOUT', '安全停止要求尚未被控制平面接受。', { retryable: true });
    this.#patch({ routeValidation: { ...this.state.routeValidation, activeRun: data } });
  }

  async #sendIntent(intent, idempotencyKey) {
    if (!this.state.delivery) throw new DomainError('DELIVERY_NOT_FOUND', '找不到目前投遞。');
    const projection = await this.#invoke(intent, { deliveryId: this.state.delivery.id }, this.state.delivery.version, idempotencyKey);
    this.#patch({ ...this.#withLocalTelemetryReceipt(projection), actionError: null });
  }

  async #invoke(intent, payload, expectedVersion, idempotencyKey = crypto.randomUUID()) {
    const client = this.#requireClient();
    const { data, error } = await client.functions.invoke('delivery-intent', {
      body: { schemaVersion: 1, intent, expectedVersion, idempotencyKey, ...payload }
    });
    if (error) {
      throw domainErrorFrom(await edgeErrorEnvelope(error), {
        code: 'DELIVERY_INTENT_FAILED',
        message: '投遞操作未完成，請依 request reference 安全重試。',
        retryable: true
      });
    }
    return data.data;
  }

  async #publicInvoke(intent, payload) {
    const client = this.#requireClient();
    const { data, error } = await client.functions.invoke('pickup', {
      body: { schemaVersion: 1, intent, ...payload }
    });
    // Deliberately generic: the pickup endpoint is unauthenticated and already
    // collapses its own failures into one code so a credential cannot be probed.
    if (error) throw new DomainError('PICKUP_CREDENTIAL_INVALID', '取件資訊無效或已失效。');
    return data.data;
  }

  async #loadActiveDelivery() {
    const projection = await this.#invoke('GET_ACTIVE_DELIVERY', {}, 0);
    if (projection?.delivery) {
      this.#patch({ ...this.#withLocalTelemetryReceipt(projection), wizardStep: 5 });
      await this.#subscribeToDelivery(projection.delivery.id);
    }
  }

  async #subscribeToDelivery(deliveryId) {
    const client = this.#requireClient();
    if (this.channel) await client.removeChannel(this.channel);
    let subscribedOnce = false;
    this.channel = client.channel(`delivery:${deliveryId}`, { config: { private: true } });
    this.channel.on('broadcast', { event: 'projection' }, ({ payload }) => {
      const currentVersion = this.state.delivery?.version ?? -1;
      const currentProjection = this.state.telemetry?.projectionVersion ?? -1;
      const nextVersion = payload?.delivery?.version ?? -1;
      const nextProjection = payload?.telemetry?.projectionVersion ?? -1;
      if (nextVersion > currentVersion || nextProjection > currentProjection) this.#patch(this.#withLocalTelemetryReceipt(payload));
    });
    await this.channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (subscribedOnce) void this.refreshActiveDeliverySnapshot();
      subscribedOnce = true;
    });
    this.#startConnectivityClock();
    this.#startDeliveryRefreshClock();
  }

  async #subscribeToRouteValidation(routeJobId) {
    const client = this.#requireClient();
    if (this.routeValidationChannel) await client.removeChannel(this.routeValidationChannel);
    let subscribedOnce = false;
    this.routeValidationChannel = client.channel(`route-validation:${routeJobId}`, { config: { private: true } });
    this.routeValidationChannel.on('broadcast', { event: 'projection' }, ({ payload }) => {
      const currentUpdatedAt = this.state.routeValidation.activeRun?.routeJob?.updatedAt ?? '';
      if ((payload?.routeJob?.updatedAt ?? '') >= currentUpdatedAt) {
        this.#patch({ routeValidation: { ...this.state.routeValidation, activeRun: payload } });
      }
    });
    await this.routeValidationChannel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (subscribedOnce) void this.#refreshRouteValidationSnapshot();
      subscribedOnce = true;
    });
  }

  /** Re-reads the sender's delivery from the server. Public so the recovery path can be tested. */
  async refreshActiveDeliverySnapshot() {
    try {
      const projection = await this.#invoke('GET_ACTIVE_DELIVERY', {}, 0);
      if (!projection?.delivery) {
        // The server has no delivery in flight for this sender, so the one on
        // screen has reached a terminal state. Comparing versions here left the
        // page showing it for ever — nothing is newer than a delivery that no
        // longer exists — and with no way back to the form the reader could not
        // start another one.
        if (this.state.delivery && await this.#confirmNoDelivery()) await this.#returnToNewDelivery();
        return;
      }
      const currentVersion = this.state.delivery?.version ?? -1;
      const currentProjection = this.state.telemetry?.projectionVersion ?? -1;
      if ((projection.delivery.version ?? -1) > currentVersion || (projection?.telemetry?.projectionVersion ?? -1) > currentProjection) {
        this.#patch(this.#withLocalTelemetryReceipt(projection));
      }
    } catch {
      this.#patch({ actionError: { code: 'REALTIME_RESYNC_FAILED', message: '重新連線後無法取得最新投遞狀態。', retryable: true } });
    }
  }

  async #refreshRouteValidationSnapshot() {
    try {
      const client = this.#requireClient();
      const { data, error } = await client.rpc('get_operator_route_validation_workspace');
      if (error || data?.error) throw error ?? new Error('RLS_DENIED');
      this.#patch({ routeValidation: { ...this.state.routeValidation, ...data } });
    } catch {
      this.#patch({ actionError: { code: 'REALTIME_RESYNC_FAILED', message: '重新連線後無法取得最新路線驗證狀態。', retryable: true } });
    }
  }

  /**
   * One empty read can be a blip; the screen is only cleared when a second read
   * agrees, so a delivery still in flight is never taken away from its sender.
   * A throw here leaves the delivery on screen, which is the safe direction.
   */
  async #confirmNoDelivery() {
    const confirmation = await this.#invoke('GET_ACTIVE_DELIVERY', {}, 0);
    return !confirmation?.delivery;
  }

  /** Back to a blank form, with the finished delivery's channel let go. */
  async #returnToNewDelivery() {
    const client = this.supabase;
    if (this.channel && client) {
      const channel = this.channel;
      this.channel = null;
      await client.removeChannel(channel);
    }
    this.#stopConnectivityClock();
    this.#stopDeliveryRefreshClock();
    const fresh = initialState();
    this.#patch({
      delivery: fresh.delivery,
      draft: fresh.draft,
      telemetry: fresh.telemetry,
      commandState: fresh.commandState,
      wizardStep: 1,
      actionError: null
    });
  }

  /**
   * Realtime is the fast path, not the only one. When a broadcast is missed the
   * page has no other way to learn its delivery ended, and it strands there.
   */
  #startDeliveryRefreshClock() {
    this.#stopDeliveryRefreshClock();
    this.deliveryRefreshTimer = window.setInterval(() => {
      void this.refreshActiveDeliverySnapshot();
    }, 15_000);
  }

  #stopDeliveryRefreshClock() {
    if (this.deliveryRefreshTimer) window.clearInterval(this.deliveryRefreshTimer);
    this.deliveryRefreshTimer = null;
  }

  #startConnectivityClock() {
    this.#stopConnectivityClock();
    this.connectivityTimer = window.setInterval(() => {
      const receivedAt = this.state.telemetry?.receivedAt;
      if (!receivedAt) return;
      const age = Date.now() - Date.parse(receivedAt);
      const connectivity = age >= 60_000 ? 'offline' : age >= 10_000 ? 'stale' : 'online';
      if (connectivity !== this.state.telemetry.connectivity) {
        this.#patch({ telemetry: { ...this.state.telemetry, connectivity } });
      }
    }, 1_000);
  }

  #stopConnectivityClock() {
    if (this.connectivityTimer) window.clearInterval(this.connectivityTimer);
    this.connectivityTimer = null;
  }
}

export function createRuntimeAdapter() {
  return new ProductionAdapter();
}
