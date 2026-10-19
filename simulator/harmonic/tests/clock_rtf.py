# Empirical RTF: sim-time advance (ROS /clock) divided by wall-clock elapsed.
import time, rclpy
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from rosgraph_msgs.msg import Clock
rclpy.init()
n = rclpy.create_node('rtf_probe')
state = {}
def cb(m): state['t'] = m.clock.sec + m.clock.nanosec * 1e-9
qos = QoSProfile(depth=10, reliability=ReliabilityPolicy.BEST_EFFORT, history=HistoryPolicy.KEEP_LAST)
n.create_subscription(Clock, '/clock', cb, qos)
# wait for first
t0 = time.time()
while 't' not in state and time.time() - t0 < 10:
    rclpy.spin_once(n, timeout_sec=0.1)
if 't' not in state:
    print('no /clock'); raise SystemExit
sim0, wall0 = state['t'], time.time()
end = wall0 + 10
while time.time() < end:
    rclpy.spin_once(n, timeout_sec=0.1)
sim1, wall1 = state['t'], time.time()
print(f'RTF = {(sim1 - sim0) / (wall1 - wall0):.3f}  (sim {sim1-sim0:.2f}s / wall {wall1-wall0:.2f}s)')
