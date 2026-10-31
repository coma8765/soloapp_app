import io
import json
import socket
import subprocess
import threading
import time
import unittest
import urllib.error
import urllib.request
import wave
from http.server import ThreadingHTTPServer
from pathlib import Path
from whisper_service import decode_wav, make_handler


def wav(samples=b'\x00\x00' * 1600, rate=16000, channels=1):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as f:
        f.setnchannels(channels); f.setsampwidth(2); f.setframerate(rate); f.writeframes(samples)
    return buffer.getvalue()


class WorkerTests(unittest.TestCase):
    def test_decode(self):
        self.assertEqual(decode_wav(wav()), b'\x00\x00' * 1600)
        for invalid in [wav(rate=48000), wav(channels=2), wav(samples=b''), wav()[:-4], b'invalid', wav(b'\0\0' * 128001)]:
            with self.assertRaises((ValueError, wave.Error, EOFError)):
                decode_wav(invalid)

    def test_http_isolation_and_busy(self):
        entered, release = threading.Event(), threading.Event()
        seen = []
        def recognize(pcm):
            seen.append(pcm); entered.set(); release.wait(5)
            return [{'word': str(pcm[0]), 'start': 0, 'end': .1}]
        server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(recognize, 'test-local'))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(path, data=None, headers=None):
            req = urllib.request.Request(f'http://127.0.0.1:{server.server_port}{path}', data=data, headers=headers or {})
            try:
                response = urllib.request.urlopen(req, timeout=6)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                return response.status, json.load(response)
        try:
            self.assertEqual(request('/health')[1]['ready'], True)
            self.assertEqual(request('/transcribe', wav(), {'Content-Type':'audio/wav','Origin':'https://other.test'})[0],403)
            self.assertEqual(request('/transcribe', b'bad', {'Content-Type':'audio/wav'})[0],400)
            first=[]
            job=threading.Thread(target=lambda:first.append(request('/transcribe',wav(b'\1\0'*1600),{'Content-Type':'audio/wav'})))
            job.start(); self.assertTrue(entered.wait(2))
            self.assertEqual(request('/transcribe',wav(),{'Content-Type':'audio/wav'})[0],429)
            release.set(); job.join()
            second=request('/transcribe',wav(b'\2\0'*1600),{'Content-Type':'audio/wav'})
            self.assertEqual([first[0][1]['words'][0]['word'],second[1]['words'][0]['word']],['1','2'])
            self.assertEqual(seen,[b'\1\0'*1600,b'\2\0'*1600])
        finally:
            release.set(); server.shutdown(); server.server_close(); thread.join()

    @unittest.skipUnless((Path(__file__).resolve().parent.parent / 'build/planet_server').is_file(), 'Build C++ server first')
    def test_cpp_proxy(self):
        root = Path(__file__).resolve().parent.parent
        seen = []
        def recognize(pcm):
            seen.append(pcm)
            return [{'word':'proxy-ok','start':0,'end':.1}]
        worker = ThreadingHTTPServer(('127.0.0.1',0),make_handler(recognize,'test-local'))
        thread = threading.Thread(target=worker.serve_forever,daemon=True); thread.start()
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1',0)); port=reservation.getsockname()[1]
        process=subprocess.Popen([str(root/'build/planet_server'),f'--port={port}',f'--whisper-port={worker.server_port}','--auth-db=:memory:'],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        def request(path,data=None,origin=None):
            headers={'Content-Type':'audio/wav'}
            if origin: headers['Origin']=origin
            req=urllib.request.Request(f'http://127.0.0.1:{port}/api/professors/'+path,data=data,headers=headers)
            try: response=urllib.request.urlopen(req,timeout=5)
            except urllib.error.HTTPError as error: response=error
            with response:
                self.assertEqual(response.headers['Cache-Control'],'no-store')
                return response.status,json.load(response)
        try:
            for _ in range(100):
                try:
                    status,health=request('health'); break
                except urllib.error.URLError:
                    time.sleep(.05)
            else: self.fail('C++ server did not start')
            self.assertEqual(status,200); self.assertTrue(health['local'])
            self.assertEqual(request('transcribe',wav(b'\3\0'*1600),f'http://127.0.0.1:{port}')[1]['words'][0]['word'],'proxy-ok')
            self.assertEqual(seen,[b'\3\0'*1600])
            self.assertEqual(request('transcribe',wav(rate=48000))[0],400)
            self.assertEqual(request('transcribe',b'bad')[0],400)
            self.assertEqual(request('health',origin='https://elsewhere.invalid')[0],403)
            worker.shutdown(); worker.server_close(); thread.join()
            self.assertEqual(request('health')[0],503)
        finally:
            process.terminate(); process.wait(5)
            if thread.is_alive(): worker.shutdown(); worker.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
