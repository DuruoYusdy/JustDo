from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from litellm.proxy._types import ProxyException

from hooks.jwt_auth.handler import provision_first_login


class Transaction:
    def __init__(self, team=None, created=True):
        self.query_raw = AsyncMock(side_effect=[
            [team] if team is not None else [],
            [{"user_id": "new-user"}] if created else [],
        ])
        self.execute_raw = AsyncMock()
        self.error = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, kind, error, traceback):
        self.error = error


def fixture(existing=None, **overrides):
    team = {"metadata": {"jwt_managed": True}, "blocked": False,
            "models": ["allowed-model"], "members_with_roles": []}
    team.update(overrides)
    tx = Transaction(team)
    db = SimpleNamespace(litellm_usertable=SimpleNamespace(
        find_unique=AsyncMock(return_value=existing)), tx=lambda: tx)
    return db, tx


@pytest.mark.asyncio
async def test_new_user_is_enrolled_without_creating_a_key():
    db, tx = fixture()
    await provision_first_login(db, 'new-user', 'default-team')
    assert tx.query_raw.await_count == 2
    assert tx.execute_raw.await_count == 2
    assert tx.query_raw.call_args.args[1:] == ('new-user', 'default-team')
    assert 'ON CONFLICT' in tx.query_raw.call_args.args[0]
    assert 'new-user' in tx.execute_raw.call_args.args[2]


@pytest.mark.asyncio
@pytest.mark.parametrize('existing', [{"teams": []}, {"teams": ["special-team"]}])
async def test_existing_removed_or_reassigned_users_are_never_reenrolled(existing):
    db, tx = fixture(existing)
    await provision_first_login(db, 'new-user', 'default-team')
    tx.query_raw.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('overrides', [
    {"blocked": True}, {"models": []}, {"metadata": {}},
    {"metadata": {"jwt_managed": True, "legacy_clients": True}},
])
async def test_invalid_default_team_fails_before_user_creation(overrides):
    db, tx = fixture(**overrides)
    with pytest.raises(ProxyException):
        await provision_first_login(db, 'new-user', 'default-team')
    assert tx.query_raw.await_count == 1
    tx.execute_raw.assert_not_awaited()


@pytest.mark.asyncio
async def test_concurrent_user_creation_does_not_overwrite_membership():
    db, tx = fixture()
    tx.query_raw.side_effect = [[{"metadata": {"jwt_managed": True},
        "blocked": False, "models": ["model"]}], []]
    await provision_first_login(db, 'new-user', 'default-team')
    tx.execute_raw.assert_not_awaited()


@pytest.mark.asyncio
async def test_enrollment_can_be_disabled():
    db, tx = fixture()
    await provision_first_login(db, 'new-user', '')
    tx.query_raw.assert_not_awaited()


@pytest.mark.asyncio
async def test_membership_failure_propagates_outside_transaction():
    db, tx = fixture()
    tx.execute_raw.side_effect = RuntimeError('database unavailable')
    with pytest.raises(RuntimeError):
        await provision_first_login(db, 'new-user', 'default-team')
    assert isinstance(tx.error, RuntimeError)


@pytest.mark.asyncio
async def test_default_member_budget_and_models_are_inherited_atomically():
    db, tx = fixture(
        metadata={"jwt_managed": True, "team_member_budget_id": "template"},
        default_team_member_models=["allowed-model"],
    )
    tx.litellm_budgettable = SimpleNamespace(find_unique=AsyncMock(return_value=SimpleNamespace(
        max_budget=12, rpm_limit=3, tpm_limit=100, budget_duration="1d",
        allowed_models=["old-model"], model_max_budget={"allowed-model": 5},
    )))
    await provision_first_login(db, 'new-user', 'default-team')
    budget_args = tx.execute_raw.call_args_list[0].args
    membership_args = tx.execute_raw.call_args_list[1].args
    assert 'LiteLLM_BudgetTable' in budget_args[0]
    assert budget_args[2] == 12
    assert budget_args[5:7] == (100, 3)
    assert budget_args[10] == ['allowed-model']
    assert budget_args[9] is not None  # fresh member budget reset window
    assert membership_args[3] == budget_args[1]


@pytest.mark.asyncio
async def test_missing_default_member_budget_rolls_back_enrollment():
    db, tx = fixture(metadata={"jwt_managed": True, "team_member_budget_id": "missing"})
    tx.litellm_budgettable = SimpleNamespace(find_unique=AsyncMock(return_value=None))
    with pytest.raises(ProxyException, match='member budget is invalid or unavailable'):
        await provision_first_login(db, 'new-user', 'default-team')
    tx.execute_raw.assert_not_awaited()
    assert isinstance(tx.error, ProxyException)


@pytest.mark.asyncio
async def test_default_member_models_alone_create_a_membership_policy():
    db, tx = fixture(default_team_member_models=['allowed-model'])
    await provision_first_login(db, 'new-user', 'default-team')
    assert tx.execute_raw.call_args_list[0].args[10] == ['allowed-model']


@pytest.mark.asyncio
async def test_invalid_roster_fails_closed_inside_transaction():
    db, tx = fixture(members_with_roles=['invalid'])
    with pytest.raises(ProxyException, match='roster is invalid'):
        await provision_first_login(db, 'new-user', 'default-team')
    assert isinstance(tx.error, ProxyException)
