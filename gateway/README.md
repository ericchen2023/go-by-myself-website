# Robot-side Gateway

這個 Node ESM gateway 是 control plane 與實體 controller/ROS bridge 之間的 trust boundary。它只建立 outbound request、驗證 command schema/version/expiry/vehicle、持久化已處理 `commandId`，並分別回報 `accepted | rejected | completed | failed`。

預設沒有 `CONTROL_PLANE_URL` 或 robot identity 時只啟動 degraded health server，不會連線或控制硬體。`SimulatorHardware` 是 contract conformance adapter，不應出現在 production robot image。

實機 adapter 必須在 `docs/ROBOT_QUESTIONNAIRE.md` 全部回答、完成 TLS/provisioning 與 supervised safety drill 後才可加入。

