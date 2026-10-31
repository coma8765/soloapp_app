#include "auth.hpp"
#include <filesystem>
#include <iostream>
#include <unistd.h>

namespace {
void check(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
}
int main() {
    const auto path = (std::filesystem::temp_directory_path() / ("planet-auth-" + std::to_string(getpid()) + ".sqlite3")).string();
    try {
        std::string token, secondToken;
        {
            AuthStore store(path);
            check(store.credentials("invalid", "password123", true).status == 400, "Invalid email accepted");
            check(store.credentials("test@example.com", "short", true).status == 400, "Short password accepted");
            auto result = store.credentials(" Test@Example.com ", "password123", true);
            check(result.status == 201, "Registration failed");
            token = result.body["token"].asString();
            const auto identity = store.authorize(token);
            check(identity && identity->email == "test@example.com", "Token identity mismatch");
            check(identity->digest != token && store.active(identity->digest), "Token was not hashed");
            check(store.credentials("test@example.com", "password123", true).status == 409, "Duplicate accepted");
            check(store.credentials("test@example.com", "incorrect123", false).status == 401, "Wrong password accepted");
            check(store.credentials("absent@example.com", "password123", false).status == 401, "Unknown account accepted");
            result = store.credentials("TEST@example.com", "password123", false);
            check(result.status == 200, "Login failed");
            secondToken = result.body["token"].asString();
            check(secondToken != token && store.authorize(secondToken)->id == identity->id, "Login did not issue a fresh account token");
            check(!store.authorize(std::string(64, '0')) && !store.authorize("invalid"), "Forged token accepted");
            sqlite3 *db = nullptr;
            check(sqlite3_open(path.c_str(), &db) == SQLITE_OK, "Cannot inspect database");
            sqlite3_stmt *query = nullptr;
            sqlite3_prepare_v2(db, "SELECT password_hash,salt FROM users", -1, &query, nullptr);
            check(sqlite3_step(query) == SQLITE_ROW, "Missing password hash");
            const std::string hash = reinterpret_cast<const char *>(sqlite3_column_text(query, 0));
            check(hash.size() == 64 && hash != "password123" && sqlite3_column_bytes(query, 1) == 32, "Plain password or invalid salt stored");
            sqlite3_finalize(query); sqlite3_close(db);
        }
        {
            AuthStore store(path);
            check(store.authorize(token).has_value(), "Token did not survive restart");
            store.revoke(token);
            check(!store.authorize(token), "Revoked token accepted");
            check(store.authorize(secondToken).has_value(), "Logout revoked another session");
        }
        {
            AuthStore expired(":memory:", 0);
            const auto result = expired.credentials("expired@example.com", "password123", true);
            check(!expired.authorize(result.body["token"].asString()), "Expired token accepted");
        }
        std::filesystem::remove(path);
        std::cout << "PASS: credentials, hashed storage, persistence, independent tokens, revocation and expiry\n";
    } catch (const std::exception &error) {
        std::filesystem::remove(path);
        std::cerr << error.what() << '\n'; return 1;
    }
}
