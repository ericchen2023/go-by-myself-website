# Verification strategy

## Fast local

```powershell
npm run doctor
npm run check
```

`check` 包含 ESLint、TypeScript checked JS、Vitest、JSON contract、兩種 build、adapter boundary 與 gzip budgets。

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

## Physical acceptance

Automated suites全綠不允許 moving robot。依序做 supervised no-cargo、inert payload、disconnect、late ACK、duplicate/expired command、off-route、door failure、cancel/return與custody recovery。

