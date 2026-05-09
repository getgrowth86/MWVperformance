/**
 * /api/fbc-capture
 * Empfängt fbc + Email von der Onepage Bestätigungsseite
 *
 * Was es macht:
 * 1. Kontakt in ActiveCampaign finden/erstellen
 * 2. fbc + fbp in Custom Fields speichern
 * 3. Watch-Link mit fbc anreichern und in AC speichern
 * 4. Meta CAPI Lead Event mit fbc feuern
 *
 * AC Custom Fields die du anlegen musst:
 *   fbc_value      (Text) — der _fbc Cookie Wert
 *   fbp_value      (Text) — der _fbp Cookie Wert
 *   watch_link_fbc (URL)  — persönlicher Watch-Link + fbc
 */

import crypto from "crypto";

const AC_API_KEY     = process.env.AC_API_KEY;
const AC_URL         = process.env.AC_URL;
const PIXEL_ID       = process.env.META_PIXEL_ID    || "468972542963546";
const ACCESS_TOKEN   = process.env.META_CAPI_TOKEN;
const API_VERSION    = "v19.0";

function hash(v) {
  if (!v) return null;
  return crypto.createHash("sha256").update(v.toString().toLowerCase().trim()).digest("hex");
}

async function acGet(path) {
  const res = await fetch(`${AC_URL}/api/3${path}`, {
    headers: { "Api-Token": AC_API_KEY }
  });
  return res.json();
}

async function acPost(path, body) {
  const res = await fetch(`${AC_URL}/api/3${path}`, {
    method: "POST",
    headers: { "Api-Token": AC_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function acPut(path, body) {
  const res = await fetch(`${AC_URL}/api/3${path}`, {
    method: "PUT",
    headers: { "Api-Token": AC_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function sendCapiEvent(eventName, email, fbc, fbp, eventId) {
  if (!ACCESS_TOKEN) return null;
  const userData = {};
  if (email) userData.em = hash(email);
  if (fbc)   userData.fbc = fbc;
  if (fbp)   userData.fbp = fbp;

  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name:    eventName,
          event_time:    Math.floor(Date.now() / 1000),
          event_id:      eventId,
          action_source: "website",
          user_data:     userData,
        }]
      })
    }
  );
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const { email, firstname, lastname, phone, fbc, fbp, watch_link } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required" });

  console.log(`📌 fbc-capture | ${email.substring(0,5)}*** | fbc:${fbc?"✅":"❌"} | fbp:${fbp?"✅":"❌"} | watch_link:${watch_link?"✅":"❌"}`);

  const results = { email: email.substring(0,3)+"***", fbc_received: !!fbc, fbp_received: !!fbp };

  // ── 1. ACTIVECAMPAIGN ─────────────────────────────────────────────────────
  if (AC_API_KEY && AC_URL) {
    try {
      // Kontakt finden oder erstellen
      const search = await acGet(`/contacts?email=${encodeURIComponent(email)}`);
      let contactId = search.contacts?.[0]?.id;

      if (!contactId) {
        const created = await acPost("/contacts", {
          contact: { email, firstName: firstname||"", lastName: lastname||"", phone: phone||"" }
        });
        contactId = created.contact?.id;
        console.log(`✅ AC Kontakt erstellt: ${contactId}`);
      } else {
        console.log(`✅ AC Kontakt gefunden: ${contactId}`);
      }

      results.ac_contact_id = contactId;

      if (contactId) {
        // Custom Fields laden
        const fieldsData = await acGet("/fields?limit=100");
        const fields     = fieldsData.fields || [];

        // Field IDs finden
        const findField = (names) => fields.find(f =>
          names.some(n => f.perstag?.toLowerCase() === n || f.title?.toLowerCase() === n)
        );

        const fbcField       = findField(["fbc_value", "fbc"]);
        const fbpField       = findField(["fbp_value", "fbp"]);
        const watchFbcField  = findField(["watch_link_fbc", "watch_link"]);

        // Watch-Link mit fbc anreichern
        let watchLinkWithFbc = watch_link || "";
        if (watch_link && fbc) {
          try {
            const url = new URL(watch_link);
            url.searchParams.set("fbc", fbc);
            if (fbp) url.searchParams.set("fbp", fbp);
            watchLinkWithFbc = url.toString();
          } catch(e) {
            watchLinkWithFbc = watch_link + (watch_link.includes("?") ? "&" : "?") + "fbc=" + encodeURIComponent(fbc);
          }
        }

        // Field Values setzen
        const fieldUpdates = [];

        if (fbc && fbcField) {
          fieldUpdates.push(acPost("/fieldValues", {
            fieldValue: { contact: contactId, field: fbcField.id, value: fbc }
          }));
        }
        if (fbp && fbpField) {
          fieldUpdates.push(acPost("/fieldValues", {
            fieldValue: { contact: contactId, field: fbpField.id, value: fbp }
          }));
        }
        if (watchLinkWithFbc && watchFbcField) {
          fieldUpdates.push(acPost("/fieldValues", {
            fieldValue: { contact: contactId, field: watchFbcField.id, value: watchLinkWithFbc }
          }));
        }

        if (fieldUpdates.length > 0) {
          await Promise.all(fieldUpdates);
          console.log(`✅ AC Custom Fields gesetzt: fbc=${!!fbcField} fbp=${!!fbpField} watch=${!!watchFbcField}`);
          results.ac_fields_saved = {
            fbc:        !!fbc && !!fbcField,
            fbp:        !!fbp && !!fbpField,
            watch_link: !!watchLinkWithFbc && !!watchFbcField,
          };
          results.watch_link_with_fbc = watchLinkWithFbc;
        } else {
          console.log("⚠️ Keine AC Custom Fields gefunden — bitte anlegen: fbc_value, fbp_value, watch_link_fbc");
          results.ac_fields_missing = ["fbc_value", "fbp_value", "watch_link_fbc"];
          results.fields_available  = fields.map(f => f.title || f.perstag);
        }
      }
    } catch(err) {
      console.error("AC error:", err.message);
      results.ac_error = err.message;
    }
  }

  // Meta CAPI Lead NICHT senden — wird bereits von /api/lead (WG Webhook)
  // und Browser Pixel auf Onepage gesendet. Verhindert 3x Attribution!

  return res.status(200).json({ status: "success", ...results });
}
