#include "auth_http.hpp"
#include <drogon/drogon.h>
#include <chrono>
#include <map>
#include <mutex>

namespace {
using Callback = std::function<void(const drogon::HttpResponsePtr &)>;
void respond(const Callback &callback, int status, Json::Value body) {
    auto response = drogon::HttpResponse::newHttpJsonResponse(body);
    response->setStatusCode(static_cast<drogon::HttpStatusCode>(status));
    response->addHeader("Cache-Control", "no-store");
    response->addHeader("X-Content-Type-Options", "nosniff");
    if (status == 401) response->addHeader("WWW-Authenticate", "Bearer");
    if (status == 429) response->addHeader("Retry-After", "60");
    callback(response);
}
void error(const Callback &callback, int status, const char *message) {
    Json::Value body; body["error"] = message; respond(callback, status, body);
}
std::string bearer(const drogon::HttpRequestPtr &request) {
    const auto &header = request->getHeader("authorization");
    return header.rfind("Bearer ", 0) == 0 ? header.substr(7) : "";
}
bool originAllowed(const drogon::HttpRequestPtr &request) {
    const auto &origin = request->getHeader("origin"), &host = request->getHeader("host");
    return origin.empty() || origin == "http://" + host || origin == "https://" + host;
}
bool allowAttempt(const std::string &ip) {
    static std::mutex mutex;
    static std::map<std::string, std::pair<long long, int>> attempts;
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    std::lock_guard lock(mutex);
    for (auto it = attempts.begin(); it != attempts.end();) {
        if (now - it->second.first >= 60) it = attempts.erase(it); else ++it;
    }
    if (!attempts.count(ip) && attempts.size() >= 1024) return false;
    auto &entry = attempts[ip];
    if (!entry.first) entry.first = now;
    return ++entry.second <= 30;
}
}

void installAuthRoutes(AuthStore &store) {
    for (bool registration : {true, false}) {
        drogon::app().registerHandler(registration ? "/api/auth/register" : "/api/auth/login",
            [&store, registration](const drogon::HttpRequestPtr &request, Callback &&callback) {
                if (!originAllowed(request)) { error(callback, 403, "Недопустимый источник запроса."); return; }
                if (request->body().size() > 4096) { error(callback, 413, "Слишком большой запрос."); return; }
                if (!allowAttempt(request->peerAddr().toIp())) { error(callback, 429, "Слишком много попыток. Повторите через минуту."); return; }
                const auto body = request->getJsonObject();
                if (!body || !body->isObject() || !(*body)["email"].isString() || !(*body)["password"].isString()) {
                    error(callback, 400, "Требуются почта и пароль."); return;
                }
                const auto email = (*body)["email"].asString(), password = (*body)["password"].asString();
                // Password hashing runs on a bounded worker, never on the 20 Hz world loop.
                if (!store.enqueue([&store, registration, email, password, callback] {
                    try { const auto result = store.credentials(email, password, registration); respond(callback, result.status, result.body); }
                    catch (const std::exception &) { error(callback, 500, "Не удалось обработать аккаунт. Повторите позже."); }
                })) error(callback, 429, "Сервер занят. Повторите через минуту.");
            }, {drogon::Post});
    }
    drogon::app().registerHandler("/api/auth/me", [&store](const drogon::HttpRequestPtr &request, Callback &&callback) {
        const auto user = store.authorize(bearer(request));
        if (!user) { error(callback, 401, "Войдите в аккаунт."); return; }
        Json::Value body; body["user"]["id"] = Json::Int64(user->id); body["user"]["email"] = user->email;
        body["expires_at"] = Json::Int64(user->expires); respond(callback, 200, body);
    }, {drogon::Get});
    drogon::app().registerHandler("/api/auth/logout", [&store](const drogon::HttpRequestPtr &request, Callback &&callback) {
        if (!originAllowed(request)) { error(callback, 403, "Недопустимый источник запроса."); return; }
        const auto token = bearer(request);
        if (!store.authorize(token)) { error(callback, 401, "Сессия уже завершена."); return; }
        store.revoke(token); Json::Value body; body["ok"] = true; respond(callback, 200, body);
    }, {drogon::Post});
}
