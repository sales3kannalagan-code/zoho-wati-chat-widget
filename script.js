/**
 * script.js — WATI WhatsApp Chat Widget for Zoho CRM
 *
 * Responsibilities:
 *   - Initialise Zoho Embedded App SDK
 *   - Read Lead data (name, phone) from CRM context
 *   - Load paginated chat history via /api/messages
 *   - Send messages via /api/send
 *   - Send template messages via /api/template
 *   - Render chat bubbles with date separators
 *   - Search / filter messages
 *   - Toggle dark / light theme (persisted in localStorage)
 *   - Toast notifications, typing indicator, connection status
 *   - Auto-scroll to latest message
 *   - Retry failed requests with exponential back-off
 */

/* ══════════════════════════════════════════════════════════════
   CONSTANTS & STATE
══════════════════════════════════════════════════════════════ */

/** Base URL for our Vercel serverless API functions */
const API_BASE = window.location.origin;

/**
 * Global application state — single source of truth.
 */
const state = {
    phone: null,           // WhatsApp phone number of the currently opened Lead
    leadName: "",          // Lead display name
    messages: [],          // All fetched messages (oldest first)
    filteredMessages: [],  // Messages filtered by search term
    pageNumber: 1,
    pageSize: 30,
    hasMore: true,         // Whether more pages are available
    isLoading: false,
    isSending: false,
    searchActive: false,
    searchTerm: "",
    retryCount: 0,
};

/** Common emojis shown in the inline picker */
const EMOJIS = [
    "😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "🙏", "👍", "👎",
    "❤️", "🔥", "✅", "⚡", "💬", "📞", "📲", "🎉", "💰", "🛒",
    "⏰", "📅", "✍️", "👋", "🤝", "💪", "🌟", "💯", "🙌", "😢",
];

/* ══════════════════════════════════════════════════════════════
   DOM REFERENCES
══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

const dom = {
    app: $("app"),
    header: $("header"),
    avatar: $("contact-avatar"),
    contactName: $("contact-name"),
    contactPhone: $("contact-phone"),
    connectionStatus: $("connection-status"),
    connectionLabel: $("connection-label"),
    searchBtn: $("search-btn"),
    searchBar: $("search-bar"),
    searchInput: $("search-input"),
    templateBtn: $("template-btn"),
    themeBtn: $("theme-btn"),
    themeIconDark: $("theme-icon-dark"),
    themeIconLight: $("theme-icon-light"),
    refreshBtn: $("refresh-btn"),
    messagesContainer: $("messages-container"),
    loadingOverlay: $("loading-overlay"),
    emptyState: $("empty-state"),
    errorState: $("error-state"),
    errorMessage: $("error-message"),
    errorRetryBtn: $("error-retry-btn"),
    typingIndicator: $("typing-indicator"),
    emojiBtn: $("emoji-btn"),
    emojiDropdown: $("emoji-picker-dropdown"),
    msgInput: $("msg-input"),
    sendBtn: $("send-btn"),
    toastContainer: $("toast-container"),
    templateModal: $("template-modal"),
    tmplName: $("tmpl-name"),
    tmplBroadcast: $("tmpl-broadcast"),
    tmplParams: $("tmpl-params"),
    tmplCancelBtn: $("tmpl-cancel-btn"),
    tmplSendBtn: $("tmpl-send-btn"),
};

/* ══════════════════════════════════════════════════════════════
   UTILITY HELPERS
══════════════════════════════════════════════════════════════ */

/**
 * Show a toast notification.
 * @param {string} msg   - Message text
 * @param {'success'|'error'} type
 */
function showToast(msg, type = "error") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

/**
 * Format a Unix timestamp (seconds) into a human-readable time string.
 * @param {number} ts - Unix timestamp in seconds
 * @returns {string} e.g. "09:45 AM"
 */
function formatTime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Format a date label for group separators.
 * @param {number} ts - Unix timestamp in seconds
 * @returns {string} e.g. "Today", "Yesterday", or "12 Jun 2025"
 */
function formatDateLabel(ts) {
    const now = new Date();
    const d = new Date(ts * 1000);
    const diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Return the YYYY-MM-DD date string for grouping messages by day.
 * @param {number} ts
 */
function dateKey(ts) {
    return new Date(ts * 1000).toISOString().slice(0, 10);
}

/**
 * Exponential back-off delay.
 * @param {number} attempt - 0-based attempt index
 * @returns {number} milliseconds
 */
function backOffDelay(attempt) {
    return Math.min(1000 * Math.pow(2, attempt), 12000);
}

/**
 * Sanitise a phone number — keep digits only, strip leading zeros.
 * @param {string} raw
 * @returns {string}
 */
function sanitisePhone(raw = "") {
    return raw.replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * Escape HTML special chars to prevent XSS when rendering message text.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str = "") {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/* ══════════════════════════════════════════════════════════════
   THEME
══════════════════════════════════════════════════════════════ */

/**
 * Apply and persist the selected theme.
 * @param {'dark'|'light'} theme
 */
function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("wati_theme", theme);
    dom.themeIconDark.style.display = theme === "dark" ? "block" : "none";
    dom.themeIconLight.style.display = theme === "light" ? "block" : "none";
}

/** Toggle between dark and light themes. */
function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
}

/* ══════════════════════════════════════════════════════════════
   CONNECTION STATUS
══════════════════════════════════════════════════════════════ */

/**
 * Update the connection status badge.
 * @param {'online'|'offline'|'loading'} status
 */
function setConnectionStatus(status) {
    dom.connectionStatus.className = `${status === "loading" ? "" : status}`;
    dom.connectionLabel.textContent =
        status === "online" ? "Online" :
            status === "offline" ? "Offline" : "Syncing…";
    dom.connectionStatus.className = status === "loading" ? "" : status;
}

/* ══════════════════════════════════════════════════════════════
   UI STATE HELPERS
══════════════════════════════════════════════════════════════ */

function showLoading() {
    dom.loadingOverlay.classList.add("visible");
    dom.emptyState.classList.remove("visible");
    dom.errorState.classList.remove("visible");
}
function hideLoading() {
    dom.loadingOverlay.classList.remove("visible");
}
function showEmpty() {
    dom.emptyState.classList.add("visible");
    dom.errorState.classList.remove("visible");
}
function showError(msg = "Could not load messages. Check your connection.") {
    dom.errorMessage.textContent = msg;
    dom.errorState.classList.add("visible");
    dom.emptyState.classList.remove("visible");
}
function hideStates() {
    dom.loadingOverlay.classList.remove("visible");
    dom.emptyState.classList.remove("visible");
    dom.errorState.classList.remove("visible");
}

/* ══════════════════════════════════════════════════════════════
   EMOJI PICKER
══════════════════════════════════════════════════════════════ */

/** Populate and wire up the inline emoji picker. */
function initEmojiPicker() {
    EMOJIS.forEach((emoji) => {
        const span = document.createElement("span");
        span.className = "emoji-item";
        span.textContent = emoji;
        span.addEventListener("click", () => {
            insertTextAtCursor(dom.msgInput, emoji);
            dom.emojiDropdown.classList.remove("open");
            dom.msgInput.focus();
            handleInputChange();
        });
        dom.emojiDropdown.appendChild(span);
    });

    dom.emojiBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dom.emojiDropdown.classList.toggle("open");
    });

    document.addEventListener("click", () => {
        dom.emojiDropdown.classList.remove("open");
    });
}

/**
 * Insert text at current cursor position inside a textarea.
 * @param {HTMLTextAreaElement} el
 * @param {string} text
 */
function insertTextAtCursor(el, text) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
}

/* ══════════════════════════════════════════════════════════════
   MESSAGE RENDERING
══════════════════════════════════════════════════════════════ */

/**
 * Build the SVG tick icon for message delivery status.
 * @param {string} status - 'sent' | 'delivered' | 'read' | 'failed'
 * @returns {string} HTML string
 */
function statusIcon(status) {
    if (status === "read") {
        return `<svg viewBox="0 0 18 11" fill="none" style="color:#53bdeb"><path d="M1 5.5l4 4L16 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5.5l4 4L16 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (status === "delivered") {
        return `<svg viewBox="0 0 18 11" fill="none" style="color:#8b949e"><path d="M1 5.5l4 4L16 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5.5l4 4L16 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (status === "failed") {
        return `<svg viewBox="0 0 24 24" fill="none" style="color:#ef4444"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>`;
    }
    // sent / default — single grey tick
    return `<svg viewBox="0 0 18 11" fill="none" style="color:#8b949e"><path d="M1 5.5l4 4L16 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * Build the inner HTML for a single message bubble.
 * Handles: text, image, document, audio, video types.
 * @param {Object} msg - WATI message object
 * @param {string} term - current search term (for highlight)
 * @returns {string} HTML
 */
function buildBubbleContent(msg, term = "") {
    const type = (msg.type || "text").toLowerCase();
    const text = escapeHtml(msg.text || msg.body || "");

    let mediaHtml = "";

    if (type === "image" && msg.data?.url) {
        mediaHtml = `<div class="msg-media"><img src="${msg.data.url}" alt="Image" loading="lazy" /></div>`;
    } else if (["document", "audio", "video"].includes(type) && msg.data?.url) {
        const label = msg.data?.fileName || type;
        mediaHtml = `
      <div class="msg-file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <a href="${msg.data.url}" target="_blank" rel="noopener noreferrer" style="color:inherit;word-break:break-all;">${escapeHtml(label)}</a>
      </div>`;
    }

    // Highlight search term in text
    let displayText = text;
    if (term && text) {
        const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
        displayText = text.replace(re, '<mark class="msg-text highlighted">$1</mark>');
    }

    const textHtml = displayText ? `<div class="msg-text">${displayText}</div>` : "";

    return mediaHtml + textHtml;
}

/**
 * Render all messages (or filtered messages) into the container.
 * Inserts date separators between groups.
 * Preserves scroll position when prepending older messages.
 */
function renderMessages() {
    const messages = state.searchActive ? state.filteredMessages : state.messages;

    if (messages.length === 0) {
        hideStates();
        showEmpty();
        return;
    }

    hideStates();

    // Save scroll info BEFORE clearing (for infinite scroll upward)
    const container = dom.messagesContainer;
    const prevHeight = container.scrollHeight;

    // Clear existing rendered bubbles (not overlays)
    const toRemove = container.querySelectorAll(
        ".message-row, .date-separator, #load-more-btn"
    );
    toRemove.forEach((el) => el.remove());

    // Group messages by day
    let lastDateKey = null;

    // "Load more" button (only shown when not searching)
    if (!state.searchActive && state.hasMore) {
        const btn = document.createElement("button");
        btn.id = "load-more-btn";
        btn.textContent = "Load older messages";
        btn.addEventListener("click", loadMoreMessages);
        container.appendChild(btn);
    }

    const fragment = document.createDocumentFragment();

    messages.forEach((msg) => {
        const ts = msg.created || msg.timestamp || 0;
        const key = dateKey(ts);

        // Date separator
        if (key !== lastDateKey) {
            lastDateKey = key;
            const sep = document.createElement("div");
            sep.className = "date-separator";
            sep.innerHTML = `<span>${formatDateLabel(ts)}</span>`;
            fragment.appendChild(sep);
        }

        // Determine direction
        const isOut = msg.owner === true || msg.localMessageId !== undefined || msg.direction === "out";
        const msgStatus = msg.statusString || msg.status || "sent";

        // Build row
        const row = document.createElement("div");
        row.className = `message-row ${isOut ? "out" : "in"}${msgStatus === "FAILED" ? " failed" : ""}`;
        row.dataset.msgId = msg.id || "";

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.innerHTML =
            buildBubbleContent(msg, state.searchActive ? state.searchTerm : "") +
            `<div class="msg-footer">
        <span class="msg-time">${formatTime(ts)}</span>
        ${isOut ? `<span class="msg-status">${statusIcon(msgStatus)}</span>` : ""}
      </div>`;

        // Retry button for failed messages
        if (msgStatus === "FAILED" && isOut) {
            const retryBtn = document.createElement("button");
            retryBtn.className = "retry-btn";
            retryBtn.textContent = "⟳ Retry";
            retryBtn.addEventListener("click", () => retrySend(msg));
            row.appendChild(retryBtn);
        }

        row.appendChild(bubble);
        fragment.appendChild(row);
    });

    container.appendChild(fragment);

    // Restore scroll: if we loaded older messages, keep user at same position
    if (state.pageNumber > 2 && !state.searchActive) {
        container.scrollTop = container.scrollHeight - prevHeight;
    } else {
        scrollToBottom();
    }
}

/** Smoothly scroll to the most recent message. */
function scrollToBottom() {
    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
}

/* ══════════════════════════════════════════════════════════════
   API CALLS
══════════════════════════════════════════════════════════════ */

/**
 * Fetch a page of messages from the serverless proxy.
 * @param {number} page
 * @returns {Promise<{ messages: Array, hasMore: boolean }>}
 */
async function fetchMessages(page = 1) {
    const url = `${API_BASE}/api/messages?phone=${encodeURIComponent(state.phone)}&pageSize=${state.pageSize}&pageNumber=${page}`;
    const response = await fetch(url);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
    }
    const data = await response.json();

    // WATI returns data.messages.items or data.messages
    const items =
        data?.messages?.items ||
        data?.messages ||
        data?.data?.messages ||
        data?.items ||
        [];

    // Sort oldest → newest
    items.sort((a, b) => (a.created || a.timestamp || 0) - (b.created || b.timestamp || 0));

    const total = data?.messages?.totalPages || data?.totalPages || 1;
    return { messages: items, hasMore: page < total };
}

/**
 * Load the initial (latest) page of messages.
 * Resets state and re-renders.
 */
async function loadMessages() {
    if (!state.phone) return;
    if (state.isLoading) return;

    state.isLoading = true;
    state.retryCount = 0;
    state.pageNumber = 1;
    state.hasMore = true;
    state.messages = [];

    showLoading();
    setConnectionStatus("loading");

    try {
        const { messages, hasMore } = await fetchMessages(1);
        console.log("Loaded Messages =", messages);
console.log("Count =", messages.length);
console.log("Has More =", hasMore);
        state.messages = messages;
        state.hasMore = hasMore;
        state.pageNumber = 1;
        setConnectionStatus("online");
        renderMessages();
    } catch (err) {
        console.error("[loadMessages]", err);
        setConnectionStatus("offline");
        hideLoading();
        showError(err.message || "Could not load messages.");
        showToast("Failed to load messages: " + err.message);
    } finally {
        state.isLoading = false;
    }
}

/**
 * Load older messages (previous page) — prepends to state.messages.
 */
async function loadMoreMessages() {
    if (!state.hasMore || state.isLoading) return;
    state.isLoading = true;
    const nextPage = state.pageNumber + 1;

    try {
        const { messages, hasMore } = await fetchMessages(nextPage);
        // Prepend older messages
        state.messages = [...messages, ...state.messages];
        state.hasMore = hasMore;
        state.pageNumber = nextPage;
        renderMessages();
    } catch (err) {
        showToast("Failed to load older messages: " + err.message);
    } finally {
        state.isLoading = false;
    }
}

/**
 * Send a text message.
 * Immediately renders an optimistic bubble, then confirms via API.
 * @param {string} text - Message text
 */
async function sendMessage(text) {
    if (!state.phone || !text.trim()) return;
    if (state.isSending) return;

    state.isSending = true;
    setSendingUI(true);

    // Optimistic bubble
    const optimisticMsg = {
        id: `opt_${Date.now()}`,
        text: text.trim(),
        created: Math.floor(Date.now() / 1000),
        owner: true,
        statusString: "sent",
    };
    state.messages.push(optimisticMsg);
    renderMessages();

    try {
        const response = await fetch(`${API_BASE}/api/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: state.phone, message: text.trim() }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        showToast("Message sent!", "success");
        // Refresh after short delay to get server-confirmed message
        setTimeout(loadMessages, 1500);
    } catch (err) {
        console.error("[sendMessage]", err);
        // Mark optimistic message as failed
        const idx = state.messages.findIndex((m) => m.id === optimisticMsg.id);
        if (idx !== -1) state.messages[idx].statusString = "FAILED";
        renderMessages();
        showToast("Send failed: " + err.message);
    } finally {
        state.isSending = false;
        setSendingUI(false);
    }
}

/**
 * Retry sending a failed message.
 * @param {Object} originalMsg
 */
async function retrySend(originalMsg) {
    // Remove failed message from state and resend
    state.messages = state.messages.filter((m) => m.id !== originalMsg.id);
    await sendMessage(originalMsg.text || "");
}

/**
 * Send a WhatsApp template message.
 * @param {string} templateName
 * @param {string} broadcastName
 * @param {Array<{name,value}>} parameters
 */
async function sendTemplateMessage(templateName, broadcastName, parameters) {
    if (!state.phone) return;

    try {
        const response = await fetch(`${API_BASE}/api/template`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone: state.phone,
                templateName,
                broadcastName,
                parameters,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        showToast("Template message sent!", "success");
        setTimeout(loadMessages, 2000);
    } catch (err) {
        showToast("Template send failed: " + err.message);
    }
}

/* ══════════════════════════════════════════════════════════════
   SEND UI
══════════════════════════════════════════════════════════════ */

function setSendingUI(sending) {
    dom.sendBtn.disabled = sending;
    dom.sendBtn.classList.toggle("sending", sending);
}

function handleInputChange() {
    // Auto-resize textarea
    dom.msgInput.style.height = "auto";
    dom.msgInput.style.height = Math.min(dom.msgInput.scrollHeight, 120) + "px";
    // Enable / disable send button
    dom.sendBtn.disabled = dom.msgInput.value.trim().length === 0 || state.isSending;
}

/* ══════════════════════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════════════════════ */

/**
 * Filter messages by search term (client-side).
 * @param {string} term
 */
function searchMessages(term) {
    state.searchTerm = term;
    if (!term.trim()) {
        state.searchActive = false;
        state.filteredMessages = [];
    } else {
        state.searchActive = true;
        const lower = term.toLowerCase();
        state.filteredMessages = state.messages.filter(
            (m) => (m.text || m.body || "").toLowerCase().includes(lower)
        );
    }
    renderMessages();
}

/* ══════════════════════════════════════════════════════════════
   ZOHO CRM SDK INTEGRATION
══════════════════════════════════════════════════════════════ */

/**
 * Initialise the Zoho Embedded App SDK and read Lead details.
 * Falls back gracefully if running outside Zoho (e.g. during local dev).
 */
async function initZoho() {
    // Apply persisted theme
    const savedTheme = localStorage.getItem("wati_theme") || "dark";
    applyTheme(savedTheme);

    // Populate emoji picker
    initEmojiPicker();

    // Wire up static event listeners
    bindEvents();

    // Try to init Zoho SDK
    if (typeof ZOHO === "undefined" || !ZOHO?.embeddedApp) {
        console.warn("[initZoho] ZOHO SDK not available. Running in standalone mode.");
        setContactInfo("Test Lead", "Test Contact", "910000000000");
        await loadMessages();
        return;
    }

    ZOHO.embeddedApp.on("PageLoad", async function (data) {
    console.log("========== PAGE LOAD ==========");
    console.log("PageLoad Data:", data);

    try {

        const entity = data?.EntityName || "";
        const entityId = data?.EntityId || "";

        console.log("Entity:", entity);
        console.log("Entity ID:", entityId);

        if (!entityId) {
            console.error("Entity ID கிடைக்கவில்லை");
            showError("No Lead is currently open. Please open a Lead record.");
            return;
        }

        const leadData = await ZOHO.CRM.API.getRecord({
            Entity: entity || "Leads",
            RecordID: entityId,
        });

        console.log("Lead API Response:", leadData);

        const lead = leadData?.data?.[0] || {};

        console.log("Lead Record:", lead);

        const leadName =
            lead.Full_Name ||
            lead.Last_Name ||
            lead.Company ||
            "Unknown Lead";

        const whatsapp =
            lead.WhatsApp_No ||
            lead.Mobile ||
            lead.Phone ||
            "";

        const phone = sanitisePhone(whatsapp);

        console.log("Phone:", phone);

        if (!phone) {
            console.error("Phone Number இல்லை");
            setContactInfo(leadName, "", "");
            showError("No phone number found on this Lead.");
            return;
        }

        setContactInfo(leadName, phone, phone);

        console.log("Loading Messages...");

        await loadMessages();

        console.log("Messages Loaded");

       } catch (err) {

        console.error("PageLoad ERROR:", err);

        showError(err.message || "Failed to read Lead");

    }
});

ZOHO.embeddedApp.init();

}

/**
 * Update the header UI with contact details and set state.phone.
 * @param {string} name
 * @param {string} displayPhone  - Formatted for display
 * @param {string} rawPhone      - Used for API calls
 */
function setContactInfo(name, displayPhone, rawPhone) {
    state.phone = sanitisePhone(rawPhone);
    state.leadName = name;

    dom.contactName.textContent = name;
    dom.contactPhone.textContent = displayPhone ? `+${state.phone}` : "";
    dom.avatar.textContent = (name || "?").charAt(0).toUpperCase();
}

/* ══════════════════════════════════════════════════════════════
   EVENT BINDING
══════════════════════════════════════════════════════════════ */

function bindEvents() {
    // Refresh
    dom.refreshBtn.addEventListener("click", () => loadMessages());

    // Error state retry
    dom.errorRetryBtn.addEventListener("click", () => loadMessages());

    // Theme toggle
    dom.themeBtn.addEventListener("click", toggleTheme);

    // Search toggle
    dom.searchBtn.addEventListener("click", () => {
        dom.searchBar.classList.toggle("visible");
        if (dom.searchBar.classList.contains("visible")) {
            dom.searchInput.focus();
        } else {
            dom.searchInput.value = "";
            searchMessages("");
        }
    });

    // Search input
    dom.searchInput.addEventListener("input", (e) => searchMessages(e.target.value));

    // Message input
    dom.msgInput.addEventListener("input", handleInputChange);
    dom.msgInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitMessage();
        }
    });

    // Send button
    dom.sendBtn.addEventListener("click", submitMessage);

    // Template button
    dom.templateBtn.addEventListener("click", () => {
        dom.templateModal.classList.add("open");
    });

    // Template modal cancel
    dom.tmplCancelBtn.addEventListener("click", closeTemplateModal);

    // Template modal send
    dom.tmplSendBtn.addEventListener("click", async () => {
        const name = dom.tmplName.value.trim();
        const broadcast = dom.tmplBroadcast.value.trim();
        const paramsRaw = dom.tmplParams.value.trim();

        if (!name || !broadcast) {
            showToast("Template name and broadcast name are required.");
            return;
        }

        // Parse "key=value, key2=value2" into [{name, value}]
        const parameters = paramsRaw
            ? paramsRaw.split(",").map((p) => {
                const [k, ...rest] = p.split("=");
                return { name: k.trim(), value: rest.join("=").trim() };
            }).filter((p) => p.name)
            : [];

        closeTemplateModal();
        await sendTemplateMessage(name, broadcast, parameters);
    });

    // Close modal on backdrop click
    dom.templateModal.addEventListener("click", (e) => {
        if (e.target === dom.templateModal) closeTemplateModal();
    });

    // Escape key closes modal / search
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeTemplateModal();
            dom.searchBar.classList.remove("visible");
            searchMessages("");
        }
    });
}

function submitMessage() {
    const text = dom.msgInput.value.trim();
    if (!text || state.isSending) return;
    dom.msgInput.value = "";
    dom.msgInput.style.height = "auto";
    dom.sendBtn.disabled = true;
    sendMessage(text);
}

function closeTemplateModal() {
    dom.templateModal.classList.remove("open");
    dom.tmplName.value = "";
    dom.tmplBroadcast.value = "";
    dom.tmplParams.value = "";
}

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */

// Kick off initialisation when the DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initZoho);
} else {
    initZoho();
}
