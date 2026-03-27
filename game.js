import * as THREE from 'three';

// ─── Constants ────────────────────────────────────────────────────────────────
const WORLD_SIZE   = 60;      // half-width of play area
const BULLET_SPEED = 55;
const BULLET_LIFE  = 1.6;     // seconds
const SHIP_ACCEL   = 28;
const SHIP_DRAG    = 0.96;
const SHIP_ROT     = 2.8;     // rad/s
const MAX_SPEED    = 24;
const SHOOT_COOLDOWN = 0.22;  // seconds
const INVINCIBLE_TIME = 2.5;  // seconds after hit
const MAX_LIVES    = 3;

const ASTEROID_SIZES = {
  large:  { radius: 3.8, speed: 4,  score: 20,  hp: 1 },
  medium: { radius: 2.0, speed: 6,  score: 50,  hp: 1 },
  small:  { radius: 1.0, speed: 9,  score: 100, hp: 1 },
};

// ─── Three.js Setup ──────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000008);

// Orthographic camera looking top-down for a 2D feel in 3D space
const ASPECT = window.innerWidth / window.innerHeight;
const VIEW_H = WORLD_SIZE * 1.2;
const VIEW_W = VIEW_H * ASPECT;
const camera = new THREE.OrthographicCamera(
  -VIEW_W / 2, VIEW_W / 2,
   VIEW_H / 2, -VIEW_H / 2,
  0.1, 500
);
camera.position.set(0, 100, 0);
camera.lookAt(0, 0, 0);

window.addEventListener('resize', () => {
  const asp = window.innerWidth / window.innerHeight;
  const w = VIEW_H * asp;
  camera.left   = -w / 2;
  camera.right  =  w / 2;
  camera.top    =  VIEW_H / 2;
  camera.bottom = -VIEW_H / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Lights ──────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x334466, 2));
const dirLight = new THREE.DirectionalLight(0x88ccff, 3);
dirLight.position.set(5, 10, 5);
scene.add(dirLight);

// ─── Starfield ───────────────────────────────────────────────────────────────
function buildStarfield() {
  const count = 1200;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 240;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 240;
    sizes[i] = Math.random() * 1.5 + 0.3;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.PointsMaterial({ color: 0xaabbcc, sizeAttenuation: false, size: 1.2, transparent: true, opacity: 0.7 });
  scene.add(new THREE.Points(geo, mat));
}
buildStarfield();

// ─── Helper: wrap position around world edges ─────────────────────────────────
function wrapPosition(obj) {
  const lim = WORLD_SIZE + 4;
  if (obj.position.x > lim)  obj.position.x -= lim * 2;
  if (obj.position.x < -lim) obj.position.x += lim * 2;
  if (obj.position.z > lim)  obj.position.z -= lim * 2;
  if (obj.position.z < -lim) obj.position.z += lim * 2;
}

// ─── Ship ────────────────────────────────────────────────────────────────────
function buildShipMesh() {
  const group = new THREE.Group();

  // Hull – arrow/diamond shape extruded
  const shape = new THREE.Shape();
  shape.moveTo(0, 2.4);
  shape.lineTo(-1.3, -1.6);
  shape.lineTo(0, -0.8);
  shape.lineTo(1.3, -1.6);
  shape.closePath();

  const extSettings = { depth: 0.3, bevelEnabled: false };
  const geo = new THREE.ExtrudeGeometry(shape, extSettings);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, emissive: 0x0a3050, metalness: 0.6, roughness: 0.3 });
  const hull = new THREE.Mesh(geo, mat);
  group.add(hull);

  // Engine glow
  const glowGeo = new THREE.CircleGeometry(0.55, 12);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.85 });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.18, 1.0);
  glow.name = 'glow';
  group.add(glow);

  return group;
}

// ─── Asteroid builder ─────────────────────────────────────────────────────────
function buildAsteroidMesh(radius) {
  const detail = radius > 3 ? 1 : 0;
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  // Displace vertices for irregular look
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) * (0.75 + Math.random() * 0.5),
      pos.getY(i) * (0.75 + Math.random() * 0.5),
      pos.getZ(i) * (0.75 + Math.random() * 0.5),
    );
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8899aa,
    roughness: 0.9,
    metalness: 0.1,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// ─── Bullet builder ───────────────────────────────────────────────────────────
function buildBulletMesh() {
  const geo = new THREE.SphereGeometry(0.22, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0x88ffdd });
  return new THREE.Mesh(geo, mat);
}

// ─── Explosion particles ───────────────────────────────────────────────────────
function spawnExplosion(position, color = 0xffaa44, count = 18) {
  const particles = [];
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.18, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(position);
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 10;
    m._vel = new THREE.Vector3(Math.cos(angle) * speed, 0, Math.sin(angle) * speed);
    m._life = 0.5 + Math.random() * 0.4;
    m._maxLife = m._life;
    scene.add(m);
    particles.push(m);
  }
  return particles;
}

// ─── Game State ───────────────────────────────────────────────────────────────
let state = 'menu'; // 'menu' | 'playing' | 'dead' | 'gameover'
let score = 0;
let level = 1;
let lives = MAX_LIVES;
let shootTimer = 0;
let invincibleTimer = 0;
let blinkTimer = 0;

const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup',   e => { keys[e.code] = false; });

// Ship state
const ship = {
  mesh: null,
  vel: new THREE.Vector3(),
  angle: 0,   // rotation around Y (radians)
  alive: true,
};

// Active objects
let asteroids = [];
let bullets   = [];
let explosions = [];

// ─── Spawn helpers ────────────────────────────────────────────────────────────
function randomEdgePosition() {
  const edge = Math.floor(Math.random() * 4);
  const lim = WORLD_SIZE + 2;
  const t = (Math.random() - 0.5) * lim * 2;
  switch (edge) {
    case 0: return new THREE.Vector3(t,  0, -lim);
    case 1: return new THREE.Vector3(t,  0,  lim);
    case 2: return new THREE.Vector3(-lim, 0, t);
    case 3: return new THREE.Vector3( lim, 0, t);
  }
}

function spawnAsteroid(sizeKey, position, inheritVel) {
  const cfg = ASTEROID_SIZES[sizeKey];
  const mesh = buildAsteroidMesh(cfg.radius);

  if (position) {
    mesh.position.copy(position);
  } else {
    mesh.position.copy(randomEdgePosition());
  }

  const target = new THREE.Vector3(
    (Math.random() - 0.5) * WORLD_SIZE,
    0,
    (Math.random() - 0.5) * WORLD_SIZE
  );
  const dir = target.clone().sub(mesh.position).normalize();
  const speedMult = 1 + (level - 1) * 0.15;
  const vel = dir.multiplyScalar(cfg.speed * speedMult);
  if (inheritVel) vel.add(inheritVel);

  const rotAxis = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
  const rotSpeed = (Math.random() - 0.5) * 1.4;

  scene.add(mesh);
  asteroids.push({ mesh, vel, sizeKey, rotAxis, rotSpeed, cfg });
}

function spawnWave() {
  const count = 3 + level;
  for (let i = 0; i < count; i++) spawnAsteroid('large', null, null);
}

// ─── Init / Reset ─────────────────────────────────────────────────────────────
function initGame() {
  // Clear previous
  asteroids.forEach(a => scene.remove(a.mesh));
  bullets.forEach(b => scene.remove(b.mesh));
  explosions.forEach(p => scene.remove(p.mesh));
  asteroids = []; bullets = []; explosions = [];

  if (ship.mesh) scene.remove(ship.mesh);

  score = 0; level = 1; lives = MAX_LIVES;
  shootTimer = 0; invincibleTimer = 0;
  ship.vel.set(0, 0, 0);
  ship.angle = 0;
  ship.alive = true;

  ship.mesh = buildShipMesh();
  ship.mesh.position.set(0, 0, 0);
  scene.add(ship.mesh);

  updateHUD();
  spawnWave();
  showLevelBanner(level);
  state = 'playing';
}

function respawnShip() {
  ship.mesh.position.set(0, 0, 0);
  ship.vel.set(0, 0, 0);
  ship.angle = 0;
  ship.alive = true;
  invincibleTimer = INVINCIBLE_TIME;
  ship.mesh.visible = true;
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('score-val').textContent = score;
  document.getElementById('level-val').textContent = level;
  const livesEl = document.getElementById('lives-display');
  livesEl.innerHTML = '';
  for (let i = 0; i < MAX_LIVES; i++) {
    const d = document.createElement('div');
    d.className = 'life-icon' + (i >= lives ? ' lost' : '');
    livesEl.appendChild(d);
  }
}

let levelBannerTimeout = null;
function showLevelBanner(num) {
  document.getElementById('level-num').textContent = num;
  const banner = document.getElementById('level-banner');
  banner.classList.add('show');
  clearTimeout(levelBannerTimeout);
  levelBannerTimeout = setTimeout(() => banner.classList.remove('show'), 1800);
}

// ─── Overlay ─────────────────────────────────────────────────────────────────
const overlay    = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub   = document.getElementById('overlay-sub');
const finalScoreLbl = document.getElementById('final-score-label');
const startBtn   = document.getElementById('start-btn');

startBtn.addEventListener('click', () => {
  overlay.classList.add('hidden');
  initGame();
});

function showGameOver() {
  state = 'gameover';
  overlayTitle.textContent = 'GAME OVER';
  overlaySub.textContent   = '';
  finalScoreLbl.style.display = 'block';
  finalScoreLbl.textContent   = `SCORE: ${score}`;
  startBtn.textContent = 'PLAY AGAIN';
  overlay.classList.remove('hidden');
}

// ─── Collision detection ──────────────────────────────────────────────────────
function circleOverlap(a, b, ra, rb) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz < (ra + rb) * (ra + rb);
}

// ─── Update loop ─────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let prevTime = 0;

function update(dt) {
  if (state !== 'playing') return;

  // ── Ship input ──
  const rotLeft  = keys['ArrowLeft']  || keys['KeyA'];
  const rotRight = keys['ArrowRight'] || keys['KeyD'];
  const thrust   = keys['ArrowUp']    || keys['KeyW'];
  const shooting = keys['Space']      || keys['KeyZ'];

  if (rotLeft)  ship.angle += SHIP_ROT * dt;
  if (rotRight) ship.angle -= SHIP_ROT * dt;

  if (thrust) {
    const fwd = new THREE.Vector3(Math.sin(ship.angle), 0, Math.cos(ship.angle));
    ship.vel.addScaledVector(fwd, SHIP_ACCEL * dt);
    if (ship.vel.length() > MAX_SPEED) ship.vel.setLength(MAX_SPEED);
    // Pulse engine glow
    const glow = ship.mesh.getObjectByName('glow');
    if (glow) glow.material.opacity = 0.9 + Math.sin(Date.now() * 0.03) * 0.1;
  } else {
    const glow = ship.mesh.getObjectByName('glow');
    if (glow) glow.material.opacity = 0.3;
  }

  ship.vel.multiplyScalar(SHIP_DRAG);
  ship.mesh.position.addScaledVector(ship.vel, dt);
  ship.mesh.rotation.y = ship.angle;
  wrapPosition(ship.mesh);

  // ── Shoot ──
  shootTimer -= dt;
  if (shooting && shootTimer <= 0 && ship.alive) {
    shootTimer = SHOOT_COOLDOWN;
    const bMesh = buildBulletMesh();
    const fwd = new THREE.Vector3(Math.sin(ship.angle), 0, Math.cos(ship.angle));
    bMesh.position.copy(ship.mesh.position).addScaledVector(fwd, 2.2);
    const vel = fwd.multiplyScalar(BULLET_SPEED).add(ship.vel);
    scene.add(bMesh);
    bullets.push({ mesh: bMesh, vel: vel.clone(), life: BULLET_LIFE });
  }

  // ── Bullets ──
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.mesh.position.addScaledVector(b.vel, dt);
    wrapPosition(b.mesh);
    if (b.life <= 0) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }

  // ── Asteroids ──
  for (let i = asteroids.length - 1; i >= 0; i--) {
    const a = asteroids[i];
    a.mesh.position.addScaledVector(a.vel, dt);
    a.mesh.rotateOnAxis(a.rotAxis, a.rotSpeed * dt);
    wrapPosition(a.mesh);

    // Bullet collision
    let hit = false;
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      if (circleOverlap(a.mesh.position, b.mesh.position, a.cfg.radius, 0.4)) {
        // Destroy bullet
        scene.remove(b.mesh);
        bullets.splice(j, 1);
        hit = true;
        break;
      }
    }

    if (hit) {
      score += a.cfg.score;
      updateHUD();
      const exPos = a.mesh.position.clone();

      // Spawn fragments
      if (a.sizeKey === 'large') {
        for (let k = 0; k < 2; k++) spawnAsteroid('medium', exPos.clone(), a.vel.clone().multiplyScalar(0.5));
      } else if (a.sizeKey === 'medium') {
        for (let k = 0; k < 2; k++) spawnAsteroid('small', exPos.clone(), a.vel.clone().multiplyScalar(0.5));
      }

      // Explosion
      const exParticles = spawnExplosion(exPos, a.sizeKey === 'large' ? 0xffaa44 : 0xff6622, a.sizeKey === 'small' ? 10 : 18);
      exParticles.forEach(p => explosions.push(p));

      scene.remove(a.mesh);
      asteroids.splice(i, 1);
      continue;
    }

    // Ship collision
    if (ship.alive && invincibleTimer <= 0) {
      if (circleOverlap(a.mesh.position, ship.mesh.position, a.cfg.radius, 1.5)) {
        const exParticles = spawnExplosion(ship.mesh.position.clone(), 0x4fc3f7, 24);
        exParticles.forEach(p => explosions.push(p));
        lives--;
        updateHUD();
        ship.alive = false;

        if (lives <= 0) {
          ship.mesh.visible = false;
          setTimeout(showGameOver, 1200);
        } else {
          setTimeout(respawnShip, 1200);
        }
      }
    }
  }

  // ── Invincibility blink ──
  if (invincibleTimer > 0) {
    invincibleTimer -= dt;
    blinkTimer += dt;
    ship.mesh.visible = Math.floor(blinkTimer * 8) % 2 === 0;
    if (invincibleTimer <= 0) { ship.mesh.visible = true; blinkTimer = 0; }
  }

  // ── Explosions ──
  for (let i = explosions.length - 1; i >= 0; i--) {
    const p = explosions[i];
    p._life -= dt;
    if (p._life <= 0) {
      scene.remove(p);
      explosions.splice(i, 1);
    } else {
      const t = p._life / p._maxLife;
      p.position.addScaledVector(p._vel, dt);
      p._vel.multiplyScalar(0.93);
      p.material.opacity = t;
      const s = t * 0.9 + 0.1;
      p.scale.setScalar(s);
    }
  }

  // ── Level complete ──
  if (asteroids.length === 0 && state === 'playing') {
    level++;
    updateHUD();
    showLevelBanner(level);
    setTimeout(spawnWave, 1000);
  }
}

// ─── Render loop ──────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const now = clock.getElapsedTime();
  const dt = Math.min(now - prevTime, 0.05);
  prevTime = now;

  update(dt);
  renderer.render(scene, camera);
}

animate();
