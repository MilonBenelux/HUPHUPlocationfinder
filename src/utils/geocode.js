const axios = require("axios");

/**
 * Resolves a US ZIP code to {lat, lng} using the free Zippopotam.us API
 * (no API key required). Swap this out for Google/Mapbox geocoding if you
 * need non-US postal codes or better accuracy.
 */
async function geocodeZip(zip) {
  const cleanZip = String(zip).trim().slice(0, 5);
  if (!/^\d{5}$/.test(cleanZip)) {
    throw new Error(`"${zip}" is not a valid 5-digit US ZIP code`);
  }

  const { data } = await axios.get(`https://api.zippopotam.us/us/${cleanZip}`, {
    timeout: 5000,
  });

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
