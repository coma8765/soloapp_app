#pragma once
#include "auth.hpp"
#include <functional>
#include <vector>

class LobbyStore {
public:
    explicit LobbyStore(const std::string &path, std::function<long long()> clock = {});
    ~LobbyStore();
    AuthResult list(const Identity &user);
    AuthResult get(long long id);
    AuthResult act(const Identity &user, const std::string &action, long long id, std::string name = "");
    bool canConnect(long long user, long long server);
    std::vector<long long> running();
private:
    sqlite3 *db = nullptr;
    std::mutex mutex;
    std::function<long long()> clock;
    Json::Value room(long long id);
    void advance(long long id);
    void finishCountdowns();
    int freeSlot(long long id);
};

void installLobbyRoutes(AuthStore &auth, LobbyStore &lobby);
