#!/usr/bin/env python3
"""P3 flight smoke test: GUIDED -> arm -> takeoff -> hover -> LAND.

Run inside the flight-controller container while SITL is up with
--model JSON (serial0 is the companion UART, so use SITL's serial1):

    python3 flight_check.py tcp:127.0.0.1:5762 10

Prints altitude / attitude samples so hover stability can be compared with
the Classic simulator.
"""
import sys
import time

from pymavlink import mavutil

url = sys.argv[1] if len(sys.argv) > 1 else 'tcp:127.0.0.1:5762'
target_alt = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0

m = mavutil.mavlink_connection(url)
m.wait_heartbeat(timeout=30)
print(f'heartbeat sys={m.target_system} comp={m.target_component}')
m.mav.request_data_stream_send(
    m.target_system, m.target_component,
    mavutil.mavlink.MAV_DATA_STREAM_ALL, 10, 1)


def wait_ready(timeout=120):
    """Wait until the EKF has a position estimate (pre-arm needs it)."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        msg = m.recv_match(type=['EKF_STATUS_REPORT', 'STATUSTEXT'],
                           blocking=True, timeout=5)
        if msg is None:
            continue
        if msg.get_type() == 'STATUSTEXT':
            print('  STATUSTEXT:', msg.text)
        elif msg.flags & mavutil.mavlink.EKF_POS_HORIZ_ABS:
            return time.time() - t0
    raise SystemExit('EKF never reported an absolute position')


print(f'EKF ready after {wait_ready():.1f}s')
m.set_mode('GUIDED')

def try_arm(window=3.0):
    """Send one arm command; True if a heartbeat shows armed within window."""
    m.arducopter_arm()
    t0 = time.time()
    while time.time() - t0 < window:
        msg = m.recv_match(type=['HEARTBEAT', 'STATUSTEXT'],
                           blocking=True, timeout=1)
        if msg is None:
            continue
        if msg.get_type() == 'STATUSTEXT':
            print('  arm:', msg.text)
        elif msg.get_srcSystem() == m.target_system and m.motors_armed():
            return True
    return False


for _ in range(10):
    if try_arm():
        break
    time.sleep(2)
else:
    raise SystemExit('could not arm')
print('armed')

m.mav.command_long_send(
    m.target_system, m.target_component,
    mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, 0, target_alt)

t0 = time.time()
reached = None
samples = []
while time.time() - t0 < 45:
    pos = m.recv_match(type='GLOBAL_POSITION_INT', blocking=True, timeout=2)
    att = m.recv_match(type='ATTITUDE', blocking=False)
    if pos is None:
        continue
    alt = pos.relative_alt / 1000.0
    if reached is None and alt >= 0.95 * target_alt:
        reached = time.time() - t0
        print(f'reached {alt:.2f} m after {reached:.1f}s')
    if reached is not None:
        samples.append(alt)
        if att is not None and len(samples) % 20 == 0:
            print(f'  hover alt={alt:.2f} roll={att.roll*57.3:+.1f} '
                  f'pitch={att.pitch*57.3:+.1f} yaw={att.yaw*57.3:+.1f}')
    if reached is not None and time.time() - t0 > reached + 15:
        break

if reached is None:
    raise SystemExit('takeoff target not reached in 45 s')
print(f'hover alt min={min(samples):.2f} max={max(samples):.2f} '
      f'({len(samples)} samples)')

m.set_mode('LAND')
t0 = time.time()
while time.time() - t0 < 60:
    hb = m.recv_match(type='HEARTBEAT', blocking=True, timeout=2)
    if hb is not None and hb.get_srcSystem() == m.target_system \
            and not (hb.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED):
        print(f'landed and disarmed after {time.time() - t0:.1f}s')
        break
else:
    raise SystemExit('did not disarm after LAND')
