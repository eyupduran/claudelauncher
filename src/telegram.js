'use strict';
// Ek paket gerektirmeyen küçük Telegram Bot API istemcisi (Node 18+ fetch).

class Telegram {
  constructor(token) {
    this.base = `https://api.telegram.org/bot${token}/`;
  }

  async call(method, params = {}, timeoutMs = 30000) {
    const res = await fetch(this.base + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!data.ok) {
      const err = new Error(`${method}: ${data.description || 'bilinmeyen hata'}`);
      err.code = data.error_code;
      throw err;
    }
    return data.result;
  }

  getUpdates(offset) {
    return this.call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65000);
  }

  send(chatId, text, keyboard) {
    return this.call('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  /** Mesajla birlikte ekranın altında sürekli duran menü butonlarını gönderir. */
  sendWithMenu(chatId, text, menuRows) {
    return this.call('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: {
        keyboard: menuRows.map((row) => row.map((t) => ({ text: t }))),
        resize_keyboard: true,
        is_persistent: true,
      },
    });
  }

  async edit(chatId, messageId, text, keyboard) {
    try {
      return await this.call('editMessageText', {
        chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: keyboard || [] },
      });
    } catch (e) {
      if (/message is not modified/.test(e.message)) return null;
      throw e;
    }
  }

  answer(callbackId, text) {
    return this.call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) }).catch(() => {});
  }

  async sendPhoto(chatId, buffer, caption) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('photo', new Blob([buffer], { type: 'image/png' }), 'ekran.png');
    const res = await fetch(this.base + 'sendPhoto', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
    const data = await res.json();
    if (!data.ok) throw new Error(`sendPhoto: ${data.description}`);
    return data.result;
  }
}

module.exports = { Telegram };
