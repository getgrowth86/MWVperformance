/**
 * /api/webinargeek
 * Proxy für WebinarGeek API — löst CORS Problem
 * 
 * Usage: GET /api/webinargeek?path=/webinars
 *        GET /api/webinargeek?path=/webinars/123/broadcasts
 *        GET /api/webinargeek?path=/webinars/123/broadcasts/456/subscriptions&page=1&per_page=100
 */

const WG_BASE   = "https://app.webinargeek.com/api/v2";
const WG_TOKEN  = process.env.WG_API_KEY;

export default async function handler(req, res) {
  // CORS Headers — erlaubt Requests vom Dashboard
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!WG_TOKEN) {
    return res.status(500).json({ error: "WG_API_KEY not configured" });
  }

  // Path aus Query-Parameter lesen
  const { path, ...queryParams } = req.query;

  if (!path) {
    return res.status(400).json({ error: "Missing path parameter" });
  }

  // Query-String für WebinarGeek bauen (page, per_page etc.)
  const qs = new URLSearchParams(queryParams).toString();
  const url = `${WG_BASE}${path}${qs ? "?" + qs : ""}`;

  try {
    const response = await fetch(url, {
      method:  "GET",
      headers: {
        "Authorization": `Bearer ${WG_TOKEN}`,
        "Accept":        "application/json",
        "Content-Type":  "application/json",
      },
    });

    const data = await response.json();

    return res.status(response.status).json(data);

  } catch (err) {
    console.error("WebinarGeek proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
