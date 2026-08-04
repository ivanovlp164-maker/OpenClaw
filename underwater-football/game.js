/* Подводный футбол — Underwater Football v2
 * 5 на 5 с вратарями, два тайма, спринт, пас/удар/навес с зарядом силы,
 * прицельная траектория, медики, выбор сложности и стратегии.
 * Three.js r128, управление: два джойстика + кнопки (тач) или клавиатура.
 */
(function () {
'use strict';

// ============================== КОНСТАНТЫ ==============================
var POOL = { hx: 38, hz: 19, top: 20 };       // бассейн: x∈[-38,38], z∈[-19,19], y∈[0,20]
var SURFACE_ZONE = 1.5;
var GOAL = { hw: 5.5, h: 5.5, depth: 1.8 };
var GOAL_LINE = POOL.hx - 1.0;

var PLAYER_R = 0.75;
var PLAYER_ACCEL = 24;
var PLAYER_MAXSPD = 6.8;
var SPRINT_MULT = 1.55;
var WATER_DRAG_P = 2.6;

var STAMINA_MAX = 100;
var STAMINA_DRAIN = 30;                        // в секунду при спринте
var STAMINA_REGEN = 16;

var BALL_R = 0.62;
var BALL_DRAG = 0.5;                           // мяч стал медленнее, но всё ещё быстрый
var BALL_GRAV = -2.2;
var BALL_REST = 0.68;
var ACTION_RANGE = 2.7;                        // дистанция для паса/удара/навеса
var KICK_COOLDOWN = 0.45;
var CHARGE_TIME = 1.1;                         // секунд до полного заряда силы

var O2_BASE = 32;
var O2_PER_LEVEL = 0.25;
var O2_REFILL_TIME = 3.2;
var O2_BOOST_THRESHOLD = 0.4;                  // ниже — всплытие с ускорением

var HALF_REAL = 210;                           // реальных секунд в тайме
var HALF_GAME_MIN = 44;                        // «игровых» минут в тайме
var COINS_GOAL = 50;
var COINS_WIN = 100;

var TEAM_BLUE = 0, TEAM_ORANGE = 1;
var TEAM_COLORS = [0x2e7bff, 0xff7a1a];
var TEAM_COLORS_DARK = [0x1a4dbb, 0xbb5210];

var DIFFICULTIES = {
  easy: { name: 'Лёгкий', spd: 0.72, err: 0.55, pow: 0.75, strat: 'def' },
  mid:  { name: 'Средний', spd: 0.88, err: 0.30, pow: 0.90, strat: 'mod' },
  hard: { name: 'Сложный', spd: 1.00, err: 0.15, pow: 1.00, strat: 'agg' }
};
var STRATEGIES = { agg: 'Агрессивная', mod: 'Умеренная', def: 'Защитная' };

// ============================== СОСТОЯНИЕ ==============================
var save = loadSave();
var state = 'menu';        // menu | setup | play | goalpause | halftime | shop | end
var score = [0, 0];
var half = 1;
var halfElapsed = 0;
var goalPauseT = 0;
var coinsEarnedThisMatch = 0;
var difficulty = save.diff || 'easy';
var strategy = save.strat || 'mod';

function loadSave() {
  var s = { coins: 0, o2Level: 0, diff: 'easy', strat: 'mod' };
  try {
    var raw = localStorage.getItem('uwf_save_v1');
    if (raw) {
      var p = JSON.parse(raw);
      s.coins = p.coins | 0; s.o2Level = p.o2Level | 0;
      if (p.diff) s.diff = p.diff;
      if (p.strat) s.strat = p.strat;
    }
  } catch (e) {}
  return s;
}
function persistSave() {
  save.diff = difficulty; save.strat = strategy;
  try { localStorage.setItem('uwf_save_v1', JSON.stringify(save)); } catch (e) {}
}
function o2Capacity() { return O2_BASE * (1 + O2_PER_LEVEL * save.o2Level); }
function upgradeCost() { return Math.round(100 * Math.pow(1.9, save.o2Level)); }
function diff() { return DIFFICULTIES[difficulty]; }

// ============================== THREE: СЦЕНА ==============================
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game').appendChild(renderer.domElement);

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a5d96);
scene.fog = new THREE.FogExp2(0x0a5d96, 0.016);

var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);

scene.add(new THREE.AmbientLight(0x88bbdd, 0.55));
scene.add(new THREE.HemisphereLight(0xbfe8ff, 0x0a3350, 0.75));
var sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(12, 50, 10);
scene.add(sun);

// солнечные лучи сквозь воду (декор)
(function () {
  var rayMat = new THREE.MeshBasicMaterial({
    color: 0xbfe8ff, transparent: true, opacity: 0.05,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  for (var i = 0; i < 6; i++) {
    var cone = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 3.2, POOL.top, 6, 1, true), rayMat);
    cone.position.set((Math.random() * 2 - 1) * POOL.hx * 0.8, POOL.top / 2, (Math.random() * 2 - 1) * POOL.hz * 0.8);
    cone.rotation.z = 0.12;
    scene.add(cone);
  }
})();

// --- Дно с разметкой
function makeFloorTexture() {
  var c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
  var g = c.getContext('2d');
  var W = 2048, H = 1024;
  g.fillStyle = '#0e6fa8'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 2;
  for (var i = 0; i <= 64; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, H); g.stroke(); }
  for (var j = 0; j <= 32; j++) { g.beginPath(); g.moveTo(0, j * 32); g.lineTo(W, j * 32); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 8;
  g.strokeRect(30, 30, W - 60, H - 60);
  g.beginPath(); g.moveTo(W / 2, 30); g.lineTo(W / 2, H - 30); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 150, 0, Math.PI * 2); g.stroke();
  g.strokeRect(30, H / 2 - 260, 260, 520);
  g.strokeRect(W - 290, H / 2 - 260, 260, 520);
  g.beginPath(); g.arc(290, H / 2, 120, -Math.PI / 2, Math.PI / 2); g.stroke();
  g.beginPath(); g.arc(W - 290, H / 2, 120, Math.PI / 2, Math.PI * 1.5); g.stroke();
  return new THREE.CanvasTexture(c);
}
var floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(POOL.hx * 2, POOL.hz * 2),
  new THREE.MeshLambertMaterial({ map: makeFloorTexture() })
);
floorMesh.rotation.x = -Math.PI / 2;
scene.add(floorMesh);

// --- Стены
var wallMat = new THREE.MeshLambertMaterial({ color: 0x0c81c4, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
function addWall(w, h, x, y, z, ry) {
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
  m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
}
addWall(POOL.hx * 2, POOL.top, 0, POOL.top / 2, -POOL.hz, 0);
addWall(POOL.hx * 2, POOL.top, 0, POOL.top / 2, POOL.hz, Math.PI);
addWall(POOL.hz * 2, POOL.top, -POOL.hx, POOL.top / 2, 0, Math.PI / 2);
addWall(POOL.hz * 2, POOL.top, POOL.hx, POOL.top / 2, 0, -Math.PI / 2);

// --- Поверхность воды
var surfMat = new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
var surface = new THREE.Mesh(new THREE.PlaneGeometry(POOL.hx * 2, POOL.hz * 2, 28, 14), surfMat);
surface.rotation.x = Math.PI / 2;
surface.position.y = POOL.top;
scene.add(surface);
var surfGeo = surface.geometry;
var surfBase = surfGeo.attributes.position.array.slice();

// --- Ворота
function buildGoal(side) {
  var grp = new THREE.Group();
  var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  var r = 0.18;
  function bar(len, axis, x, y, z) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z); grp.add(m);
  }
  bar(GOAL.h, 'y', 0, GOAL.h / 2, -GOAL.hw);
  bar(GOAL.h, 'y', 0, GOAL.h / 2, GOAL.hw);
  bar(GOAL.hw * 2, 'z', 0, GOAL.h, 0);
  var netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22 });
  var net = new THREE.Mesh(new THREE.BoxGeometry(GOAL.depth, GOAL.h, GOAL.hw * 2, 2, 6, 10), netMat);
  net.position.set(side * GOAL.depth / 2, GOAL.h / 2, 0);
  grp.add(net);
  grp.position.set(side * GOAL_LINE, 0, 0);
  scene.add(grp);
}
buildGoal(-1); buildGoal(1);

// --- Мяч + белый след
var ball = { pos: new THREE.Vector3(0, 6, 0), vel: new THREE.Vector3(), mesh: null };
(function () {
  var c = document.createElement('canvas'); c.width = 128; c.height = 64;
  var g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#222';
  for (var i = 0; i < 8; i++) for (var j = 0; j < 4; j++) if ((i + j) % 2 === 0) g.fillRect(i * 16, j * 16, 16, 16);
  ball.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
  scene.add(ball.mesh);
})();

var TRAIL_N = 22;
var trailPts = new Float32Array(TRAIL_N * 3);
var trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPts, 3));
var trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
trailLine.frustumCulled = false;
scene.add(trailLine);
var trailTimer = 0;

// --- Прицельная траектория (белая дуга при заряде удара)
var AIM_N = 36;
var aimPts = new Float32Array(AIM_N * 3);
var aimGeo = new THREE.BufferGeometry();
aimGeo.setAttribute('position', new THREE.BufferAttribute(aimPts, 3));
var aimLine = new THREE.Line(aimGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
aimLine.frustumCulled = false;
aimLine.visible = false;
scene.add(aimLine);

// --- Игроки
function buildPlayerMesh(team, isHuman, isKeeper) {
  var grp = new THREE.Group();
  var col = isKeeper ? (team === TEAM_BLUE ? 0x27e0b0 : 0xffd23a) : TEAM_COLORS[team];
  var bodyMat = new THREE.MeshLambertMaterial({ color: col });
  var darkMat = new THREE.MeshLambertMaterial({ color: TEAM_COLORS_DARK[team] });
  var skinMat = new THREE.MeshLambertMaterial({ color: 0xf0c090 });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 1.0, 10), bodyMat);
  body.position.y = 0.1; grp.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), skinMat);
  head.position.y = 0.85; grp.add(head);
  var mask = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), darkMat);
  mask.position.y = 0.88; grp.add(mask);
  var armL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.7, 6), bodyMat);
  armL.position.set(0, 0.25, 0.5); armL.rotation.x = 0.5; grp.add(armL);
  var armR = armL.clone(); armR.position.z = -0.5; armR.rotation.x = -0.5; grp.add(armR);
  var legL = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.10, 0.8, 8), darkMat);
  legL.position.set(0, -0.75, 0.18); grp.add(legL);
  var legR = legL.clone(); legR.position.z = -0.18; grp.add(legR);
  var finGeo = new THREE.BoxGeometry(0.55, 0.06, 0.22);
  var finMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  var finL = new THREE.Mesh(finGeo, finMat);
  finL.position.set(0.18, -1.15, 0.18); grp.add(finL);
  var finR = finL.clone(); finR.position.z = -0.18; grp.add(finR);
  if (isHuman) {
    var marker = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), new THREE.MeshBasicMaterial({ color: 0xffee33 }));
    marker.position.y = 1.6; marker.rotation.x = Math.PI; grp.add(marker);
  }
  grp.userData.legs = [legL, legR, finL, finR];
  scene.add(grp);
  return grp;
}

function buildMedicMesh() {
  var grp = new THREE.Group();
  var white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  var red = new THREE.MeshLambertMaterial({ color: 0xe03030 });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.32, 1.0, 10), white);
  grp.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf0c090 }));
  head.position.y = 0.8; grp.add(head);
  var crossV = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.45, 0.12), red);
  crossV.position.set(0.41, 0.2, 0); grp.add(crossV);
  var crossH = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.45), red);
  crossH.position.set(0.41, 0.2, 0); grp.add(crossH);
  scene.add(grp);
  return grp;
}

function makePlayer(team, idx, isHuman, role) {
  return {
    team: team, idx: idx, human: isHuman, role: role, // role: 'field' | 'keeper'
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: team === TEAM_BLUE ? Math.PI / 2 : -Math.PI / 2,
    o2: o2Capacity(), blackout: false, ko: null,
    kickCd: 0, aiState: 'field', surfaceDuty: false, aiRole: 'defend',
    mesh: buildPlayerMesh(team, isHuman, role === 'keeper'),
    swimPhase: Math.random() * 6
  };
}

var players = [];
var human;
(function () {
  // синие: человек + вратарь + 3 полевых бота
  players.push(makePlayer(TEAM_BLUE, 0, true, 'field'));
  players.push(makePlayer(TEAM_BLUE, 1, false, 'keeper'));
  players.push(makePlayer(TEAM_BLUE, 2, false, 'field'));
  players.push(makePlayer(TEAM_BLUE, 3, false, 'field'));
  players.push(makePlayer(TEAM_BLUE, 4, false, 'field'));
  // оранжевые: вратарь + 4 полевых бота
  players.push(makePlayer(TEAM_ORANGE, 0, false, 'keeper'));
  players.push(makePlayer(TEAM_ORANGE, 1, false, 'field'));
  players.push(makePlayer(TEAM_ORANGE, 2, false, 'field'));
  players.push(makePlayer(TEAM_ORANGE, 3, false, 'field'));
  players.push(makePlayer(TEAM_ORANGE, 4, false, 'field'));
  human = players[0];
})();

function resetPositions() {
  var blue = [
    new THREE.Vector3(-7, 8, 0),                       // человек
    new THREE.Vector3(-GOAL_LINE + 2.5, 3, 0),         // вратарь
    new THREE.Vector3(-16, 9, -9),
    new THREE.Vector3(-16, 9, 9),
    new THREE.Vector3(-26, 7, 0)
  ];
  var orange = [
    new THREE.Vector3(GOAL_LINE - 2.5, 3, 0),          // вратарь
    new THREE.Vector3(7, 8, 0),
    new THREE.Vector3(16, 9, -9),
    new THREE.Vector3(16, 9, 9),
    new THREE.Vector3(26, 7, 0)
  ];
  players.forEach(function (p, i) {
    var base = (p.team === TEAM_BLUE ? blue[p.idx] : orange[p.idx]).clone();
    p.pos.copy(base);
    p.vel.set(0, 0, 0);
    p.yaw = p.team === TEAM_BLUE ? Math.PI / 2 : -Math.PI / 2;
    p.kickCd = 0;
  });
  ball.pos.set(0, 6, 0);
  ball.vel.set(0, 0, 0);
  for (var i = 0; i < TRAIL_N; i++) { trailPts[i * 3] = 0; trailPts[i * 3 + 1] = 6; trailPts[i * 3 + 2] = 0; }
  trailGeo.attributes.position.needsUpdate = true;
}

// --- Пузыри
var BUBBLES = 220;
var bubbleGeo = new THREE.BufferGeometry();
var bubblePos = new Float32Array(BUBBLES * 3);
var bubbleSpd = new Float32Array(BUBBLES);
for (var bi = 0; bi < BUBBLES; bi++) {
  bubblePos[bi * 3] = (Math.random() * 2 - 1) * POOL.hx;
  bubblePos[bi * 3 + 1] = Math.random() * POOL.top;
  bubblePos[bi * 3 + 2] = (Math.random() * 2 - 1) * POOL.hz;
  bubbleSpd[bi] = 0.6 + Math.random() * 1.4;
}
bubbleGeo.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
var bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({ color: 0xcfeaff, size: 0.16, transparent: true, opacity: 0.7 }));
scene.add(bubbles);

// ============================== ВВОД ==============================
var input = { mx: 0, mz: 0, vy: 0, camx: 0, sprint: false };
var keys = {};
window.addEventListener('keydown', function (e) {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyJ') startCharge('pass');
  if (e.code === 'KeyK') startCharge('shot');
  if (e.code === 'KeyL') startCharge('lob');
});
window.addEventListener('keyup', function (e) {
  keys[e.code] = false;
  if (e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'KeyL') releaseCharge();
});

// --- Левый джойстик (движение в горизонтальной плоскости)
var joy = { active: false, id: null, bx: 0, by: 0, dx: 0, dy: 0 };
var joyBase = document.getElementById('joy-base');
var joyKnob = document.getElementById('joy-knob');
var JOY_R = 55;

function setJoy(dx, dy) {
  var len = Math.hypot(dx, dy);
  if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
  joy.dx = dx / JOY_R; joy.dy = dy / JOY_R;
  joyKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
}

var touchArea = document.getElementById('game');
touchArea.addEventListener('touchstart', function (e) {
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i];
    if (t.clientX < window.innerWidth * 0.42 && !joy.active) {
      joy.active = true; joy.id = t.identifier; joy.bx = t.clientX; joy.by = t.clientY;
      joyBase.style.display = 'block';
      joyBase.style.left = (t.clientX - 60) + 'px';
      joyBase.style.top = (t.clientY - 60) + 'px';
      setJoy(0, 0);
    }
  }
  e.preventDefault();
}, { passive: false });
touchArea.addEventListener('touchmove', function (e) {
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i];
    if (joy.active && t.identifier === joy.id) setJoy(t.clientX - joy.bx, t.clientY - joy.by);
  }
  e.preventDefault();
}, { passive: false });
function endTouch(e) {
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i];
    if (joy.active && t.identifier === joy.id) {
      joy.active = false; joy.id = null; joy.dx = 0; joy.dy = 0;
      joyBase.style.display = 'none';
    }
  }
  e.preventDefault();
}
touchArea.addEventListener('touchend', endTouch, { passive: false });
touchArea.addEventListener('touchcancel', endTouch, { passive: false });

// --- Правый джойстик-«мяч» (вверх/вниз + поворот камеры)
var rjoy = { active: false, id: null, dx: 0, dy: 0 };
var rjoyBase = document.getElementById('rjoy-base');
var rjoyKnob = document.getElementById('rjoy-knob');
var RJOY_R = 46;

function setRJoy(dx, dy) {
  var len = Math.hypot(dx, dy);
  if (len > RJOY_R) { dx *= RJOY_R / len; dy *= RJOY_R / len; }
  rjoy.dx = dx / RJOY_R; rjoy.dy = dy / RJOY_R;
  rjoyKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
}
rjoyBase.addEventListener('touchstart', function (e) {
  var t = e.changedTouches[0];
  if (!rjoy.active) { rjoy.active = true; rjoy.id = t.identifier; }
  e.preventDefault(); e.stopPropagation();
}, { passive: false });
rjoyBase.addEventListener('touchmove', function (e) {
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i];
    if (rjoy.active && t.identifier === rjoy.id) {
      var rect = rjoyBase.getBoundingClientRect();
      setRJoy(t.clientX - (rect.left + rect.width / 2), t.clientY - (rect.top + rect.height / 2));
    }
  }
  e.preventDefault(); e.stopPropagation();
}, { passive: false });
function endRJoy(e) {
  for (var i = 0; i < e.changedTouches.length; i++) {
    if (rjoy.active && e.changedTouches[i].identifier === rjoy.id) {
      rjoy.active = false; rjoy.id = null; rjoy.dx = 0; rjoy.dy = 0;
      rjoyKnob.style.transform = 'translate(0,0)';
    }
  }
  e.preventDefault(); e.stopPropagation();
}
rjoyBase.addEventListener('touchend', endRJoy, { passive: false });
rjoyBase.addEventListener('touchcancel', endRJoy, { passive: false });

// --- Кнопки действий: ПАС / УДАР / НАВЕС (удержание = сила), спринт
var charge = { action: null, t: 0 };
function startCharge(action) {
  if (state !== 'play' || human.blackout || charge.action) return;
  charge.action = action; charge.t = 0;
  document.getElementById('power-wrap').style.display = 'block';
}
function releaseCharge() {
  if (!charge.action) return;
  var action = charge.action, power01 = Math.min(1, charge.t / CHARGE_TIME);
  charge.action = null;
  document.getElementById('power-wrap').style.display = 'none';
  aimLine.visible = false;
  if (state !== 'play' || human.blackout) return;
  if (ball.pos.distanceTo(human.pos) > ACTION_RANGE) { showMessage('Мяч слишком далеко!'); return; }
  if (human.kickCd > 0) return;
  executeAction(human, action, 0.35 + 0.65 * power01);
}

function bindActionButton(id, action) {
  var el = document.getElementById(id);
  function on(e) { startCharge(action); el.classList.add('pressed'); e.preventDefault(); e.stopPropagation(); }
  function off(e) { releaseCharge(); el.classList.remove('pressed'); e.preventDefault(); e.stopPropagation(); }
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', function (e) { if (charge.action === action) off(e); });
}
bindActionButton('btn-pass', 'pass');
bindActionButton('btn-shot', 'shot');
bindActionButton('btn-lob', 'lob');

var sprintHeld = false;
(function () {
  var el = document.getElementById('btn-sprint');
  function on(e) { sprintHeld = true; el.classList.add('pressed'); e.preventDefault(); e.stopPropagation(); }
  function off(e) { sprintHeld = false; el.classList.remove('pressed'); e.preventDefault(); e.stopPropagation(); }
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
})();

function readInput() {
  var kx = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  var kz = (keys['KeyS'] ? 1 : 0) - (keys['KeyW'] ? 1 : 0);
  input.mx = joy.active ? joy.dx : kx;
  input.mz = joy.active ? joy.dy : kz;
  var kvy = (keys['Space'] ? 1 : 0) - (keys['KeyC'] ? 1 : 0);
  input.vy = rjoy.active ? -rjoy.dy : kvy;
  var kcam = (keys['KeyE'] ? 1 : 0) - (keys['KeyQ'] ? 1 : 0);
  input.camx = rjoy.active ? rjoy.dx : kcam;
  input.sprint = sprintHeld || !!keys['ShiftLeft'] || !!keys['ShiftRight'];
}

// сглаживание ввода
var smooth = { mx: 0, mz: 0, y: 0 };
function smoothInput(dt) {
  var k = Math.min(1, 11 * dt);
  var tx = input.mx * Math.abs(input.mx);
  var tz = input.mz * Math.abs(input.mz);
  var ty = Math.abs(input.vy) < 0.12 ? 0 : input.vy;
  if (Math.hypot(tx, tz) < 0.04) { tx = 0; tz = 0; }
  smooth.mx += (tx - smooth.mx) * k;
  smooth.mz += (tz - smooth.mz) * k;
  smooth.y += (ty - smooth.y) * k;
}

// ============================== ДЕЙСТВИЯ С МЯЧОМ ==============================
function enemyGoalX(team) { return team === TEAM_BLUE ? GOAL_LINE : -GOAL_LINE; }

function aimDirection(p, action) {
  // прицел: направление от мяча к цели с учётом глубины (геометрически честно)
  var goal = new THREE.Vector3(enemyGoalX(p.team), GOAL.h * 0.45, 0);
  var toGoal = goal.clone().sub(ball.pos).normalize();
  var fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  var dir = fwd.multiplyScalar(0.35).add(toGoal.multiplyScalar(0.65)).normalize();
  if (action === 'lob') { dir.y += 0.55; dir.normalize(); }
  return dir;
}

function actionPower(action, power01) {
  if (action === 'shot') return 12 + 14 * power01;
  if (action === 'lob') return 10 + 11 * power01;
  return 0; // пас считает сам
}

function bestPassMate(p) {
  var best = null, bestScore = -1e9;
  players.forEach(function (q) {
    if (q.team !== p.team || q === p || q.ko) return;
    var d = q.pos.distanceTo(ball.pos);
    if (d < 2 || d > 34) return;
    // вперёд к чужим воротам — лучше
    var forward = (q.pos.x - p.pos.x) * (p.team === TEAM_BLUE ? 1 : -1);
    var sc = forward - d * 0.4 - (q.role === 'keeper' ? 20 : 0);
    if (sc > bestScore) { bestScore = sc; best = q; }
  });
  return best;
}

function executeAction(p, action, power01) {
  p.kickCd = KICK_COOLDOWN;
  var dir, pow;
  if (action === 'pass') {
    var mate = bestPassMate(p);
    if (mate) {
      var lead = mate.pos.clone().addScaledVector(mate.vel, 0.35);
      dir = lead.sub(ball.pos);
      var d = dir.length();
      dir.normalize();
      pow = Math.min(20, Math.max(9, d * 0.85)) * (0.6 + 0.4 * power01);
    } else {
      dir = aimDirection(p, 'shot'); pow = 12 * power01 + 8;
    }
  } else {
    dir = aimDirection(p, action);
    pow = actionPower(action, power01);
  }
  ball.vel.copy(dir.multiplyScalar(pow)).addScaledVector(p.vel, 0.35);
  spawnKickBubbles(ball.pos);
}

// удар бота (с ошибкой по сложности для соперника)
function botKick(p, powMult) {
  p.kickCd = KICK_COOLDOWN;
  var err = p.team === TEAM_ORANGE ? diff().err : 0.2;
  var goal = new THREE.Vector3(enemyGoalX(p.team), GOAL.h * 0.45, (Math.random() * 2 - 1) * GOAL.hw * 0.6);
  var dir = goal.sub(ball.pos).normalize();
  dir.add(new THREE.Vector3((Math.random() - 0.5) * err, (Math.random() - 0.5) * err * 0.7, (Math.random() - 0.5) * err)).normalize();
  var pow = (14 + Math.random() * 7) * powMult;
  ball.vel.copy(dir.multiplyScalar(pow)).addScaledVector(p.vel, 0.35);
  spawnKickBubbles(ball.pos);
}

// траектория для прицела: та же физика, что у мяча
function updateAimLine() {
  if (!charge.action) { aimLine.visible = false; return; }
  if (ball.pos.distanceTo(human.pos) > ACTION_RANGE * 1.3) { aimLine.visible = false; return; }
  var power01 = Math.min(1, charge.t / CHARGE_TIME);
  var dir, pow;
  if (charge.action === 'pass') {
    var mate = bestPassMate(human);
    if (!mate) { aimLine.visible = false; return; }
    dir = mate.pos.clone().sub(ball.pos);
    var d = dir.length(); dir.normalize();
    pow = Math.min(20, Math.max(9, d * 0.85)) * (0.6 + 0.4 * power01);
  } else {
    dir = aimDirection(human, charge.action);
    pow = actionPower(charge.action, 0.35 + 0.65 * power01);
  }
  var pos = ball.pos.clone();
  var vel = dir.clone().multiplyScalar(pow);
  var sdt = 0.07;
  for (var i = 0; i < AIM_N; i++) {
    aimPts[i * 3] = pos.x; aimPts[i * 3 + 1] = pos.y; aimPts[i * 3 + 2] = pos.z;
    vel.y += BALL_GRAV * sdt;
    vel.multiplyScalar(1 - Math.min(1, BALL_DRAG * sdt));
    pos.addScaledVector(vel, sdt);
    if (pos.y < BALL_R || pos.y > POOL.top || Math.abs(pos.x) > POOL.hx || Math.abs(pos.z) > POOL.hz) {
      for (var j = i + 1; j < AIM_N; j++) { aimPts[j * 3] = pos.x; aimPts[j * 3 + 1] = pos.y; aimPts[j * 3 + 2] = pos.z; }
      break;
    }
  }
  aimGeo.attributes.position.needsUpdate = true;
  aimLine.visible = true;
}

// ============================== ИГРОК-ЧЕЛОВЕК ==============================
var stamina = STAMINA_MAX;

function updateHuman(p, dt) {
  if (p.ko) return; // им занимаются медики
  var cap = o2Capacity();

  // спринт: тратит энергию; восстановление зависит от усталости и кислорода
  var sprinting = input.sprint && stamina > 4 && !p.blackout;
  if (sprinting) stamina = Math.max(0, stamina - STAMINA_DRAIN * dt);
  else stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN * (0.45 + 0.55 * (p.o2 / cap)) * dt);

  var fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  var right = new THREE.Vector3(fwd.z, 0, -fwd.x).negate();
  var acc = new THREE.Vector3();
  acc.addScaledVector(fwd, -smooth.mz);
  acc.addScaledVector(right, smooth.mx);
  if (acc.lengthSq() > 1) acc.normalize();
  acc.y += smooth.y;
  // мало воздуха → всплытие с ускорением
  if (smooth.y > 0 && p.o2 < cap * O2_BOOST_THRESHOLD) acc.y += smooth.y * 0.9;

  var mult = sprinting ? SPRINT_MULT : 1;
  p.vel.addScaledVector(acc, PLAYER_ACCEL * mult * dt);
  p.vel.multiplyScalar(1 - Math.min(1, WATER_DRAG_P * dt));
  var maxs = PLAYER_MAXSPD * mult;
  if (p.vel.length() > maxs) p.vel.setLength(maxs);
  if (acc.lengthSq() > 0.01 && (smooth.mx || smooth.mz)) {
    p.yaw = lerpAngle(p.yaw, Math.atan2(acc.x, acc.z), Math.min(1, 10 * dt));
  }
}

// ============================== ИИ ==============================
function fieldBots(team) {
  return players.filter(function (q) { return q.team === team && !q.human && q.role === 'field'; });
}

function updateTeamDuty(team) {
  var members = players.filter(function (q) { return q.team === team; });
  var bots = fieldBots(team).filter(function (q) { return !q.ko; });
  var someoneUp = members.some(function (q) { return atSurface(q) || q.aiState === 'surfacing'; });
  var duty = bots.find(function (q) { return q.surfaceDuty; });
  if (!duty && !someoneUp && bots.length) {
    bots.sort(function (a, b) { return a.o2 - b.o2; });
    bots[0].surfaceDuty = true;
  }
  if (duty && duty.o2 > o2Capacity() * 0.95) {
    var next = bots.filter(function (q) { return q !== duty; }).sort(function (a, b) { return a.o2 - b.o2; })[0];
    if (next && next.o2 < o2Capacity() * 0.55) {
      duty.surfaceDuty = false;
      next.surfaceDuty = true;
    }
  }
}

function teamStrategy(team) {
  if (team === TEAM_BLUE) return strategy;
  return diff().strat;
}

function assignRoles(team) {
  var bots = fieldBots(team).filter(function (q) {
    return !q.ko && q.aiState === 'field';
  });
  bots.sort(function (a, b) { return a.pos.distanceTo(ball.pos) - b.pos.distanceTo(ball.pos); });
  var st = teamStrategy(team);
  var n = bots.length;
  var attackers = st === 'agg' ? Math.ceil(n * 0.67) : st === 'mod' ? Math.ceil(n * 0.5) : Math.max(1, Math.floor(n * 0.34));
  bots.forEach(function (q, i) { q.aiRole = i < attackers ? 'attack' : 'defend'; });
}

function atSurface(p) { return p.pos.y > POOL.top - SURFACE_ZONE; }

function updateBot(p, dt) {
  if (p.ko) return;
  var cap = o2Capacity();
  var target = new THREE.Vector3();
  var wantKick = false;
  var spdMult = p.team === TEAM_ORANGE ? diff().spd : 0.94;
  var surfBoost = 1;

  var o2drain = p.role === 'keeper' ? 0.6 : 1;
  var mustSurface = p.o2 < cap * (p.role === 'keeper' ? 0.16 : 0.22) || p.surfaceDuty;
  if (mustSurface) p.aiState = atSurface(p) ? 'breathing' : 'surfacing';
  else if (p.aiState !== 'field' && p.o2 > cap * 0.93 && !p.surfaceDuty) p.aiState = 'field';

  if (p.aiState === 'surfacing' || p.aiState === 'breathing') {
    target.set(p.pos.x * 0.85, POOL.top - 0.7, p.pos.z * 0.85);
    if (p.aiState === 'surfacing' && p.o2 < cap * 0.25) surfBoost = 1.5; // всплывает с ускорением
  } else if (p.role === 'keeper') {
    var gx = -enemyGoalX(p.team);
    var onOurHalf = (ball.pos.x * (p.team === TEAM_BLUE ? 1 : -1)) < 0;
    target.set(
      gx + (p.team === TEAM_BLUE ? 1 : -1) * 2.2,
      onOurHalf ? THREE.MathUtils.clamp(ball.pos.y, 1.2, GOAL.h + 1) : 3,
      onOurHalf ? THREE.MathUtils.clamp(ball.pos.z, -GOAL.hw, GOAL.hw) : 0
    );
    // выносим мяч, если он рядом
    if (p.pos.distanceTo(ball.pos) < ACTION_RANGE && p.kickCd <= 0) wantKick = true;
  } else if (p.aiRole === 'attack') {
    var behind = ball.pos.clone();
    behind.x += (p.team === TEAM_BLUE ? -1 : 1) * 1.2;
    target.copy(behind);
    if (p.pos.distanceTo(ball.pos) < ACTION_RANGE * 0.95 && p.kickCd <= 0) wantKick = true;
  } else {
    var ownX = -enemyGoalX(p.team);
    var st = teamStrategy(p.team);
    var depth = st === 'agg' ? 2.0 : st === 'def' ? 3.0 : 2.4;
    target.set((ball.pos.x + ownX * 1.4) / depth, Math.max(3, ball.pos.y), ball.pos.z * 0.5);
  }

  var acc = target.sub(p.pos);
  if (acc.length() > 0.3) {
    acc.normalize();
    p.vel.addScaledVector(acc, PLAYER_ACCEL * 0.85 * spdMult * surfBoost * dt);
  }
  p.vel.multiplyScalar(1 - Math.min(1, WATER_DRAG_P * dt));
  var ms = PLAYER_MAXSPD * 0.92 * spdMult * surfBoost;
  if (p.vel.length() > ms) p.vel.setLength(ms);
  if (p.vel.lengthSq() > 0.05) p.yaw = lerpAngle(p.yaw, Math.atan2(p.vel.x, p.vel.z), Math.min(1, 8 * dt));
  if (wantKick) botKick(p, p.team === TEAM_ORANGE ? diff().pow : 0.92);
  p._o2drain = o2drain;
}

// ============================== КИСЛОРОД И МЕДИКИ ==============================
function updateOxygen(p, dt) {
  if (p.ko) return;
  var cap = o2Capacity();
  if (atSurface(p)) {
    p.o2 = Math.min(cap, p.o2 + (cap / O2_REFILL_TIME) * dt);
    if (p.blackout && p.o2 > cap * 0.9) p.blackout = false;
  } else {
    p.o2 = Math.max(0, p.o2 - dt * (p._o2drain || 1));
    if (p.o2 <= 0 && !p.blackout) startRescue(p);
  }
}

function startRescue(p) {
  p.blackout = true;
  p.vel.set(0, 0, 0);
  p.surfaceDuty = false;
  p.ko = {
    phase: 'descend', t: 0,
    medics: [buildMedicMesh(), buildMedicMesh()],
    mpos: [
      new THREE.Vector3(p.pos.x - 1.2, POOL.top, p.pos.z),
      new THREE.Vector3(p.pos.x + 1.2, POOL.top, p.pos.z)
    ]
  };
  if (p.human) showMessage('😵 Ты отключился! Медики уже плывут…');
}

function updateRescue(p, dt) {
  var ko = p.ko;
  if (!ko) return;
  ko.t += dt;
  var i, m, targ;
  if (ko.phase === 'descend') {
    var done = true;
    for (i = 0; i < 2; i++) {
      targ = p.pos.clone(); targ.x += i === 0 ? -0.9 : 0.9;
      var d = targ.clone().sub(ko.mpos[i]);
      if (d.length() > 0.3) { done = false; ko.mpos[i].addScaledVector(d.normalize(), 9 * dt); }
    }
    p.vel.multiplyScalar(1 - Math.min(1, 3 * dt)); // обмякший игрок дрейфует
    p.pos.addScaledVector(p.vel, dt);
    if (done) ko.phase = 'carry';
  } else if (ko.phase === 'carry') {
    var up = Math.min(7 * dt, POOL.top - 0.8 - p.pos.y);
    p.pos.y += up;
    ko.mpos[0].set(p.pos.x - 0.9, p.pos.y, p.pos.z);
    ko.mpos[1].set(p.pos.x + 0.9, p.pos.y, p.pos.z);
    if (p.pos.y >= POOL.top - 0.85) { ko.phase = 'revive'; ko.t = 0; }
  } else if (ko.phase === 'revive') {
    // откачивают ~2.5 секунды у поверхности
    ko.mpos[0].set(p.pos.x - 0.9, p.pos.y + Math.sin(ko.t * 6) * 0.1, p.pos.z);
    ko.mpos[1].set(p.pos.x + 0.9, p.pos.y - Math.sin(ko.t * 6) * 0.1, p.pos.z);
    if ((ko.t * 4 | 0) % 2 === 0) spawnKickBubbles(p.pos);
    if (ko.t > 2.5) {
      p.o2 = o2Capacity();
      p.blackout = false;
      p.vel.set(0, -3, 0); // заряжен — ныряет обратно
      ko.medics.forEach(function (mm) { scene.remove(mm); });
      p.ko = null;
      if (p.human) showMessage('💪 Откачали! Снова в игру');
      return;
    }
  }
  for (i = 0; i < 2; i++) {
    m = ko.medics[i];
    m.position.copy(ko.mpos[i]);
    m.lookAt(p.pos.x, ko.mpos[i].y, p.pos.z);
  }
}

// ============================== МЯЧ ==============================
function updateBall(dt) {
  ball.vel.y += BALL_GRAV * dt;
  ball.vel.multiplyScalar(1 - Math.min(1, BALL_DRAG * dt));
  ball.pos.addScaledVector(ball.vel, dt);

  var inGoalZ = Math.abs(ball.pos.z) < GOAL.hw - BALL_R * 0.5;
  var inGoalY = ball.pos.y < GOAL.h - BALL_R * 0.5;
  var limX = (inGoalZ && inGoalY) ? POOL.hx - BALL_R : GOAL_LINE - BALL_R;
  if (ball.pos.x < -limX) { ball.pos.x = -limX; ball.vel.x = Math.abs(ball.vel.x) * BALL_REST; }
  if (ball.pos.x > limX) { ball.pos.x = limX; ball.vel.x = -Math.abs(ball.vel.x) * BALL_REST; }
  if (ball.pos.z < -POOL.hz + BALL_R) { ball.pos.z = -POOL.hz + BALL_R; ball.vel.z = Math.abs(ball.vel.z) * BALL_REST; }
  if (ball.pos.z > POOL.hz - BALL_R) { ball.pos.z = POOL.hz - BALL_R; ball.vel.z = -Math.abs(ball.vel.z) * BALL_REST; }
  if (ball.pos.y < BALL_R) { ball.pos.y = BALL_R; ball.vel.y = Math.abs(ball.vel.y) * BALL_REST; ball.vel.x *= 0.92; ball.vel.z *= 0.92; }
  if (ball.pos.y > POOL.top - BALL_R * 0.3) { ball.pos.y = POOL.top - BALL_R * 0.3; ball.vel.y = -Math.abs(ball.vel.y) * 0.5; }

  players.forEach(function (p) {
    if (p.ko) return;
    var d = ball.pos.distanceTo(p.pos);
    var minD = BALL_R + PLAYER_R;
    if (d < minD && d > 0.001) {
      var n = ball.pos.clone().sub(p.pos).normalize();
      ball.pos.copy(p.pos).addScaledVector(n, minD);
      var rel = ball.vel.clone().sub(p.vel);
      var vn = rel.dot(n);
      if (vn < 0) ball.vel.addScaledVector(n, -vn * 1.4);
      ball.vel.addScaledVector(p.vel, 0.25);
    }
  });

  if (Math.abs(ball.pos.x) > GOAL_LINE + BALL_R * 0.25 && inGoalZ && inGoalY) {
    onGoal(ball.pos.x > 0 ? TEAM_BLUE : TEAM_ORANGE);
  }

  // белый след
  trailTimer += dt;
  if (trailTimer > 0.03) {
    trailTimer = 0;
    for (var i = TRAIL_N - 1; i > 0; i--) {
      trailPts[i * 3] = trailPts[(i - 1) * 3];
      trailPts[i * 3 + 1] = trailPts[(i - 1) * 3 + 1];
      trailPts[i * 3 + 2] = trailPts[(i - 1) * 3 + 2];
    }
    trailPts[0] = ball.pos.x; trailPts[1] = ball.pos.y; trailPts[2] = ball.pos.z;
    trailGeo.attributes.position.needsUpdate = true;
  }
  trailLine.visible = ball.vel.length() > 4;
}

function onGoal(team) {
  score[team]++;
  if (team === TEAM_BLUE) {
    save.coins += COINS_GOAL;
    coinsEarnedThisMatch += COINS_GOAL;
    persistSave();
    showMessage('⚽ ГОЛ! +' + COINS_GOAL + ' монет');
  } else {
    showMessage('Гол в наши ворота…');
  }
  state = 'goalpause';
  goalPauseT = 2.2;
  updateHud();
}

function separatePlayers() {
  for (var i = 0; i < players.length; i++)
    for (var j = i + 1; j < players.length; j++) {
      var a = players[i], b = players[j];
      if (a.ko || b.ko) continue;
      var d = a.pos.distanceTo(b.pos);
      var minD = PLAYER_R * 2;
      if (d < minD && d > 0.001) {
        var n = b.pos.clone().sub(a.pos).normalize();
        var push = (minD - d) / 2;
        a.pos.addScaledVector(n, -push);
        b.pos.addScaledVector(n, push);
      }
    }
}

function clampToPool(p, r) {
  if (p.pos.x < -POOL.hx + r) { p.pos.x = -POOL.hx + r; p.vel.x = Math.abs(p.vel.x) * 0.2; }
  if (p.pos.x > POOL.hx - r) { p.pos.x = POOL.hx - r; p.vel.x = -Math.abs(p.vel.x) * 0.2; }
  if (p.pos.z < -POOL.hz + r) { p.pos.z = -POOL.hz + r; p.vel.z = Math.abs(p.vel.z) * 0.2; }
  if (p.pos.z > POOL.hz - r) { p.pos.z = POOL.hz - r; p.vel.z = -Math.abs(p.vel.z) * 0.2; }
  if (p.pos.y < r + 0.2) { p.pos.y = r + 0.2; p.vel.y = Math.max(0, p.vel.y); }
  if (p.pos.y > POOL.top - 0.5) { p.pos.y = POOL.top - 0.5; p.vel.y = Math.min(0, p.vel.y); }
}

// ============================== ЭФФЕКТЫ ==============================
function spawnKickBubbles(pos) {
  for (var i = 0; i < 10; i++) {
    var idx = (Math.random() * BUBBLES) | 0;
    bubblePos[idx * 3] = pos.x + (Math.random() - 0.5);
    bubblePos[idx * 3 + 1] = pos.y + (Math.random() - 0.5);
    bubblePos[idx * 3 + 2] = pos.z + (Math.random() - 0.5);
  }
}

function updateBubbles(dt) {
  for (var i = 0; i < BUBBLES; i++) {
    bubblePos[i * 3 + 1] += bubbleSpd[i] * dt;
    if (bubblePos[i * 3 + 1] > POOL.top) {
      bubblePos[i * 3 + 1] = 0.5;
      bubblePos[i * 3] = (Math.random() * 2 - 1) * POOL.hx;
      bubblePos[i * 3 + 2] = (Math.random() * 2 - 1) * POOL.hz;
    }
  }
  bubbleGeo.attributes.position.needsUpdate = true;
}

var surfT = 0;
function updateSurface(dt) {
  surfT += dt;
  var arr = surfGeo.attributes.position.array;
  for (var i = 0; i < arr.length; i += 3) {
    arr[i + 2] = surfBase[i + 2] + Math.sin(surfT * 1.6 + surfBase[i] * 0.35 + surfBase[i + 1] * 0.5) * 0.25;
  }
  surfGeo.attributes.position.needsUpdate = true;
}

// ============================== КАМЕРА ==============================
var camPos = new THREE.Vector3(0, 8, 14);
var camYaw = Math.PI / 2;
function updateCamera(dt) {
  // правый джойстик крутит камеру; без ввода — мягко следует за игроком
  if (Math.abs(input.camx) > 0.15) {
    camYaw -= input.camx * 2.6 * dt;
  } else if (Math.hypot(smooth.mx, smooth.mz) > 0.2) {
    camYaw = lerpAngle(camYaw, human.yaw, Math.min(1, 1.6 * dt));
  }
  var back = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw)).multiplyScalar(-8);
  var want = human.pos.clone().add(back);
  want.y = Math.min(POOL.top - 0.6, Math.max(2, human.pos.y + 2.6));
  camPos.lerp(want, Math.min(1, 4.2 * dt));
  camPos.x = Math.max(-POOL.hx + 1, Math.min(POOL.hx - 1, camPos.x));
  camPos.z = Math.max(-POOL.hz + 1, Math.min(POOL.hz - 1, camPos.z));
  camera.position.copy(camPos);
  var look = human.pos.clone();
  look.y += 0.8;
  camera.lookAt(look);
}

// ============================== HUD ==============================
var elScore = document.getElementById('score');
var elTimer = document.getElementById('timer');
var elCoins = document.getElementById('coins');
var elO2 = document.getElementById('o2-fill');
var elO2Wrap = document.getElementById('o2-bar');
var elSt = document.getElementById('st-fill');
var elMsg = document.getElementById('message');
var elTeamO2 = document.getElementById('team-o2');
var elBreathe = document.getElementById('breathe-hint');
var elPower = document.getElementById('power-fill');
var elBallArrow = document.getElementById('ball-arrow');
var actionBtns = ['btn-pass', 'btn-shot', 'btn-lob'].map(function (id) { return document.getElementById(id); });

function gameClock() {
  var min = Math.min(HALF_GAME_MIN, Math.floor(halfElapsed / HALF_REAL * HALF_GAME_MIN) + (half === 2 ? HALF_GAME_MIN : 0));
  return min + '′';
}

function updateHud() {
  elScore.textContent = score[0] + ' : ' + score[1];
  elCoins.textContent = '🪙 ' + save.coins;
}

function updateHudFrame() {
  elTimer.textContent = (half === 1 ? '1-й тайм · ' : '2-й тайм · ') + gameClock();
  var cap = o2Capacity();
  var r = human.o2 / cap;
  elO2.style.width = (r * 100).toFixed(1) + '%';
  elO2.style.background = r > 0.4 ? '#3ad1ff' : (r > 0.18 ? '#ffc93a' : '#ff4d4d');
  elO2Wrap.classList.toggle('low', r <= 0.18 && !atSurface(human));
  elSt.style.width = (stamina / STAMINA_MAX * 100).toFixed(1) + '%';
  elBreathe.style.display = atSurface(human) ? 'block' : 'none';

  var html = '';
  players.forEach(function (p) {
    if (p.team !== TEAM_BLUE || p.human) return;
    var rr = (p.o2 / cap * 100).toFixed(0);
    html += '<div class="mate' + (p.role === 'keeper' ? ' keeper' : '') + '"><div class="mate-fill" style="width:' + rr + '%"></div></div>';
  });
  elTeamO2.innerHTML = html;

  var inRange = ball.pos.distanceTo(human.pos) < ACTION_RANGE && !human.blackout;
  actionBtns.forEach(function (b) { b.classList.toggle('ready', inRange); });

  if (charge.action) {
    charge.t += lastDt;
    elPower.style.height = (Math.min(1, charge.t / CHARGE_TIME) * 100).toFixed(1) + '%';
  }

  updateBallArrow();
}

// стрелка на мяч, когда он вне экрана
function updateBallArrow() {
  var v = ball.pos.clone().project(camera);
  var behind = v.z > 1;
  var onScreen = !behind && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.85;
  if (onScreen || state !== 'play') { elBallArrow.style.display = 'none'; return; }
  var dx = v.x, dy = v.y;
  if (behind) { dx = -dx; dy = -dy; }
  var ang = Math.atan2(dy, dx);
  var W = window.innerWidth, H = window.innerHeight;
  var margin = 54;
  var cx = W / 2, cy = H / 2;
  var ex = Math.cos(ang), ey = -Math.sin(ang); // экранные координаты (y вниз)
  var scale = Math.min((cx - margin) / Math.abs(ex || 1e-6), (cy - margin) / Math.abs(ey || 1e-6));
  var px = cx + ex * scale, py = cy + ey * scale;
  elBallArrow.style.display = 'block';
  elBallArrow.style.left = px + 'px';
  elBallArrow.style.top = py + 'px';
  elBallArrow.style.transform = 'translate(-50%,-50%) rotate(' + Math.atan2(ey, ex) + 'rad)';
}

var message = '', messageT = 0;
function showMessage(txt) {
  message = txt; messageT = 2.5;
  elMsg.textContent = txt;
  elMsg.style.opacity = 1;
}

// ============================== ЭКРАНЫ ==============================
var elMenu = document.getElementById('menu');
var elSetup = document.getElementById('setup');
var elShop = document.getElementById('shop');
var elEnd = document.getElementById('end');
var elHalftime = document.getElementById('halftime');

function refreshShop() {
  document.getElementById('shop-coins').textContent = save.coins;
  document.getElementById('shop-level').textContent = save.o2Level;
  document.getElementById('shop-capacity').textContent = Math.round(o2Capacity()) + ' сек';
  var btn = document.getElementById('btn-buy');
  btn.textContent = 'Прокачать дыхание — 🪙 ' + upgradeCost();
  btn.disabled = save.coins < upgradeCost();
}

function refreshSetup() {
  ['easy', 'mid', 'hard'].forEach(function (d) {
    document.getElementById('diff-' + d).classList.toggle('sel', difficulty === d);
  });
  ['agg', 'mod', 'def'].forEach(function (s) {
    document.getElementById('strat-' + s).classList.toggle('sel', strategy === s);
  });
}

function startMatch() {
  score = [0, 0];
  half = 1;
  halfElapsed = 0;
  coinsEarnedThisMatch = 0;
  stamina = STAMINA_MAX;
  players.forEach(function (p) {
    p.o2 = o2Capacity(); p.blackout = false; p.surfaceDuty = false; p.aiState = 'field';
    if (p.ko) { p.ko.medics.forEach(function (m) { scene.remove(m); }); p.ko = null; }
  });
  resetPositions();
  state = 'play';
  elMenu.style.display = 'none';
  elSetup.style.display = 'none';
  elEnd.style.display = 'none';
  elShop.style.display = 'none';
  elHalftime.style.display = 'none';
  updateHud();
  showMessage('⚽ ' + DIFFICULTIES[difficulty].name + ' · ' + STRATEGIES[strategy]);
}

function endMatch() {
  state = 'end';
  var won = score[0] > score[1];
  if (won) { save.coins += COINS_WIN; coinsEarnedThisMatch += COINS_WIN; persistSave(); }
  document.getElementById('end-title').textContent = won ? '🏆 Победа!' : (score[0] === score[1] ? '🤝 Ничья' : '😔 Поражение');
  document.getElementById('end-score').textContent = score[0] + ' : ' + score[1];
  document.getElementById('end-coins').textContent = '+' + coinsEarnedThisMatch + ' 🪙 за матч';
  elEnd.style.display = 'flex';
}

document.getElementById('btn-start').addEventListener('click', function () {
  refreshSetup();
  elMenu.style.display = 'none';
  elSetup.style.display = 'flex';
});
document.getElementById('btn-again').addEventListener('click', function () {
  elEnd.style.display = 'none';
  refreshSetup();
  elSetup.style.display = 'flex';
});
document.getElementById('btn-go').addEventListener('click', startMatch);
['easy', 'mid', 'hard'].forEach(function (d) {
  document.getElementById('diff-' + d).addEventListener('click', function () {
    difficulty = d; persistSave(); refreshSetup();
  });
});
['agg', 'mod', 'def'].forEach(function (s) {
  document.getElementById('strat-' + s).addEventListener('click', function () {
    strategy = s; persistSave(); refreshSetup();
  });
});
document.getElementById('btn-half-go').addEventListener('click', function () {
  elHalftime.style.display = 'none';
  half = 2;
  halfElapsed = 0;
  resetPositions();
  state = 'play';
  showMessage('2-й тайм!');
});

document.getElementById('btn-shop').addEventListener('click', function () {
  refreshShop(); elShop.style.display = 'flex';
});
document.getElementById('btn-shop-end').addEventListener('click', function () {
  refreshShop(); elShop.style.display = 'flex';
});
document.getElementById('btn-buy').addEventListener('click', function () {
  var cost = upgradeCost();
  if (save.coins >= cost) {
    save.coins -= cost;
    save.o2Level++;
    persistSave();
    refreshShop();
    updateHud();
    showMessage('Дыхание команды улучшено! Теперь ' + Math.round(o2Capacity()) + ' сек');
  }
});
document.getElementById('btn-close-shop').addEventListener('click', function () {
  elShop.style.display = 'none';
  if (state === 'shop') state = 'play';
});
document.getElementById('btn-pause').addEventListener('click', function () {
  if (state === 'play') {
    refreshShop();
    elShop.style.display = 'flex';
    state = 'shop';
  }
});

// ============================== ЦИКЛ ==============================
function lerpAngle(a, b, t) {
  var d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

var last = performance.now();
var lastDt = 0.016;
function tick(now) {
  requestAnimationFrame(tick);
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  lastDt = dt;

  if (state === 'play' || state === 'goalpause') {
    if (state === 'play') {
      halfElapsed += dt;
      if (halfElapsed >= HALF_REAL) {
        if (half === 1) {
          state = 'halftime';
          document.getElementById('half-score').textContent = score[0] + ' : ' + score[1];
          elHalftime.style.display = 'flex';
        } else {
          endMatch();
        }
      }
    } else {
      goalPauseT -= dt;
      if (goalPauseT <= 0) { resetPositions(); state = 'play'; }
    }

    readInput();
    smoothInput(dt);
    updateTeamDuty(TEAM_BLUE);
    updateTeamDuty(TEAM_ORANGE);
    assignRoles(TEAM_BLUE);
    assignRoles(TEAM_ORANGE);
    players.forEach(function (p) {
      p.kickCd = Math.max(0, p.kickCd - dt);
      if (p.ko) { updateRescue(p, dt); return; }
      if (p.human) updateHuman(p, dt); else updateBot(p, dt);
      p.pos.addScaledVector(p.vel, dt);
      clampToPool(p, PLAYER_R);
      updateOxygen(p, dt);
    });
    separatePlayers();
    if (state === 'play') updateBall(dt);
    updateAimLine();
    updateHudFrame();
  }

  if (messageT > 0) {
    messageT -= dt;
    if (messageT <= 0) elMsg.style.opacity = 0;
  }

  players.forEach(function (p) {
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.y = p.yaw;
    var spd = p.vel.length();
    p.swimPhase += dt * (2 + spd * 1.5);
    var legs = p.mesh.userData.legs;
    var k = Math.sin(p.swimPhase) * Math.min(0.5, spd * 0.1);
    if (legs) {
      legs[0].rotation.x = k; legs[2].rotation.x = k;
      legs[1].rotation.x = -k; legs[3].rotation.x = -k;
    }
    p.mesh.rotation.x = p.ko ? 0 : THREE.MathUtils.clamp(-p.vel.y * 0.06, -0.5, 0.5);
    p.mesh.rotation.z = p.ko && p.ko.phase !== 'revive' ? Math.PI / 2 : 0; // без сознания — лежит
  });
  ball.mesh.position.copy(ball.pos);
  ball.mesh.rotation.x += ball.vel.z * 0.01;
  ball.mesh.rotation.z -= ball.vel.x * 0.01;

  updateBubbles(dt);
  updateSurface(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

window.addEventListener('resize', function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// отладочный хук для автотестов
window.__UWF = {
  ball: ball, players: players,
  getScore: function () { return score.slice(); },
  getState: function () { return state; },
  getStamina: function () { return stamina; },
  setState: function (s) { state = s; },
  charge: charge, startCharge: startCharge, releaseCharge: releaseCharge
};

resetPositions();
updateHud();
refreshShop();
requestAnimationFrame(tick);
})();
