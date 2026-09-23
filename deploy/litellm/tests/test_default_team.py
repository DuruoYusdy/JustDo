from unittest.mock import AsyncMock, Mock

import pytest

import register
from hooks.jwt_auth import initialize


@pytest.mark.asyncio
async def test_default_team_initialization_is_insert_only_and_denies_models_by_default():
    connection = AsyncMock()
    await initialize(connection, {'LITELLM_DEFAULT_TEAM_ID': 'standard'})
    sql, team_id = connection.execute.call_args.args
    assert team_id == 'standard'
    assert 'ON CONFLICT (team_id) DO NOTHING' in sql
    assert 'UPDATE' not in sql
    assert 'jwt_managed' in sql
    assert "ARRAY[]::text[])" in sql


@pytest.mark.asyncio
async def test_empty_default_team_does_not_write_database():
    connection = AsyncMock()
    await initialize(connection, {'LITELLM_DEFAULT_TEAM_ID': ''})
    connection.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_registration_initializes_only_mandatory_and_enabled_hooks(monkeypatch):
    auth, activity, disabled = Mock(), Mock(), Mock()
    for module in (auth, activity, disabled):
        module.initialize = AsyncMock()
    loader = Mock(side_effect=lambda name: {
        'hooks.jwt_auth': auth, 'hooks.model_headers': object(),
        'hooks.activity': activity, 'hooks.example': disabled}[name])
    monkeypatch.setattr(register, 'import_module', loader)
    connection = AsyncMock()
    environment = {'LITELLM_HOOKS': 'activity'}
    await register.initialize_hooks(connection, environment)
    auth.initialize.assert_awaited_once_with(connection, environment)
    activity.initialize.assert_awaited_once_with(connection, environment)
    disabled.initialize.assert_not_awaited()


def test_optional_hook_factory_never_initializes_database(monkeypatch):
    module = Mock(wrap=Mock(return_value=AsyncMock()), initialize=AsyncMock())
    monkeypatch.setattr(register, 'import_module', Mock(return_value=module))
    register.build_app(AsyncMock(), {'LITELLM_HOOKS': 'activity'})
    module.initialize.assert_not_called()
