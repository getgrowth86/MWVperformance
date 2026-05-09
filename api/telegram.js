/**
 * /api/telegram
 * Telegram-Bot-Webhook.
 *
 * Behandelt:
 *  - Inline-Button "🎬 Hook generieren" → Claude erzeugt 1-Satz-Hook (DE) in <2s
 *  - Freie Text-Nachricht (Schlagzeile reinpasten) → Hook zurück
 *  - Channel-Posts aus Kanälen, in denen der Bot Admin ist → an dich weitergeleitet mit Hook-Button
 *  - /start, /news, /help
 *
 * Setup einmalig (siehe README):
 *   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://DEINE.vercel.app/api/telegram"
 */

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

const HOOK_SYSTEM = `Du bist ein viraler Short-Form-Content-Creator (TikTok/Reels/Shorts) auf Deutsch.
Aufgabe: Erzeuge GENAU EINEN deutschen Hook (max. 15 Wörter) für ein 30-Sekunden-Video,
basierend auf einer Schlagzeile.

Regeln:
- Muss in den ersten 2 Sekunden Aufmerksamkeit reißen.
- Konkret, nicht generisch. Kein "Wusstest du, dass…".
- Keine Hashtags, keine Emojis, kein Intro, keine Anführungszeichen.
- Nur der Hook. Eine Zeile. Punkt.`;

export default async function handler(req, res) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, bot: !!BOT_TOKEN, claude: !!ANTHROPIC_KEY });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!BOT_TOKEN)     return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const update = req.body || {};

  try {
    if (update.callback_query)  await onCallback(update.callback_query, BOT_TOKEN, ANTHROPIC_KEY);
    else if (update.channel_post) await onChannelPost(update.channel_post, BOT_TOKEN, CHAT_ID);
    else if (update.message)    await onMessage(update.message, BOT_TOKEN, ANTHROPIC_KEY);
  } catch (err) {
    console.error("telegram handler error:", err);
  }

  // Telegram erwartet schnelles 200 — sonst Re-Delivery
  return res.status(200).json({ ok: true });
}

async function onCallback(cb, token, anthropicKey) {
  const data    = cb.data || "";
  const chatId  = cb.message?.chat?.id;
  const msgId   = cb.message?.message_id;
  const msgText = cb.message?.text || "";

  await tg(token, "answerCallbackQuery", {
    callback_query_id: cb.id,
    text: "Generiere Hook…",
  });

  if (!data.startsWith("hook")) return;

  const headline = extractHeadline(msgText);
  if (!headline) {
    await tg(token, "sendMessage", { chat_id: chatId, text: "⚠️ Keine Schlagzeile in der Nachricht gefunden." });
    return;
  }

  const hook = await generateHook(headline, anthropicKey);

  await tg(token, "sendMessage", {
    chat_id: chatId,
    reply_to_message_id: msgId,
    text: `🎯 *Hook*\n${escapeMd(hook)}\n\n_Jetzt filmen & posten._`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[
        { text: "🔄 Neuer Hook", callback_data: "hook" },
      ]],
    },
  });
}

async function onMessage(msg, token, anthropicKey) {
  const chatId = msg.chat.id;
  const text   = (msg.text || "").trim();
  if (!text) return;

  if (text.startsWith("/start")) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      text:
        "👋 Moin! Ich bin dein Morgen-News-Bot.\n\n" +
        "• Jeden Morgen 7 Uhr: Top-Schlagzeilen + 1-Klick-Hook.\n" +
        "• Schick mir jede Schlagzeile als Text → Hook in 2s.\n" +
        "• /news = Briefing manuell auslösen.\n\n" +
        `Deine Chat-ID: \`${chatId}\` — als TELEGRAM_CHAT_ID in Vercel eintragen.`,
      parse_mode: "Markdown",
    });
    return;
  }

  if (text.startsWith("/help")) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      text: "/start — Welcome\n/news — Morgen-Briefing jetzt\n(beliebiger Text) — Hook generieren",
    });
    return;
  }

  if (text.startsWith("/news")) {
    const host = `https://${process.env.VERCEL_URL || "localhost"}`;
    const secret = process.env.CRON_SECRET ? `?secret=${process.env.CRON_SECRET}` : "";
    fetch(`${host}/api/morning-news${secret}`).catch(() => {});
    await tg(token, "sendMessage", { chat_id: chatId, text: "⏳ Briefing wird abgerufen…" });
    return;
  }

  // Freier Text → als Schlagzeile interpretieren, Hook zurück
  const hook = await generateHook(text, anthropicKey);
  await tg(token, "sendMessage", {
    chat_id: chatId,
    reply_to_message_id: msg.message_id,
    text: `🎯 *Hook*\n${escapeMd(hook)}`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🔄 Neuer Hook", callback_data: "hook" }]],
    },
  });
}

async function onChannelPost(post, token, chatId) {
  if (!chatId) return;
  const text = (post.text || post.caption || "").trim();
  if (!text) return;

  const channel = post.chat?.title || "Channel";
  const headline = text.split("\n")[0].slice(0, 300);

  await tg(token, "sendMessage", {
    chat_id: chatId,
    text: `📡 *${escapeMd(channel)}*\n*${escapeMd(headline)}*`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🎬 Hook generieren", callback_data: "hook" }]],
    },
  });
}

/* -------- Hook-Generator -------- */

async function generateHook(headline, anthropicKey) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 80,
      system: HOOK_SYSTEM,
      messages: [{ role: "user", content: `Schlagzeile: ${headline}` }],
    }),
  });

  const data = await r.json();
  if (!r.ok) {
    console.error("Anthropic error:", data);
    return "⚠️ Hook-Generierung fehlgeschlagen.";
  }
  const out = (data.content?.[0]?.text || "").trim().split("\n")[0].replace(/^["„»]|["“«]$/g, "").trim();
  return out || "⚠️ Leerer Hook.";
}

/* -------- Helpers -------- */

function extractHeadline(msgText) {
  // Format aus morning-news.js: Zeile1=Kind, Zeile2=*Headline*, Zeile3=_Source_, Zeile4=URL
  // Fallback: längste Zeile.
  const lines = msgText.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^\*(.+)\*$/);
    if (m) return m[1].trim();
  }
  return lines.sort((a, b) => b.length - a.length)[0] || "";
}

function escapeMd(s) {
  return (s || "").replace(/([_*`\[\]])/g, "\\$1");
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error(`Telegram ${method} ${r.status}: ${txt}`);
  }
  return r.json().catch(() => ({}));
}
