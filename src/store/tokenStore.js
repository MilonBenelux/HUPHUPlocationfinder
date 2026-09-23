const fs = require("fs");
const path = require("path");

// Reference implementation only: tokens are kept in a local JSON file.
// Swap this for a real database (Postgres/Mongo/etc.) before going to
// production — a flat file will not survive redeploys on most hosts and
// will not scale across multiple server instances.
const DB_PATH = path.join(__dirname, "tokens.json");

function readAll() {
  if (!fs.existsSync(DB_PATH)) return {};
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeAll(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function saveTokens(locationId, tokens) {
  const all = readAll();
  all[locationId] = {
    ...tokens,
    savedAt: Date.now(),
  };
  writeAll(all);
}

function getTokens(locationId) {
  const all = readAll();
  return all[locationId] || null;
}

module.exports = { saveTokens, getTokens };
