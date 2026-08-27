# Operational runbooks (pre-pilot draft)

這些 runbook 是 operator console 與 alert owner 的輸入，不是一般 sender 可執行的 emergency controls。正式 pilot 前需填入人名、電話、SLA、現場位置與 robot-specific procedures。

## Robot offline / telemetry stale

1. 凍結 last-known-good；禁止 extrapolation 與假 marker。
2. 保留 delivery lifecycle，建立 connectivity fault 與 correlation ID。
3. 暫停會產生新的 physical action 的 UI；不得顯示 cancel/open success。
4. Robot owner 查 gateway readiness、network、boot ID/sequence 與 local controller state。
5. Custody 已存在時由 operator 選 safe stop/return/approved destination。

## Supervised route validation

1. 只在 A–D 對四站 mapping、route graph version/checksum、八個 physical leg 都已簽核時啟用 capability。
2. 執行前確認現場 operator、robot owner、實體 e-stop、空載與受控路線均就位。
3. Operator workspace 一次只建立一個 validation route job；公開 sender 頁不顯示 raw x/y、A–D 或 SLAM diagnostics。
4. 長時間 DISPATCH 期間 Gateway 必須繼續 polling；「要求安全停止」送出無 vehicle-state precondition 的 idempotent CANCEL。
5. `accepted` 只表示 agent 接受工作；只有最後一個 leg 的 `completed` 才結束 validation，且不得建立 recipient credential、notification 或 completed delivery。
6. checksum、segment、boot epoch、identity 任一不符，立即 NO-GO；保留 raw audit，禁止覆寫 current projection。

## Off-route

1. 立即停止公開 raw pose，只顯示安全訊息。
2. 建立 critical fault，保留 incident telemetry window。
3. 通知現場 safety owner；一般使用者不得自行靠近尋車。
4. 依 robot-specific procedure safe stop；Web cancel 不等於 emergency stop。
5. 完成 map calibration/root-cause review 後才 re-enable route。

## Compartment ACK unknown / door open too long

1. `accepted` 不得投影為 open；UI 顯示「尚未確認，勿強行操作」。
2. 以相同 `commandId/idempotencyKey` 查詢 prior/current result，不建立第二個 physical command。
3. Sensor conflict 時禁止移動，operator 查 door/lock/item evidence。
4. Manual override 必須記錄 actor、reason、evidence 與 custody consequence。

## Recipient absent / credential expired

1. Credential 失效或鎖定後，不揭露 publicRef/code 哪一項正確。
2. 禁止 sender 在 `awaiting_recipient` 直接取消。
3. Operator 驗證身份後可 rearm，或依核准政策 return/safe custody。
4. Raw code/QR 不得出現在 ticket、analytics、log 或 screen recording。

## Unresolved custody

1. 永遠不要把 arrival、door open 或 item sensor 單一訊號當完成。
2. 記錄物品最後可信位置、door state、vehicle、actor、時間與 evidence。
3. Delivery 保持 non-terminal 或進 `delivery_failed`，不可無理由 `completed/cancelled`。
4. 指定人員完成交還/保管，才寫入 `custody_resolution` 與 terminal history。
