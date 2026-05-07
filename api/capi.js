/**
 * /api/capi
 * ThriveCart Webhook → Meta Conversions API
 * 
 * Setup:
 * 1. In ThriveCart: Settings → Webhooks → Add Webhook → URL: https://YOUR-DOMAIN.vercel.app/api/capi
 * 2. Events: charge (Neukauf) — optional auch: refund
 * 3. Secret Key in Vercel env: TC_WEBHOOK_SECRET
 * 
 * Sendet Purchase Event an Meta CAPI mit:
 * - email (hashed)
 * - phone (hashed) 
 * - first_name (hashed)
 * - last_name (hashed)
 * - fbc (aus ThriveCart URL params, falls vorhanden)
 * - fbp (aus ThriveCart URL params, falls vorhanden)
 * - value + currency
 * - event_id = order_id (für Pixel-Deduplication)
 */

import crypto from "crypto";

const PIXEL_ID    = process.env.META_PIXEL_ID    || "468972542963546";
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN; // aus Vercel env
const TC_SECRET    = process.env.TC_WEBHOOK_SECRET;
const API_VERSION  = "v19.0";

// SHA-256 Hash für Meta Advanced Matching
function hashValue(value) {
  if (!value) return null;
  return crypto
    .createHash("sha256")
    .update(value.toString().toLowerCase().trim())
    .digest("hex");
}

// Telefonnummer normalisieren (Meta erwartet E.164 ohne +)
function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/[\s\-\(\)\+]/g, "").replace(/^0/, "49");
}

// ThriveCart Webhook Signatur prüfen
function verifySignature(body, signature, secret) {
  if (!secret || !signature) return true; // skip if not configured
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ThriveCart validiert die URL mit GET/HEAD vor dem Speichern
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(200).json({ status: "ok", service: "MW CAPI Bridge" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!ACCESS_TOKEN) {
    console.error("META_CAPI_TOKEN not configured");
    return res.status(500).json({ error: "META_CAPI_TOKEN not configured" });
  }

  // Body als String für Signatur-Prüfung
  const rawBody = JSON.stringify(req.body);

  // Signatur verifizieren (wenn Secret konfiguriert)
  const signature = req.headers["x-thrivecart-signature"] || req.headers["signature"] || "";
  if (TC_SECRET && !verifySignature(rawBody, signature, TC_SECRET)) {
    console.error("Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const payload = req.body;

  // Nur "charge" Events → neue Käufe (keine Rebills, keine Refunds)
  const event = payload.event || payload.type || "";
  if (event !== "charge") {
    console.log(`Skipping event type: ${event}`);
    return res.status(200).json({ status: "skipped", event });
  }

  // Daten aus ThriveCart Webhook extrahieren
  const customer = payload.customer || payload;
  const order    = payload.order    || payload;

  const email     = customer.email      || payload.email     || "";
  const firstName = customer.first_name || payload.first_name || "";
  const lastName  = customer.last_name  || payload.last_name  || "";
  const phone     = customer.phone      || payload.phone      || "";
  const orderId   = order.order_id      || payload.order_id   || payload.id || "";
  const amount    = parseFloat(order.total || payload.total || payload.amount || 0);
  const currency  = (order.currency || payload.currency || "EUR").toUpperCase();

  // fbc + fbp aus ThriveCart URL-Parametern (wenn wir sie durchreichen)
  const fbc = payload.fbc || order.fbc || customer.fbc || null;
  const fbp = payload.fbp || order.fbp || customer.fbp || null;

  // Käufer-IP + User Agent (für besseres Matching)
  const clientIp  = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "";
  const userAgent = req.headers["user-agent"] || "";

  // Meta CAPI Event bauen
  const eventData = {
    data: [
      {
        event_name:       "Purchase",
        event_time:       Math.floor(Date.now() / 1000),
        event_id:         `tc_${orderId}`, // Deduplication mit Pixel
        action_source:    "website",
        user_data: {
          em:  hashValue(email),
          ph:  hashValue(normalizePhone(phone)),
          fn:  hashValue(firstName),
          ln:  hashValue(lastName),
          ...(fbc ? { fbc } : {}),
          ...(fbp ? { fbp } : {}),
          ...(clientIp  ? { client_ip_address: clientIp  } : {}),
          ...(userAgent ? { client_user_agent: userAgent } : {}),
        },
        custom_data: {
          value:      amount,
          currency:   currency,
          order_id:   orderId,
          content_type: "product",
        },
      },
    ],
    // Test Event Code — ENTFERNEN in Production!
    // test_event_code: "TEST12345",
  };

  // Null-Werte aus user_data entfernen
  eventData.data[0].user_data = Object.fromEntries(
    Object.entries(eventData.data[0].user_data).filter(([, v]) => v != null)
  );

  // An Meta senden
  const metaUrl = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const metaRes = await fetch(metaUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(eventData),
    });

    const metaData = await metaRes.json();

    if (!metaRes.ok || metaData.error) {
      console.error("Meta CAPI error:", metaData);
      return res.status(500).json({ error: "Meta CAPI error", details: metaData });
    }

    console.log(`✅ Purchase sent to Meta CAPI | Order: ${orderId} | €${amount} | Email: ${email.substring(0,3)}***`);

    return res.status(200).json({
      status:   "success",
      order_id: orderId,
      amount:   amount,
      currency: currency,
      events_received: metaData.events_received,
    });

  } catch (err) {
    console.error("CAPI fetch error:", err);
    return res.status(500).json({ error: err.message });
  }
}
