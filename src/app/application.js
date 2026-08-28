import { el, liveRegion, ndhuEmblem } from './dom.js';
import { homeScreen } from './home.js';
import {
  emptyState,
  errorBanner,
  fieldShell,
  siteFooter,
  siteHeader,
  statusHero,
  stepper,
  summaryItem
} from './components.js';
import { createRouteSelector } from '../map/map-view.js';
import { locationByCode, shortestRoute } from '../map/route-graph.js';
import { ITEM_TYPES, maskEmail, maskPhone, validateDeliveryInput } from '../domain/validation.js';
import { notificationCopy, stepForStatus } from '../domain/presentation.js';
import { routeValidationView } from '../operator/route-validation-view.js';
import {
  authAlternative,
  cancelledCopy,
  credentialCallout,
  dispatchIntro,
  googleDisabled,
  googleHelp,
  loadButtonLabel,
  manualLoadNotice,
  modeBanner,
  modePrivacyLead,
  modeSupportSection,
  modeToolbar,
  notificationDisclaimer,
  pickupOpenAction,
  recipientBadge,
  recoveryText,
  supportCopy
} from '#mode-presentation';

export class Application {
  /** @param {HTMLElement} root @param {any} adapter */
  constructor(root, adapter) {
    this.root = root;
    this.adapter = adapter;
    this.state = adapter.snapshot();
    /** @type {'login'|'signup'} */
    this.authTab = 'login';
    this.recoveryOpen = false;
    this.uiError = null;
    /** @type {Record<string, string>} */
    this.fieldErrors = {};
    this.busy = false;
    this.operatorSelection = { vehicleId: '', legId: '' };
    this.route = window.location.pathname;
    this.unsubscribe = adapter.subscribe((state) => {
      this.state = state;
      this.render();
    });
    window.addEventListener('popstate', () => {
      this.route = window.location.pathname;
      this.render();
    });
  }

  async start() {
    this.render();
    if (typeof this.adapter.initialize === 'function') {
      await this.#run(() => this.adapter.initialize(), false);
    }
    if (this.route === '/' && this.state.session) {
      this.navigate(this.state.delivery ? '/delivery/current' : '/delivery/new');
    }
    if (this.route.startsWith('/pickup/') && typeof this.adapter.loadPickupContext === 'function') {
      const publicRef = decodeURIComponent(this.route.split('/').pop() ?? '');
      await this.#run(() => this.adapter.loadPickupContext(publicRef), false);
    }
    if (this.route === '/operator/route-validation' && typeof this.adapter.loadRouteValidationWorkspace === 'function') {
      await this.#run(() => this.adapter.loadRouteValidationWorkspace(), false);
    }
  }

  /** @param {string} path */
  navigate(path) {
    if (path !== window.location.pathname) window.history.pushState({}, '', path);
    this.route = path;
    window.scrollTo({ top: 0, behavior: 'instant' });
    this.render();
  }

  /** @param {number} step */
  #setWizardStep(step) {
    this.adapter.setWizardStep(step);
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => {
      const heading = /** @type {HTMLElement|null} */ (document.querySelector('#main-content h1'));
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
    });
  }

  /** @param {() => unknown|Promise<unknown>} action @param {boolean} [markBusy] */
  async #run(action, markBusy = true) {
    if (this.busy && markBusy) return;
    if (markBusy) this.busy = true;
    this.uiError = null;
    this.render();
    try {
      await action();
    } catch (error) {
      this.uiError = {
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNEXPECTED_ERROR',
        message: error instanceof Error ? error.message : '操作未完成，請安全重試。',
        retryable: Boolean(error && typeof error === 'object' && 'retryable' in error && error.retryable)
      };
      if (error && typeof error === 'object' && 'fieldErrors' in error && error.fieldErrors) {
        this.fieldErrors = /** @type {Record<string,string>} */ (error.fieldErrors);
      }
    } finally {
      if (markBusy) this.busy = false;
      this.render();
    }
  }

  render() {
    const isRecipient = this.route.startsWith('/pickup/');
    document.title = isRecipient ? '安全取件｜go by myself' : 'go by myself｜校園智慧投遞';
    if (isRecipient) {
      this.root.replaceChildren(this.#recipientPage());
      return;
    }

    const header = siteHeader({
      banner: modeBanner(),
      session: this.state.session,
      hasDelivery: Boolean(this.state.delivery),
      navigate: (path) => this.navigate(path),
      onSignOut: () => {
        if (this.state.delivery && !['completed', 'cancelled', 'delivery_failed'].includes(this.state.delivery.status)) {
          const confirmed = window.confirm('登出不會中止目前投遞。確定要登出嗎？');
          if (!confirmed) return;
        }
        void this.#run(async () => {
          await this.adapter.signOut();
          this.navigate('/');
        });
      }
    });

    let content;
    if (this.route === '/privacy') content = this.#privacyPage();
    else if (this.route === '/support') content = this.#supportPage();
    else if (this.route === '/operator/route-validation') content = this.#routeValidationPage();
    else if (!this.state.session || this.route === '/') content = this.#homePage();
    else if (this.route.startsWith('/delivery')) content = this.#deliveryPage();
    else content = this.#notFound();

    this.root.replaceChildren(
      header,
      content,
      modeToolbar(this.state, this.adapter, (path) => this.navigate(path)),
      siteFooter(),
      liveRegion(this.#liveMessage())
    );
  }

  #homePage() {
    return homeScreen({
      authTab: this.authTab,
      recoveryOpen: this.recoveryOpen,
      error: this.uiError ?? this.state.actionError,
      googleDisabled,
      googleHelp,
      recoveryText,
      setAuthTab: (tab) => {
        this.authTab = tab;
        this.uiError = null;
        this.render();
      },
      toggleRecovery: () => {
        this.recoveryOpen = !this.recoveryOpen;
        this.render();
      },
      google: () => void this.#run(async () => {
        await this.adapter.signInWithGoogle(this.authTab);
        this.navigate('/delivery/new');
      }),
      authAlternative: authAlternative({
        adapter: this.adapter,
        navigate: (path) => this.navigate(path),
        run: (action) => void this.#run(action)
      }),
      dismissError: () => {
        this.uiError = null;
        this.adapter.clearError?.();
        this.render();
      }
    });
  }

  #deliveryPage() {
    const delivery = this.state.delivery;
    if (delivery) return this.#statusPage(delivery);
    const step = Math.max(2, Math.min(4, this.state.wizardStep));
    if (step === 2) return this.#pickupStep();
    if (step === 3) return this.#detailsStep();
    return this.#confirmationStep();
  }

  /** @param {number} current @param {Node} body */
  #flowMain(current, body) {
    return el('main', { id: 'main-content', className: 'flow-main' },
      stepper(current),
      errorBanner(this.uiError ?? this.state.actionError, () => {
        this.uiError = null;
        this.adapter.clearError?.();
        this.render();
      }),
      body
    );
  }

  #pickupStep() {
    const selected = this.state.draft.pickupCode;
    const routeSelector = createRouteSelector({
      id: 'pickup-location',
      label: '選取放置物品地點',
      selectedCode: selected,
      pickupCode: selected,
      interactive: true,
      onSelect: (code) => this.adapter.saveDraft({ pickupCode: code, dropoffCode: this.state.draft.dropoffCode === code ? '' : this.state.draft.dropoffCode })
    });
    return this.#flowMain(2, el('div', { className: 'flow-card' },
      el('div', { className: 'flow-heading' },
        el('h1', {}, '你要在哪裡放入物品？'),
        el('p', {}, '以下站點目前僅供專題展示；實際停靠位置仍需校方與車輛團隊確認。')
      ),
      routeSelector,
      el('div', { className: 'action-row action-row--end' },
        el('button', {
          className: 'button button--primary',
          type: 'button',
          disabled: !selected,
          onclick: () => this.#setWizardStep(3)
        }, '繼續填寫投遞資料')
      )
    ));
  }

  #detailsStep() {
    const draft = this.state.draft;
    const form = el('form', { className: 'delivery-form', novalidate: true });
    form.append(createRouteSelector({
      id: 'dropoff-location',
      label: '選取收件地點',
      selectedCode: draft.dropoffCode,
      pickupCode: draft.pickupCode,
      dropoffCode: draft.dropoffCode,
      disabledCodes: [draft.pickupCode],
      interactive: true,
      onSelect: (code) => this.adapter.saveDraft({ dropoffCode: code })
    }));

    const fields = el('div', { className: 'form-grid' });
    fields.append(
      this.#textField('recipientName', '收件人姓名', draft.recipientName, { autocomplete: 'name', maxlength: '50', required: true }),
      this.#textField('recipientPhone', '台灣手機號碼', draft.recipientPhone, { autocomplete: 'tel', inputmode: 'tel', placeholder: '0912345678', required: true, help: '手機號碼用來傳送取件資訊，也會在現場需要協助時聯絡收件人。' }),
      this.#textField('recipientEmail', 'Email（選填）', draft.recipientEmail, { autocomplete: 'email', type: 'email', maxlength: '254', help: '若主要通知未送達，系統才會改用你同意提供的 Email。' }),
      this.#selectField('itemType', '物品類型', draft.itemType, ITEM_TYPES),
      this.#textArea('note', '備註（選填）', draft.note, { maxlength: '300', help: '請勿填入不必要的個人資料。最多 300 字。' })
    );
    form.append(fields);
    form.append(el('div', { className: 'action-row' },
      el('button', { className: 'button button--ghost', type: 'button', onclick: () => this.#setWizardStep(2) }, '返回放件地點'),
      el('button', { className: 'button button--primary', type: 'submit' }, '檢查並前往確認')
    ));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const candidate = {
        ...draft,
        recipientName: data.get('recipientName'),
        recipientPhone: data.get('recipientPhone'),
        recipientEmail: data.get('recipientEmail'),
        itemType: data.get('itemType'),
        note: data.get('note')
      };
      const validation = validateDeliveryInput(candidate);
      this.adapter.saveDraft(candidate);
      this.fieldErrors = validation.errors;
      if (!Object.keys(validation.errors).length) this.#setWizardStep(4);
      else {
        this.uiError = { code: 'DELIVERY_VALIDATION_FAILED', message: '請修正標示的欄位。', retryable: false };
        this.render();
        requestAnimationFrame(() => /** @type {HTMLElement|null} */ (document.querySelector('.field--error input, .field--error textarea, .field--error select'))?.focus());
      }
    });
    return this.#flowMain(3, el('div', { className: 'flow-card' },
      el('div', { className: 'flow-heading' },
        el('h1', {}, '填寫投遞資料'),
        el('p', {}, '請填寫收件資訊。送出前仍可返回修改。')
      ),
      form
    ));
  }

  /** @param {string} id @param {string} label @param {string} value @param {{autocomplete?:string,maxlength?:string,required?:boolean,inputmode?:string,placeholder?:string,type?:string,help?:string}} [options] */
  #textField(id, label, value, options = {}) {
    const error = this.fieldErrors[id];
    const shell = fieldShell(id, label, error);
    const { help, ...inputOptions } = options;
    const describedBy = [error ? `${id}-error` : '', help ? `${id}-help` : ''].filter(Boolean).join(' ');
    shell.wrapper.append(el('input', {
      id,
      name: id,
      type: inputOptions.type ?? 'text',
      value,
      'aria-invalid': error ? 'true' : 'false',
      'aria-describedby': describedBy || null,
      ...inputOptions
    }));
    if (help) shell.wrapper.append(el('p', { id: `${id}-help`, className: 'field-help' }, help));
    shell.appendError();
    return shell.wrapper;
  }

  /** @param {string} id @param {string} label @param {string} value @param {ReadonlyArray<readonly [string,string]>} choices */
  #selectField(id, label, value, choices) {
    const error = this.fieldErrors[id];
    const shell = fieldShell(id, label, error);
    shell.wrapper.append(el('select', { id, name: id, value, 'aria-invalid': error ? 'true' : 'false', 'aria-describedby': error ? `${id}-error` : null },
      ...choices.map(([optionValue, optionLabel]) => el('option', { value: optionValue, selected: value === optionValue }, optionLabel))
    ));
    shell.appendError();
    return shell.wrapper;
  }

  /** @param {string} id @param {string} label @param {string} value @param {{maxlength?:string,help?:string}} [options] */
  #textArea(id, label, value, options = {}) {
    const error = this.fieldErrors[id];
    const shell = fieldShell(id, label, error);
    shell.wrapper.classList.add('field--wide');
    shell.wrapper.append(el('textarea', {
      id,
      name: id,
      rows: '4',
      maxlength: options.maxlength,
      'aria-invalid': error ? 'true' : 'false',
      'aria-describedby': [error ? `${id}-error` : '', options.help ? `${id}-help` : ''].filter(Boolean).join(' ') || null
    }, value));
    if (options.help) shell.wrapper.append(el('p', { id: `${id}-help`, className: 'field-help' }, options.help));
    shell.appendError();
    return shell.wrapper;
  }

  #confirmationStep() {
    const draft = this.state.draft;
    const pickup = locationByCode(draft.pickupCode);
    const dropoff = locationByCode(draft.dropoffCode);
    const item = ITEM_TYPES.find(([value]) => value === draft.itemType)?.[1] ?? draft.itemType;
    return this.#flowMain(4, el('div', { className: 'flow-card flow-card--narrow' },
      el('div', { className: 'flow-heading' },
        el('h1', {}, '確認投遞內容'),
        el('p', {}, '確認後會建立這次投遞。重複點擊不會產生第二筆投遞。')
      ),
      el('dl', { className: 'summary-grid' },
        summaryItem('放件地點', pickup ? `${pickup.name}｜${pickup.detail}` : '未選擇'),
        summaryItem('收件地點', dropoff ? `${dropoff.name}｜${dropoff.detail}` : '未選擇'),
        summaryItem('收件人', draft.recipientName),
        summaryItem('手機', maskPhone(draft.recipientPhone.startsWith('+886') ? draft.recipientPhone : (validateDeliveryInput(draft).value.recipientPhone))),
        summaryItem('Email', maskEmail(draft.recipientEmail)),
        summaryItem('物品', item),
        summaryItem('備註', draft.note || '無')
      ),
      el('div', { className: 'privacy-callout' },
        el('strong', {}, '資料用途'),
        el('p', {}, '收件資料只用於這次投遞、取件與必要聯絡。展示模式不會使用真實資料。')
      ),
      el('p', { className: 'cancellation-copy' }, '尚未派車前可直接取消；車輛開始執行後，取消會先進入安全處理，不會立即宣稱完成。'),
      el('div', { className: 'action-row' },
        el('button', { className: 'button button--ghost', type: 'button', onclick: () => this.#setWizardStep(3) }, '返回編輯'),
        el('button', {
          className: 'button button--primary',
          type: 'button',
          disabled: this.busy,
          'aria-busy': this.busy ? 'true' : 'false',
          onclick: () => void this.#run(async () => {
            await this.adapter.confirmDraft();
            this.navigate('/delivery/current');
          })
        }, this.busy ? '正在建立投遞…' : '確認投遞')
      )
    ));
  }

  /** @param {any} delivery */
  #statusPage(delivery) {
    const currentStep = stepForStatus(delivery.status);
    const pickup = locationByCode(delivery.pickupCode);
    const dropoff = locationByCode(delivery.dropoffCode);
    const telemetry = this.state.telemetry;
    const projectedFrom = locationByCode(telemetry.routeFromStopCode);
    const projectedTo = locationByCode(telemetry.routeToStopCode);
    const activeRouteParts = projectedFrom && projectedTo
      ? shortestRoute(projectedFrom.routeNodeId, projectedTo.routeNodeId)
      : currentStep <= 6
        ? shortestRoute('TRUNK_HSS', pickup?.routeNodeId ?? '')
        : shortestRoute(pickup?.routeNodeId ?? '', dropoff?.routeNodeId ?? '');
    const changingLeg = ['preparing', 'localizing'].includes(telemetry.vehicleState);
    const route = createRouteSelector({
      id: `delivery-route-${delivery.id}`,
      label: currentStep <= 6 ? '車輛前往放件地點' : '投遞路線與站點',
      pickupCode: delivery.pickupCode,
      dropoffCode: delivery.dropoffCode,
      interactive: false,
      activeEdgeIds: telemetry.activeEdgeIds,
      activeRouteParts,
      vehiclePosition: ['off_route', 'invalid'].includes(telemetry.positionQuality) ? null : telemetry.position,
      animateVehicle: telemetry.positionQuality === 'valid' && telemetry.connectivity === 'online' && telemetry.vehicleState === 'moving'
    });
    const body = el('div', { className: 'status-layout' },
      el('div', { className: 'status-primary' },
        statusHero({ status: delivery.status, telemetry }),
        this.#statusActions(delivery),
        changingLeg ? el('div', { className: 'route-transition-notice', role: 'status' },
          el('strong', {}, '車輛正在準備下一段路線'),
          el('span', {}, '重新定位完成前，地圖保留最後一筆可信位置。')) : null,
        route
      ),
      el('aside', { className: 'status-aside', 'aria-label': '投遞摘要' },
        el('section', { className: 'aside-section' },
          el('h2', {}, '本次投遞'),
          el('dl', { className: 'compact-summary' },
            summaryItem('放件', pickup?.name ?? ''),
            summaryItem('收件', dropoff?.name ?? ''),
            summaryItem('車輛', 'GBM-01 · 綠白識別')
          )
        ),
        el('section', { className: 'aside-section' },
          el('h2', {}, '位置可信度'),
          el('p', { className: `status-chip status-chip--${telemetry.connectivity}` }, this.#connectivityLabel(telemetry.connectivity)),
          el('p', { className: 'muted' }, telemetry.observedAt ? `最後可信更新：${this.#formatTime(telemetry.observedAt)}` : '收到第一筆可靠位置後，地圖才會顯示車輛。')
        ),
        this.state.notificationState ? el('section', { className: 'aside-section' },
          el('h2', {}, '收件通知'),
          el('p', {}, notificationCopy(this.state.notificationState)),
          notificationDisclaimer()
        ) : null,
        el('section', { className: 'aside-section aside-section--help' },
          el('h2', {}, '需要協助？'),
          el('p', {}, supportCopy),
          el('a', { href: '/support' }, '查看協助與安全說明')
        )
      )
    );
    return this.#flowMain(currentStep, body);
  }

  /** @param {any} delivery */
  #statusActions(delivery) {
    const status = delivery.status;
    const action = el('section', { className: 'status-actions', 'aria-label': '目前可執行動作' });
    if (status === 'confirmed') {
      action.append(
        el('p', {}, dispatchIntro),
        el('button', { className: 'button button--primary', type: 'button', disabled: this.busy, onclick: () => void this.#run(() => this.adapter.startDispatch()) }, '呼叫車輛')
      );
    } else if (status === 'dispatching') {
      action.append(el('div', { className: 'pending-row', role: 'status' }, el('span', { className: 'spinner', 'aria-hidden': 'true' }), '派車命令已接受，等待車輛完成抵達。'));
    } else if (status === 'arrived_pickup') {
      action.append(
        el('p', {}, '請先核對車輛 GBM-01 與站點，再要求開啟置物艙。'),
        el('button', { className: 'button button--primary', type: 'button', disabled: this.busy || this.state.commandState === 'accepted', onclick: () => void this.#run(() => this.adapter.requestSenderOpen()) }, this.state.commandState === 'accepted' ? '正在要求開艙…' : '開啟置物艙')
      );
    } else if (status === 'compartment_open_for_sender') {
      action.append(
        el('ol', { className: 'instruction-list' },
          el('li', {}, '將小型物品平穩放入置物艙。'),
          el('li', {}, '確認物品不會阻擋艙門。'),
          el('li', {}, '關閉艙門後再按下確認。')
        ),
        manualLoadNotice(this.state.scenario),
        el('button', { className: 'button button--primary', type: 'button', onclick: () => void this.#run(() => this.adapter.confirmLoaded()) }, loadButtonLabel(this.state.scenario))
      );
    } else if (status === 'loaded') {
      action.append(el('div', { className: 'pending-row', role: 'status' }, el('span', { className: 'spinner', 'aria-hidden': 'true' }), '已取得放件證據，正在確認艙門與移動條件。'));
    } else if (['in_transit', 'arrived_dropoff'].includes(status)) {
      action.append(el('p', {}, status === 'arrived_dropoff' ? '車輛已到站，但收件人尚未完成驗證與取物。' : '車輛正在前往收件站。收到可靠位置後，地圖會自動更新。'));
    } else if (status === 'awaiting_recipient') {
      action.append(
        el('p', {}, '收件人不必登入。請將取件連結和展示取件碼交給收件人。'),
        credentialCallout('sender'),
        el('a', { className: 'button button--primary', href: `/pickup/${delivery.publicRef}` }, '前往收件人取件頁')
      );
    } else if (status === 'compartment_open_for_recipient') {
      action.append(el('p', {}, '收件艙已開啟，正在等待收件人取出物品並關好艙門。這時投遞尚未完成。'));
    } else if (status === 'picked_up') {
      action.append(el('div', { className: 'pending-row', role: 'status' }, el('span', { className: 'spinner', 'aria-hidden': 'true' }), '已收到取物與關門資訊，正在完成最後確認。'));
    } else if (status === 'completed') {
      action.append(this.#completionPanel(delivery));
    } else if (['cancel_requested', 'returning_to_base'].includes(status)) {
      action.append(el('div', { className: 'alert alert--warning', role: 'status' }, status === 'cancel_requested' ? '取消要求已收到，但尚未完成。系統正在決定安全處置。' : '車輛正在返回安全位置；物品保管責任確認後才會顯示已取消。'));
    } else if (status === 'cancelled') {
      action.append(el('p', {}, cancelledCopy), this.#newDeliveryButton());
    } else if (status === 'delivery_failed') {
      action.append(el('div', { className: 'alert alert--danger' }, '投遞無法繼續。請保持物品與艙門原狀，等待現場人員協助。'));
    }

    const cancelStatuses = ['confirmed', 'dispatching', 'arrived_pickup', 'compartment_open_for_sender', 'loaded', 'in_transit'];
    if (cancelStatuses.includes(status)) {
      action.append(el('button', {
        className: 'button button--danger-ghost',
        type: 'button',
        onclick: () => void this.#run(() => this.adapter.requestCancel())
      }, ['loaded', 'in_transit'].includes(status) ? '提出取消要求' : '取消本次投遞'));
    }
    return action;
  }

  /** @param {any} delivery */
  #completionPanel(delivery) {
    const pickup = locationByCode(delivery.pickupCode);
    const dropoff = locationByCode(delivery.dropoffCode);
    return el('div', { className: 'completion-panel' },
      el('div', { className: 'completion-check', 'aria-hidden': 'true' }, '✓'),
      el('dl', { className: 'summary-grid' },
        summaryItem('放件', pickup?.name ?? ''),
        summaryItem('收件', dropoff?.name ?? ''),
        summaryItem('完成時間', this.#formatTime(delivery.completedAt)),
        summaryItem('車輛', 'GBM-01'),
        summaryItem('取件證明', '一次性憑證＋開艙＋取物＋關門'),
        summaryItem('通知摘要', notificationCopy(this.state.notificationState))
      ),
      el('p', { className: 'muted' }, '完成頁不顯示或重用取件碼。'),
      this.#newDeliveryButton()
    );
  }

  #newDeliveryButton() {
    return el('button', {
      className: 'button button--primary',
      type: 'button',
      onclick: () => void this.#run(async () => {
        await this.adapter.beginNewDelivery();
        this.navigate('/delivery/new');
      })
    }, '再次投遞');
  }

  #recipientPage() {
    const publicRef = decodeURIComponent(this.route.split('/').pop() ?? '');
    const delivery = this.state.delivery;
    const safeMatch = delivery && delivery.publicRef === publicRef;
    const dropoff = safeMatch ? locationByCode(delivery.dropoffCode) : null;
    const header = el('header', { className: 'recipient-header' },
      el('a', { className: 'brand-link', href: '/' }, ndhuEmblem('header'), el('span', { className: 'brand-copy' }, el('strong', {}, '安全取件'), el('small', {}, 'go by myself 學生專題'))),
      recipientBadge()
    );
    if (!safeMatch) {
      return el('div', { className: 'recipient-shell' }, header, el('main', { id: 'main-content', className: 'recipient-main' }, emptyState('找不到可用的取件資訊', '連結可能無效、已過期或尚未準備。為保護隱私，系統不提供更多識別資訊。')), siteFooter());
    }

    const status = delivery.status;
    const ready = ['awaiting_recipient', 'compartment_open_for_recipient', 'picked_up', 'completed'].includes(status);
    const attempt = this.state.recipientAttempt;
    const form = el('form', { className: 'pickup-form' },
      el('label', { htmlFor: 'pickup-code' }, '一次性人類取件碼'),
      el('input', {
        id: 'pickup-code',
        name: 'code',
        type: 'text',
        inputmode: 'text',
        autocomplete: 'one-time-code',
        autocapitalize: 'characters',
        placeholder: 'XXXX-XXXX',
        maxlength: '10',
        required: true,
        disabled: !ready || attempt.phase === 'locked' || status !== 'awaiting_recipient',
        'aria-describedby': 'pickup-code-help pickup-code-error'
      }),
      el('p', { id: 'pickup-code-help', className: 'field-help' }, '可直接貼上；系統會忽略空白與連字號。'),
      attempt.error ? el('p', { id: 'pickup-code-error', className: 'field-error', role: 'alert' }, attempt.error) : el('span', { id: 'pickup-code-error' }),
      el('button', { className: 'button button--primary button--full', type: 'submit', disabled: !ready || status !== 'awaiting_recipient' || attempt.phase === 'locked' }, attempt.phase === 'opening' ? '正在要求開艙…' : '驗證並開啟收件艙')
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = String(new FormData(form).get('code') ?? '');
      void this.#run(() => this.adapter.redeemCredential(code));
    });

    const phase = status === 'completed' ? 'confirmed' : attempt.phase;
    return el('div', { className: 'recipient-shell' },
      header,
      el('main', { id: 'main-content', className: 'recipient-main' },
        el('section', { className: 'pickup-context', 'aria-labelledby': 'pickup-title' },
          el('h1', { id: 'pickup-title' }, '確認站點與車輛後取件'),
          el('div', { className: 'pickup-identity' },
            el('div', {}, el('span', {}, '收件站點'), el('strong', {}, dropoff?.name ?? '核准站點'), el('small', {}, dropoff?.detail ?? '')), 
            el('div', {}, el('span', {}, '車輛識別'), el('strong', {}, 'GBM-01'), el('small', {}, '綠白專題識別'))
          ),
          el('div', { className: `readiness readiness--${ready ? 'ready' : 'waiting'}`, role: 'status' }, ready ? '車輛已準備，可進行取件驗證' : '車輛尚未準備，請在安全區域等候')
        ),
        status === 'awaiting_recipient' ? credentialCallout('recipient') : null,
        errorBanner(this.uiError, () => { this.uiError = null; this.render(); }),
        phase === 'idle' || phase === 'locked' ? form : null,
        phase === 'opening' ? el('section', { className: 'pickup-phase', 'aria-busy': 'true' }, el('span', { className: 'spinner spinner--large', 'aria-hidden': 'true' }), el('h2', {}, '正在確認艙門開啟'), el('p', {}, '已收到開艙要求。艙門確認打開後，畫面才會進到下一步。')) : null,
        phase === 'open' && status === 'compartment_open_for_recipient'
          ? pickupOpenAction(() => void this.#run(() => this.adapter.confirmPickup()))
          : null,
        phase === 'confirming' || status === 'picked_up' ? el('section', { className: 'pickup-phase', 'aria-busy': 'true' }, el('span', { className: 'spinner spinner--large', 'aria-hidden': 'true' }), el('h2', {}, '正在確認取件完成'), el('p', {}, '已收到取物與關門資訊，正在完成最後確認。')) : null,
        phase === 'confirmed' || status === 'completed' ? el('section', { className: 'pickup-phase pickup-phase--complete' },
          el('div', { className: 'completion-check', 'aria-hidden': 'true' }, '✓'),
          el('h2', {}, '取件完成'),
          el('p', {}, '取件碼已失效，本次取件已完成。'),
          el('a', { className: 'button button--secondary', href: '/delivery/current' }, '返回寄件進度')
        ) : null,
        el('section', { className: 'recipient-safety' },
          el('h2', {}, '取件安全提醒'),
          el('p', {}, '艙門未顯示「已確認開啟」前請勿強行操作。車輛或環境異常時，請保持距離並聯絡現場人員。')
        )
      ),
      modeToolbar(this.state, this.adapter, (path) => this.navigate(path)),
      siteFooter(),
      liveRegion(this.#liveMessage())
    );
  }

  #privacyPage() {
    return el('main', { id: 'main-content', className: 'document-page' },
      el('h1', {}, '隱私說明'),
      el('p', { className: 'lead' }, modePrivacyLead),
      el('h2', {}, '蒐集目的與欄位'),
      el('p', {}, '寄件人身份、收件聯絡方式、投遞紀錄和概略路線進度，只會用於投遞、通知、取件、異常處理與必要查核。'),
      el('h2', {}, '預設保留期間'),
      el('ul', {},
        el('li', {}, '取件碼驗證資料：投遞結束或到期後 24 小時。'),
        el('li', {}, '收件姓名、手機、Email 與通知紀錄：90 天。'),
        el('li', {}, '一般精確車輛資料：7 天；事故相關片段最多 180 天。'),
        el('li', {}, '車輛指令、故障與稽核紀錄：365 天。'),
        el('li', {}, '備份中的刪除延遲：目標不超過 30 天。')
      ),
      el('h2', {}, '權利與聯絡'),
      el('p', {}, '正式試行前，專案必須公布資料管理與聯絡窗口，並提供查詢、更正、刪除及停止使用資料的申請方式。在窗口尚未確認前，本網站只提供展示與測試。')
    );
  }

  #supportPage() {
    return el('main', { id: 'main-content', className: 'document-page' },
      el('h1', {}, '協助與安全'),
      el('div', { className: 'alert alert--warning' }, '正式服務目前沒有即時客服或事故值班人員，因此真實車輛功能仍保持關閉。'),
      modeSupportSection(),
      el('h2', {}, '實機安全'),
      el('p', {}, '網頁上的取消不能取代車輛緊急停止。遇到車輛離線、偏離路線、艙門異常或物品未妥善交接時，請保持距離並通知受訓的現場人員。'),
      el('h2', {}, '正式試行條件'),
      el('p', {}, '只有在校方核准路線、車輛規格確認、緊急應變人員到位、隱私告知完成、通知服務驗證通過，並完成現場演練後，才會進行小規模試行。')
    );
  }

  #routeValidationPage() {
    if (!this.state.session?.roles?.includes('operator') || typeof this.adapter.startRouteValidation !== 'function') {
      return el('main', { id: 'main-content', className: 'document-page' }, emptyState('無法開啟路線驗證', '此頁面只開放給已授權的操作人員。'));
    }
    const workspace = this.state.routeValidation;
    const vehicleId = this.operatorSelection.vehicleId || workspace.vehicles[0]?.id || '';
    const approvedLegs = workspace.legs.filter((leg) => leg.mappingApproved);
    const legId = this.operatorSelection.legId || approvedLegs[0]?.legId || '';
    return routeValidationView({
      workspace,
      selection: { vehicleId, legId },
      busy: this.busy,
      onSelection: (patch) => {
        this.operatorSelection = { ...this.operatorSelection, ...patch };
        this.render();
      },
      onStart: () => void this.#run(() => this.adapter.startRouteValidation(vehicleId, legId)),
      onStop: () => void this.#run(() => this.adapter.requestRouteValidationStop())
    });
  }

  #notFound() {
    return el('main', { id: 'main-content', className: 'document-page' }, emptyState('找不到這個頁面', '請返回首頁或目前投遞。'));
  }

  /** @param {string} connectivity */
  #connectivityLabel(connectivity) {
    return { online: '位置連線正常', stale: '位置資訊逾時', offline: '車輛離線' }[connectivity] ?? '等待車輛位置';
  }

  /** @param {string|null|undefined} value */
  #formatTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Taipei' }).format(new Date(value));
  }

  #liveMessage() {
    const status = this.state.delivery?.status;
    if (!status) return '';
    const messages = {
      arrived_pickup: '車輛已抵達放件地點。',
      compartment_open_for_sender: '置物艙已確認開啟。',
      arrived_dropoff: '車輛已抵達收件地點，但投遞尚未完成。',
      awaiting_recipient: '取件憑證已啟用，正在等待收件人。',
      compartment_open_for_recipient: '收件艙已確認開啟。',
      completed: '投遞已完成。'
    };
    return messages[status] ?? '';
  }
}
