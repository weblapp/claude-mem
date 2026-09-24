const MARKDOWN_V2_RESERVED = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

// weblapp delta (DELTA.md): nothing leaves this machine.
const WEBLAPP_TELEGRAM_DISABLED = true;

export function escapeMarkdownV2(value: string): string {
  return value.replace(MARKDOWN_V2_RESERVED, '\\$&');
}

export async function postTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  // weblapp delta: Telegram is HARD OFF in this fork — see DELTA.md. Upstream
  // ships CLAUDE_MEM_TELEGRAM_ENABLED='true' and stays silent only while the bot
  // token and chat id are empty, so one settings edit would start posting
  // observation text to api.telegram.org. Both notifiers send through here.
  if (WEBLAPP_TELEGRAM_DISABLED) return;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'MarkdownV2',
    }),
  });
  if (!response.ok) {
    const status = response.status;
    const statusText = response.statusText;
    throw new Error(`Telegram API responded ${status} ${statusText}`);
  }
}
