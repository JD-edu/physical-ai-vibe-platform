# CMake generated Testfile for 
# Source directory: /home/robo/physical-ai-vibe-platform/bridge-server
# Build directory: /home/robo/physical-ai-vibe-platform/bridge-server/build
# 
# This file includes the relevant testing commands required for 
# testing this directory and lists subdirectories to be tested as well.
add_test(bridge_link_events "/home/robo/physical-ai-vibe-platform/bridge-server/build/network-state-test")
set_tests_properties(bridge_link_events PROPERTIES  ENVIRONMENT "QT_QPA_PLATFORM=offscreen" TIMEOUT "30" _BACKTRACE_TRIPLES "/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;23;add_test;/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;0;")
add_test(camera_usb_provision "/home/robo/physical-ai-vibe-platform/bridge-server/build/camera-provision-test")
set_tests_properties(camera_usb_provision PROPERTIES  ENVIRONMENT "QT_QPA_PLATFORM=offscreen" TIMEOUT "30" _BACKTRACE_TRIPLES "/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;25;add_test;/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;0;")
add_test(esp32_link_frames "/usr/bin/python3" "/home/robo/physical-ai-vibe-platform/bridge-server/../esp32/tests/test_link_frames.py")
set_tests_properties(esp32_link_frames PROPERTIES  TIMEOUT "15" _BACKTRACE_TRIPLES "/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;32;add_test;/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;0;")
add_test(esp32_wifi_provision "/usr/bin/python3" "/home/robo/physical-ai-vibe-platform/bridge-server/../esp32/tests/test_wifi_provision.py")
set_tests_properties(esp32_wifi_provision PROPERTIES  TIMEOUT "15" _BACKTRACE_TRIPLES "/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;34;add_test;/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;0;")
add_test(bridge_ui_lifecycle "/home/robo/physical-ai-vibe-platform/bridge-server/build/phyvibe-bridge" "--smoke-test" "--port" "0" "--tcp-port" "0" "--host" "127.0.0.1")
set_tests_properties(bridge_ui_lifecycle PROPERTIES  ENVIRONMENT "QT_QPA_PLATFORM=offscreen" TIMEOUT "15" _BACKTRACE_TRIPLES "/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;36;add_test;/home/robo/physical-ai-vibe-platform/bridge-server/CMakeLists.txt;0;")
