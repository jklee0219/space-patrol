// 우주 방위대 (Space Patrol) — 우성오락실
// 세로 스크롤 슈팅. 끌어서 움직이고 총알은 자동 발사. 5웨이브마다 보스.
// YouTube Playables 요건: SDK 먼저, firstFrameReady/gameReady, onPause/onResume 로만 정지,
// 유튜브 음소거 따름, saveData/loadData(웨이브 단위 이어하기), 모든 화면비, 터치·마우스·키보드.
"use strict";

// ───────────── 유튜브 SDK (밖에서는 localStorage) ─────────────
const YT = (typeof ytgame !== "undefined") ? ytgame : null;
const IN_YT = !!(YT && YT.IN_PLAYABLES_ENV);
const SAVE_KEY = "woosung-space-patrol-v1";
const sdk = {
  firstFrameReady() { try { YT && YT.game.firstFrameReady(); } catch (e) {} },
  gameReady() { try { YT && YT.game.gameReady(); } catch (e) {} },
  async load() {
    if (IN_YT) { try { return await YT.game.loadData(); } catch (e) { return ""; } }
    try { return localStorage.getItem(SAVE_KEY) || ""; } catch (e) { return ""; }
  },
  async save(str) {
    if (IN_YT) { try { await YT.game.saveData(str); } catch (e) {} return; }
    try { localStorage.setItem(SAVE_KEY, str); } catch (e) {}
  },
  score(v) { if (IN_YT) { try { YT.engagement.sendScore({ value: Math.floor(v) }); } catch (e) {} } },
  audioOn() { if (IN_YT) { try { return YT.system.isAudioEnabled(); } catch (e) {} } return true; },
  async lang() { if (IN_YT) { try { return await YT.system.getLanguage(); } catch (e) {} } return navigator.language || "ko"; },
  interstitial() { if (IN_YT) { try { return YT.ads.requestInterstitialAd(); } catch (e) {} } return Promise.resolve(); },
};

// ───────────── 문구 ─────────────
const TEXT = {
  ko: { title: "우주 방위대", tap: "화면을 눌러 출격!", cont: "WAVE {n}부터 이어하기", best: "최고", wave: "WAVE",
        boss: "보스 등장!", over: "게임 오버", again: "다시 출격", score: "점수", clear: "보스 격파!", hint: "끌어서 이동 · 두 번 탭하면 폭탄" },
  en: { title: "Space Patrol", tap: "Tap to launch!", cont: "Continue from WAVE {n}", best: "BEST", wave: "WAVE",
        boss: "BOSS INCOMING!", over: "GAME OVER", again: "Launch again", score: "SCORE", clear: "BOSS DOWN!", hint: "Drag to move · double-tap for bomb" },
};
let T = TEXT.ko;

// ───────────── 세계 ─────────────
const W = 100, H = 160;
const C = { pink: "#ff40a0", cyan: "#3ce6ff", yellow: "#ffd640", white: "#fff6fc", night: "#0e0a22", green: "#7dff8a", orange: "#ff9a3c", purple: "#a86bff" };

// 적 종류
const ENEMY = {
  slime:  { r: 4.2, hp: 2,   score: 10,  speed: 22, fire: 0 },
  bat:    { r: 4.0, hp: 2,   score: 15,  speed: 30, fire: 0.25 },
  ufo:    { r: 5.0, hp: 5,   score: 30,  speed: 16, fire: 0.6 },
  puffer: { r: 5.4, hp: 8,   score: 50,  speed: 12, fire: 0.45 },
  boss:   { r: 14,  hp: 260, score: 1000, speed: 0, fire: 0 },
};

// ───────────── 상태 ─────────────
const st = {
  mode: "title",          // title | play | over
  ready: false, paused: false,
  score: 0, best: 0, wave: 0, maxWave: 0, games: 0, resume: null,
  p: null, pb: [], en: [], eb: [], items: [], fx: [], floats: [],
  spawnQ: [], waveT: 0, nextWaveAt: null, banner: null, bannerT: 0, shake: 0, time: 0,
};

function newPlayer() {
  return { x: W / 2, y: H - 24, r: 1.8, power: 1, shield: false, bombs: 2, lives: 3, inv: 2, fireT: 0 };
}

// ───────────── 저장 ─────────────
function serialize() {
  const p = st.p;
  return JSON.stringify({
    v: 1, best: st.best, maxWave: st.maxWave, games: st.games,
    cur: st.mode === "play" && p ? { wave: st.wave, score: st.score, lives: p.lives, power: p.power, bombs: p.bombs } : null,
  });
}
function save() { if (st.ready) sdk.save(serialize()); }
async function loadSave() {
  const raw = await sdk.load();
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    st.best = d.best || 0; st.maxWave = d.maxWave || 0; st.games = d.games || 0;
    if (d.cur && d.cur.wave > 1) st.resume = d.cur;
  } catch (e) {}
}

// ───────────── 소리 (칩튠 합성) ─────────────
let actx = null, master = null, audioEnabled = true, noiseBuf = null;
function ensureAudio() {
  if (actx) { if (actx.state === "suspended" && audioEnabled && !st.paused) actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = audioEnabled ? 0.3 : 0; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.4, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { actx = null; }
}
function setAudio(on) { audioEnabled = on; if (master) master.gain.value = on ? 0.3 : 0; }
function tone(f, dur, type = "square", vol = 0.3, slide = 0) {
  if (!actx || !audioEnabled || st.paused) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.4, freq = 900) {
  if (!actx || !audioEnabled || st.paused || !noiseBuf) return;
  const t = actx.currentTime, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = "lowpass"; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}
let shotSfxT = 0;
const sfx = {
  shot() { if (st.time - shotSfxT > 0.09) { shotSfxT = st.time; tone(880, 0.04, "square", 0.06, 0.6); } },
  hit() { tone(220, 0.04, "square", 0.08, 0.5); },
  pop() { noise(0.18, 0.35, 1800); tone(300, 0.12, "triangle", 0.2, 0.4); },
  big() { noise(0.6, 0.6, 1200); tone(120, 0.5, "sawtooth", 0.3, 0.3); },
  item() { [660, 880, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.08, "square", 0.18), i * 60)); },
  hurt() { noise(0.35, 0.5, 600); tone(200, 0.3, "sawtooth", 0.25, 0.4); },
  bomb() { noise(0.9, 0.7, 2500); tone(80, 0.8, "sine", 0.4, 0.5); },
  warn() { [0, 1, 2].forEach(i => setTimeout(() => tone(440, 0.18, "square", 0.2, 0.7), i * 260)); },
  over() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.2, "triangle", 0.3), i * 160)); },
};

// ───────────── 웨이브 설계 ─────────────
function isBossWave(w) { return w % 5 === 0; }
function planWave(w) {
  // 반환: [{t: 등장 시각, type, x, y, path, ...}]
  const q = [], lvl = Math.floor((w - 1) / 5);            // 보스 한 번 잡을 때마다 한 단계씩 어려워진다
  if (isBossWave(w)) { q.push({ t: 1.6, type: "boss", x: W / 2, y: -20, path: "boss", lvl }); return q; }
  const kind = (w - 1) % 4, n = 6 + Math.min(8, w);
  const pick = () => {
    const r = Math.random();
    if (w < 3) return r < 0.75 ? "slime" : "bat";
    if (w < 7) return r < 0.45 ? "slime" : r < 0.75 ? "bat" : r < 0.93 ? "ufo" : "puffer";
    return r < 0.3 ? "slime" : r < 0.55 ? "bat" : r < 0.82 ? "ufo" : "puffer";
  };
  for (let i = 0; i < n; i++) {
    const type = pick();
    if (kind === 0) q.push({ t: i * 0.35, type, x: 12 + (i % 6) * 15.2, y: -8 - Math.floor(i / 6) * 10, path: "down", lvl });
    else if (kind === 1) q.push({ t: i * 0.4, type, x: i % 2 ? 18 : 82, y: -8, path: "snake", lvl, dir: i % 2 ? 1 : -1 });
    else if (kind === 2) q.push({ t: i * 0.5, type, x: 15 + Math.random() * 70, y: -8, path: "dive", lvl });
    else q.push({ t: i * 0.45, type, x: i % 2 ? -8 : W + 8, y: 18 + (i % 4) * 9, path: "side", lvl, dir: i % 2 ? 1 : -1 });
  }
  return q;
}

function startWave(w) {
  st.wave = w; st.maxWave = Math.max(st.maxWave, w);
  st.spawnQ = planWave(w); st.waveT = 0; st.nextWaveAt = null;
  if (isBossWave(w)) { banner(T.boss, C.pink); sfx.warn(); } else banner(`${T.wave} ${w}`, C.cyan);
  save();                                                   // 웨이브 시작마다 저장 (이어하기 지점)
}

function spawn(s) {
  const d = ENEMY[s.type], hpMul = 1 + s.lvl * 0.5;
  st.en.push({
    type: s.type, x: s.x, y: s.y, r: d.r, hp: d.hp * hpMul, maxHp: d.hp * hpMul, t: 0, path: s.path,
    dir: s.dir || 1, x0: s.x, fireT: 1 + Math.random() * 2, hitT: 0, lvl: s.lvl, phase: 0,
  });
}

// ───────────── 게임 시작 / 끝 ─────────────
function startGame(fromResume) {
  ensureAudio();
  st.p = newPlayer(); st.pb = []; st.en = []; st.eb = []; st.items = []; st.fx = []; st.floats = [];
  st.score = 0; st.mode = "play";
  let w = 1;
  if (fromResume && st.resume) {
    const r = st.resume; w = r.wave; st.score = r.score || 0;
    st.p.lives = r.lives || 3; st.p.power = r.power || 1; st.p.bombs = r.bombs ?? 2;
  }
  st.resume = null;
  startWave(w);
}

function gameOver() {
  st.mode = "over"; st.games++;
  if (st.score > st.best) st.best = st.score;
  sdk.score(st.best);
  sfx.over(); save();
}

async function restart() {
  if (st.games > 0 && st.games % 3 === 0) {               // 세 판마다 전면 광고 (유튜브 안에서만)
    st.paused = true; try { await sdk.interstitial(); } catch (e) {} st.paused = false; startLoop();
  }
  startGame(false);
}

// ───────────── 갱신 ─────────────
function update(dt) {
  st.time += dt;
  if (st.bannerT > 0) st.bannerT -= dt;
  if (st.shake > 0) st.shake = Math.max(0, st.shake - dt * 30);
  updateFx(dt);
  if (st.mode !== "play") return;
  const p = st.p;

  // 키보드 이동
  const kx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
  const ky = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
  p.x += kx * 75 * dt; p.y += ky * 75 * dt;
  p.x = Math.max(4, Math.min(W - 4, p.x)); p.y = Math.max(20, Math.min(H - 10, p.y));
  if (p.inv > 0) p.inv -= dt;

  // 자동 발사
  p.fireT -= dt;
  if (p.fireT <= 0) { fire(p); p.fireT = p.power >= 5 ? 0.09 : 0.12; sfx.shot(); }

  // 웨이브 등장 → 다 잡으면 잠깐 쉬고 다음 웨이브
  st.waveT += dt;
  if (st.nextWaveAt == null) {
    while (st.spawnQ.length && st.spawnQ[0].t <= st.waveT) spawn(st.spawnQ.shift());
    if (!st.spawnQ.length && !st.en.length) {
      if (isBossWave(st.wave)) banner(T.clear, C.yellow);
      else dropItem(W / 2, -4, "P");                          // 웨이브 클리어 선물
      st.nextWaveAt = st.waveT + 1.6;
    }
  } else if (st.waveT >= st.nextWaveAt) startWave(st.wave + 1);

  // 내 총알
  for (const b of st.pb) { b.x += b.vx * dt; b.y += b.vy * dt; }
  st.pb = st.pb.filter(b => b.y > -10 && b.x > -10 && b.x < W + 10 && !b.dead);

  // 적
  for (const e of st.en) moveEnemy(e, dt);
  // 충돌: 내 총알 → 적
  for (const b of st.pb) {
    for (const e of st.en) {
      if (e.dead || e.y < -e.r) continue;
      const dx = b.x - e.x, dy = b.y - e.y;
      if (dx * dx + dy * dy < (e.r + 1.2) ** 2) {
        b.dead = true; e.hp -= b.dmg; e.hitT = 0.08;
        if (e.hp <= 0) kill(e); else sfx.hit();
        break;
      }
    }
  }
  st.en = st.en.filter(e => !e.dead && e.y < H + 20 && e.x > -25 && e.x < W + 25);

  // 적 총알
  for (const b of st.eb) { b.x += b.vx * dt; b.y += b.vy * dt; }
  st.eb = st.eb.filter(b => b.y > -10 && b.y < H + 10 && b.x > -10 && b.x < W + 10);

  // 아이템
  for (const it of st.items) {
    it.y += 18 * dt; it.t += dt;
    const dx = it.x - p.x, dy = it.y - p.y;
    if (dx * dx + dy * dy < 7 * 7) { it.dead = true; takeItem(it.kind); }
  }
  st.items = st.items.filter(it => !it.dead && it.y < H + 10);

  // 맞음 (적 총알·몸통)
  if (p.inv <= 0) {
    for (const b of st.eb) {
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy < (b.r + p.r) ** 2) { b.y = 999; hurt(); break; }
    }
    for (const e of st.en) {
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy < (e.r * 0.8 + p.r) ** 2) { if (e.type !== "boss") kill(e, true); hurt(); break; }
    }
  }
}

function fire(p) {
  const shots = [[0, 0]];
  if (p.power === 2) shots.splice(0, 1, [-1.6, 0], [1.6, 0]);
  if (p.power === 3) shots.push([-2, -0.12], [2, 0.12]);
  if (p.power === 4) shots.push([-2, -0.14], [2, 0.14], [-3, -0.32], [3, 0.32]);
  if (p.power >= 5) shots.push([-1.6, -0.08], [1.6, 0.08], [-2.4, -0.2], [2.4, 0.2], [-3.2, -0.36], [3.2, 0.36]);
  for (const [ox, ang] of shots) {
    const v = 170;
    st.pb.push({ x: p.x + ox, y: p.y - 5, vx: Math.sin(ang) * v, vy: -Math.cos(ang) * v, dmg: 1 });
  }
}

function moveEnemy(e, dt) {
  const d = ENEMY[e.type], sp = d.speed * (1 + e.lvl * 0.15);
  e.t += dt; if (e.hitT > 0) e.hitT -= dt;
  if (e.path === "down") { e.y += sp * dt; e.x = e.x0 + Math.sin(e.t * 2) * 4; }
  else if (e.path === "snake") { e.y += sp * 0.8 * dt; e.x = W / 2 + e.dir * Math.sin(e.t * 1.6) * 38; }
  else if (e.path === "side") { e.x += e.dir * sp * 1.2 * dt; e.y += sp * 0.35 * dt; }
  else if (e.path === "dive") {
    if (e.phase === 0) { e.y += (30 - e.y) * dt * 2.5; if (e.t > 1.3) { e.phase = 1; const a = Math.atan2(st.p.y - e.y, st.p.x - e.x); e.vx = Math.cos(a) * 55; e.vy = Math.sin(a) * 55; } }
    else { e.x += e.vx * dt; e.y += e.vy * dt; }
  } else if (e.path === "boss") { bossMove(e, dt); return; }
  if (d.fire && e.y > 4 && e.y < H * 0.7) {
    e.fireT -= dt;
    if (e.fireT <= 0) { e.fireT = (1.6 + Math.random() * 1.8) / (1 + e.lvl * 0.3); if (Math.random() < d.fire + e.lvl * 0.1) aimShot(e, 45 + e.lvl * 8); }
  }
}

function aimShot(e, v, spread = 0, n = 1) {
  const base = Math.atan2(st.p.y - e.y, st.p.x - e.x);
  for (let i = 0; i < n; i++) {
    const a = base + (n > 1 ? (i - (n - 1) / 2) * spread : 0);
    st.eb.push({ x: e.x, y: e.y + e.r * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1.4 });
  }
}
function ring(e, n, v, off = 0) {
  for (let i = 0; i < n; i++) {
    const a = off + i * Math.PI * 2 / n;
    st.eb.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1.5 });
  }
}

function bossMove(e, dt) {
  if (e.y < 30) { e.y += 20 * dt; return; }                // 등장
  e.x = W / 2 + Math.sin(e.t * 0.7) * 28;
  e.fireT -= dt;
  const rage = e.hp < e.maxHp * 0.5;
  if (e.fireT <= 0) {
    const pat = Math.floor(e.t / 4) % 3;
    if (pat === 0) { aimShot(e, 55 + e.lvl * 8, 0.22, rage ? 7 : 5); e.fireT = rage ? 0.7 : 1.0; }
    else if (pat === 1) { ring(e, rage ? 18 : 12, 38 + e.lvl * 5, e.t); e.fireT = rage ? 0.6 : 0.9; }
    else { e.spin = (e.spin || 0) + 0.45; for (let k = 0; k < 3; k++) { const a = e.spin + k * 2.09; st.eb.push({ x: e.x, y: e.y, vx: Math.cos(a) * 45, vy: Math.sin(a) * 45, r: 1.5 }); } e.fireT = 0.12; }
  }
}

function kill(e, silent) {
  e.dead = true;
  const d = ENEMY[e.type];
  st.score += d.score * (1 + e.lvl);
  explode(e.x, e.y, e.type === "boss" ? 3 : 1, colorOf(e.type));
  floatText(e.x, e.y, "+" + d.score * (1 + e.lvl), C.yellow);
  if (e.type === "boss") { sfx.big(); st.shake = 12; dropItem(e.x - 6, e.y, "P"); dropItem(e.x + 6, e.y, "S"); st.eb = []; }
  else { if (!silent) sfx.pop(); if (Math.random() < 0.2) dropItem(e.x, e.y); }
}
function colorOf(t) { return { slime: C.green, bat: C.cyan, ufo: C.purple, puffer: C.orange, boss: C.pink }[t]; }

function dropItem(x, y, kind) {
  if (!kind) { const r = Math.random(); kind = r < 0.7 ? "P" : r < 0.9 ? "S" : "B"; }
  st.items.push({ x, y, kind, t: 0 });
}
function takeItem(k) {
  const p = st.p; sfx.item();
  if (k === "P") { if (p.power < 5) p.power++; else st.score += 100; floatText(p.x, p.y - 8, "POWER UP", C.yellow); }
  if (k === "S") { p.shield = true; floatText(p.x, p.y - 8, "SHIELD", C.cyan); }
  if (k === "B") { p.bombs = Math.min(5, p.bombs + 1); floatText(p.x, p.y - 8, "BOMB +1", C.pink); }
}

function useBomb() {
  const p = st.p;
  if (st.mode !== "play" || !p || p.bombs <= 0 || st.paused) return;
  p.bombs--; st.eb = []; st.shake = 10; sfx.bomb();
  st.fx.push({ kind: "flash", life: 1 });
  for (const e of st.en) { if (e.y > -5) { e.hp -= e.type === "boss" ? 25 : 99; if (e.hp <= 0) kill(e, true); } }
  st.en = st.en.filter(e => !e.dead);
}

function hurt() {
  const p = st.p;
  if (p.shield) { p.shield = false; p.inv = 1.2; sfx.hit(); st.shake = 5; return; }
  p.lives--; p.power = Math.max(1, p.power - 1); p.inv = 2.2; st.eb = [];
  explode(p.x, p.y, 1.5, C.pink); sfx.hurt(); st.shake = 9;
  if (p.lives <= 0) gameOver();
}

// ───────────── 효과 ─────────────
function explode(x, y, size, col) {
  const n = Math.round(14 * size);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (15 + Math.random() * 45) * size;
    st.fx.push({ kind: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, size: (0.8 + Math.random() * 1.4) * size, col });
  }
  st.fx.push({ kind: "ring", x, y, r: 3 * size, life: 1, col });
}
function floatText(x, y, text, col) { st.floats.push({ x, y, text, col, life: 1 }); }
function banner(text, col) { st.banner = { text, col }; st.bannerT = 2; }
function updateFx(dt) {
  for (const f of st.fx) {
    f.life -= dt * (f.kind === "flash" ? 2.5 : 1.8);
    if (f.kind === "spark") { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.96; f.vy *= 0.96; }
  }
  st.fx = st.fx.filter(f => f.life > 0);
  for (const f of st.floats) { f.y -= 12 * dt; f.life -= dt * 1.2; }
  st.floats = st.floats.filter(f => f.life > 0);
}

// ───────────── 화면 맞춤 ─────────────
const cv = document.getElementById("c");
const cx = cv.getContext("2d");
const view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, wide: false };
function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = cv.clientWidth || innerWidth, h = cv.clientHeight || innerHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  view.dpr = dpr; view.w = w; view.h = h; view.wide = w / h > 1.1;
  const ww = view.wide ? W + 70 : W, hh = H;
  view.s = Math.min(w / ww, h / hh);
  view.ox = view.wide ? (w - ww * view.s) / 2 : (w - W * view.s) / 2;
  view.oy = (h - H * view.s) / 2;
  buildSprites();
}
window.addEventListener("resize", layout);

// ───────────── 스프라이트 (코드로 그린 귀여운 캐릭터, 크기 바뀔 때 다시 굽기) ─────────────
const SPR = {};
function bake(name, sizeW, draw, sizeH = sizeW) {
  const s = view.s * view.dpr, c = document.createElement("canvas");
  c.width = Math.ceil(sizeW * s * 2); c.height = Math.ceil(sizeH * s * 2);
  const g = c.getContext("2d"); g.translate(c.width / 2, c.height / 2); g.scale(s, s);
  draw(g); SPR[name] = { c, w: sizeW * 2, h: sizeH * 2 };
}
function eyes(g, x, y, r, angry) {
  for (const sx of [-1, 1]) {
    g.fillStyle = "#fff"; g.beginPath(); g.ellipse(x + sx * r * 1.25, y, r, r * 1.15, 0, 0, 7); g.fill();
    g.fillStyle = "#1a1030"; g.beginPath(); g.arc(x + sx * r * 1.25, y + r * 0.2, r * 0.6, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(x + sx * r * 1.25 - r * 0.2, y - r * 0.1, r * 0.22, 0, 7); g.fill();
    if (angry) { g.strokeStyle = "#1a1030"; g.lineWidth = r * 0.35; g.beginPath(); g.moveTo(x + sx * r * 2.2, y - r * 1.5); g.lineTo(x + sx * r * 0.4, y - r * 0.9); g.stroke(); }
  }
}
function blob(g, r, c1, c2) {
  const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.25, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr;
}
function shine(g, x, y, r) { g.fillStyle = "rgba(255,255,255,.7)"; g.beginPath(); g.ellipse(x, y, r, r * 0.5, -0.6, 0, 7); g.fill(); }

function buildSprites() {
  bake("player", 7, g => {                                   // 분홍 로켓 + 조종사 얼굴
    g.fillStyle = C.pink;                                    // 날개
    g.beginPath(); g.moveTo(-6.5, 3.5); g.lineTo(-2, -1); g.lineTo(-2, 4.5); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(6.5, 3.5); g.lineTo(2, -1); g.lineTo(2, 4.5); g.closePath(); g.fill();
    const gr = g.createLinearGradient(-3, 0, 3, 0); gr.addColorStop(0, "#ffd0ea"); gr.addColorStop(0.45, "#fff"); gr.addColorStop(1, "#ffb3dc");
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, -6.8); g.bezierCurveTo(4, -4, 3.4, 3, 2.6, 5.2); g.lineTo(-2.6, 5.2); g.bezierCurveTo(-3.4, 3, -4, -4, 0, -6.8); g.fill();
    g.fillStyle = C.pink; g.beginPath(); g.moveTo(0, -6.8); g.bezierCurveTo(1.6, -5.6, 2, -4.6, 2.1, -4); g.lineTo(-2.1, -4); g.bezierCurveTo(-2, -4.6, -1.6, -5.6, 0, -6.8); g.fill();
    g.fillStyle = "#7fe9ff"; g.beginPath(); g.arc(0, -0.6, 2.2, 0, 7); g.fill();          // 조종석
    g.fillStyle = "#ffe0c8"; g.beginPath(); g.arc(0, -0.3, 1.5, 0, 7); g.fill();          // 얼굴
    g.fillStyle = "#1a1030"; g.beginPath(); g.arc(-0.55, -0.5, 0.28, 0, 7); g.arc(0.55, -0.5, 0.28, 0, 7); g.fill();
    g.strokeStyle = "#1a1030"; g.lineWidth = 0.22; g.beginPath(); g.arc(0, -0.1, 0.5, 0.2, Math.PI - 0.2); g.stroke();
    shine(g, -1.2, -3.5, 0.7);
  });
  bake("slime", 5, g => {                                    // 초록 슬라임
    blob(g, 4.2, "#9dff9a", "#2fae4f");
    g.beginPath(); g.moveTo(-4.2, 2); g.bezierCurveTo(-4.4, -4.5, 4.4, -4.5, 4.2, 2);
    for (let i = 0; i < 4; i++) g.quadraticCurveTo(4.2 - i * 2.1 - 1.05, 4.2, 4.2 - (i + 1) * 2.1, 2.4);
    g.fill(); eyes(g, 0, -0.6, 0.85); shine(g, -2, -2.4, 0.8);
  });
  bake("bat", 6, g => {                                      // 박쥐 날개 하늘색 꼬마
    g.fillStyle = "#3b8ccf";
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * 2.5, -0.5); g.quadraticCurveTo(sx * 6, -4, sx * 6.2, 0.5); g.quadraticCurveTo(sx * 5, -0.3, sx * 4.4, 1.6); g.quadraticCurveTo(sx * 3.6, 0.2, sx * 2.5, 1.5); g.fill(); }
    blob(g, 3.6, "#9ff0ff", "#2f9fd6"); g.beginPath(); g.arc(0, 0, 3.6, 0, 7); g.fill();
    eyes(g, 0, -0.3, 0.75); shine(g, -1.6, -2, 0.7);
  });
  bake("ufo", 6, g => {                                      // 외눈 보라 UFO
    blob(g, 3, "#e7d0ff", "#8a55e0"); g.beginPath(); g.arc(0, -1, 3, Math.PI, 0); g.fill();
    const gr = g.createLinearGradient(0, -1, 0, 2.5); gr.addColorStop(0, "#c9a0ff"); gr.addColorStop(1, "#5b2ea8");
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0.6, 5.8, 2, 0, 0, 7); g.fill();
    g.fillStyle = C.yellow; for (const x of [-3.6, 0, 3.6]) { g.beginPath(); g.arc(x, 1, 0.55, 0, 7); g.fill(); }
    g.fillStyle = "#fff"; g.beginPath(); g.arc(0, -1.6, 1.3, 0, 7); g.fill();
    g.fillStyle = "#1a1030"; g.beginPath(); g.arc(0, -1.4, 0.7, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(-0.3, -1.7, 0.25, 0, 7); g.fill();
  });
  bake("puffer", 6.5, g => {                                 // 가시 복어
    g.fillStyle = "#ff7a2a";
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(Math.cos(a - 0.2) * 4.6, Math.sin(a - 0.2) * 4.6); g.lineTo(Math.cos(a) * 6.3, Math.sin(a) * 6.3); g.lineTo(Math.cos(a + 0.2) * 4.6, Math.sin(a + 0.2) * 4.6); g.fill(); }
    blob(g, 5, "#ffd08a", "#f0782a"); g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
    eyes(g, 0, -0.6, 0.95, true);
    g.fillStyle = "#c2410c"; g.beginPath(); g.ellipse(0, 2.2, 1, 0.6, 0, 0, 7); g.fill();
    shine(g, -2.4, -2.8, 0.9);
  });
  bake("boss", 18, g => {                                    // 왕관 쓴 분홍 문어 보스
    g.fillStyle = "#e0368c";
    for (let i = 0; i < 6; i++) { const x = -11 + i * 4.4; g.beginPath(); g.moveTo(x - 1.8, 4); g.quadraticCurveTo(x - 3, 11, x + Math.sin(i) * 2, 15); g.quadraticCurveTo(x + 2.6, 10, x + 1.8, 4); g.fill(); }
    blob(g, 13, "#ffc2e2", "#e0368c"); g.beginPath(); g.ellipse(0, -1, 14, 11, 0, 0, 7); g.fill();
    eyes(g, 0, -1.5, 2.4, true);
    g.strokeStyle = "#5a0f3c"; g.lineWidth = 0.8; g.beginPath(); g.arc(0, 5, 2.4, Math.PI + 0.4, -0.4); g.stroke();
    g.fillStyle = "#ffd640"; g.beginPath(); g.moveTo(-5, -10); g.lineTo(-5, -15); g.lineTo(-2.5, -12.5); g.lineTo(0, -16); g.lineTo(2.5, -12.5); g.lineTo(5, -15); g.lineTo(5, -10); g.closePath(); g.fill();
    g.fillStyle = "#ff40a0"; g.beginPath(); g.arc(0, -12.6, 0.9, 0, 7); g.fill();
    shine(g, -6, -6, 2.2);
  });
  for (const [k, col, c2] of [["P", "#ffe27a", "#e0a800"], ["S", "#9ff4ff", "#1aa6c9"], ["B", "#ff8a8a", "#d42b2b"]]) {
    bake("item" + k, 4, g => {
      blob(g, 3.4, col, c2); g.beginPath(); g.arc(0, 0, 3.4, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.font = "900 3.6px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(k, 0, 0.25); shine(g, -1.3, -1.6, 0.7);
    });
  }
}

// AI 캐릭터 그림 (Codex 이미지 생성). 로딩 전이나 실패하면 위의 코드 그림을 쓴다.
const WORLD_W = { player: 15, slime: 10, ufo: 13, puffer: 13, boss: 34, bat: 13, itemP: 8, itemS: 8, itemB: 8 };
const IMGS = {};
for (const n of Object.keys(WORLD_W)) { const im = new Image(); im.src = `img/${n}.png`; IMGS[n] = im; }
function imgReady(n) { const im = IMGS[n]; return im && im.complete && im.naturalWidth > 0; }

function sprite(name, x, y, scale = 1, alpha = 1, rot = 0) {
  const s = view.s, X = view.ox + x * s, Y = view.oy + y * s;
  let src, w, h;
  if (imgReady(name)) {
    const im = IMGS[name]; src = im; w = WORLD_W[name] * s * scale; h = w * im.naturalHeight / im.naturalWidth;
  } else {
    const sp = SPR[name]; if (!sp) return; src = sp.c; w = sp.w * s * scale; h = sp.h * s * scale;
  }
  cx.save(); cx.globalAlpha = alpha; cx.translate(X, Y); if (rot) cx.rotate(rot);
  cx.drawImage(src, -w / 2, -h / 2, w, h); cx.restore();
}

// ───────────── 입력 ─────────────
const keys = {};
let drag = null, lastTap = 0;
function local(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
cv.addEventListener("pointerdown", e => {
  ensureAudio();
  const q = local(e);
  if (st.mode === "title") { if (st.ready) startGame(!!st.resume); return; }
  if (st.mode === "over") { if (hit(btnAgain, q)) restart(); return; }
  if (hit(btnBomb, q)) { useBomb(); return; }
  const now = performance.now();                              // 두 번 빠르게 탭하면 폭탄
  if (now - lastTap < 320) { useBomb(); lastTap = 0; } else lastTap = now;
  drag = { x: q.x, y: q.y, px: st.p.x, py: st.p.y, id: e.pointerId };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener("pointermove", e => {
  if (st.mode !== "play" || !st.p) return;
  const q = local(e), s = view.s;
  if (drag && drag.id === e.pointerId) {                     // 끈 만큼 이동 — 손가락이 비행기를 가리지 않는다
    st.p.x = drag.px + (q.x - drag.x) / s * 1.15; st.p.y = drag.py + (q.y - drag.y) / s * 1.15;
  } else if (e.pointerType === "mouse") {                    // 마우스는 커서를 따라간다
    st.p.x = (q.x - view.ox) / s; st.p.y = (q.y - view.oy) / s;
  }
  st.p.x = Math.max(4, Math.min(W - 4, st.p.x)); st.p.y = Math.max(20, Math.min(H - 10, st.p.y));
});
cv.addEventListener("pointerup", () => { drag = null; });
cv.addEventListener("pointercancel", () => { drag = null; });
window.addEventListener("keydown", e => {
  ensureAudio(); keys[e.key] = true;
  if (e.key === " " || e.key === "Enter") {
    if (st.mode === "title" && st.ready) startGame(!!st.resume);
    else if (st.mode === "over") restart();
    e.preventDefault();
  }
  if ((e.key === "b" || e.key === "x" || e.key === "Shift") && st.mode === "play") useBomb();
});
window.addEventListener("keyup", e => { keys[e.key] = false; });
let btnAgain = null, btnBomb = null;
function hit(b, q) { return b && q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h; }

// ───────────── 그리기 ─────────────
function fmt(n) { return Math.floor(n).toLocaleString("en-US"); }
function text(str, x, y, size, color, align = "center", weight = 900, glow = 0) {
  cx.save();
  cx.font = `${weight} ${Math.round(size)}px "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`;
  cx.textAlign = align; cx.textBaseline = "middle"; cx.fillStyle = color;
  if (glow) { cx.shadowColor = color; cx.shadowBlur = glow; }
  cx.fillText(str, x, y); cx.restore();
}

function draw() {
  cx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const s = view.s, ox = view.ox, oy = view.oy;
  // 바깥 배경
  cx.fillStyle = C.night; cx.fillRect(0, 0, view.w, view.h);
  const shx = st.shake ? (Math.random() - 0.5) * st.shake * s * 0.3 : 0, shy = st.shake ? (Math.random() - 0.5) * st.shake * s * 0.3 : 0;
  cx.save(); cx.translate(shx, shy);
  // 경기장
  cx.save(); cx.beginPath(); cx.rect(ox, oy, W * s, H * s); cx.clip();
  const g = cx.createLinearGradient(0, oy, 0, oy + H * s);
  g.addColorStop(0, "#120c30"); g.addColorStop(1, "#2a0f45"); cx.fillStyle = g; cx.fillRect(ox, oy, W * s, H * s);
  for (const b of [{ x: 0.2, y: 0.25, r: 0.5, c: "rgba(255,64,160,.14)" }, { x: 0.85, y: 0.6, r: 0.5, c: "rgba(60,230,255,.10)" }]) {
    const rg = cx.createRadialGradient(ox + b.x * W * s, oy + b.y * H * s, 0, ox + b.x * W * s, oy + b.y * H * s, b.r * W * s);
    rg.addColorStop(0, b.c); rg.addColorStop(1, "rgba(0,0,0,0)"); cx.fillStyle = rg; cx.fillRect(ox, oy, W * s, H * s);
  }
  // 아이템
  for (const it of st.items) sprite("item" + it.kind, it.x, it.y, 1 + Math.sin(it.t * 8) * 0.06);
  // 적
  for (const e of st.en) {
    const bob = e.type === "boss" ? 0 : Math.sin(e.t * 6) * 0.6;
    sprite(e.type, e.x, e.y + bob, 1, 1, e.type === "puffer" ? Math.sin(e.t * 3) * 0.2 : 0);
    if (e.hitT > 0) { cx.save(); cx.globalCompositeOperation = "lighter"; sprite(e.type, e.x, e.y + bob, 1, 0.6); cx.restore(); }
  }
  // 내 총알
  cx.fillStyle = "#fff";
  for (const b of st.pb) {
    const X = ox + b.x * s, Y = oy + b.y * s;
    cx.fillStyle = C.cyan; cx.fillRect(X - 0.7 * s, Y - 2.6 * s, 1.4 * s, 5.2 * s);
    cx.fillStyle = "#fff"; cx.fillRect(X - 0.3 * s, Y - 2.2 * s, 0.6 * s, 4.4 * s);
  }
  // 적 총알 (분홍 구슬)
  for (const b of st.eb) {
    const X = ox + b.x * s, Y = oy + b.y * s;
    cx.fillStyle = "rgba(255,64,160,.45)"; cx.beginPath(); cx.arc(X, Y, b.r * 1.8 * s, 0, 7); cx.fill();
    cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(X, Y, b.r * 0.9 * s, 0, 7); cx.fill();
  }
  // 나
  const p = st.p;
  if (p && st.mode === "play" && !(p.inv > 0 && Math.floor(st.time * 14) % 2)) {
    const fl = imgReady("player") ? 0 : 2.5 + Math.random() * 1.5;   // 불꽃 (그림에 이미 있으면 생략)
    const fx = ox + p.x * s, fy = oy + (p.y + 5) * s;
    const fg = cx.createLinearGradient(0, fy, 0, fy + fl * s);
    fg.addColorStop(0, "#fff"); fg.addColorStop(0.4, C.cyan); fg.addColorStop(1, "rgba(60,230,255,0)");
    if (fl) { cx.fillStyle = fg; cx.beginPath(); cx.moveTo(fx - 1.5 * s, fy); cx.lineTo(fx + 1.5 * s, fy); cx.lineTo(fx, fy + fl * s); cx.fill(); }
    sprite("player", p.x, p.y);
    if (p.shield) {
      cx.save(); cx.strokeStyle = `rgba(60,230,255,${0.5 + 0.3 * Math.sin(st.time * 8)})`; cx.lineWidth = 0.6 * s;
      cx.beginPath(); cx.arc(fx, oy + p.y * s, 8 * s, 0, 7); cx.stroke(); cx.restore();
    }
  }
  // 효과
  for (const f of st.fx) {
    if (f.kind === "spark") { cx.globalAlpha = f.life; cx.fillStyle = f.col; cx.beginPath(); cx.arc(ox + f.x * s, oy + f.y * s, f.size * s * f.life + 0.5, 0, 7); cx.fill(); }
    else if (f.kind === "ring") { cx.globalAlpha = f.life; cx.strokeStyle = f.col; cx.lineWidth = s * f.life; cx.beginPath(); cx.arc(ox + f.x * s, oy + f.y * s, f.r * s * (2 - f.life) * 1.6, 0, 7); cx.stroke(); }
    else if (f.kind === "flash") { cx.globalAlpha = f.life * 0.7; cx.fillStyle = "#fff"; cx.fillRect(ox, oy, W * s, H * s); }
    cx.globalAlpha = 1;
  }
  for (const f of st.floats) { cx.globalAlpha = Math.min(1, f.life * 1.5); text(f.text, ox + f.x * s, oy + f.y * s, 3.6 * s, f.col, "center", 900); cx.globalAlpha = 1; }
  // 보스 체력
  const boss = st.en.find(e => e.type === "boss");
  if (boss) {
    const bw = W * s * 0.7, bx = ox + W * s * 0.15, by = oy + 12 * s;
    cx.fillStyle = "rgba(0,0,0,.5)"; cx.fillRect(bx, by, bw, 2 * s);
    cx.fillStyle = C.pink; cx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHp), 2 * s);
  }
  if (st.banner && st.bannerT > 0) {
    cx.globalAlpha = Math.min(1, st.bannerT * 1.5);
    text(st.banner.text, ox + W * s / 2, oy + H * s * 0.38, 9 * s, st.banner.col, "center", 900, 20);
    cx.globalAlpha = 1;
  }
  cx.restore();                                              // 경기장 clip 끝
  // 테두리
  cx.save(); cx.strokeStyle = C.cyan; cx.shadowColor = C.cyan; cx.shadowBlur = 16; cx.lineWidth = Math.max(2, s * 0.6);
  cx.strokeRect(ox, oy, W * s, H * s); cx.restore();
  cx.restore();                                              // 흔들림 끝

  drawHud();
  if (st.mode === "title") drawTitle();
  if (st.mode === "over") drawOver();
}

function drawHud() {
  const s = view.s, ox = view.ox, oy = view.oy, p = st.p;
  btnBomb = null;
  if (st.mode !== "play" || !p) return;
  const px = view.wide ? ox + W * s + 6 * s : ox + 3 * s;
  const align = "left";
  text(fmt(st.score), px, oy + 6 * s, 6 * s, "#fff", align, 900, 6);
  text(`${T.best} ${fmt(Math.max(st.best, st.score))}`, px, oy + 11.5 * s, 3 * s, C.yellow, align, 800);
  text(`${T.wave} ${st.wave}`, view.wide ? px : ox + W * s - 3 * s, view.wide ? oy + 17 * s : oy + 6 * s, 3.4 * s, C.cyan, view.wide ? "left" : "right", 900);
  // 목숨
  for (let i = 0; i < p.lives; i++) sprite("player", (px - ox) / s + 3 + i * 6.5, view.wide ? 24 : H - 6, 0.4);
  // 무기 단계
  for (let i = 0; i < 5; i++) {
    cx.fillStyle = i < p.power ? C.yellow : "rgba(255,255,255,.2)";
    const x = view.wide ? px + i * 3 * s : ox + W * s - 3 * s - (5 - i) * 3 * s, y = view.wide ? oy + 30 * s : oy + 9.5 * s;
    cx.fillRect(x, y, 2.2 * s, 1.2 * s);
  }
  // 폭탄 버튼
  const bs = 13 * s, bx = view.wide ? px : ox + W * s - bs - 3 * s, by = view.wide ? oy + 36 * s : oy + H * s - bs - 3 * s;
  btnBomb = { x: bx, y: by, w: bs, h: bs };
  cx.save(); cx.globalAlpha = p.bombs ? 0.9 : 0.35;
  cx.fillStyle = "rgba(212,43,43,.35)"; cx.strokeStyle = "#ff8a8a"; cx.lineWidth = Math.max(1.5, s * 0.4);
  cx.beginPath(); cx.arc(bx + bs / 2, by + bs / 2, bs / 2, 0, 7); cx.fill(); cx.stroke();
  cx.restore();
  sprite("itemB", (bx + bs / 2 - ox) / s, (by + bs / 2 - oy) / s, 1.1, p.bombs ? 1 : 0.4);
  text("×" + p.bombs, bx + bs / 2, by + bs + 2.5 * s, 3 * s, "#ff8a8a");
}

function drawTitle() {
  const s = view.s, mx = view.ox + W * s / 2, oy = view.oy;
  cx.fillStyle = "rgba(8,5,20,.55)"; cx.fillRect(view.ox, oy, W * s, H * s);
  text(T.title, mx, oy + H * s * 0.3, 11 * s, C.pink, "center", 900, 24);
  text("WOOSUNG ARCADE", mx, oy + H * s * 0.3 + 9 * s, 3.2 * s, C.yellow, "center", 800, 8);
  sprite("player", W / 2, H * 0.5, 2.2);
  const blink = Math.floor(st.time * 2) % 2 === 0;
  if (st.ready && blink) text(st.resume ? T.cont.replace("{n}", st.resume.wave) : T.tap, mx, oy + H * s * 0.68, 4.6 * s, "#fff", "center", 900, 10);
  text(T.hint, mx, oy + H * s * 0.75, 3 * s, C.cyan, "center", 700);
  if (st.best) text(`${T.best} ${fmt(st.best)}`, mx, oy + H * s * 0.82, 3.4 * s, C.yellow, "center", 800);
}

function drawOver() {
  const s = view.s, mx = view.ox + W * s / 2, my = view.oy + H * s * 0.42;
  cx.fillStyle = "rgba(8,5,20,.75)"; cx.fillRect(0, 0, view.w, view.h);
  text(T.over, mx, my - 16 * s, 10 * s, C.pink, "center", 900, 22);
  text(`${T.score} ${fmt(st.score)}`, mx, my, 5.5 * s, "#fff");
  text(`${T.best} ${fmt(st.best)}  ·  ${T.wave} ${st.wave}`, mx, my + 7 * s, 3.6 * s, C.yellow, "center", 800);
  const bw = 46 * s, bh = 11 * s, x = mx - bw / 2, y = my + 14 * s;
  btnAgain = { x, y, w: bw, h: bh };
  cx.save(); cx.fillStyle = C.pink; cx.shadowColor = C.pink; cx.shadowBlur = 18;
  cx.beginPath(); cx.roundRect(x, y, bw, bh, bh / 2); cx.fill(); cx.restore();
  text(T.again, mx, y + bh / 2, 4.6 * s, "#fff");
}

// ───────────── 루프 ─────────────
let last = 0, rafId = 0, firstFrame = false;
function frame(now) {
  rafId = 0;
  if (st.paused) return;
  // 화면 배율(dpr)이나 크기가 바뀌면 다시 맞춘다 — resize 이벤트가 안 오는 기기 대비
  { const d = Math.min(window.devicePixelRatio || 1, 2.5); if (Math.abs(cv.width - Math.round((cv.clientWidth || innerWidth) * d)) > 2) layout(); }                                     // onPause 동안 정지
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  update(dt);
  draw();
  if (!firstFrame) { firstFrame = true; sdk.firstFrameReady(); }
  rafId = requestAnimationFrame(frame);
}
function startLoop() { if (!rafId) { last = 0; rafId = requestAnimationFrame(frame); } }

(async function boot() {
  layout();
  startLoop();
  const lang = (await sdk.lang() || "").toLowerCase();
  T = lang.startsWith("ko") ? TEXT.ko : TEXT.en;
  document.title = T.title;
  audioEnabled = sdk.audioOn();
  await loadSave();                                          // loadData 끝난 뒤에만 저장
  st.ready = true;
  sdk.gameReady();
  if (IN_YT) {
    YT.system.onPause(() => { st.paused = true; if (actx) actx.suspend(); save(); });
    YT.system.onResume(() => { st.paused = false; if (actx && audioEnabled) actx.resume(); startLoop(); });
    YT.system.onAudioEnabledChange(on => setAudio(on));
  }
})();
