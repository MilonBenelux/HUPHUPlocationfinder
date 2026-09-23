const express = require("express");
const axios = require("axios");
const { geocodeZip } = require("../utils/geocode");
const { rankByDistance } = require("../utils/distance");
const locations = require("../config/locations");
const { getValidAccessToken } = require("./oauth");

const router = express.Router();

// Verifies the shared-secret header you configure in the marketplace UI's
// "Headers" field for this action, so random internet traffic can't hit
// your endpoint and pretend to be GHL.
function verifyActionSecret(req, res, next) {
  const provided = req.header("x-action-secret");
  if (!process.env.ACTION_SHARED_SECRET || provided !== process.env.ACTION_SHARED_SECRET) {
    return res.status(401).json({ error: "Invalid or missing action secret" });
  }
  next();
}

/**
 * Writes the nearest location back onto the contact as a custom field,
 * so later workflow steps / conditions can branch on it. Requires
 * GHL_NEAREST_LOCATION_FIELD_KEY to be set and the custom field to
 * already exist on the location (Settings -> Custom Fields).
 */
async function writeNearestLocationToContact({ locationId, contactId, nearest }) {
  const fieldKey = process.env.GHL_NEAREST_LOCATION_FIELD_KEY;
  if (!fieldKey || !contactId) return;

  const accessToken = await getValidAccessToken(locationId);

  await axios.put(
    `https://services.leadconnectorhq.com/contacts/${contactId}`,
    {
      customFields: [{ key: fieldKey, field_value: nearest.name }],
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
    }
  );
}

/**
 * This is the "URL (POST)" endpoint you paste into the Custom Workflow
 * Action config in the marketplace UI. GHL calls it with:
 *   { data: { zip_code: "..." }, extras: { locationId, contactId, workflowId }, meta: {...} }
 * See README for how the action's input fields are defined.
 */
router.post("/actions/nearest-location", verifyActionSecret, async (req, res) => {
  try {
    console.log("Incoming payload:", JSON.stringify(req.body));

    const body = req.body || {};
    // GHL's documented production payload nests fields under "data" (with
    // "extras" alongside it for locationId/contactId/workflowId). The
    // marketplace's built-in test screen, however, sends fields flat at
    // the top level with no "extras" at all. Support both shapes.
    const data = body.data || body;
    const extras = body.extras || {};
    const zip = data.zip_code;
    const { locationId, contactId } = extras;

    if (!zip) {
      return res.status(400).json({ error: "data.zip_code is required" });
    }


    const origin = await geocodeZip(zip);
    const ranked = rankByDistance(origin, locations);
    const nearest = ranked[0];

    if (process.env.GHL_NEAREST_LOCATION_FIELD_KEY) {
      try {
        await writeNearestLocationToContact({ locationId, contactId, nearest });
      } catch (writeErr) {
        // Don't fail the whole action just because the writeback failed —
        // log it and still return the computed result to the workflow.
        console.error(
          "Failed to write nearest location to contact:",
          writeErr.response?.data || writeErr.message
        );
      }
    }

    return res.status(200).json({
      success: true,
      zip,
      origin,
      nearestLocation: {
        id: nearest.id,
        name: nearest.name,
        address: nearest.address,
        distanceMiles: nearest.distanceMiles,
      },
      allRanked: ranked.map((loc) => ({
        id: loc.id,
        name: loc.name,
        distanceMiles: loc.distanceMiles,
      })),
    });
  } catch (err) {
    console.error("nearest-location action failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
