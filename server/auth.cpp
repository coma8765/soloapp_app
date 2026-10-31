#include "auth.hpp"
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <filesystem>
#include <stdexcept>
#include <vector>

namespace {
long long timestamp() {
    return std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}
std::string hex(const unsigned char *bytes, size_t size) {
    const char *digits = "0123456789abcdef";
    std::string result;
    for (size_t i = 0; i < size; ++i) { result += digits[bytes[i] >> 4]; result += digits[bytes[i] & 15]; }
    return result;
}
std::string randomHex(int count) {
    std::vector<unsigned char> bytes(count);
    if (RAND_bytes(bytes.data(), count) != 1) throw std::runtime_error("Secure randomness unavailable");
    return hex(bytes.data(), bytes.size());
}
std::string passwordHash(const std::string &password, const std::string &salt) {
    std::array<unsigned char, 32> bytes{};
    if (EVP_PBE_scrypt(password.data(), password.size(),
        reinterpret_cast<const unsigned char *>(salt.data()), salt.size(),
        32768, 8, 3, 64 * 1024 * 1024, bytes.data(), bytes.size()) != 1)
        throw std::runtime_error("Password hashing failed");
    return hex(bytes.data(), bytes.size());
}
struct Statement {
    sqlite3_stmt *value = nullptr;
    Statement(sqlite3 *db, const char *sql) {
        if (sqlite3_prepare_v2(db, sql, -1, &value, nullptr) != SQLITE_OK) throw std::runtime_error("Auth database prepare failed");
    }
    ~Statement() { sqlite3_finalize(value); }
    void text(int index, const std::string &value_) {
        if (sqlite3_bind_text(value, index, value_.data(), static_cast<int>(value_.size()), SQLITE_TRANSIENT) != SQLITE_OK)
            throw std::runtime_error("Auth database bind failed");
    }
    std::string text(int index) { const auto *s = sqlite3_column_text(value, index); return s ? reinterpret_cast<const char *>(s) : ""; }
    int step() { return sqlite3_step(value); }
};
AuthResult error(int status, const char *message) { Json::Value body; body["error"] = message; return {status, body}; }
bool validEmail(const std::string &email) {
    if (email.empty() || email.size() > 254) return false;
    const auto at = email.find('@');
    if (at == std::string::npos || at == 0 || at > 64 || email.find('@', at + 1) != std::string::npos) return false;
    const auto dot = email.find('.', at + 1);
    if (dot == std::string::npos || dot == at + 1 || email.back() == '.') return false;
    return std::all_of(email.begin(), email.end(), [](unsigned char c) { return c > 32 && c < 127; });
}
}

AuthStore::AuthStore(const std::string &path, long long lifetime_) : lifetime(lifetime_) {
    if (path != ":memory:") {
        const auto parent = std::filesystem::path(path).parent_path();
        if (!parent.empty()) std::filesystem::create_directories(parent);
    }
    if (sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nullptr) != SQLITE_OK)
        throw std::runtime_error("Cannot open auth database");
    sqlite3_busy_timeout(db, 3000);
    const char *sql = "PRAGMA foreign_keys=ON;"
        "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);"
        "CREATE TABLE IF NOT EXISTS tokens(digest TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);"
        "DELETE FROM tokens WHERE expires <= strftime('%s','now');";
    if (sqlite3_exec(db, sql, nullptr, nullptr, nullptr) != SQLITE_OK) throw std::runtime_error("Cannot initialize auth database");
    if (path != ":memory:") std::filesystem::permissions(path, std::filesystem::perms::owner_read | std::filesystem::perms::owner_write);
    worker = std::thread([this] {
        for (;;) {
            std::function<void()> job;
            {
                std::unique_lock lock(queueMutex);
                wake.wait(lock, [this] { return stopping || !jobs.empty(); });
                if (jobs.empty() && stopping) return;
                job = std::move(jobs.front()); jobs.pop();
            }
            job();
        }
    });
}
AuthStore::~AuthStore() {
    { std::lock_guard lock(queueMutex); stopping = true; }
    wake.notify_all(); worker.join(); sqlite3_close(db);
}
bool AuthStore::enqueue(std::function<void()> job) {
    std::lock_guard lock(queueMutex);
    if (jobs.size() >= 16 || stopping) return false;
    jobs.push(std::move(job)); wake.notify_one(); return true;
}
std::string AuthStore::digest(const std::string &value) {
    std::array<unsigned char, EVP_MAX_MD_SIZE> bytes{}; unsigned size = 0;
    if (EVP_Digest(value.data(), value.size(), bytes.data(), &size, EVP_sha256(), nullptr) != 1)
        throw std::runtime_error("Token hashing failed");
    return hex(bytes.data(), size);
}
AuthResult AuthStore::credentials(std::string email, const std::string &password, bool registration) {
    const auto first = email.find_first_not_of(" \t\r\n"), last = email.find_last_not_of(" \t\r\n");
    email = first == std::string::npos ? "" : email.substr(first, last - first + 1);
    std::transform(email.begin(), email.end(), email.begin(), [](unsigned char c) { return std::tolower(c); });
    if (!validEmail(email) || password.size() < 8 || password.size() > 128)
        return error(400, "Укажите почту и пароль длиной от 8 до 128 байт.");
    long long userId = 0; std::string salt, expected;
    {
        std::lock_guard lock(databaseMutex);
        Statement query(db, "SELECT id,salt,password_hash FROM users WHERE email=?"); query.text(1, email);
        const auto result = query.step();
        if (result == SQLITE_ROW) { userId = sqlite3_column_int64(query.value, 0); salt = query.text(1); expected = query.text(2); }
        else if (result != SQLITE_DONE) throw std::runtime_error("Cannot read account");
    }
    if (registration && userId) return error(409, "Этот аккаунт уже существует. Выберите «Войти».");
    // Unknown accounts take the same password-hashing path as known accounts.
    if (salt.empty()) salt = randomHex(16);
    const auto actual = passwordHash(password, salt);
    if (!registration && (!userId || expected.size() != actual.size() || CRYPTO_memcmp(expected.data(), actual.data(), actual.size()) != 0))
        return error(401, "Неверная почта или пароль.");
    const auto token = randomHex(32), tokenDigest = digest(token);
    const auto expires = timestamp() + lifetime;
    {
        std::lock_guard lock(databaseMutex);
        if (registration) {
            Statement insert(db, "INSERT INTO users(email,salt,password_hash) VALUES(?,?,?)");
            insert.text(1, email); insert.text(2, salt); insert.text(3, actual);
            const auto result = insert.step();
            if (result == SQLITE_CONSTRAINT) return error(409, "Этот аккаунт уже существует. Выберите «Войти».");
            if (result != SQLITE_DONE) throw std::runtime_error("Cannot create account");
            userId = sqlite3_last_insert_rowid(db);
        }
        Statement insert(db, "INSERT INTO tokens(digest,user_id,expires) VALUES(?,?,?)");
        insert.text(1, tokenDigest); sqlite3_bind_int64(insert.value, 2, userId); sqlite3_bind_int64(insert.value, 3, expires);
        if (insert.step() != SQLITE_DONE) throw std::runtime_error("Cannot create token");
    }
    Json::Value body;
    body["token"] = token; body["token_type"] = "Bearer"; body["expires_at"] = Json::Int64(expires);
    body["user"]["id"] = Json::Int64(userId); body["user"]["email"] = email;
    return {registration ? 201 : 200, body};
}
std::optional<Identity> AuthStore::authorize(const std::string &token) {
    if (token.size() != 64 || !std::all_of(token.begin(), token.end(), [](unsigned char c) { return std::isxdigit(c); })) return {};
    const auto hash = digest(token);
    std::lock_guard lock(databaseMutex);
    Statement query(db, "SELECT u.id,u.email,t.expires FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.digest=? AND t.expires>?");
    query.text(1, hash); sqlite3_bind_int64(query.value, 2, timestamp());
    if (query.step() != SQLITE_ROW) return {};
    return Identity{sqlite3_column_int64(query.value, 0), sqlite3_column_int64(query.value, 2), query.text(1), hash};
}
bool AuthStore::active(const std::string &hash) {
    std::lock_guard lock(databaseMutex);
    Statement query(db, "SELECT 1 FROM tokens WHERE digest=? AND expires>?");
    query.text(1, hash); sqlite3_bind_int64(query.value, 2, timestamp());
    return query.step() == SQLITE_ROW;
}
void AuthStore::revoke(const std::string &token) {
    std::lock_guard lock(databaseMutex);
    Statement query(db, "DELETE FROM tokens WHERE digest=?"); query.text(1, digest(token));
    if (query.step() != SQLITE_DONE) throw std::runtime_error("Cannot revoke token");
}
