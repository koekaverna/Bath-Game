"use strict";

/* ====================================================================
   Тёплая Ванна — расслабляющая игра для тех, кто лежит в ванной.
   Управление: один палец. Тапай по пузырям — они лопаются.
   ==================================================================== */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// --- DOM ---
const hud = document.getElementById("hud");
const scoreEl = document.getElementById("score");
const comboEl = document.getElementById("combo");
const warmthFill = document.getElementById("warmth-fill");
const startScreen = document.getElementById("start-screen");
const endScreen = document.getElementById("end-screen");
const finalScoreEl = document.getElementById("final-score");
const finalBestEl = document.getElementById("final-best");

let W = 0;
let H = 0;
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

/* ---------------- Состояние игры ---------------- */
const STATE = { MENU: 0, PLAYING: 1, OVER: 2 };
let state = STATE.MENU;
let zenMode = false;

let bubbles = [];
let particles = [];
let ripples = [];

let score = 0;
let warmth = 1; // 0..1
let combo = 0;
let comboTimer = 0;
let spawnTimer = 0;
let lastTime = 0;
let elapsed = 0;

const BEST_KEY = "bathgame_best";
let best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);

/* ---------------- Звук (мягкий, WebAudio) ---------------- */
let audioCtx = null;
function pluck(freq, dur = 0.18, vol = 0.18) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    audioCtx = null;
  }
}

function haptic(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

/* ---------------- Типы пузырей ---------------- */
// normal: очки. warm: греет воду. duck: большой бонус.
function makeBubble() {
  const r = rand(34, 64); // крупные цели — удобно мокрым пальцем
  const roll = Math.random();
  let type = "normal";
  if (roll > 0.97) type = "duck";
  else if (roll > 0.7) type = "warm";

  return {
    x: rand(r, W - r),
    y: H + r + rand(0, 40),
    r,
    type,
    vy: -rand(28, 58) * (type === "duck" ? 0.7 : 1),
    drift: rand(-18, 18),
    phase: Math.random() * Math.PI * 2,
    wobble: rand(0.6, 1.4),
    pop: false,
  };
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

/* ---------------- Запуск / конец ---------------- */
function startGame(zen) {
  zenMode = zen;
  state = STATE.PLAYING;
  bubbles = [];
  particles = [];
  ripples = [];
  score = 0;
  warmth = 1;
  combo = 0;
  comboTimer = 0;
  spawnTimer = 0;
  elapsed = 0;
  scoreEl.textContent = "0";
  hud.classList.remove("hidden");
  startScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
  updateWarmthUI();
}

function endGame() {
  state = STATE.OVER;
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
  }
  finalScoreEl.textContent = score;
  finalBestEl.textContent = best;
  hud.classList.add("hidden");
  endScreen.classList.remove("hidden");
  haptic([30, 60, 30]);
}

/* ---------------- Ввод ---------------- */
function popAt(px, py) {
  // Прощающее попадание: ищем ближайший пузырь в увеличенном радиусе.
  let hit = null;
  let bestDist = Infinity;
  for (const b of bubbles) {
    if (b.pop) continue;
    const dx = b.x - px;
    const dy = b.y - py;
    const d = Math.hypot(dx, dy);
    const reach = b.r + 26; // бонус к радиусу — удобнее попадать
    if (d <= reach && d < bestDist) {
      bestDist = d;
      hit = b;
    }
  }
  if (hit) {
    popBubble(hit);
  } else {
    // Промах по воде — мягкая рябь, без штрафа.
    ripples.push({ x: px, y: py, r: 8, max: 60, a: 0.5 });
  }
}

function popBubble(b) {
  b.pop = true;
  combo += 1;
  comboTimer = 1.6;

  let points = 1;
  if (b.type === "duck") points = 10;
  const gained = points * Math.max(1, Math.floor(combo / 3) + 1);
  score += gained;
  scoreEl.textContent = score;

  if (b.type === "warm") {
    warmth = Math.min(1, warmth + 0.16);
    pluck(520, 0.22, 0.16);
  } else if (b.type === "duck") {
    warmth = Math.min(1, warmth + 0.08);
    pluck(880, 0.3, 0.2);
    pluck(660, 0.3, 0.14);
  } else {
    pluck(360 + Math.min(combo, 12) * 22, 0.16, 0.13);
  }
  updateWarmthUI();

  if (combo >= 3) {
    comboEl.textContent = "комбо ×" + combo;
    comboEl.classList.add("show");
  }

  haptic(b.type === "duck" ? [10, 30, 10] : 12);
  spawnSplash(b);
  ripples.push({ x: b.x, y: b.y, r: b.r * 0.5, max: b.r * 2.2, a: 0.6 });
}

function spawnSplash(b) {
  const color = bubbleColor(b.type);
  const n = b.type === "duck" ? 22 : 12;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rand(40, 160);
    particles.push({
      x: b.x,
      y: b.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r: rand(2, 5),
      life: 1,
      color,
    });
  }
}

function pointerHandler(e) {
  if (state === STATE.MENU || state === STATE.OVER) return;
  initAudio();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  const touches = e.changedTouches ? e.changedTouches : [e];
  for (const t of touches) {
    popAt(t.clientX, t.clientY);
  }
}
canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  pointerHandler(e);
}, { passive: false });
canvas.addEventListener("mousedown", pointerHandler);

/* ---------------- UI тепла ---------------- */
function updateWarmthUI() {
  warmthFill.style.width = (warmth * 100).toFixed(1) + "%";
  warmthFill.classList.toggle("cold", warmth < 0.3);
}

/* ---------------- Цвета ---------------- */
function bubbleColor(type) {
  if (type === "warm") return "#ff7a59";
  if (type === "duck") return "#ffd25e";
  return "#bfeefa";
}

/* ---------------- Обновление ---------------- */
function update(dt) {
  if (state !== STATE.PLAYING) return;
  elapsed += dt;

  // Сложность плавно растёт: чаще спавн.
  const spawnEvery = Math.max(0.35, 0.95 - elapsed * 0.006);
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = spawnEvery;
    bubbles.push(makeBubble());
    if (elapsed > 25 && Math.random() > 0.6) bubbles.push(makeBubble());
  }

  // Остывание воды (в дзен-режиме вода не стынет).
  if (!zenMode) {
    warmth -= dt * 0.022;
    if (warmth <= 0) {
      warmth = 0;
      updateWarmthUI();
      endGame();
      return;
    }
    updateWarmthUI();
  }

  // Комбо тайм-аут.
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) {
      combo = 0;
      comboEl.classList.remove("show");
    }
  }

  // Пузыри.
  for (const b of bubbles) {
    b.phase += dt * b.wobble;
    b.x += (b.drift + Math.sin(b.phase) * 14) * dt;
    b.y += b.vy * dt;
    if (b.x < b.r) b.x = b.r;
    if (b.x > W - b.r) b.x = W - b.r;
  }
  // Удаляем лопнутые и улетевшие.
  bubbles = bubbles.filter((b) => !b.pop && b.y > -b.r - 40);

  // Частицы.
  for (const p of particles) {
    p.vy += 320 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt * 1.8;
  }
  particles = particles.filter((p) => p.life > 0);

  // Рябь.
  for (const r of ripples) {
    r.r += (r.max - r.r) * dt * 4;
    r.a -= dt * 1.2;
  }
  ripples = ripples.filter((r) => r.a > 0);
}

/* ---------------- Отрисовка ---------------- */
function drawBackground(time) {
  // Градиент воды.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1f9bb3");
  g.addColorStop(0.5, "#11697f");
  g.addColorStop(1, "#0a3d4d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Тёплый/холодный оттенок по температуре воды.
  if (!zenMode) {
    if (warmth > 0.5) {
      ctx.fillStyle = `rgba(255,150,90,${(warmth - 0.5) * 0.22})`;
    } else {
      ctx.fillStyle = `rgba(90,170,255,${(0.5 - warmth) * 0.3})`;
    }
    ctx.fillRect(0, 0, W, H);
  }

  // Плавающие блики (каустика).
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 6; i++) {
    const x = (W * (i / 6)) + Math.sin(time * 0.0004 + i) * 40;
    const y = (H * ((i * 0.21) % 1)) + Math.cos(time * 0.0005 + i) * 30;
    const rad = 80 + Math.sin(time * 0.0006 + i * 2) * 30;
    const lg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    lg.addColorStop(0, "rgba(180,240,255,0.10)");
    lg.addColorStop(1, "rgba(180,240,255,0)");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawBubble(b) {
  const col = bubbleColor(b.type);
  ctx.save();
  ctx.translate(b.x, b.y);

  // Тело пузыря.
  const grad = ctx.createRadialGradient(
    -b.r * 0.3,
    -b.r * 0.3,
    b.r * 0.1,
    0,
    0,
    b.r
  );
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.25, col);
  grad.addColorStop(1, "rgba(255,255,255,0.12)");
  ctx.beginPath();
  ctx.arc(0, 0, b.r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Контур.
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.stroke();

  // Блик.
  ctx.beginPath();
  ctx.arc(-b.r * 0.32, -b.r * 0.32, b.r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();

  // Уточка.
  if (b.type === "duck") {
    ctx.font = `${b.r * 1.1}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🦆", 0, b.r * 0.05);
  } else if (b.type === "warm") {
    ctx.font = `${b.r * 0.7}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🔥", 0, b.r * 0.05);
  }
  ctx.restore();
}

function render(time) {
  ctx.clearRect(0, 0, W, H);
  drawBackground(time);

  // Рябь.
  for (const r of ripples) {
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(234,247,250,${Math.max(0, r.a)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Пузыри.
  for (const b of bubbles) drawBubble(b);

  // Частицы (брызги).
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ---------------- Игровой цикл ---------------- */
function loop(time) {
  const dt = Math.min(0.05, (time - lastTime) / 1000 || 0);
  lastTime = time;
  update(dt);
  render(time);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------------- Кнопки ---------------- */
document.getElementById("start-btn").addEventListener("click", () => {
  initAudio();
  startGame(false);
});
document.getElementById("zen-btn").addEventListener("click", () => {
  initAudio();
  startGame(true);
});
document.getElementById("again-btn").addEventListener("click", () => {
  startGame(zenMode);
});
