// IIFE: compiled as a classic <script>; the wrapper keeps this page's
// top-level names out of the shared global scope.
(() => {
// Northstar — home / new-tab page.
// Deliberately makes zero network requests of its own (no weather, no
// geolocation, no external fonts) — the home page never phones home.

const DAYS   = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function greetingForHour(h) {
  if (h < 5)  return 'Good night.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  if (h < 22) return 'Good evening.';
  return 'Good night.';
}

function tick() {
  const now = new Date();
  const g = document.getElementById('greeting');
  const d = document.getElementById('dateline');
  if (g) g.textContent = greetingForHour(now.getHours());
  if (d) d.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

// Mirror the omnibox: bare domains become URLs, everything else is a search.
function resolveQuery(raw) {
  const q = raw.trim();
  if (!q) return null;
  if (/^https?:\/\//i.test(q)) return q;
  if (q.includes('.') && !q.includes(' ')) return 'https://' + q;
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

document.addEventListener('DOMContentLoaded', () => {
  tick();
  // Align the first update to the top of the next minute, then tick each minute.
  const secs = new Date().getSeconds();
  setTimeout(() => { tick(); setInterval(tick, 60000); }, (60 - secs) * 1000);

  // Keyboard hint matches the platform's focus-address-bar shortcut.
  const kbd = document.getElementById('search-kbd');
  if (kbd && !/mac/i.test(navigator.platform)) kbd.textContent = 'Ctrl L';

  const form  = document.getElementById('search-form');
  const input = document.getElementById('search-input') as HTMLInputElement | null;

  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = resolveQuery(input.value);
      if (url) {
        // Yield the page immediately — don't sit under the incoming site.
        document.documentElement.classList.add('leaving');
        window.location.href = url;
      }
    });
  }

  // Let clicks on the page dismiss any open chrome overlay (menu, prompts).
  if (window.electronAPI && window.electronAPI.windowClick) {
    window.addEventListener('click', (e) => {
      window.electronAPI.windowClick({ x: e.clientX, y: e.clientY });
    });
  }
});
})();
