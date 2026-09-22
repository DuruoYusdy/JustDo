"""Migrations must be explicit, versioned, and stop before extension DDL on failure."""
import importlib.util
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest


def load_initializer():
    path = Path(__file__).parent / 'shared' / 'init_database.py'
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
    monkeypatch.setattr(initializer, 'add_activity_column', add_column)
    if success:
        initializer.main()
        add_column.assert_awaited_once()
    else:
        with pytest.raises(SystemExit):
            initializer.main()
        add_column.assert_not_awaited()
    migrate.assert_called_once_with(use_migrate=True, use_v2_resolver=True)
