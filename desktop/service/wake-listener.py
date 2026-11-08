"""Hey Jupiter: an offline wake word listener.

Audio stays on this PC. The microphone is read continuously, but only stretches of speech are
looked at, by the local Whisper model; nothing is recorded to disk or sent anywhere. When a
stretch begins with "Hey Jupiter", the words after it (or the next thing said) are printed as
one JSON line for Jupiter's service. Commands from the service arrive on stdin:
{"mute": true|false} pauses listening while Jupiter is speaking.
{"cancel": true} drops a request being listened for or transcribed (the J button pressed again).
"""
import argparse
import json
import queue
import re
import sys
import threading
import time

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--device', default=None)
parser.add_argument('--check', nargs='*', help='test mode: report what each audio file would do, then exit')
args = parser.parse_args()

RATE = 16000
BLOCK = 480                      # 30 ms
WAKE = re.compile(r"\b(?:(?:hey|hi|ok|okay|hay|he|a)[\s,.!]*)?(?:jupiter|jupitor|jupita|jupiters)\b[\s,.!?]*", re.I)
FOLLOW_UP_SECONDS = 7.0          # after a bare "Hey Jupiter", how long to wait for the command
MAX_SPEECH_SECONDS = 15.0
END_SILENCE_SECONDS = 0.8


def say(kind, **fields):
    sys.stdout.write(json.dumps({'type': kind, **fields}) + '\n')
    sys.stdout.flush()


model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
blocks = queue.Queue(maxsize=400)
muted = threading.Event()
listen_now = threading.Event()
cancel_now = threading.Event()
listen_for = [FOLLOW_UP_SECONDS]


def on_audio(data, frames, timing, status):
    if muted.is_set():
        return
    try:
        blocks.put_nowait(data[:, 0].copy())
    except queue.Full:
        pass


def read_commands():
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if message.get('listen') is True:
            listen_for[0] = float(message.get('seconds') or FOLLOW_UP_SECONDS)
            listen_now.set()
        # The J button pressed again: drop the request being listened for or transcribed.
        if message.get('cancel') is True:
            listen_now.clear()
            cancel_now.set()
        if message.get('mute') is True:
            muted.set()
        elif message.get('mute') is False:
            # Drop anything heard while Jupiter was talking, so it never hears itself.
            while not blocks.empty():
                try:
                    blocks.get_nowait()
                except queue.Empty:
                    break
            muted.clear()


def transcribe(audio):
    """Words actually spoken, or '' for noise. No prompt is given: with one, Whisper tends to
    'hear' the prompt in a cough or a door. Silero speech detection drops non speech first, and
    segments Whisper itself thinks are not speech are ignored."""
    segments, _ = model.transcribe(audio, language='en', beam_size=1, vad_filter=True,
                                   vad_parameters={'threshold': 0.55, 'min_speech_duration_ms': 300},
                                   condition_on_previous_text=False, without_timestamps=True)
    words = [segment.text.strip() for segment in segments if segment.no_speech_prob < 0.45 and segment.avg_logprob > -1.0]
    return ' '.join(words).strip()


# The wake phrase has to open what was said (a word or two of lead in at most), so "I think
# Jupiter is the biggest planet" or a stray "...jupiter" on TV doesn't wake it.
def wake_in(text):
    match = WAKE.search(text)
    return match if match and len(text[:match.start()].split()) <= 1 else None


def main():
    threading.Thread(target=read_commands, daemon=True).start()
    device = int(args.device) if args.device and args.device.isdigit() else args.device
    stream = sd.InputStream(samplerate=RATE, channels=1, dtype='float32', blocksize=BLOCK, device=device, callback=on_audio)
    with stream:
        say('ready', device=sd.query_devices(stream.device if isinstance(stream.device, int) else None, 'input')['name'])
        noise = 0.004
        speech, silent, active = [], 0.0, False
        awaiting_until = 0.0
        while True:
            if cancel_now.is_set():
                cancel_now.clear()
                awaiting_until, active, speech, silent = 0.0, False, [], 0.0
                while not blocks.empty():
                    try:
                        blocks.get_nowait()
                    except queue.Empty:
                        break
                continue
            if listen_now.is_set() and not awaiting_until:
                awaiting_until = time.time() + listen_for[0]
                listen_now.clear()
            try:
                block = blocks.get(timeout=0.5)
            except queue.Empty:
                # A bare 'Hey Jupiter' with nothing after it goes back to waiting.
                if awaiting_until and time.time() > awaiting_until and not active:
                    awaiting_until = 0.0
                    say('timeout')
                continue
            level = float(np.sqrt(np.mean(block * block)) + 1e-9)
            # The floor follows the room's background noise slowly; speech is well above it.
            if not active:
                noise = 0.97 * noise + 0.03 * min(level, 0.05)
            loud = level > max(0.012, noise * 3.2)
            if loud and not active:
                active, speech, silent = True, [], 0.0
            if active:
                speech.append(block)
                silent = 0.0 if loud else silent + BLOCK / RATE
                length = len(speech) * BLOCK / RATE
                if silent < END_SILENCE_SECONDS and length < MAX_SPEECH_SECONDS:
                    continue
                active = False
                if length < 0.45:
                    continue
                audio = np.concatenate(speech)
                waiting = time.time() < awaiting_until
                if listen_now.is_set():
                    listen_now.clear(); waiting = True
                text = transcribe(audio)
                if cancel_now.is_set():
                    continue
                if not text or len(re.sub(r'[^a-z]', '', text.lower())) < 2:
                    continue
                match = wake_in(text)
                if match:
                    command = text[match.end():].strip(' ,.!?')
                    if command:
                        awaiting_until = 0.0
                        say('command', text=command)
                    else:
                        awaiting_until = time.time() + FOLLOW_UP_SECONDS
                        say('wake')
                elif waiting:
                    awaiting_until = 0.0
                    say('command', text=text.strip(' ,.!?'))
                if awaiting_until and time.time() > awaiting_until:
                    awaiting_until = 0.0
                    say('timeout')


if args.check:
    from faster_whisper.audio import decode_audio
    for name in args.check:
        heard = transcribe(decode_audio(name, sampling_rate=RATE))
        match = wake_in(heard)
        say('check', file=name, text=heard, wake=bool(match), command=heard[match.end():].strip(' ,.!?') if match else '')
    sys.exit(0)

try:
    main()
except KeyboardInterrupt:
    pass
except Exception as error:  # the service shows this and keeps Jupiter running
    say('error', message=str(error)[:300])
    sys.exit(1)
