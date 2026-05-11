/**
 * /api/tc-store
 * ThriveCart Webhook → Vercel Blob Storage
 * Speichert jeden Kauf dauerhaft (nur charge, keine rebill)
 */

import { put, list } from "@vercel/blob";
import crypto from "crypto";

const PIXEL_ID     = process.env.META_PIXEL_ID   || "468972542963546";
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
const TC_SECRET    = process.env.TC_WEBHOOK_SECRET;

function hash(v) {
  if (!v) return null;
  return crypto.createHash("sha256").update(v.toString().toLowerCase().trim()).digest("hex");
}

async function sendCapiPurchase(email, value, currency, fbc, fbp, eventId) {
  if (!ACCESS_TOKEN) return null;
  const userData = {};
  if (email) userData.em = hash(email);
  if (fbc)   userData.fbc = fbc;
  if (fbp)   userData.fbp = fbp;

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name:    "Purchase",
          event_id:      eventId,
          event_time:    Math.floor(Date.now() / 1000),
          action_source: "website",
          user_data:     userData,
          custom_data:   { value, currency: currency || "EUR" },
        }]
      })
    }
  );
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET" && !req.query.action) {
    return res.status(200).json({ status: "ok", service: "MW TC Store" });
  }

  // ── GET: Sales abrufen ────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const { blobs } = await list({ prefix: "tc/charges/" });
      const data = await Promise.all(
        blobs.slice(-200).map(async (b) => {
          const r = await fetch(b.url);
          return r.json();
        })
      );
      data.sort((a, b) => b.timestamp - a.timestamp);

      const totalRevenue = data.reduce((s, d) => s + (d.amount || 0), 0);
      const today = new Date().toISOString().slice(0, 10);
      const todaySales = data.filter(d => d.date?.startsWith(today));

      return res.status(200).json({
        total_sales:    data.length,
        total_revenue:  Math.round(totalRevenue * 100) / 100,
        today_sales:    todaySales.length,
        today_revenue:  Math.round(todaySales.reduce((s,d)=>s+(d.amount||0),0)*100)/100,
        latest:         data.slice(0, 20),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: Kauf speichern ──────────────────────────────────────────────────
  if (req.method !== "POST") return res.status(405).end();

  const payload = req.body;

  // Nur charge Events — keine rebill
  const eventType = payload.event || payload.type || "";
  if (eventType === "rebill" || eventType === "subscription_rebill") {
    return res.status(200).json({ status: "skipped_rebill" });
  }

  const email    = payload.customer?.email || payload.email || "";
  const amount   = parseFloat(payload.order?.total || payload.total || 0);
  const currency = payload.order?.currency || payload.currency || "EUR";
  const orderId  = payload.order?.id || payload.order_id || Date.now().toString();
  const fbc      = payload.fbc || payload.customer?.fbc || "";
  const fbp      = payload.fbp || payload.customer?.fbp || "";
  const product  = payload.product?.name || payload.product_name || "";

  if (!email || amount <= 0) {
    return res.status(200).json({ status: "skipped", reason: "no email or amount" });
  }

  const record = {
    timestamp: Date.now(),
    date:      new Date().toISOString(),
    event:     eventType || "charge",
    email,
    amount,
    currency,
    order_id:  orderId,
    product,
    fbc:       !!fbc,
    fbp:       !!fbp,
  };

  try {
    // 1. In Blob speichern
    const key = `tc/charges/${record.timestamp}_${orderId}.json`;
    await put(key, JSON.stringify(record), {
      access: "public",
      contentType: "application/json",
    });

    // 2. Meta CAPI Purchase
    const capiRes = await sendCapiPurchase(email, amount, currency, fbc, fbp, `tc_${orderId}`);

    console.log(`✅ TC Sale stored: ${email.substring(0,3)}*** €${amount} | CAPI: ${capiRes?.events_received}`);

    return res.status(200).json({
      status: "success",
      stored: key,
      amount,
      capi:   { events_received: capiRes?.events_received },
    });

  } catch (err) {
    console.error("TC Store error:", err);
    return res.status(500).json({ error: err.message });
  }
}
