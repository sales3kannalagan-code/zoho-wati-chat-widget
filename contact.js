/**
 * api/contact.js
 * GET /api/contact?phone=<number>
 *
 * Secure proxy to WATI — fetches contact details for a given WhatsApp number.
 * Credentials are read from environment variables; never exposed to the frontend.
 */

const https = require("https");

/**
 * Make an HTTPS GET request and return parsed JSON.
 * @param {string} url     - Full URL to GET
 * @param {Object} headers - Request headers
 * @returns {Promise<{status: number, body: Object}>}
 */
function httpsGet(url, headers) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: { raw: data } });
                }
            });
        });
        req.on("error", reject);
        req.setTimeout(15000, () => req.destroy(new Error("Request timed out")));
    });
}

module.exports = async function handler(req, res) {
    // CORS pre-flight
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

    const WATI_TOKEN = process.env.WATI_TOKEN;
    const WATI_ENDPOINT = process.env.WATI_ENDPOINT;

    if (!WATI_TOKEN || !WATI_ENDPOINT) {
        return res.status(500).json({ error: "Server configuration error: missing WATI credentials." });
    }

    const { phone } = req.query;

    if (!phone) {
        return res.status(400).json({ error: "phone query parameter is required." });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const url = `${WATI_ENDPOINT}/api/v1/getContact?whatsappNumber=${encodeURIComponent(cleanPhone)}`;

    try {
        const { status, body } = await httpsGet(url, {
            Authorization: `Bearer ${WATI_TOKEN}`,
        });
        return res.status(status).json(body);
    } catch (err) {
        console.error("[api/contact] Error:", err.message);
        return res.status(502).json({ error: "Failed to fetch contact from WATI.", detail: err.message });
    }
};
