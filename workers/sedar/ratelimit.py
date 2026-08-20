"""Token bucket + challenge circuit breaker for SEDAR+ requests."""

from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass, field


class ChallengeDetected(RuntimeError):
    """Radware (or similar) challenged the session. Pause and solve headful."""


class CircuitOpen(RuntimeError):
    """Too many challenges in one run; abort rather than hammer the site."""


@dataclass
class RateLimiter:
    min_seconds: float = 4.0
    max_seconds: float = 8.0
    max_challenges: int = 3
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _next_allowed: float = 0.0
    challenges: int = 0

    def wait(self) -> None:
        delay = random.uniform(self.min_seconds, self.max_seconds)
        with self._lock:
            now = time.monotonic()
            if now < self._next_allowed:
                time.sleep(self._next_allowed - now)
            self._next_allowed = time.monotonic() + delay

    def record_challenge(self) -> None:
        self.challenges += 1
        if self.challenges >= self.max_challenges:
            raise CircuitOpen(
                f"{self.challenges} Radware challenges in this run; stopping"
            )
