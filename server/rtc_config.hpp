#pragma once
#include <json/json.h>
#include <fstream>
#include <stdexcept>
#include <string>

// Sent only in an authenticated welcome. Never serve the configuration file.
inline Json::Value validateRtcConfig(const Json::Value &input) {
    auto fail = [] { throw std::runtime_error("Invalid RTC config: expected iceServers and optional iceTransportPolicy (all/relay)"); };
    if (!input.isObject()) fail();
    Json::Value result(Json::objectValue);
    result["iceServers"] = Json::Value(Json::arrayValue);
    result["iceTransportPolicy"] = "all";
    if (input.isMember("iceTransportPolicy")) {
        if (input["iceTransportPolicy"] != "all" && input["iceTransportPolicy"] != "relay") fail();
        result["iceTransportPolicy"] = input["iceTransportPolicy"];
    }
    const auto &servers = input["iceServers"];
    if (!servers.isArray() || servers.size() > 8) fail();
    bool hasTurn = false;
    for (const auto &server : servers) {
        if (!server.isObject()) fail();
        Json::Value urls = server["urls"];
        if (urls.isString()) { urls = Json::Value(Json::arrayValue); urls.append(server["urls"]); }
        if (!urls.isArray() || urls.empty() || urls.size() > 8) fail();
        bool turn = false;
        for (const auto &url : urls) {
            if (!url.isString()) fail();
            const auto value = url.asString();
            if (value.size() > 2048 || value.find_first_of(" \r\n\t") != std::string::npos) fail();
            const auto colon = value.find(':');
            if (colon == std::string::npos || colon + 1 == value.size()) fail();
            const auto scheme = value.substr(0, colon);
            if (scheme != "stun" && scheme != "stuns" && scheme != "turn" && scheme != "turns") fail();
            turn |= scheme == "turn" || scheme == "turns";
        }
        Json::Value entry(Json::objectValue);
        entry["urls"] = urls;
        if (turn) {
            for (const auto *field : {"username", "credential"}) {
                if (!server[field].isString() || server[field].asString().empty() || server[field].asString().size() > 512) fail();
                entry[field] = server[field];
            }
        }
        hasTurn |= turn;
        result["iceServers"].append(entry);
    }
    if (result["iceTransportPolicy"] == "relay" && !hasTurn) fail();
    return result;
}

inline Json::Value loadRtcConfig(const std::string &path) {
    Json::Value config(Json::objectValue);
    config["iceServers"] = Json::Value(Json::arrayValue);
    if (!path.empty()) {
        std::ifstream input(path);
        if (!input) throw std::runtime_error("Cannot open RTC config");
        Json::CharReaderBuilder builder;
        std::string errors;
        if (!Json::parseFromStream(builder, input, &config, &errors)) throw std::runtime_error("Cannot parse RTC config JSON");
    }
    return validateRtcConfig(config);
}
