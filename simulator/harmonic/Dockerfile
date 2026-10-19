# SIMULATOR CONTAINER (Harmonic) — Gazebo Harmonic + ROS 2 Humble on Ubuntu 22.04
#
# Replaces the Classic 11 / Foxy / gzweb 1.4 simulator in simulator/Dockerfile.
# P1: base runtime (gz sim, ros_gz, Mesa with the d3d12 driver for WSL2).
# P2: official ardupilot_gazebo plugin, DVD world and models in SDF 1.9, and
#     dvd_sim_bridge.py (camera + gimbal glue to ROS 2).
# P4: 3D viewer on :8080 (gzweb 3 + gz-launch websocket, behind nginx) and the
#     mgmt app on :8000, both moved in from the Classic simulator container.

# --- 3D viewer bundle (build stage only; no Node in the runtime image) -----
FROM node:20-bookworm-slim AS viewer
WORKDIR /viewer
COPY simulator/harmonic/viewer/package.json simulator/harmonic/viewer/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY simulator/harmonic/viewer/index.html ./
COPY simulator/harmonic/viewer/src ./src
RUN npm run build

# --- Simulator runtime -------------------------------------------------------
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

# Official ArduPilot plugin (JSON protocol), pinned. Its CMake also builds the
# GStreamer camera plugin, so the GStreamer/OpenCV dev packages are required
# even though DVD streams video from the companion instead.
ARG ARDUPILOT_GAZEBO_COMMIT=082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5
RUN apt-get update && apt-get install -y --no-install-recommends \
        git build-essential cmake \
        libgz-sim8-dev rapidjson-dev \
        libopencv-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev && \
    git clone https://github.com/ArduPilot/ardupilot_gazebo.git /opt/ardupilot_gazebo && \
    cd /opt/ardupilot_gazebo && git checkout ${ARDUPILOT_GAZEBO_COMMIT} && \
    GZ_VERSION=harmonic cmake -S . -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo && \
    cmake --build build -j"$(nproc)" && \
    rm -rf /var/lib/apt/lists/*

# mgmt app (same packages as the Classic simulator image) + nginx for :8080.
RUN apt-get update && apt-get install -y --no-install-recommends nginx &&     rm -f /etc/nginx/sites-enabled/default &&     rm -rf /var/lib/apt/lists/* &&     pip3 install --no-cache-dir         Flask         flask-cors         Flask-SQLAlchemy         requests         flask-sock         "python-socketio[client]==5.11.2"         docker

# WSL2: the GPU is /dev/dxg and the user-mode driver lives in /usr/lib/wsl/lib
# (mounted by docker-compose.harmonic.yaml). Mesa's d3d12 driver renders on it.
ENV __GLX_VENDOR_LIBRARY_NAME=mesa \
    MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA \
    LD_LIBRARY_PATH=/usr/lib/wsl/lib \
    RMW_IMPLEMENTATION=rmw_cyclonedds_cpp \
    ROS_DOMAIN_ID=42

# Model lookup order: DVD models first, then the official ardupilot_gazebo
# ones (iris_with_standoffs, gimbal_small_2d meshes, runway).
ENV GZ_SIM_SYSTEM_PLUGIN_PATH=/opt/ardupilot_gazebo/build \
    GZ_SIM_RESOURCE_PATH=/Simulator/models:/opt/ardupilot_gazebo/models:/opt/ardupilot_gazebo/worlds

# Static scene models are reused unchanged from the Classic assets (plain
# meshes with embedded textures, no OGRE material scripts).
COPY simulator/assets/models/hacker_van   /Simulator/models/hacker_van
COPY simulator/assets/models/hacker_desk  /Simulator/models/hacker_desk
COPY simulator/assets/models/gcs_table    /Simulator/models/gcs_table
COPY simulator/assets/models/gcs_chair    /Simulator/models/gcs_chair
COPY simulator/assets/models/operator     /Simulator/models/operator
COPY simulator/assets/models/laptop       /Simulator/models/laptop
COPY simulator/harmonic/models/           /Simulator/models/
COPY simulator/harmonic/worlds/           /Simulator/worlds/
COPY simulator/harmonic/dvd_sim_bridge.py simulator/harmonic/start.sh /Simulator/
RUN chmod +x /Simulator/start.sh
COPY simulator/harmonic/p1_camera_test.sdf /Simulator/test/p1_camera_test.sdf
# Same unicast-peer DDS config as the Classic simulator (multicast is off on
# the simulator network); the compose file points CYCLONEDDS_URI at it.
COPY simulator/conf/cyclonedds.xml /etc/cyclonedds.xml

COPY simulator/harmonic/websocket.gzlaunch /Simulator/websocket.gzlaunch
COPY simulator/harmonic/viewer/nginx.conf /etc/nginx/conf.d/dvd-viewer.conf
COPY --from=viewer /viewer/dist /Simulator/viewer
# docker-compose.harmonic.yaml also bind-mounts simulator/mgmt here (as the
# Classic compose does) so mgmt edits apply without a rebuild.
COPY simulator/mgmt /Simulator/mgmt
RUN rm -rf /Simulator/mgmt/instance/stages.db

WORKDIR /Simulator
CMD ["/Simulator/start.sh"]
