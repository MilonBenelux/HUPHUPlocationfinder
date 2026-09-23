const axios = require("axios");

// Belgian postal codes are 4 digits (e.g. "1450"). Change this if you ever
// need to support more than one country's postal codes.
const COUNTRY_CODE = "be";

/**
 * Resolves a Belgian postal code to {lat, lng} using the free Zippopotam.us
 * API (no API key required). Swap this out for Google/Mapbox geocoding if
 * you need multiple countries or better accuracy.
 */
async function geocodeZip(zip) {
  const cleanZip = String(zip).trim().slice(0, 4);
  if (!/^\d{4}$/.test(cleanZip)) {
    throw new Error(`"${zip}" is not a valid 4-digit Belgian postal code`);
  }

  const { data } = await axios.get(
    `https://api.zippopotam.us/${COUNTRY_CODE}/${cleanZip}`,
    { timeout: 5000 }
  );

  const place = data.places && data.places[0];
  if (!place) {
    throw new Error(`No coordinates found for ZIP ${cleanZip}`);
  }

  return {
    lat: parseFloat(place.latitude),
    lng: parseFloat(place.longitude),
    city: place["place name"],
    state: place["state abbreviation"],
  };
}

module.exports = { geocodeZip };
