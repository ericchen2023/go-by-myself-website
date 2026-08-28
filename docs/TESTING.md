# Verification strategy

## Fast local

```powershell
npm run doctor
npm run check
```

`check` 包含 ESLint、TypeScript checked JS、Vitest、JSON contract、兩種 build、adapter boundary 與 gzip budgets。

2026-08-28本機Edge benchmark：LCP 624 ms、FCP 192 ms、24 requests；demo 23.3 KiB JS / 7.2 KiB CSS gzip，production 78.7 KiB JS / 7.2 KiB CSS gzip，全部通過既定budget。這是local regression evidence，不取代部署後真實裝置/網路的p75 Web Vitals。

Robot v2另執行：

```powershell
npm run contract:fixtures
npm run test:python-agent
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

目前pgTAP共58個斷言，包含schema/RLS存在性，以及實際dispatch、route job、ACK、telemetry、off-route、last-known-good、sequence/retired boot replay、arrival語意、private topic ownership、physical gate、terminal與未accepted expiry reservation release；另外覆蓋idempotency request hash、terminal command event monotonicity與robot fault vehicle scope。Deno runtime已有5組Edge contract tests；Hosted staging仍需補真正的per-client auth、Realtime WebSocket與Edge HTTP正反測試。

## Physical acceptance

Automated suites全綠不允許 moving robot。先做supervised no-cargo route validation：單段、八方向、disconnect、late ACK、duplicate/expired command、off-route、cancel/safe-stop。置物艙與custody capability完成後，才另做inert payload、door failure、return與custody recovery。
