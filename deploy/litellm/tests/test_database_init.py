"""Migrations must be explicit, versioned, and stop before extension DDL on failure."""
import importlib.util
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest


def load_initializer():
    path = Path(__file__).resolve().parents[1] / 'start.py'
    spec = importlib.util.spec_from_file_location('test_database_initializer', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('success', [True, False])
def test_extension_ddl_runs_only_after_successful_versioned_migrations(monkeypatch, success):
    from litellm.proxy.db.prisma_client import PrismaManager

    initializer = load_initializer()
    migrate = Mock(return_value=success)
    add_column = AsyncMock()
    monkeypatch.setattr(PrismaManager, 'setup_database', migrate)
    monkeypatch.setattr(initializer, 'initialize_extensions', add_column)
    if success:
        initializer.initialize_database()
        add_column.assert_awaited_once()
    else:
        with pytest.raises(SystemExit):
            initializer.initialize_database()
        add_column.assert_not_awaited()
    migrate.assert_called_once_with(use_migrate=True, use_v2_resolver=True)


def test_activity_schema_leaves_transaction_control_to_initializer():
    schema = (Path(__file__).resolve().parents[1] / 'hooks/activity/schema.sql').read_text()
    assert not re.search(r'\b(BEGIN|COMMIT|ROLLBACK)\b', schema, re.IGNORECASE)
    assert 'SET LOCAL lock_timeout' in schema


@pytest.mark.asyncio
async def test_hook_failure_exits_transaction_with_error_and_closes_connection(monkeypatch):
    initializer = load_initializer()
    connection = Mock()
    transaction = AsyncMock()
    transaction.__aexit__.return_value = False
    connection.transaction.return_value = transaction
    connection.close = AsyncMock()
    monkeypatch.setitem(sys.modules, 'asyncpg', SimpleNamespace(connect=AsyncMock(return_value=connection)))
    monkeypatch.setenv('LITELLM_ACTIVITY_DATABASE_URL', 'postgresql://localhost/test')
    failure = RuntimeError('Hook initialization failed')
    monkeypatch.setattr(initializer, 'initialize_hooks', AsyncMock(side_effect=failure))
    with pytest.raises(RuntimeError, match='Hook initialization failed'):
        await initializer.initialize_extensions()
    transaction.__aenter__.assert_awaited_once()
    assert transaction.__aexit__.await_args.args[:2] == (RuntimeError, failure)
    connection.close.assert_awaited_once()
