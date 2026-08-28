# Implementation status

更新日期：2026-08-29。這份文件區分「程式已落地」、「contract-ready」與「已在真實環境驗證」，避免把migration或adapter存在誤稱為可上校園實機。

## 已實作

| Scope | Maturity | Evidence |
|---|---|---|
| Foundation / UI | IMPLEMENTED + LIVE QA VERIFIED | Vite/Vanilla JS、checked JS、兩種build、NDHU emblem asset、responsive/a11y baseline；1440×1000與390×844實際走完sender/recipient流程，動態畫面axe為0，640px／320px等效reflow無溢位，步驟切換會回頁首並聚焦新標題 |
| Canonical route | IMPLEMENTED | `contracts/route-graph.v4.json`是單一資料來源；四站、version/checksum、edge與SVG geometry由CI核對 |
| Exhibition demo | IMPLEMENTED | Zero-secret、fake clock、八步sender/recipient、robot離線仍可展示 |
| Robot contract v2 | IMPLEMENTED + UNIT VERIFIED | Command/telemetry/event JSON Schema、正反fixtures、checksum/leg/expiry/state驗證；v1只保留legacy fixture |
| Route jobs | IMPLEMENTED + DB VERIFIED | Immutable migrations新增route job/legs、多段狀態、30分鐘起跑期限、未accepted過期回復、terminal reservation release；Linux CI從空資料庫套用並跑行為測試 |
| Telemetry ingest | IMPLEMENTED + DB VERIFIED | 單一transactional RPC、server received time、boot/sequence ordering、last-known-good、valid/degraded/invalid/off-route projection；sequence與retired boot replay已做pgTAP fault injection |
| Private Realtime | DB AUTH VERIFIED / WIRE PENDING | `delivery:{id}`與`route-validation:{id}` safe projection、topic authorization、10s/60s reconciliation；own/other/operator topic判斷已測，實際WebSocket wire仍待hosted staging |
| Node simulator gateway | IMPLEMENTED + UNIT VERIFIED | DISPATCH背景執行、CANCEL可並行、durable dedup、telemetry v2、production simulator fail closed |
| Jetson Python agent | CONTRACT HARNESS | Outbound poller、背景command executor、durable ledger、CANCEL並行、v2 fixtures；Aurora/ROS hardware adapter尚未實作 |
| Operator route validation | IMPLEMENTED UI / CAPABILITY OFF | 四站dynamic map、state/SLAM/connectivity/leg/lateral/voltage、folded diagnostics、安全停止要求；無PII、無delivery completion |
| Edge robot API | CONTRACT-READY + DENO VERIFIED | `verify_jwt=false`＋函式內per-client constant-time token、vehicle scope、size/schema/rate limit、trusted RPC；Deno LTS type-check與5組runtime contract tests已在CI通過 |
| Repository governance | ENABLED | `main`已要求PR、strict `quality/browser/database/edge-contract` checks、linear history與conversation resolution；enforce admins，禁止force-push與deletion |
| Tests | IMPLEMENTED BASELINE | 39 Vitest、25 Playwright/axe（另1個跨project skip）、5 Python unittest、5 Deno runtime tests、58 pgTAP、gateway並行cancel、contract checksum、build/boundary/bundle checks；本輪live QA無console/page/network error |

## 尚未取得的驗證證據

- 本機目前沒有Docker/Podman；但GitHub Linux CI已完成從空資料庫`db reset`與58個pgTAP。Hosted staging的真實Realtime WebSocket、Edge request與多context E2E仍未執行。
- 尚未建立獨立Supabase staging project、per-client Edge secrets或active staging vehicle provisioning。
- A／B／C／D到四個公開站點的正式mapping全部是`unapproved`，`route_validation_enabled=false`；server會拒絕建立真車route job。
- Python agent只有dry-run adapter；沒有Aurora S map switch、ROS1 taught-route replay、真實telemetry或TLS certificate rotation。
- 沒有置物艙、門鎖、item sensor、QR scanner或remote emergency stop，因此真實投遞維持NO-GO。
- Operator workspace不是完整營運console；custody、door、incident assignment與alert owner仍待後續phase。
- OAuth、SMS/email provider、privacy/legal與校方路線核准仍未完成。
- GitHub repository目前為public；`main` branch protection已啟用，但正式staging前仍需確認repository visibility、collaborator權限、environment approvals與secret ownership符合團隊政策。
- GitHub Actions、Deno LTS與`npx supabase`尚未全部鎖定immutable版本；production部署前需完成供應鏈版本固定。

## Phase gate

| Phase | Current result |
|---|---|
| Exhibition Demo | SOFTWARE GO CANDIDATE；仍需成果展設備現場smoke |
| Production-shaped staging | SOFTWARE + DATABASE CI GO CANDIDATE / HOSTED ENVIRONMENT NO-GO；需獨立Supabase、Edge secrets、Realtime wire與simulator多context E2E |
| Supervised route validation | NO-GO；mapping、robot adapter、現場owner、實體e-stop、TLS與八方向drill未完成 |
| Full physical delivery | NO-GO；compartment/door/sensor/custody缺失 |
| Limited Production Pilot | NO-GO；校方、privacy、provider、incident與physical evidence未完成 |
