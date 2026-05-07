/**
 * /api/fbc-capture
 * Empfängt fbc + Email von der Onepage Bestätigungsseite
 * → Speichert fbc in ActiveCampaign Custom Field
 * → Damit können Email-Links in der Follow-Up Sequenz den fbc mitgeben
 *
 * ActiveCampaign Custom Fields die du anlegen musst:
 * AC → Lists → Custom Fields → Add:
 *   - Field Name: "fbc_value"   (type: Text)
 *   - Field Name: "fbp_value"   (type: Text)
 */

const AC_API_KEY = process.env.AC_API_KEY;
const AC_URL     = process.env.AC_URL; // https://lunaswayfare.api-us1.com

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const { email, firstname, fbc, fbp, watch_link } = req.body || {};

  if (!email) return res.status(400).json({ error: "Email required" });
  if (!fbc && !fbp) return res.status(200).json({ status: "no_fbc", message: "No fbc/fbp to save" });

  console.log(`📌 fbc-capture | ${email.substring(0,3)}*** | fbc: ${fbc ? "✅" : "❌"} | fbp: ${fbp ? "✅" : "❌"}`);

  if (!AC_API_KEY || !AC_URL) {
    console.error("AC_API_KEY or AC_URL not configured");
    return res.status(500).json({ error: "AC credentials not configured" });
  }

  try {
    // 1. Kontakt in AC finden oder erstellen
    const searchRes = await fetch(
      `${AC_URL}/api/3/contacts?email=${encodeURIComponent(email)}`,
      {
        headers: {
          "Api-Token": AC_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    const searchData = await searchRes.json();
    const contacts   = searchData.contacts || [];

    let contactId;

    if (contacts.length > 0) {
      // Kontakt gefunden
      contactId = contacts[0].id;
      console.log(`✅ Kontakt gefunden: ID ${contactId}`);
    } else {
      // Kontakt neu anlegen
      const createRes = await fetch(`${AC_URL}/api/3/contacts`, {
        method: "POST",
        headers: { "Api-Token": AC_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: {
            email:     email,
            firstName: firstname || "",
          }
        }),
      });
      const createData = await createRes.json();
      contactId = createData.contact?.id;
      console.log(`✅ Kontakt erstellt: ID ${contactId}`);
    }

    if (!contactId) {
      return res.status(500).json({ error: "Could not find or create contact" });
    }

    // 2. Custom Fields abrufen um die Field IDs zu finden
    const fieldsRes  = await fetch(`${AC_URL}/api/3/fields?limit=100`, {
      headers: { "Api-Token": AC_API_KEY },
    });
    const fieldsData = await fieldsRes.json();
    const fields     = fieldsData.fields || [];

    const fbcField = fields.find(f => f.perstag === "FBC_VALUE" || f.title?.toLowerCase() === "fbc_value");
    const fbpField = fields.find(f => f.perstag === "FBP_VALUE" || f.title?.toLowerCase() === "fbp_value");

    // 3. Custom Field Values setzen
    const updates = [];
    if (fbc && fbcField) {
      updates.push(
        fetch(`${AC_URL}/api/3/fieldValues`, {
          method: "POST",
          headers: { "Api-Token": AC_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            fieldValue: {
              contact: contactId,
              field:   fbcField.id,
              value:   fbc,
            }
          }),
        })
      );
    }

    if (fbp && fbpField) {
      updates.push(
        fetch(`${AC_URL}/api/3/fieldValues`, {
          method: "POST",
          headers: { "Api-Token": AC_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            fieldValue: {
              contact: contactId,
              field:   fbpField.id,
              value:   fbp,
            }
          }),
        })
      );
    }

    if (updates.length > 0) {
      await Promise.all(updates);
      console.log(`✅ Custom Fields gesetzt | Kontakt ${contactId} | fbc: ${fbc?.substring(0,20)}...`);
    } else {
      console.log(`⚠️ Custom Fields nicht gefunden — bitte in AC anlegen: fbc_value, fbp_value`);
    }

    return res.status(200).json({
      status:     "success",
      contact_id: contactId,
      fbc_saved:  !!fbc && !!fbcField,
      fbp_saved:  !!fbp && !!fbpField,
      fields_found: {
        fbc: !!fbcField,
        fbp: !!fbpField,
      }
    });

  } catch (err) {
    console.error("fbc-capture error:", err);
    return res.status(500).json({ error: err.message });
  }
}
