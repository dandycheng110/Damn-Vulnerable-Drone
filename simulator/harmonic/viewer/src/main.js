// DVD 3D viewer for Gazebo Harmonic.
//
// Served on container port 8080; the host port defaults to 8080 and the mgmt
// page loads it from SIM_VIEWER_URL. The gz-launch websocket server is proxied
// by nginx on the same origin at /ws, so a single SSH port forward of the
// viewer port is enough for remote viewing.
//
// postMessage protocol kept from the Classic gzweb page:
//   mgmt -> viewer  "set-stageN-<status>"  stage UI lives in mgmt now; ignored
//   mgmt -> viewer  "resetWorldCallback"   the world itself is reset by mgmt's
//                                          /reset route (gz world_control);
//                                          the viewer only resets its camera
import './gzwebFixups.js';
import { SceneManager } from 'gzweb';

const DRONE = 'iris_demo';
const MGMT_ORIGINS = ['http://localhost:8000', 'http://127.0.0.1:8000'];

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const scene = new SceneManager({ elementId: 'gz-scene', websocketUrl: wsUrl });
window.dvdScene = scene; // for debugging from the browser console

const statusEl = document.getElementById('status');
const followBtn = document.getElementById('btn-follow');
let following = false;

function setFollow(on) {
  following = on;
  // gzweb's Scene stops following only on null (an empty string is ignored).
  scene.follow(on ? DRONE : null);
  followBtn.classList.toggle('on', on);
}

followBtn.addEventListener('click', () => setFollow(!following));
document.getElementById('btn-reset-view').addEventListener('click', () => {
  setFollow(false);
  scene.resetView();
});

window.addEventListener('resize', () => scene.resize());

window.addEventListener('message', (event) => {
  if (!MGMT_ORIGINS.includes(event.origin)) return;
  if (event.data === 'resetWorldCallback') {
    setFollow(false);
    scene.resetView();
  }
});

// Connection status: "disconnected" -> "connected" -> "ready".
let last = '';
setInterval(() => {
  const s = scene.getConnectionStatus();
  if (s === last) return;
  last = s;
  statusEl.textContent = s === 'ready' ? 'connected to Gazebo' : `Gazebo: ${s}`;
  statusEl.classList.toggle('bad', s === 'error' || s === 'disconnected');
}, 500);
