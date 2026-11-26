import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions"))

from app.db.repositories import Doc
from app.models.types import UserStatus
from app.services.entitlement import is_entitled


def test_entitlement_inactive_user():
    user = Doc("u1", {"status": UserStatus.blocked.value})
    assert not is_entitled(user)
