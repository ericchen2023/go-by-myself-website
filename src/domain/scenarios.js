export const DEMO_SCENARIOS = Object.freeze([
  { id: 'happy-path', label: '正常流程' },
  { id: 'vehicle-busy', label: '車輛忙碌' },
  { id: 'robot-offline-before-dispatch', label: '派車前離線' },
  { id: 'telemetry-stale', label: '位置資訊逾時' },
  { id: 'telemetry-off-route', label: '偏離核准路線' },
  { id: 'command-timeout-late-ack', label: '命令逾時後延遲確認' },
  { id: 'duplicate-command', label: '重複命令去重' },
  { id: 'compartment-sensor-missing', label: '置物感測器缺失' },
  { id: 'recipient-wrong-code-lockout', label: '取件碼錯誤鎖定' },
  { id: 'cancel-before-load', label: '放件前取消' },
  { id: 'cancel-in-transit-return', label: '運送中取消並返回' },
  { id: 'notification-provider-unconfigured', label: '通知服務未設定' }
]);

export const DEMO_SCENARIO_IDS = new Set(DEMO_SCENARIOS.map((scenario) => scenario.id));

