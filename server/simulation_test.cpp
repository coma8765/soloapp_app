#include "simulation.hpp"
#include <iostream>
#include <stdexcept>

int main(int argc, char **argv) {
    if (argc != 2) return 1;
    Simulation baseline(argv[1]), reactive(argv[1]);
    const Vec3 player = reactive.fish()[0].position;
    for (int i = 0; i < 40; ++i) {
        baseline.step(0.05, {});
        reactive.step(0.05, {player});
    }
    if (reactive.fish()[0].alarm < 0.5 || (reactive.fish()[0].position - baseline.fish()[0].position).length() < 0.5 || (reactive.fish()[0].position - player).length() < 1.0) {
        throw std::runtime_error("Fish did not flee from the player");
    }
    for (int i = 0; i < 2400; ++i) {
        reactive.step(0.05, {});
        for (const auto &fish : reactive.fish()) {
            if (fish.position.length() >= reactive.waterRadius - 0.3 || fish.position.length() <= reactive.bed(fish.lake, fish.x, fish.y) + 0.3) {
                throw std::runtime_error("Fish left navigable water");
            }
        }
    }
    if (reactive.fish()[0].alarm != 0) throw std::runtime_error("Fish did not calm down");
    std::cout << "PASS: flee, recover, stay between surface and lake bed\n";
}
