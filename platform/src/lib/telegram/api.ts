import "server-only";

/**
 * The Telegram Bot API, reduced to the four calls this lane makes.
 *
 * Everything Jarvis sends a founder goes through here, which is why the
 * transport is an interface: the tests drive the whole lane without a
 * network, and a delivery failure can never undo Office work — sending is
 * best-effort by design, exactly as the voice notifier is.
 */

export type TelegramButton = { text: string; callbackData: string };

export type TelegramSend = {
  chatId: string;
  text: string;
  /** Rendered as one row per inner array. */
  buttons?: TelegramButton[][];
  /** Suppresses the link card for preview URLs, which otherwise dominate the message. */
  disablePreview?: boolean;
};

export interface TelegramTransport {
  sendMessage(input: TelegramSend): Promise<void>;
  /** Telegram shows a spinner on a tapped button until this is answered. */
  answerCallback(input: { callbackId: string; text?: string }): Promise<void>;
}

const API = "https://api.telegram.org";

class BotApiTransport implements TelegramTransport {
  constructor(private readonly botToken: string) {}

  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${API}/bot${this.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // The token is in the URL, so the URL never reaches a log line.
      throw new Error(`Telegram ${method} failed (${response.status})`);
    }
  }

  async sendMessage(input: TelegramSend): Promise<void> {
    await this.call("sendMessage", {
      chat_id: input.chatId,
      text: input.text,
      parse_mode: "HTML",
      link_preview_options: input.disablePreview ? { is_disabled: true } : undefined,
      reply_markup: input.buttons
        ? { inline_keyboard: input.buttons.map((row) => row.map((button) => ({ text: button.text, callback_data: button.callbackData }))) }
        : undefined,
    });
  }

  async answerCallback(input: { callbackId: string; text?: string }): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: input.callbackId, text: input.text });
  }
}

export function createTelegramTransport(botToken: string): TelegramTransport {
  return new BotApiTransport(botToken);
}

/**
 * Telegram renders a small subset of HTML and rejects a message containing
 * a stray `<`. Everything interpolated into a message is escaped here, so
 * a restaurant called "Smith & Sons <Kitchen>" cannot break delivery.
 */
export function escapeTelegram(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram rejects anything over 4096 characters outright. */
export function clampMessage(value: string): string {
  return value.length <= 3900 ? value : `${value.slice(0, 3900)}\n…`;
}
