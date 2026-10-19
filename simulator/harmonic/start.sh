#!/bin/bash
# Harmonic simulator entrypoint. Logs go to /var/log/dvd/.
#   gz sim server      headless, ogre2 via EGL (a GPU if one is passed in,
#                      otherwise Mesa llvmpipe)
#   dvd_sim_bridge.py  camera + gimbal glue to ROS 2
#   gz launch          websocket server for the 3D viewer (:9090, internal)
#   nginx              :8080 viewer page + /ws proxy
#   mgmt               :8000 DVD management app (set DVD_MGMT=0 to skip)
#
# DVD_WORLD can point at another SDF (default: the DVD world).
# The container exits when any of these dies, so `docker logs` / the files
# in /var/log/dvd show which one.
# setup.bash reads unset variables, so source it before enabling set -u.
source /opt/ros/humble/setup.bash
set -u

WORLD="${DVD_WORLD:-/Simulator/worlds/damn-vulnerable-drone.sdf}"
LOG_DIR=/var/log/dvd
mkdir -p "$LOG_DIR"
PIDS=()

# Xvfb is not needed for headless rendering; it stays for ad-hoc GUI
# debugging (DISPLAY=:100 gz sim -g).
rm -f /tmp/.X100-lock
Xvfb :100 -screen 0 1600x1200x24 >"$LOG_DIR/xvfb.log" 2>&1 &

echo "[start] gz sim server: $WORLD"
gz sim -s -r -v 3 --headless-rendering "$WORLD" >"$LOG_DIR/gz-sim.log" 2>&1 &
PIDS+=($!)

# Let the server advertise its topics before the clients connect.
for _ in $(seq 1 60); do
    gz topic -l 2>/dev/null | grep -q '^/clock$' && break
    sleep 1
done

echo "[start] dvd_sim_bridge"
python3 /Simulator/dvd_sim_bridge.py >"$LOG_DIR/dvd_sim_bridge.log" 2>&1 &
PIDS+=($!)

echo "[start] websocket server + nginx (:8080)"
gz launch -v 3 /Simulator/websocket.gzlaunch >"$LOG_DIR/websocket.log" 2>&1 &
PIDS+=($!)
nginx -g 'daemon off;' >"$LOG_DIR/nginx.log" 2>&1 &
PIDS+=($!)

if [ "${DVD_MGMT:-1}" != 0 ]; then
    echo "[start] mgmt (:8000)"
    (cd /Simulator/mgmt && exec python3 app.py) >"$LOG_DIR/mgmt.log" 2>&1 &
    PIDS+=($!)
fi

trap 'kill "${PIDS[@]}" 2>/dev/null' TERM INT
wait -n "${PIDS[@]}"
echo "[start] a process exited; stopping"
kill "${PIDS[@]}" 2>/dev/null
wait
