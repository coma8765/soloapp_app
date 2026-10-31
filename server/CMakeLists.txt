cmake_minimum_required(VERSION 3.20)
project(planet_server LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Drogon CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(SQLite3 REQUIRED)
include(FetchContent)
set(NO_MEDIA ON CACHE BOOL "" FORCE)
set(NO_WEBSOCKET ON CACHE BOOL "" FORCE)
set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
FetchContent_Declare(datachannel
    GIT_REPOSITORY https://github.com/paullouisageneau/libdatachannel.git
    GIT_TAG v0.23.2
    GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(datachannel)
add_library(planet_auth auth.cpp)
target_include_directories(planet_auth PUBLIC ${SQLITE3_INCLUDE_DIRS})
target_link_libraries(planet_auth PUBLIC Drogon::Drogon OpenSSL::Crypto ${SQLITE3_LIBRARIES})
add_executable(planet_server main.cpp simulation.cpp auth_http.cpp)
target_link_libraries(planet_server PRIVATE Drogon::Drogon datachannel planet_auth)
target_compile_options(planet_server PRIVATE -Wall -Wextra -Wpedantic)
enable_testing()
add_executable(simulation_test simulation_test.cpp simulation.cpp)
target_link_libraries(simulation_test PRIVATE Drogon::Drogon)
add_test(NAME fish_simulation COMMAND simulation_test ${CMAKE_CURRENT_SOURCE_DIR}/data/lakes.json)

# The browser client is already native ES modules; packaging needs no npm or transpiler.
add_custom_target(web_client ALL
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_CURRENT_SOURCE_DIR}/../public ${CMAKE_BINARY_DIR}/web
    COMMENT "Packaging standalone Babylon.js client")
if(UNIX)
    add_executable(auth_test auth_test.cpp)
    target_link_libraries(auth_test PRIVATE planet_auth)
    add_test(NAME authentication COMMAND auth_test)
    add_executable(network_test network_test.cpp)
    target_link_libraries(network_test PRIVATE Drogon::Drogon datachannel)
    add_test(NAME multiplayer_webrtc COMMAND network_test $<TARGET_FILE:planet_server>
        ${CMAKE_CURRENT_SOURCE_DIR}/data/lakes.json ${CMAKE_CURRENT_SOURCE_DIR}/../public)
    set_tests_properties(multiplayer_webrtc PROPERTIES TIMEOUT 40)
endif()
