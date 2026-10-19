#!/bin/bash
# Harmonic simulator entrypoint: gz sim server (headless, ogre2 via EGL on the
# WSL2 d3d12 GPU) + dvd_sim_bridge.py. Logs go to /var/log/dvd/.
#
# DVD_WORLD can point at another SDF (e.g. /Simulator/test/p1_camera_test.sdf).
# The container exits when either process dies, so `docker logs` / the files
# in /var/log/dvd show which one.
# setup.bash reads unset variables, so source it before enabling set -u.
source /opt/ros/humble/setup.bash
set -u

WORLD="${DVD_WORLD:-/Simulator/worlds/damn-vulnerable-drone.sdf}"
LOG_DIR=/var/log/dvd
mkdir -p "$LOG_DIR"

# Xvfb is not needed for headless rendering; it stays for ad-hoc GUI
# debugging (DISPLAY=:100 gz sim -g) until the web viewer lands in P4.
rm -f /tmp/.X100-lock
Xvfb :100 -screen 0 1600x1200x24 >"$LOG_DIR/xvfb.log" 2>&1 &

echo "[start] gz sim server: $WORLD"
gz sim -s -r -v 3 --headless-rendering "$WORLD" >"$LOG_DIR/gz-sim.log" 2>&1 &
GZ_PID=$!

# Let the server advertise its topics before the bridge subscribes.
for _ in $(seq 1 60); do
    gz topic -l 2>/dev/null | grep -q '^/clock$' && break
    sleep 1
done

echo "[start] dvd_sim_bridge"
python3 /Simulator/dvd_sim_bridge.py >"$LOG_DIR/dvd_sim_bridge.log" 2>&1 &
BRIDGE_PID=$!

trap 'kill $GZ_PID $BRIDGE_PID 2>/dev/null' TERM INT
wait -n $GZ_PID $BRIDGE_PID
echo "[start] a process exited; stopping"
kill $GZ_PID $BRIDGE_PID 2>/dev/null
wait
