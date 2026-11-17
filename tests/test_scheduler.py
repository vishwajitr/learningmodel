from datetime import datetime
from pathlib import Path
import tempfile

from sensex_ai.config import Settings
from sensex_ai.scheduler import State, due_jobs


def _st():
    return State(Settings(data_dir=Path(tempfile.mkdtemp())))


def test_weekend_nothing():
    assert due_jobs(datetime(2026, 11, 14, 10, 0), _st()) == []  # Saturday


def test_before_open():
    assert due_jobs(datetime(2026, 11, 16, 8, 0), _st()) == []


def test_run_then_update_once_per_day():
    st = _st()
    d = datetime(2026, 11, 16, 9, 10)
    assert due_jobs(d, st) == ["run"]
    st.mark("run", d.date())
    assert due_jobs(d, st) == []
    late = datetime(2026, 11, 16, 19, 31)
    assert due_jobs(late, st) == ["update"]
    st.mark("update", late.date())
    assert due_jobs(late, st) == []
    assert State(Settings(data_dir=st.path.parent)).done("run", d.date())  # survives restart
