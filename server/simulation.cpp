#include "simulation.hpp"
#include <algorithm>
#include <fstream>
#include <stdexcept>

namespace {
Vec3 vectorFrom(const Json::Value &v) { return {v[0].asDouble(), v[1].asDouble(), v[2].asDouble()}; }
}

Simulation::Simulation(const std::string &path) {
    std::ifstream input(path);
    Json::Value data;
    if (!input || !(input >> data)) throw std::runtime_error("Cannot load lake navigation: " + path);
    waterRadius = data["water_radius"].asDouble();
    size_ = data["size"].asInt();
    spacing_ = data["step"].asDouble();
    extent_ = data["extent"].asDouble();
    if (size_ < 2 || spacing_ <= 0 || data["lakes"].size() != 4) throw std::runtime_error("Invalid lake data");
    for (const auto &item : data["lakes"]) {
        Lake lake{vectorFrom(item["up"]), vectorFrom(item["tangent"]), vectorFrom(item["side"]), {}};
        for (const auto &height : item["heights"]) lake.heights.push_back(height.asDouble());
        if (lake.heights.size() != static_cast<size_t>(size_ * size_)) throw std::runtime_error("Invalid height grid");
        lakes_.push_back(std::move(lake));
    }
    for (int lake = 0; lake < 4; ++lake) {
        for (int i = 0; i < 12; ++i) {
            Fish fish;
            fish.id = lake * 12 + i;
            fish.lake = lake;
            fish.phase = i * 2.399963 + lake;
            const double radius = 1.0 + (i % 5) * 0.48;
            fish.x = std::cos(fish.phase) * radius;
            fish.y = std::sin(fish.phase) * radius;
            fish.depth = 0.38 + (i % 4) * 0.09;
            fish.position = worldPosition(fish);
            fish_.push_back(fish);
        }
    }
}

double Simulation::bed(int lake, double x, double y) const {
    const double gx = std::clamp((x + extent_) / spacing_, 0.0, size_ - 1.000001);
    const double gy = std::clamp((y + extent_) / spacing_, 0.0, size_ - 1.000001);
    const int ix = static_cast<int>(gx), iy = static_cast<int>(gy);
    const auto &h = lakes_.at(lake).heights;
    auto at = [&](int dx, int dy) { return h[(iy + dy) * size_ + ix + dx]; };
    const double a = at(0, 0) * (1 - gx + ix) + at(1, 0) * (gx - ix);
    const double b = at(0, 1) * (1 - gx + ix) + at(1, 1) * (gx - ix);
    return a * (1 - gy + iy) + b * (gy - iy);
}

Vec3 Simulation::worldPosition(const Fish &fish) const {
    const auto &lake = lakes_[fish.lake];
    const double bottom = bed(fish.lake, fish.x, fish.y);
    const double radius = bottom + (waterRadius - bottom) * fish.depth;
    return (lake.up * waterRadius + lake.tangent * fish.x + lake.side * fish.y).normalized() * radius;
}

void Simulation::step(double dt, const std::vector<Vec3> &players) {
    time_ += dt;
    ++tick_;
    for (auto &fish : fish_) {
        const auto &lake = lakes_[fish.lake];
        const double phase = time_ * 0.22 + fish.phase;
        double desiredX = std::cos(phase) * 2.5 - fish.x;
        double desiredY = std::sin(phase) * 2.5 - fish.y;
        bool scared = false;
        for (const auto &player : players) {
            if (player.length() > waterRadius + 0.15) continue;
            const Vec3 away = fish.position - player;
            const double distance = away.length();
            if (distance >= 4.0) continue;
            scared = true;
            const double force = (4.0 - distance) * 5.0 / std::max(distance, 0.2);
            desiredX += away.dot(lake.tangent) * force;
            desiredY += away.dot(lake.side) * force;
            if (distance < 0.2) {
                desiredX += std::cos(fish.phase) * 12;
                desiredY += std::sin(fish.phase) * 12;
            }
        }
        fish.alarm = scared ? 1.0 : std::max(0.0, fish.alarm - dt * 0.5);
        const double speed = 0.8 + fish.alarm * 2.0;
        const double length = std::max(std::hypot(desiredX, desiredY), 0.001);
        const double blend = 1 - std::exp(-dt * 4.0);
        fish.vx += (desiredX / length * speed - fish.vx) * blend;
        fish.vy += (desiredY / length * speed - fish.vy) * blend;
        double x = fish.x + fish.vx * dt, y = fish.y + fish.vy * dt;
        const double radius = std::hypot(x, y);
        if (radius > 4.7) { x *= 4.7 / radius; y *= 4.7 / radius; }
        if (bed(fish.lake, x, y) < waterRadius - 1.2) {
            fish.x = x;
            fish.y = y;
        } else {
            fish.vx = -fish.x;
            fish.vy = -fish.y;
        }
        const Vec3 next = worldPosition(fish);
        if ((next - fish.position).length() > 1e-6) fish.heading = (next - fish.position).normalized();
        fish.position = next;
    }
}

Json::Value Simulation::snapshot() const {
    Json::Value result;
    result["type"] = "fish";
    result["sequence"] = Json::UInt64(tick_);
    result["time"] = time_;
    result["fish"] = Json::Value(Json::arrayValue);
    for (const auto &fish : fish_) {
        Json::Value item(Json::arrayValue);
        item.append(fish.id);
        for (double v : {fish.position.x, fish.position.y, fish.position.z, fish.heading.x, fish.heading.y, fish.heading.z, fish.alarm}) {
            item.append(std::round(v * 10000.0) / 10000.0);
        }
        result["fish"].append(item);
    }
    return result;
}
