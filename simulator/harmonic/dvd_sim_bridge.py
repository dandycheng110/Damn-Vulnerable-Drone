#!/usr/bin/env python3
"""Gazebo Harmonic <-> ROS 2 glue for the DVD simulator.

Replaces the two Classic gazebo_ros plugins whose ROS-side behaviour the
companion computer and the attack pages depend on:

  gazebo_ros_camera (webcam sensor)
      gz  webcam/image_raw, webcam/camera_info
      ->  ROS /webcam/image_raw, /webcam/camera_info  (SensorData QoS)

  gazebo_ros_joint_pose_trajectory (gimbal)
      ROS /set_joint_trajectory  (trajectory_msgs/JointTrajectory)
      ->  gz /dvd/gimbal/tilt, /dvd/gimbal/pan  (gz.msgs.Double, read by the
          JointPositionController systems in models/dvd_iris)

Why not ros_gz_bridge / ros_gz_image: in ros-humble-ros-gzharmonic 0.244 both
publish RELIABLE and expose no QoS setting. gazebo_ros_camera published
SensorData (BEST_EFFORT, KEEP_LAST 5), and the rogue-publisher attack
(ros2_rogue_publisher.py) mirrors that profile, so the legitimate publisher
has to match it for the attack lesson to stay the same.
"""
import rclpy
from builtin_interfaces.msg import Time
from gz.msgs10.camera_info_pb2 import CameraInfo as GzCameraInfo
from gz.msgs10.double_pb2 import Double
from gz.msgs10.image_pb2 import Image as GzImage
from gz.transport13 import Node as GzNode
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import CameraInfo, Image
from trajectory_msgs.msg import JointTrajectory

GZ_IMAGE_TOPIC = 'webcam/image_raw'
GZ_INFO_TOPIC = 'webcam/camera_info'
ROS_IMAGE_TOPIC = '/webcam/image_raw'
ROS_INFO_TOPIC = '/webcam/camera_info'
FRAME_ID = 'camera_link'  # same frame_name the Classic plugin used

# Joint names as the companion's gimbal_bridge.py sends them (Classic scoped
# names) -> gz command topic of the matching JointPositionController.
GIMBAL_JOINTS = {
    'iris_demo::gimbal_small_2d::tilt_joint': '/dvd/gimbal/tilt',
    'iris_demo::iris_gimbal_mount': '/dvd/gimbal/pan',
}

# gz.msgs.PixelFormatType -> sensor_msgs encoding (camera sensors only
# produce these).
ENCODINGS = {
    GzImage.DESCRIPTOR.fields_by_name['pixel_format_type'].enum_type
    .values_by_name[name].number: enc
    for name, enc in [
        ('RGB_INT8', 'rgb8'),
        ('RGBA_INT8', 'rgba8'),
        ('BGR_INT8', 'bgr8'),
        ('BGRA_INT8', 'bgra8'),
        ('L_INT8', 'mono8'),
        ('L_INT16', 'mono16'),
    ]
}


def _stamp(gz_header) -> Time:
    return Time(sec=gz_header.stamp.sec, nanosec=gz_header.stamp.nsec)


class DvdSimBridge(Node):
    def __init__(self):
        super().__init__('dvd_sim_bridge')
        self._image_pub = self.create_publisher(
            Image, ROS_IMAGE_TOPIC, qos_profile_sensor_data)
        self._info_pub = self.create_publisher(
            CameraInfo, ROS_INFO_TOPIC, qos_profile_sensor_data)
        self.create_subscription(
            JointTrajectory, '/set_joint_trajectory', self._on_trajectory, 10)

        self._gz = GzNode()
        self._gimbal_pubs = {
            joint: self._gz.advertise(topic, Double)
            for joint, topic in GIMBAL_JOINTS.items()
        }
        if not self._gz.subscribe(GzImage, GZ_IMAGE_TOPIC, self._on_gz_image):
            raise RuntimeError(f'cannot subscribe to gz topic {GZ_IMAGE_TOPIC}')
        if not self._gz.subscribe(GzCameraInfo, GZ_INFO_TOPIC, self._on_gz_info):
            raise RuntimeError(f'cannot subscribe to gz topic {GZ_INFO_TOPIC}')

        self.get_logger().info(
            f'gz {GZ_IMAGE_TOPIC} -> ROS {ROS_IMAGE_TOPIC} (SensorData QoS); '
            f'ROS /set_joint_trajectory -> gz {", ".join(GIMBAL_JOINTS.values())}')

    # gz -> ROS (called on gz-transport threads) ---------------------------

    def _on_gz_image(self, gz_msg: GzImage) -> None:
        encoding = ENCODINGS.get(gz_msg.pixel_format_type)
        if encoding is None:
            self.get_logger().warning(
                f'unsupported pixel format {gz_msg.pixel_format_type}',
                throttle_duration_sec=10.0)
            return
        msg = Image()
        msg.header.stamp = _stamp(gz_msg.header)
        msg.header.frame_id = FRAME_ID
        msg.height = gz_msg.height
        msg.width = gz_msg.width
        msg.encoding = encoding
        msg.is_bigendian = 0
        msg.step = gz_msg.step
        msg.data = gz_msg.data
        self._image_pub.publish(msg)

    def _on_gz_info(self, gz_msg: GzCameraInfo) -> None:
        msg = CameraInfo()
        msg.header.stamp = _stamp(gz_msg.header)
        msg.header.frame_id = FRAME_ID
        msg.width = gz_msg.width
        msg.height = gz_msg.height
        msg.distortion_model = 'plumb_bob'
        msg.d = list(gz_msg.distortion.k)
        if len(gz_msg.intrinsics.k) == 9:
            msg.k = list(gz_msg.intrinsics.k)
        if len(gz_msg.projection.p) == 12:
            msg.p = list(gz_msg.projection.p)
        if len(gz_msg.rectification_matrix) == 9:
            msg.r = list(gz_msg.rectification_matrix)
        self._info_pub.publish(msg)

    # ROS -> gz ------------------------------------------------------------

    def _on_trajectory(self, msg: JointTrajectory) -> None:
        # The Classic plugin applied the last point of the trajectory; the
        # JointPositionController's PID + joint damping does the smoothing
        # that time_from_start used to provide.
        if not msg.points:
            return
        point = msg.points[-1]
        for name, position in zip(msg.joint_names, point.positions):
            pub = self._gimbal_pubs.get(name)
            if pub is None:
                self.get_logger().warning(
                    f'unknown gimbal joint {name!r}', throttle_duration_sec=10.0)
                continue
            cmd = Double()
            cmd.data = float(position)
            pub.publish(cmd)


def main() -> None:
    rclpy.init()
    node = DvdSimBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
