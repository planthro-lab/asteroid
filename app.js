import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const AU = 150; // 1 AU in scene units
const NASA_KEY = 'DEMO_KEY'; // replace with your NASA API key
const TWO_PI = Math.PI * 2;

// ─── State ────────────────────────────────────────────────────────────────────
let asteroids = [];        // raw API data
let meshes = {};           // id → { mesh, orbit }
let selectedId = null;
let simDate = new Date();
let simSpeed = 1;          // days/frame
let paused = false;
let filterPHA = true, filterSafe = true, filterClose = true;
let closeApproachIds = new Set();
let isDemoMode = false;

// ─── Three.js Setup ──────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000008);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(0, AU * 1.5, AU * 2.5);
camera.lookAt(0, 0, 0);

// CSS2D label renderer
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'fixed';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
labelRenderer.domElement.style.zIndex = '5';
document.body.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 20;
controls.maxDistance = AU * 8;
controls.enablePan = true;

// Raycaster for click detection
const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 3 };
const mouse = new THREE.Vector2();

// ─── Stars ───────────────────────────────────────────────────────────────────
function createStars() {
  const count = 12000;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * TWO_PI;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 4000 + Math.random() * 4000;
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    sizes[i] = 0.4 + Math.random() * 1.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: true, transparent: true, opacity: 0.7 });
  scene.add(new THREE.Points(geo, mat));
}

// ─── Sun ─────────────────────────────────────────────────────────────────────
function createSun() {
  const geo = new THREE.SphereGeometry(8, 32, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
  const sun = new THREE.Mesh(geo, mat);
  scene.add(sun);

  // Glow
  const glowGeo = new THREE.SphereGeometry(14, 32, 32);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9900, transparent: true, opacity: 0.18, side: THREE.BackSide });
  scene.add(new THREE.Mesh(glowGeo, glowMat));
  const glowGeo2 = new THREE.SphereGeometry(22, 32, 32);
  const glowMat2 = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.06, side: THREE.BackSide });
  scene.add(new THREE.Mesh(glowGeo2, glowMat2));

  // Point light
  scene.add(new THREE.PointLight(0xfff4cc, 2, AU * 6, 1.5));
  scene.add(new THREE.AmbientLight(0x111133, 0.8));
}

// ─── Planet data (simplified circular orbits, AU) ────────────────────────────
const PLANETS = [
  { name: 'Mercury', a: 0.387, color: 0xbbbbbb, radius: 2.2,  period: 87.97,    label: true },
  { name: 'Venus',   a: 0.723, color: 0xeeccaa, radius: 3.4,  period: 224.70,   label: true },
  { name: 'Earth',   a: 1.000, color: 0x4fa8ee, radius: 3.6,  period: 365.25,   label: true },
  { name: 'Mars',    a: 1.524, color: 0xdd6644, radius: 2.8,  period: 686.97,   label: true },
  { name: 'Jupiter', a: 5.203, color: 0xddbb99, radius: 7.0,  period: 4332.59,  label: false },
  { name: 'Saturn',  a: 9.537, color: 0xeedd99, radius: 5.5,  period: 10759.22, label: false },
];

const planetMeshes = [];

function createPlanets() {
  PLANETS.forEach(p => {
    // Orbit ring
    const orbitGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * TWO_PI;
      pts.push(new THREE.Vector3(Math.cos(a) * p.a * AU, 0, Math.sin(a) * p.a * AU));
    }
    orbitGeo.setFromPoints(pts);
    const orbitMat = new THREE.LineBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.4 });
    scene.add(new THREE.Line(orbitGeo, orbitMat));

    // Planet sphere
    const geo = new THREE.SphereGeometry(p.radius, 24, 24);
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0.15, emissive: p.color, emissiveIntensity: 0.2 });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // Planet label (CSS2D)
    if (p.label) {
      const div = document.createElement('div');
      div.className = 'planet-label';
      div.textContent = p.name;
      div.style.cssText = `
        color: #fff;
        font-size: 11px;
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-weight: 600;
        letter-spacing: 0.8px;
        text-shadow: 0 0 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.7);
        pointer-events: none;
        white-space: nowrap;
        padding: 3px 0 0 ${p.radius + 4}px;
        opacity: 0.85;
      `;
      const label = new CSS2DObject(div);
      label.position.set(0, p.radius + 2, 0);
      mesh.add(label);
    }

    planetMeshes.push({ mesh, p });

    // Saturn rings
    if (p.name === 'Saturn') {
      const ringGeo = new THREE.RingGeometry(p.radius * 1.5, p.radius * 2.6, 64);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xddcc99, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2.5;
      mesh.add(ring);
    }
  });
}

function updatePlanets() {
  const t = simDate.getTime() / 86400000; // days since epoch
  planetMeshes.forEach(({ mesh, p }) => {
    const angle = (t / p.period) * TWO_PI;
    mesh.position.set(Math.cos(angle) * p.a * AU, 0, Math.sin(angle) * p.a * AU);
  });
}

// ─── Orbital mechanics ────────────────────────────────────────────────────────
function solveKepler(M, e, maxIter = 10) {
  let E = M;
  for (let i = 0; i < maxIter; i++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-8) break;
  }
  return E;
}

function keplerToPosition(a, e, inc, raan, argp, M) {
  const E = solveKepler(M, e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));
  // In orbital plane
  const xo = r * Math.cos(nu);
  const yo = r * Math.sin(nu);
  // Rotate to ecliptic
  const cosO = Math.cos(raan), sinO = Math.sin(raan);
  const cosw = Math.cos(argp), sinw = Math.sin(argp);
  const cosi = Math.cos(inc), sini = Math.sin(inc);
  const x = (cosO * cosw - sinO * sinw * cosi) * xo + (-cosO * sinw - sinO * cosw * cosi) * yo;
  const z = (sinO * cosw + cosO * sinw * cosi) * xo + (-sinO * sinw + cosO * cosw * cosi) * yo;
  const y = (sinw * sini) * xo + (cosw * sini) * yo;
  return new THREE.Vector3(x * AU, y * AU, z * AU);
}

function buildOrbitPath(a, e, inc, raan, argp, segments = 128) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const M = (i / segments) * TWO_PI;
    pts.push(keplerToPosition(a, e, inc, raan, argp, M));
  }
  return pts;
}

// ─── Current mean anomaly from epoch ─────────────────────────────────────────
function currentMeanAnomaly(oel) {
  // oel.mean_anomaly in degrees at epoch_osculation (Julian date)
  const n = 360.0 / oel.orbital_period; // deg/day
  const epochJD = parseFloat(oel.epoch_osculation);
  const nowJD = (simDate.getTime() / 86400000) + 2440587.5;
  const dt = nowJD - epochJD;
  const M0 = parseFloat(oel.mean_anomaly) * Math.PI / 180;
  return M0 + (n * dt * Math.PI / 180);
}

// ─── Selection indicator ─────────────────────────────────────────────────────
const selectionGroup = new THREE.Group();
scene.add(selectionGroup);

// Outer glow shell
const glowShellGeo = new THREE.SphereGeometry(1, 16, 16);
const glowShellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.BackSide });
const glowShell = new THREE.Mesh(glowShellGeo, glowShellMat);
selectionGroup.add(glowShell);

// Inner glow sphere
const innerGlowGeo = new THREE.SphereGeometry(1, 16, 16);
const innerGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.FrontSide });
const innerGlow = new THREE.Mesh(innerGlowGeo, innerGlowMat);
selectionGroup.add(innerGlow);

// Selection ring (torus)
const selRingGeo = new THREE.TorusGeometry(1, 0.08, 8, 48);
const selRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
const selRing = new THREE.Mesh(selRingGeo, selRingMat);
selectionGroup.add(selRing);

// Second ring slightly larger, tilted
const selRing2Geo = new THREE.TorusGeometry(1.35, 0.05, 8, 48);
const selRing2Mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
const selRing2 = new THREE.Mesh(selRing2Geo, selRing2Mat);
selRing2.rotation.x = Math.PI / 4;
selectionGroup.add(selRing2);

selectionGroup.visible = false;

function updateSelectionIndicator(baseSize, color) {
  const s = baseSize * 3.5;
  glowShell.scale.setScalar(s * 1.6);
  glowShellMat.color.setHex(color);
  innerGlow.scale.setScalar(s * 1.2);
  innerGlowMat.color.setHex(color);
  selRing.scale.setScalar(s * 1.8);
  selRingMat.color.setHex(color);
  selRing2.scale.setScalar(s * 1.8);
  selRing2Mat.color.setHex(color);
}

// ─── Asteroid geometry ───────────────────────────────────────────────────────
const asteroidGeo = new THREE.SphereGeometry(0.6, 6, 6);

function getAsteroidColor(neo) {
  if (closeApproachIds.has(neo.id)) return 0xffcc44;
  return neo.is_potentially_hazardous_asteroid ? 0xff4444 : 0x44ff88;
}

function getAsteroidSize(neo) {
  const diam = avgDiameter(neo);
  if (diam > 1000) return 2.2;
  if (diam > 100)  return 1.4;
  return 0.7;
}

function avgDiameter(neo) {
  const d = neo.estimated_diameter?.meters;
  if (!d) return 50;
  return (d.estimated_diameter_min + d.estimated_diameter_max) / 2;
}

function createAsteroidMesh(neo) {
  const oel = neo.orbital_data;
  if (!oel) return null;

  const a    = parseFloat(oel.semi_major_axis);
  const e    = parseFloat(oel.eccentricity);
  const inc  = parseFloat(oel.inclination) * Math.PI / 180;
  const raan = parseFloat(oel.ascending_node_longitude) * Math.PI / 180;
  const argp = parseFloat(oel.perihelion_argument) * Math.PI / 180;
  if (isNaN(a) || isNaN(e) || e >= 1) return null;

  const color = getAsteroidColor(neo);
  const size  = getAsteroidSize(neo);

  // Point mesh
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(asteroidGeo.clone(), mat);
  mesh.scale.setScalar(size);
  mesh.userData = { id: neo.id, a, e, inc, raan, argp, oel };
  scene.add(mesh);

  // Orbit line
  const orbitPts = buildOrbitPath(a, e, inc, raan, argp);
  const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
  const orbitMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
  const orbitLine = new THREE.Line(orbitGeo, orbitMat);
  orbitLine.visible = false;
  scene.add(orbitLine);

  return { mesh, orbitLine, a, e, inc, raan, argp, oel };
}

function updateAsteroidPositions() {
  Object.entries(meshes).forEach(([id, obj]) => {
    const { mesh, a, e, inc, raan, argp, oel } = obj;
    const M = currentMeanAnomaly(oel);
    const pos = keplerToPosition(a, e, inc, raan, argp, M);
    mesh.position.copy(pos);
  });
}

// ─── Populate asteroid list ───────────────────────────────────────────────────
function populateList(filtered) {
  const ul = document.getElementById('asteroid-ul');
  document.getElementById('list-count').textContent = `(${filtered.length})`;
  ul.innerHTML = '';
  filtered.slice(0, 200).forEach(neo => {
    const li = document.createElement('li');
    const color = neo.is_potentially_hazardous_asteroid
      ? closeApproachIds.has(neo.id) ? '#ffcc44' : '#ff4444'
      : closeApproachIds.has(neo.id) ? '#ffcc44' : '#44ff88';
    const diam = avgDiameter(neo).toFixed(0);
    li.innerHTML = `
      <span class="li-dot" style="background:${color};box-shadow:0 0 4px ${color}"></span>
      <span style="flex:1;overflow:hidden">
        <div class="li-name">${neo.name}</div>
        <div class="li-dist">${diam}m diameter</div>
      </span>`;
    li.dataset.id = neo.id;
    if (neo.id === selectedId) li.classList.add('selected');
    li.addEventListener('click', () => selectAsteroid(neo.id));
    ul.appendChild(li);
  });
}

function applyFilters(query = '') {
  const q = query.toLowerCase();
  const filtered = asteroids.filter(neo => {
    if (q && !neo.name.toLowerCase().includes(q)) return false;
    const isPHA = neo.is_potentially_hazardous_asteroid;
    const isClose = closeApproachIds.has(neo.id);
    if (isClose && !filterClose) return false;
    if (!isClose && isPHA && !filterPHA) return false;
    if (!isClose && !isPHA && !filterSafe) return false;
    return true;
  });
  // Show/hide meshes
  Object.entries(meshes).forEach(([id, obj]) => {
    const visible = filtered.some(n => n.id === id);
    obj.mesh.visible = visible;
    if (!visible && selectedId === id) {
      obj.orbitLine.visible = false;
    }
  });
  populateList(filtered);
}

// ─── Select asteroid ──────────────────────────────────────────────────────────
function selectAsteroid(id) {
  // Deselect old
  if (selectedId && meshes[selectedId]) {
    meshes[selectedId].orbitLine.visible = false;
    meshes[selectedId].mesh.scale.setScalar(getAsteroidSize(asteroids.find(n=>n.id===selectedId) || {}));
  }
  selectionGroup.visible = false;
  selectedId = id;
  const neo = asteroids.find(n => n.id === id);
  if (!neo) return;

  const color = getAsteroidColor(neo);
  const baseSize = getAsteroidSize(neo);
  if (meshes[id]) {
    meshes[id].orbitLine.visible = true;
    meshes[id].mesh.scale.setScalar(baseSize * 1.6);
  }
  selectionGroup.visible = true;
  updateSelectionIndicator(baseSize, color);

  // Update right panel
  const panel = document.getElementById('right-panel');
  panel.classList.remove('hidden');
  document.getElementById('info-name').textContent = neo.name;
  document.getElementById('info-designation').textContent = neo.designation || neo.neo_reference_id || '';

  const diam = neo.estimated_diameter?.meters;
  const diamStr = diam ? `${diam.estimated_diameter_min.toFixed(0)}–${diam.estimated_diameter_max.toFixed(0)} m` : '—';
  document.getElementById('info-diam').textContent = diamStr;
  document.getElementById('info-haz').textContent = neo.is_potentially_hazardous_asteroid ? '⚠ YES' : 'No';
  document.getElementById('info-haz').style.color = neo.is_potentially_hazardous_asteroid ? '#ff4444' : '#44ff88';

  const oel = neo.orbital_data || {};
  document.getElementById('info-sma').textContent    = oel.semi_major_axis ? `${parseFloat(oel.semi_major_axis).toFixed(4)} AU` : '—';
  document.getElementById('info-ecc').textContent    = oel.eccentricity ? parseFloat(oel.eccentricity).toFixed(6) : '—';
  document.getElementById('info-inc').textContent    = oel.inclination ? `${parseFloat(oel.inclination).toFixed(3)}°` : '—';
  document.getElementById('info-period').textContent = oel.orbital_period ? `${parseFloat(oel.orbital_period).toFixed(2)} days` : '—';
  document.getElementById('info-mag').textContent    = neo.absolute_magnitude_h ? neo.absolute_magnitude_h : '—';

  // Close approaches
  const approaches = neo.close_approach_data || [];
  const caSection = document.getElementById('close-approach-section');
  const caList = document.getElementById('approach-list');
  if (approaches.length) {
    caSection.classList.remove('hidden');
    caList.innerHTML = '';
    approaches.slice(0, 5).forEach(ca => {
      const li = document.createElement('li');
      const distAU = parseFloat(ca.miss_distance?.astronomical).toFixed(4);
      const distLD = parseFloat(ca.miss_distance?.lunar).toFixed(1);
      li.innerHTML = `<span class="ap-date">${ca.close_approach_date}</span><br>
        <span class="ap-dist">${distAU} AU / ${distLD} LD — ${ca.orbiting_body}</span>`;
      caList.appendChild(li);
    });
  } else {
    caSection.classList.add('hidden');
  }

  // NASA link
  const link = document.getElementById('info-nasa-link');
  link.href = `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(neo.neo_reference_id || neo.name)}`;

  // Highlight in list
  document.querySelectorAll('#asteroid-ul li').forEach(li => {
    li.classList.toggle('selected', li.dataset.id === id);
  });

  // Fly camera toward asteroid
  if (meshes[id]) {
    const pos = meshes[id].mesh.position.clone();
    const dir = pos.clone().normalize();
    const target = pos.clone().add(dir.multiplyScalar(-80));
    controls.target.lerp(pos, 0.5);
  }
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
const tooltip = document.createElement('div');
tooltip.id = 'tooltip';
document.body.appendChild(tooltip);

function showTooltip(x, y, text) {
  tooltip.style.display = 'block';
  tooltip.style.left = `${x + 14}px`;
  tooltip.style.top  = `${y - 8}px`;
  tooltip.textContent = text;
}
function hideTooltip() { tooltip.style.display = 'none'; }

// ─── NASA API ─────────────────────────────────────────────────────────────────
async function fetchNEOs() {
  const loading = document.getElementById('loading');
  const loadingText = document.getElementById('loading-text');

  try {
    loadingText.textContent = 'Fetching NEO catalog…';
    const pages = [0, 1, 2];
    const results = await Promise.all(pages.map(p =>
      fetch(`https://api.nasa.gov/neo/rest/v1/neo/browse?page=${p}&size=20&api_key=${NASA_KEY}`)
        .then(r => r.json())
    ));
    if (results[0]?.error) throw new Error(results[0].error.message || 'API error');
    const allNEOs = results.flatMap(r => r.near_earth_objects || []);
    if (allNEOs.length === 0) throw new Error('No data returned');

    loadingText.textContent = 'Fetching close approaches…';
    const today = new Date();
    const end = new Date(today); end.setDate(end.getDate() + 30);
    const fmt = d => d.toISOString().split('T')[0];
    const caResp = await fetch(
      `https://api.nasa.gov/neo/rest/v1/feed?start_date=${fmt(today)}&end_date=${fmt(end)}&api_key=${NASA_KEY}`
    );
    const caData = await caResp.json();
    const caObjects = Object.values(caData.near_earth_objects || {}).flat();
    caObjects.forEach(n => closeApproachIds.add(n.id));

    // Stats
    document.getElementById('stat-neo').textContent = (caData.element_count || allNEOs.length).toLocaleString();
    const phaCount = allNEOs.filter(n => n.is_potentially_hazardous_asteroid).length;
    document.getElementById('stat-pha').textContent = phaCount.toLocaleString();
    document.getElementById('stat-close').textContent = caObjects.length.toLocaleString();

    asteroids = allNEOs;

    // Build scene objects
    loadingText.textContent = 'Building 3D scene…';
    for (const neo of asteroids) {
      const obj = createAsteroidMesh(neo);
      if (obj) meshes[neo.id] = obj;
    }

    applyFilters();
    loading.classList.add('fade-out');
    setTimeout(() => loading.style.display = 'none', 700);

  } catch (err) {
    loadingText.textContent = `Error: ${err.message}. Using demo data.`;
    isDemoMode = true;
    document.getElementById('btn-demo').classList.add('active');
    document.getElementById('demo-badge').classList.add('visible');
    loadDemoData();
    setTimeout(() => {
      loading.classList.add('fade-out');
      setTimeout(() => loading.style.display = 'none', 700);
    }, 1500);
  }
}

// ─── Demo data fallback ───────────────────────────────────────────────────────
function loadDemoData() {
  const demos = [
    { id:'d1', name:'433 Eros',      a:1.458, e:0.223, inc:10.83, raan:304.3, argp:178.9, period:642,  epoch:2451545, M0:0.5,  diam:16800, haz:false },
    { id:'d2', name:'99942 Apophis', a:0.922, e:0.191, inc:3.33,  raan:204.5, argp:126.4, period:324,  epoch:2451545, M0:1.2,  diam:370,   haz:true  },
    { id:'d3', name:'1620 Geographos', a:1.245, e:0.335, inc:13.3, raan:337.2, argp:276.5, period:508,  epoch:2451545, M0:2.0, diam:2500,  haz:false },
    { id:'d4', name:'4179 Toutatis',   a:2.512, e:0.634, inc:0.47, raan:125.9, argp:274.8, period:1451, epoch:2451545, M0:3.1, diam:2900,  haz:true  },
    { id:'d5', name:'25143 Itokawa',   a:1.324, e:0.280, inc:1.62, raan:69.1,  argp:162.8, period:556,  epoch:2451545, M0:0.8, diam:535,   haz:false },
    { id:'d6', name:'1862 Apollo',     a:1.470, e:0.560, inc:6.35, raan:35.7,  argp:285.9, period:651,  epoch:2451545, M0:1.5, diam:1500,  haz:true  },
    { id:'d7', name:'2101 Adonis',     a:1.874, e:0.764, inc:1.37, raan:350.9, argp:43.9,  period:936,  epoch:2451545, M0:2.5, diam:600,   haz:false },
    { id:'d8', name:'3753 Cruithne',   a:1.000, e:0.515, inc:19.8, raan:126.3, argp:43.7,  period:365,  epoch:2451545, M0:0.3, diam:5000,  haz:false },
  ];

  document.getElementById('stat-neo').textContent = '36,000+';
  document.getElementById('stat-pha').textContent = '2,400+';
  document.getElementById('stat-close').textContent = demos.filter(d => d.haz).length.toString();

  asteroids = demos.map(d => ({
    id: d.id,
    name: d.name,
    neo_reference_id: d.id,
    is_potentially_hazardous_asteroid: d.haz,
    estimated_diameter: { meters: { estimated_diameter_min: d.diam * 0.8, estimated_diameter_max: d.diam * 1.2 } },
    orbital_data: {
      semi_major_axis: d.a.toString(),
      eccentricity: d.e.toString(),
      inclination: d.inc.toString(),
      ascending_node_longitude: d.raan.toString(),
      perihelion_argument: d.argp.toString(),
      orbital_period: d.period.toString(),
      epoch_osculation: (d.epoch).toString(),
      mean_anomaly: (d.M0 * 180 / Math.PI).toString(),
    },
    close_approach_data: [],
  }));
  if (demos[1].haz) closeApproachIds.add('d2');
  if (demos[3].haz) closeApproachIds.add('d4');

  for (const neo of asteroids) {
    const obj = createAsteroidMesh(neo);
    if (obj) meshes[neo.id] = obj;
  }
  applyFilters();
}

// ─── Clear scene asteroids ───────────────────────────────────────────────
function clearAsteroids() {
  Object.values(meshes).forEach(obj => {
    scene.remove(obj.mesh);
    scene.remove(obj.orbitLine);
    obj.mesh.geometry.dispose();
    obj.mesh.material.dispose();
    obj.orbitLine.geometry.dispose();
    obj.orbitLine.material.dispose();
  });
  meshes = {};
  asteroids = [];
  closeApproachIds.clear();
  selectedId = null;
  selectionGroup.visible = false;
  document.getElementById('right-panel').classList.add('hidden');
}

// ─── Demo mode toggle ────────────────────────────────────────────────────
document.getElementById('btn-demo').addEventListener('click', () => {
  if (isDemoMode) {
    // Switch back to live data
    isDemoMode = false;
    document.getElementById('btn-demo').classList.remove('active');
    document.getElementById('demo-badge').classList.remove('visible');
    clearAsteroids();
    const loading = document.getElementById('loading');
    loading.style.display = '';
    loading.classList.remove('fade-out');
    fetchNEOs();
  } else {
    // Switch to demo mode
    isDemoMode = true;
    document.getElementById('btn-demo').classList.add('active');
    document.getElementById('demo-badge').classList.add('visible');
    clearAsteroids();
    loadDemoData();
  }
});

// ─── Date slider ──────────────────────────────────────────────────────────────
const slider = document.getElementById('date-slider');
const dateLabel = document.getElementById('current-date-label');

function formatDate(d) {
  return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
}

function updateDateLabel() {
  dateLabel.textContent = formatDate(simDate);
}

slider.addEventListener('input', () => {
  const base = new Date();
  simDate = new Date(base.getTime() + parseInt(slider.value) * 86400000);
  updateDateLabel();
  updatePlanets();
});

// ─── Time controls ────────────────────────────────────────────────────────────
document.getElementById('btn-pause').addEventListener('click', () => {
  paused = !paused;
  document.getElementById('btn-pause').textContent = paused ? '▶' : '⏸';
});
document.getElementById('btn-faster').addEventListener('click', () => { simSpeed = Math.min(simSpeed * 2, 32); });
document.getElementById('btn-slower').addEventListener('click', () => { simSpeed = Math.max(simSpeed / 2, 0.125); });
document.getElementById('btn-reset').addEventListener('click', () => {
  simDate = new Date();
  slider.value = 0;
  simSpeed = 1;
  paused = false;
  document.getElementById('btn-pause').textContent = '⏸';
  updateDateLabel();
  updatePlanets();
});

// ─── Filters ──────────────────────────────────────────────────────────────────
document.getElementById('filter-pha').addEventListener('change', e => { filterPHA = e.target.checked; applyFilters(document.getElementById('search-input').value); });
document.getElementById('filter-safe').addEventListener('change', e => { filterSafe = e.target.checked; applyFilters(document.getElementById('search-input').value); });
document.getElementById('filter-close').addEventListener('change', e => { filterClose = e.target.checked; applyFilters(document.getElementById('search-input').value); });

let searchTimer;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applyFilters(e.target.value), 200);
});
document.getElementById('search-btn').addEventListener('click', () => applyFilters(document.getElementById('search-input').value));

// ─── Click selection ──────────────────────────────────────────────────────────
let hoveredId = null;

canvas.addEventListener('mousemove', e => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const meshList = Object.entries(meshes).map(([id, o]) => o.mesh).filter(m => m.visible);
  const hits = raycaster.intersectObjects(meshList);
  if (hits.length) {
    const obj = hits[0].object;
    const id = obj.userData.id;
    canvas.style.cursor = 'pointer';
    const neo = asteroids.find(n => n.id === id);
    if (neo) showTooltip(e.clientX, e.clientY, neo.name);
    hoveredId = id;
  } else {
    canvas.style.cursor = 'default';
    hideTooltip();
    hoveredId = null;
  }
});

canvas.addEventListener('click', e => {
  if (hoveredId) selectAsteroid(hoveredId);
});

// ─── Close panels ─────────────────────────────────────────────────────────────
document.getElementById('close-info').addEventListener('click', () => {
  document.getElementById('right-panel').classList.add('hidden');
  if (selectedId && meshes[selectedId]) {
    meshes[selectedId].orbitLine.visible = false;
    const neo = asteroids.find(n => n.id === selectedId);
    meshes[selectedId].mesh.scale.setScalar(getAsteroidSize(neo || {}));
  }
  selectionGroup.visible = false;
  selectedId = null;
  document.querySelectorAll('#asteroid-ul li').forEach(li => li.classList.remove('selected'));
});

document.getElementById('btn-info').addEventListener('click', () => {
  document.getElementById('about-modal').classList.remove('hidden');
});
document.getElementById('close-about').addEventListener('click', () => {
  document.getElementById('about-modal').classList.add('hidden');
});
document.getElementById('close-about-btn').addEventListener('click', () => {
  document.getElementById('about-modal').classList.add('hidden');
});

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Animate ──────────────────────────────────────────────────────────────────
let lastTime = 0;
function animate(time) {
  requestAnimationFrame(animate);
  const dt = (time - lastTime) / 1000;
  lastTime = time;

  if (!paused) {
    simDate = new Date(simDate.getTime() + simSpeed * 86400000 * dt);
    updateDateLabel();
    const base = new Date();
    const dayOffset = (simDate.getTime() - base.getTime()) / 86400000;
    if (dayOffset >= -365 && dayOffset <= 365) slider.value = dayOffset.toFixed(2);
  }

  updatePlanets();
  updateAsteroidPositions();

  // Selection indicator: follow selected asteroid + pulse
  if (selectedId && meshes[selectedId] && selectionGroup.visible) {
    selectionGroup.position.copy(meshes[selectedId].mesh.position);
    selRing.rotation.z += dt * 0.8;
    selRing2.rotation.y += dt * 0.5;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.003);
    glowShellMat.opacity  = 0.08 + 0.06 * pulse;
    innerGlowMat.opacity  = 0.12 + 0.08 * pulse;
    selRingMat.opacity    = 0.55 + 0.35 * pulse;
    selRing2Mat.opacity   = 0.35 + 0.25 * pulse;
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
createStars();
createSun();
createPlanets();
updateDateLabel();
updatePlanets();
fetchNEOs();
animate(0);
