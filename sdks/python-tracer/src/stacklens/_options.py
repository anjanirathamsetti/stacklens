"""Options: the same names as the Node SDK (snake_case), from code or ``STACKLENS_*`` environment variables."""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field, fields
from typing import Any, Callable, Dict, List, Mapping, Optional, Pattern, Sequence, Union

PatternLike = Union[str, "Pattern[str]"]

DEFAULT_SERVER_PORT = 4300
INGEST_PATH = "/api/ingest"

#: Keys whose values are replaced by ``"[REDACTED]"`` unless ``redact_keys`` is set (same list as Node).
DEFAULT_REDACT_KEYS: List[PatternLike] = [
    re.compile(r"pass(word|wd)?$", re.I),
    re.compile(r"secret", re.I),
    re.compile(r"token", re.I),
    re.compile(r"^authorization$", re.I),
    re.compile(r"^cookie$", re.I),
    re.compile(r"^set-cookie$", re.I),
    re.compile(r"api[-_]?key", re.I),
    re.compile(r"^cvv$", re.I),
    re.compile(r"card(number|_number)?$", re.I),
    re.compile(r"^ssn$", re.I),
]

DEFAULT_IGNORE_PATHS: List[PatternLike] = [re.compile(r"/favicon\.ico$"), re.compile(r"^/health")]


def _env_flag(value: Optional[str]) -> Optional[bool]:
    if value is None or value == "":
        return None
    return value.lower() not in ("false", "0", "no", "off")


def _env_float(value: Optional[str]) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _default_application_name() -> str:
    """``[project] name`` from ./pyproject.toml, else the entry script / working directory name."""
    try:
        with open(os.path.join(os.getcwd(), "pyproject.toml"), encoding="utf-8") as f:
            in_project = False
            for line in f:
                s = line.strip()
                if s.startswith("["):
                    in_project = s == "[project]"
                elif in_project and s.startswith("name") and "=" in s:
                    name = s.split("=", 1)[1].strip().strip("\"'")
                    if name:
                        return name
    except OSError:
        pass
    script = os.path.basename(sys.argv[0]) if sys.argv and sys.argv[0] else ""
    if script and script not in ("-c", "-m") and not script.startswith(("pytest", "ipykernel", "uvicorn", "gunicorn", "celery", "flask", "manage.py")):
        return os.path.splitext(script)[0]
    return os.path.basename(os.getcwd()) or "python-app"


def default_get_user_id(request: Any) -> Any:
    """``request.user.id | user_id | pk | sub``, ``request.state.user``, ``scope["user"]`` or the ``x-user-id`` header."""

    def from_user(user: Any) -> Any:
        if user is None:
            return None
        if isinstance(user, (str, int)):
            return user
        if isinstance(user, Mapping):
            for k in ("id", "user_id", "userId", "pk", "sub"):
                if user.get(k) is not None:
                    return user[k]
            return None
        if getattr(user, "is_authenticated", True) is False:  # Django AnonymousUser, Starlette UnauthenticatedUser
            return None
        for k in ("id", "user_id", "pk", "sub", "identity"):
            v = getattr(user, k, None)
            if v is not None and not callable(v):
                return v
        return None

    if request is None:
        return None
    uid = None
    try:
        state = getattr(request, "state", None)
        uid = from_user(getattr(state, "user", None)) if state is not None else None
    except Exception:
        uid = None
    if uid is None:
        try:
            scope = getattr(request, "scope", None)
            if isinstance(scope, Mapping) and "user" in scope:
                uid = from_user(scope["user"])
            elif "user" in getattr(request, "__dict__", {}):
                uid = from_user(request.__dict__["user"])  # Django: set by AuthenticationMiddleware (lazy)
        except Exception:
            uid = None
    if uid is None:
        try:
            headers = getattr(request, "headers", None)
            if headers is not None:
                uid = headers.get("x-user-id")
        except Exception:
            uid = None
    return uid


@dataclass
class Options:
    """Fully resolved options. Every field has a value."""

    application: str = "python-app"
    project: str = "default"
    environment: str = "development"
    endpoint: str = f"http://localhost:{DEFAULT_SERVER_PORT}{INGEST_PATH}"
    api_key: Optional[str] = None
    enabled: bool = True
    sample_rate: float = 1.0
    capture_args: bool = True
    capture_results: bool = True
    infer_types: bool = True
    #: Attach ``logging`` records emitted inside a traced call to that span (Node: ``captureConsole``).
    capture_logging: bool = True
    max_spans_per_trace: int = 2000
    max_repeated_calls: int = 10
    max_capture_bytes: int = 1_000_000
    max_logs_per_span: int = 50
    max_depth: int = 6
    max_string_length: int = 2000
    max_array_length: int = 30
    max_object_keys: int = 50
    redact_keys: List[PatternLike] = field(default_factory=lambda: list(DEFAULT_REDACT_KEYS))
    ignore_paths: List[PatternLike] = field(default_factory=lambda: list(DEFAULT_IGNORE_PATHS))
    ignore_methods: List[PatternLike] = field(default_factory=list)
    capture_outbound: bool = True
    propagate: bool = True
    #: ``None`` = propagate to every host.
    propagate_to: Optional[List[PatternLike]] = None
    #: Ms to wait after a trace finishes before exporting it (lets fire-and-forget tasks settle).
    settle_ms: float = 30
    #: Print exporter errors (once until the next success).
    debug: bool = True
    get_user_id: Callable[[Any], Any] = default_get_user_id
    #: Custom exporter (called with each finished trace as a dict); overrides the HTTP exporter.
    exporter: Optional[Callable[[Dict[str, Any]], None]] = None
    #: Exporter batching: send when this many traces are queued, or this long after the first one.
    batch_size: int = 25
    flush_interval_ms: float = 250


OPTION_NAMES = {f.name for f in fields(Options)}

# camelCase spellings from the Node SDK / shared configs are accepted too
_CAMEL = {
    "serviceName": "service_name",
    "apiKey": "api_key",
    "sampleRate": "sample_rate",
    "captureArgs": "capture_args",
    "captureResults": "capture_results",
    "inferTypes": "infer_types",
    "captureConsole": "capture_logging",
    "capture_console": "capture_logging",
    "maxSpansPerTrace": "max_spans_per_trace",
    "maxRepeatedCalls": "max_repeated_calls",
    "maxCaptureBytes": "max_capture_bytes",
    "maxLogsPerSpan": "max_logs_per_span",
    "maxDepth": "max_depth",
    "maxStringLength": "max_string_length",
    "maxArrayLength": "max_array_length",
    "maxObjectKeys": "max_object_keys",
    "redactKeys": "redact_keys",
    "ignorePaths": "ignore_paths",
    "ignoreMethods": "ignore_methods",
    "captureOutbound": "capture_outbound",
    "propagateTo": "propagate_to",
    "settleMs": "settle_ms",
    "getUserId": "get_user_id",
}


def normalize_keys(given: Mapping[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in given.items():
        key = _CAMEL.get(k, k)
        if key != "service_name" and key not in OPTION_NAMES:
            raise TypeError(f"stacklens.init() got an unknown option {k!r}")
        out[key] = v
    return out


def resolve_options(given: Mapping[str, Any], env: Optional[Mapping[str, str]] = None, base: Optional[Options] = None) -> Options:
    """Merge explicit options over ``base`` (a previous init) over environment variables over defaults."""
    env = os.environ if env is None else env
    o = normalize_keys(given)
    if "service_name" in o:
        o.setdefault("application", o.pop("service_name"))
        o.pop("service_name", None)
    if base is not None:
        merged = {f.name: getattr(base, f.name) for f in fields(Options)}
        merged.update({k: v for k, v in o.items() if v is not None})
        return Options(**merged)

    def pick(name: str, *env_names: str, conv: Callable[[Optional[str]], Any] = lambda v: v or None) -> Any:
        if o.get(name) is not None:
            return o[name]
        for e in env_names:
            v = conv(env.get(e))
            if v is not None:
                return v
        return None

    resolved: Dict[str, Any] = {k: v for k, v in o.items() if v is not None}
    resolved["application"] = pick("application", "STACKLENS_APP", "STACKLENS_SERVICE") or _default_application_name()
    resolved["project"] = pick("project", "STACKLENS_PROJECT") or "default"
    resolved["environment"] = pick("environment", "STACKLENS_ENV", "PYTHON_ENV", "APP_ENV") or "development"
    resolved["endpoint"] = pick("endpoint", "STACKLENS_ENDPOINT") or Options.endpoint
    resolved["api_key"] = pick("api_key", "STACKLENS_API_KEY")
    for name, env_name in (("enabled", "STACKLENS_ENABLED"), ("capture_outbound", "STACKLENS_CAPTURE_OUTBOUND"), ("propagate", "STACKLENS_PROPAGATE"), ("debug", "STACKLENS_DEBUG")):
        v = pick(name, env_name, conv=_env_flag)
        if v is not None:
            resolved[name] = v
    rate = pick("sample_rate", "STACKLENS_SAMPLE_RATE", conv=_env_float)
    if rate is not None:
        resolved["sample_rate"] = rate
    for list_name in ("redact_keys", "ignore_paths", "ignore_methods", "propagate_to"):
        if list_name in resolved and not isinstance(resolved[list_name], list):
            resolved[list_name] = list(resolved[list_name])
    return Options(**resolved)


def matcher(patterns: Sequence[PatternLike]) -> Callable[[str], bool]:
    """Case-insensitive exact match for strings, ``.search()`` for compiled patterns."""
    lowered = {p.lower() for p in patterns if isinstance(p, str)}
    regexes = [p for p in patterns if not isinstance(p, str)]

    def match(s: str) -> bool:
        if s.lower() in lowered:
            return True
        return any(r.search(s) for r in regexes)

    return match


def cached_matcher(patterns: Sequence[PatternLike], max_entries: int = 5000) -> Callable[[str], bool]:
    """``matcher()`` memoised per key: object keys repeat constantly (``id``, ``status``…)."""
    base = matcher(patterns)
    cache: Dict[str, bool] = {}

    def match(s: str) -> bool:
        v = cache.get(s)
        if v is None:
            v = base(s)
            if len(cache) >= max_entries:
                cache.clear()
            cache[s] = v
        return v

    return match


def host_matcher(patterns: Optional[Sequence[PatternLike]]) -> Callable[[str, str], bool]:
    """Hosts (exact, ``host:port``, or ``.suffix`` for subdomains) or patterns tested against hostname and host."""
    if patterns is None:
        return lambda hostname, host: True

    def match(hostname: str, host: str) -> bool:
        hostname, host = hostname.lower(), host.lower()
        for p in patterns:
            if isinstance(p, str):
                want = p.lower()
                if want.startswith("."):
                    if hostname.endswith(want) or hostname == want[1:]:
                        return True
                elif want in (hostname, host):
                    return True
            elif p.search(host) or p.search(hostname):
                return True
        return False

    return match
