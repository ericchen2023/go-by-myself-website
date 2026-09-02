import { describeRemaining } from './arrival.js';

const stepByStatus = Object.freeze({
  draft: 4,
  confirmed: 5,
  dispatching: 5,
  arrived_pickup: 6,
  compartment_open_for_sender: 6,
  loaded: 6,
  in_transit: 7,
  arrived_dropoff: 7,
  awaiting_recipient: 7,
  compartment_open_for_recipient: 7,
  picked_up: 7,
  completed: 8,
  cancel_requested: 7,
  returning_to_base: 7,
  cancelled: 7,
  delivery_failed: 7
});

export const STEP_NAMES = Object.freeze([
  '登入',
  '放件地點',
  '投遞資料',
  '確認',
  '等待車輛',
  '放入物品',
  '運送與收件',
  '完成'
]);

/** @param {string} status */
export function stepForStatus(status) {
  return stepByStatus[status] ?? 1;
}

/**
 * @param {string} status
 * @param {{connectivity?: string, positionQuality?: string, commandState?: string, position?: {segmentId: string, progress: number}|null, etaSeconds?: number|null}} [overlay]
 */
export function deliveryStatusCopy(status, overlay = {}) {
  if (overlay.positionQuality === 'off_route' || overlay.positionQuality === 'invalid') {
    return {
      eyebrow: '安全狀態',
      title: '車輛位置需要確認',
      detail: '系統已停止顯示未驗證的位置。請勿前往尋找車輛，等待現場人員處理。',
      tone: 'danger'
    };
  }
  if (overlay.positionQuality === 'degraded') {
    return {
      eyebrow: '定位品質下降',
      title: '車輛位置可能不準',
      detail: '地圖保留受限制的路線投影；請以核准站點與現場車輛識別為準。',
      tone: 'warning'
    };
  }
  if (overlay.connectivity === 'stale' || overlay.connectivity === 'offline') {
    return {
      eyebrow: '連線退化',
      title: overlay.connectivity === 'offline' ? '車輛目前離線' : '車輛位置暫停更新',
      detail: '畫面保留最後一筆可信位置；投遞狀態並未因此改變。',
      tone: 'warning'
    };
  }

  // Dispatching and transit each cover two very different waits. The vehicle
  // first loads the map for the leg and relocalises against it, which reports no
  // route at all and takes minutes; only then does it drive. Showing one spinner
  // for both leaves the reader unable to tell a vehicle preparing from a vehicle
  // stuck. The projection already separates them: a route appears only once the
  // leg is being driven.
  const driving = Boolean(overlay.position);
  if (status === 'dispatching' || status === 'in_transit') {
    const heading = status === 'dispatching' ? '車輛前往放件點' : '運送中';
    const destination = status === 'dispatching' ? '放件地點' : '收件地點';
    if (!driving) {
      return {
        eyebrow: heading,
        title: '車輛準備出發',
        detail: `車輛已接受派車，正在載入該路段地圖並確認自身位置。這段期間不會顯示車輛位置，完成後才會開始行駛前往${destination}。`,
        tone: 'info'
      };
    }
    const travelled = Math.round(Math.max(0, Math.min(1, overlay.position.progress)) * 100);
    const eta = typeof overlay.etaSeconds === 'number' ? describeRemaining(overlay.etaSeconds) : null;
    return {
      eyebrow: heading,
      title: '車輛行駛中',
      detail: `本段已行進約 ${travelled}%。${eta ? eta + '（依觀察到的行進速度估算）。' : '抵達時間需要再觀察一段行進才能估算。'}抵達前請留在安全區域。`,
      tone: 'info'
    };
  }

  const copies = {
    confirmed: ['投遞已確認', '準備呼叫車輛', '資料已鎖定，尚未建立實體派車結果。'],
    dispatching: ['車輛前往放件點', '請在核准站點等候', '位置來自路線投影；抵達前請留在安全區域。'],
    arrived_pickup: ['車輛已抵達', '確認車輛後再開艙', '請核對車輛識別 GBM-01，勿強行操作艙門。'],
    compartment_open_for_sender: ['艙門已確認開啟', '請放入物品', '放妥後關閉艙門，再進行放件確認。'],
    loaded: ['物品已確認放入', '正在確認艙門安全', '艙門關閉並符合移動條件後，車輛才會出發。'],
    in_transit: ['運送中', '車輛正前往收件地點', '收件人會以一次性取件憑證完成收件。'],
    arrived_dropoff: ['已抵達收件地點', '尚未完成投遞', '抵達不等於完成；系統正等待收件人驗證與取物。'],
    awaiting_recipient: ['等待收件人', '取件憑證已啟用', '收件人完成開艙、取物與關門確認後才會結案。'],
    compartment_open_for_recipient: ['收件艙已開啟', '等待收件人取物', '物品移除且艙門關閉前，狀態不會顯示完成。'],
    picked_up: ['已收到取件資訊', '正在完成最後確認', '系統正在確認物品已取出且艙門已關閉。'],
    completed: ['投遞完成', '物品已由收件人取走', '取件驗證、開艙、取物與關門證據皆已完成。'],
    cancel_requested: ['取消要求處理中', '尚未取消完成', '車輛與物品保管狀態確認前，不會顯示取消成功。'],
    returning_to_base: ['安全處理中', '車輛正在返回安全位置', '物品保管責任完成交接後，取消才會成立。'],
    cancelled: ['投遞已取消', '安全處理已完成', '本次投遞不會繼續；展示資料可安全重置。'],
    delivery_failed: ['需要協助', '投遞無法繼續', '系統保留狀態與保管紀錄，請由操作人員接手。']
  };
  const [eyebrow, title, detail] = copies[status] ?? ['目前狀態', '等待更新', '系統正在取得最新投遞狀態。'];
  return { eyebrow, title, detail, tone: ['cancel_requested', 'returning_to_base'].includes(status) ? 'warning' : 'default' };
}

/** @param {string} state */
export function notificationCopy(state) {
  const copies = {
    queued: '通知已排程',
    sending: '通知正在傳送',
    accepted: '通知服務已接受',
    delivered: '通知已送達',
    retrying: '通知傳送失敗，正在重試',
    failed: '通知未送達，請使用人工取件協助',
    unconfigured: '展示環境未設定真實通知服務'
  };
  return copies[state] ?? '尚未建立通知';
}

const COMPARTMENT_REFUSALS = {
  COMMAND_TYPE_UNSUPPORTED: '這台車沒有可遙控的置物艙，無法遠端開艙 —— 再按幾次也不會開。這筆投遞在目前的車輛上無法繼續，請取消。',
  ROBOT_STATE_INVALID: '車輛尚未停妥在可開艙的狀態。請確認車輛已到站停穩，再試一次。',
  BRIDGE_BACKEND_FAILED: '車輛的控制程式沒有回應開艙指令。請稍候再試，或取消這筆投遞。'
};

const COMPARTMENT_PENDING = ['queued', 'accepted'];
const COMPARTMENT_REFUSED = ['rejected', 'failed', 'expired'];

/**
 * 車輛對「開啟置物艙」的回應。畫面必須說出拒絕的理由：靜靜地把按鈕重新打開，
 * 只會讓寄件人一直重按（正式環境紀錄過 1.5 秒內按四次，全部被拒絕）。
 * @param {{type?: string, state?: string, errorCode?: string|null}|null} [command]
 * @returns {{phase: 'idle'|'waiting'|'refused', reason: string|null, message: string}}
 */
export function compartmentRequest(command) {
  if (!command || command.type !== 'OPEN_COMPARTMENT') return { phase: 'idle', reason: null, message: '' };
  const state = command.state ?? '';
  if (COMPARTMENT_PENDING.includes(state)) return { phase: 'waiting', reason: null, message: '' };
  if (!COMPARTMENT_REFUSED.includes(state)) return { phase: 'idle', reason: null, message: '' };
  const reason = command.errorCode ?? null;
  const known = reason ? COMPARTMENT_REFUSALS[reason] : null;
  return {
    phase: 'refused',
    reason,
    // 沒有對應文案時仍然把代碼說出來，總比讓人對著沒反應的按鈕好。
    message: known ?? (state === 'expired'
      ? '開艙指令逾時，車輛沒有在時限內執行。請再試一次，或取消這筆投遞。'
      : `車輛拒絕了開艙指令${reason ? `（${reason}）` : ''}。請稍候再試，或取消這筆投遞。`)
  };
}

const NOTIFICATION_SENT = ['queued', 'sending', 'retrying', 'accepted', 'delivered'];

/**
 * 取件碼寄出去了沒。寄件人只該看到這個 —— 碼本身是收件人的鑰匙，經過寄件人
 * 就代表「誰取走的」不再可證明，所以只有在真的寄不出去時才退回人工轉交。
 * @param {{state?: string, channel?: string, maskedDestination?: string}|null} [notification]
 * @param {string} [status] 投遞目前的狀態
 * @returns {{sent: boolean, canReveal: boolean, message: string}}
 */
export function recipientNotice(notification, status) {
  const state = notification?.state ?? '';
  if (NOTIFICATION_SENT.includes(state)) {
    const where = notification?.maskedDestination ? `（${notification.maskedDestination}）` : '';
    return { sent: true, canReveal: false, message: `取件碼已寄給收件人${where}。你不會看到取件碼本身。` };
  }
  if (state === 'failed') {
    return { sent: false, canReveal: true, message: '取件碼寄不出去。你可以改用人工轉交 —— 產生一組碼再自己交給收件人，這個動作會留下紀錄。' };
  }
  if (state === 'unconfigured') {
    // 兩種都寄不出去，但原因不同，能做的事也不同 —— 一個要去補收件人的信箱，
    // 一個要去設定寄信服務。混成同一句話只會讓人不知道該修哪裡。
    const noAddress = !notification?.maskedDestination || notification.maskedDestination.includes('未提供');
    return {
      sent: false,
      canReveal: true,
      message: noAddress
        ? '收件人沒有可用的信箱（未填或未同意通知）。請產生取件碼並自行交給收件人，這個動作會留下紀錄。'
        : '目前沒有設定寄信服務。請產生取件碼並自行交給收件人，這個動作會留下紀錄。'
    };
  }
  // 沒有通知紀錄有兩種意思。還在 arrived_dropoff 表示寄信正在進行；已經進到
  // awaiting_recipient 卻沒有紀錄，就表示沒有東西在路上了 —— 那時再顯示「正在
  // 寄送」，就是又造出一個出不去的狀態。
  if (status === 'awaiting_recipient') {
    return {
      sent: false,
      canReveal: true,
      message: '沒有取件碼的通知紀錄。請產生取件碼並自行交給收件人，這個動作會留下紀錄。'
    };
  }
  return { sent: false, canReveal: false, message: '車輛已到站，正在把取件碼寄給收件人。' };
}

const PHASE_BY_STATUS = {
  compartment_open_for_recipient: 'open',
  picked_up: 'confirming',
  completed: 'confirmed'
};

/**
 * 取件頁該顯示哪一步。attempt.phase 只活在這一次瀏覽裡 —— 重新整理、換一台
 * 裝置、從信裡重新點進來，它都會回到 idle，於是畫面又去要一組早就用掉的取件
 * 碼，而「確認已取出」因為階段不對而不出現。伺服器的狀態才是權威；它說得出
 * 來的階段就以它為準，說不出來的（還在等驗證、被鎖定）才交回給本地。
 * @param {string} status
 * @param {string} [attemptPhase]
 */
export function pickupPhase(status, attemptPhase) {
  return PHASE_BY_STATUS[status] ?? attemptPhase ?? 'idle';
}

/**
 * 從這個放件站走不到的收件站。車上只有八段示教路線，剩下兩組沒有地圖也沒有
 * 路徑 —— 讓人選一個走不了的組合，等於讓他一路填到派車那一步才發現。
 *
 * 拿不到清單時回空陣列（不擋）：伺服器端的 trigger 才是權威，畫面只是提早說。
 * @param {string} pickupCode
 * @param {{fromStopCode: string, toStopCode: string}[]} servicePairs
 * @param {string[]} allStopCodes
 */
export function unreachableFrom(pickupCode, servicePairs, allStopCodes) {
  if (!pickupCode || !servicePairs?.length) return [];
  const reachable = new Set(
    servicePairs.filter((pair) => pair.fromStopCode === pickupCode).map((pair) => pair.toStopCode)
  );
  return allStopCodes.filter((code) => code !== pickupCode && !reachable.has(code));
}
