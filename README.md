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

---

## Morgen-News-Telegram-Bot (5-Min-Routine, automatisiert)

Workflow:
- 7 Uhr: Bot schickt dir Top-Schlagzeilen (Google News DE + Google Trends DE).
- Tipp auf "🎬 Hook generieren" → Claude Haiku 4.5 liefert in <2s einen 1-Satz-Hook.
- Schick dem Bot jede beliebige Schlagzeile als Text → Hook zurück.
- Channel-Posts (Bot als Admin in deine Telegram-News-Channels) werden mit Hook-Button weitergeleitet.

### Setup (10 Min)

**1. Bot bei @BotFather erstellen**
- Telegram → @BotFather → `/newbot` → Token kopieren.

**2. Deine Chat-ID herausfinden**
- Bot anschreiben → `/start` → der Bot antwortet mit deiner Chat-ID.
  (Vor dem ersten Setup: Token in Vercel eintragen, deployen, Webhook setzen — dann `/start`.)

**3. Environment Variables in Vercel**
```
TELEGRAM_BOT_TOKEN  = 1234567890:ABC...
TELEGRAM_CHAT_ID    = 123456789
ANTHROPIC_API_KEY   = sk-ant-...
CRON_SECRET         = (frei wählbarer Schutz für manuelle /api/morning-news Aufrufe)
```
Redeploy nach dem Eintragen.

**4. Telegram-Webhook setzen (einmalig)**
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://DEINE-URL.vercel.app/api/telegram"
```
Erfolgskontrolle:
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

**5. Cron läuft automatisch**
`vercel.json` → `crons: [{ "path": "/api/morning-news", "schedule": "0 6 * * *" }]`
6 Uhr UTC = 7 Uhr CET (Winter) / 8 Uhr CEST (Sommer). Ändern → Schedule anpassen.

### Manuell triggern
```bash
curl "https://DEINE-URL.vercel.app/api/morning-news?secret=$CRON_SECRET"
```
Oder im Bot-Chat: `/news`

### Telegram-Channels mitlesen (optional)
- Bot zu deinem Telegram-Channel hinzufügen → Admin-Rechte (nur "Post Messages" reicht zum Mitlesen reicht NICHT — Bot muss Admin sein, dann sendet Telegram `channel_post` Updates).
- Sobald ein neuer Post im Channel erscheint, leitet der Bot ihn dir automatisch mit "🎬 Hook generieren"-Button weiter.

### Endpunkte
- `GET  /api/morning-news` — Cron-Trigger (manuell mit `?secret=...`)
- `POST /api/telegram` — Telegram-Webhook (nicht direkt aufrufen)
- `GET  /api/telegram` — Health-Check (`{ ok, bot, claude }`)
