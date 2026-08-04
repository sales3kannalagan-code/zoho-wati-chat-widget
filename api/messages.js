/**
 * api/messages.js
 * GET /api/messages?phone=<number>&pageSize=<n>&pageNumber=<n>
 *
 * Secure proxy to WATI — fetches paginated WhatsApp conversation history.
 * Credentials are read from environment variables; never exposed to the frontend.
 */

const https = require("https");

/**
 * Make an HTTPS GET request and return parsed JSON.
 * @param {string} url  - Full URL to request
 * @param {Object} headers - Request headers
 * @returns {Promise<Object>} Parsed JSON body
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
    req.setTimeout(15000, () => {
      req.destroy(new Error("Request timed out"));
    });
  });
}

module.exports = async function handler(req, res) {
  // Allow only GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Read secure credentials from env
  const WATI_TOKEN = process.env.WATI_TOKEN;
  const WATI_ENDPOINT = process.env.WATI_ENDPOINT;

  if (!WATI_TOKEN || !WATI_ENDPOINT) {
    return res.status(500).json({ error: "Server configuration error: missing WATI credentials." });
  }

  const { phone, pageSize = 20, pageNumber = 1 } = req.query;

  if (!phone) {
    return res.status(400).json({ error: "phone query parameter is required." });
  }

  // Sanitise phone — keep digits only, strip leading zeros/+ if needed
  const cleanPhone = phone.replace(/\D/g, "");

  const url = `${WATI_ENDPOINT}/api/v1/getMessages/${encodeURIComponent(cleanPhone)}?pageSize=${pageSize}&pageNumber=${pageNumber}`;

  try {
    const { status, body } = await httpsGet(url, {
      Authorization: `Bearer ${WATI_TOKEN}`,
      "Content-Type": "application/json",
    });

    // Add CORS headers so the Zoho iframe can call this endpoint
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    return res.status(status).json(body);
  } catch (err) {
    console.error("[api/messages] Error:", err.message);
    return res.status(502).json({ error: "Failed to fetch messages from WATI.", detail: err.message });
  }
};
