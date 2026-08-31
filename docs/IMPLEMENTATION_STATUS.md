# Implementation status

更新日期：2026-08-31。這份文件區分「程式已落地」、「hosted staging 已驗證」與「真車／正式營運已核准」，避免把網站上線誤稱為校園實機可用。

## 已實作與已取得的證據

| Scope | Maturity | Evidence |
|---|---|---|
| Foundation / UI | IMPLEMENTED + LIVE QA VERIFIED | Vite/Vanilla JS、checked JS、demo/production-shaped 兩種 build、NDHU emblem asset、responsive/a11y baseline；production shell regression test 保證不輸出 `null`，staging 不再宣稱 simulator |
| Canonical route | IMPLEMENTED | `contracts/route-graph.v5.json` 是單一資料來源；四站、version/checksum、edge 與 SVG geometry 由 CI 核對。v5 改用實測道路中心線（`routes_site/pass_spine.csv`）：四站沿單一走廊 LIBRARY–HSS2–HSS1–ADMIN，三條帶折線幾何的邊，每條示教路線對應一條邊。v4 的主幹＋分支拓撲會讓 LIBRARY→ADMIN 略過兩個人社站，車子被畫在沒走過的路段上 |
| Exhibition demo | IMPLEMENTED + HOSTED | Zero-secret、fake clock、八步 sender/recipient、robot 離線仍可展示；Vercel `main` 保持 demo artifact |
| Hosted staging control plane | HOSTED + MIGRATION VERIFIED | Supabase `go-by-myself-staging`（project ref `aiuajbflpwdzkaeeocab`，Tokyo）已從空 project 套用 14 個 immutable migrations，v4 route active、4 個 visible stops、0 個 approved physical legs |
| Hosted staging frontend | HOSTED + BUILD VERIFIED | Vercel `staging` branch 固定網址：<https://go-by-myself-website-git-staging-hsuanisgay.vercel.app>；branch-scoped public config 指向 staging Supabase，`main` 不取得 staging keys |
| Auth boundary | CONFIGURED / PROVIDER GATED | Site URL 與 redirect allow-list 已綁 staging hostname；custom Gmail SMTP已儲存在Supabase Auth並成功重載，email rate limit為30/h；Google provider尚未獲client/校方核准，因此primary Google CTA fail closed並引導fallback |
| Robot contract v2 | IMPLEMENTED + UNIT VERIFIED | Command/telemetry/event JSON Schema、正反 fixtures、checksum/leg/expiry/state 驗證；v1 只保留 legacy fixture |
| Route jobs | IMPLEMENTED + DB VERIFIED | Route job/legs、多段狀態、30 分鐘起跑期限、未 accepted 過期回復、terminal reservation release 已由 hosted pgTAP 驗證 |
| Telemetry ingest | HOSTED HTTP VERIFIED | 單一 transactional RPC、server received time、boot/sequence ordering、last-known-good 與 safe projection；hosted v2 idle telemetry 回 202 並更新 online/current，錯 schema 回 422 |
| Private Realtime | DB AUTH VERIFIED / WIRE PENDING | `delivery:{id}` 與 `route-validation:{id}` topic policies、10s/60s reconciliation 已由 pgTAP 驗證；真實 authenticated WebSocket reconnect/resync 仍待 synthetic account E2E |
| Node simulator gateway | IMPLEMENTED + UNIT VERIFIED | DISPATCH 背景執行、CANCEL 可並行、durable dedup、telemetry v2、production simulator fail closed |
| Jetson Python agent | CONTRACT HARNESS | 新增不取command、不接hardware的read-only連線預檢；既有outbound poller、背景command executor、durable ledger、CANCEL並行、v2 fixtures；Aurora/ROS hardware adapter尚未實作 |
| Operator route validation | IMPLEMENTED UI / CAPABILITY OFF | 四站 dynamic map、state/SLAM/connectivity/leg/lateral/voltage、folded diagnostics、安全停止要求；`routeValidationEnabled=false`，無 PII、無 delivery completion |
| Edge Functions | HOSTED HTTP VERIFIED | `delivery-intent`（platform JWT）、`pickup`（public credential flow）、`robot-api`（per-client constant-time token）均 ACTIVE；GBM-01交接token已於2026-08-31輪替，read-only state preflight 200且scope一致；錯 token 401、跨車 403、pickup generic 404、CORS exact-origin 204 |
| Repository governance | ENABLED | `main` 與 `staging` 都要求 PR、strict `quality/browser/database/edge-contract` checks、linear history 與 conversation resolution；enforce admins，禁止 force-push 與 deletion |
| Vercel deployment protection | ENABLED + AUTOMATION BYPASS VERIFIED | Standard Protection維持開啟；CI／E2E專用bypass只存GitHub Actions secret，header對staging health實測通過，不提供給browser bundle或車端 |
| Tests | IMPLEMENTED BASELINE | 54 Vitest、25 Playwright/axe（另 2 個 hosted-only與1個跨 project skip）、10 Python unittest、5 Deno runtime tests、65 hosted pgTAP（RLS 25＋integration 40），另有 contract/build/boundary/bundle、protected staging health與production shell E2E |

## 尚未取得的驗證證據

- Hosted Realtime真實WebSocket、sender/recipient不同browser contexts、custom Gmail SMTP啟用後的magic-link實際收信與reconnect/version dedup尚未完成；目前不能宣稱完整integration-ready staging GO。
- Google OAuth client、signed `hd=gms.ndhu.edu.tw` 真實帳號驗證尚未取得；Google provider 維持 disabled。
- 投遞用SMS/email notification provider、provider receipt、正式support owner、privacy/legal review尚未完成；這與已設定的Auth登入信SMTP是兩套不同服務。
- A／B／C／D 到四個公開站點的正式 mapping 全部是 `unapproved`，`route_validation_enabled=false`；server 會拒絕建立真車 route job。
- Python agent只有read-only連線預檢與dry-run adapter；沒有Aurora S map switch、ROS1 taught-route replay、真實telemetry或client certificate rotation。
- 沒有置物艙、門鎖、item sensor、QR scanner 或 remote emergency stop，因此真實投遞維持 NO-GO。
- Operator workspace 不是完整營運 console；custody、door、incident assignment 與 alert owner 仍待後續 phase。
- Repository 目前為 public；secret 值只存在 Supabase encrypted secrets 與車端安全交付管道，不得寫入 GitHub 或文件。

## Phase gate

| Phase | Current result |
|---|---|
| Exhibition Demo | SOFTWARE + HOSTED GO CANDIDATE；仍需成果展設備現場 smoke |
| Production-shaped staging | HOSTED CONTROL-PLANE READY / FULL E2E PENDING；DB、RLS、Edge、Vercel 與 robot HTTP 已驗證，Realtime/magic-link/multi-context E2E 未完成 |
| Supervised route validation | NO-GO；mapping、hardware adapter、現場 owner、實體 e-stop、client TLS 與八方向 drill 未完成 |
| Full physical delivery | NO-GO；compartment/door/sensor/custody 缺失 |
| Limited Production Pilot | NO-GO；校方、privacy、provider、incident 與 physical evidence 未完成 |
