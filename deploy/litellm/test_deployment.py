"""Single-instance deployment invariants."""
from pathlib import Path
import yaml

ROOT = Path(__file__).parent


def test_compose_exposes_exactly_one_litellm_service():
    services = yaml.safe_load((ROOT / 'docker/docker-compose.yml').read_text())['services']
    assert set(services) == {'litellm', 'db', 'redis'}
    service = services['litellm']
    assert service['ports'] == ['${LITELLM_PORT:-9108}:4000']
    assert service['depends_on']['redis']['condition'] == 'service_healthy'
    assert 'LITELLM_JWT_ISSUER' in service['environment']
    assert 'LITELLM_ACTIVITY_TOKEN' in service['environment']
    assert 'ports' not in services['db']
    assert 'ports' not in services['redis']
    assert service['ulimits']['nofile']['soft'] >= 16384


def test_both_deployment_methods_use_one_config_and_the_same_authorization():
    for name in ('docker', 'native'):
        directory = ROOT / name
        assert sorted(p.name for p in directory.glob('config*.yaml')) == ['config.yaml']
        assert not (directory / 'nginx.conf').exists()
        settings = yaml.safe_load((directory / 'config.yaml').read_text())['general_settings']
        assert settings['disable_prisma_schema_update'] is True
        assert settings['custom_auth_run_common_checks'] is True
        assert settings['custom_auth'] == 'custom_auth.user_api_key_auth'
    assert 'COPY shared/auth_dispatch.py' in (ROOT / 'docker/Dockerfile').read_text()


def test_mounts_and_service_paths_exist():
    services = yaml.safe_load((ROOT / 'docker/docker-compose.yml').read_text())['services']
    for service in services.values():
        for mount in service.get('volumes', []):
            source = mount.split(':', 1)[0]
            if source.startswith('.'):
                assert (ROOT / 'docker' / source).is_file()
    unit = (ROOT / 'native/litellm.service').read_text()
    assert 'User=litellm' in unit
    assert 'start.py %i' not in unit
    assert 'LimitNOFILE=16384' in unit
