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
 * @param {{connectivity?: string, positionQuality?: string, commandState?: string}} [overlay]
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
