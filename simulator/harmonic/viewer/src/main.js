// DVD 3D viewer for Gazebo Harmonic.
//
// Served on container port 8080; the host port defaults to 8080 and the mgmt
// page loads it from SIM_VIEWER_URL. The gz-launch websocket server is proxied
// by nginx on the same origin at /ws, and the companion computer's MJPEG feed
// at /camera/feed, so a single SSH port forward of the viewer port is enough
// for remote viewing.
//
// postMessage protocol kept from the Classic gzweb page:
//   mgmt -> viewer  "set-stageN-<status>"  stage UI lives in mgmt now; ignored
//   mgmt -> viewer  "resetWorldCallback"   the world itself is reset by mgmt's
//                                          /reset route (gz world_control);
//                                          the viewer only resets its camera
import './gzwebFixups.js';
import { SceneManager, Topic } from 'gzweb';

const DRONE = 'iris_demo';
const MGMT_ORIGINS = ['http://localhost:8000', 'http://127.0.0.1:8000'];

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const scene = new SceneManager({ elementId: 'gz-scene', websocketUrl: wsUrl });
window.dvdScene = scene; // for debugging from the browser console

const $ = (id) => document.getElementById(id);

// protobufjs decodes int64 fields to Long objects.
const num = (v) => (v && typeof v.toNumber === 'function' ? v.toNumber() : Number(v || 0));
const deg = (rad) => (rad * 180) / Math.PI;

function droneObject() {
  return scene.scene ? scene.scene.scene.getObjectByName(DRONE) : undefined;
}

// --- Camera modes ----------------------------------------------------------
// chase / third / first are gzweb's own follow modes; free is the plain orbit
// control; top-down is done here, on top of the orbit control.
let cameraMode = 'free';

function setCameraMode(mode) {
  const gz = scene.scene;
  const drone = droneObject();
  if (!gz || (!drone && mode !== 'free')) return;
  cameraMode = mode;
  scene.follow(null); // gzweb stops following only on null, not ''
  if (mode === 'chase') scene.follow(DRONE);
  if (mode === 'third') scene.thirdPersonFollow(DRONE);
  if (mode === 'first') scene.firstPerson(DRONE);
  if ((mode === 'free' || mode === 'top') && drone) {
    // Orbit around the drone from wherever the camera is now.
    gz.controls.target.copy(drone.position);
  }
  for (const b of document.querySelectorAll('#camera-modes [data-mode]')) {
    b.classList.toggle('on', b.dataset.mode === mode);
  }
}

for (const b of document.querySelectorAll('#camera-modes [data-mode]')) {
  b.addEventListener('click', () => setCameraMode(b.dataset.mode));
}

function resetView() {
  setCameraMode('free');
  if (scene.scene) scene.scene.controls.target.set(0, 0, 0);
  scene.resetView();
}
$('btn-reset-view').addEventListener('click', resetView);

// Top-down: keep the camera above the drone. The distance comes from the
// orbit control, so the mouse wheel still zooms. A small offset avoids the
// degenerate "looking straight along up" case of OrbitControls.
function trackTopDown() {
  requestAnimationFrame(trackTopDown);
  if (cameraMode !== 'top') return;
  const gz = scene.scene;
  const drone = droneObject();
  if (!gz || !drone) return;
  const dist = Math.max(2, gz.camera.position.distanceTo(gz.controls.target));
  gz.controls.target.copy(drone.position);
  gz.camera.position.set(drone.position.x - dist * 0.02, drone.position.y, drone.position.z + dist);
  gz.camera.lookAt(drone.position);
}
requestAnimationFrame(trackTopDown);

window.addEventListener('resize', () => scene.resize());

window.addEventListener('message', (event) => {
  if (!MGMT_ORIGINS.includes(event.origin)) return;
  if (event.data === 'resetWorldCallback') resetView();
});

// --- World control ---------------------------------------------------------
// Service requests go through the websocket server as "req,<service>,<type>,
// <serialized request>". gzweb's requestService() can't be used: it uses the
// old ignition.msgs type names and sends the payload as text, which mangles
// every byte above 0x7f. So the frame is built here and sent binary.
//
// The server also treats the frame as a C string split on commas: a payload
// that is empty, or contains 0x00 or 0x2c, is cut short. {pause: false} is
// empty in proto3 (and 10 00 spelled out has the 0x00), so Play is "run to the
// far future" (run_to_sim_time), and Step runs to now + N ms the same way,
// nudging the target so that no 0x2c byte appears. multi_step/step are no use
// either: on gz-sim 8.15 a paused multi_step leaves the world running
// afterwards, while run_to_sim_time runs exactly to the target and pauses.
//
// Pausing mid-flight is safe: SITL waits for the plugin's JSON frames, so it
// freezes with the world (MAVLink goes quiet too) and carries on from the
// same state on Play.
let paused = false;
let simTime = null; // { sec, nsec } from the latest stats message

const SAFE = (body) => body.length > 0 && !body.includes(0x00) && !body.includes(0x2c);

function encodeControl(req) {
  const def = scene.transport.root.lookupType('gz.msgs.WorldControl');
  return def.encode(def.create(req)).finish();
}

function worldControl(body) {
  const t = scene.transport;
  const world = t.getWorld();
  if (!world || !t.ws || t.ws.readyState !== WebSocket.OPEN || !SAFE(body)) return;
  const type = 'gz.msgs.WorldControl';
  const head = new TextEncoder().encode(`req,/world/${world}/control,${type},`);
  const frame = new Uint8Array(head.length + body.length);
  frame.set(head);
  frame.set(body, head.length);
  t.ws.send(frame);
}

$('btn-play').addEventListener('click', () => {
  worldControl(encodeControl(paused ? { run_to_sim_time: { sec: 0x7fffffff } } : { pause: true }));
});
$('btn-step').addEventListener('click', () => {
  if (!simTime || !scene.transport.root) return;
  // One physics step is 1 ms (the world's max_step_size). The world runs while
  // sim time < target, so a target up to 1 ms early still lands on the same
  // step; walk it back a nanosecond at a time until the bytes are safe. If the
  // seconds field itself has a 0x2c, carry one second into nanoseconds.
  const target = simTime.sec * 1e9 + simTime.nsec + Number($('step-size').value) * 1e6;
  for (let back = 0; back < 1000; back++) {
    const ns = target - back;
    for (const carry of [0, 1]) {
      const sec = Math.floor(ns / 1e9) - carry;
      const body = encodeControl({ run_to_sim_time: { sec, nsec: ns - sec * 1e9 } });
      if (SAFE(body)) {
        worldControl(body);
        return;
      }
    }
  }
});

function showPaused(p) {
  paused = p;
  $('btn-play').textContent = p ? 'Play' : 'Pause';
  $('btn-play').classList.toggle('on', p);
  $('btn-step').disabled = !p;
  $('sim-state').textContent = p ? 'paused' : 'running';
  $('sim-state').classList.toggle('paused', p);
}

// --- Telemetry -------------------------------------------------------------
// World stats from /world/<world>/stats; the drone's pose is the one gzweb
// already applies to the 3D model, sampled on each stats message and
// differentiated over sim time for the speeds.
// Milliseconds while paused, so single steps show up.
function formatSimTime(s, precise) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const d = precise ? 3 : 1;
  const sec = (s % 60).toFixed(d).padStart(d + 3, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

let last = null; // { t, x, y, z }
let climb = 0;
let speed = 0;

function updateDrone(t) {
  const drone = droneObject();
  if (!drone) return;
  const { x, y, z } = drone.position;
  if (last && t > last.t) {
    const dt = t - last.t;
    const a = Math.min(1, dt / 0.5); // ~0.5 s smoothing
    climb += a * ((z - last.z) / dt - climb);
    speed += a * (Math.hypot(x - last.x, y - last.y) / dt - speed);
  } else if (last && t < last.t) {
    climb = 0; // world reset
    speed = 0;
  }
  if (!last || t !== last.t) last = { t, x, y, z };

  const q = drone.quaternion;
  const roll = deg(Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)));
  const pitch = deg(Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.y - q.z * q.x)))));
  const yaw = deg(Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)));
  // The world is ENU (+X east, +Y north; checked against ArduPilot's VFR_HUD
  // heading), so a compass heading is 90° - yaw.
  const heading = (((90 - yaw) % 360) + 360) % 360;

  $('d-alt').textContent = `${z.toFixed(2)} m`;
  $('d-climb').textContent = `${climb.toFixed(2)} m/s`;
  $('d-speed').textContent = `${speed.toFixed(2)} m/s`;
  $('d-heading').textContent = `${heading.toFixed(0)}°`;
  // ArduPilot convention: positive pitch is nose up (world pitch is nose down).
  $('d-att').textContent = `${roll.toFixed(1)}° / ${(-pitch).toFixed(1)}°`;
}

function onStats(msg) {
  simTime = {
    sec: num(msg.sim_time && msg.sim_time.sec),
    nsec: num(msg.sim_time && msg.sim_time.nsec),
  };
  const t = simTime.sec + simTime.nsec / 1e9;
  $('sim-time').textContent = formatSimTime(t, Boolean(msg.paused));
  $('sim-rtf').textContent = `${(num(msg.real_time_factor) * 100).toFixed(0)}%`;
  showPaused(Boolean(msg.paused));
  updateDrone(t);
}

let subscribed = false;
function subscribeStats() {
  const world = scene.transport.getWorld();
  const name = `/world/${world}/stats`;
  if (subscribed || !world) return;
  if (!scene.transport.availableTopics.some((p) => p.topic === name)) return;
  scene.subscribeToTopic(new Topic(name, onStats));
  subscribed = true;
}

// --- Connection status -----------------------------------------------------
// "disconnected" -> "connected" -> "ready".
const statusEl = $('status');
let lastStatus = '';
setInterval(() => {
  const s = scene.getConnectionStatus();
  if (s === 'ready') subscribeStats();
  else subscribed = false;
  if (s === lastStatus) return;
  lastStatus = s;
  statusEl.textContent = s === 'ready' ? 'connected to Gazebo' : `Gazebo: ${s}`;
  statusEl.classList.toggle('bad', s === 'error' || s === 'disconnected');
}, 500);

// --- Companion camera ------------------------------------------------------
// MJPEG from the companion computer, proxied by nginx at /camera/feed. It only
// has frames once the companion's camera stream is up, so retry on error.
const camBox = $('camera');
const camImg = $('camera-img');
const camMsg = $('camera-msg');
let camRetry = null;

function camMessage(text) {
  camMsg.textContent = text;
  camMsg.style.display = text ? '' : 'none';
}

function startCamera() {
  clearTimeout(camRetry);
  camMessage('connecting…');
  camImg.src = `/camera/feed?t=${Date.now()}`;
}

function stopCamera() {
  clearTimeout(camRetry);
  camImg.removeAttribute('src');
}

camImg.addEventListener('error', () => {
  if (camBox.classList.contains('collapsed')) return;
  camMessage('no feed from the companion computer, retrying…');
  camRetry = setTimeout(startCamera, 3000);
});
// Browsers differ in when "load" fires for multipart images, so poll for the
// first frame instead.
setInterval(() => {
  if (camImg.getAttribute('src') && camImg.naturalWidth > 0 && camMsg.textContent === 'connecting…') {
    camMessage('');
  }
}, 300);

$('btn-camera').addEventListener('click', () => {
  const hide = !camBox.classList.contains('collapsed');
  camBox.classList.toggle('collapsed', hide);
  $('btn-camera').textContent = hide ? 'Show' : 'Hide';
  if (hide) stopCamera();
  else startCamera();
});

startCamera();
