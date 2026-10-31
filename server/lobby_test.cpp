#include "lobby.hpp"
#include <atomic>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <unistd.h>

namespace {
void check(bool condition, const char *message) { if (!condition) throw std::runtime_error(message); }
Identity user(long long id) { return Identity{id, 0, "player" + std::to_string(id) + "@example.com", ""}; }
}
int main() {
    const auto path = (std::filesystem::temp_directory_path() / ("planet-lobby-" + std::to_string(getpid()) + ".sqlite3")).string();
    try {
        long long saved = 0;
        long long now = 100000;
        {
            LobbyStore store(path, [&] { return now; });
            auto created = store.act(user(1), "create", 0, "Test planet");
            check(created.status == 201, "Create failed");
            const auto id = created.body["server"]["id"].asInt64();
            check(created.body["server"]["owner"]["id"] == 1, "Creator is not owner");
            check(store.act(user(1), "create", 0).status == 409, "Duplicate membership accepted");
            check(store.act(user(2), "start", id).status == 403, "Non-owner started world");
            check(store.act(user(2), "ready", id).status == 403, "Non-member reported ready");
            check(store.act(user(1), "ready", id).status == 409, "Ready before start accepted");
            for (int i = 2; i <= 8; ++i) check(store.act(user(i), "join", id).status == 200, "Join failed");
            check(store.act(user(9), "join", id).status == 409, "Ninth member accepted");
            check(store.act(user(1), "start", id).body["server"]["state"] == "loading", "Start did not enter loading");
            for (int i = 1; i < 8; ++i) {
                check(store.act(user(i), "ready", id).body["server"]["state"] == "loading", "World started before everyone was ready");
                check(!store.canConnect(i, id), "Signal allowed during loading");
            }
            const auto countdown = store.act(user(8), "ready", id).body["server"];
            check(countdown["state"] == "countdown" && countdown["starts_at_ms"].asInt64() == now + 3000, "Readiness did not schedule a three-second countdown");
            check(countdown["map"] == "white-room", "Wrong destination map");
            for (int i = 0; i < 8; ++i) check(countdown["members"][i]["spawn_slot"] == i, "Spawn slots are not unique");
            now += 2999;
            check(!store.canConnect(1, id) && store.running().empty(), "Countdown allowed early signaling");
            check(store.act(user(1), "start", id).body["server"]["starts_at_ms"] == countdown["starts_at_ms"], "Repeated start reset deadline");
            check(store.act(user(8), "ready", id).body["server"]["starts_at_ms"] == countdown["starts_at_ms"], "Repeated ready reset deadline");
            ++now;
            check(store.get(id).body["server"]["state"] == "running", "Countdown did not finish at deadline");
            check(store.canConnect(1, id) && !store.canConnect(9, id), "Membership access failed");
            check(store.act(user(2), "delete", id).status == 403, "Member closed server");
            check(store.act(user(2), "leave", id).status == 200 && !store.canConnect(2, id), "Leave did not revoke access");
            check(store.act(user(9), "join", id).status == 409, "Late join accepted after start");
            check(store.act(user(1), "delete", id).status == 200 && store.get(id).status == 404, "Owner closure failed");
            check(store.running().empty(), "Closed world remained running");
            created = store.act(user(1), "create", 0, "Persistent planet"); saved = created.body["server"]["id"].asInt64();
            check(saved > id, "Server ID reused");
            store.act(user(2), "join", saved); store.act(user(1), "start", saved); store.act(user(1), "ready", saved); store.act(user(2), "ready", saved);
        }
        {
            LobbyStore store(path, [&] { return now; });
            const auto result = store.list(user(2)).body["current"];
            check(result["id"].asInt64() == saved && result["owner"]["id"] == 1 && result["member_count"].asInt() == 2, "Server/membership did not persist");
            check(result["state"] == "waiting" && !result["members"][0]["ready"].asBool(), "Restart did not reset world readiness");
            store.act(user(1), "start", saved); store.act(user(1), "ready", saved); store.act(user(2), "leave", saved);
            check(store.get(saved).body["server"]["state"] == "countdown", "Departed member did not release readiness barrier");
            now += 3000;
            check(store.canConnect(1, saved), "Departed member blocked loading forever");
            store.act(user(1), "leave", saved);
            check(store.get(saved).status == 404, "Owner leave did not close server");
        }
        {
            LobbyStore store(":memory:", [&] { return now; });
            auto id = store.act(user(1), "create", 0).body["server"]["id"].asInt64();
            store.act(user(2), "join", id); store.act(user(3), "join", id); store.act(user(2), "leave", id);
            const auto members = store.act(user(4), "join", id).body["server"]["members"];
            check(members[1]["spawn_slot"] == 2 && members[2]["spawn_slot"] == 1, "Leaving reassigned existing spawn slots");
            store.act(user(1), "start", id);
            for (int i : {1, 3, 4}) store.act(user(i), "ready", id);
            store.act(user(1), "delete", id); now += 3000;
            check(store.running().empty() && !store.canConnect(3, id), "Deleted countdown resurrected room");
        }
        {
            LobbyStore store(":memory:");
            const auto id = store.act(user(1), "create", 0).body["server"]["id"].asInt64();
            for (int i = 2; i < 8; ++i) store.act(user(i), "join", id);
            std::atomic<int> accepted{0}; std::vector<std::thread> threads;
            for (int i = 20; i < 30; ++i) threads.emplace_back([&, i] { if (store.act(user(i), "join", id).status == 200) ++accepted; });
            for (auto &thread : threads) thread.join();
            check(accepted == 1 && store.get(id).body["server"]["member_count"].asInt() == 8, "Concurrent joins exceeded capacity");
        }
        std::filesystem::remove(path);
        {
            sqlite3 *legacy = nullptr;
            check(sqlite3_open(path.c_str(), &legacy) == SQLITE_OK, "Cannot create legacy database");
            const int result = sqlite3_exec(legacy,
                "CREATE TABLE game_servers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,owner_id INTEGER NOT NULL,owner_name TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'waiting');"
                "CREATE TABLE game_members(user_id INTEGER PRIMARY KEY,server_id INTEGER NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,name TEXT NOT NULL,ready INTEGER NOT NULL DEFAULT 0);"
                "INSERT INTO game_servers VALUES(7,'Old room',1,'owner','running');"
                "INSERT INTO game_members VALUES(1,7,'owner',1),(2,7,'guest',1);", nullptr, nullptr, nullptr);
            sqlite3_close(legacy); check(result == SQLITE_OK, "Cannot populate legacy database");
            LobbyStore migrated(path, [&] { return now; });
            const auto room = migrated.get(7).body["server"];
            check(room["name"] == "Old room" && room["state"] == "waiting" && room["starts_at_ms"] == 0, "Migration lost room or retained old running state");
            check(room["members"].size() == 2 && room["members"][0]["spawn_slot"] == 0 && room["members"][1]["spawn_slot"] == 1, "Migration lost members or duplicated spawns");
        }
        std::filesystem::remove(path);
        std::cout << "PASS: ownership, membership, capacity, loading barrier, closure, persistence and concurrent join\n";
    } catch (const std::exception &error) { std::filesystem::remove(path); std::cerr << error.what() << '\n'; return 1; }
}
