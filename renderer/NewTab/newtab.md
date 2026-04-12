# renderer/NewTab/newtab.js

## Purpose

Renderer script for the new-tab page. Displays a live clock, a time-based greeting, today's date, current weather (via Open-Meteo API + geolocation), and a search bar. The clock and greeting update every minute. Weather fetches from GPS coordinates; falls back to IP-based geolocation via `ipapi.co`.

---

## Module-level Constants

| Constant | Type | Purpose |
|---|---|---|
| `GREETINGS` | `object` | Maps time-of-day period → array of greeting strings |
| `GREETING_RANGES` | `object` | Maps period name → array of hours (24-hr) that belong to it |
| `WEATHER_ICONS` | `object` | Maps weather condition keyword → emoji |

---

## Functions

### `getGreetingForHour(hour)`
Returns a random greeting string appropriate for the given hour.
- **`hour`** — `number` — current hour (0–23)
- **Returns** `string`

### `formatTime(date)`
Formats a `Date` as `HH:MM` (24-hour, zero-padded).
- **Returns** `string`

### `formatDate(date)`
Formats a `Date` as `DAY, MONTH DATE` (e.g. `MONDAY, APRIL 7`).
- **Returns** `string`

### `updateTimeAndGreeting()`
Reads the current time, updates `#time-display`, `#greeting-text`, and `#date-display`. Called on load and every 60 seconds.

### `getWeatherIcon(description)`
Maps a weather condition description to an emoji by checking for keywords in `WEATHER_ICONS`.
- **Returns** `string` — emoji, or `⛅` as default

### `fetchWeatherData(lat, lon)`
Fetches current temperature and weather code from Open-Meteo (no API key required). Updates `#weather-temp` and `#weather-icon`.
- **`lat`**, **`lon`** — `number` — coordinates

### `initializeWeather()`
Requests GPS position via `navigator.geolocation`. On success calls `fetchWeatherData`; on failure falls back to `fetchWeatherByIP`.

### `fetchWeatherByIP()`
Fetches coordinates from `ipapi.co/json/` and calls `fetchWeatherData`. Also sets `#weather-location` to the city + country code.

---

## Initialization (`DOMContentLoaded`)

1. Calls `updateTimeAndGreeting()` and `initializeWeather()`
2. Sets a 60-second interval for `updateTimeAndGreeting`
3. Registers a `window.electronAPI.windowClick` forwarder
4. Registers a `keydown` Enter handler on `.search-input`

### `handleSearch(query)` *(local)*
Determines whether the search query is a URL, a bare domain, or a search term, then navigates via `window.location.href`.
- If starts with `http://` or `https://` → used as-is
- If contains `.` and no spaces → prepended with `https://`
- Otherwise → `https://www.google.com/search?q=...`
