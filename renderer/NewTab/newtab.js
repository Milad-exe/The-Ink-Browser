// Greeting data based on time of day
const GREETINGS = {
  night: ['Good night', 'Sleep well'],
  morning: ['Good morning', 'Rise and shine', 'Have a great day'],
  afternoon: ['Good afternoon', 'Afternoon, friend'],
  evening: ['Good evening', 'Hope you\'re having a good day']
};

// Time-based greeting selection (hours in 24-hr format)
const GREETING_RANGES = {
  night: [0, 1, 2, 3, 4, 5],          // 12 AM - 5 AM
  morning: [6, 7, 8, 9, 10, 11],      // 6 AM - 11 AM
  afternoon: [12, 13, 14, 15, 16, 17], // 12 PM - 5 PM
  evening: [18, 19, 20, 21, 22, 23]   // 6 PM - 11 PM
};

// Weather condition emoji mapping
const WEATHER_ICONS = {
  'clear': '☀️',
  'sunny': '☀️',
  'cloud': '☁️',
  'cloudy': '☁️',
  'rain': '🌧️',
  'rainy': '🌧️',
  'snow': '❄️',
  'snowy': '❄️',
  'wind': '💨',
  'windy': '💨',
  'storm': '⛈️',
  'thunderstorm': '⛈️',
  'fog': '🌫️',
  'mist': '🌫️',
  'default': '⛅'
};

// Get greeting based on hour
function getGreetingForHour(hour) {
  let period;
  for (const [key, hours] of Object.entries(GREETING_RANGES)) {
    if (hours.includes(hour)) {
      period = key;
      break;
    }
  }

  const greetings = GREETINGS[period] || GREETINGS.afternoon;
  return greetings[Math.floor(Math.random() * greetings.length)];
}

// Format time as HH:MM
function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Format date as DAY, MONTH DATE
function formatDate(date) {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const dateNum = date.getDate();

  return `${dayName}, ${monthName} ${dateNum}`;
}

// Update time, greeting, and date
function updateTimeAndGreeting() {
  const now = new Date();
  const timeDisplay = document.getElementById('time-display');
  const greetingText = document.getElementById('greeting-text');
  const dateDisplay = document.getElementById('date-display');

  if (timeDisplay) {
    timeDisplay.textContent = formatTime(now);
  }

  if (greetingText) {
    const greeting = getGreetingForHour(now.getHours());
    greetingText.textContent = `${greeting}.`;
  }

  if (dateDisplay) {
    dateDisplay.textContent = formatDate(now);
  }
}

// Get weather icon based on condition description
function getWeatherIcon(description) {
  description = description.toLowerCase();
  for (const [key, icon] of Object.entries(WEATHER_ICONS)) {
    if (description.includes(key)) {
      return icon;
    }
  }
  return WEATHER_ICONS.default;
}

// Fetch weather data based on geolocation
function fetchWeatherData(lat, lon) {
  // Using Open-Meteo API (free, no API key required)
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&temperature_unit=celsius&wind_speed_unit=kmh`;

  fetch(weatherUrl)
    .then(response => response.json())
    .then(data => {
      const weather = data.current;
      const temp = Math.round(weather.temperature_2m);

      // Decode weather code
      const weatherCode = weather.weather_code;
      let condition = 'cloudy';
      if (weatherCode === 0) condition = 'clear';
      else if (weatherCode === 1 || weatherCode === 2) condition = 'cloud';
      else if (weatherCode === 80 || weatherCode === 81 || weatherCode === 82) condition = 'rain';
      else if (weatherCode >= 71 && weatherCode <= 77) condition = 'snow';

      const icon = getWeatherIcon(condition);

      // Update weather display
      const weatherTemp = document.getElementById('weather-temp');
      const weatherIcon = document.getElementById('weather-icon');

      if (weatherTemp) {
        weatherTemp.textContent = `${temp}°C`;
      }
      if (weatherIcon) {
        weatherIcon.textContent = icon;
      }
    })
    .catch(error => {
      console.log('Weather fetch failed:', error);
      // Keep default values on error
    });
}

// Get user location and fetch weather
function initializeWeather() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        fetchWeatherData(latitude, longitude);
      },
      (error) => {
        console.log('Geolocation error:', error);
        // Use fallback: fetch based on IP
        fetchWeatherByIP();
      }
    );
  } else {
    // Fallback to IP-based geolocation
    fetchWeatherByIP();
  }
}

// Fallback: Get weather based on IP location
function fetchWeatherByIP() {
  fetch('https://ipapi.co/json/')
    .then(response => response.json())
    .then(data => {
      const { latitude, longitude, city, country_code } = data;
      fetchWeatherData(latitude, longitude);

      // Update location display
      const weatherLocation = document.getElementById('weather-location');
      if (weatherLocation) {
        weatherLocation.textContent = `${city}, ${country_code}`;
      }
    })
    .catch(error => {
      console.log('IP geolocation failed:', error);
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Update time, greeting, and date
  updateTimeAndGreeting();
  initializeWeather();

  // Update time and greeting every minute
  setInterval(updateTimeAndGreeting, 60000);

  // Search bar functionality
  const searchBar = document.querySelector('.search-input');

  if (window.electronAPI && window.electronAPI.windowClick) {
    window.addEventListener("click", (e) => {
      window.electronAPI.windowClick({ x: e.clientX, y: e.clientY });
    });
  }

  if (searchBar) {
    searchBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = searchBar.value.trim();
        if (query) {
          handleSearch(query);
        }
      }
    });
  }

  function handleSearch(query) {
    let url;

    if (query.startsWith('http://') || query.startsWith('https://')) {
      url = query;
    } else if (query.includes('.') && !query.includes(' ')) {
      url = 'https://' + query;
    } else {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    }

    window.location.href = url;
  }
});