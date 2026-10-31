#include "lobby.hpp"
#include <drogon/drogon.h>

namespace {
using Callback = std::function<void(const drogon::HttpResponsePtr &)>;
void respond(const Callback &callback, const AuthResult &result) {
    auto response = drogon::HttpResponse::newHttpJsonResponse(result.body);
    response->setStatusCode(static_cast<drogon::HttpStatusCode>(result.status));
    response->addHeader("Cache-Control", "no-store");
    if (result.status == 401) response->addHeader("WWW-Authenticate", "Bearer");
    callback(response);
}
void error(const Callback &callback, int status, const char *message) {
    Json::Value body; body["error"] = message; respond(callback, {status, body});
}
void handle(AuthStore &auth, LobbyStore &lobby, const drogon::HttpRequestPtr &request, const Callback &callback,
            const std::string &action, const std::string &rawId = "0") {
    try {
        const auto &origin = request->getHeader("origin"), &host = request->getHeader("host");
        if (!origin.empty() && origin != "http://" + host && origin != "https://" + host) { error(callback, 403, "Недопустимый источник запроса."); return; }
        const auto &header = request->getHeader("authorization");
        const auto user = auth.authorize(header.rfind("Bearer ", 0) == 0 ? header.substr(7) : "");
        if (!user) { error(callback, 401, "Войдите в аккаунт."); return; }
        if (rawId.empty() || rawId.size() > 16 || rawId.find_first_not_of("0123456789") != std::string::npos) { error(callback, 400, "Некорректный ID сервера."); return; }
        const auto id = std::stoll(rawId);
        if (action == "list") { respond(callback, lobby.list(*user)); return; }
        if (action == "get") { respond(callback, lobby.get(id)); return; }
        if (request->body().size() > 1024) { error(callback, 413, "Слишком большой запрос."); return; }
        std::string name;
        if (action == "create" && !request->body().empty()) {
            const auto body = request->getJsonObject();
            if (!body || !body->isObject() || (body->isMember("name") && !(*body)["name"].isString())) { error(callback, 400, "Ожидается JSON с названием сервера."); return; }
            if (body->isMember("name")) name = (*body)["name"].asString();
        }
        respond(callback, lobby.act(*user, action, id, name));
    } catch (const std::exception &) { error(callback, 500, "Не удалось обработать сервер. Повторите запрос."); }
}
}
void installLobbyRoutes(AuthStore &auth, LobbyStore &lobby) {
    drogon::app().registerHandler("/api/servers", [&auth, &lobby](const drogon::HttpRequestPtr &request, Callback &&callback) {
        handle(auth, lobby, request, callback, request->method() == drogon::Get ? "list" : "create");
    }, {drogon::Get, drogon::Post});
    drogon::app().registerHandler("/api/servers/{1}", [&auth, &lobby](const drogon::HttpRequestPtr &request, Callback &&callback, std::string id) {
        handle(auth, lobby, request, callback, request->method() == drogon::Get ? "get" : "delete", id);
    }, {drogon::Get, drogon::Delete});
    for (const std::string action : {"join", "leave", "start", "ready"}) {
        drogon::app().registerHandler("/api/servers/{1}/" + action, [&auth, &lobby, action](const drogon::HttpRequestPtr &request, Callback &&callback, std::string id) {
            handle(auth, lobby, request, callback, action, id);
        }, {drogon::Post});
    }
}
