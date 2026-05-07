/**
 * /api/lead
 * WebinarGeek Webhook → Meta CAPI Lead + CompleteRegistration
 *
 * Setup in WebinarGeek:
 * Settings → Integrations → Webhooks → Add Webhook
 * URL: https://mw-vperformance-o4k7.vercel.app/api/lead
 * Events: webinar_subscribed
 *
 * Was das löst:
 * - Server-side Lead Event (backup für Browser-Pixel)
 * - CompleteRegistration Event (Meta optimiert darauf)
 * - Höhere EMQ durch Email + Name matching
 * - fbc Weitergabe wenn fbclid als URL-Parameter übergeben
 */

import crypto from "crypto";

const PIXEL_ID    = process.env.META_PIXEL_ID   || "468972542963546";
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

  // WebinarGeek validiert URL mit GET/HEAD
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ status: "ok", service: "MW Lead CAPI" });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!ACCESS_TOKEN) {
    console.error("META_CAPI_TOKEN not configured");
    return res.status(500).json({ error: "META_CAPI_TOKEN not configured" });
  }

  const payload = req.body;

  // DEBUG: Alle eingehenden Requests loggen
  console.log("=== WEBHOOK RECEIVED ===");
  console.log("Event type:", payload.event || payload.type || "UNKNOWN");
  console.log("Full payload:", JSON.stringify(payload).substring(0, 500));
  console.log("========================");

  const eventType = payload.event || payload.type || "";

  // Alle Events akzeptieren die eine Email enthalten
  const email = payload.email 
    || payload.entity?.subscription?.email 
    || payload.entity?.email
    || payload.subscription?.email
    || payload.data?.email
    || "";

  if (!email) {
    console.log(`No email found, event: ${eventType}`);
    return res.status(200).json({ status: "no_email", event: eventType, payload_keys: Object.keys(payload) });
  }

  // Subscriber-Daten aus verschiedenen Payload-Strukturen extrahieren
  const entity   = payload.entity || payload;
  const sub      = entity.subscription || entity;

  const firstName = sub.first_name || sub.firstname || entity.first_name || payload.first_name || "";
  const lastName  = sub.last_name  || sub.lastname  || entity.last_name  || payload.last_name  || "";
  const phone     = sub.phone_number || sub.phone   || payload.phone      || "";

  // fbc aus URL-Parametern (wenn fbclid in WebinarGeek-URL übergeben wurde)
  // WebinarGeek speichert custom URL params manchmal in extra_fields
  const extraFields = sub.extra_fields || sub.custom_fields || {};
  const fbclid = extraFields.fbclid || sub.fbclid || payload.fbclid || null;
  const fbc    = fbclid ? buildFbc(fbclid) : (extraFields.fbc || sub.fbc || payload.fbc || null);
  const fbp    = extraFields.fbp  || sub.fbp  || payload.fbp  || null;

  // Webinar ID als event_id für Deduplication
  const subscriptionId = sub.id || sub.subscription_id || Date.now().toString();
  const eventId = `wg_lead_${subscriptionId}`;

  // Client IP + User Agent
  const clientIp  = req.headers["x-forwarded-for"]?.split(",")[0] || "";
  const userAgent = req.headers["user-agent"] || "";

  // User Data aufbauen
  const userData = {};
  if (email)     userData.em = hash(email);
  if (phone)     userData.ph = hash(normalizePhone(phone));
  if (firstName) userData.fn = hash(firstName);
  if (lastName)  userData.ln = hash(lastName);
  if (fbc)       userData.fbc = fbc;
  if (fbp)       userData.fbp = fbp;
  if (clientIp)  userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;

  const baseEvent = {
    event_time:    Math.floor(Date.now() / 1000),
    action_source: "website",
    user_data:     userData,
    custom_data: {
      content_name: sub.webinar_title || payload.webinar_title || "Meilenweit Voraus Workshop",
    },
  };

  try {
    // 1. Lead Event senden
    const leadResult = await sendToMeta("Lead", {
      ...baseEvent,
      event_name: "Lead",
      event_id:   eventId,
    });

    // 2. CompleteRegistration Event senden (separate event_id)
    const crResult = await sendToMeta("CompleteRegistration", {
      ...baseEvent,
      event_name: "CompleteRegistration",
      event_id:   `${eventId}_cr`,
    });

    console.log(`✅ Lead + CompleteRegistration → Meta | ${email.substring(0,3)}*** | fbc: ${fbc ? "✅" : "❌"}`);

    return res.status(200).json({
      status:  "success",
      email:   email.substring(0, 3) + "***",
      fbc:     !!fbc,
      lead:    { events_received: leadResult.events_received },
      complete_registration: { events_received: crResult.events_received },
    });

  } catch (err) {
    console.error("CAPI Lead error:", err);
    return res.status(500).json({ error: err.message });
  }
}
