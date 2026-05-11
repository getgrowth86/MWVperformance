/**
 * /api/wg-store
 * WebinarGeek Webhook → Vercel Blob Storage
 * Speichert jede Registrierung dauerhaft
 */

import { put, list, get } from "@vercel/blob";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET" && !req.query.action) {
    return res.status(200).json({ status: "ok", service: "MW WG Store" });
  }

  // ── GET: Daten abrufen ────────────────────────────────────────────────────
  if (req.method === "GET") {
    const action = req.query.action;

    try {
      // Alle Registrierungen der letzten X Tage
      if (action === "registrations") {
        const { blobs } = await list({ prefix: "wg/registrations/" });
        const data = await Promise.all(
          blobs.slice(-500).map(async (b) => {
            const r = await fetch(b.url);
            return r.json();
          })
        );
        // Nach Datum sortieren
        data.sort((a, b) => b.timestamp - a.timestamp);

        // Gruppieren nach Webinar-Datum
        const byDate = {};
        data.forEach((d) => {
          const date = d.broadcast_date || "unknown";
          if (!byDate[date]) byDate[date] = [];
          byDate[date].push(d);
        });

        return res.status(200).json({
          total: data.length,
          by_date: byDate,
          latest: data.slice(0, 10),
        });
      }

      // Statistiken für ein bestimmtes Datum
      if (action === "stats" && req.query.date) {
        const { blobs } = await list({ prefix: `wg/registrations/` });
        const data = await Promise.all(
          blobs.map(async (b) => {
            const r = await fetch(b.url);
            return r.json();
          })
        );
        const filtered = data.filter(
          (d) => d.broadcast_date && d.broadcast_date.startsWith(req.query.date)
        );
        return res.status(200).json({
          date: req.query.date,
          count: filtered.length,
          registrations: filtered,
        });
      }

      return res.status(400).json({ error: "Unknown action" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: Registrierung speichern ─────────────────────────────────────────
  if (req.method !== "POST") return res.status(405).end();

  const payload = req.body;

  // Email extrahieren
  const entity = payload.entity || payload;
  const sub    = entity.subscription || entity;
  const email  = sub.email || payload.email || entity.email || "";

  if (!email) {
    return res.status(200).json({ status: "no_email" });
  }

  const record = {
    timestamp:      Date.now(),
    event:          payload.event || "webinar_subscribed",
    email:          email,
    firstname:      sub.first_name || sub.firstname || "",
    broadcast_date: sub.first_broadcast_date || payload.first_broadcast_date || "",
    webinar_title:  sub.webinar_title || payload.webinar_title || "",
    subscription_id: sub.id || sub.subscription_id || "",
  };

  try {
    const key = `wg/registrations/${record.timestamp}_${record.subscription_id || Math.random().toString(36).slice(2)}.json`;
    await put(key, JSON.stringify(record), {
      access: "public",
      contentType: "application/json",
    });

    console.log(`✅ WG Stored: ${email.substring(0,3)}*** | ${record.broadcast_date}`);
    return res.status(200).json({ status: "success", stored: key });

  } catch (err) {
    console.error("WG Store error:", err);
    return res.status(500).json({ error: err.message });
  }
}
