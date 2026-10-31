#pragma once

#include <json/json.h>
#include <array>
#include <cmath>
#include <string>
#include <vector>

struct Vec3 {
    double x = 0, y = 0, z = 0;
    Vec3 operator+(Vec3 b) const { return {x + b.x, y + b.y, z + b.z}; }
    Vec3 operator-(Vec3 b) const { return {x - b.x, y - b.y, z - b.z}; }
    Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
    double dot(Vec3 b) const { return x * b.x + y * b.y + z * b.z; }
    double length() const { return std::sqrt(dot(*this)); }
    Vec3 normalized() const { return *this * (1.0 / std::max(length(), 1e-9)); }
};

struct Fish {
    int id = 0, lake = 0;
    double x = 0, y = 0, vx = 0, vy = 0, phase = 0, depth = 0.5, alarm = 0;
    Vec3 position, heading{0, 0, -1};
};

class Simulation {
public:
    explicit Simulation(const std::string &path);
    void step(double dt, const std::vector<Vec3> &players);
    Json::Value snapshot() const;
    const std::vector<Fish> &fish() const { return fish_; }
    double bed(int lake, double x, double y) const;
    double waterRadius = 36.8;

private:
    struct Lake { Vec3 up, tangent, side; std::vector<double> heights; };
    std::vector<Lake> lakes_;
    std::vector<Fish> fish_;
    int size_ = 49;
    double spacing_ = 0.25, extent_ = 6, time_ = 0;
    unsigned long long tick_ = 0;
    Vec3 worldPosition(const Fish &fish) const;
};
