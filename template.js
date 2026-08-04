/**
 * api/template.js
 * POST /api/template
 * Body: { phone, templateName, broadcastName, parameters: [{name, value}] }
 *
 * Secure proxy to WATI — sends a pre-approved WhatsApp Template Message.
 * Credentials are read from environment variables; never exposed to the frontend.
 */

const https = require("https");

/**
 * Make an HTTPS POST request and return parsed JSON.
 * @param {string} url     - Full URL
 * @param {Object} headers - Request headers (merged with Content-Type)
 * @param {Object} payload - JSON body
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
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const WATI_TOKEN = process.env.WATI_TOKEN;
    const WATI_ENDPOINT = process.env.WATI_ENDPOINT;

    if (!WATI_TOKEN || !WATI_ENDPOINT) {
        return res.status(500).json({ error: "Server configuration error: missing WATI credentials." });
    }

    const { phone, templateName, broadcastName, parameters = [] } = req.body || {};

    if (!phone || !templateName || !broadcastName) {
        return res.status(400).json({
            error: "phone, templateName, and broadcastName are required in the request body.",
        });
    }

    const cleanPhone = phone.replace(/\D/g, "");

    // WATI template message payload format
    const payload = {
        template_name: templateName,
        broadcast_name: broadcastName,
        parameters: parameters.map((p) => ({
            name: p.name,
            value: p.value,
        })),
    };

    const url = `${WATI_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(cleanPhone)}`;

    try {
        const { status, body } = await httpsPost(
            url,
            { Authorization: `Bearer ${WATI_TOKEN}` },
            payload
        );
        return res.status(status).json(body);
    } catch (err) {
        console.error("[api/template] Error:", err.message);
        return res.status(502).json({ error: "Failed to send template via WATI.", detail: err.message });
    }
};
