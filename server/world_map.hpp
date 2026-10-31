#pragma once
#include "simulation.hpp"

// White room: 24 x 24 metres, 6-metre ceiling. Positions are avatar feet.
inline bool validRoomPosition(const Vec3 &p) {
    return std::abs(p.x) <= 12 && std::abs(p.z) <= 12 && p.y >= 0 && p.y <= 6;
}
inline Vec3 roomSpawn(int slot) {
    return {(slot % 4 - 1.5) * 3, 0, 4.0 + (slot / 4) * 3};
}
