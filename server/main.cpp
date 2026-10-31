#include "simulation.hpp"
#include "auth.hpp"
#include "auth_http.hpp"
#include "rtc_config.hpp"
#include "local_rtc_relay.hpp"
#include <drogon/drogon.h>
#include <drogon/WebSocketController.h>
#include <rtc/rtc.hpp>
#include <chrono>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <filesystem>
#include <cstdlib>

namespace {
using Clock = std::chrono::steady_clock;
double now() { return std::chrono::duration<double>(Clock::now().time_since_epoch()).count(); }
std::string jsonText(const Json::Value &value) {
    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    return Json::writeString(writer, value);
}
bool parse(const std::string &text, Json::Value &value) {
    Json::CharReaderBuilder builder;
    std::string errors;
    auto reader = std::unique_ptr<Json::CharReader>(builder.newCharReader());
    return reader->parse(text.data(), text.data() + text.size(), &value, &errors) && value.isObject();
}
struct Session {
    int id = 0, generation = 0;
    Identity identity;
    drogon::WebSocketConnectionPtr socket;
    std::shared_ptr<rtc::PeerConnection> peer;
    std::shared_ptr<rtc::DataChannel> channel;
    std::vector<rtc::Candidate> pending;
    bool remoteDescription = false, closed = false;
    Vec3 position;
    Json::Int64 sequence = -1;
    double lastPosition = -100, echo = 0, signalWindow = 0;
    int signalCount = 0;
};

class Game {
public:
    Game(const std::string &navigation, AuthStore &auth_, const Json::Value &rtcConfig_) : simulation(navigation), auth(auth_), rtcConfig(rtcConfig_) {}

    void send(const std::shared_ptr<Session> &session, const Json::Value &message) {
        if (!session->closed && session->socket->connected()) session->socket->send(jsonText(message));
    }

    void opened(const drogon::WebSocketConnectionPtr &socket) {
        if (pending.size() >= 64) { socket->shutdown(drogon::CloseCode::kViolation, "Authentication busy"); return; }
        pending[socket.get()] = socket;
        std::weak_ptr<drogon::WebSocketConnection> weak = socket;
        drogon::app().getLoop()->runAfter(5.0, [this, weak] {
            if (auto current = weak.lock(); current && pending.erase(current.get())) reject(current);
        });
    }

    void reject(const drogon::WebSocketConnectionPtr &socket) {
        pending.erase(socket.get());
        Json::Value message; message["type"] = "auth_error"; message["error"] = "Войдите в аккаунт заново.";
        if (socket->connected()) socket->send(jsonText(message));
        leave(socket);
        socket->shutdown(drogon::CloseCode::kViolation, "Unauthorized");
    }

    void join(const drogon::WebSocketConnectionPtr &socket, const Identity &identity) {
        if (!socket->connected()) return;
        if (sessions.size() >= 8) { socket->shutdown(drogon::CloseCode::kViolation, "Room is full"); return; }
        auto session = std::make_shared<Session>();
        session->id = nextId++;
        session->identity = identity;
        session->socket = socket;
        socket->setContext(std::make_shared<int>(session->id));
        Json::Value welcome;
        welcome["type"] = "welcome";
        welcome["id"] = session->id;
        welcome["world_protocol"] = 1;
        welcome["voice_protocol"] = 1;
        welcome["rtc_config"] = rtcConfig;
        welcome["user_id"] = Json::Int64(identity.id);
        welcome["expires_at"] = Json::Int64(identity.expires);
        welcome["peers"] = Json::Value(Json::arrayValue);
        for (const auto &[id, other] : sessions) {
            welcome["peers"].append(id);
            Json::Value joined;
            joined["type"] = "joined";
            joined["id"] = session->id;
            send(other, joined);
        }
        sessions[session->id] = session;
        send(session, welcome);
        std::cout << "JOIN " << session->id << std::endl;
    }

    std::shared_ptr<Session> lookup(const drogon::WebSocketConnectionPtr &socket) {
        auto context = socket->getContext<int>();
        if (!context) return {};
        auto it = sessions.find(*context);
        return it == sessions.end() ? nullptr : it->second;
    }

    void stopPeer(const std::shared_ptr<Session> &session) {
        ++session->generation;
        if (session->channel) session->channel->close();
        if (session->peer) session->peer->close();
        session->channel.reset();
        session->peer.reset();
        session->remoteDescription = false;
        session->pending.clear();
        session->lastPosition = -100;
        session->sequence = -1;
    }

    void leave(const drogon::WebSocketConnectionPtr &socket) {
        pending.erase(socket.get());
        auto session = lookup(socket);
        if (!session) return;
        session->closed = true;
        stopPeer(session);
        sessions.erase(session->id);
        Json::Value left;
        left["type"] = "left";
        left["id"] = session->id;
        for (const auto &[id, other] : sessions) send(other, left);
        std::cout << "LEAVE " << session->id << std::endl;
    }

    void startPeer(const std::shared_ptr<Session> &session) {
        rtc::Configuration config;
        config.disableAutoNegotiation = true;
        for (const auto &entry : rtcConfig["iceServers"]) {
            auto urls = entry["urls"];
            if (urls.isString()) { urls = Json::Value(Json::arrayValue); urls.append(entry["urls"]); }
            for (const auto &url : urls) {
                rtc::IceServer server(url.asString());
                // The bundled libjuice supports TURN over UDP.
                if (server.type == rtc::IceServer::Type::Turn) {
                    if (server.relayType != rtc::IceServer::RelayType::TurnUdp) continue;
                    server.username = entry["username"].asString();
                    server.password = entry["credential"].asString();
                }
                config.iceServers.push_back(server);
            }
        }
        session->peer = std::make_shared<rtc::PeerConnection>(config);
        std::weak_ptr<Session> weak = session;
        const int generation = session->generation;
        auto signal = [this, weak, generation](Json::Value message) {
            drogon::app().getLoop()->queueInLoop([this, weak, generation, message = std::move(message)] {
                if (auto current = weak.lock(); current && !current->closed && current->generation == generation) send(current, message);
            });
        };
        session->peer->onLocalDescription([signal](rtc::Description description) {
            Json::Value message;
            message["type"] = "server_sdp";
            message["description"] = description.typeString();
            message["sdp"] = std::string(description);
            signal(message);
        });
        session->peer->onLocalCandidate([signal](rtc::Candidate candidate) {
            Json::Value message;
            message["type"] = "server_ice";
            message["media"] = candidate.mid();
            message["index"] = 0;
            message["candidate"] = std::string(candidate);
            signal(message);
        });
        rtc::DataChannelInit channelConfig;
        channelConfig.negotiated = true;
        channelConfig.id = 0;
        channelConfig.reliability.unordered = true;
        channelConfig.reliability.maxRetransmits = 0;
        session->channel = session->peer->createDataChannel("world-v1", channelConfig);
        session->channel->onMessage([this, weak, generation](rtc::message_variant incoming) {
            std::string text;
            if (auto string = std::get_if<std::string>(&incoming)) {
                if (string->size() > 512) return;
                text = *string;
            } else {
                const auto &bytes = std::get<rtc::binary>(incoming);
                if (bytes.size() > 512) return;
                text.assign(reinterpret_cast<const char *>(bytes.data()), bytes.size());
            }
            drogon::app().getLoop()->queueInLoop([this, weak, generation, text = std::move(text)] {
                if (auto current = weak.lock(); current && !current->closed && current->generation == generation) playerPosition(current, text);
            });
        });
    }

    void playerPosition(const std::shared_ptr<Session> &session, const std::string &text) {
        if (!auth.active(session->identity.digest)) { reject(session->socket); return; }
        Json::Value message;
        if (!parse(text, message) || message["type"] != "player" || !message["sequence"].isInt64()) return;
        const auto &p = message["position"];
        if (!p.isArray() || p.size() != 3) return;
        for (const auto &coordinate : p) if (!coordinate.isNumeric() || !std::isfinite(coordinate.asDouble())) return;
        const Vec3 position{p[0].asDouble(), p[1].asDouble(), p[2].asDouble()};
        const auto sequence = message["sequence"].asInt64();
        if (sequence <= session->sequence || position.length() < 20 || position.length() > 50) return;
        session->sequence = sequence;
        session->position = position;
        session->lastPosition = now();
        if (message["sent"].isNumeric()) session->echo = message["sent"].asDouble();
    }

    void message(const drogon::WebSocketConnectionPtr &socket, const std::string &text) {
        auto session = lookup(socket);
        if (!session) {
            if (!pending.count(socket.get())) return;
            Json::Value message;
            if (text.size() > 1024 || !parse(text, message) || message["type"] != "auth" || !message["token"].isString()) { reject(socket); return; }
            const auto identity = auth.authorize(message["token"].asString());
            if (!identity) { reject(socket); return; }
            pending.erase(socket.get());
            join(socket, *identity);
            return;
        }
        if (!auth.active(session->identity.digest)) { reject(socket); return; }
        if (text.size() > 65536) { socket->shutdown(); return; }
        if (now() - session->signalWindow > 1) { session->signalWindow = now(); session->signalCount = 0; }
        if (++session->signalCount > 150) { socket->shutdown(); return; }
        Json::Value message;
        if (!parse(text, message) || !message["type"].isString()) return;
        const auto type = message["type"].asString();
        try {
            if (type == "server_reset") { stopPeer(session); return; }
            if (type == "server_sdp") {
                if (message["description"] != "offer" || !message["sdp"].isString() || session->remoteDescription) return;
                if (!session->peer) startPeer(session);
                session->peer->setRemoteDescription(rtc::Description(message["sdp"].asString(), "offer"));
                session->peer->setLocalDescription(rtc::Description::Type::Answer);
                session->remoteDescription = true;
                for (const auto &candidate : session->pending) session->peer->addRemoteCandidate(candidate);
                session->pending.clear();
                return;
            }
            if (type == "server_ice") {
                if (!message["candidate"].isString() || !message["media"].isString()) return;
                rtc::Candidate candidate(message["candidate"].asString(), message["media"].asString());
                if (session->remoteDescription) session->peer->addRemoteCandidate(candidate);
                else if (session->pending.size() < 64) session->pending.push_back(candidate);
                return;
            }
            if (!message["to"].isInt()) return;
            const int target = message["to"].asInt();
            if (target == session->id || !sessions.count(target)) return;
            Json::Value relay;
            relay["type"] = type;
            relay["from"] = session->id;
            if (type == "sdp" && message["sdp"].isString() && (message["description"] == "offer" || message["description"] == "answer")) {
                relay["description"] = message["description"];
                relay["sdp"] = message["sdp"];
            } else if (type == "ice" && message["media"].isString() && message["candidate"].isString() && message["index"].isInt()) {
                relay["media"] = message["media"];
                relay["index"] = message["index"];
                relay["candidate"] = message["candidate"];
            } else return;
            send(sessions.at(target), relay);
        } catch (const std::exception &error) {
            LOG_WARN << "Invalid signaling from " << session->id << ": " << error.what();
        }
    }

    void tick() {
        std::vector<drogon::WebSocketConnectionPtr> expired;
        for (const auto &[id, session] : sessions) if (!auth.active(session->identity.digest)) expired.push_back(session->socket);
        for (const auto &socket : expired) reject(socket);
        std::vector<Vec3> players;
        for (const auto &[id, session] : sessions) if (now() - session->lastPosition < 3.0) players.push_back(session->position);
        simulation.step(0.05, players);
        if (++ticks % 2 != 0) return;
        auto snapshot = simulation.snapshot();
        for (const auto &[id, session] : sessions) {
            if (!session->channel || !session->channel->isOpen() || session->channel->bufferedAmount() > 16384) continue;
            snapshot["ack"] = session->sequence;
            snapshot["echo"] = session->echo;
            try { session->channel->send(jsonText(snapshot)); }
            catch (const std::exception &error) { LOG_WARN << "World send: " << error.what(); }
        }
    }

private:
    Simulation simulation;
    AuthStore &auth;
    Json::Value rtcConfig;
    std::map<const drogon::WebSocketConnection *, std::weak_ptr<drogon::WebSocketConnection>> pending;
    std::map<int, std::shared_ptr<Session>> sessions;
    int nextId = 2;
    unsigned ticks = 0;
};
std::unique_ptr<Game> game;
}

class Signaling : public drogon::WebSocketController<Signaling> {
public:
    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/signal", drogon::Get);
    WS_PATH_LIST_END
    void handleNewConnection(const drogon::HttpRequestPtr &, const drogon::WebSocketConnectionPtr &socket) override {
        drogon::app().getLoop()->queueInLoop([socket] { game->opened(socket); });
    }
    void handleConnectionClosed(const drogon::WebSocketConnectionPtr &socket) override {
        drogon::app().getLoop()->queueInLoop([socket] { game->leave(socket); });
    }
    void handleNewMessage(const drogon::WebSocketConnectionPtr &socket, std::string &&text, const drogon::WebSocketMessageType &type) override {
        if (type != drogon::WebSocketMessageType::Text) return;
        drogon::app().getLoop()->queueInLoop([socket, text = std::move(text)] { game->message(socket, text); });
    }
};

int main(int argc, char **argv) {
    int port = 3000;
    std::string navigation = "server/data/lakes.json";
    std::string webRoot = "public";
    std::string authPath = "runtime/auth.sqlite3";
    const auto *rtcConfigEnv = std::getenv("PLANET_RTC_CONFIG");
    std::string rtcConfigPath = rtcConfigEnv ? rtcConfigEnv : "";
    try {
        for (int i = 1; i < argc; ++i) {
            const std::string argument = argv[i];
            if (argument.rfind("--port=", 0) == 0) port = std::stoi(argument.substr(7));
            else if (argument.rfind("--nav=", 0) == 0) navigation = argument.substr(6);
            else if (argument.rfind("--web=", 0) == 0) webRoot = argument.substr(6);
            else if (argument.rfind("--auth-db=", 0) == 0) authPath = argument.substr(10);
            else if (argument.rfind("--rtc-config=", 0) == 0) rtcConfigPath = argument.substr(13);
            else throw std::runtime_error("Unknown argument: " + argument);
        }
        if (port < 1 || port > 65535) throw std::runtime_error("Invalid port");
        if (!std::filesystem::exists(std::filesystem::path(webRoot) / "index.html")) throw std::runtime_error("Missing public/index.html");
        rtc::InitLogger(rtc::LogLevel::Warning);
        const auto relativeDb = std::filesystem::weakly_canonical(authPath).lexically_relative(std::filesystem::weakly_canonical(webRoot));
        if (authPath != ":memory:" && !relativeDb.empty() && *relativeDb.begin() != "..") throw std::runtime_error("Auth database must be outside the public directory");
        AuthStore auth(authPath);
        installAuthRoutes(auth);
        if (!rtcConfigPath.empty()) {
            const auto relativeConfig = std::filesystem::weakly_canonical(rtcConfigPath).lexically_relative(std::filesystem::weakly_canonical(webRoot));
            if (!relativeConfig.empty() && *relativeConfig.begin() != "..") throw std::runtime_error("RTC config must be outside the public directory");
        }
        std::unique_ptr<LocalRtcRelay> localRelay;
        auto rtcConfig = loadRtcConfig(rtcConfigPath);
        if (rtcConfigPath.empty()) {
            localRelay = std::make_unique<LocalRtcRelay>();
            rtcConfig = localRelay->configuration();
        }
        game = std::make_unique<Game>(navigation, auth, rtcConfig);
        drogon::app().setLogLevel(trantor::Logger::kWarn).setThreadNum(1).setClientMaxWebSocketMessageSize(65536).addListener("127.0.0.1", port);
        drogon::app().setDocumentRoot(std::filesystem::absolute(webRoot).string()).setHomePage("index.html")
            .setFileTypes({"html", "js", "css", "json", "svg", "gz"}).setStaticFilesCacheTime(-1);
        drogon::app().getLoop()->runEvery(0.05, [] { game->tick(); });
        std::cout << "MICRO / PLANET http://127.0.0.1:" << port << " | C++ / Babylon.js / WebRTC" << std::endl;
        drogon::app().run();
        game.reset();
    } catch (const std::exception &error) { std::cerr << error.what() << '\n'; return 1; }
}
