#!/usr/bin/env python3
"""Stateless, loopback-only Whisper worker. Audio exists only in request memory.

Each request is one mono speaker/lake window. No previous-text prompt, sessions,
files, microphone access or cloud inference. The C++ server proxies same-origin
browser requests so no CORS/private-network permissions are needed in VR.
"""
import argparse
import io
import json
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def decode_wav(body):
    if not 44 <= len(body) <= 256044:
        raise ValueError('WAV must contain at most 8 seconds')
    with wave.open(io.BytesIO(body), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 16000, 'NONE'):
            raise ValueError('Expected mono PCM16 WAV at 16000 Hz')
        count = audio.getnframes()
        if not 1 <= count <= 128000:
            raise ValueError('Invalid window duration')
        pcm = audio.readframes(count)
        if len(pcm) != count * 2:
            raise ValueError('Truncated PCM')
    return pcm


def make_handler(recognize, model_name):
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Do not log audio or recognized conversations.

        def reply(self, status, data):
            encoded = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(encoded)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path != '/health':
                self.reply(404, {'error': 'Not found'}); return
            self.reply(200, {'ready': True, 'model': model_name, 'local': True})

        def do_POST(self):
            if self.path != '/transcribe':
                self.reply(404, {'error': 'Not found'}); return
            # Browsers must use the same-origin C++ proxy, never this worker.
            if self.headers.get('Origin'):
                self.reply(403, {'error': 'Use the application proxy'}); return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 44 <= size <= 256044 or self.headers.get_content_type() != 'audio/wav':
                    raise ValueError('Invalid WAV request')
                self.connection.settimeout(10)
                pcm = decode_wav(self.rfile.read(size))
            except (ValueError, wave.Error, EOFError, OSError):
                self.reply(400, {'error': 'Invalid mono PCM16 16 kHz WAV'}); return
            if not lock.acquire(blocking=False):
                self.reply(429, {'error': 'Whisper busy'}); return
            try:
                self.reply(200, {'words': recognize(pcm)})
            except Exception:
                self.reply(503, {'error': 'Local Whisper inference failed'})
            finally:
                lock.release()

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--port', type=int, default=8178)
    args = parser.parse_args()
    if not (args.model / 'config.json').is_file() or not (args.model / 'weights.safetensors').is_file():
        parser.error('Provide a local MLX Whisper model directory; run scripts/setup-whisper.sh first')
    import numpy as np
    import mlx_whisper

    def recognize(pcm):
        audio = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
        if np.sqrt(np.mean(audio * audio)) < .002:
            return []  # Avoid Whisper hallucinations on silent windows.
        result = mlx_whisper.transcribe(audio, path_or_hf_repo=str(args.model.resolve()),
            word_timestamps=True, condition_on_previous_text=False, temperature=0,
            hallucination_silence_threshold=1.5, verbose=None)
        return [{'word': w['word'], 'start': w['start'], 'end': w['end']}
                for segment in result.get('segments', []) if segment.get('no_speech_prob', 0) < .8
                for w in segment.get('words', [])]

    # Load and exercise the model before health reports readiness. Silence still
    # needs an explicit inference here because recognize() intentionally skips it.
    mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=str(args.model.resolve()),
        word_timestamps=True, condition_on_previous_text=False, temperature=0, verbose=None)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(recognize, args.model.name))
    print(f'Local Whisper ready at http://127.0.0.1:{args.port}; audio is never saved', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
