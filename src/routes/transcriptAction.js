// Custom workflow action "Get Conversation Transcript" (key: get_transcript).
//
// Fetches the messages (all channels except e-mail) of the contact's conversation(s) from a start moment
// onwards and returns them as one readable text block, so later workflow
// steps (AI, e-mail, internal notification, custom field) can use it.
//
// Inputs (data.*), both optional:
//   days        number of days back (e.g. 7)
//   since_date  start date: YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY or ISO.
//               Takes precedence over "days" when filled in.
//   max_chars   optional cap on the transcript length (default 10000)
// Neither filled in -> DEFAULT_DAYS.
//
// Required app scopes: conversations.readonly, conversations/message.readonly

const DEFAULT_DAYS = 30;
const DEFAULT_MAX_CHARS = 10000;
const MAX_PAGES = 20; // 20 x 100 messages per conversation, safety stop
const TIMEZONE = "Europe/Brussels";
const LABEL_INBOUND = "Klant";
const LABEL_OUTBOUND = "HUPHUP";
const DIR_INBOUND = "IN";   // shown in each line: incoming message
const DIR_OUTBOUND = "UIT"; // outgoing message

const express = require("express");
const axios = require("axios");
const { getValidAccessToken } = require("./oauth");

const router = express.Router();
const API = "https://services.leadconnectorhq.com";

function verifyActionSecret(req, res, next) {
  const provided = req.header("x-action-secret");
  if (!process.env.ACTION_SHARED_SECRET || provided !== process.env.ACTION_SHARED_SECRET) {
    return res.status(401).json({ error: "Invalid or missing action secret" });
  }
  next();
}

// ---------- dates ----------

// Offset (ms) of TIMEZONE relative to UTC at a given moment.
function tzOffsetMs(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

// Midnight (Brussels time) of the given calendar day, as a Date.
function brusselsMidnight(y, m, d) {
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - tzOffsetMs(guess));
}

function parseSinceDate(input) {
  const s = String(input).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return brusselsMidnight(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return brusselsMidnight(+m[3], +m[2], +m[1]);
  const d = new Date(s); // ISO with time, or epoch-ish strings
  if (/^\d+$/.test(s)) return new Date(+s < 1e12 ? +s * 1000 : +s);
  return isNaN(d) ? null : d;
}

function resolveSince(data) {
  if (data.since_date !== undefined && String(data.since_date).trim() !== "") {
    const d = parseSinceDate(data.since_date);
    if (!d) return { error: `"${data.since_date}" is not a valid date. Use YYYY-MM-DD or DD-MM-YYYY.` };
    return { since: d };
  }
  let days = DEFAULT_DAYS;
  if (data.days !== undefined && String(data.days).trim() !== "") {
    days = Number(String(data.days).replace(",", "."));
    if (!isFinite(days) || days < 0) return { error: `"${data.days}" is not a valid number of days.` };
  }
  return { since: new Date(Date.now() - days * 86400000) };
}

const fmtDateTime = new Intl.DateTimeFormat("nl-BE", {
  timeZone: TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit",
});
const formatDate = (d) => fmtDateTime.format(d).replace(",", "");

// ---------- messages ----------

const CHANNELS = {
  TYPE_SMS: "SMS",
  TYPE_WHATSAPP: "WhatsApp",
  TYPE_FACEBOOK: "Messenger",
  TYPE_INSTAGRAM: "Instagram",
  TYPE_LIVE_CHAT: "Chat",
  TYPE_WEBCHAT: "Chat",
  TYPE_GMB: "Google",
  TYPE_CALL: "Oproep",
  TYPE_IVR_CALL: "Oproep",
  TYPE_CUSTOM_SMS: "SMS",
  TYPE_CUSTOM_PROVIDER_SMS: "SMS",
};

// E-mails are left out of the transcript.
function isEmail(msg) {
  const type = msg.messageType || "";
  return type.includes("EMAIL") || !!msg.meta?.email;
}

function cleanBody(body) {
  return String(body || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toLine(msg) {
  const type = msg.messageType || "";
  if (type.startsWith("TYPE_ACTIVITY")) return null; // system/activity entries
  if (isEmail(msg)) return null;
  const channel = CHANNELS[type];
  let text = cleanBody(msg.body);
  if (!text && channel === "Oproep") text = `(oproep${msg.meta?.call?.duration ? `, ${msg.meta.call.duration}s` : ""})`;
  if (!text && msg.attachments?.length) text = `(bijlage: ${msg.attachments.length})`;
  if (!text) return null;
  const inbound = msg.direction === "inbound";
  const who = inbound ? LABEL_INBOUND : LABEL_OUTBOUND;
  const dir = inbound ? DIR_INBOUND : DIR_OUTBOUND;
  const date = new Date(msg.dateAdded);
  return {
    date,
    direction: inbound ? "inbound" : "outbound",
    text: `[${formatDate(date)}${channel ? ` · ${channel}` : ""} · ${dir}] ${who}: ${text}`,
  };
}

async function ghlGet(path, accessToken, params) {
  const { data } = await axios.get(`${API}${path}`, {
    params,
    headers: { Authorization: `Bearer ${accessToken}`, Version: "2021-04-15", Accept: "application/json" },
  });
  return data;
}

async function fetchMessagesSince(conversationId, since, accessToken) {
  const out = [];
  let lastMessageId;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await ghlGet(`/conversations/${conversationId}/messages`, accessToken, {
      limit: 100,
      ...(lastMessageId ? { lastMessageId } : {}),
    });
    const block = res.messages || {};
    const msgs = block.messages || [];
    let reachedOlder = false;
    for (const m of msgs) {
      if (new Date(m.dateAdded) < since) { reachedOlder = true; continue; }
      out.push(m);
    }
    if (reachedOlder || !block.nextPage || !msgs.length) break;
    lastMessageId = block.lastMessageId || msgs[msgs.length - 1].id;
  }
  return out;
}

// ---------- endpoint ----------

router.post("/actions/get-transcript", verifyActionSecret, async (req, res) => {
  try {
    console.log("get-transcript payload:", JSON.stringify(req.body));
    const body = req.body || {};
    const data = body.data || body;
    const extras = body.extras || {};
    const locationId = extras.locationId || data.locationId || data.location_id;
    const contactId = extras.contactId || data.contactId || data.contact_id;

    if (!locationId || !contactId) {
      return res.status(200).json({
        success: false,
        error: "required_value_missing",
        message: "locationId and contactId are required (sent by GHL in extras).",
        transcript: "",
        message_count: 0,
      });
    }

    const { since, error } = resolveSince(data);
    if (error) {
      return res.status(200).json({ success: false, error: "invalid_format", message: error, transcript: "", message_count: 0 });
    }
    const maxChars = Number(data.max_chars) > 0 ? Number(data.max_chars) : DEFAULT_MAX_CHARS;

    const accessToken = await getValidAccessToken(locationId);
    const search = await ghlGet("/conversations/search", accessToken, { locationId, contactId });
    const conversations = search.conversations || [];

    let messages = [];
    for (const c of conversations) {
      messages.push(...(await fetchMessagesSince(c.id, since, accessToken)));
    }

    const lines = messages
      .map(toLine)
      .filter(Boolean)
      .sort((a, b) => a.date - b.date);

    // Over the limit: keep the most recent messages, drop the oldest.
    let truncated = false;
    let kept = lines;
    let total = lines.reduce((n, l) => n + l.text.length + 1, 0);
    while (total > maxChars && kept.length > 1) {
      total -= kept[0].text.length + 1;
      kept = kept.slice(1);
      truncated = true;
    }
    let transcript = kept.map((l) => l.text).join("\n");
    if (transcript.length > maxChars) transcript = transcript.slice(-maxChars);
    if (truncated) transcript = `(… ${lines.length - kept.length} oudere berichten weggelaten)\n` + transcript;

    const responseData = {
      success: true,
      transcript,
      message_count: kept.length,
      total_message_count: lines.length,
      inbound_count: kept.filter((l) => l.direction === "inbound").length,
      outbound_count: kept.filter((l) => l.direction === "outbound").length,
      last_direction: kept.length ? kept[kept.length - 1].direction : "",
      truncated,
      conversation_id: conversations[0]?.id || "",
      since: since.toISOString(),
      first_message_date: kept[0] ? kept[0].date.toISOString() : "",
      last_message_date: kept.length ? kept[kept.length - 1].date.toISOString() : "",
    };
    console.log("get-transcript result:", JSON.stringify({ ...responseData, transcript: `${transcript.length} chars` }));
    return res.status(200).json(responseData);
  } catch (err) {
    const status = err.response?.status;
    console.error("get-transcript failed:", status, err.response?.data || err.message);
    const message =
      status === 401 || status === 403
        ? "No access to conversations — add the scopes conversations.readonly and conversations/message.readonly to the app and reinstall it on this location."
        : err.message;
    return res.status(200).json({ success: false, error: "api_error", message, transcript: "", message_count: 0 });
  }
});

module.exports = router;
module.exports._test = { parseSinceDate, resolveSince, toLine, cleanBody };
