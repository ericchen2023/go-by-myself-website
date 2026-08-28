# Deployment and rollback

## Environment isolation

- Demo：獨立 hostname/artifact，zero-secret，不連 production URL。
- Local production-shaped：local Supabase＋simulator gateway。
- Test：ephemeral DB、synthetic accounts。
- Staging：獨立 Supabase project/hostname、sandbox provider、simulator。
- Production：獨立 project/domain/provider/gateway；robot capability 預設 disabled。

Preview deployments 不得收到 production Supabase URL、secret、OAuth/provider 或 robot credentials。Browser 只使用 publishable key；Supabase secret key只在受信任 Edge/worker；robot image只持有 scoped gateway identity。

`robot-api` 必須保持 `verify_jwt=false`，讓函式先以每個 client 獨立的 `ROBOT_<CLIENT>_TOKEN` 與 `ROBOT_<CLIENT>_VEHICLE_ID` 驗證 robot scope。這不代表公開存取：未設定的 client、錯 token、錯 vehicle UUID 都會在資料庫操作前被拒絕。`SUPABASE_SECRET_KEY` 只存在 Edge 環境，不得複製到 Jetson、browser 或 preview deployment。

Gateway 必須設定 `GATEWAY_DEPLOY_ENV` 與 `GATEWAY_HARDWARE_ADAPTER`。目前 repository 只提供 staging/local simulator；`production` 會 fail closed，直到核准的 hardware/ROS bridge 實作並通過 physical gates。

## 目前部署狀態（2026-08-29）

GitHub `main` 已啟用 protected-branch 規則與 strict `quality`、`browser`、`database`、`edge-contract` checks。本機沒有 `SUPABASE_ACCESS_TOKEN`、Supabase staging project、`VERCEL_TOKEN` 或可用的 Docker／Podman，因此目前沒有 hosted staging 或 production deployment；下一步必須由持有 staging 權限的 owner 依[車端 AI 交接文件](VEHICLE_PC_AI_HANDOFF.md)建立獨立環境。缺少這些外部憑證不影響 zero-secret demo，但不得宣稱 hosted integration 已完成。

## Release sequence

1. `npm ci && npm run check && npm run test:e2e`。
2. 從空 local/test database 套用所有 immutable migrations與 pgTAP。
3. 在 staging 執行 Auth/RLS/simulator/recipient/headers/health smoke。
4. 以錯 token、舊 boot、倒退 sequence、expired command、late ACK 與 CANCEL 做故障注入；確認 raw telemetry 可稽核，但 current projection 不倒退。
5. 驗證 private `delivery:{id}`／`route-validation:{id}` topic 的正反 RLS，並觀察 10 秒 stale、60 秒 offline staging default。
6. 驗證 backup/restore，先 expand migration，再 deploy相容 backend。
7. Deploy frontend/gateway capability off；A–D mapping 與所有 physical leg checksum 簽核後，才能個別啟用車輛的 `route_validation_enabled`。
8. Canary只限一車、一條核准路線、監督時段與 inert payload；本階段不載物、不產生 completed delivery。

## Rollback

- Application defect：關閉 capability flag，重新 deploy上一版相容 artifact。
- Recoverable schema defect：forward corrective migration；不修改已套用 migration。
- Destructive/data-loss：停止 writes，依驗證過的 restore runbook還原 backup。
- Demo hostname與資料永遠獨立，production incident不得影響成果展示。
