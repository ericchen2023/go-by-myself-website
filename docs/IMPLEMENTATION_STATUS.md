# Implementation status

更新日期：2026-08-22。這份文件刻意區分已實作證據與尚未通過的人類／外部 gate，避免把「有 schema 或 adapter」誤稱為「可在校園 production 運作」。

## 已實作

| Scope | Maturity | Evidence |
|---|---|---|
| Foundation | IMPLEMENTED | Git/Vite/npm lockfile、Node 24 CI、checked JavaScript、doctor/env/boundary/bundle scripts |
| Design system | IMPLEMENTED | Responsive website shell、44 px targets、focus/reduced-motion、desktop/mobile compositions |
| Canonical route graph | IMPLEMENTED | 單一 normalized graph、四站、shortest path、SVG projection、list/map keyboard interaction |
| Exhibition demo | IMPLEMENTED | Zero-secret adapter、fake clock、session reset、八步 sender/recipient journey、truthful mock states |
| Shared domain | IMPLEMENTED | Actor/event state machine、validation、presentation mapping、cancellation/custody semantics |
| Production browser adapter | CONTRACT-READY | Supabase OAuth/magic-link、trusted intent calls、private Broadcast skeleton；需 staging project 驗證 |
| Database | CONTRACT-READY | 22-table migration、private PII/credential/rate-limit schema、constraints/indexes、RLS/RPC/append-only triggers、pgTAP baseline |
| Robot gateway | CONTRACT-READY | Outbound client、version/expiry/vehicle checks、pre-execution persistent command ledger、restart fail-closed、separate ACK states、health endpoints |
| Recipient credentials | CONTRACT-READY | 8-char design contract、HMAC Edge flow、atomic open-command creation；provider/robot evidence 未整合 |
| Notifications | SCHEMA/UI CONTRACT | Durable states與 truthful copy 已落地；未選 provider、未發真實訊息 |
| Tests | IMPLEMENTED BASELINE | 28 Vitest、16 Playwright desktop/mobile、axe、SVG geometry、bundle/capability/secret-marker checks、Linux CI＋DB CI job |

## 明確未啟用

- 沒有建立或修改遠端 Supabase、Vercel、Netlify、Google OAuth、SMS/email provider 或 GitHub repository。
- 沒有 robot credentials、ROS bridge、mTLS certificate、實測 route calibration、heartbeat/stale/off-route threshold。
- 沒有使用官方 NDHU logo；目前只有 project-owned `GBM` 圓形 mark。
- 沒有處理真實 PII；production build 在缺少設定時 fail closed 並顯示 capability unavailable。
- QR action 預設不存在；需先確認 physical scanner/display ownership。
- Operator console、alert channel、incident owner 與 support owner 是 physical/pilot gate，尚不能宣稱可營運。
- Migration/RLS 必須在 local Supabase/PostgreSQL 與獨立 staging project 實際套用；SQL 檔存在不等於已驗證部署。
- Gateway 目前只有 simulator hardware adapter，production environment 會拒絕啟動；必須在 robot questionnaire 與實機契約確認後另接核准 adapter。

## Phase gate

| Phase | Current result |
|---|---|
| Exhibition Demo | SOFTWARE GO CANDIDATE；本機自動化與視覺檢查通過，仍需成果展設備／投影／網路斷線現場 smoke |
| Integration-ready Staging | NO-GO；需建立獨立 Supabase、套 migration/pgTAP、配置測試 OAuth 與 simulator gateway |
| Supervised Robot Integration | NO-GO；robot questionnaire、路線、門鎖/sensor、emergency/operator 未完成 |
| Limited Production Pilot | NO-GO；校方、privacy、provider、incident、physical evidence 未完成 |
