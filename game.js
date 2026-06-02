"use strict";

/* ====================================================================
   Тёплая Ванна — расслабляющая, но весёлая игра для ванной.
   Один палец. Тапай пузыри, лови бонусы, устраивай цепные взрывы.
   ==================================================================== */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// --- DOM ---
const hud = document.getElementById("hud");
const scoreEl = document.getElementById("score");
const comboEl = document.getElementById("combo");
const warmthFill = document.getElementById("warmth-fill");
const levelEl = document.getElementById("level");
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
let popups = []; // летящие цифры очков
let embers = []; // искры огня на высоких уровнях

// Тетрис-подобная сложность: уровень растёт от очков по корню
// (ранние уровни близко, верхние — всё дороже), с потолком MAX_LEVEL.
// Порог уровня L: LEVEL_K * (L-1)^2  →  L12 ≈ 5445 очков.
const LEVEL_K = 45;
const MAX_LEVEL = 12; // на этом уровне фон и огонь на максимуме
let curLevel = 1;
let panic = 0; // 0 (спокойствие) .. 1 (паника + огонь)

// Тепло воды: бак большой (вместимость ×10 от старого 0..1).
const WARM_MAX = 10;

// Лимит пузырей на экране — чтобы не было «стены» на высоких уровнях.
const MAX_BUBBLES = 16;

let score = 0;
let warmth = WARM_MAX; // 0..WARM_MAX
let combo = 0;
let comboTimer = 0;
let spawnTimer = 0;
let waveTimer = 8;
let lastTime = 0;
let elapsed = 0;

let timeScale = 1; // для замедления (звезда)
let shake = 0; // тряска экрана
let flash = null; // {color, a} вспышка на весь экран

const BEST_KEY = "bathgame_best";
let best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);

// Мем-камео: дерп-лицо вылетает снизу экрана в стиле Mortal Kombat.
const derpImg = new Image();
let derpReady = false;
derpImg.onload = () => (derpReady = true);
derpImg.src = "derp.svg";
let cameo = null; // {t, dur, x}

function triggerCameo() {
  if (cameo) return; // не накладываем друг на друга
  cameo = { t: 0, dur: 1.5, x: rand(0.25, 0.75) };
  yell();
  haptic([8, 24, 8]);
}
function yell() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.5);
  gain.gain.setValueAtTime(0.18, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.5);
}

const PRAISE = [
  "класс!",
  "огонь!",
  "вот это да!",
  "не остановить!",
  "мокрый комбо!",
  "пузырь-мастер!",
];

/* ---------------- Звук (мягкий, WebAudio) ---------------- */
let audioCtx = null;
function pluck(freq, dur = 0.18, vol = 0.18, type = "sine") {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}
function boom() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);
  gain.gain.setValueAtTime(0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.4);
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

/* ---------------- Типы пузырей ----------------
   normal — очки. warm — греет воду. duck — бонус.
   bomb   — цепной взрыв. rainbow — активирует всё. ice — морозит.        */
function pickType() {
  const r = Math.random();
  if (r > 0.99933) return "rainbow"; // ~0.07% — в 15 раз реже
  if (r > 0.988) return "ice"; // ~1.1% — льдинка (морозит), стала реже
  if (r > 0.982) return "bomb"; // ~0.6% — в 5 раз реже и слабее
  if (r > 0.9) return "duck"; // ~8.2%
  // Чем выше накал, тем больше тёплых: ~40% → ~62% (греться в пекле).
  const warmCut = 0.5 - panic * 0.22;
  if (r > warmCut) return "warm";
  return "normal";
}

function makeBubble(type) {
  type = type || pickType();
  let r = rand(34, 62);
  if (type === "duck" || type === "rainbow") r = rand(50, 66);
  if (type === "bomb") r = rand(44, 58);
  return {
    x: rand(r, W - r),
    y: H + r + rand(0, 40),
    r,
    type,
    vy: -rand(20, 40) * (type === "duck" ? 0.7 : 1),
    drift: rand(-18, 18),
    phase: Math.random() * Math.PI * 2,
    wobble: rand(0.6, 1.4),
    pop: false,
  };
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// Линейная интерполяция между двумя hex-цветами -> "rgb(...)".
function lerpColor(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

// Палитры воды: спокойствие -> паника.
const CALM = ["#1f9bb3", "#11697f", "#0a3d4d"];
const PANIC = ["#e0662e", "#a32a18", "#3d0a04"];

/* ---------------- Запуск / конец ---------------- */
function startGame(zen) {
  zenMode = zen;
  state = STATE.PLAYING;
  bubbles = [];
  particles = [];
  ripples = [];
  popups = [];
  embers = [];
  curLevel = 1;
  panic = 0;
  levelEl.textContent = "уровень 1";
  score = 0;
  warmth = WARM_MAX;
  combo = 0;
  comboTimer = 0;
  spawnTimer = 0;
  waveTimer = 8;
  elapsed = 0;
  timeScale = 1;
  shake = 0;
  flash = null;
  cameo = null;
  scoreEl.textContent = "0";
  hud.classList.remove("hidden");
  startScreen.classList.add("hidden");
  endScreen.classList.add("hidden");

  // Стартовый «подарок»: сразу наполняем экран пузырями (с тёплыми),
  // чтобы было чем прогреться, пока вода ещё не остыла.
  for (let i = 0; i < 4; i++) {
    const b = makeBubble(i % 2 === 0 ? "warm" : "normal");
    b.x = rand(b.r, W - b.r);
    b.y = rand(H * 0.35, H * 0.9);
    bubbles.push(b);
  }

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

/* ---------------- Эффекты ---------------- */
function addPopup(x, y, text, color) {
  popups.push({ x, y, text, color: color || "#fff", life: 1, vy: -60 });
}
function addFlash(color) {
  flash = { color, a: 0.6 };
}
function spawnSplash(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rand(40, 200);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r: rand(2, 6),
      life: 1,
      color,
    });
  }
}

/* ---------------- Ввод ---------------- */
function popAt(px, py) {
  let hit = null;
  let bestDist = Infinity;
  for (const b of bubbles) {
    if (b.pop) continue;
    const d = Math.hypot(b.x - px, b.y - py);
    const reach = b.r + 26; // прощающий радиус
    if (d <= reach && d < bestDist) {
      bestDist = d;
      hit = b;
    }
  }
  if (hit) {
    popBubble(hit, true);
  } else {
    ripples.push({ x: px, y: py, r: 8, max: 60, a: 0.5 });
  }
}

function gainScore(base, x, y, color) {
  const mult = Math.max(1, Math.floor(combo / 3) + 1);
  const g = base * mult;
  score += g;
  scoreEl.textContent = score;
  addPopup(x, y, "+" + g, color);
  return g;
}

// byTap — лопнул ли игрок сам (для комбо) или это цепная реакция.
function popBubble(b, byTap) {
  if (b.pop) return;
  b.pop = true;

  if (byTap) {
    combo += 1;
    comboTimer = 1.7;
    if (combo >= 3) {
      const praise =
        combo % 5 === 0 ? PRAISE[(combo / 5) % PRAISE.length | 0] + " " : "";
      comboEl.textContent = praise + "×" + combo;
      comboEl.classList.add("show");
    }
    if (combo > 0 && combo % 8 === 0) triggerCameo(); // мем за комбо
  }

  const col = bubbleColor(b.type);
  spawnSplash(b.x, b.y, col, b.type === "duck" ? 22 : 12);
  ripples.push({ x: b.x, y: b.y, r: b.r * 0.5, max: b.r * 2.4, a: 0.6 });

  switch (b.type) {
    case "warm":
      warmth = Math.min(WARM_MAX, warmth + 0.8);
      gainScore(1, b.x, b.y, "#ffd0b0");
      pluck(520, 0.22, 0.16);
      break;

    case "duck":
      warmth = Math.min(WARM_MAX, warmth + 0.4);
      gainScore(10, b.x, b.y, "#ffe27a");
      addPopup(b.x, b.y - 26, "🦆 кря!", "#ffe27a");
      pluck(880, 0.3, 0.2);
      pluck(660, 0.3, 0.14);
      haptic([10, 30, 10]);
      triggerCameo();
      break;

    case "bomb":
      gainScore(3, b.x, b.y, "#ffb15e");
      explode(b.x, b.y, 95); // слабее: маленький радиус, не выносит весь низ
      boom();
      shake = Math.min(shake + 10, 16);
      addFlash("rgba(255,160,80,0.35)");
      haptic([20, 40, 20]);
      triggerCameo();
      break;

    case "rainbow":
      gainScore(5, b.x, b.y, "#fff");
      rainbowSweep();
      addFlash("rgba(255,255,255,0.7)");
      shake = Math.min(shake + 10, 18);
      pluck(440, 0.4, 0.18);
      pluck(660, 0.4, 0.16, "triangle");
      pluck(990, 0.4, 0.12);
      haptic([15, 30, 15, 30, 15]);
      triggerCameo();
      break;

    case "ice":
      gainScore(4, b.x, b.y, "#bfeefa");
      timeScale = 0.32; // льдинка морозит — замедляет время
      addPopup(b.x, b.y - 26, "❄️ холодок…", "#bfeefa");
      pluck(300, 0.5, 0.16, "sine");
      break;

    default: // normal
      gainScore(1, b.x, b.y, "#eaf7fa");
      pluck(360 + Math.min(combo, 12) * 22, 0.16, 0.13);
      haptic(12);
  }

  updateWarmthUI();
}

// Цепной взрыв: лопаем всё в радиусе (бомба в радиусе тоже сдетонирует).
function explode(x, y, radius) {
  ripples.push({ x, y, r: radius * 0.2, max: radius * 1.4, a: 0.8 });
  spawnSplash(x, y, "#ffb15e", 26);
  warmth = Math.min(WARM_MAX, warmth + 0.5);
  for (const b of bubbles) {
    if (b.pop) continue;
    if (Math.hypot(b.x - x, b.y - y) <= radius) {
      // небольшой бонус за каждый задетый пузырь
      popBubble(b, false);
    }
  }
}

// Радуга АКТИВИРУЕТ каждый пузырь на экране — со всеми его эффектами
// (бомбы детонируют цепями, звёзды дают слоумо, тёплые отдают тепло).
function rainbowSweep() {
  warmth = Math.min(WARM_MAX, warmth + 1.5); // базовый бонус самой радуги
  const snapshot = bubbles.filter((b) => !b.pop);
  for (const b of snapshot) {
    if (b.pop) continue; // мог лопнуть от цепного взрыва по ходу
    if (b.type === "rainbow") {
      // вторую радугу не зацикливаем — просто очки и брызги
      b.pop = true;
      spawnSplash(b.x, b.y, bubbleColor(b.type), 12);
      score += 5;
      scoreEl.textContent = score;
    } else {
      popBubble(b, false); // полный эффект пузыря
    }
  }
  addPopup(W / 2, H * 0.4, "🌈 всё разом!", "#fff");
}

function pointerHandler(e) {
  if (state === STATE.MENU || state === STATE.OVER) return;
  initAudio();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  const touches = e.changedTouches ? e.changedTouches : [e];
  for (const t of touches) popAt(t.clientX, t.clientY);
}
canvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    pointerHandler(e);
  },
  { passive: false }
);
canvas.addEventListener("mousedown", pointerHandler);

/* ---------------- UI тепла ---------------- */
function updateWarmthUI() {
  const wr = warmth / WARM_MAX;
  warmthFill.style.width = (wr * 100).toFixed(1) + "%";
  warmthFill.classList.toggle("cold", wr < 0.3);
}

/* ---------------- Цвета ---------------- */
function bubbleColor(type) {
  switch (type) {
    case "warm":
      return "#ff7a59";
    case "duck":
      return "#ffd25e";
    case "bomb":
      return "#ff9a3c";
    case "rainbow":
      return "#c9a7ff";
    case "ice":
      return "#a9d8ff";
    default:
      return "#bfeefa";
  }
}

/* ---------------- Обновление ---------------- */
function update(dt) {
  if (state !== STATE.PLAYING) return;

  // Замедление плавно возвращается к норме.
  timeScale += (1 - timeScale) * Math.min(1, dt * 1.2);
  const sdt = dt * timeScale;

  elapsed += dt;

  // --- Уровень и сложность (как в тетрисе: от очков) ---
  const newLevel = Math.min(
    MAX_LEVEL,
    1 + Math.floor(Math.sqrt(score / LEVEL_K))
  );
  if (newLevel !== curLevel) {
    if (newLevel > curLevel) {
      // Левел-ап: вспышка, толчок, мем.
      addPopup(W / 2, H * 0.32, "УРОВЕНЬ " + newLevel, "#fff");
      addFlash("rgba(255,255,255,0.4)");
      shake = Math.min(shake + 8, 16);
      pluck(520 + newLevel * 30, 0.3, 0.16, "triangle");
    }
    curLevel = newLevel;
    levelEl.textContent = "уровень " + curLevel;
  }
  // Прогресс «накала» 0..1 (плавно к панике/огню).
  panic = Math.min(1, (curLevel - 1) / (MAX_LEVEL - 1));
  const lev = curLevel - 1;

  // Спавн пузырей: держим примерно постоянное число на экране (лимит),
  // быстро добиваем до него на низких уровнях, без «стены» на верхних.
  const spawnEvery = Math.max(0.18, 0.45 - lev * 0.02);
  spawnTimer -= dt;
  if (spawnTimer <= 0 && bubbles.length < MAX_BUBBLES) {
    spawnTimer = spawnEvery;
    bubbles.push(makeBubble());
    // второй пузырь — чтобы быстрее восполнять после серий
    if (Math.random() > 0.55 && bubbles.length < MAX_BUBBLES) {
      bubbles.push(makeBubble());
    }
  }

  // Волна — со 2-го уровня и только если экран не забит.
  waveTimer -= dt;
  if (waveTimer <= 0) {
    waveTimer = rand(12, 20);
    if (curLevel >= 2 && bubbles.length < MAX_BUBBLES - 5) {
      const n = Math.min(5, MAX_BUBBLES - bubbles.length);
      for (let i = 0; i < n; i++) {
        const b = makeBubble("normal");
        b.x = (W / (n + 1)) * (i + 1);
        b.y = H + b.r + i * 30;
        bubbles.push(b);
      }
      addPopup(W / 2, H * 0.3, "🌊 волна!", "#bfeefa");
    }
  }

  // Остывание воды (в дзене не стынет).
  if (!zenMode) {
    // Первые 5 секунд — «разгон»: вода ещё не стынет.
    // Бак большой (WARM_MAX), поэтому и слив крупнее.
    const drain = elapsed < 5 ? 0 : 0.5 + lev * 0.18;
    warmth -= dt * drain;
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

  // Пузыри (поднимаются быстрее с уровнем).
  const riseMul = 1 + lev * 0.14; // быстрее с уровнем — труднее попасть
  for (const b of bubbles) {
    b.phase += sdt * b.wobble;
    b.x += (b.drift + Math.sin(b.phase) * 14) * sdt;
    b.y += b.vy * sdt * riseMul;
    if (b.x < b.r) b.x = b.r;
    if (b.x > W - b.r) b.x = W - b.r;
  }
  bubbles = bubbles.filter((b) => !b.pop && b.y > -b.r - 40);

  // Частицы.
  for (const p of particles) {
    p.vy += 320 * sdt;
    p.x += p.vx * sdt;
    p.y += p.vy * sdt;
    p.life -= sdt * 1.8;
  }
  particles = particles.filter((p) => p.life > 0);

  // Летящие очки.
  for (const u of popups) {
    u.y += u.vy * dt;
    u.vy *= 0.94;
    u.life -= dt * 1.1;
  }
  popups = popups.filter((u) => u.life > 0);

  // Рябь.
  for (const r of ripples) {
    r.r += (r.max - r.r) * dt * 4;
    r.a -= dt * 1.2;
  }
  ripples = ripples.filter((r) => r.a > 0);

  // Искры огня (появляются с накалом).
  if (panic > 0.35) {
    const rate = (panic - 0.35) * 60; // искр в секунду
    if (Math.random() < rate * dt) {
      embers.push({
        x: rand(0, W),
        y: H + 6,
        vx: rand(-20, 20),
        vy: -rand(60, 160) * (0.6 + panic),
        r: rand(1.5, 4),
        life: 1,
      });
    }
  }
  for (const e of embers) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vy *= 0.99;
    e.life -= dt * 0.6;
  }
  embers = embers.filter((e) => e.life > 0 && e.y > -10);

  // Тряска и вспышка затухают.
  shake *= Math.max(0, 1 - dt * 6);
  if (flash) {
    flash.a -= dt * 1.6;
    if (flash.a <= 0) flash = null;
  }

  // Камео-лицо.
  if (cameo) {
    cameo.t += dt;
    if (cameo.t >= cameo.dur) cameo = null;
  }
}

/* ---------------- Отрисовка ---------------- */
function drawBackground(time) {
  // Цвет воды плавно дрейфует от спокойного к паническому с уровнем.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, lerpColor(CALM[0], PANIC[0], panic));
  g.addColorStop(0.5, lerpColor(CALM[1], PANIC[1], panic));
  g.addColorStop(1, lerpColor(CALM[2], PANIC[2], panic));
  ctx.fillStyle = g;
  ctx.fillRect(-30, -30, W + 60, H + 60);

  if (!zenMode) {
    const wr = warmth / WARM_MAX;
    if (wr > 0.5) {
      ctx.fillStyle = `rgba(255,150,90,${(wr - 0.5) * 0.22})`;
    } else {
      ctx.fillStyle = `rgba(90,170,255,${(0.5 - wr) * 0.3})`;
    }
    ctx.fillRect(-30, -30, W + 60, H + 60);
  }

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 6; i++) {
    const x = W * (i / 6) + Math.sin(time * 0.0004 + i) * 40;
    const y = H * ((i * 0.21) % 1) + Math.cos(time * 0.0005 + i) * 30;
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

// Огонь у нижней кромки: разгорается с накалом (panic).
function drawFire(time) {
  if (panic <= 0.2) return;
  const intensity = (panic - 0.2) / 0.8; // 0..1
  const baseH = H * (0.08 + intensity * 0.28);

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  // Свечение у дна.
  const glow = ctx.createLinearGradient(0, H, 0, H - baseH * 1.4);
  glow.addColorStop(0, `rgba(255,140,40,${0.55 * intensity})`);
  glow.addColorStop(0.5, `rgba(255,70,20,${0.3 * intensity})`);
  glow.addColorStop(1, "rgba(255,40,10,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, H - baseH * 1.4, W, baseH * 1.4);

  // Языки пламени в два слоя (оранжевый снаружи, жёлтый внутри).
  const step = Math.max(28, W / 16);
  for (let layer = 0; layer < 2; layer++) {
    const col = layer === 0 ? "rgba(255,90,25," : "rgba(255,200,60,";
    const hMul = layer === 0 ? 1 : 0.6;
    const wMul = layer === 0 ? 1 : 0.6;
    ctx.fillStyle = col + (0.6 * intensity).toFixed(2) + ")";
    for (let x = 0; x <= W + step; x += step) {
      const flick =
        0.55 +
        0.45 *
          Math.abs(
            Math.sin(time * 0.006 + x * 0.05 + layer) *
              Math.cos(time * 0.009 + x * 0.02)
          );
      const fh = baseH * hMul * flick;
      const w = step * 0.62 * wMul;
      ctx.beginPath();
      ctx.moveTo(x - w, H + 4);
      ctx.quadraticCurveTo(x - w * 0.3, H - fh * 0.5, x, H - fh);
      ctx.quadraticCurveTo(x + w * 0.3, H - fh * 0.5, x + w, H + 4);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

const EMOJI = { duck: "🦆", warm: "🔥", bomb: "💣", rainbow: "🌈", ice: "❄️" };

function drawBubble(b) {
  const col = bubbleColor(b.type);
  ctx.save();
  ctx.translate(b.x, b.y);

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

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-b.r * 0.32, -b.r * 0.32, b.r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();

  const em = EMOJI[b.type];
  if (em) {
    ctx.font = `${b.r * (b.type === "duck" ? 1.1 : 0.8)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(em, 0, b.r * 0.05);
  }
  ctx.restore();
}

function render(time) {
  ctx.save();
  if (shake > 0.4) {
    ctx.translate(rand(-shake, shake), rand(-shake, shake));
  }

  ctx.clearRect(-30, -30, W + 60, H + 60);
  drawBackground(time);

  for (const r of ripples) {
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(234,247,250,${Math.max(0, r.a)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const b of bubbles) drawBubble(b);

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Огонь и искры (на высоких уровнях).
  drawFire(time);
  if (embers.length) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const e of embers) {
      ctx.globalAlpha = Math.max(0, e.life);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffcf6b";
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Летящие очки.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const u of popups) {
    ctx.globalAlpha = Math.max(0, Math.min(1, u.life));
    ctx.font = "700 26px -apple-system, sans-serif";
    ctx.fillStyle = u.color;
    ctx.fillText(u.text, u.x, u.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // Вспышка на весь экран (поверх тряски).
  if (flash) {
    ctx.fillStyle = flash.color.replace(
      /[\d.]+\)$/,
      Math.max(0, flash.a).toFixed(2) + ")"
    );
    ctx.fillRect(0, 0, W, H);
  }

  // Камео-лицо: выезжает снизу, дёргается и уезжает обратно.
  if (cameo && derpReady) {
    const p = cameo.t / cameo.dur; // 0..1
    const rise = Math.sin(Math.min(1, p) * Math.PI); // 0→1→0
    const size = Math.min(W, H) * 0.5;
    const peek = size * 0.92; // насколько высовывается
    const wob = Math.sin(cameo.t * 28) * 6 * rise; // дрожь
    const x = cameo.x * W - size / 2 + wob;
    const y = H - peek * rise;
    ctx.save();
    ctx.globalAlpha = Math.min(1, rise * 1.6);
    ctx.drawImage(derpImg, x, y, size, size);
    ctx.restore();
  }
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
