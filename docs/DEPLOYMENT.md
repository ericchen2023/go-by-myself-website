# Deployment and rollback

## Environment isolation

- Demo：獨立 hostname/artifact，zero-secret，不連 production URL。
- Local production-shaped：local Supabase＋simulator gateway。
- Test：ephemeral DB、synthetic accounts。
- Staging：獨立 Supabase project/hostname、sandbox provider、simulator。
- Production：獨立 project/domain/provider/gateway；robot capability 預設 disabled。

Preview deployments 不得收到 production Supabase URL、secret、OAuth/provider 或 robot credentials。Browser 只使用 publishable key；Supabase secret key只在受信任 Edge/worker；robot image只持有 scoped gateway identity。

Gateway 必須設定 `GATEWAY_DEPLOY_ENV` 與 `GATEWAY_HARDWARE_ADAPTER`。目前 repository 只提供 staging/local simulator；`production` 會 fail closed，直到核准的 hardware/ROS bridge 實作並通過 physical gates。

## Release sequence

1. `npm ci && npm run check && npm run test:e2e`。
2. 從空 local/test database 套用所有 immutable migrations與 pgTAP。
3. 在 staging 執行 Auth/RLS/simulator/recipient/headers/health smoke。
4. 驗證 backup/restore，先 expand migration，再 deploy相容 backend。
5. Deploy frontend/gateway capability off；one-vehicle canary 前需 human approval。
6. Canary只限一車、一條核准路線、監督時段與 inert payload。

## Rollback

- Application defect：關閉 capability flag，重新 deploy上一版相容 artifact。
- Recoverable schema defect：forward corrective migration；不修改已套用 migration。
- Destructive/data-loss：停止 writes，依驗證過的 restore runbook還原 backup。
- Demo hostname與資料永遠獨立，production incident不得影響成果展示。
