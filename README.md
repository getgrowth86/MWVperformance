# MW Proxy — Meilenweit Voraus

## Setup (10 Minuten)

### Schritt 1: GitHub Repo erstellen
1. github.com → New repository → Name: `mw-proxy` → Create
2. ZIP entpacken, alle Dateien hochladen (api/webinargeek.js, api/capi.js, package.json, vercel.json)

### Schritt 2: Mit Vercel verbinden
1. vercel.com → Add New Project → GitHub → `mw-proxy` importieren
2. Deploy → URL notieren (z.B. `mw-proxy-xxx.vercel.app`)

### Schritt 3: Environment Variables in Vercel
Settings → Environment Variables → diese 4 eintragen:

```
WG_API_KEY         = Y5T53-rLBE07pXyhzjTdWx9CwlDu1ncCpjNnliY9lPLUKFFw5LwIvhaBjmoZv0QJF9R6Er45hI41FmB_54rpRQ
META_PIXEL_ID      = 468972542963546
META_CAPI_TOKEN    = EAAFT0mw86CsBRcK8bOMCoZCXJ7eOvEGsKNZAQfzeQxmle6r1F05ZCtRX5s0sPcVNNKuaKbDGhsG6aNdb7h1ZBYlG4eTzd1E5RpF6mjhHlwzNRdj2yUBfz23u14g1Jb56TSvkW5S77WLIhqV0Oi0Q0WbOQo3HeI4o8DGve1qJBR0sRzPdXZAUChTsVHmglbmvJiAZDZD
TC_WEBHOOK_SECRET  = (aus ThriveCart → Settings → Webhooks → Secret Key)
```

Nach dem Eintragen: Deployments → Redeploy (1 Klick)

### Schritt 4: ThriveCart Webhook
ThriveCart → Settings → Webhooks → Add Webhook:
- URL: `https://DEINE-URL.vercel.app/api/capi`
- Events: ✅ charge
- Webhook Secret: (kopieren → als TC_WEBHOOK_SECRET in Vercel eintragen)

### Schritt 5: Dashboard aktualisieren
Im WebinarGeek Audience Tool die Zeile ändern:
```js
const PROXY = "https://DEINE-URL.vercel.app";
```

## Endpunkte testen

```bash
# WebinarGeek — sollte deine Webinare zurückgeben
curl "https://DEINE-URL.vercel.app/api/webinargeek?path=/webinars"

# CAPI — Test Purchase senden
curl -X POST "https://DEINE-URL.vercel.app/api/capi" \
  -H "Content-Type: application/json" \
  -d '{"event":"charge","email":"test@test.de","first_name":"Max","last_name":"Mustermann","total":"297","currency":"EUR","order_id":"TEST001"}'
```

Dann in Meta Events Manager → Test Events prüfen ob "Purchase" ankam.

## Logs
Vercel Dashboard → Project → Functions → webinargeek / capi → Logs
Jeder Purchase wird geloggt: "✅ Purchase sent to Meta CAPI | Order: xxx | €297"
