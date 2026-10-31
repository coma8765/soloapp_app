#include "rtc_config.hpp"
#include <iostream>

void check(bool value) { if (!value) throw std::runtime_error("RTC configuration assertion failed"); }
void rejects(const Json::Value &config) {
    try { validateRtcConfig(config); } catch (const std::runtime_error &) { return; }
    throw std::runtime_error("Invalid RTC config accepted");
}
int main() {
    try {
        auto config = loadRtcConfig("");
        check(config["iceServers"].empty() && config["iceTransportPolicy"] == "all");
        Json::Value server;
        server["urls"] = "stun:stun.example.com:3478";
        config["iceServers"].append(server);
        check(validateRtcConfig(config)["iceServers"][0]["urls"].isArray());
        config["iceTransportPolicy"] = "relay";
        rejects(config);
        server["urls"] = "turns:turn.example.com:5349?transport=tcp";
        server["username"] = "test"; server["credential"] = "test-secret";
        config["iceServers"].append(server);
        check(validateRtcConfig(config)["iceTransportPolicy"] == "relay");
        config["iceServers"][1].removeMember("credential"); rejects(config);
        config["iceTransportPolicy"] = "all";
        config["iceServers"].resize(1);
        config["iceServers"][0]["urls"] = "https://example.com"; rejects(config);
        config["iceServers"][0]["urls"] = "stun:"; rejects(config);
        config["iceServers"][0]["urls"] = Json::Value(Json::arrayValue); rejects(config);
        config["iceServers"] = "invalid"; rejects(config);
        rejects(Json::Value());
        std::cout << "PASS: RTC defaults, STUN/TURN, relay policy and invalid configuration\n";
    } catch (const std::exception &error) { std::cerr << error.what() << '\n'; return 1; }
}
