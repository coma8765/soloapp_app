#pragma once
#include <json/json.h>
#include <sqlite3.h>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <optional>
#include <queue>
#include <string>
#include <thread>

struct Identity {
    long long id = 0, expires = 0;
    std::string email, digest;
};
struct AuthResult {
    int status;
    Json::Value body;
};
class AuthStore {
public:
    explicit AuthStore(const std::string &path, long long lifetime = 86400);
    ~AuthStore();
    AuthResult credentials(std::string email, const std::string &password, bool registration);
    std::optional<Identity> authorize(const std::string &token);
    bool active(const std::string &digest);
    void revoke(const std::string &token);
    bool enqueue(std::function<void()> job);
    static std::string digest(const std::string &value);
private:
    sqlite3 *db = nullptr;
    long long lifetime;
    std::mutex databaseMutex, queueMutex;
    std::condition_variable wake;
    std::queue<std::function<void()>> jobs;
    bool stopping = false;
    std::thread worker;
};
