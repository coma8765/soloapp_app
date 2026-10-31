#pragma once
// The optional local recognizer is an independent process; gameplay never waits
// for inference on its event loop.
void installProfessorRoutes(int whisperPort);
