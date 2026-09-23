const EARTH_RADIUS_KM = 6371.0;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/lng points, in kilometers.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM  * c;
}

/**
 * Given an origin {lat, lng} and a list of locations each with {lat, lng},
 * returns the full list sorted nearest-first, each annotated with distanceKm.
 */
function rankByDistance(origin, locations) {
  return locations
    .map((loc) => ({
      ...loc,
      distanceKm: Math.round(
        haversineKm(origin.lat, origin.lng, loc.lat, loc.lng) * 10
      ) / 10,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

module.exports = { haversineKm, rankByDistance };
