#include "lobby.hpp"
#include <algorithm>
#include <chrono>
#include <stdexcept>

namespace {
void exec(sqlite3 *db, const char *sql) {
    if (sqlite3_exec(db, sql, nullptr, nullptr, nullptr) != SQLITE_OK) throw std::runtime_error("Lobby database error");
}
struct Query {
    sqlite3_stmt *value = nullptr;
    Query(sqlite3 *db, const char *sql) {
        if (sqlite3_prepare_v2(db, sql, -1, &value, nullptr) != SQLITE_OK) throw std::runtime_error("Lobby query error");
    }
    ~Query() { sqlite3_finalize(value); }
    void number(int index, long long n) { sqlite3_bind_int64(value, index, n); }
    void text(int index, const std::string &s) { sqlite3_bind_text(value, index, s.data(), static_cast<int>(s.size()), SQLITE_TRANSIENT); }
    bool next() {
        const int result = sqlite3_step(value);
        if (result != SQLITE_ROW && result != SQLITE_DONE) throw std::runtime_error("Lobby query failed");
        return result == SQLITE_ROW;
    }
    long long number(int index) { return sqlite3_column_int64(value, index); }
    std::string text(int index) { const auto *s = sqlite3_column_text(value, index); return s ? reinterpret_cast<const char *>(s) : ""; }
};
struct Transaction {
    sqlite3 *db;
    bool done = false;
    explicit Transaction(sqlite3 *db_) : db(db_) { exec(db, "BEGIN IMMEDIATE"); }
    ~Transaction() { if (!done) sqlite3_exec(db, "ROLLBACK", nullptr, nullptr, nullptr); }
    void commit() { exec(db, "COMMIT"); done = true; }
};
AuthResult fail(int code, const char *message) { Json::Value result; result["error"] = message; return {code, result}; }
std::string label(const Identity &user) { return user.email.substr(0, user.email.find('@')); }
}

LobbyStore::LobbyStore(const std::string &path, std::function<long long()> clock_) : clock(std::move(clock_)) {
    if (!clock) clock = [] { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count(); };
    if (sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nullptr) != SQLITE_OK)
        throw std::runtime_error("Cannot open lobby database");
    sqlite3_busy_timeout(db, 3000);
    exec(db, "PRAGMA foreign_keys=ON;"
        "CREATE TABLE IF NOT EXISTS game_servers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owner_id INTEGER NOT NULL, owner_name TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'waiting');"
        "CREATE TABLE IF NOT EXISTS game_members(user_id INTEGER PRIMARY KEY, server_id INTEGER NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE, name TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0);"
        "CREATE INDEX IF NOT EXISTS game_members_server ON game_members(server_id);"
        "UPDATE game_servers SET state='waiting'; UPDATE game_members SET ready=0;");
    // Upgrade existing account/lobby databases without dropping rooms or members.
    bool deadline = false, slot = false;
    { Query columns(db, "PRAGMA table_info(game_servers)"); while (columns.next()) deadline |= columns.text(1) == "starts_at_ms"; }
    { Query columns(db, "PRAGMA table_info(game_members)"); while (columns.next()) slot |= columns.text(1) == "spawn_slot"; }
    if (!deadline) exec(db, "ALTER TABLE game_servers ADD COLUMN starts_at_ms INTEGER NOT NULL DEFAULT 0");
    if (!slot) {
        exec(db, "ALTER TABLE game_members ADD COLUMN spawn_slot INTEGER NOT NULL DEFAULT 0;"
            "UPDATE game_members SET spawn_slot=(SELECT COUNT(*) FROM game_members other WHERE other.server_id=game_members.server_id AND other.user_id<game_members.user_id)");
    }
    exec(db, "UPDATE game_servers SET starts_at_ms=0");
}
LobbyStore::~LobbyStore() { sqlite3_close(db); }

Json::Value LobbyStore::room(long long id) {
    Query q(db, "SELECT id,name,owner_id,owner_name,state,starts_at_ms FROM game_servers WHERE id=?"); q.number(1, id);
    if (!q.next()) return {};
    Json::Value result;
    result["id"] = Json::Int64(q.number(0)); result["name"] = q.text(1);
    result["owner"]["id"] = Json::Int64(q.number(2)); result["owner"]["name"] = q.text(3);
    result["state"] = q.text(4); result["capacity"] = 8;
    result["map"] = "white-room"; result["starts_at_ms"] = Json::Int64(q.number(5));
    result["members"] = Json::Value(Json::arrayValue);
    Query members(db, "SELECT user_id,name,ready,spawn_slot FROM game_members WHERE server_id=? ORDER BY user_id"); members.number(1, id);
    while (members.next()) {
        Json::Value member; member["id"] = Json::Int64(members.number(0)); member["name"] = members.text(1);
        member["ready"] = members.number(2) != 0; member["spawn_slot"] = static_cast<int>(members.number(3)); result["members"].append(member);
    }
    result["member_count"] = result["members"].size();
    return result;
}
AuthResult LobbyStore::list(const Identity &user) {
    std::lock_guard lock(mutex);
    finishCountdowns();
    Json::Value result; result["user_id"] = Json::Int64(user.id);
    result["server_time_ms"] = Json::Int64(clock());
    result["servers"] = Json::Value(Json::arrayValue); result["current"] = Json::Value();
    Query q(db, "SELECT id FROM game_servers ORDER BY id DESC");
    while (q.next()) {
        auto entry = room(q.number(0));
        for (const auto &member : entry["members"]) if (member["id"].asInt64() == user.id) result["current"] = entry;
        entry.removeMember("members"); result["servers"].append(entry);
    }
    return {200, result};
}
AuthResult LobbyStore::get(long long id) {
    std::lock_guard lock(mutex); finishCountdowns(); auto result = room(id);
    if (result.isNull()) return fail(404, "Сервер закрыт или не существует.");
    Json::Value body; body["server"] = result; body["server_time_ms"] = Json::Int64(clock()); return {200, body};
}
void LobbyStore::advance(long long id) {
    Query q(db, "UPDATE game_servers SET state='countdown', starts_at_ms=? WHERE id=? AND state='loading' AND NOT EXISTS (SELECT 1 FROM game_members WHERE server_id=? AND ready=0)");
    q.number(1, clock() + 3000); q.number(2, id); q.number(3, id); q.next();
}
void LobbyStore::finishCountdowns() {
    Query q(db, "UPDATE game_servers SET state='running' WHERE state='countdown' AND starts_at_ms<=?");
    q.number(1, clock()); q.next();
}
int LobbyStore::freeSlot(long long id) {
    bool used[8] = {};
    Query q(db, "SELECT spawn_slot FROM game_members WHERE server_id=?"); q.number(1, id);
    while (q.next()) if (q.number(0) >= 0 && q.number(0) < 8) used[q.number(0)] = true;
    for (int i = 0; i < 8; ++i) if (!used[i]) return i;
    throw std::runtime_error("No spawn slot available");
}
AuthResult LobbyStore::act(const Identity &user, const std::string &action, long long id, std::string name) {
    std::lock_guard lock(mutex); Transaction transaction(db);
    finishCountdowns();
    Query membership(db, "SELECT server_id FROM game_members WHERE user_id=?"); membership.number(1, user.id);
    const long long current = membership.next() ? membership.number(0) : 0;
    if (action == "create") {
        if (current) return fail(409, "Сначала покиньте текущий сервер.");
        Query count(db, "SELECT COUNT(*) FROM game_servers"); count.next();
        if (count.number(0) >= 64) return fail(409, "Достигнут лимит серверов.");
        if (name.empty()) name = "Мир " + label(user);
        if (name.size() > 160 || std::any_of(name.begin(), name.end(), [](unsigned char c) { return c < 32 || c == 127; }))
            return fail(400, "Название должно содержать от 1 до 160 байт без управляющих символов.");
        Query create(db, "INSERT INTO game_servers(name,owner_id,owner_name) VALUES(?,?,?)");
        create.text(1, name); create.number(2, user.id); create.text(3, label(user)); create.next();
        id = sqlite3_last_insert_rowid(db);
        Query add(db, "INSERT INTO game_members(user_id,server_id,name) VALUES(?,?,?)");
        add.number(1, user.id); add.number(2, id); add.text(3, label(user)); add.next();
    } else {
        auto server = room(id);
        if (server.isNull()) return fail(404, "Сервер закрыт или не существует.");
        const bool owner = server["owner"]["id"].asInt64() == user.id;
        if (action == "join") {
            if (current && current != id) return fail(409, "Сначала покиньте текущий сервер.");
            if (!current) {
                if (server["state"] != "waiting") return fail(409, "Мир уже запускается. Вступление закрыто.");
                if (server["member_count"].asInt() >= 8) return fail(409, "Сервер заполнен.");
                const int slot = freeSlot(id);
                Query add(db, "INSERT INTO game_members(user_id,server_id,name,spawn_slot) VALUES(?,?,?,?)");
                add.number(1, user.id); add.number(2, id); add.text(3, label(user)); add.number(4, slot); add.next();
            }
        } else if (action == "leave" || action == "delete") {
            if (action == "delete" && !owner) return fail(403, "Закрыть сервер может только владелец.");
            if (current != id) return fail(403, "Вы не участник этого сервера.");
            if (owner) {
                Query remove(db, "DELETE FROM game_servers WHERE id=?"); remove.number(1, id); remove.next();
            } else {
                Query remove(db, "DELETE FROM game_members WHERE user_id=? AND server_id=?");
                remove.number(1, user.id); remove.number(2, id); remove.next(); advance(id);
            }
            transaction.commit(); Json::Value result; result["server"] = Json::Value(); result["server_time_ms"] = Json::Int64(clock()); return {200, result};
        } else if (action == "start") {
            if (!owner) return fail(403, "Запустить мир может только владелец.");
            if (server["state"] == "waiting") {
                Query start(db, "UPDATE game_servers SET state='loading' WHERE id=?"); start.number(1, id); start.next();
            }
        } else if (action == "ready") {
            if (current != id) return fail(403, "Вы не участник этого сервера.");
            if (server["state"] == "waiting") return fail(409, "Ожидайте запуска мира владельцем.");
            Query ready(db, "UPDATE game_members SET ready=1 WHERE user_id=? AND server_id=?");
            ready.number(1, user.id); ready.number(2, id); ready.next(); advance(id);
        } else return fail(400, "Неизвестное действие.");
    }
    auto result = room(id); transaction.commit();
    Json::Value body; body["server"] = result; body["server_time_ms"] = Json::Int64(clock()); return {action == "create" ? 201 : 200, body};
}
bool LobbyStore::canConnect(long long user, long long server) {
    std::lock_guard lock(mutex);
    finishCountdowns();
    Query q(db, "SELECT 1 FROM game_members m JOIN game_servers s ON s.id=m.server_id WHERE m.user_id=? AND s.id=? AND s.state='running' AND m.ready=1");
    q.number(1, user); q.number(2, server); return q.next();
}
std::vector<long long> LobbyStore::running() {
    std::lock_guard lock(mutex); std::vector<long long> result;
    finishCountdowns();
    Query q(db, "SELECT id FROM game_servers WHERE state='running'");
    while (q.next()) result.push_back(q.number(0)); return result;
}
