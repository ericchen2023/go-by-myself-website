# Deployment and rollback

## Environment isolation

- Demo：獨立 hostname/artifact，zero-secret，不連 production URL。
- Local production-shaped：local Supabase＋simulator gateway。
- Test：ephemeral DB、synthetic accounts。
- Staging：獨立 Supabase project/hostname、sandbox provider、simulator。
- Production：獨立 project/domain/provider/gateway；robot capability 預設 disabled。

Preview deployments 不得收到 production Supabase URL、secret、OAuth/provider 或 robot credentials。Browser 只使用 publishable key；Supabase secret key只在受信任 Edge/worker；robot image只持有 scoped gateway identity。Staging frontend的`VITE_DEPLOY_ENV=staging`由hosting environment提供，`npm run build:production`不覆寫它。

`robot-api` 必須保持 `verify_jwt=false`，讓函式先以每個 client 獨立的 `ROBOT_<CLIENT>_TOKEN` 與 `ROBOT_<CLIENT>_VEHICLE_ID` 驗證 robot scope。這不代表公開存取：未設定的 client、錯 token、錯 vehicle UUID 都會在資料庫操作前被拒絕。Hosted Edge優先讀取Supabase自動注入的`SUPABASE_SECRET_KEYS`／`SUPABASE_PUBLISHABLE_KEYS`之`default` key；單數名稱與legacy key只作local相容fallback。Secret key不得複製到Jetson、browser或preview deployment。

Browser會呼叫`delivery-intent`與`pickup`，因此Edge secrets必須設定`APP_ORIGIN=https://<staging-frontend-host>`；沒有此值時只允許本機`http://127.0.0.1:4173`，部署網站會被瀏覽器CORS拒絕。

Gateway 必須設定 `GATEWAY_DEPLOY_ENV` 與 `GATEWAY_HARDWARE_ADAPTER`。目前 repository 只提供 staging/local simulator；`production` 會 fail closed，直到核准的 hardware/ROS bridge 實作並通過 physical gates。

## 目前部署狀態（2026-09-01）

GitHub `main` 與 `staging` 都已啟用 protected-branch 規則與 strict `quality`、`browser`、`database`、`edge-contract` checks。Supabase CLI 鎖定為 `2.116.0`；hosted staging已套用全部25個immutable migrations，route graph v5、public Google OAuth assurance、terminal projection、無艙門 recovery與recipient handover均已生效，所有physical capability仍為disabled。

| Resource | Hosted staging value | Verified state |
|---|---|---|
| Vercel frontend | <https://go-by-myself-website-git-staging-hsuanisgay.vercel.app> | `staging` branch Preview；production-shaped build、獨立 branch env |
| Supabase project | `go-by-myself-staging` / `aiuajbflpwdzkaeeocab` / Tokyo | ACTIVE_HEALTHY；25 migrations、v5 route active、4 stops、0 approved physical legs |
| Control-plane URL | `https://aiuajbflpwdzkaeeocab.supabase.co` | Browser publishable config只存在 staging Preview scope |
| Edge Functions | `delivery-intent`、`pickup`、`robot-api` | version 2 ACTIVE；JWT/custom-auth 邊界已以 hosted HTTP 正反測試 |
| Auth | staging frontend origin / Supabase Google provider | Google Web client已建立；External app已發布；provider、Site URL、redirect allow-list、auth migration與staging-only CTA flag均已設定 |
| Synthetic vehicle | `GBM-01` | active/available；handoff token已輪替並通過read-only state preflight；telemetry v2 enabled；route validation disabled |

Staging Preview 保留 Vercel Standard Protection，不公開關閉登入保護。已建立用途限定為 CI／E2E 的 Protection Bypass for Automation，值只保存於 GitHub Actions repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`；固定網址保存在 Actions variable `STAGING_BASE_URL`。測試只透過 `x-vercel-protection-bypass` request header 使用，不放在 URL、文件、browser bundle、log 或車端環境。車端直接連 Supabase robot control plane，不需要也不得取得這組 Vercel secret。

已驗證：hosted／GitHub database job的84-test migration基線，以及Google identity、provider-verified email、匿名拒絕與authenticated grant定向檢查；另有錯／對robot token、wrong-vehicle scope、v2 idle telemetry、schema rejection、pickup generic failure、exact-origin CORS與sender JWT gate。尚未驗證：public Google OAuth完整live flow、authenticated Realtime WebSocket與sender/recipient多context E2E。因此目前是 **hosted control-plane ready**，仍不是完整 integration-ready GO。既有custom Gmail SMTP保留在Supabase，但目前Google-only公開流程不使用登入信；它也不能當作投遞通知provider已完成的證據。

Google CTA 由 browser-safe `VITE_GOOGLE_AUTH_ENABLED` 控制；未設定時預設為 `false`。Staging已在Vercel Preview中以`staging` Git branch範圍設為`true`，其他Preview、demo與production不會繼承。OAuth client secret只放Supabase provider設定，不可放Vercel、browser環境、GitHub或repository。

## Public Google OAuth staging 設定

目前產品決策是「任何Google帳號可註冊／登入」，不限制`gms.ndhu.edu.tw`。網站不另設密碼；Supabase會在首次Google登入時建立user，之後同一Google身分直接登入。第1–7項已於2026-09-01完成，第8項仍是live E2E gate：

1. 在Google Auth Platform建立staging用的OAuth client，Application type選`Web application`，Audience選可供外部Google帳號使用的`External`。Scopes只保留`openid`、email與profile。
2. Authorized JavaScript origins加入`https://go-by-myself-website-git-staging-hsuanisgay.vercel.app`。
3. Authorized redirect URIs加入`https://aiuajbflpwdzkaeeocab.supabase.co/auth/v1/callback`。這是Google回到Supabase的callback，不是Vercel網址。
4. 在Supabase Dashboard的Authentication → Providers → Google填入client ID與client secret並啟用provider。此項已完成；secret只存在provider設定，不可貼到Vercel變數。
5. 在Supabase Authentication → URL Configuration確認Site URL為staging frontend，Redirect URLs包含`https://go-by-myself-website-git-staging-hsuanisgay.vercel.app/`。
6. 套用`20260831233000_allow_verified_google_accounts.sql`並驗證migration history與auth grant／函式條件。Migration會讓非Google舊登入信帳號回到`pending`；Google provider且`email_verified=true`才可啟用投遞。此項已完成；後續 delivery flow migrations 也已發布，hosted目前共25筆migration。
7. 只在Vercel `staging` branch的Preview環境設定`VITE_GOOGLE_AUTH_ENABLED=true`，重新部署；`main` demo不需要此值。此項已完成設定，branch同步會觸發新的Preview deployment。
8. 分別用一個非東華Google帳號與一個既有Google帳號測試：首次登入會建立帳號、重新登入會回到同一user、未驗證或非Google身分無法取得投遞權限。

正式domain啟用時應建立獨立production OAuth client，並以正式origin／callback替換staging值；不要共用staging secret。

## Release sequence

1. `npm ci && npm run check && npm run test:e2e`。Hosted staging 另由 GitHub Actions 的 `Staging verification` workflow 執行 `npm run smoke:staging` 與 `npm run test:e2e:staging`；本機執行時需以安全環境變數提供同名 URL／secret，不能寫進 `.env.example` 的值或 shell history。
2. 從空 local/test database 套用所有 immutable migrations與 pgTAP。
3. Hosted migration成功後，以[`supabase/snippets/provision_staging_simulator.sql`](../supabase/snippets/provision_staging_simulator.sql)啟用synthetic vehicle；此步已完成，且任何physical mapping已核准時仍會fail closed。
4. 在 staging 執行 Auth/RLS/simulator/recipient/headers/health smoke；Google client/provider/migration與CTA gate、DB、Edge HTTP及headers已完成，Google帳號live journey、Realtime與完整sender/recipient flow仍待補齊。
5. 以錯 token、舊 boot、倒退 sequence、expired command、late ACK 與 CANCEL 做故障注入；確認 raw telemetry 可稽核，但 current projection 不倒退。
6. 驗證 private `delivery:{id}`／`route-validation:{id}` topic 的正反 RLS，並觀察 10 秒 stale、60 秒 offline staging default。
7. 驗證 backup/restore，先 expand migration，再 deploy相容 backend。
8. Deploy frontend/gateway capability off；A–D mapping 與所有 physical leg checksum 簽核後，才能個別啟用車輛的 `route_validation_enabled`。
9. Canary只限一車、一條核准路線、監督時段與 inert payload；本階段不載物、不產生 completed delivery。

## Rollback

- Application defect：關閉 capability flag，重新 deploy上一版相容 artifact。
- Recoverable schema defect：forward corrective migration；不修改已套用 migration。
- Destructive/data-loss：停止 writes，依驗證過的 restore runbook還原 backup。
- Demo hostname與資料永遠獨立，production incident不得影響成果展示。
