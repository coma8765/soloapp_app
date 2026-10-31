#pragma once
#include <juice/juice.h>
#include <openssl/rand.h>
#include <json/json.h>
#include <stdexcept>
#include <string>

// Loopback-only TURN for the standalone local app. Credentials change on every
// process start and are disclosed only in the authenticated WebSocket welcome.
class LocalRtcRelay {
public:
    LocalRtcRelay() {
        unsigned char random[32];
        if (RAND_bytes(random, sizeof random) != 1) throw std::runtime_error("Cannot create local TURN credentials");
        constexpr char hex[] = "0123456789abcdef";
        for (auto byte : random) { password += hex[byte >> 4]; password += hex[byte & 15]; }
        juice_server_credentials_t credentials{};
        credentials.username = "planet-local";
        credentials.password = password.c_str();
        credentials.allocations_quota = 128;
        juice_server_config_t config{};
        config.credentials = &credentials;
        config.credentials_count = 1;
        config.max_allocations = 128;
        config.max_peers = 16;
        config.bind_address = "127.0.0.1";
        config.external_address = "127.0.0.1";
        config.realm = "microplanet-local";
        server = juice_server_create(&config);
        if (!server) throw std::runtime_error("Cannot start local TURN relay");
    }
    ~LocalRtcRelay() { if (server) juice_server_destroy(server); }
    LocalRtcRelay(const LocalRtcRelay &) = delete;
    LocalRtcRelay &operator=(const LocalRtcRelay &) = delete;

    Json::Value configuration() const {
        Json::Value result, entry;
        entry["urls"] = "turn:127.0.0.1:" + std::to_string(juice_server_get_port(server)) + "?transport=udp";
        entry["username"] = "planet-local";
        entry["credential"] = password;
        result["iceServers"] = Json::Value(Json::arrayValue);
        result["iceServers"].append(entry);
        result["iceTransportPolicy"] = "relay";
        return result;
    }
private:
    juice_server_t *server = nullptr;
    std::string password;
};
