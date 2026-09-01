/**
 * 把取件碼寄給收件人。
 *
 * 供應商只出現在 sendViaBrevo 一支函式裡 —— 換一家就只改那裡。金鑰沒設定時
 * 回 'unconfigured' 而不是假裝寄出去了：投遞紀錄上那個狀態就是給人看的。
 *
 * 這裡拿得到收件人的完整信箱，所以它絕對不能被寫進 log 或回傳給呼叫端；
 * 對外只交出遮蔽後的形式。
 */

export type NotifyResult = {
  state: 'accepted' | 'failed' | 'unconfigured';
  maskedDestination: string;
  providerMessageId: string | null;
};

/** c***@gmail.com —— 存進 notifications 的就是這個，不是完整地址。 */
export function maskEmail(address: string) {
  const [name, domain] = address.split('@');
  if (!domain) return '***';
  const head = name.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(name.length - 1, 1))}@${domain}`;
}

function pickupEmail(recipientName: string, stopName: string, code: string, link: string, pickupRef: string) {
  const safeName = recipientName || '您好';
  return {
    subject: `取件碼 ${code}｜物品已送達${stopName}`,
    text: [
      `${safeName} 您好，`,
      '',
      `您的物品已由自走車送達「${stopName}」。`,
      '',
      `取件代號：${pickupRef}`,
      `取件碼：${code}`,
      `取件連結：${link}`,
      '',
      '請在取件頁輸入取件碼，取出物品後按下確認。',
      '連結打不開的話，到網站首頁按「我要取件」，輸入上面的取件代號也可以。',
      '取件碼 45 分鐘後失效；連續輸入錯誤 5 次會鎖定。',
      '',
      '如果這不是您預期的信件，請忽略它 —— 沒有取件碼就無法取件。'
    ].join('\n')
  };
}

async function sendViaBrevo(to: string, recipientName: string, subject: string, text: string) {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const from = Deno.env.get('NOTIFY_FROM_EMAIL');
  if (!apiKey || !from) return { state: 'unconfigured' as const, providerMessageId: null };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: from, name: Deno.env.get('NOTIFY_FROM_NAME') ?? 'Go by myself 送件服務' },
      to: [{ email: to, name: recipientName || undefined }],
      subject,
      textContent: text
    })
  });
  if (!response.ok) {
    // 供應商的錯誤內容可能含有收件地址，只留狀態碼。
    console.error(`[notify] brevo rejected the send: HTTP ${response.status}`);
    return { state: 'failed' as const, providerMessageId: null };
  }
  const body = await response.json().catch(() => ({}));
  return { state: 'accepted' as const, providerMessageId: body?.messageId ?? null };
}

export async function sendPickupCode(options: {
  to: string | null;
  recipientName: string;
  stopName: string;
  code: string;
  link: string;
  pickupRef: string;
}): Promise<NotifyResult> {
  // 收件人沒有留信箱、或沒有同意 email 通知，就沒有管道可用。
  if (!options.to) return { state: 'unconfigured', maskedDestination: '(未提供信箱)', providerMessageId: null };
  const masked = maskEmail(options.to);
  const { subject, text } = pickupEmail(options.recipientName, options.stopName, options.code, options.link, options.pickupRef);
  try {
    const sent = await sendViaBrevo(options.to, options.recipientName, subject, text);
    return { ...sent, maskedDestination: masked };
  } catch (error) {
    console.error(`[notify] send threw: ${error instanceof Error ? error.name : 'unknown'}`);
    return { state: 'failed', maskedDestination: masked, providerMessageId: null };
  }
}
