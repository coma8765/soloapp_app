#!/usr/bin/env python3
"""Optional macOS integration check: synthetic speech, real local Whisper/proxy.
Temporary speech fixtures are deleted; this never opens the microphone.
"""
import argparse
import io
import json
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3000')
args = parser.parse_args()

def request(path, data=None, origin=None):
    headers = {'Content-Type': 'audio/wav'}
    if origin:
        headers['Origin'] = origin
    req = urllib.request.Request(args.url + path, data=data, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=95)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)

assert request('/api/professors/health')[0] == 200
assert request('/api/professors/transcribe', b'invalid')[0] == 400
assert request('/api/professors/health', origin='https://elsewhere.invalid')[0] == 403
with tempfile.TemporaryDirectory(prefix='professor-synthetic-') as directory:
    source, target = Path(directory)/'speech.aiff', Path(directory)/'speech.wav'
    subprocess.run(['say', '-v', 'Samantha', '-r', '130', '-o', str(source),
        'Hello professor. Today we are walking near the beautiful lake. The water is blue and the forest is green. Please remember the words telescope and butterfly.'], check=True)
    subprocess.run(['ffmpeg','-v','error','-i',str(source),'-ar','16000','-ac','1','-c:a','pcm_s16le',str(target)],check=True)
    with wave.open(str(target),'rb') as f:
        pcm=f.readframes(f.getnframes())
    results=[]
    for offset in range(0,len(pcm),6*16000*2):
        chunk=pcm[offset:offset+8*16000*2]
        encoded=io.BytesIO()
        with wave.open(encoded,'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(chunk)
        started=time.monotonic()
        status, result=request('/api/professors/transcribe',encoded.getvalue(),args.url)
        assert status==200, result
        text=''.join(w['word'] for w in result['words'])
        print(f'{offset/32000:.0f}s, {time.monotonic()-started:.1f}s inference: {text}',flush=True)
        final=len(chunk)<8*16000*2
        results.append({'start':offset/32000,'duration':len(chunk)/32000,'final':final,'words':result['words']})
        if final:
            break
    # Merge with the production JS timeline, including words at window boundaries.
    merged=subprocess.run(['node','--input-type=module','-e',
        "import {TranscriptTimeline} from './public/client/speech-audio.js'; let raw=''; for await(const c of process.stdin) raw+=c; const t=new TranscriptTimeline(); for(const r of JSON.parse(raw)) t.merge(r.words,r.start,r.duration,r.final); console.log(t.text);"],
        input=json.dumps(results),text=True,capture_output=True,check=True).stdout.strip()
    assert all(word in merged.lower() for word in ['professor','lake','water','forest','telescope','butterfly']), merged
    assert merged.lower().count('telescope')==1 and merged.lower().count('butterfly')==1, merged
    print('PASS: real Whisper + C++ proxy + overlapping windows + production merge\n'+merged)
