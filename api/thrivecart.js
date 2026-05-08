/**
 * /api/thrivecart
 * ThriveCart API Proxy → Sales, Orders, Revenue
 */

const TC_API_KEY = process.env.TC_API_KEY;
const TC_BASE    = "https://thrivecart.com/api/external/v1";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET" && !req.query.path) {
    return res.status(200).json({ status: "ok", service: "MW ThriveCart Proxy" });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!TC_API_KEY) return res.status(500).json({ error: "TC_API_KEY not configured" });

  const { path, ...queryParams } = req.query;
  const qs  = new URLSearchParams(queryParams).toString();
  const url = `${TC_BASE}${path || "/orders"}${qs ? "?" + qs : ""}`;

  console.log(`ThriveCart: GET ${url}`);

  try {
    const r = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${TC_API_KEY}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      }
    });

    const data = await r.json();
    return res.status(r.status).json(data);

  } catch(err) {
    console.error("ThriveCart proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
