/**
 * api/send.js
 * POST /api/send
 * Body: { phone: string, message: string }
 *
 * Secure proxy to WATI — sends a plain text WhatsApp message to a contact.
 * Credentials are read from environment variables; never exposed to the frontend.
 */

const https = require("https");

/**
 * Make an HTTPS POST request with a JSON body and return parsed JSON.
 * @param {string} url     - Full URL to POST to
 * @param {Object} headers - Request headers
 * @param {Object} payload - JSON-serialisable body
 * @returns {Promise<{status: number, body: Object}>}
 */
function httpsPost(url, headers, payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const parsedUrl = new URL(url);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
            },
        };

        const req = https.request(options, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(body) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: { raw: body } });
                }
            });
        });

        req.on("error", reject);
        req.setTimeout(15000, () => req.destroy(new Error("Request timed out")));
        req.write(data);
        req.end();
    });
}

module.exports = async function handler(req, res) {
    // CORS pre-flight
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        return res.status(204).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const WATI_TOKEN = process.env.WATI_TOKEN;
    const WATI_ENDPOINT = process.env.WATI_ENDPOINT;

    if (!WATI_TOKEN || !WATI_ENDPOINT) {
        return res.status(500).json({ error: "Server configuration error: missing WATI credentials." });
    }

    const { phone, message } = req.body || {};

    if (!phone || !message) {
        return res.status(400).json({ error: "phone and message are required in the request body." });
    }

    if (typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ error: "message must be a non-empty string." });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const url = `${WATI_ENDPOINT}/api/v1/sendSessionMessage/${encodeURIComponent(cleanPhone)}?messageText=${encodeURIComponent(message.trim())}`;

    try {
        const { status, body } = await httpsPost(
            url,
            { Authorization: `Bearer ${WATI_TOKEN}` },
            {}
        );

        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(status).json(body);
    } catch (err) {
        console.error("[api/send] Error:", err.message);
        return res.status(502).json({ error: "Failed to send message via WATI.", detail: err.message });
    }
};
