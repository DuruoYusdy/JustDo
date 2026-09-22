import importlib
from pathlib import Path

import pytest
import yaml

import auth_dispatch
import proxy_app


def test_single_instance_factory_installs_auth_and_activity_without_connecting_database(monkeypatch):
    module = importlib.import_module('litellm.proxy.auth.user_api_key_auth')
    monkeypatch.setattr(module, 'enterprise_custom_auth', None)
    monkeypatch.setenv('CONFIG_FILE_PATH', str(Path(__file__).parent / 'native' / 'config.yaml'))
    monkeypatch.setenv('LITELLM_ACTIVITY_DATABASE_URL', 'postgresql://localhost/test-not-connected')
    monkeypatch.setenv('LITELLM_HOOKS', 'activity')
    monkeypatch.setenv('DISABLE_SCHEMA_UPDATE', 'true')
    app = proxy_app.create_app()
    assert module.enterprise_custom_auth is auth_dispatch.dispatch
    assert app.store.pool is None
    assert app.authenticate is not None


@pytest.mark.parametrize('field,value', [
    ('custom_auth_run_common_checks', False), ('custom_auth', None),
    ('disable_prisma_schema_update', False),
])
def test_startup_rejects_configuration_that_disables_security_or_schema_protection(monkeypatch, tmp_path, field, value):
    config = yaml.safe_load((Path(__file__).parent / 'native' / 'config.yaml').read_text())
    config['general_settings'][field] = value
    path = tmp_path / 'config.yaml'
    path.write_text(yaml.safe_dump(config))
    monkeypatch.setenv('CONFIG_FILE_PATH', str(path))
    with pytest.raises(ValueError):
        proxy_app.create_app()
