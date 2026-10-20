"""Fixed, opt-in workload for the pinned itsdangerous integration fixture.

Validates ten outcomes then calls want_bytes five million times. Emits only a
stable digest, so the user-facing command measurement can compare outputs.
No model-generated commands or evaluation of generated source.
"""
import hashlib
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / "src"))
from itsdangerous.encoding import want_bytes

cases = [
    ("", "utf-8", "strict"), ("hello", "utf-8", "strict"),
    ("한글", "utf-8", "strict"), ("한글", "ascii", "ignore"),
    ("한글", "ascii", "strict"), ("\ud800", "utf-8", "replace"),
    (b"", "utf-8", "strict"), (b"hello", "utf-8", "strict"),
    (b"\x00\xff", "ascii", "strict"), (bytearray(b"x"), "utf-8", "strict"),
]


def reference(value, encoding, errors):
    return value.encode(encoding, errors) if isinstance(value, str) else value


def outcome(function, args):
    try:
        value = function(*args)
        return ["value", type(value).__name__, repr(value), value is args[0]]
    except Exception as error:
        return ["error", type(error).__name__, str(error)]


actual = [outcome(want_bytes, case) for case in cases]
assert actual == [outcome(reference, case) for case in cases]
for _ in range(5_000_000):
    value = want_bytes("hello")
assert value == b"hello"
print(hashlib.sha256(json.dumps(actual, ensure_ascii=True).encode()).hexdigest())
