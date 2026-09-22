"""Native launcher invariants, without contacting a real database or issuer."""

import importlib.util
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


def load_script(name):
    path = Path(__file__).parent / 'native' / f'{name}.py'
    spec = importlib.util.spec_from_file_location(f'native_{name}', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def launcher(tmp_path, monkeypatch):
    module = load_script('start')
    monkeypatch.setattr(module, 'ROOT', tmp_path)
    (tmp_path / '.env').write_text(
        'DATABASE_URL=postgresql://user:secret@localhost/db\n'
        'LITELLM_MASTER_KEY=master-secret\nLITELLM_SALT_KEY=salt-secret\n'
        'REDIS_HOST=localhost\nREDIS_PORT=6379\nREDIS_PASSWORD=literal${DOLLAR}\n'
        'LITELLM_JWT_ISSUER=https://login.test\nLITELLM_JWT_AUDIENCE=audience\n'
        'LITELLM_JWT_JWKS_URL=https://login.test/jwks\n'
        'LITELLM_ACTIVITY_DATABASE_URL=postgresql://user:secret@localhost/db\n'
    )
    return module


def test_launch_uses_venv_tools_loopback_and_literal_secrets(launcher):
    command, environment = launcher.build_launch('serve', {'PATH': 'system-bin', 'REDIS_PASSWORD': 'wrong'})
    assert environment['PATH'].split(os.pathsep)[0] == str(Path(launcher.sys.executable).parent)
    assert environment['REDIS_PASSWORD'] == 'literal${DOLLAR}'
    assert command[command.index('--host') + 1] == '127.0.0.1'
    assert command[command.index('--port') + 1] == '9108'
    assert command[command.index('--workers') + 1] == '4'
    assert 'secret' not in ' '.join(command)
    assert 'proxy_app:create_app' in command
    assert environment['DISABLE_SCHEMA_UPDATE'] == 'true'


def test_unknown_plane_is_rejected(launcher):
    with pytest.raises(ValueError, match='Unknown launch mode'):
        launcher.build_launch('typo')


def test_missing_configuration_is_rejected_without_values(launcher):
    (launcher.ROOT / '.env').write_text('DATABASE_URL=postgresql://secret@localhost/db\n')
    with pytest.raises(ValueError) as error:
        launcher.build_launch('serve', {})
    assert 'secret' not in str(error.value)


def test_installation_provides_venv_generator_executables(tmp_path, monkeypatch):
    installer = load_script('install')
    monkeypatch.setattr(installer, 'ROOT', tmp_path)
    monkeypatch.setattr(installer.sys, 'version_info', (3, 12))
    builder = Mock()
    monkeypatch.setattr(installer.venv, 'EnvBuilder', Mock(return_value=builder))
    runner = Mock()
    monkeypatch.setattr(installer.subprocess, 'run', runner)
    installer.main()
    assert runner.call_count == 2
    expected = tmp_path / '.venv' / ('Scripts' if os.name == 'nt' else 'bin')
    for call in runner.call_args_list:
        assert call.kwargs['env']['PATH'].split(os.pathsep)[0] == str(expected)
        assert call.kwargs['check'] is True


def test_explicit_init_runs_migrations_separately_from_workers(launcher):
    command, environment = launcher.build_launch('init', {})
    assert command[-1].endswith('init_database.py')
    assert 'uvicorn' not in command
    assert environment['LITELLM_ACTIVITY_DATABASE_URL'].startswith('postgresql:')


def test_launcher_executes_without_logging_environment(launcher, monkeypatch):
    monkeypatch.setattr(launcher.sys, 'argv', ['start.py'])
    execute = Mock()
    monkeypatch.setattr(launcher.os, 'execve', execute)
    launcher.main()
    execute.assert_called_once()


def test_old_environment_prefix_is_supported_without_overriding_new_names(launcher):
    path = launcher.ROOT / '.env'
    path.write_text(path.read_text().replace('LITELLM_JWT_', 'JUSTDO_JWT_') +
                    'JUSTDO_DEFAULT_TEAM_ID=old-team\nLITELLM_DEFAULT_TEAM_ID=\n')
    _, environment = launcher.build_launch('serve', {})
    assert environment['LITELLM_JWT_AUDIENCE'] == 'audience'
    assert environment['LITELLM_DEFAULT_TEAM_ID'] == ''
