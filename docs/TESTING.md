# Verification strategy

## Fast local

```powershell
npm run doctor
npm run check
```

`check` 包含 ESLint、TypeScript checked JS、Vitest、Python agent unittest、JSON contract、交接文件連結／route pin、兩種 build、adapter boundary 與 gzip budgets。GitHub `quality` job 固定使用 Node 24 與 Python 3.10 執行同一指令，避免 Windows 有 `python`、Jetson 只有 `python3` 時產生假的通過結果。

Python agent目前共10個unittest，其中五個專門驗證read-only connection preflight不輸出token、Authorization header或raw pose、能把hosted 401轉成穩定的`ROBOT_IDENTITY_INVALID`、對缺少vehicle ID的malformed state fail closed、損壞回應不顯示traceback，且`agent.py`啟動時不能繞過preflight。

2026-09-02 地圖、動畫與最新 `main` 安全修正合併後的 bundle：demo 27.5 KiB JS / 8.2 KiB CSS gzip，production 83.6 KiB JS / 8.2 KiB CSS gzip，全部低於 150 KiB JS／30 KiB CSS budget。本機 Edge 首次冷啟動曾量到一次 LCP 3.7 秒，隨後三次為 1.296／1.416／0.932 秒；這組資料只作本機 regression evidence，部署後仍要以真實裝置與網路的 p75 Web Vitals 判定。

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

目前 Playwright 涵蓋 deterministic 完整旅程、arrival semantic、keyboard map、靜態與動態 sender/recipient axe、320–768 overflow、640px／320px 等效 reflow、reduced-motion 與真實 SVG geometry。地圖幾何測試固定要求四個站點、三條 canonical edge 與兩條人社站短支線，並確認 marker 仍落在本次可見路徑上。`chromium-motion` 專案刻意關閉 reduced motion，驗證首頁示意只跑一次、車輛會沿本次 SVG 路線前進、方向流光只跑有限次、互動不使用 `transition: all`。2026-09-02 全套結果為 25 passed、3 skipped、0 failed；本輪另定向通過 10 個地圖／動態／axe 測試與 1 個預期 skip，並以實際 Chromium 檢查 desktop、390px 與 320px 的首頁、Step 2、Step 5，console/page error 均為 0。人工仍需涵蓋：NVDA/VoiceOver、實際瀏覽器 200%/400% zoom、large text、真實觸控、virtual keyboard、landscape 與低高度。

## Database

```powershell
npm run local:up
npm run db:reset
npm run db:test
npm run local:down
```

必須用兩個 synthetic sender JWT、anonymous、operator、revoked operator與 robot scoped endpoint做正向/負向 matrix。`service_role`/secret測試不能被當作 RLS證據，因其本來就 bypass RLS。

Repository／GitHub database job 的最新基線為28筆migration、96個pgTAP；hosted staging已套用27筆migration並通過93個pgTAP。Hosted內容已涵蓋schema/RLS、anonymous RPC denial、FK indexes、dispatch、route job、ACK、telemetry、off-route、last-known-good、sequence/retired boot replay、arrival語意、private topic ownership、physical gate、terminal projection、無艙門recovery、recipient handover、reservation release、只提供已示教站點配對與車輛獨立位置。第28筆「command使用實際示教leg ID」migration仍待下一次staging release。Public Google OAuth 仍由定向 SQL 確認 anonymous 不可執行、authenticated 可執行，且 assurance 同時要求 Google identity 與 provider-verified email。Deno runtime 另有 5 組 Edge contract tests。

## Hosted staging smoke（2026-08-31；OAuth設定更新於2026-09-01）

已在 `go-by-myself-staging` 執行：

- `robot-api` 錯token → `401 ROBOT_IDENTITY_INVALID`；正確GBM-01 scope → `200`；wrong vehicle → `403 ROBOT_SCOPE_DENIED`。
- 2026-08-31交接輪替後，以新token呼叫GBM-01 `GET /state` → `200`，vehicle scope matched，safe state為`idle/online`；token值未進repository或測試輸出。
- v2 idle telemetry → `202 accepted/currentUpdated`，隨後vehicle state為`idle/online/sequence=1`；錯major version → `422 CONTRACT_SCHEMA_INVALID`。
- `pickup` exact staging origin preflight → `204`並回相同`Access-Control-Allow-Origin`；不存在publicRef → generic `404 PICKUP_CONTEXT_UNAVAILABLE`。
- 無JWT的`delivery-intent` → Supabase gateway `401`。
- Vercel `staging` branch確實載入production-shaped auth；production shell regression禁止literal `null`與假的simulator文案。
- Google External OAuth app已正式發布；Supabase Google provider顯示Enabled；hosted第16筆auth migration與Vercel `staging` branch限定的`VITE_GOOGLE_AUTH_ENABLED=true`已確認。
- Vercel Standard Protection維持開啟；Automation Bypass已以header實測`/health.json`回`200`與`status=ok`。GitHub Actions secret只提供給手動`Staging verification` workflow，測試程式與報告不輸出值。
- Supabase Auth custom Gmail SMTP仍保存在hosted設定，但目前公開登入流程為Google-only，不再以magic link作fallback。SMTP地址與app password不進測試輸出或repository。

尚待：public Google OAuth使用一般Google帳號的首次註冊／再次登入／session resume E2E、authenticated Realtime WebSocket snapshot/subscription/resync、sender/recipient不同browser contexts與完整simulator journey。這些完成前不可把hosted control-plane ready升級為integration-ready staging GO。

保護中的前端驗證指令：

```text
STAGING_BASE_URL=<protected staging origin>
VERCEL_AUTOMATION_BYPASS_SECRET=<secure runtime secret>
npm run smoke:staging
npm run test:e2e:staging
```

`test:e2e:staging`只驗證health、production-shaped shell、校徽、auth capability gate與demo isolation；不把demo八步流程誤跑到production-shaped環境。

## Physical acceptance

Automated suites全綠不允許 moving robot。先做supervised no-cargo route validation：單段、八方向、disconnect、late ACK、duplicate/expired command、off-route、cancel/safe-stop。置物艙與custody capability完成後，才另做inert payload、door failure、return與custody recovery。

## Edge Function 錯誤回報

`ProductionAdapter` 必須把 Edge Function 回傳的 `error.code` 原樣呈現，不得收斂成單一代碼。
`tests/unit/edge-error-surfacing.test.js` 涵蓋成功還原（含 `requestId`）與四種退回原因：
傳輸層失敗、回應非 JSON、envelope 缺少 code、envelope 未帶 `retryable`。

公開的 `pickup` 端點例外：它本身就刻意把所有失敗收斂成 `PICKUP_CREDENTIAL_INVALID`，
避免未認證的呼叫者藉錯誤差異試探取件碼，因此前端維持通用訊息。
