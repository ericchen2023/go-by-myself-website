# 專案文件索引

這裡是 `go by myself` 的技術文件入口。先依工作目的選文件；不要把 demo／contract-ready／hosted staging／真車驗證混成同一成熟度。

## 接手與目前狀態

- [目前完成度與 NO-GO](IMPLEMENTATION_STATUS.md)：已落地、已由 CI 證明與仍待外部證據的範圍。
- [車端電腦 AI 技術交接](VEHICLE_PC_AI_HANDOFF.md)：另一台可連車輛電腦的第一份必讀文件，含從零clone、scoped token輪替、read-only Supabase連線預檢與可直接交給當地AI的prompt。
- [Robot integration questionnaire](ROBOT_QUESTIONNAIRE.md)：實機前 30 題盤點與證據清單。
- Hosted staging入口：<https://go-by-myself-website-git-staging-hsuanisgay.vercel.app>；目前為control-plane驗證環境，不代表真車或正式營運GO。

## 架構與契約

- [Architecture decisions](ARCHITECTURE.md)：shared core、trusted transition、route job 與安全邊界。
- [Robot integration v2](ROBOT_INTEGRATION_V2.md)：contract ownership、staging 順序與 physical GO gate。
- [Gateway 說明](../gateway/README.md)：Node simulator／gateway trust boundary。
- [Jetson Python agent](../gateway/python_agent/README.md)：outbound dry-run harness 與尚缺的硬體能力。

## 開發、驗證與發布

- [Testing](TESTING.md)：本機、瀏覽器、database、Edge 與 physical acceptance。
- [Deployment and rollback](DEPLOYMENT.md)：環境隔離、發布順序與回復策略。
- [Operational runbooks](RUNBOOKS.md)：offline、off-route、ACK、credential 與 custody 處置。
- [Security policy](../SECURITY.md)：漏洞回報、PII／secret 與安全基線。

## 介面與品牌

- [Design system](../DESIGN.md)：視覺、地圖、動態、responsive 與無障礙規則。
- [Brand asset provenance](brand-assets.md)：NDHU emblem 來源與使用限制。
- [Project guidance](../CLAUDE.md)：修改程式時必須遵守的專案規則。

## 建議閱讀順序

- 網站開發：`README → DESIGN → ARCHITECTURE → TESTING`。
- Staging owner：`IMPLEMENTATION_STATUS → DEPLOYMENT → ROBOT_INTEGRATION_V2 → RUNBOOKS`。
- 車端 AI／工程師：`VEHICLE_PC_AI_HANDOFF → ROBOT_QUESTIONNAIRE → ROBOT_INTEGRATION_V2 → contracts/`。
