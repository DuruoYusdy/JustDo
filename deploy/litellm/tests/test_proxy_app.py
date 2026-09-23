import importlib
from pathlib import Path

import pytest
import yaml

from hooks.jwt_auth import dispatch as auth_dispatch
import start as proxy_app


def test_single_instance_factory_installs_auth_and_activity_without_connecting_database(monkeypatch):
    module = importlib.import_module('litellm.proxy.auth.user_api_key_auth')
    monkeypatch.setattr(module, 'enterprise_custom_auth', None)
    monkeypatch.setenv('CONFIG_FILE_PATH', str(Path(__file__).resolve().parents[1] / 'native' / 'config.yaml'))
    monkeypatch.setenv('LITELLM_ACTIVITY_DATABASE_URL', 'postgresql://localhost/test-not-connected')
    monkeypatch.setenv('DATABASE_URL', 'postgresql://localhost/test-not-connected')
    monkeypatch.setenv('LITELLM_HOOKS', 'activity')
    monkeypatch.setenv('DISABLE_SCHEMA_UPDATE', 'true')
    app = proxy_app.create_app()
    assert module.enterprise_custom_auth is auth_dispatch.dispatch
    assert app.app.store.pool is None
    assert app.app.authenticate is not None


@pytest.mark.parametrize('field,value', [
    ('custom_auth_run_common_checks', False), ('custom_auth', None),
    ('disable_prisma_schema_update', False),
])
def test_startup_rejects_configuration_that_disables_security_or_schema_protection(monkeypatch, tmp_path, field, value):
    monkeypatch.setenv('DATABASE_URL', 'postgresql://localhost/test-not-connected')
    config = yaml.safe_load((Path(__file__).resolve().parents[1] / 'native' / 'config.yaml').read_text())
    config['general_settings'][field] = value
    path = tmp_path / 'config.yaml'
    path.write_text(yaml.safe_dump(config))
    monkeypatch.setenv('CONFIG_FILE_PATH', str(path))
    with pytest.raises(ValueError):
        proxy_app.create_app()


def test_pool_parameters_override_existing_values_without_changing_activity_url():
    from urllib.parse import parse_qs, urlsplit

    settings = {'database_url': 'os.environ/DATABASE_URL',
                'database_connection_pool_limit': 4, 'database_connection_timeout': 30}
    environment = {
        'DATABASE_URL': 'postgresql://user:p%40ss@localhost/db?schema=public&sslmode=require&connection_limit=90&connection_limit=80&pool_timeout=5',
        'LITELLM_ACTIVITY_DATABASE_URL': 'postgresql://localhost/db',
    }

    proxy_app.configure_database(settings, environment)
    first = environment['DATABASE_URL']
    proxy_app.configure_database(settings, environment)

    assert environment['DATABASE_URL'] == first
    parsed = urlsplit(first)
    assert parsed.netloc == 'user:p%40ss@localhost'
    assert parse_qs(parsed.query) == {
        'schema': ['public'], 'sslmode': ['require'],
        'connection_limit': ['4'], 'pool_timeout': ['30'],
    }
    assert environment['LITELLM_ACTIVITY_DATABASE_URL'] == 'postgresql://localhost/db'


@pytest.mark.parametrize('field', ['database_connection_pool_limit', 'database_connection_timeout'])
@pytest.mark.parametrize('value', [0, -1, True, '4', 1.5])
def test_invalid_pool_settings_fail_without_revealing_credentials(field, value):
    environment = {'DATABASE_URL': 'postgresql://user:secret@localhost/db'}
    with pytest.raises(ValueError) as error:
        proxy_app.configure_database({'database_url': 'os.environ/DATABASE_URL', field: value}, environment)
    assert 'secret' not in str(error.value)


@pytest.mark.parametrize('url', ['', 'https://user:secret@host/db', 'postgresql://[secret/db'])
def test_invalid_database_url_fails_without_revealing_credentials(url):
    with pytest.raises(ValueError) as error:
        proxy_app.configure_database({'database_url': 'os.environ/DATABASE_URL'}, {'DATABASE_URL': url})
    assert 'secret' not in str(error.value)
