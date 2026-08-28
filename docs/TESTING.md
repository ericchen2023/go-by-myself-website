# Verification strategy

## Fast local

```powershell
npm run doctor
npm run check
```

`check` 包含 ESLint、TypeScript checked JS、Vitest、JSON contract、兩種 build、adapter boundary 與 gzip budgets。

Robot v2另執行：

```powershell
npm run contract:fixtures
npm run test:python-agent
```

GitHub的`edge-contract` job另以Deno LTS直接執行`robot-api`型別檢查與四組runtime contract tests，確認Edge使用的Ajv版本、JSON imports、正反fixtures及accepted/completed事件語意。這些測試不需要Supabase secret。

## Browser

```powershell
npx playwright install chromium
npm run test:e2e
```

目前 Playwright涵蓋 deterministic完整旅程、arrival semantic、keyboard map、axe serious/critical baseline、320–768 overflow與真實 SVG geometry。人工仍需涵蓋：NVDA/VoiceOver、200%/400% zoom、large text、touch、virtual keyboard、landscape與低高度。

## Database

```powershell
npm run local:up
npm run db:reset
npm run db:test
npm run local:down
```

必須用兩個 synthetic sender JWT、anonymous、operator、revoked operator與 robot scoped endpoint做正向/負向 matrix。`service_role`/secret測試不能被當作 RLS證據，因其本來就 bypass RLS。

目前pgTAP共49個斷言，包含schema/RLS存在性，以及實際dispatch、route job、ACK、telemetry、off-route、last-known-good、sequence/retired boot replay、arrival語意、private topic ownership、physical gate、terminal與未accepted expiry reservation release。Deno runtime已驗證Edge contract module；Hosted staging仍需補真正的per-client auth、Realtime WebSocket與Edge HTTP正反測試。

## Physical acceptance

Automated suites全綠不允許 moving robot。先做supervised no-cargo route validation：單段、八方向、disconnect、late ACK、duplicate/expired command、off-route、cancel/safe-stop。置物艙與custody capability完成後，才另做inert payload、door failure、return與custody recovery。
