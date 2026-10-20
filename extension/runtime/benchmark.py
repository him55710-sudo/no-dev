"""Pureobom command measurement worker. Runs reviewed argv, never a shell string.

Input is one bounded JSON plan on stdin; stdout is bounded NDJSON protocol only.
The extension owns timeout/cancellation of this worker and its process group/tree.
This executes trusted project code with normal user privileges, not in a sandbox.
"""
import ctypes
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time

LIMIT = 4 * 1024 * 1024


def emit(value):
    print(json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)


class Capture:
    def __init__(self, pipe):
        self.digest = hashlib.sha256()
        self.size = 0
        self.tail = b""
        self.pipe = pipe
        self.thread = threading.Thread(target=self.read, daemon=True)
        self.thread.start()

    def read(self):
        while True:
            part = self.pipe.read(65536)
            if not part:
                return
            self.size += len(part)
            if self.size <= LIMIT:
                self.digest.update(part)
                self.tail = (self.tail + part)[-2048:]


class WindowsMemory:
    def __init__(self, pid):
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in ["peak", "working", "peakPaged", "paged", "peakNonPaged", "nonPaged", "pagefile", "peakPagefile"]]
        self.Counters = Counters
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.info = ctypes.WinDLL("psapi", use_last_error=True).GetProcessMemoryInfo
        self.info.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        self.info.restype = wintypes.BOOL
        self.handle = self.kernel.OpenProcess(0x0410, False, pid)
        self.peak = 0
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.sample, daemon=True)
        self.thread.start()

    def read(self):
        if self.handle:
            counter = self.Counters()
            counter.cb = ctypes.sizeof(counter)
            if self.info(self.handle, ctypes.byref(counter), counter.cb):
                self.peak = max(self.peak, counter.peak)

    def sample(self):
        while not self.stopped.is_set():
            self.read()
            self.stopped.wait(0.01)

    def finish(self):
        self.stopped.set()
        self.thread.join()
        self.read()
        if self.handle:
            self.kernel.CloseHandle(self.handle)
        return self.peak or None


def measure(argv, cwd, env):
    started = time.perf_counter_ns()
    process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               shell=False, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    out, err = Capture(process.stdout), Capture(process.stderr)
    if os.name == "nt":
        memory = WindowsMemory(process.pid)
        code = process.wait()
        finished = time.perf_counter_ns()
        peak = memory.finish()
    else:
        _, status, usage = os.wait4(process.pid, 0)
        finished = time.perf_counter_ns()
        code = os.waitstatus_to_exitcode(status)
        process.returncode = code
        peak = int(usage.ru_maxrss * (1 if sys.platform == "darwin" else 1024)) or None
    for capture in (out, err):
        capture.thread.join(2)
        if capture.thread.is_alive():
            raise RuntimeError("Command left output streams open; background workloads are not supported")
        if capture.size > LIMIT:
            raise RuntimeError("Command output exceeded 4 MiB per stream")
        capture.pipe.close()
    if code != 0:
        raise RuntimeError(f"Command exited {code}: {err.tail.decode('utf-8', errors='replace')}")
    return {"elapsedMs": (finished-started)/1e6, "peakRssBytes": peak,
            "stdoutSha256": out.digest.hexdigest(), "stdoutBytes": out.size, "stderrBytes": err.size}


def main():
    raw = sys.stdin.buffer.readline(65538)
    if len(raw) > 65536:
        raise ValueError("Measurement plan exceeds 64 KiB")
    plan = json.loads(raw)
    argv, cwd, overrides = plan["argv"], plan["cwd"], plan["env"]
    if not isinstance(argv, list) or not 1 <= len(argv) <= 128 or any(not isinstance(v, str) or "\0" in v for v in argv):
        raise ValueError("Invalid process arguments")
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or not isinstance(overrides, dict):
        raise ValueError("Invalid process directory or environment")
    env = dict(os.environ)
    for key, value in overrides.items():
        if not isinstance(key, str) or "=" in key or "\0" in key or not (value is None or isinstance(value, str) and "\0" not in value):
            raise ValueError("Invalid environment override")
        if os.name == "nt":
            key = key.upper()
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    executable = shutil.which(argv[0], path=env.get("PATH")) if not os.path.dirname(argv[0]) else os.path.abspath(os.path.join(cwd, argv[0]))
    if not executable or os.name == "nt" and executable.lower().endswith((".cmd", ".bat")):
        raise ValueError("Choose a native executable, not a shell/batch command")
    executable_hash = hashlib.sha256()
    with open(executable, "rb") as binary:
        for chunk in iter(lambda: binary.read(1024*1024), b""):
            executable_hash.update(chunk)
    argv[0] = executable
    # Windows venv python.exe is a redirector spawning the real interpreter.
    # Its own working set is not the workload's memory. Do not report it as such.
    venv_launcher = os.name == "nt" and os.path.basename(executable).lower() in ("python.exe", "pythonw.exe") and os.path.isfile(os.path.join(os.path.dirname(os.path.dirname(executable)), "pyvenv.cfg"))
    samples = []
    for index in range(8):
        emit({"type": "start", "index": index, "warmup": index == 0})
        sample = measure(argv, cwd, env)
        if venv_launcher:
            sample["peakRssBytes"] = None
        if index:
            samples.append(sample)
        emit({"type": "progress", "completed": index, "total": 7})
    emit({"type": "result", "result": {"schema": 1, "warmupRuns": 1,
          **({"memoryNote": "windows-venv-launcher"} if venv_launcher else {}),
          "memoryMethod": "windows-peak-working-set" if os.name == "nt" else "wait4-maxrss",
          "environment": {"platform": platform.system(), "arch": platform.machine(), "python": platform.python_version(), "executableSha256": executable_hash.hexdigest()},
          "samples": samples}})


try:
    main()
except Exception as error:
    emit({"type": "error", "message": str(error)[:2500]})
    sys.exit(1)
