# Jetson Python agent（contract v2）

這個目錄提供 Jetson／ROS1 端的 outbound-only agent 骨架。它會在背景執行
長時間 `DISPATCH`，主 polling loop 仍可接收 `CANCEL`；command acceptance
與 final event 會先寫入 durable ledger，再回報 control plane。

目前唯一 adapter 是 `dry-run`，且 production 會 fail closed。接上 SLAMTEC
Aurora S 與 ROS1 前，robot repo 必須 pin 本網站 repo 的 contract commit，並
以 `python -m unittest gateway/python_agent/test_contract.py` 通過相同 fixtures。

實機 adapter 必須實作 taught-route replay、localization/map-switch 狀態、實體
e-stop 程序與 telemetry v2；不得把 dry-run 改名後當作 production adapter。
