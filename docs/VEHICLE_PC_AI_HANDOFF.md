# 車端電腦 AI 技術交接

更新日期：2026-08-31

適用對象：可直接接觸自走車、Jetson／工控機、Aurora S 或 ROS1 環境的下一位工程師或 AI agent。

Repository：<https://github.com/ericchen2023/go-by-myself-website>

穩定交接分支：`main`（protected branch；只接收通過 required checks 的 PR）

Robot contract v2 整合歷程：<https://github.com/ericchen2023/go-by-myself-website/pull/1>

> **Hosted staging 已可接車端 dry-run，但還不能讓真車移動。** 網站端 contract v2、hosted database、Edge robot API、Vercel staging、scoped GBM-01 identity、Node simulator 與 Python dry-run harness 已完成；Aurora／ROS 硬體 adapter、A–D 實體站點 mapping、client TLS 與現場安全程序仍須在車端電腦完成。未通過本文的 Physical GO gate 前，不得把 `capabilityEnabled` 或 `route_validation_enabled` 打開。

## 1. 接手時先掌握的結論

| 項目 | 現況 | 下一個 owner |
|---|---|---|
| Web、四站動態 SVG、公開 safe projection | 已實作並測試 | 網站 repo |
| Robot contract v2、fixtures、版本與 checksum gate | 已實作並測試 | 網站 repo 是 source of truth |
| Route job／leg、reservation、ACK 與 telemetry ingest | 14 個 migrations、65 個 hosted pgTAP 與 v2 telemetry smoke 已通過 | 網站／Supabase staging owner |
| Edge robot API | Hosted ACTIVE；wrong token 401、correct scope 200、wrong vehicle 403、bad schema 422 已實測 | 網站／Supabase staging owner |
| Node gateway simulator | 可送 v2 telemetry、可並行 CANCEL | 網站 repo |
| Jetson Python agent | 只有 outbound command poller、durable ledger、dry-run adapter | 車端 repo／車端電腦 |
| 真實 telemetry、SLAM map switch、taught-route replay | **尚未實作** | 車端 repo／robot team |
| Robot TLS | HTTPS 會使用作業系統 CA 驗證 server；client certificate／mTLS 尚未接入 agent | 車端 repo＋staging owner |
| A／B／C／D 對四個公開站點 | **未核准，全部為 null** | robot team＋校方／專題 owner |
| 真車移動、e-stop、disconnect、incident procedure | **未驗證** | 現場 safety owner |
| 置物艙、門鎖、item sensor、custody | **不存在或未接入** | 後續 physical-delivery phase |

本次網站端發布基線已通過 43 Vitest、25 Playwright/axe（另1個跨project skip）、5 Python unittest、5 Deno runtime tests與65個hosted pgTAP。Hosted HTTP另驗證robot identity/scope、telemetry、schema、pickup CORS與sender JWT gate。這些證據證明hosted control plane與dry-run contract，不證明Realtime完整流程或真車安全。

真車第一階段只做 **supervised route validation**：單車、單段、空載、受控區域、現場人員持有實體 e-stop。這個流程不建立收件人、不發通知，也不會產生 `completed` delivery。

## 2. 不可跨越的安全邊界

下一位 AI 必須遵守以下規則：

1. 不把 Python `dry-run` 改名後宣稱為 Aurora／ROS adapter。
2. 不在不知道 ROS topic、frame、單位、方向、map switch 或 safe-stop 語意時猜實作。
3. 不把一般網站的 CANCEL 當成 emergency stop；真車移動時必須有實體 e-stop 與現場 owner。
4. 不在車端保存 `SUPABASE_SECRET_KEY`；車端只持有單車 scoped token 與未來核准的 TLS material。
5. 不把 token、private key、精準座標、姓名、電話或取件 credential 貼到 GitHub、聊天、截圖或 log。
6. `accepted` 只表示 agent 接受命令；只有硬體完成並取得可信 evidence 才能回 `completed`。
7. route checksum、vehicle scope、command expiry、boot／sequence 或 allowed segment 任一不符都 fail closed。
8. 在置物艙與 custody evidence 完成前，不載物、不執行完整實體投遞。

## 3. Tutorial：在車端電腦建立可驗證的基線

這一節只驗證 repository 與 contract，不會控制真車。

### 3.1 Clone protected `main` 並記錄 contract commit

```bash
git clone --branch main --single-branch https://github.com/ericchen2023/go-by-myself-website.git
cd go-by-myself-website
git pull --ff-only origin main
git rev-parse HEAD
```

確認 `git status --short --branch` 沒有本機變更，並在 GitHub 的 `main` 最新 commit 看見 `quality`、`browser`、`database`、`edge-contract` 全綠。把 `git rev-parse HEAD` 的完整 SHA 記到車端 repo 的依賴文件；不要只寫 branch 名稱，避免 contract 日後悄悄改變。

### 3.2 確認工具版本

```bash
node --version
npm --version
python3 --version
git --version
```

基準為 Node.js 24 LTS、npm 10+、Python 3.10+。專案允許 Node 22–24，但 CI 使用 Node 24。

### 3.3 安裝並跑不需 secret 的測試

```bash
npm ci
npm run doctor
npm run check
```

`npm run test:python-agent` 會在 Linux 優先使用 `python3`、Windows 優先使用 `python`；需要覆寫時可將 `PYTHON` 指向核准的 executable。也可單獨重跑：

```bash
npm run contract:fixtures
npm run test:python-agent
npm run docs:check
```

預期重點：

- `doctor` 的 Node、npm、Python、git、lockfile 與 command schema 都是 `✓`。
- fixtures 顯示 command、telemetry、fault envelopes 已載入，並驗證 `ndhu-four-stop-route-v4`。
- Python 顯示 5 tests、結果 `OK`。
- 文件檢查確認所有本機連結可解析，且交接文件的 route version、checksum 與四個公開站點仍和 canonical graph 一致。

如果上述任一指令失敗，先修環境或 repository checkout；不要進入車控整合。

### 3.4 確認目前確實 fail closed

```bash
python3 gateway/python_agent/agent.py
```

在未設定 identity 時，程式應以 `Robot identity/control plane environment is incomplete.` 結束。將 `PYTHON_AGENT_ADAPTER` 設成非 `dry-run` 時，應以 `Aurora/ROS adapter is not implemented` 結束。這兩個失敗都是目前正確的安全行為。

## 4. How-to：先完成車端唯讀盤點

不要一開始就改控制程式。先在車輛靜止、輪子架空或依 robot team 指定的安全狀態下蒐集資料，完成 [Robot integration questionnaire](ROBOT_QUESTIONNAIRE.md)。

### 4.1 系統與 ROS 基線

Linux／Jetson 可先執行：

```bash
uname -a
cat /etc/os-release
uname -m
python3 --version
node --version
rosversion -d
rosversion ros
printenv ROS_MASTER_URI
rosnode list
rostopic list
```

如果不是 ROS1，記錄實際 middleware 與版本，不要安裝或假設 ROS1。輸出分享前先遮蔽 IP、使用者名稱、hostname、token、certificate path 與校園網路資訊。

### 4.2 找出 controller contract

針對候選 topic／service，只做讀取與型別檢查：

```bash
rostopic info /candidate_topic
rostopic type /candidate_topic
rosmsg show PACKAGE/MessageType
rosservice list
rosservice info /candidate_service
```

只有 robot owner 同意且車輛保持安全時，才擷取單筆非敏感 sample：

```bash
rostopic echo -n 1 /candidate_pose_topic
```

必須取得並文件化：

- localization pose 的 topic、message type、frequency、frame ID、x/y 單位與 heading convention；
- `map`／`odom`／`base_link` 關係，以及 Aurora S 使用的實際 frame；
- taught-route／`.stcm` 的啟動、取消、安全停止、完成與失敗介面；
- map switch／relocalization 的開始、成功、timeout 與失敗訊號；
- battery voltage、low-battery policy、障礙與 fault states；
- controller reboot、斷線與 command replay 時的行為；
- 實體 e-stop 的 owner、觸發方式與復原步驟。

### 4.3 盤點完成的輸出

在車端 repo 建立一份不含秘密的 evidence 文件，至少包含：

```text
Vehicle / controller model:
OS / architecture:
ROS or middleware / version:
Pose topic + type + rate:
Frames / units / heading:
Route file inventory + SHA-256:
Route start / cancel / completion interface:
Disconnect behavior:
Safe-stop behavior:
Physical e-stop owner:
On-site operator / incident contact:
Network egress constraints:
Known gaps:
```

`.stcm` 可記錄檔名、方向與 SHA-256，但不要把校園精準座標或未公開的 map 放進 public repository。

## 5. How-to：建立 production-shaped staging 連線

獨立 hosted staging 已建立。網站端與車端只透過下列公開 contract URL 連線；任何 token、pepper 或 Supabase secret key 都不記錄在 Git、本文或聊天。

```text
Frontend: https://go-by-myself-website-git-staging-hsuanisgay.vercel.app
Supabase project ref: aiuajbflpwdzkaeeocab
Robot control plane: https://aiuajbflpwdzkaeeocab.supabase.co/functions/v1/robot-api
Staging vehicle code: GBM-01
Staging vehicle UUID: 52a9b769-0e51-4c9c-9490-1c0b4ca0f7d2
```

目前Edge的GBM-01 token只用於網站端hosted smoke，**沒有被保存到交接文件**。車端正式接手時由staging owner產生並同步替換一個新token，再用面交、受控password manager或等價安全管道提供給車端；不要要求AI從log、GitHub或browser bundle找回舊值。

### 5.1 Owner 在 Supabase／資料庫端完成

1. 已建立 `go-by-myself-staging`，並從空資料庫套用全部 `supabase/migrations/`。
2. 已部署 `robot-api`；[`supabase/config.toml`](../supabase/config.toml) 的 `verify_jwt=false` 保持不變，函式內自行驗證scoped token。
3. 已建立 active staging vehicle `GBM-01`；`routeValidationEnabled=false`，未核准前不可切換。
4. 車端接手當下產生新的高熵、每車獨立 token，同步更新Edge secret並以安全管道交給車端owner。
5. Edge secrets 依 `clientId=gbm-01` 命名；Supabase API keys由hosted Edge自動注入：

```text
ROBOT_GBM_01_TOKEN
ROBOT_GBM_01_VEHICLE_ID
SUPABASE_SECRET_KEYS (auto-injected; JSON key dictionary)
```

Secret key只留在Edge，不能交給車端。Staging另外設定`APP_ORIGIN`為正式的staging frontend origin；不得使用demo hostname。

### 5.2 車端只設定 scoped values

`CONTROL_PLANE_URL` 使用已建立的 robot function base：

```text
https://aiuajbflpwdzkaeeocab.supabase.co/functions/v1/robot-api
```

車端所需變數：

```text
CONTROL_PLANE_URL
ROBOT_VEHICLE_ID=52a9b769-0e51-4c9c-9490-1c0b4ca0f7d2
ROBOT_CLIENT_ID=gbm-01
ROBOT_CLIENT_TOKEN
SUPPORTED_CONTRACT_VERSION=2
GATEWAY_DEPLOY_ENV=staging
PYTHON_AGENT_ADAPTER=dry-run
PYTHON_AGENT_LEDGER=/var/lib/go-by-myself/python-agent-ledger.json
```

不要把真值寫進 `.env.example` 或 commit。正式常駐時使用權限受限的 service manager secret／environment file；token 檔僅 service account 可讀。credential rotation 與 revoke 演練完成前，不進真車測試。

目前 Node config 雖保留 `ROBOT_CERT_PATH`／`ROBOT_PRIVATE_KEY_PATH` 欄位，但 Node client與 Python agent 都尚未把 client certificate 加入 HTTP transport。現在只有一般 HTTPS server certificate validation；完成 mTLS／client certificate transport與rotation測試前，不得宣稱雙向 TLS 已就緒。

### 5.3 先以 Python dry-run 驗證 outbound contract

在已安全載入上述環境後：

```bash
python3 gateway/python_agent/agent.py
```

通過條件：

- 錯 token 回 `ROBOT_IDENTITY_INVALID`，不是模糊的 Supabase gateway 401。
- 正確 token 只能取得同一 `ROBOT_VEHICLE_ID` 的 command。
- duplicate `commandId` 不重做；final event 可在網路恢復後重送。
- 長時間 DISPATCH dry-run 時仍可收到 CANCEL。
- accepted 與 completed 分成兩筆 event。
- ledger 在 process restart 後仍存在，且不含 token 或 PII。

Python harness 目前**不會送 telemetry，也沒有 health server**。Hosted telemetry、stale/offline 與 SVG marker 的 staging 測試應先使用 Node simulator：

```bash
npm run gateway
```

Node gateway readiness：

```text
GET http://127.0.0.1:8788/health/live
GET http://127.0.0.1:8788/health/ready
```

未設定 control plane 時，`live` 應回 200，`ready` 應回 503／degraded。

## 6. How-to：實作真實 Aurora／ROS adapter

建議在獨立的 private robot repo 實作，並 pin 本 repo 的 contract commit；不要把 Aurora 專用依賴塞進公開網站 bundle。

### 6.1 現有 Python agent 可重用的部分

- [`agent.py`](../gateway/python_agent/agent.py)：outbound poll、背景 command execution、CANCEL 並行、durable command ledger。
- [`contract.py`](../gateway/python_agent/contract.py)：version、expiry、vehicle、route checksum、physical mapping gate。
- [`fixtures.json`](../contracts/fixtures.json)：正向 command／telemetry／fault samples。
- [`invalid-fixtures.json`](../contracts/invalid-fixtures.json)：必須 fail closed 的負向 samples。

### 6.2 Hardware adapter 最小介面

實機 adapter 至少要提供 thread-safe 的：

```python
class HardwareAdapter:
    def execute(self, command: dict) -> dict:
        """Return state=completed|failed|rejected plus allow-listed evidence."""

    def telemetry(self) -> dict:
        """Return the current physical state needed to build telemetry v2."""

    def health(self) -> dict:
        """Report controller/localization readiness without secrets or precise public pose."""
```

必要語意：

- `DISPATCH`：驗證目前狀態後啟動單一 taught-route leg；等待 controller 的真正完成訊號才回 `completed`。
- `CANCEL`：不依賴 racing vehicle-state precondition；可與 DISPATCH 並行，執行 idempotent safe-stop policy。
- `RETURN_TO_BASE`：沒有經 robot team 證明前保持 unsupported／rejected。
- `OPEN_COMPARTMENT`：目前沒有實體能力，必須 rejected；不得回 synthetic completed。
- process crash／restart：不能把「曾 accepted、結果未知」猜成 completed，必須進 operator reconciliation。

### 6.3 補齊 Python telemetry sender

Python agent 尚缺這一段。實作時以 [`telemetry.schema.json`](../contracts/telemetry.schema.json) 為唯一格式，並加入：

- 每次 process boot 產生並固定一個 UUID `bootId`；
- 同一 boot 的 `sequence` 嚴格單調增加；
- `receivedAt` 不由車端送，server 產生；
- voltage 可送，未校正前 `percent` 必須是 `null`；
- map matching 在車端／gateway 完成，網站只收 `segmentId + progress`；
- `degraded` 可保留 last-known marker，`invalid`／`off_route` 不更新公開 marker；
- 只允許目前 leg 的 `segmentId`，version／checksum 固定為本文 Reference 值；
- 網路中斷可緩衝，但退休 boot 或倒退 sequence 不得倒寫 current state。

### 6.4 實機 adapter 的必測案例

1. unknown schema major version；
2. wrong vehicle、checksum、leg 或 segment；
3. expired command 與 duplicate command；
4. accepted ACK 遺失、completed ACK 遺失與 restart replay；
5. 3–8 分鐘 DISPATCH 中收到 CANCEL；
6. controller disconnect、localization timeout、off-route、obstacle 與 fault；
7. boot ID 更新、sequence 倒退與舊 boot replay；
8. voltage-only battery 不虛構百分比；
9. safe-stop 失敗會回 failed/fault，而不是 cancelled success。

## 7. How-to：核准 A–D 與四站 mapping

目前 [`physical-route-manifest.v1.json`](../contracts/physical-route-manifest.v1.json) 的安全狀態是：

```text
capabilityEnabled = false
mappingStatus = unapproved
A / B / C / D = null
所有 physical leg allowedSegmentIds = []
```

正式 mapping 必須由 robot team、網站 graph owner 與現場 owner共同簽核。至少保存：

- A、B、C、D 各自對應的 `LIBRARY | ADMIN | HSS1 | HSS2`；
- 八個方向 `A_B`、`B_A`、`B_C`、`C_B`、`C_D`、`D_C`、`A_D`、`D_A` 的 route file checksum；
- 每段允許的 schematic edge sequence；
- physical frame → schematic `segmentId/progress` 的 calibration 方法與誤差證據；
- map switch／relocalization 的停車、timeout 與恢復規則。

不要直接在 staging DB 手動翻 flag。以 code review 更新 manifest／migration／tests，確認 `npm run contract:fixtures` 與 database CI 全綠，再由 owner 在 staging 個別啟用車輛。

## 8. Supervised physical route validation

### 8.1 Physical GO checklist

全部打勾才允許第一段移動：

- [ ] [30 題 robot questionnaire](ROBOT_QUESTIONNAIRE.md) 已回答並由 robot owner 確認。
- [ ] Aurora／ROS adapter 通過相同 v2 fixtures 與故障測試。
- [ ] A–D mapping、route checksum、方向與 allowed segments 已簽核。
- [ ] staging vehicle、per-client token、TLS／rotation／revoke 已驗證。
- [ ] 現場 operator、robot owner、incident contact 已具名。
- [ ] 實體 e-stop 已測試，並在現場人員手上。
- [ ] 測試區域受控、車輛空載、無一般路人進入路線。
- [ ] safe-stop、disconnect、off-route 與 controller fault procedure 可執行。
- [ ] operator workspace 能看到 connectivity、state、leg、progress 與 last update。
- [ ] capability kill switch 可立即關閉，且不影響 demo。

### 8.2 執行順序

1. 車不動：錯 token、錯 vehicle、expired、duplicate、checksum mismatch。
2. 輪子架空或 robot team 認可的靜態狀態：accepted/completed、telemetry、CANCEL。
3. 受控場地：一台車、單一 leg、空載、步行人員隨車、e-stop 在手。
4. 故障演練：network disconnect、late ACK、process restart、off-route、safe-stop。
5. 單段證據通過後，才逐一測八個已示教方向。
6. 本階段結束時 route job 可 completed；**delivery 不得 completed**。

任一實測結果與 manifest／checksum／frame 不一致，立即關閉 capability，保留已遮蔽的 evidence，回到 calibration 與 root-cause review。

## 9. Reference：Robot contract v2

### 9.1 固定版本

```text
schemaVersion: 2
routeGraphVersion: ndhu-four-stop-route-v4
routeGraphChecksum: sha256:712c4b12e3932647eb0856699fe4ace4bd9a2434c325b97451e07abbd7120ef9
visible stops: LIBRARY, ADMIN, HSS1, HSS2
```

Canonical source 是 [`route-graph.v4.json`](../contracts/route-graph.v4.json)。不要在 robot repo 手寫另一份站點或 checksum。

### 9.2 Endpoints

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/api/v1/robot/commands?vehicleId=&after=` | 取得 scoped、v2、queued／accepted commands |
| `POST` | `/api/v1/robot/commands/{id}/events` | 回 accepted／rejected／completed／failed |
| `POST` | `/api/v1/robot/telemetry` | 寫入 v2 telemetry 與 safe projection |
| `POST` | `/api/v1/robot/faults` | 寫入 allow-listed fault evidence |
| `GET` | `/api/v1/robot/vehicles/{id}/state` | 取得本車 current state |

所有 request 帶：

```text
x-robot-client-id: gbm-01
authorization: Bearer <scoped-token>
```

### 9.3 Vehicle 與 quality states

```text
vehicleState = idle | preparing | localizing | moving | at_stop |
               safe_stopped | returning_to_base | fault

quality = valid | degraded | invalid | off_route
connectivity = online | stale | offline
```

Staging default：最後可信 telemetry 超過 10 秒為 stale，超過 60 秒為 offline。這些值需在 physical test 後依實測調整。

### 9.4 常見回應

| HTTP／code | 意義 | 正確處理 |
|---|---|---|
| `401 ROBOT_IDENTITY_INVALID` | client ID、token 或 Edge vehicle mapping 錯 | 停止重試風暴，找 provisioning owner |
| `403 ROBOT_SCOPE_DENIED` | request target 不屬於本車 | fail closed、查 assignment |
| `409 ROUTE_VERSION_MISMATCH` | graph version／checksum 不一致 | pin 正確 commit，不自行改 checksum |
| `409 ROUTE_SEGMENT_NOT_ALLOWED` | segment 不屬於目前 leg | 停止公開 marker、校正 mapping |
| `409 TELEMETRY_OUT_OF_ORDER` | sequence 倒退或 retired boot replay | 不重設 current state；查 reboot／buffer |
| `409 ROBOT_STATE_INVALID` | command precondition 不符 | 回 authoritative state，等 operator 判斷 |
| `409 COMMAND_EXPIRED` | command 已超過開始期限 | 未 accepted 才可由 server 安全重派 |
| `422 CONTRACT_SCHEMA_INVALID` | envelope 不符合 JSON Schema | 先修 adapter，不做寬鬆解析 |
| `429 RATE_LIMITED` | 送太快 | exponential backoff；telemetry 上限目前 180/min |
| `503 ENV_CONFIG_INVALID` | Edge server secrets 未配置 | 找 staging owner；不要把 server secret 複製到車端 |

## 10. Reference：關鍵檔案

| 檔案 | 權責 |
|---|---|
| [`contracts/route-graph.v4.json`](../contracts/route-graph.v4.json) | 四站 schematic graph 與權威 checksum |
| [`contracts/physical-route-manifest.v1.json`](../contracts/physical-route-manifest.v1.json) | A–D、physical leg 與 capability gate |
| [`contracts/delivery-command.schema.json`](../contracts/delivery-command.schema.json) | command v2 |
| [`contracts/telemetry.schema.json`](../contracts/telemetry.schema.json) | telemetry v2 |
| [`contracts/command-event.schema.json`](../contracts/command-event.schema.json) | ACK／final event v2 |
| [`contracts/robot-fault.schema.json`](../contracts/robot-fault.schema.json) | fault v2 |
| [`gateway/python_agent/agent.py`](../gateway/python_agent/agent.py) | Jetson outbound agent skeleton |
| [`gateway/python_agent/contract.py`](../gateway/python_agent/contract.py) | Python fail-closed semantic checks |
| [`gateway/src/simulator-hardware.js`](../gateway/src/simulator-hardware.js) | production-shaped simulator reference |
| [`supabase/functions/robot-api/index.ts`](../supabase/functions/robot-api/index.ts) | robot HTTP boundary |
| [`ROBOT_INTEGRATION_V2.md`](ROBOT_INTEGRATION_V2.md) | 整合與 provisioning runbook |
| [`RUNBOOKS.md`](RUNBOOKS.md) | offline、off-route、ACK、custody procedures |
| [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) | 已完成與 NO-GO 項目 |

## 11. 下一位 AI 的交付清單

下一位 AI 不應直接宣稱「接車完成」。它的第一輪交付應是：

1. 車端系統／ROS／controller inventory，敏感資料已遮蔽。
2. 完整回答 `ROBOT_QUESTIONNAIRE.md`，未知項明確標 `UNKNOWN`。
3. 車端 repo pin 的網站 contract commit SHA。
4. Aurora／ROS adapter 設計與實際 controller interface evidence。
5. Python telemetry sender、health/readiness、boot／sequence persistence 的測試。
6. 正反 fixtures、duplicate、late ACK、restart、CANCEL、disconnect、off-route 測試結果。
7. A–D mapping、八方向 route checksum 與 allowed edge proposal；未簽核前 capability 保持 off。
8. scoped credential／TLS／rotation／revoke runbook，不含 secret 本文值。
9. 第一段 supervised no-cargo test plan、具名 owner 與 rollback／kill-switch。
10. 真車測試後的 redacted evidence 與 GO／NO-GO 結論。

## 12. 可直接交給另一台電腦 AI 的起始提示

```text
你正在車輛可連線的電腦上接手 go-by-myself robot integration。

先完整閱讀 docs/VEHICLE_PC_AI_HANDOFF.md、docs/ROBOT_QUESTIONNAIRE.md、
docs/ROBOT_INTEGRATION_V2.md、docs/RUNBOOKS.md，以及 contracts/ 下的 v2 schemas。
只從 protected main 接手。網站 repo 是 contract source of truth；先執行 git pull --ff-only
origin main，確認 required checks 全綠，記錄 git rev-parse HEAD 並在車端 repo pin SHA。

Hosted staging 已建立：
- frontend: https://go-by-myself-website-git-staging-hsuanisgay.vercel.app
- control plane: https://aiuajbflpwdzkaeeocab.supabase.co/functions/v1/robot-api
- vehicle UUID: 52a9b769-0e51-4c9c-9490-1c0b4ca0f7d2
- client ID: gbm-01
ROBOT_CLIENT_TOKEN 必須由 staging owner 在接手時輪替並透過安全管道提供；不要要求把token貼到聊天、文件或Git。

第一輪只做唯讀環境盤點、contract tests 與 dry-run。不要控制真車、不要啟用
physical capability、不要猜 ROS topic/frame/單位，不要把 Web CANCEL 當 e-stop。
不要在 source、聊天或 log 顯示 token、private key、精準地圖或個資。

依交接文件輸出：
1) 已確認的 OS/CPU/ROS/controller/route/pose/safe-stop facts；
2) 30 題 questionnaire，未知項標 UNKNOWN；
3) 可重現的測試結果；
4) Aurora/ROS hardware adapter 與 telemetry sender 的實作計畫；
5) 仍阻擋 supervised no-cargo route validation 的 GO/NO-GO 清單。

只有 robot owner 核准介面、A–D mapping/checksum、scoped identity/TLS、現場 operator
與實體 e-stop 全部就緒後，才提出單車、單段、空載的 supervised test。置物艙與
custody 未完成前，不載物、不產生 completed delivery。
```

## 13. 為什麼採這個邊界

公開網站顯示的是四個中文站點與 `segmentId + progress`，不是 raw SLAM x/y。這可避免 schematic map 與實體座標混用，也不公開精準車位。Robot gateway 是唯一把 controller physical facts 轉成 contract event 的 trust boundary；Database transaction 再決定 route job 或 delivery 是否能推進。如此即使 Realtime、ACK 或網路暫時中斷，也不會因為 UI 動畫或一次 HTTP success 就虛構車已抵達、艙門已開或投遞已完成。
