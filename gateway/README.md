# Robot-side Gateway

這個 Node ESM gateway 是 control plane 與實體 controller/ROS bridge 之間的 trust boundary。它只建立 outbound request、驗證 contract v2／expiry／vehicle／route checksum、持久化已處理 `commandId`，並分別回報 `accepted | rejected | completed | failed`。

長時間 `DISPATCH` 會在背景執行，polling loop 不會被 3–8 分鐘的路線重播阻塞；`CANCEL` 可以獨立進入 idempotent safe-stop policy。Simulator 每秒送出 privacy-safe route projection，但 raw pose只會進受保護資料層。

預設沒有 `CONTROL_PLANE_URL` 或 robot identity 時只啟動 degraded health server，不會連線或控制硬體。`SimulatorHardware` 是 contract conformance adapter，不應出現在 production robot image。

`python_agent/` 是 Jetson contract harness與 outbound agent骨架；目前仍只有 dry-run hardware adapter。實機 adapter 必須在 `docs/ROBOT_QUESTIONNAIRE.md` 全部回答、完成 TLS/provisioning 與 supervised safety drill 後才可加入。

在可連車輛的電腦接手時，請從 [`docs/VEHICLE_PC_AI_HANDOFF.md`](../docs/VEHICLE_PC_AI_HANDOFF.md) 開始，不要直接執行 physical command。
