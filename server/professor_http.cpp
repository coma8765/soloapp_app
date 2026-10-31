#include "professor_http.hpp"
#include <drogon/drogon.h>
#include <atomic>
#include <memory>

namespace {
using Callback = std::function<void(const drogon::HttpResponsePtr &)>;
void fail(const Callback &callback, int status, const char *message) {
    Json::Value body; body["error"] = message;
    auto response = drogon::HttpResponse::newHttpJsonResponse(body);
    response->setStatusCode(static_cast<drogon::HttpStatusCode>(status));
    response->addHeader("Cache-Control", "no-store"); callback(response);
}
bool sameOrigin(const drogon::HttpRequestPtr &request) {
    const auto &origin = request->getHeader("origin"), &host = request->getHeader("host");
    return origin.empty() || origin == "http://" + host || origin == "https://" + host;
}
}

void installProfessorRoutes(int whisperPort) {
    auto pending = std::make_shared<std::atomic<int>>(0);
    for (const bool health : {true, false}) {
        drogon::app().registerHandler(health ? "/api/professors/health" : "/api/professors/transcribe",
            [whisperPort, pending, health](const drogon::HttpRequestPtr &request, Callback &&callback) {
                if (!sameOrigin(request)) { fail(callback, 403, "Недопустимый источник запроса."); return; }
                if (!health && (request->getHeader("content-type") != "audio/wav" ||
                    request->body().size() < 44 || request->body().size() > 256044)) {
                    fail(callback, 400, "Ожидается WAV: mono, 16 kHz, PCM16, не более 8 секунд."); return;
                }
                if (pending->fetch_add(1) >= 4) {
                    --*pending; fail(callback, 429, "Распознавание занято. Повторите запрос."); return;
                }
                auto client = drogon::HttpClient::newHttpClient("http://127.0.0.1:" + std::to_string(whisperPort));
                auto outgoing = drogon::HttpRequest::newHttpRequest();
                outgoing->setMethod(health ? drogon::Get : drogon::Post);
                outgoing->setPath(health ? "/health" : "/transcribe");
                if (!health) {
                    outgoing->setContentTypeString("audio/wav");
                    outgoing->setBody(std::string(request->body()));
                }
                client->sendRequest(outgoing, [client, pending, callback](auto result, const auto &response) {
                    --*pending;
                    if (result != drogon::ReqResult::Ok || !response) {
                        fail(callback, 503, "Локальный Whisper недоступен. Запустите scripts/start-whisper.sh."); return;
                    }
                    auto forwarded = drogon::HttpResponse::newHttpResponse();
                    forwarded->setStatusCode(response->statusCode());
                    forwarded->setContentTypeCode(drogon::CT_APPLICATION_JSON);
                    forwarded->addHeader("Cache-Control", "no-store");
                    forwarded->addHeader("X-Content-Type-Options", "nosniff");
                    forwarded->setBody(std::string(response->body())); callback(forwarded);
                }, health ? 3.0 : 90.0);
            }, {health ? drogon::Get : drogon::Post});
    }
}
