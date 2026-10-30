"""Original background music for the reels, synthesised from scratch (no samples, no licences).
codeit-bed.wav: a bright chiptune loop for a kids' game (120 bpm).
lynq-bed.wav: a minimal, dark electronic pulse (100 bpm)."""
import numpy as np, wave, sys
SR = 44100

def note(n):  # MIDI number to Hz
    return 440.0 * 2 ** ((n - 69) / 12)

def env(length, a=0.005, d=0.08, s=0.6, r=0.05):
    t = np.arange(length) / SR
    e = np.ones(length) * s
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    e[:ai] = np.linspace(0, 1, ai) if ai else 1
    e[ai:ai + di] = np.linspace(1, s, len(e[ai:ai + di]))
    if ri: e[-ri:] *= np.linspace(1, 0, ri)
    return e

def lowpass(x, k=0.15):
    y = np.zeros_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc += k * (v - acc); y[i] = acc
    return y

def pulse(f, length, duty=0.25):
    t = np.arange(length) / SR
    return np.where((t * f) % 1 < duty, 1.0, -1.0)

def tri(f, length):
    t = np.arange(length) / SR
    return 2 * np.abs(2 * ((t * f) % 1) - 1) - 1

def kick(length):
    t = np.arange(length) / SR
    f = 120 * np.exp(-t * 30) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)

def hat(length):
    return np.random.default_rng(1).uniform(-1, 1, length) * np.exp(-np.arange(length) / SR * 60)

def place(buf, x, at, gain=1.0):
    i = int(at * SR); j = min(len(buf), i + len(x))
    if j > i: buf[i:j] += x[: j - i] * gain

def echo(x, delay=0.18, fb=0.3, mix=0.25):
    d = int(delay * SR); y = x.copy()
    for i in range(d, len(y)): y[i] += y[i - d] * fb
    return x * (1 - mix) + y * mix

def write(path, x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.8
    pcm = (np.stack([x, x], 1) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def codeit(seconds=20):
    bpm = 120; beat = 60 / bpm; out = np.zeros(int(seconds * SR))
    prog = [(60, [0, 4, 7]), (67, [0, 4, 7]), (69, [0, 3, 7]), (65, [0, 4, 7])]  # C G Am F
    bar = beat * 4; t = 0.0; k = 0
    while t < seconds:
        root, chord = prog[k % 4]
        for step in range(8):  # eighth-note arpeggio
            n = root + chord[step % 3] + (12 if step >= 4 else 0)
            L = int(beat / 2 * SR)
            place(out, lowpass(pulse(note(n), L, 0.25), 0.25) * env(L, d=0.1, s=0.35, r=0.03), t + step * beat / 2, 0.16)
        Lb = int(bar * SR)
        place(out, tri(note(root - 24), Lb) * env(Lb, d=0.2, s=0.7, r=0.1), t, 0.33)
        for b in range(4):
            place(out, kick(int(0.25 * SR)), t + b * beat, 0.55 if b % 2 == 0 else 0.4)
            place(out, hat(int(0.06 * SR)), t + b * beat + beat / 2, 0.12)
        if k % 2 == 1:  # little melody every other bar
            for i, m in enumerate([12, 14, 16, 19]):
                L = int(beat / 2 * SR)
                place(out, lowpass(pulse(note(root + m), L, 0.5), 0.2) * env(L, d=0.15, s=0.3, r=0.04), t + 2 * beat + i * beat / 2, 0.12)
        t += bar; k += 1
    fade = int(0.8 * SR); out[-fade:] *= np.linspace(1, 0, fade)
    return echo(out, 0.25, 0.25, 0.2)

def lynq(seconds=20):
    bpm = 100; beat = 60 / bpm; out = np.zeros(int(seconds * SR))
    roots = [45, 45, 41, 43]  # A A F G, low
    t = 0.0; k = 0
    while t < seconds:
        r = roots[k % 4]
        for s16 in range(16):
            L = int(beat / 4 * SR)
            sig = np.sin(2 * np.pi * note(r) * np.arange(L) / SR) + 0.3 * np.sin(2 * np.pi * note(r + 12) * np.arange(L) / SR)
            place(out, sig * env(L, a=0.002, d=0.08, s=0.2, r=0.02), t + s16 * beat / 4, 0.22 if s16 % 4 == 0 else 0.12)
        Lp = int(beat * 4 * SR)
        pad = sum(np.sin(2 * np.pi * note(r + 24 + iv) * np.arange(Lp) / SR) for iv in (0, 7, 12))
        place(out, lowpass(pad, 0.05) * env(Lp, a=0.6, d=0.5, s=0.6, r=0.8), t, 0.08)
        for b in range(4):
            place(out, kick(int(0.3 * SR)), t + b * beat, 0.5)
            place(out, hat(int(0.04 * SR)), t + b * beat + beat / 2, 0.08)
        t += beat * 4; k += 1
    fade = int(1.0 * SR); out[-fade:] *= np.linspace(1, 0, fade)
    return echo(out, 0.3, 0.3, 0.18)

if __name__ == "__main__":
    d = sys.argv[1]
    write(f"{d}/codeit-bed.wav", codeit())
    write(f"{d}/lynq-bed.wav", lynq())
