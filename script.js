"use strict";

/* ── Constants ─────────────────────────────────────────────────────────────── */

const MAX_GUESSES = 6;
const FLAG_W = 640;
const FLAG_H = 480;
const HIDDEN_COLOR = [31, 41, 55]; // matches #1f2937 background
const EPOCH = new Date("2025-01-01T00:00:00");

/* ── State ─────────────────────────────────────────────────────────────────── */

let countries = [];          // [{code, name}]
let palette = [];            // [[r,g,b], ...]
let targetCode = "";
let guesses = [];            // codes already guessed
let revealMask = null;       // Uint8Array, 1 = revealed
let targetPixels = null;     // Uint8ClampedArray (RGBA)
let solved = false;
let gameOver = false;
let activeDropdownIdx = -1;

/* ── DOM refs ──────────────────────────────────────────────────────────────── */

const canvas = document.getElementById("flag-canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const guessRows = document.querySelectorAll(".guess-row");
const input = document.getElementById("country-input");
const dropdown = document.getElementById("dropdown");
const guessBtn = document.getElementById("guess-btn");
const banner = document.getElementById("banner");
const countdownArea = document.getElementById("countdown-area");
const countdownEl = document.getElementById("countdown");
const paletteSwatch = document.getElementById("palette-swatches");
const hardModeCb = document.getElementById("hard-mode-cb");
const app = document.getElementById("app");

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed;
  function rng() {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dayIndex() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today - EPOCH) / 86400000);
}

function storageKey() {
  return `flagle-${todayStr()}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveState() {
  localStorage.setItem(storageKey(), JSON.stringify({
    guesses,
    solved,
  }));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function getPixels(img) {
  const c = document.createElement("canvas");
  c.width = FLAG_W;
  c.height = FLAG_H;
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0, FLAG_W, FLAG_H);
  return cx.getImageData(0, 0, FLAG_W, FLAG_H).data;
}

/* ── Daily target ──────────────────────────────────────────────────────────── */

function pickTarget() {
  const seed = hashStr("flagle-shuffle-seed-v2");
  const shuffled = seededShuffle(countries.map(c => c.code), seed);
  const idx = dayIndex() % shuffled.length;
  return shuffled[idx];
}

/* ── Canvas rendering ──────────────────────────────────────────────────────── */

function renderCanvas() {
  if (!targetPixels || !revealMask) return;
  const imgData = ctx.createImageData(FLAG_W, FLAG_H);
  const d = imgData.data;
  const total = FLAG_W * FLAG_H;
  for (let i = 0; i < total; i++) {
    const pi = i * 4;
    if (revealMask[i]) {
      d[pi]     = targetPixels[pi];
      d[pi + 1] = targetPixels[pi + 1];
      d[pi + 2] = targetPixels[pi + 2];
    } else {
      d[pi]     = HIDDEN_COLOR[0];
      d[pi + 1] = HIDDEN_COLOR[1];
      d[pi + 2] = HIDDEN_COLOR[2];
    }
    d[pi + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

function revealAll() {
  if (!revealMask) return;
  revealMask.fill(1);
  renderCanvas();
}

/* ── Comparison logic ──────────────────────────────────────────────────────── */

async function processGuess(guessCode) {
  const guessImg = await loadImage(`flags/quantized/${guessCode}.png`);
  const guessPx = getPixels(guessImg);
  const total = FLAG_W * FLAG_H;

  for (let i = 0; i < total; i++) {
    const pi = i * 4;
    if (
      guessPx[pi]     === targetPixels[pi] &&
      guessPx[pi + 1] === targetPixels[pi + 1] &&
      guessPx[pi + 2] === targetPixels[pi + 2]
    ) {
      revealMask[i] = 1;
    }
  }

  let revealed = 0;
  for (let i = 0; i < total; i++) {
    if (revealMask[i]) revealed++;
  }
  const pct = (revealed / total) * 100;

  renderCanvas();
  return pct;
}

/* ── UI updates ────────────────────────────────────────────────────────────── */

function updateGuessRow(index, code, pct) {
  const row = guessRows[index];
  if (!row) return;
  const name = countries.find(c => c.code === code)?.name ?? code;
  row.classList.remove("empty");
  row.classList.add("filled");
  if (pct >= 99.99) row.classList.add("correct");
  row.querySelector(".guess-name").textContent = name;
  row.querySelector(".guess-pct").textContent = pct.toFixed(1) + "%";
  row.querySelector(".guess-thumb").innerHTML =
    `<img src="flags/thumbs/${code}.png" alt="${name}">`;
}

function showBanner(type, text) {
  banner.textContent = text;
  banner.className = `banner ${type}`;
}

function endGame(won) {
  gameOver = true;
  document.getElementById("input-area").classList.add("hidden");
  countdownArea.classList.remove("hidden");

  if (won) {
    showBanner("win", "Gut gemacht!");
  } else {
    const name = countries.find(c => c.code === targetCode)?.name ?? targetCode;
    showBanner("lose", `Das war: ${name}`);
  }
  revealAll();
  startCountdown();
  saveState();
}

/* ── Countdown ─────────────────────────────────────────────────────────────── */

function startCountdown() {
  function tick() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const diff = tomorrow - now;
    if (diff <= 0) {
      location.reload();
      return;
    }
    const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
    countdownEl.textContent = `${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
}

/* ── Dropdown / Autocomplete ───────────────────────────────────────────────── */

function getFiltered() {
  const q = input.value.trim().toLowerCase();
  if (!q) return countries.filter(c => !guesses.includes(c.code));
  return countries.filter(
    c => c.name.toLowerCase().includes(q) && !guesses.includes(c.code)
  );
}

function renderDropdown() {
  const items = getFiltered();
  if (!items.length || gameOver) {
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
    activeDropdownIdx = -1;
    return;
  }
  dropdown.classList.remove("hidden");
  activeDropdownIdx = -1;
  dropdown.innerHTML = items.map((c, i) =>
    `<div class="dropdown-item" data-code="${c.code}" data-idx="${i}">` +
    `<img src="flags/thumbs/${c.code}.png" alt="">` +
    `<span>${c.name}</span></div>`
  ).join("");
}

function selectCountry(code) {
  const c = countries.find(x => x.code === code);
  if (!c) return;
  input.value = c.name;
  input.dataset.code = code;
  dropdown.classList.add("hidden");
  activeDropdownIdx = -1;
}

dropdown.addEventListener("click", e => {
  const item = e.target.closest(".dropdown-item");
  if (item) selectCountry(item.dataset.code);
});

input.addEventListener("input", () => {
  delete input.dataset.code;
  renderDropdown();
});

input.addEventListener("focus", () => {
  renderDropdown();
});

input.addEventListener("keydown", e => {
  const items = dropdown.querySelectorAll(".dropdown-item");
  if (!items.length) {
    if (e.key === "Enter") { e.preventDefault(); guessBtn.click(); }
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeDropdownIdx = Math.min(activeDropdownIdx + 1, items.length - 1);
    items.forEach((it, i) => it.classList.toggle("active", i === activeDropdownIdx));
    items[activeDropdownIdx]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeDropdownIdx = Math.max(activeDropdownIdx - 1, 0);
    items.forEach((it, i) => it.classList.toggle("active", i === activeDropdownIdx));
    items[activeDropdownIdx]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeDropdownIdx >= 0 && items[activeDropdownIdx]) {
      selectCountry(items[activeDropdownIdx].dataset.code);
    } else if (items.length === 1) {
      selectCountry(items[0].dataset.code);
    } else {
      guessBtn.click();
    }
  } else if (e.key === "Escape") {
    dropdown.classList.add("hidden");
    activeDropdownIdx = -1;
  }
});

document.addEventListener("click", e => {
  if (!e.target.closest("#search-wrapper")) {
    dropdown.classList.add("hidden");
    activeDropdownIdx = -1;
  }
});

/* ── Guess submission ──────────────────────────────────────────────────────── */

guessBtn.addEventListener("click", async () => {
  if (gameOver) return;

  let code = input.dataset.code;
  if (!code) {
    const q = input.value.trim().toLowerCase();
    const match = countries.find(c => c.name.toLowerCase() === q);
    if (match) code = match.code;
  }
  if (!code || guesses.includes(code)) return;

  guessBtn.disabled = true;
  input.value = "";
  delete input.dataset.code;
  dropdown.classList.add("hidden");

  guesses.push(code);
  const pct = await processGuess(code);
  updateGuessRow(guesses.length - 1, code, pct);

  solved = code === targetCode;
  saveState();

  if (solved) {
    endGame(true);
  } else if (guesses.length >= MAX_GUESSES) {
    endGame(false);
  }

  guessBtn.disabled = false;
});

/* ── Hard mode toggle ──────────────────────────────────────────────────────── */

function applyHardMode(on) {
  app.classList.toggle("hide-thumbs", on);
  hardModeCb.checked = on;
  localStorage.setItem("flagle-hard-mode", on ? "1" : "0");
}

hardModeCb.addEventListener("change", () => {
  applyHardMode(hardModeCb.checked);
});

applyHardMode(localStorage.getItem("flagle-hard-mode") === "1");

/* ── Palette footer ────────────────────────────────────────────────────────── */

function renderPalette() {
  paletteSwatch.innerHTML = palette
    .map(([r, g, b]) =>
      `<div class="swatch" style="background:rgb(${r},${g},${b})" title="rgb(${r},${g},${b})"></div>`
    )
    .join("");
}

/* ── Initialisation ────────────────────────────────────────────────────────── */

async function init() {
  const [countriesRes, paletteRes] = await Promise.all([
    fetch("data/countries.json").then(r => r.json()),
    fetch("data/palette.json").then(r => r.json()),
  ]);
  countries = countriesRes;
  palette = paletteRes;

  renderPalette();

  targetCode = pickTarget();
  const targetImg = await loadImage(`flags/quantized/${targetCode}.png`);
  targetPixels = getPixels(targetImg);
  revealMask = new Uint8Array(FLAG_W * FLAG_H);

  renderCanvas();

  const saved = loadState();
  if (saved && saved.guesses && saved.guesses.length) {
    for (const code of saved.guesses) {
      guesses.push(code);
      const pct = await processGuess(code);
      updateGuessRow(guesses.length - 1, code, pct);
    }
    solved = !!saved.solved;
    if (solved) {
      endGame(true);
    } else if (guesses.length >= MAX_GUESSES) {
      endGame(false);
    }
  }
}

init();
