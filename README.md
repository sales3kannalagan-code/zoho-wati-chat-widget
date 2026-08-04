# zoho-wati-chat-widget

A production-ready **Zoho CRM Widget** that embeds a full **WATI WhatsApp Chat interface** directly inside Zoho CRM Lead records.

---

## Features

- 💬 Real-time WhatsApp chat history (paginated)
- ✉️ Send text messages
- 📋 Send WhatsApp Template messages
- 🔍 Client-side message search
- 🌙 Dark / Light mode (persisted)
- 🔄 Refresh & Load More pagination
- 🔔 Toast notifications
- 🌐 Connection status badge
- 🛡️ Secure — credentials never exposed to frontend
- 📱 Responsive layout (iframe-friendly)

---

## Folder Structure

```
zoho-wati-chat-widget/
├── index.html          # Widget UI shell
├── style.css           # Chat UI styles
├── script.js           # Widget logic (Zoho SDK + API calls)
├── manifest.json       # Zoho Widget manifest
├── plugin-manifest.json
├── package.json
├── vercel.json         # Vercel routing config
├── README.md
└── api/
    ├── messages.js     # GET conversation history
    ├── send.js         # POST send text message
    ├── contact.js      # GET contact info
    └── template.js     # POST send template message
```

---

## Environment Variables

Set these in your **Vercel Project → Settings → Environment Variables**:

| Variable        | Description                                    | Example                                          |
|-----------------|------------------------------------------------|--------------------------------------------------|
| `WATI_TOKEN`    | Your WATI API Bearer token                     | `eyJhbGci...`                                    |
| `WATI_ENDPOINT` | Your WATI instance base URL (no trailing slash)| `https://live-mt-server.wati.io/12345`           |

> ⚠️ **Never** commit these values to your repository.

---

## Deployment

### 1. Deploy to Vercel

Push to your linked GitHub repository, or run:

```bash
npm install -g vercel
vercel --prod
```

### 2. Set Environment Variables

In the [Vercel Dashboard](https://vercel.app):
1. Navigate to your project → **Settings** → **Environment Variables**
2. Add `WATI_TOKEN` and `WATI_ENDPOINT`
3. Redeploy (or Vercel will pick them up on next deploy)

### 3. Install Widget in Zoho CRM

1. Go to **Zoho CRM → Setup → Developer Space → Widgets**
2. Click **New Widget**
3. Choose **Zoho Widget SDK (External URL)**
4. Enter: `https://zoho-wati-chat-widget.vercel.app`
5. Map it to the **Leads** module, **Detail Page Tab**
6. Save and activate

---

## API Reference

### `GET /api/messages`

Fetch paginated conversation history.

| Query Param  | Required | Description                  |
|--------------|----------|------------------------------|
| `phone`      | ✅        | WhatsApp number (digits only) |
| `pageSize`   | ✗        | Items per page (default: 30)  |
| `pageNumber` | ✗        | Page index (default: 1)       |

---

### `POST /api/send`

Send a plain text WhatsApp message.

```json
{
  "phone": "919876543210",
  "message": "Hello from Zoho CRM!"
}
```

---

### `GET /api/contact`

Fetch WATI contact info.

| Query Param | Required | Description       |
|-------------|----------|-------------------|
| `phone`     | ✅        | WhatsApp number   |

---

### `POST /api/template`

Send a pre-approved WhatsApp Template Message.

```json
{
  "phone": "919876543210",
  "templateName": "hello_world",
  "broadcastName": "My Campaign",
  "parameters": [
    { "name": "name", "value": "Fazil" }
  ]
}
```

---

## Local Development

```bash
npm install -g vercel
vercel dev
```

Then open `http://localhost:3000`. The widget will load in **standalone mode** (no Zoho SDK) so you can test the UI.

Set env vars locally via a `.env` file (Vercel CLI reads it automatically):

```
WATI_TOKEN=your_token_here
WATI_ENDPOINT=https://live-mt-server.wati.io/YOUR_ACCOUNT_ID
```

---

## Security Notes

- All WATI credentials live **only on the server** (Vercel serverless functions).
- The frontend makes calls to `/api/*` on the same origin — no credentials are ever in the browser.
- CORS headers are set on all API routes; tighten the `Access-Control-Allow-Origin` to your Zoho domain in production if desired.

---

## License

MIT
