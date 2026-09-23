# GHL Nearest Location

A GoHighLevel Marketplace app that adds a **custom workflow action** —
"Find Nearest Location" — which takes a ZIP code, geocodes it, and returns
whichever of your 15 fixed locations is closest (by straight-line distance).
Optionally writes the result onto the contact as a custom field so later
workflow steps/conditions can branch on it.

## How it fits together

- `src/index.js` — Express server
- `src/routes/oauth.js` — OAuth2 install flow (exchanges the install code for
  an access/refresh token per sub-account, stores it)
- `src/routes/workflowAction.js` — the endpoint GHL calls when the action
  fires in a workflow
- `src/config/locations.js` — your 15 locations (**fill in your real
  lat/lng values here** — you said you already have them)
- `src/utils/distance.js` — haversine distance, ranks all 15 by distance
- `src/utils/geocode.js` — ZIP → lat/lng via the free Zippopotam.us API
  (US ZIPs only; swap in Google/Mapbox geocoding if you need other countries
  or tighter accuracy)
- `src/store/tokenStore.js` — flat-file token storage. **Replace with a real
  database before production** — see the comment in that file.

## 1. Fill in your locations

Edit `src/config/locations.js` and replace the placeholder rows with your
15 real `name`, `address`, `lat`, `lng` values.

## 2. Deploy the server

Deploy this to anything that gives you a public HTTPS URL (Render, Fly.io,
Railway, a VPS behind a reverse proxy, etc.). Set the environment variables
from `.env.example`. Locally:

```bash
npm install
cp .env.example .env   # fill in the values
npm start
```

## 3. Register the app on the Marketplace

1. Go to https://marketplace.gohighlevel.com/ and sign in / create a
   developer account.
2. Create a new app. Under its settings, note the **Client ID** and
   **Client Secret** → put these in `.env` as `GHL_CLIENT_ID` /
   `GHL_CLIENT_SECRET`.
3. Set **Redirect URI** to `https://<your-domain>/oauth/callback` — must
   match `GHL_REDIRECT_URI` exactly.
4. Under **Scopes**, enable:
   - `contacts.readonly` and `contacts.write` (only needed if you want the
     writeback-to-contact feature)
   - `workflows.readonly` (required for marketplace workflow actions)
5. Choose **distribution type**: "Sub-Account" (single-location) or
   "Agency" (so it can be installed across multiple sub-accounts) depending
   on how you plan to use it.

## 4. Create the Custom Workflow Action

In your app's dashboard, under **Modules → Workflow → Create Action**:

- **Name**: `Find Nearest Location`
- **Key**: `nearest_location` (immutable — pick carefully)
- **Input fields**, add one field:
  - `field`: `zip_code`, `title`: "ZIP Code", `fieldType`: `string`,
    `required`: true
  - (Optional) add a **Hidden** field type to auto-pass `contactId` /
    `locationId` from workflow context if you want them available — GHL
    already sends these in `extras` on every execution, so this is
    usually unnecessary.
- **URL (POST)**: `https://<your-domain>/actions/nearest-location`
- **Headers**: add `x-action-secret: <the value you put in
  ACTION_SHARED_SECRET>` — this is how the endpoint verifies the request
  really came from GHL.

GHL will POST a payload shaped like this when the action runs:

```json
{
  "data": { "zip_code": "62704" },
  "extras": { "locationId": "loc_abc123", "contactId": "contact_xyz789", "workflowId": "wf_def456" },
  "meta": { "key": "nearest_location", "version": "1.0" }
}
```

and the endpoint responds with the ranked list and the winner:

```json
{
  "success": true,
  "zip": "62704",
  "nearestLocation": { "id": "loc-01", "name": "Location 1", "distanceMiles": 4.2 },
  "allRanked": [ { "id": "loc-01", "name": "Location 1", "distanceMiles": 4.2 }, "..." ]
}
```

> **Note on billing:** Marketplace Custom Workflow Actions run through
> GHL's "LC Premium Triggers & Actions" and are billed per execution. Each
> sub-account that wants to use the action needs that enabled/rebilled for
> them — see GHL's marketplace docs for current pricing.

## 5. If you want the writeback-to-contact feature

1. In the target sub-account, go to **Settings → Custom Fields** and create
   a text field (e.g. `Nearest Location`). Note its **field key**.
2. Set `GHL_NEAREST_LOCATION_FIELD_KEY` in `.env` to that key and restart
   the server.
3. Leave it blank if you don't want this — the action still returns the
   result to the workflow either way, so you can also just use a
   **Condition/If-Else** step on the action's output instead of a contact
   field.

## 6. Install and test

1. From your app's marketplace listing, click Install on a test sub-account
   — this redirects through `/oauth/callback`, which stores that
   location's tokens.
2. Open a workflow in that sub-account, add an action, and you should now
   see "Find Nearest Location" listed (only sub-accounts with the app
   installed can see its actions).
3. Trigger the workflow with a contact/ZIP to confirm it returns the
   expected nearest location.

## Notes / things you'll likely want to change

- `geocode.js` uses Zippopotam.us, which is free but US-only and has no
  official uptime SLA — fine for prototyping, consider Google/Mapbox
  Geocoding API (with an API key) for production reliability.
- `tokenStore.js` is a flat JSON file — fine for local testing, but swap
  in a real database (and encrypt tokens at rest) before installing this
  on real customer sub-accounts.
- `distance.js` uses straight-line (haversine) distance, not actual
  drive-time/drive-distance. If you need real routing distance, call a
  directions API (Google Directions, Mapbox Directions) for the
  candidate locations instead — usually fine to just do this for the
  top 3-5 haversine-nearest to keep API calls low.
