/* Подводный футбол — Underwater Football
 * Однофайловая 3D-игра на Three.js (r128), управление с телефона (тач) и клавиатуры.
 */
(function () {
'use strict';

// ============================== КОНСТАНТЫ ==============================
var POOL = { hx: 30, hz: 15, top: 18 };      // бассейн: x∈[-30,30], z∈[-15,15], y∈[0,18]
var SURFACE_ZONE = 1.4;                       // зона у поверхности, где можно дышать
var GOAL = { hw: 4.5, h: 5, depth: 1.6 };     // ворота: полуширина по z, высота, глубина за линией
var GOAL_LINE = POOL.hx - 1.0;                // линия ворот x=±29

var PLAYER_R = 0.75;
var PLAYER_ACCEL = 26;
var PLAYER_MAXSPD = 7.2;
var WATER_DRAG_P = 2.6;                       // сопротивление воды для игроков (1/с)

var BALL_R = 0.62;
var BALL_DRAG = 0.30;                         // маленькое сопротивление — мяч летит почти как на воздухе
var BALL_GRAV = -2.2;                         // медленно тонет
var BALL_REST = 0.72;                         // упругость отскока
var KICK_RANGE = 2.5;
var KICK_POWER = 27;
var KICK_COOLDOWN = 0.45;

var O2_BASE = 28;                             // секунд дыхания на базовом уровне
var O2_PER_LEVEL = 0.25;                      // +25% за уровень прокачки
var O2_REFILL_TIME = 3.5;                     // секунд на полный вдох у поверхности

var MATCH_TIME = 180;                         // 3 минуты
var COINS_GOAL = 50;                          // монет за гол своей команды
var COINS_WIN = 100;

var TEAM_BLUE = 0, TEAM_ORANGE = 1;
var TEAM_COLORS = [0x2e7bff, 0xff7a1a];
var TEAM_COLORS_DARK = [0x1a4dbb, 0xbb5210];

// ============================== СОСТОЯНИЕ ==============================
var save = loadSave();
var state = 'menu';                           // menu | play | goalpause | shop | end
var score = [0, 0];
var timeLeft = MATCH_TIME;
var goalPauseT = 0;
var coinsEarnedThisMatch = 0;
var message = '', messageT = 0;

function loadSave() {
  var s = { coins: 0, o2Level: 0 };
  try {
    var raw = localStorage.getItem('uwf_save_v1');
    if (raw) { var p = JSON.parse(raw); s.coins = p.coins | 0; s.o2Level = p.o2Level | 0; }
  } catch (e) {}
  return s;
}
function persistSave() {
  try { localStorage.setItem('uwf_save_v1', JSON.stringify(save)); } catch (e) {}
}
function o2Capacity() { return O2_BASE * (1 + O2_PER_LEVEL * save.o2Level); }
function upgradeCost() { return Math.round(100 * Math.pow(1.9, save.o2Level)); }

// ============================== THREE: СЦЕНА ==============================
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game').appendChild(renderer.domElement);

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a5d96);
scene.fog = new THREE.FogExp2(0x0a5d96, 0.020);

var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);

scene.add(new THREE.AmbientLight(0x88bbdd, 0.9));
var sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(10, 40, 8);
scene.add(sun);

// --- Дно с разметкой (canvas-текстура)
function makeFloorTexture() {
  var c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  var g = c.getContext('2d');
  g.fillStyle = '#0e6fa8'; g.fillRect(0, 0, 1024, 512);
  // плитка
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 2;
  for (var i = 0; i <= 32; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 512); g.stroke(); }
  for (var j = 0; j <= 16; j++) { g.beginPath(); g.moveTo(0, j * 32); g.lineTo(1024, j * 32); g.stroke(); }
  // разметка поля
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 6;
  g.strokeRect(18, 18, 1024 - 36, 512 - 36);
  g.beginPath(); g.moveTo(512, 18); g.lineTo(512, 494); g.stroke();
  g.beginPath(); g.arc(512, 256, 80, 0, Math.PI * 2); g.stroke();
  // штрафные
  g.strokeRect(18, 128, 130, 256);
  g.strokeRect(1024 - 148, 128, 130, 256);
  var t = new THREE.CanvasTexture(c);
  return t;
}
var floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(POOL.hx * 2, POOL.hz * 2),
  new THREE.MeshLambertMaterial({ map: makeFloorTexture() })
);
floorMesh.rotation.x = -Math.PI / 2;
scene.add(floorMesh);

// --- Стены (полупрозрачные)
var wallMat = new THREE.MeshLambertMaterial({ color: 0x0c81c4, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
function addWall(w, h, x, y, z, ry) {
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
  m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
}
addWall(POOL.hx * 2, POOL.top, 0, POOL.top / 2, -POOL.hz, 0);
addWall(POOL.hx * 2, POOL.top, 0, POOL.top / 2, POOL.hz, Math.PI);
addWall(POOL.hz * 2, POOL.top, -POOL.hx, POOL.top / 2, 0, Math.PI / 2);
addWall(POOL.hz * 2, POOL.top, POOL.hx, POOL.top / 2, 0, -Math.PI / 2);

// --- Поверхность воды (видна снизу)
var surfMat = new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
var surface = new THREE.Mesh(new THREE.PlaneGeometry(POOL.hx * 2, POOL.hz * 2, 24, 12), surfMat);
surface.rotation.x = Math.PI / 2;
surface.position.y = POOL.top;
scene.add(surface);
var surfGeo = surface.geometry;
var surfBase = surfGeo.attributes.position.array.slice();

// --- Ворота
function buildGoal(side) { // side: -1 (синие защищают) | +1
  var grp = new THREE.Group();
  var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  var r = 0.15;
  function bar(len, axis, x, y, z) {
    var geo = new THREE.CylinderGeometry(r, r, len, 8);
    var m = new THREE.Mesh(geo, mat);
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z); grp.add(m);
  }
  bar(GOAL.h, 'y', 0, GOAL.h / 2, -GOAL.hw);
  bar(GOAL.h, 'y', 0, GOAL.h / 2, GOAL.hw);
  bar(GOAL.hw * 2, 'z', 0, GOAL.h, 0);
  // сетка
  var netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 });
  var net = new THREE.Mesh(new THREE.BoxGeometry(GOAL.depth, GOAL.h, GOAL.hw * 2, 2, 5, 8), netMat);
  net.position.set(side * GOAL.depth / 2, GOAL.h / 2, 0);
  grp.add(net);
  grp.position.set(side * GOAL_LINE, 0, 0);
  scene.add(grp);
}
buildGoal(-1); buildGoal(1);

// --- Мяч
var ball = {
  pos: new THREE.Vector3(0, 6, 0),
  vel: new THREE.Vector3(),
  mesh: null
};
(function () {
  var c = document.createElement('canvas'); c.width = 128; c.height = 64;
  var g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#222';
  for (var i = 0; i < 8; i++) for (var j = 0; j < 4; j++) if ((i + j) % 2 === 0) g.fillRect(i * 16, j * 16, 16, 16);
  var tex = new THREE.CanvasTexture(c);
  ball.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), new THREE.MeshLambertMaterial({ map: tex }));
  scene.add(ball.mesh);
})();

// --- Игроки
function buildPlayerMesh(team, isHuman) {
  var grp = new THREE.Group();
  var bodyMat = new THREE.MeshLambertMaterial({ color: TEAM_COLORS[team] });
  var darkMat = new THREE.MeshLambertMaterial({ color: TEAM_COLORS_DARK[team] });
  var skinMat = new THREE.MeshLambertMaterial({ color: 0xf0c090 });
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 1.0, 10), bodyMat);
  body.position.y = 0.1; grp.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), skinMat);
  head.position.y = 0.85; grp.add(head);
  var mask = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), darkMat);
  mask.position.y = 0.88; grp.add(mask);
  // ноги
  var legL = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.10, 0.8, 8), darkMat);
  legL.position.set(0, -0.75, 0.18); grp.add(legL);
  var legR = legL.clone(); legR.position.z = -0.18; grp.add(legR);
  // ласты
  var finGeo = new THREE.BoxGeometry(0.55, 0.06, 0.22);
  var finL = new THREE.Mesh(finGeo, new THREE.MeshLambertMaterial({ color: 0x222222 }));
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

function makePlayer(team, idx, isHuman) {
  return {
    team: team, idx: idx, human: isHuman,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: team === TEAM_BLUE ? 0 : Math.PI,
    o2: o2Capacity(), blackout: false,
    kickCd: 0,
    aiState: 'field',        // field | surfacing | breathing
    surfaceDuty: false,
    mesh: buildPlayerMesh(team, isHuman),
    swimPhase: Math.random() * 6
  };
}

var players = [];
var human;
(function () {
  for (var t = 0; t < 2; t++)
    for (var i = 0; i < 3; i++)
      players.push(makePlayer(t, i, t === TEAM_BLUE && i === 0));
  human = players[0];
})();

function resetPositions(kickoffTeam) {
  var layouts = [
    [new THREE.Vector3(-6, 6, 0), new THREE.Vector3(-14, 8, -6), new THREE.Vector3(-14, 8, 6)],
    [new THREE.Vector3(6, 6, 0), new THREE.Vector3(14, 8, -6), new THREE.Vector3(14, 8, 6)]
  ];
  players.forEach(function (p) {
    var base = layouts[p.team][p.idx].clone();
    if (kickoffTeam !== undefined && p.team !== kickoffTeam && p.idx === 0) base.x = p.team === TEAM_BLUE ? -10 : 10;
    p.pos.copy(base);
    p.vel.set(0, 0, 0);
    p.yaw = p.team === TEAM_BLUE ? 0 : Math.PI;
    p.kickCd = 0;
  });
  ball.pos.set(0, 6, 0);
  ball.vel.set(0, 0, 0);
}

// --- Пузыри
var BUBBLES = 160;
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
var input = { mx: 0, mz: 0, up: false, down: false, kick: false };
var keys = {};
window.addEventListener('keydown', function (e) { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
window.addEventListener('keyup', function (e) { keys[e.code] = false; });

// Виртуальный джойстик
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
    if (t.clientX < window.innerWidth * 0.5 && !joy.active) {
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

// Кнопки (вверх/вниз/удар) — состояние тача храним отдельно от клавиатуры
var touchBtn = { up: false, down: false, kick: false };
function bindButton(id, prop) {
  var el = document.getElementById(id);
  function on(e) { touchBtn[prop] = true; el.classList.add('pressed'); e.preventDefault(); }
  function off(e) { touchBtn[prop] = false; el.classList.remove('pressed'); e.preventDefault(); }
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
}
bindButton('btn-up', 'up');
bindButton('btn-down', 'down');
bindButton('btn-kick', 'kick');

function readInput() {
  // клавиатура (для отладки на компьютере)
  var kx = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  var kz = (keys['KeyS'] ? 1 : 0) - (keys['KeyW'] ? 1 : 0);
  input.mx = joy.active ? joy.dx : kx;
  input.mz = joy.active ? joy.dy : kz;
  input.up = touchBtn.up || !!keys['Space'];
  input.down = touchBtn.down || !!keys['ShiftLeft'] || !!keys['ShiftRight'];
  input.kick = touchBtn.kick || !!keys['KeyK'] || !!keys['KeyE'];
}

// ============================== ИГРОВАЯ ЛОГИКА ==============================
function clampToPool(p, r) {
  if (p.pos.x < -POOL.hx + r) { p.pos.x = -POOL.hx + r; p.vel.x = Math.abs(p.vel.x) * 0.2; }
  if (p.pos.x > POOL.hx - r) { p.pos.x = POOL.hx - r; p.vel.x = -Math.abs(p.vel.x) * 0.2; }
  if (p.pos.z < -POOL.hz + r) { p.pos.z = -POOL.hz + r; p.vel.z = Math.abs(p.vel.z) * 0.2; }
  if (p.pos.z > POOL.hz - r) { p.pos.z = POOL.hz - r; p.vel.z = -Math.abs(p.vel.z) * 0.2; }
  if (p.pos.y < r + 0.2) { p.pos.y = r + 0.2; p.vel.y = Math.max(0, p.vel.y); }
  if (p.pos.y > POOL.top - 0.5) { p.pos.y = POOL.top - 0.5; p.vel.y = Math.min(0, p.vel.y); }
}

function atSurface(p) { return p.pos.y > POOL.top - SURFACE_ZONE; }

function enemyGoalX(team) { return team === TEAM_BLUE ? GOAL_LINE : -GOAL_LINE; }

function updateHuman(p, dt) {
  if (p.blackout) {
    p.vel.multiplyScalar(1 - Math.min(1, WATER_DRAG_P * dt));
    p.vel.y += 4.0 * dt; // всплывает сам
    return;
  }
  // движение относительно камеры
  var fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  var right = new THREE.Vector3(fwd.z, 0, -fwd.x).negate();
  var acc = new THREE.Vector3();
  acc.addScaledVector(fwd, -input.mz);
  acc.addScaledVector(right, input.mx);
  if (acc.lengthSq() > 1) acc.normalize();
  if (input.up) acc.y += 1;
  if (input.down) acc.y -= 1;
  p.vel.addScaledVector(acc, PLAYER_ACCEL * dt);
  p.vel.multiplyScalar(1 - Math.min(1, WATER_DRAG_P * dt));
  if (p.vel.length() > PLAYER_MAXSPD) p.vel.setLength(PLAYER_MAXSPD);
  if (acc.lengthSq() > 0.01) {
    var targetYaw = Math.atan2(acc.x, acc.z);
    p.yaw = lerpAngle(p.yaw, targetYaw, Math.min(1, 10 * dt));
  }
  // удар
  if (input.kick && p.kickCd <= 0) tryKick(p, true);
}

function tryKick(p, isHuman) {
  var d = ball.pos.distanceTo(p.pos);
  if (d > KICK_RANGE) return false;
  p.kickCd = KICK_COOLDOWN;
  var dir;
  var goal = new THREE.Vector3(enemyGoalX(p.team), GOAL.h * 0.45, (Math.random() * 2 - 1) * GOAL.hw * 0.6);
  var toGoal = goal.clone().sub(ball.pos).normalize();
  if (isHuman) {
    var facing = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    if (p.vel.lengthSq() > 1) facing = p.vel.clone().normalize();
    dir = facing.multiplyScalar(0.45).add(toGoal.multiplyScalar(0.55)).normalize();
  } else {
    // боты бьют в сторону ворот с небольшой ошибкой
    dir = toGoal.add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.25)).normalize();
  }
  ball.vel.copy(dir.multiplyScalar(KICK_POWER)).addScaledVector(p.vel, 0.4);
  spawnKickBubbles(ball.pos);
  return true;
}

// --- ИИ ---
function teamMates(p) { return players.filter(function (q) { return q.team === p.team && q !== p; }); }

function updateTeamDuty(team) {
  // всегда кто-то из команды должен быть наверху: назначаем «дежурного»
  var members = players.filter(function (q) { return q.team === team; });
  var bots = members.filter(function (q) { return !q.human; });
  var someoneUp = members.some(function (q) { return atSurface(q) || q.aiState === 'surfacing'; });
  var duty = bots.find(function (q) { return q.surfaceDuty; });
  if (!duty && !someoneUp && bots.length) {
    // дежурит бот с минимальным запасом кислорода
    bots.sort(function (a, b) { return a.o2 - b.o2; });
    bots[0].surfaceDuty = true;
  }
  if (duty && duty.o2 > o2Capacity() * 0.95) {
    // сменщик: другой бот с низким O2 идёт наверх, дежурный ныряет
    var next = bots.filter(function (q) { return q !== duty; }).sort(function (a, b) { return a.o2 - b.o2; })[0];
    if (next && next.o2 < o2Capacity() * 0.55) {
      duty.surfaceDuty = false;
      next.surfaceDuty = true;
    }
  }
}

function updateBot(p, dt) {
  var cap = o2Capacity();
  var target = new THREE.Vector3();
  var wantKick = false;

  if (p.blackout) {
    p.vel.multiplyScalar(1 - Math.min(1, WATER_DRAG_P * dt));
    p.vel.y += 4.0 * dt;
    return;
  }

  var mustSurface = p.o2 < cap * 0.22 || p.surfaceDuty;
  if (mustSurface) p.aiState = atSurface(p) ? 'breathing' : 'surfacing';
  else if (p.aiState !== 'field' && p.o2 > cap * 0.93 && !p.surfaceDuty) p.aiState = 'field';

  if (p.aiState === 'surfacing' || p.aiState === 'breathing') {
    target.set(p.pos.x * 0.8, POOL.top - 0.7, p.pos.z * 0.8);
  } else {
    // полевые роли: ближний к мячу атакует, второй защищает
    var mates = teamMates(p).filter(function (q) { return q.aiState === 'field' && !q.blackout; });
    var iAmClosest = true;
    var myD = p.pos.distanceTo(ball.pos);
    mates.forEach(function (q) { if (q.pos.distanceTo(ball.pos) < myD) iAmClosest = false; });
    if (iAmClosest) {
      // атакующий: заходим за мяч со стороны своих ворот и бьём
      var behind = ball.pos.clone();
      behind.x += (p.team === TEAM_BLUE ? -1 : 1) * 1.2;
      target.copy(behind);
      if (myD < KICK_RANGE * 0.95 && p.kickCd <= 0) wantKick = true;
    } else {
      // защитник: между мячом и своими воротами, на глубине мяча
      var ownX = -enemyGoalX(p.team);
      target.set((ball.pos.x + ownX * 1.4) / 2.4, Math.max(3, ball.pos.y), ball.pos.z * 0.5);
    }
  }

  var acc = target.sub(p.pos);
  var dist = acc.length();
  if (dist > 0.3) {
    acc.normalize();
    p.vel.addScaledVector(acc, PLAYER_ACCEL * 0.85 * dt);
  }
  p.vel.multiplyScalar(1 - Math.min(1, WATER_DRAG_P * dt));
  var ms = PLAYER_MAXSPD * 0.92;
  if (p.vel.length() > ms) p.vel.setLength(ms);
  if (p.vel.lengthSq() > 0.05) p.yaw = lerpAngle(p.yaw, Math.atan2(p.vel.x, p.vel.z), Math.min(1, 8 * dt));
  if (wantKick) tryKick(p, false);
}

function updateOxygen(p, dt) {
  var cap = o2Capacity();
  if (atSurface(p)) {
    p.o2 = Math.min(cap, p.o2 + (cap / O2_REFILL_TIME) * dt);
    if (p.blackout && p.o2 > cap * 0.9) p.blackout = false;
  } else {
    p.o2 = Math.max(0, p.o2 - dt);
    if (p.o2 <= 0 && !p.blackout) {
      p.blackout = true;
      if (p.human) showMessage('Воздух кончился! Тебя выносит наверх…');
    }
  }
}

function updateBall(dt) {
  ball.vel.y += BALL_GRAV * dt;
  ball.vel.multiplyScalar(1 - Math.min(1, BALL_DRAG * dt));
  ball.pos.addScaledVector(ball.vel, dt);

  // столкновения со стенами/дном/поверхностью
  var inGoalZ = Math.abs(ball.pos.z) < GOAL.hw - BALL_R * 0.5;
  var inGoalY = ball.pos.y < GOAL.h - BALL_R * 0.5;
  var limX = (inGoalZ && inGoalY) ? POOL.hx - BALL_R : GOAL_LINE - BALL_R; // в створе можно залетать за линию
  if (ball.pos.x < -limX) { ball.pos.x = -limX; ball.vel.x = Math.abs(ball.vel.x) * BALL_REST; }
  if (ball.pos.x > limX) { ball.pos.x = limX; ball.vel.x = -Math.abs(ball.vel.x) * BALL_REST; }
  if (ball.pos.z < -POOL.hz + BALL_R) { ball.pos.z = -POOL.hz + BALL_R; ball.vel.z = Math.abs(ball.vel.z) * BALL_REST; }
  if (ball.pos.z > POOL.hz - BALL_R) { ball.pos.z = POOL.hz - BALL_R; ball.vel.z = -Math.abs(ball.vel.z) * BALL_REST; }
  if (ball.pos.y < BALL_R) { ball.pos.y = BALL_R; ball.vel.y = Math.abs(ball.vel.y) * BALL_REST; ball.vel.x *= 0.92; ball.vel.z *= 0.92; }
  if (ball.pos.y > POOL.top - BALL_R * 0.3) { ball.pos.y = POOL.top - BALL_R * 0.3; ball.vel.y = -Math.abs(ball.vel.y) * 0.5; }

  // мягкое отталкивание от игроков (дриблинг)
  players.forEach(function (p) {
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

  // гол? (мяч пересёк линию ворот в створе)
  if (Math.abs(ball.pos.x) > GOAL_LINE + BALL_R * 0.25 && inGoalZ && inGoalY) {
    var scoringTeam = ball.pos.x > 0 ? TEAM_BLUE : TEAM_ORANGE;
    onGoal(scoringTeam);
  }
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

// столкновения игроков между собой (мягкие)
function separatePlayers() {
  for (var i = 0; i < players.length; i++)
    for (var j = i + 1; j < players.length; j++) {
      var a = players[i], b = players[j];
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

// ============================== ЭФФЕКТЫ ==============================
var kickBubbles = [];
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
function updateCamera(dt) {
  var back = new THREE.Vector3(Math.sin(human.yaw), 0, Math.cos(human.yaw)).multiplyScalar(-7.5);
  var want = human.pos.clone().add(back);
  want.y = Math.min(POOL.top - 0.6, Math.max(2, human.pos.y + 2.6));
  camPos.lerp(want, Math.min(1, 3.5 * dt));
  // не выходить за стены
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
var elMsg = document.getElementById('message');
var elTeamO2 = document.getElementById('team-o2');
var elBreathe = document.getElementById('breathe-hint');
var elKick = document.getElementById('btn-kick');

function fmtTime(t) {
  t = Math.max(0, Math.ceil(t));
  var m = (t / 60) | 0, s = t % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function updateHud() {
  elScore.textContent = score[0] + ' : ' + score[1];
  elCoins.textContent = '🪙 ' + save.coins;
}

function updateHudFrame() {
  elTimer.textContent = fmtTime(timeLeft);
  var cap = o2Capacity();
  var r = human.o2 / cap;
  elO2.style.width = (r * 100).toFixed(1) + '%';
  elO2.style.background = r > 0.4 ? '#3ad1ff' : (r > 0.18 ? '#ffc93a' : '#ff4d4d');
  elO2Wrap.classList.toggle('low', r <= 0.18 && !atSurface(human));
  elBreathe.style.display = atSurface(human) ? 'block' : 'none';
  // кислород команды (мелкие полоски)
  var html = '';
  players.forEach(function (p) {
    if (p.team !== TEAM_BLUE || p.human) return;
    var rr = (p.o2 / cap * 100).toFixed(0);
    html += '<div class="mate"><div class="mate-fill" style="width:' + rr + '%"></div></div>';
  });
  elTeamO2.innerHTML = html;
  // подсветка кнопки удара
  elKick.classList.toggle('ready', ball.pos.distanceTo(human.pos) < KICK_RANGE && !human.blackout);
}

function showMessage(txt) {
  message = txt; messageT = 2.5;
  elMsg.textContent = txt;
  elMsg.style.opacity = 1;
}

// ============================== ЭКРАНЫ ==============================
var elMenu = document.getElementById('menu');
var elShop = document.getElementById('shop');
var elEnd = document.getElementById('end');

function refreshShop() {
  document.getElementById('shop-coins').textContent = save.coins;
  document.getElementById('shop-level').textContent = save.o2Level;
  document.getElementById('shop-capacity').textContent = Math.round(o2Capacity()) + ' сек';
  var btn = document.getElementById('btn-buy');
  btn.textContent = 'Прокачать дыхание — 🪙 ' + upgradeCost();
  btn.disabled = save.coins < upgradeCost();
}

function startMatch() {
  score = [0, 0];
  timeLeft = MATCH_TIME;
  coinsEarnedThisMatch = 0;
  players.forEach(function (p) {
    p.o2 = o2Capacity(); p.blackout = false; p.surfaceDuty = false; p.aiState = 'field';
  });
  resetPositions();
  state = 'play';
  elMenu.style.display = 'none';
  elEnd.style.display = 'none';
  elShop.style.display = 'none';
  updateHud();
  showMessage('Играем! Мяч в центре');
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

document.getElementById('btn-start').addEventListener('click', startMatch);
document.getElementById('btn-again').addEventListener('click', startMatch);
document.getElementById('btn-shop').addEventListener('click', function () {
  refreshShop();
  elShop.style.display = 'flex';
  if (state === 'play') state = 'shop';
});
document.getElementById('btn-shop-end').addEventListener('click', function () {
  refreshShop();
  elShop.style.display = 'flex';
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
function tick(now) {
  requestAnimationFrame(tick);
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'play' || state === 'goalpause') {
    if (state === 'play') {
      timeLeft -= dt;
      if (timeLeft <= 0) { endMatch(); }
    } else {
      goalPauseT -= dt;
      if (goalPauseT <= 0) { resetPositions(); state = 'play'; }
    }

    readInput();
    updateTeamDuty(TEAM_BLUE);
    updateTeamDuty(TEAM_ORANGE);
    players.forEach(function (p) {
      p.kickCd = Math.max(0, p.kickCd - dt);
      if (p.human) updateHuman(p, dt); else updateBot(p, dt);
      p.pos.addScaledVector(p.vel, dt);
      clampToPool(p, PLAYER_R);
      updateOxygen(p, dt);
    });
    separatePlayers();
    if (state === 'play') updateBall(dt);
    updateHudFrame();
  }

  // сообщение
  if (messageT > 0) {
    messageT -= dt;
    if (messageT <= 0) elMsg.style.opacity = 0;
  }

  // визуал
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
    // наклон тела по вертикальной скорости
    p.mesh.rotation.x = THREE.MathUtils.clamp(-p.vel.y * 0.06, -0.5, 0.5);
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
  getState: function () { return state; }
};

// стартовое состояние
resetPositions();
updateHud();
refreshShop();
requestAnimationFrame(tick);
})();
