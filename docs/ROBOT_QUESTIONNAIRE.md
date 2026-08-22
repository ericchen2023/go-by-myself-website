# Robot integration questionnaire

未完整回答、文件化並由 robot/safety owner 簽核前，只能使用 `SimulatorHardware`。

1. Controller platform 與 onboard compute？
2. OS 與 CPU architecture？
3. ROS、ROS2 或 none；distribution/version？
4. Localization source？
5. Physical coordinate system、origin、unit、orientation？
6. GPS availability 與室內可用性？
7. ROS map/odom/base frames？
8. Pose frequency、accuracy、jitter？
9. 現有 route representation？
10. Command transport/API？
11. Campus Wi-Fi/4G/5G、NAT、防火牆條件？
12. Vehicle identifier 與 credential provisioning owner？
13. Battery data 與 low-battery behavior？
14. Emergency stop owner、trigger、復原程序？
15. Compartment open/close API？
16. Door、lock、item-present sensors？
17. Obstacle/fault states？
18. Heartbeat frequency？
19. Accepted/completed ACK semantics？
20. Authentication、TLS、certificate rotation？
21. Disconnect 時車端行為？
22. 允許的 maximum command latency？
23. Telemetry buffer/replay？
24. Reboot 後 boot ID/sequence 行為？
25. Return-to-base 與 safe-stop？
26. 取消運送時 safety decision owner？
27. 現有 API/topic/message 文件？
28. QR scanner/display 是否存在，誰掃誰？
29. UI 可辨識的 vehicle name/顏色/標記？
30. Physical test 與 incident contact owner？

另需提供：route calibration samples、normal/edge-case telemetry fixtures、door/sensor evidence semantics、credential provisioning/rotation runbook、supervised drill signoff。

