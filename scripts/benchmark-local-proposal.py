"""Measure the explicitly reviewed itsdangerous proposal, never arbitrary model code.

Developer-only fixture benchmark. The allowed rewrite is fixed below. No source files
are modified. This is not a general-purpose user-code execution sandbox.
"""
import ast
import hashlib
import json
import platform
import statistics
import timeit
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source_path = root / "test-results/projects/itsdangerous/src/itsdangerous/encoding.py"
report = json.loads((root / "test-results/local-project-report.json").read_text(encoding="utf-8"))
original = source_path.read_bytes().decode("utf-8")
digest = lambda value: hashlib.sha256(value.encode("utf-8")).hexdigest()
assert report["commit"] == "096c8d42545d3b68ea21a4f890fb2b2d8979c0bd"
assert digest(original) == report["sourceSha256"]
edits = report["proposal"]["edits"]
assert len(edits) == 1
edit = edits[0]
assert edit["before"] == "s = s.encode(encoding, errors)"
assert edit["after"] in {
    "return s if isinstance(s, bytes) else s.encode(encoding, errors)",
    "return s.encode(encoding, errors) if isinstance(s, str) else s",
    "return s.encode(encoding, errors)",
}, "Unreviewed proposal: inspect it before changing this developer benchmark."
assert original.count(edit["before"]) == 1
candidate = original.replace(edit["before"], edit["after"], 1)
assert digest(candidate) == report["candidateSha256"]


def function(source):
    node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == "want_bytes")
    namespace = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "reviewed-want-bytes", "exec"), namespace)
    return namespace["want_bytes"]


before, after = function(original), function(candidate)
cases = [
    ("", "utf-8", "strict"), ("hello", "utf-8", "strict"),
    ("한글", "utf-8", "strict"), ("한글", "ascii", "ignore"),
    ("한글", "ascii", "strict"), ("\ud800", "utf-8", "replace"),
    (b"", "utf-8", "strict"), (b"hello", "utf-8", "strict"),
    (b"\x00\xff", "ascii", "strict"), (bytearray(b"x"), "utf-8", "strict"),
]


def outcome(fn, args):
    try:
        result = fn(*args)
        return ("value", type(result), result, result is args[0])
    except Exception as exc:
        return ("error", type(exc), str(exc))


for case in cases:
    assert outcome(before, case) == outcome(after, case), repr(case)

rounds, calls = 15, 100_000
measurements = []
for name, value in [("small_text", "hello"), ("unicode_text", "배송비 계산"), ("bytes_identity", b"hello")]:
    timings = {"before": [], "after": []}
    timers = {"before": timeit.Timer(lambda: before(value)), "after": timeit.Timer(lambda: after(value))}
    for timer in timers.values():
        timer.timeit(10_000)
    for round_index in range(rounds):
        order = ("before", "after") if round_index % 2 == 0 else ("after", "before")
        for phase in order:
            timings[phase].append(timers[phase].timeit(calls) * 1e9 / calls)
    baseline, changed = (statistics.median(timings[phase]) for phase in ("before", "after"))
    measurements.append({"case": name, "before_median_ns": round(baseline, 2), "after_median_ns": round(changed, 2),
                         "after_over_before": round(changed / baseline, 4), "raw_ns": timings})

result = {
    "measuredAt": datetime.now(timezone.utc).isoformat(), "python": platform.python_version(), "os": platform.system(),
    "project": report["project"], "commit": report["commit"], "file": report["file"], "function": "want_bytes",
    "sourceSha256": digest(original), "candidateSha256": digest(candidate), "model": report["proposal"]["model"],
    "modelDigest": report["proposal"]["digest"], "equivalenceCasesPassed": len(cases), "rounds": rounds,
    "callsPerRound": calls, "order": "paired, alternating order; 10000 warmup calls; same process",
    "measurements": measurements, "adopted": False,
    "caveat": "One reviewed function on this machine. Includes Python call overhead; excludes model latency and full application cost. No general speedup or optimization-quality claim. Original fixture remains unchanged.",
}
destination = root / "test-results/local-optimization-benchmark.json"
destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({"equivalenceCasesPassed": len(cases), "measurements": [{k: v for k, v in m.items() if k != "raw_ns"} for m in measurements], "adopted": False}))
