'use strict';

/**
 * Current-weather helper backed by Open-Meteo (free, no API key).
 * https://open-meteo.com/en/docs
 */

// WMO weather interpretation codes -> short spoken description.
// https://open-meteo.com/en/docs (see "Weather variable documentation").
const WMO = {
  0: 'clear',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'foggy',
  48: 'foggy',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  56: 'freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'showers',
  82: 'heavy showers',
  85: 'snow showers',
  86: 'snow showers',
  95: 'a thunderstorm',
  96: 'a thunderstorm with hail',
  99: 'a thunderstorm with hail',
};

function describeCode(code) {
  return WMO[code] || 'unknown conditions';
}

/**
 * Fetch current weather for a coordinate.
 * @param {number} latitude
 * @param {number} longitude
 * @param {object} [opts]
 * @param {'fahrenheit'|'celsius'} [opts.unit="fahrenheit"]
 * @param {number} [opts.timeout=8000]
 * @returns {Promise<{temperature:number, unitSymbol:string, description:string, code:number}>}
 */
async function getCurrent(latitude, longitude, opts = {}) {
  const unit = opts.unit === 'celsius' ? 'celsius' : 'fahrenheit';
  const timeout = opts.timeout ?? 8000;

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code',
    temperature_unit: unit,
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Weather request failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const cur = data.current || {};
    return {
      temperature: Math.round(cur.temperature_2m),
      unitSymbol: unit === 'celsius' ? 'C' : 'F',
      description: describeCode(cur.weather_code),
      code: cur.weather_code,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getCurrent, describeCode };
