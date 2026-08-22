import { createClient } from '@supabase/supabase-js';
import { DomainError } from '../domain/errors.js';
import { assertValidDeliveryInput } from '../domain/validation.js';
import { runtimeConfig, assertProductionBrowserConfig } from '../config/runtime.js';

/** @returns {any} */
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
      connectivity: 'offline',
      positionQuality: 'pending',
      activeEdgeIds: []
    },
    commandState: null,
    notificationState: null,
    recipientAttempt: { attempts: 0, verified: false, phase: 'idle', error: '' },
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
    this.#patch({
      session: {
        id: session.user.id,
        displayName: String(session.user.user_metadata?.full_name ?? '東華使用者'),
        email: session.user.email ?? '',
        assurance
      },
      wizardStep: 2,
      actionError: assurance === 'pending'
        ? { code: 'AUTH_DOMAIN_NOT_ALLOWED', message: '帳號仍待 trusted hosted-domain gate 驗證。', retryable: false }
        : null
    });
    if (assurance !== 'pending') await this.#loadActiveDelivery();
  }

  async signInWithGoogle(intent = 'login') {
    const client = this.#requireClient();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: new URL('/', window.location.origin).toString(),
        queryParams: { hd: 'gms.ndhu.edu.tw', prompt: intent === 'signup' ? 'select_account' : 'select_account' }
      }
    });
    if (error) throw new DomainError('AUTH_PROVIDER_ERROR', '無法啟動 Google 登入。', { retryable: true });
  }

  /** @param {string} email */
  async signInWithMagicLink(email) {
    const normalized = email.trim().toLowerCase();
    if (!normalized.endsWith('@gms.ndhu.edu.tw')) {
      throw new DomainError('AUTH_DOMAIN_NOT_ALLOWED', 'Magic link 僅接受 gms.ndhu.edu.tw 帳號。');
    }
    const client = this.#requireClient();
    const { error } = await client.auth.signInWithOtp({
      email: normalized,
      options: { emailRedirectTo: new URL('/', window.location.origin).toString(), shouldCreateUser: true }
    });
    if (error) throw new DomainError('AUTH_PROVIDER_ERROR', '無法寄送專題登入連結。', { retryable: true });
  }

  async signOut() {
    const client = this.#requireClient();
    await client.auth.signOut();
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
    this.#patch({ delivery: projection.delivery, wizardStep: 5, actionError: null });
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
    this.#patch({ ...projection, actionError: null });
  }

  clearError() {
    this.#patch({ actionError: null });
  }

  async beginNewDelivery() {
    if (this.channel && this.supabase) {
      await this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    const session = this.state.session;
    this.#patch({ ...initialState(), session, wizardStep: session ? 2 : 1 });
  }

  async #sendIntent(intent, idempotencyKey) {
    if (!this.state.delivery) throw new DomainError('DELIVERY_NOT_FOUND', '找不到目前投遞。');
    const projection = await this.#invoke(intent, { deliveryId: this.state.delivery.id }, this.state.delivery.version, idempotencyKey);
    this.#patch({ ...projection, actionError: null });
  }

  async #invoke(intent, payload, expectedVersion, idempotencyKey = crypto.randomUUID()) {
    const client = this.#requireClient();
    const { data, error } = await client.functions.invoke('delivery-intent', {
      body: { schemaVersion: 1, intent, expectedVersion, idempotencyKey, ...payload }
    });
    if (error) throw new DomainError('DELIVERY_INTENT_FAILED', '投遞操作未完成，請依 request reference 安全重試。', { retryable: true });
    return data.data;
  }

  async #publicInvoke(intent, payload) {
    const client = this.#requireClient();
    const { data, error } = await client.functions.invoke('pickup', {
      body: { schemaVersion: 1, intent, ...payload }
    });
    if (error) throw new DomainError('PICKUP_CREDENTIAL_INVALID', '取件資訊無效或已失效。');
    return data.data;
  }

  async #loadActiveDelivery() {
    const projection = await this.#invoke('GET_ACTIVE_DELIVERY', {}, 0);
    if (projection?.delivery) {
      this.#patch({ ...projection, wizardStep: 5 });
      await this.#subscribeToDelivery(projection.delivery.id);
    }
  }

  async #subscribeToDelivery(deliveryId) {
    const client = this.#requireClient();
    if (this.channel) await client.removeChannel(this.channel);
    this.channel = client.channel(`delivery:${deliveryId}`, { config: { private: true } });
    this.channel.on('broadcast', { event: 'projection' }, ({ payload }) => {
      const currentVersion = this.state.delivery?.version ?? -1;
      if (payload?.delivery?.version > currentVersion) this.#patch(payload);
    });
    await this.channel.subscribe();
  }
}

export function createRuntimeAdapter() {
  return new ProductionAdapter();
}
