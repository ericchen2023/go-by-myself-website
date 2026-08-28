# Robot integration v2 runbook

## 交付邊界

1. Production-shaped staging用Node simulator跑完整投遞。
2. Supervised route validation用真車空載驗證路線、telemetry、cancel、disconnect與fault。
3. Full physical delivery等置物艙、門鎖、item sensor與custody程序完成後另行啟用。

Route validation不建立recipient credential、不發notification、不進入delivery completed。

## Contract ownership

- Canonical graph：`contracts/route-graph.v4.json`
- Physical mapping gate：`contracts/physical-route-manifest.v1.json`
- Command／telemetry／event：`contracts/*.schema.json`
- Positive fixtures：`contracts/fixtures.json`
- Legacy v1 fixture：`contracts/fixtures.v1.json`

Robot repository必須pin網站repo的明確commit。version、checksum、unknown major version、expiry、vehicle scope、commandId dedup任一不符都fail closed。

Server會保存每台車的boot epoch。同一boot的sequence必須單調增加；新boot被接受後，上一個boot會退休。退休boot的延遲封包只保留在raw telemetry供稽核，API回`TELEMETRY_OUT_OF_ORDER`，不得覆寫current state或公開marker。

## Edge provisioning

`robot-api`關閉Supabase platform JWT，改由函式驗證每個client獨立secret：

```text
ROBOT_GBM_01_TOKEN
ROBOT_GBM_01_VEHICLE_ID
SUPABASE_SECRET_KEY
```

Robot image只持有`CONTROL_PLANE_URL`、`ROBOT_CLIENT_ID=gbm-01`、其scoped token與未來TLS material；不持有Supabase secret key。

## Staging順序

1. 安裝Docker Desktop／Podman，執行`npm run local:up && npm run db:reset && npm run db:test`。
2. 以兩名synthetic sender、operator與revoked operator驗證RLS/private Broadcast。
3. 啟動Node simulator，驗證每秒telemetry、10秒stale、60秒offline與snapshot→subscribe去重。
4. 跑完整sender/recipient flow；arrival不得顯示completed。
5. 跑expired、duplicate、late ACK、restart、disconnect、invalid segment與cancel race。
6. Python agent通過`npm run test:python-agent`與相同fixtures。

## Physical GO gate

在資料庫把任何`physical_route_legs.mapping_approved`或`vehicles.route_validation_enabled`設為true之前，必須保留書面證據：

- A/B/C/D到四站mapping與每段allowed schematic edges。
- `.stcm`檔案checksum、方向與map-switch順序。
- Aurora/ROS frame、pose frequency、relocalization timeout與disconnect policy。
- 實體e-stop owner、隨車人員、測試區域與incident contact。
- Per-client credential、TLS、rotation與revocation演練。

第一輪只跑單段、空載、受控環境；之後才跑八個已示教方向。任何mapping/checksum不一致立即NO-GO。
