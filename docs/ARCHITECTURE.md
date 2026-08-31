# Architecture decisions

## ADR-001 — shared-core dual-adapter

Demo 與 production 共用 `src/domain/`、`src/map/`、`src/app/`。`vite.config.js` 依 `VITE_APP_MODE` 將 `#runtime-adapter` alias 到 `src/demo/adapter.js` 或 `src/production/adapter.js`。這是 build-time capability boundary，不是登入後的 user toggle。

`scripts/check-boundaries.mjs` 禁止 production source import demo/simulator，build artifacts 再由 bundle budgets 檢查。Demo 只使用 session storage、合成身份、deterministic fake clock 與 truthful mock events。

## ADR-002 — trusted transitions

Browser 只送：

```json
{
  "schemaVersion": 1,
  "intent": "REQUEST_DISPATCH",
  "expectedVersion": 12,
  "idempotencyKey": "uuid",
  "deliveryId": "uuid"
}
```

`public.execute_delivery_intent` 在單一 PostgreSQL transaction 中重新確認 sender、version、precondition、vehicle reservation、history、outbox、audit 與 idempotency。Browser 沒有 direct insert/update/delete policy，也不能送 target status。

## ADR-003 — physical facts

Command `accepted` 只表示 Gateway 接受命令。`completed` 或可信 sensor evidence 才能建立「艙門已開、車已抵達、物品已取出」等 physical facts。`arrived_dropoff`、`awaiting_recipient`、`picked_up` 都留在 UI Step 7；只有 `CUSTODY_CONFIRMED` 進入 Step 8。

`robot_offline | stale | off_route` 儲存在 connectivity/incident overlay，不覆蓋 delivery lifecycle。Off-route projection 隱藏 raw point；stale 保留 last-known-good。

## ADR-004 — privacy-safe realtime

Source of truth 是 PostgreSQL snapshot。Private Broadcast topic 只傳 delivery projection：status/version、schematic segment/progress、connectivity、quality 與可信 ETA range。Reconnect 必須先 GET snapshot，再 subscribe，丟棄不較新的 version。

## ADR-005 — recipient credential

Production human code 是 8 位 Crockford Base32；QR 是 256 random bits 且 capability 預設關閉。Raw secrets 不入 DB/log；Edge 以 HMAC-SHA-256＋versioned pepper產生 digest。Redeem 與可恢復 attempt/open command 同 transaction。Demo 的 `NDHU 4826` 是清楚標示的合成碼，不是 production fixture。

## ADR-006 — route job與robot contract v2

`route_jobs` 與 `route_job_legs` 將路線執行和投遞 lifecycle分離。`to_pickup`／`to_dropoff`可連回delivery；`validation`／`return`是獨立target。真車第一階段只允許`validation`，不建立recipient credential、notification或completed delivery。

Robot command v2以`target.kind + target.id`定位工作，DISPATCH綁定physical leg、公開起終站、`ndhu-four-stop-route-v5`與SHA-256 checksum。Telemetry v2由gateway回報`segmentId + progress`；server產生`receivedAt`，browser不接收raw x/y。電池尚未校正前只保留voltage，percent為`null`。

長時間DISPATCH在agent背景執行，poll loop持續接收CANCEL。CANCEL不含vehicle-state precondition，因安全停止不能被競態中的狀態字串拒絕。`accepted`仍不代表physical completion。

## ADR-007 — route validation safety boundary

Operator workspace只呈現四站示意路線與空載驗證狀態。A–D、raw SLAM pose、lateral error與voltage只在受保護diagnostics出現。A/B/C/D mapping、每段allowed segments、vehicle capability未全部簽核時，server RPC會以`PHYSICAL_CAPABILITY_DISABLED`／`PHYSICAL_MAPPING_UNAPPROVED` fail closed。
