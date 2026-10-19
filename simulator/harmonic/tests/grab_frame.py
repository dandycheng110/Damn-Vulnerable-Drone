# Save one /webcam/image_raw frame (SensorData QoS) as PNG; optional gimbal pose first.
import sys, time, rclpy, numpy as np, cv2
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Image
from trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint
rclpy.init(); n = rclpy.create_node("grab")
tilt, pan, out = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
pub = n.create_publisher(JointTrajectory, "/set_joint_trajectory", 10)
time.sleep(1)
t = JointTrajectory(); t.header.frame_id = "world"
t.joint_names = ["iris_demo::gimbal_small_2d::tilt_joint", "iris_demo::iris_gimbal_mount"]
p = JointTrajectoryPoint(); p.positions = [tilt, pan]; t.points.append(p); pub.publish(t)
time.sleep(4)
got = []
n.create_subscription(Image, "/webcam/image_raw", lambda m: got.append(m), qos_profile_sensor_data)
while not got: rclpy.spin_once(n, timeout_sec=0.2)
m = got[-1]
img = np.frombuffer(m.data, np.uint8).reshape(m.height, m.width, 3)
cv2.imwrite(out, cv2.cvtColor(img, cv2.COLOR_RGB2BGR)); print("saved", out)
