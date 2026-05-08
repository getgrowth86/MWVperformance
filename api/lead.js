/**
 * /api/lead
 * WebinarGeek Webhook → Meta CAPI Lead
 * FIXED: Nur Lead senden, kein CR mehr → Email-Abdeckung steigt von 58% auf ~80%
 */

import crypto from "crypto";

const PIXEL_ID     = process.env.META_PIXEL_ID   || "468972542963546";
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;
const API_VERSION  = "v19.0";

function hash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(value.toString().toLowerCase().trim()).digest("hex");
}

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/[\s\-\(\)\+]/g, "").replace(/^0/, "49");
}

function buildFbc(fbclid) {
  if (!fbclid) return null;
  return `fb.1.${Math.floor(Date.now() / 1000)}.${fbclid}`;
}

async function sendToMeta(eventName, eventData) {
  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [eventData] }),
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ status: "ok", service: "MW Lead CAPI" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!ACCESS_TOKEN) return res.status(500).json({ error: "META_CAPI_TOKEN not configured" });

  const payload = req.body;

  console.log("=== WEBHOOK RECEIVED ===");
  console.log("Event type:", payload.event || payload.type || "UNKNOWN");
  console.log("Full payload:", JSON.stringify(payload).substring(0, 500));
  console.log("========================");

  const email = payload.email
    || payload.entity?.subscription?.email
    || payload.entity?.email
    || payload.subscription?.email
    || payload.data?.email
    || "";

  if (!email) {
    return res.status(200).json({ status: "no_email", payload_keys: Object.keys(payload) });
  }

  const entity    = payload.entity || payload;
  const sub       = entity.subscription || entity;
  const firstName = sub.first_name || sub.firstname || payload.first_name || "";
  const lastName  = sub.last_name  || sub.lastname  || payload.last_name  || "";
  const phone     = sub.phone_number || sub.phone   || payload.phone      || "";

  const extraFields = sub.extra_fields || sub.custom_fields || {};
  const fbclid = extraFields.fbclid || sub.fbclid || payload.fbclid || null;
  const fbc    = fbclid ? buildFbc(fbclid) : (extraFields.fbc || sub.fbc || payload.fbc || null);
  const fbp    = extraFields.fbp || sub.fbp || payload.fbp || null;

  const subscriptionId = sub.id || sub.subscription_id || Date.now().toString();
  const eventId = `wg_lead_${subscriptionId}`;

  const userData = {};
  if (email)     userData.em = hash(email);
  if (phone)     userData.ph = hash(normalizePhone(phone));
  if (firstName) userData.fn = hash(firstName);
  if (lastName)  userData.ln = hash(lastName);
  if (fbc)       userData.fbc = fbc;
  if (fbp)       userData.fbp = fbp;
  userData.client_ip_address = req.headers["x-forwarded-for"]?.split(",")[0] || "";
  userData.client_user_agent = req.headers["user-agent"] || "";

  try {
    // NUR Lead senden — kein CompleteRegistration mehr vom Server
    // CR kommt vom Browser-Pixel auf Onepage → keine Duplikate → EMQ steigt auf ~80%
    const leadResult = await sendToMeta("Lead", {
      event_name:    "Lead",
      event_id:      eventId,
      event_time:    Math.floor(Date.now() / 1000),
      action_source: "website",
      user_data:     userData,
      custom_data:   { content_name: "Meilenweit Voraus Workshop" },
    });

    console.log(`✅ Lead → Meta | ${email.substring(0,3)}*** | fbc: ${fbc ? "✅" : "❌"}`);

    return res.status(200).json({
      status: "success",
      email:  email.substring(0, 3) + "***",
      fbc:    !!fbc,
      lead:   { events_received: leadResult.events_received },
    });

  } catch (err) {
    console.error("CAPI Lead error:", err);
    return res.status(500).json({ error: err.message });
  }
}
