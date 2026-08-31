# Verification strategy

## Fast local

```powershell
npm run doctor
npm run check
```

`check` 包含 ESLint、TypeScript checked JS、Vitest、Python agent unittest、JSON contract、交接文件連結／route pin、兩種 build、adapter boundary 與 gzip budgets。GitHub `quality` job 固定使用 Node 24 與 Python 3.10 執行同一指令，避免 Windows 有 `python`、Jetson 只有 `python3` 時產生假的通過結果。

Python agent目前共10個unittest，其中五個專門驗證read-only connection preflight不輸出token、Authorization header或raw pose、能把hosted 401轉成穩定的`ROBOT_IDENTITY_INVALID`、對缺少vehicle ID的malformed state fail closed、損壞回應不顯示traceback，且`agent.py`啟動時不能繞過preflight。

2026-08-28本機Edge benchmark：LCP 624 ms、FCP 192 ms、24 requests；demo 23.3 KiB JS / 7.2 KiB CSS gzip，production 78.7 KiB JS / 7.2 KiB CSS gzip，全部通過既定budget。這是local regression evidence，不取代部署後真實裝置/網路的p75 Web Vitals。

Robot v2需要針對單一層除錯時，可個別執行：

```powershell
npm run contract:fixtures
npm run test:python-agent
npm run docs:check
```

GitHub的`edge-contract` job另以Deno LTS直接執行`robot-api`型別檢查與五組runtime contract tests，確認Edge使用的Ajv版本、JSON imports、正反fixtures、accepted/completed事件語意與fault vehicle scope。這些測試不需要Supabase secret。

## Browser

```powershell
npx playwright install chromium
npm run test:e2e
```

目前 Playwright涵蓋 deterministic完整旅程、arrival semantic、keyboard map、靜態與動態sender/recipient axe、320–768 overflow、640px／320px等效reflow、reduced-motion與真實 SVG geometry。2026-08-28另以實際Chromium在1440×1000與390×844逐頁走完sender、recipient與completion，共留存13張畫面，console/page/network error皆為0；並新增step transition的scroll/focus regression與公開UI不得顯示內部狀態版本的斷言。人工仍需涵蓋：NVDA/VoiceOver、實際瀏覽器200%/400% zoom、large text、真實觸控、virtual keyboard、landscape與低高度。

## Database

```powershell
npm run local:up
npm run db:reset
npm run db:test
npm run local:down
```

必須用兩個 synthetic sender JWT、anonymous、operator、revoked operator與 robot scoped endpoint做正向/負向 matrix。`service_role`/secret測試不能被當作 RLS證據，因其本來就 bypass RLS。

目前 hosted pgTAP 共65個斷言（RLS 25、route integration 40），包含schema/RLS、anonymous RPC denial、FK indexes、dispatch、route job、ACK、telemetry、off-route、last-known-good、sequence/retired boot replay、arrival語意、private topic ownership、physical gate、terminal與未accepted expiry reservation release；另外覆蓋idempotency request hash、terminal command event monotonicity與robot fault vehicle scope。Deno runtime另有5組Edge contract tests。

## Hosted staging smoke（2026-08-31）

已在 `go-by-myself-staging` 執行：

- `robot-api` 錯token → `401 ROBOT_IDENTITY_INVALID`；正確GBM-01 scope → `200`；wrong vehicle → `403 ROBOT_SCOPE_DENIED`。
- v2 idle telemetry → `202 accepted/currentUpdated`，隨後vehicle state為`idle/online/sequence=1`；錯major version → `422 CONTRACT_SCHEMA_INVALID`。
- `pickup` exact staging origin preflight → `204`並回相同`Access-Control-Allow-Origin`；不存在publicRef → generic `404 PICKUP_CONTEXT_UNAVAILABLE`。
- 無JWT的`delivery-intent` → Supabase gateway `401`。
- Vercel `staging` branch確實載入production-shaped auth；production shell regression禁止literal `null`與假的simulator文案。
- Supabase Auth custom Gmail SMTP已儲存並兩次成功重載；email limiter由2/h更新為30/h。SMTP地址與app password不進測試輸出或repository。

尚待：authenticated Realtime WebSocket snapshot/subscription/resync、custom Gmail SMTP啟用後的magic-link實際收信、sender/recipient不同browser contexts與完整simulator journey。這些完成前不可把hosted control-plane ready升級為integration-ready staging GO。

## Physical acceptance

Automated suites全綠不允許 moving robot。先做supervised no-cargo route validation：單段、八方向、disconnect、late ACK、duplicate/expired command、off-route、cancel/safe-stop。置物艙與custody capability完成後，才另做inert payload、door failure、return與custody recovery。
