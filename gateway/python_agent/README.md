# Jetson Python agent（contract v2）

這個目錄提供 Jetson／ROS1 端的 outbound-only agent 骨架。`connection_check.py`
只驗證scoped identity與vehicle state，不取得command、不呼叫hardware，應作為車端
第一次連線的入口。`agent.py`才會在背景執行
長時間 `DISPATCH`，主 polling loop 仍可接收 `CANCEL`；command acceptance
與 final event 會先寫入 durable ledger，再回報 control plane。

目前唯一 adapter 是 `dry-run`，且 production 會 fail closed。接上 SLAMTEC
Aurora S 與 ROS1 前，robot repo 必須 pin 本網站 repo 的 contract commit，並
以 `python -m unittest gateway/python_agent/test_contract.py` 通過相同 fixtures。

實機 adapter 必須實作 taught-route replay、localization/map-switch 狀態、實體
e-stop 程序與 telemetry v2；不得把 dry-run 改名後當作 production adapter。

完整車端盤點、staging provisioning、contract reference與 supervised no-cargo
GO／NO-GO 請依 [`docs/VEHICLE_PC_AI_HANDOFF.md`](../../docs/VEHICLE_PC_AI_HANDOFF.md) 執行。

環境變數名稱與公開staging值可由`vehicle.env.example`複製，但
`ROBOT_CLIENT_TOKEN`必須在交接當下輪替並以安全管道提供，不能寫入env範例或Git。
