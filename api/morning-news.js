/**
 * /api/morning-news
 * Morgens-Cron: Google News DE + Google Trends DE → Telegram
 * Jede Schlagzeile als eigene Nachricht mit "🎬 Hook generieren"-Button.
 *
 * Vercel-Cron triggert automatisch (siehe vercel.json).
 * Manuell: GET /api/morning-news?secret=$CRON_SECRET
 *          oder /api/morning-news?chat_id=123456789 (Override)
 */

const GOOGLE_NEWS_RSS  = "https://news.google.com/rss?hl=de&gl=DE&ceid=DE:de";
const GOOGLE_TRENDS_RSS = "https://trends.google.com/trending/rss?geo=DE";

const NEWS_LIMIT   = 5;
const TRENDS_LIMIT = 3;

export default async function handler(req, res) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = req.query.chat_id || process.env.TELEGRAM_CHAT_ID;
  const SECRET    = process.env.CRON_SECRET;

  if (!BOT_TOKEN) return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
  if (!CHAT_ID)   return res.status(500).json({ error: "TELEGRAM_CHAT_ID not configured" });

  // Vercel-Cron sendet `x-vercel-cron: 1` — manuelle Calls brauchen ?secret=
  const isCron = req.headers["x-vercel-cron"] === "1";
  if (!isCron && SECRET && req.query.secret !== SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const [news, trends] = await Promise.all([
      fetchRSS(GOOGLE_NEWS_RSS).catch(() => []),
      fetchRSS(GOOGLE_TRENDS_RSS).catch(() => []),
    ]);

    const headlines = [
      ...news.slice(0, NEWS_LIMIT).map(i => ({ ...i, kind: "📰 News" })),
      ...trends.slice(0, TRENDS_LIMIT).map(i => ({ ...i, kind: "🔥 Trending" })),
    ];

    if (headlines.length === 0) {
      await tg(BOT_TOKEN, "sendMessage", {
        chat_id: CHAT_ID,
        text: "⚠️ Keine Schlagzeilen gefunden. Quellen erreichbar?",
      });
      return res.status(200).json({ sent: 0 });
    }

    const today = new Date().toLocaleDateString("de-DE", {
      weekday: "long", day: "2-digit", month: "long",
    });

    await tg(BOT_TOKEN, "sendMessage", {
      chat_id: CHAT_ID,
      text: `☀️ *Morgens-Briefing — ${today}*\n${headlines.length} Schlagzeilen. Tipp auf "Hook generieren" → fertig in 2s.`,
      parse_mode: "Markdown",
    });

    let sent = 0;
    for (const h of headlines) {
      const text =
        `${h.kind}\n*${escapeMd(h.title)}*` +
        (h.source ? `\n_${escapeMd(h.source)}_` : "") +
        (h.link ? `\n${h.link}` : "");

      await tg(BOT_TOKEN, "sendMessage", {
        chat_id: CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: "🎬 Hook generieren", callback_data: "hook" },
            ...(h.link ? [{ text: "🔗 Artikel", url: h.link }] : []),
          ]],
        },
      });
      sent++;
    }

    return res.status(200).json({ sent, news: news.length, trends: trends.length });
  } catch (err) {
    console.error("morning-news failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchRSS(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 MW-NewsBot" } });
  if (!r.ok) throw new Error(`RSS ${url} → ${r.status}`);
  const xml = await r.text();
  return parseRSS(xml);
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block  = m[1];
    const title  = pick(block, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const link   = pick(block, /<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const source = pick(block, /<source\b[^>]*>([\s\S]*?)<\/source>/i)
                || pick(block, /<ht:news_item_source[^>]*>([\s\S]*?)<\/ht:news_item_source>/i);
    if (title) items.push({ title: clean(title), link: clean(link), source: clean(source) });
  }
  return items;
}

function pick(s, re) {
  const m = s.match(re);
  return m ? m[1] : "";
}

function clean(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
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
    throw new Error(`Telegram ${method} ${r.status}: ${txt}`);
  }
  return r.json();
}
