# SIMULATOR CONTAINER (Harmonic) — Gazebo Harmonic + ROS 2 Humble on Ubuntu 22.04
#
# Replaces the Classic 11 / Foxy / gzweb 1.4 simulator in simulator/Dockerfile.
# P1 scope: the base runtime only (gz sim, ros_gz, Mesa with the d3d12 driver
# for WSL2). Models, the ArduPilot plugin, the web viewer and the mgmt app are
# added in later phases.
FROM ros:humble-ros-base-jammy

ENV DEBIAN_FRONTEND=noninteractive

# Gazebo Harmonic + ros_gz for Humble come from the OSRF repo
# (Harmonic is not the default pairing for Humble, so ros-humble-ros-gz from
# packages.ros.org would pull Fortress instead).
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl gnupg lsb-release ca-certificates && \
    curl -fsSL https://packages.osrfoundation.org/gazebo.gpg \
        -o /usr/share/keyrings/pkgs-osrf-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/pkgs-osrf-archive-keyring.gpg] http://packages.osrfoundation.org/gazebo/ubuntu-stable $(lsb_release -cs) main" \
        > /etc/apt/sources.list.d/gazebo-stable.list && \
    apt-get update && apt-get install -y --no-install-recommends \
        gz-harmonic \
        ros-humble-ros-gzharmonic \
        ros-humble-rmw-cyclonedds-cpp \
        ros-humble-image-transport \
        ros-humble-cv-bridge \
        mesa-utils libgl1-mesa-dri libegl-mesa0 \
        xvfb \
        python3-pip && \
    rm -rf /var/lib/apt/lists/*

# WSL2: the GPU is /dev/dxg and the user-mode driver lives in /usr/lib/wsl/lib
# (mounted by docker-compose.harmonic.yaml). Mesa's d3d12 driver renders on it.
ENV __GLX_VENDOR_LIBRARY_NAME=mesa \
    MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA \
    LD_LIBRARY_PATH=/usr/lib/wsl/lib \
    RMW_IMPLEMENTATION=rmw_cyclonedds_cpp \
    ROS_DOMAIN_ID=42

COPY simulator/harmonic/p1_camera_test.sdf /Simulator/test/p1_camera_test.sdf

WORKDIR /Simulator
CMD ["bash", "-c", "rm -f /tmp/.X100-lock; Xvfb :100 -screen 0 1600x1200x24 & sleep infinity"]
