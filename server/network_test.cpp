#include <drogon/WebSocketClient.h>
#include <drogon/HttpClient.h>
#include <rtc/rtc.hpp>
#include <trantor/net/EventLoopThread.h>
#include <arpa/inet.h>
#include <sys/wait.h>
#include <unistd.h>
#include <csignal>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <map>
#include <mutex>
#include <thread>

using namespace std::chrono_literals;

std::string encode(const Json::Value &value) {
    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    return Json::writeString(writer, value);
}
Json::Value decode(const std::string &text) {
    Json::Value value;
    Json::CharReaderBuilder builder;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    std::string errors;
    if (!reader->parse(text.data(), text.data() + text.size(), &value, &errors)) throw std::runtime_error(errors);
    return value;
}
void check(bool value, const char *message) {
    if (!value) throw std::runtime_error(message);
}

struct Process {
    pid_t pid;
    ~Process() { if (pid > 0) { kill(pid, SIGTERM); waitpid(pid, nullptr, 0); } }
};
int freePort() {
    const int fd = socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    check(bind(fd, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0, "Cannot allocate test port");
    socklen_t size = sizeof(address);
    getsockname(fd, reinterpret_cast<sockaddr *>(&address), &size);
    const int port = ntohs(address.sin_port);
    close(fd);
    return port;
}

struct Client {
    drogon::WebSocketClientPtr ws;
    std::shared_ptr<rtc::PeerConnection> pc;
    std::shared_ptr<rtc::DataChannel> channel;
    std::mutex mutex;
    std::condition_variable changed;
    std::map<int, Json::Value> snapshots;
    Json::Value welcome;
    std::vector<int> left;
    std::vector<rtc::Candidate> pending;
    bool remoteDescription = false;
    bool closed = false;
    bool authError = false;
    std::string error;

    Client(const std::string &url, trantor::EventLoop *loop, const std::string &token, bool premature = false) {
        ws = drogon::WebSocketClient::newWebSocketClient(url, loop);
        ws->setConnectionClosedHandler([this](const auto &) {
            std::lock_guard lock(mutex); closed = true; changed.notify_all();
        });
        ws->setMessageHandler([this](std::string &&text, const auto &, const auto &kind) {
            if (kind != drogon::WebSocketMessageType::Text) return;
            try {
                const auto message = decode(text);
                const auto type = message["type"].asString();
                if (type == "welcome") { std::lock_guard lock(mutex); welcome = message; changed.notify_all(); }
                if (type == "auth_error") { std::lock_guard lock(mutex); authError = true; changed.notify_all(); }
                if (type == "left") { std::lock_guard lock(mutex); left.push_back(message["id"].asInt()); changed.notify_all(); }
                if (type == "server_sdp") {
                    pc->setRemoteDescription(rtc::Description(message["sdp"].asString(), "answer"));
                    remoteDescription = true;
                    for (const auto &candidate : pending) pc->addRemoteCandidate(candidate);
                    pending.clear();
                }
                if (type == "server_ice") {
                    rtc::Candidate candidate(message["candidate"].asString(), message["media"].asString());
                    if (remoteDescription) pc->addRemoteCandidate(candidate); else pending.push_back(candidate);
                }
            } catch (const std::exception &exception) {
                std::lock_guard lock(mutex); error = exception.what(); changed.notify_all();
            }
        });
        auto request = drogon::HttpRequest::newHttpRequest();
        request->setPath("/signal");
        ws->connectToServer(request, [this, token, premature](auto result, const auto &, const auto &) {
            if (result != drogon::ReqResult::Ok) return;
            Json::Value message;
            message["type"] = premature ? "server_sdp" : "auth";
            message["token"] = token;
            send(message);
        });
    }
    ~Client() { stop(); }
    void stop() {
        if (channel) { channel->resetCallbacks(); channel->close(); }
        if (pc) { pc->resetCallbacks(); pc->close(); }
        if (ws) {
            ws->setMessageHandler([](std::string &&, const auto &, const auto &) {});
            ws->setConnectionClosedHandler([](const auto &) {});
            ws->stop();
        }
    }
    template<typename Predicate> void wait(Predicate predicate, const char *message) {
        std::unique_lock lock(mutex);
        check(changed.wait_for(lock, 10s, [&] { return predicate() || !error.empty(); }), message);
        if (!error.empty()) throw std::runtime_error(error);
    }
    void send(Json::Value message) { ws->getConnection()->send(encode(message)); }
    void startWorld() {
        Json::Value reset; reset["type"] = "server_reset"; send(reset);
        rtc::Configuration config; config.disableAutoNegotiation = true;
        pc = std::make_shared<rtc::PeerConnection>(config);
        pc->onLocalDescription([this](rtc::Description description) {
            Json::Value message;
            message["type"] = "server_sdp"; message["description"] = description.typeString();
            message["sdp"] = std::string(description); send(message);
        });
        pc->onLocalCandidate([this](rtc::Candidate candidate) {
            Json::Value message;
            message["type"] = "server_ice"; message["media"] = candidate.mid();
            message["index"] = 0; message["candidate"] = std::string(candidate); send(message);
        });
        rtc::DataChannelInit options;
        options.negotiated = true; options.id = 0;
        options.reliability.unordered = true; options.reliability.maxRetransmits = 0;
        channel = pc->createDataChannel("world-v1", options);
        channel->onMessage([this](rtc::message_variant incoming) {
            if (auto text = std::get_if<std::string>(&incoming)) {
                try {
                    auto message = decode(*text);
                    std::lock_guard lock(mutex);
                    snapshots[message["sequence"].asInt()] = message;
                    changed.notify_all();
                } catch (const std::exception &exception) {
                    std::lock_guard lock(mutex); error = exception.what(); changed.notify_all();
                }
            }
        });
        pc->setLocalDescription(rtc::Description::Type::Offer);
    }
};

int main(int argc, char **argv) {
    if (argc != 4) return 1;
    const auto port = std::to_string(freePort());
    Process process{fork()};
    if (process.pid == 0) {
        execl(argv[1], argv[1], ("--port=" + port).c_str(), (std::string("--nav=") + argv[2]).c_str(),
              (std::string("--web=") + argv[3]).c_str(), "--auth-db=:memory:", nullptr);
        _exit(127);
    }
    try {
        rtc::InitLogger(rtc::LogLevel::Error);
        trantor::EventLoopThread thread; thread.run();
        const auto url = "ws://127.0.0.1:" + port;
        const auto http = drogon::HttpClient::newHttpClient("http://127.0.0.1:" + port, thread.getLoop());
        auto request = [&](const std::string &path, drogon::HttpMethod method, const Json::Value &body, const std::string &token = "") {
            auto req = drogon::HttpRequest::newHttpJsonRequest(body);
            req->setPath(path); req->setMethod(method);
            if (!token.empty()) req->addHeader("Authorization", "Bearer " + token);
            const auto result = http->sendRequest(req, 5.0);
            check(result.first == drogon::ReqResult::Ok, "HTTP request failed");
            return result.second;
        };
        bool ready = false;
        for (int i = 0; i < 100 && !ready; ++i) {
            auto req = drogon::HttpRequest::newHttpRequest(); req->setPath("/");
            ready = http->sendRequest(req, .2).first == drogon::ReqResult::Ok;
            if (!ready) std::this_thread::sleep_for(50ms);
        }
        check(ready, "Server did not start");
        Json::Value credentials; credentials["email"] = "test@example.com"; credentials["password"] = "password123";
        auto result = request("/api/auth/register", drogon::Post, credentials);
        check(result->statusCode() == 201, "Registration endpoint failed");
        const auto token = (*result->getJsonObject())["token"].asString();
        check(request("/api/auth/register", drogon::Post, credentials)->statusCode() == 409, "Duplicate registration accepted");
        check(request("/api/auth/me", drogon::Get, {})->statusCode() == 401, "Account endpoint allowed no token");
        check(request("/api/auth/me", drogon::Get, {}, token)->statusCode() == 200, "Bearer token rejected");
        credentials["password"] = "incorrect123";
        check(request("/api/auth/login", drogon::Post, credentials)->statusCode() == 401, "Wrong password accepted via HTTP");
        credentials["password"] = "password123";
        result = request("/api/auth/login", drogon::Post, credentials);
        check(result->statusCode() == 200, "Login endpoint failed");
        const auto secondToken = (*result->getJsonObject())["token"].asString();
        Client forged(url, thread.getLoop(), std::string(64, '0'));
        forged.wait([&] { return forged.closed; }, "Forged token was not disconnected");
        check(forged.authError && forged.welcome.isNull(), "Forged token entered room"); forged.stop();
        Client premature(url, thread.getLoop(), token, true);
        premature.wait([&] { return premature.closed; }, "Unauthenticated SDP was not disconnected");
        check(premature.authError && premature.welcome.isNull(), "SDP bypassed authentication"); premature.stop();
        Client first(url, thread.getLoop(), token);
        first.wait([&] { return first.welcome.isObject(); }, "First client did not join");
        check(first.welcome["voice_protocol"] == 1 && first.welcome["rtc_config"]["iceServers"].isArray(), "Missing authenticated voice configuration");
        const auto &rtcConfig = first.welcome["rtc_config"];
        check(rtcConfig["iceTransportPolicy"] == "relay" && rtcConfig["iceServers"].size() == 1, "Local voice must use TURN");
        const auto &relay = rtcConfig["iceServers"][0];
        check(relay["urls"].asString().rfind("turn:127.0.0.1:", 0) == 0 &&
              !relay["username"].asString().empty() && relay["credential"].asString().size() == 64,
              "Missing local TURN address or generated credentials");
        Client second(url, thread.getLoop(), secondToken);
        second.wait([&] { return second.welcome.isObject(); }, "Second client did not join");
        check(second.welcome["peers"].size() == 1, "Late join did not list existing player");
        first.startWorld(); second.startWorld();
        first.wait([&] { return first.snapshots.size() > 3; }, "No first WebRTC snapshots");
        second.wait([&] { return second.snapshots.size() > 3; }, "No second WebRTC snapshots");
        Json::Value player;
        player["type"] = "player"; player["sequence"] = 12; player["sent"] = 123.0;
        player["position"] = Json::Value(Json::arrayValue);
        for (double v : {0.0, 35.0, -10.0}) player["position"].append(v);
        first.channel->send(encode(player));
        first.wait([&] { return first.snapshots.rbegin()->second["ack"].asInt() == 12; }, "Position was not acknowledged");
        {
            std::scoped_lock lock(first.mutex, second.mutex);
            int matches = 0;
            for (const auto &[tick, a] : first.snapshots) {
                if (!second.snapshots.count(tick)) continue;
                const auto &b = second.snapshots.at(tick);
                check(a["fish"].size() == 48 && a["fish"] == b["fish"], "Clients received different fish for the same tick");
                ++matches;
            }
            check(matches > 0, "No shared authoritative tick");
        }
        check(request("/api/auth/logout", drogon::Post, {}, secondToken)->statusCode() == 200, "Logout failed");
        second.wait([&] { return second.closed; }, "Revoked WebSocket remained connected");
        check(second.authError, "Revoked session did not receive auth_error");
        for (int i = 0; i < 100 && second.channel->isOpen(); ++i) std::this_thread::sleep_for(20ms);
        check(!second.channel->isOpen(), "Revoked WebRTC remained connected");
        check(request("/api/auth/me", drogon::Get, {}, secondToken)->statusCode() == 401, "Revoked bearer token accepted");
        second.stop();
        first.wait([&] { return !first.left.empty(); }, "Disconnect did not remove player");
        Client revoked(url, thread.getLoop(), secondToken);
        revoked.wait([&] { return revoked.closed; }, "Revoked token reconnected");
        check(revoked.welcome.isNull(), "Revoked token received welcome"); revoked.stop();
        Client replacement(url, thread.getLoop(), token);
        replacement.wait([&] { return replacement.welcome.isObject(); }, "Reconnect failed");
        check(replacement.welcome["id"] != second.welcome["id"], "Reconnect reused stale ID");
        std::vector<std::unique_ptr<Client>> extra;
        for (int i = 0; i < 6; ++i) {
            auto client = std::make_unique<Client>(url, thread.getLoop(), token);
            client->wait([&] { return client->welcome.isObject(); }, "Room did not accept player within limit");
            extra.push_back(std::move(client));
        }
        Client ninth(url, thread.getLoop(), token);
        ninth.wait([&] { return ninth.closed; }, "Room accepted a ninth player");
        check(ninth.welcome.isNull(), "Ninth player received welcome");
        std::cout << "PASS: HTTP registration/login, bearer authentication, unauthorized SDP rejection, WebRTC snapshots, logout revocation, reconnect and 8-player limit\n";
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
