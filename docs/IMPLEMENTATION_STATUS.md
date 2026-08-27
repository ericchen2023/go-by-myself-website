# Implementation status

更新日期：2026-08-28。這份文件區分「程式已落地」、「contract-ready」與「已在真實環境驗證」，避免把migration或adapter存在誤稱為可上校園實機。

## 已實作

| Scope | Maturity | Evidence |
|---|---|---|
| Foundation / UI | IMPLEMENTED | Vite/Vanilla JS、checked JS、兩種build、正式NDHU emblem asset、responsive/a11y baseline |
| Canonical route | IMPLEMENTED | `contracts/route-graph.v4.json`是單一資料來源；四站、version/checksum、edge與SVG geometry由CI核對 |
| Exhibition demo | IMPLEMENTED | Zero-secret、fake clock、八步sender/recipient、robot離線仍可展示 |
| Robot contract v2 | IMPLEMENTED + UNIT VERIFIED | Command/telemetry/event JSON Schema、正反fixtures、checksum/leg/expiry/state驗證；v1只保留legacy fixture |
| Route jobs | CONTRACT-READY | Immutable migrations新增route job/legs、多段狀態、30分鐘起跑期限、未accepted過期回復、terminal reservation release |
| Telemetry ingest | CONTRACT-READY | 單一transactional RPC、server received time、boot/sequence ordering、last-known-good、valid/degraded/invalid/off-route projection |
| Private Realtime | CONTRACT-READY | `delivery:{id}`與`route-validation:{id}` safe projection、topic authorization、10s/60s reconciliation |
| Node simulator gateway | IMPLEMENTED + UNIT VERIFIED | DISPATCH背景執行、CANCEL可並行、durable dedup、telemetry v2、production simulator fail closed |
| Jetson Python agent | CONTRACT HARNESS | Outbound poller、背景command executor、durable ledger、CANCEL並行、v2 fixtures；Aurora/ROS hardware adapter尚未實作 |
| Operator route validation | IMPLEMENTED UI / CAPABILITY OFF | 四站dynamic map、state/SLAM/connectivity/leg/lateral/voltage、folded diagnostics、安全停止要求；無PII、無delivery completion |
| Edge robot API | CONTRACT-READY | `verify_jwt=false`＋函式內per-client constant-time token、vehicle scope、size/schema/rate limit、trusted RPC |
| Tests | IMPLEMENTED BASELINE | Vitest、Playwright、axe、gateway並行cancel、contract checksum、Python unittest、build/boundary/bundle checks |

## 尚未取得的驗證證據

- 本機目前沒有Docker/Podman，因此2026-08-28這次變更尚未完成`supabase db reset`、pgTAP與真實Realtime authorization測試。
- 尚未建立獨立Supabase staging project、per-client Edge secrets或active staging vehicle provisioning。
- A／B／C／D到四個公開站點的正式mapping全部是`unapproved`，`route_validation_enabled=false`；server會拒絕建立真車route job。
- Python agent只有dry-run adapter；沒有Aurora S map switch、ROS1 taught-route replay、真實telemetry或TLS certificate rotation。
- 沒有置物艙、門鎖、item sensor、QR scanner或remote emergency stop，因此真實投遞維持NO-GO。
- Operator workspace不是完整營運console；custody、door、incident assignment與alert owner仍待後續phase。
- OAuth、SMS/email provider、privacy/legal與校方路線核准仍未完成。

## Phase gate

| Phase | Current result |
|---|---|
| Exhibition Demo | SOFTWARE GO CANDIDATE；仍需成果展設備現場smoke |
| Production-shaped staging | SOFTWARE IMPLEMENTED / ENVIRONMENT NO-GO；需DB reset、RLS/Realtime、Edge與simulator E2E |
| Supervised route validation | NO-GO；mapping、robot adapter、現場owner、實體e-stop、TLS與八方向drill未完成 |
| Full physical delivery | NO-GO；compartment/door/sensor/custody缺失 |
| Limited Production Pilot | NO-GO；校方、privacy、provider、incident與physical evidence未完成 |
