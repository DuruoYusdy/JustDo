"""Validate deployment defaults against the installed LiteLLM runtime."""

from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('deployment', ['docker', 'native'])
def test_router_resolves_long_running_request_defaults(monkeypatch, deployment):
    monkeypatch.setenv('LITELLM_LOCAL_MODEL_COST_MAP', 'True')

    import litellm

    config = yaml.safe_load((ROOT / deployment / 'config.yaml').read_text())
    monkeypatch.setattr(litellm, 'request_timeout', config['litellm_settings']['request_timeout'])
    monkeypatch.setattr(litellm, 'request_timeout_explicitly_set', True)

    # No deployments or Redis: resolving these defaults needs no external service.
    router = litellm.Router(model_list=[], **config['router_settings'])

    assert router.timeout == 1800
    assert router._get_timeout(kwargs={}, data={}) == 1800
    assert router._get_timeout(kwargs={'stream': True}, data={}) == 1800
    assert router.num_retries == 2


@pytest.mark.parametrize('deployment', ['docker', 'native'])
def test_failed_requests_are_not_excluded_from_database_logging(monkeypatch, deployment):
    from litellm.proxy import proxy_server
    from litellm.proxy.hooks.proxy_track_cost_callback import _ProxyDBLogger

    config = yaml.safe_load((ROOT / deployment / 'config.yaml').read_text())
    monkeypatch.setattr(proxy_server, 'general_settings', config['general_settings'])

    # LiteLLM skips failures only when this predicate returns exactly False.
    assert _ProxyDBLogger._should_track_errors_in_db() is not False

    monkeypatch.setattr(proxy_server, 'general_settings', {'disable_error_logs': True})
    assert _ProxyDBLogger._should_track_errors_in_db() is False
