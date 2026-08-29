# go by myself

國立東華大學校園自走車物品投遞 Web 系統的學生專題實作。專案採 shared-core dual-adapter：展示模式與 production-shaped 模式共用狀態機、驗證、路線圖與 UI projection，但在建置時隔離認證、儲存、通知、telemetry 與 robot adapters。

> 這是學生專題，不是國立東華大學官方服務。未完成校方、隱私、營運與實體安全核准前，production 能力維持關閉。

## 快速開始

需求：Node.js 24 LTS、npm 10+。目前程式也允許 Node 22 進行本機開發；CI 固定使用 Node 24。

```powershell
npm ci
npm run doctor
npm run demo
```

開啟 <http://127.0.0.1:4173>。展示模式不需要 Supabase、OAuth、SMS、email 或自走車憑證，也不會呼叫 production API。

## 主要指令

- `npm run demo`：啟動 deterministic 展示模式。
- `npm run build:demo`／`npm run build:production`：建立隔離的兩種 artifact。
- `npm run check`：lint、checked JavaScript、unit、Python agent、contract、文件連結、build、boundary 與 bundle 檢查。
- `npm run test:e2e`：執行 Chromium desktop/mobile E2E 與 accessibility baseline。
- `npm run test:python-agent`：以可用的 `python3`／`python` 執行車端 contract／restart／CANCEL harness。
- `npm run env:init`／`npm run env:check`：建立與檢查本機環境設定。
- `npm run local:up`／`local:reset`／`local:down`：Supabase CLI local stack。
- `npm run gateway`：啟動 robot gateway simulator health server。

## 安全邊界

- 瀏覽器只送出 intent、`expectedVersion` 與 `idempotencyKey`，不送 target status。
- Demo build 只匯入 `src/demo/`；production build 只匯入 `src/production/`。
- Robot gateway 使用 scoped identity 呼叫 trusted endpoints，不持有 Supabase secret key。
- `arrived_dropoff`、command `accepted`、notification `accepted` 都不等於完成。
- 一次性 credential 的 raw value 不進資料庫、log 或 production bundle。

## 目錄

```text
src/                 shared domain、UI、map 與 mode adapters
contracts/           versioned JSON Schema 與 fixtures
gateway/             outbound robot gateway skeleton/simulator
supabase/             migrations、RLS、RPC、seed 與 Edge Functions
tests/                unit、contract、Playwright、a11y
docs/                 architecture、operations、privacy 與 launch gates
scripts/              doctor、environment、boundary、bundle checks
```

## 技術文件

- [完整文件索引](docs/README.md)：依接手、架構、測試、部署與現場營運分類的入口。
- [目前完成度與未啟用能力](docs/IMPLEMENTATION_STATUS.md)
- [車端電腦 AI 技術交接](docs/VEHICLE_PC_AI_HANDOFF.md)：Jetson／ROS 現場盤點、staging provisioning、hardware adapter、真車 GO／NO-GO 與可直接交給下一位 AI 的提示。
- [Robot integration v2 runbook](docs/ROBOT_INTEGRATION_V2.md)
- [Robot integration questionnaire](docs/ROBOT_QUESTIONNAIRE.md)
- [Operational runbooks](docs/RUNBOOKS.md)
