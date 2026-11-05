const express = require("express");
const axios = require("axios");
const { saveTokens, getTokens } = require("../store/tokenStore");

const router = express.Router();

const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

/**
 * Step 2-5 of the OAuth flow (see README): GHL redirects the installing
 * user here with ?code=... after they approve the app on
 * marketplace.gohighlevel.com. We exchange that code for an
 * access_token + refresh_token scoped to their location (sub-account).
 */
router.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("Missing ?code from GoHighLevel.");
  }

  try {
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        client_id: process.env.GHL_CLIENT_ID,
        client_secret: process.env.GHL_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        user_type: "Location",
        redirect_uri: process.env.GHL_REDIRECT_URI,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    // data includes access_token, refresh_token, expires_in, locationId, etc.
    console.log(
      `OAuth install: userType=${data.userType} locationId=${data.locationId} companyId=${data.companyId} scopes=${data.scope}`
    );
    if (!data.locationId) {
      console.error(
        "OAuth install returned no locationId (agency-level install?) — token NOT usable for workflow actions."
      );
    }
    saveTokens(data.locationId, data);

    res.send(
      "App installed successfully. You can close this tab and go back to GoHighLevel."
    );
  } catch (err) {
    console.error("OAuth callback failed:", err.response?.data || err.message);
    res.status(500).send("Failed to complete installation. Check server logs.");
  }
});

/**
 * Returns a valid access token for a location, refreshing it first if
 * the stored token is close to (or past) expiry.
 */
// Fallback: Private Integration tokens per location, kept in the Render
// env var LOCATION_TOKENS as JSON: {"<locationId>":"pit-...", ...}.
// Env vars survive deploys/restarts, unlike the tokens.json file.
function getPrivateIntegrationToken(locationId) {
  const raw = process.env.LOCATION_TOKENS;
  if (!raw) return null;
  try {
    return JSON.parse(raw)[locationId] || null;
  } catch (err) {
    console.error("LOCATION_TOKENS is not valid JSON:", err.message);
    return null;
  }
}

async function getValidAccessToken(locationId) {
  const tokens = getTokens(locationId);
  if (!tokens) {
    const pit = getPrivateIntegrationToken(locationId);
    if (pit) return pit;
    throw new Error(
      `No stored tokens for location ${locationId} — has the app been installed on this sub-account?`
    );
  }

  const ageSeconds = (Date.now() - tokens.savedAt) / 1000;
  const isExpiringSoon = ageSeconds > tokens.expires_in - 60;

  if (!isExpiringSoon) {
    return tokens.access_token;
  }

  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      user_type: "Location",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  saveTokens(locationId, data);
  return data.access_token;
}

module.exports = { router, getValidAccessToken };
