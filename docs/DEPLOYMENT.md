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

## 目前部署狀態（2026-08-31）

GitHub `main` 已啟用 protected-branch 規則與 strict `quality`、`browser`、`database`、`edge-contract` checks。Supabase CLI鎖定為`2.116.0`；建立hosted staging前先執行`supabase db push --dry-run`，並保留所有physical capability為disabled。最新hosted狀態記錄於[實作狀態](IMPLEMENTATION_STATUS.md)，未完成hosted smoke前不得宣稱integration-ready。

## Release sequence

1. `npm ci && npm run check && npm run test:e2e`。
2. 從空 local/test database 套用所有 immutable migrations與 pgTAP。
3. Hosted migration成功後，以[`supabase/snippets/provision_staging_simulator.sql`](../supabase/snippets/provision_staging_simulator.sql)啟用synthetic vehicle；此snippet會稽核操作，並在任何physical mapping已核准時fail closed。
4. 在 staging 執行 Auth/RLS/simulator/recipient/headers/health smoke。
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
