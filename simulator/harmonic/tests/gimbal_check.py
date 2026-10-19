# Mimics companion gimbal_bridge.py: publish JointTrajectory, then read gz joint states.
import time, rclpy
from builtin_interfaces.msg import Duration
from trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint
from gz.transport13 import Node as GzNode
from gz.msgs10.model_pb2 import Model

state = {}
def on_js(m):
    for j in m.joint:
        if j.name in ("tilt_joint", "iris_gimbal_mount") or j.name.endswith("tilt_joint"):
            state[j.name] = j.axis1.position
gz = GzNode()
gz.subscribe(Model, "/world/default/model/iris_demo/joint_state", on_js)
gz.subscribe(Model, "/world/default/model/iris_demo/model/gimbal_small_2d/joint_state", on_js)

rclpy.init()
n = rclpy.create_node("gimbal_test")
pub = n.create_publisher(JointTrajectory, "/set_joint_trajectory", 10)
time.sleep(2)
print("before", state)
for tilt, pan in [(0.8, 0.5), (0.0, -1.0)]:
    t = JointTrajectory()
    t.header.frame_id = "world"
    t.joint_names = ["iris_demo::gimbal_small_2d::tilt_joint", "iris_demo::iris_gimbal_mount"]
    p = JointTrajectoryPoint(); p.positions = [tilt, pan]
    p.time_from_start = Duration(sec=0, nanosec=200_000_000)
    t.points.append(p)
    pub.publish(t)
    for s in (0.5, 1.5, 4):
        time.sleep(s if s == 0.5 else s - 0.5 if s == 1.5 else 2.5)
        print(f"target tilt={tilt} pan={pan} after~{s}s:", {k: round(v, 3) for k, v in state.items()})
