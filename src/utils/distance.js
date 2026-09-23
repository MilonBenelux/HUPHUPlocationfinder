const EARTH_RADIUS_MILES = 3958.8;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/lng points, in miles.
 */
function haversineMiles(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

/**
 * Given an origin {lat, lng} and a list of locations each with {lat, lng},
 * returns the full list sorted nearest-first, each annotated with distanceMiles.
 */
function rankByDistance(origin, locations) {
  return locations
    .map((loc) => ({
      ...loc,
      distanceMiles: Math.round(
        haversineMiles(origin.lat, origin.lng, loc.lat, loc.lng) * 10
      ) / 10,
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

module.exports = { haversineMiles, rankByDistance };
