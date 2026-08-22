# Security policy

本 repository 目前是學生專題 software/demo，尚未獲准處理真實校園 PII 或控制移動中的車輛。請勿在 public issue 貼上姓名、電話、email、OAuth token、pickup code/QR、authorization header、robot certificate/private key 或 precise telemetry。

## Reporting

正式 staging 前需指定私人 security contact 與 incident channel。尚未指定時，請直接聯絡 project owner/advisor，不要公開可利用細節。

## Baseline

- Web/PII：OWASP ASVS 5 Level 2＋STRIDE。
- Database：deny-by-default RLS、event-intent RPC、optimistic version、idempotency、append-only evidence。
- Robot：scoped identity、TLS、assignment/expiry/state checks、persistent command dedup。
- Credential：40-bit human code、256-bit QR、HMAC digest、expiry、attempt/rate limits、single-use。
- Physical safety：獨立 hazard review；一般 Web cancel 不取代 emergency stop。

Production secrets不得進 browser、demo process、source control、logs或 robot image。發現 secret後應立即 revoke/rotate，保存最小 incident evidence並執行 history scan。
