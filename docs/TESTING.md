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

Route job測試必須涵蓋leg completion、duplicate/restart replay、未accepted expiry、reservation release、舊boot/sequence、private topic ownership與invalid/off-route不覆寫last-known-good。

## Physical acceptance

Automated suites全綠不允許 moving robot。先做supervised no-cargo route validation：單段、八方向、disconnect、late ACK、duplicate/expired command、off-route、cancel/safe-stop。置物艙與custody capability完成後，才另做inert payload、door failure、return與custody recovery。
