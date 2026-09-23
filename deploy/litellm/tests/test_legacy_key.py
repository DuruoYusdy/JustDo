from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import Mock
import threading
import sys
import pytest

from hooks.jwt_auth import legacy_key
from hooks.jwt_auth.legacy_key import LegacyClientSpec, LiteLLMAdminClient, _hash_token


def legacy_spec():
    return LegacyClientSpec("legacy", "legacy-key")


def test_master_key_cannot_be_registered_as_legacy():
    client = LiteLLMAdminClient('http://localhost', 'sk-master-secret')
    client.request = Mock()
    with pytest.raises(ValueError, match='master key'):
        client.ensure_legacy_virtual_key(legacy_spec(), 'sk-master-secret')
    client.request.assert_not_called()


def test_registration_uses_existing_ui_team_without_mutating_members(monkeypatch):
    monkeypatch.setenv('LITELLM_MASTER_KEY', 'sk-master-secret')
    monkeypatch.setenv('LITELLM_LEGACY_KEY', 'sk-old-client')
    monkeypatch.setattr(sys, 'argv', ['legacy_key', '--team-id', 'legacy'])
    client = Mock()
    client.get_team.return_value = {'team_info': {
        'metadata': {'legacy_clients': True}, 'models': ['model-a'], 'blocked': False}}
    monkeypatch.setattr(legacy_key, 'LiteLLMAdminClient', Mock(return_value=client))
    assert legacy_key.main() == 0
    assert [call[0] for call in client.method_calls] == ['get_team', 'ensure_legacy_virtual_key']


@pytest.mark.parametrize('team', [None, {'models': ['model-a']},
    {'metadata': {'legacy_clients': True}, 'models': []},
    {'metadata': {'legacy_clients': True}, 'models': ['model-a'], 'blocked': True}])
def test_registration_rejects_missing_unmarked_or_disabled_team(monkeypatch, team):
    monkeypatch.setenv('LITELLM_MASTER_KEY', 'sk-master-secret')
    monkeypatch.setenv('LITELLM_LEGACY_KEY', 'sk-old-client')
    monkeypatch.setattr(sys, 'argv', ['legacy_key', '--team-id', 'legacy'])
    client = Mock()
    client.get_team.return_value = team
    monkeypatch.setattr(legacy_key, 'LiteLLMAdminClient', Mock(return_value=client))
    assert legacy_key.main() == 1
    client.ensure_legacy_virtual_key.assert_not_called()


def test_admin_client_does_not_forward_master_key_across_redirects():
    visited = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            visited.append(self.path)
            self.send_response(302)
            self.send_header("Location", "/redirect-target")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = LiteLLMAdminClient(f"http://127.0.0.1:{server.server_port}", "test-secret")
        with pytest.raises(legacy_key.LiteLLMApiError) as error:
            client.request("GET", "/team/info")
        assert error.value.status == 302
        assert visited == ["/team/info"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_legacy_virtual_key_is_the_only_generated_key_and_expires_in_30_days():
    client = LiteLLMAdminClient("http://litellm.test", "server-master-key")
    client._get_single_key = Mock(return_value=None)
    client.request = Mock(return_value={})

    client.ensure_legacy_virtual_key(legacy_spec(), "sk-old-client-key")

    client.request.assert_called_once_with(
        "POST",
        "/key/generate",
        {
            "key": "sk-old-client-key",
            "key_alias": "legacy-key",
            "team_id": "legacy",
            "models": ["all-team-models"],
            "allowed_routes": ["llm_api_routes", "/models", "/v1/models"],
            "duration": "30d",
            "metadata": {
                "jwt_managed": True,
                "legacy_clients": True,
                "legacy_expires_after": "30d",
            },
        },
    )


def test_existing_legacy_key_without_expiry_gets_one_but_is_not_rotated():
    client = LiteLLMAdminClient("http://litellm.test", "server-master-key")
    old_key = "sk-old-client-key"
    client._get_single_key = Mock(
        return_value={
            "token": _hash_token(old_key),
            "expires": None,
            "metadata": {"existing": True},
        }
    )
    client.request = Mock(return_value={})

    client.ensure_legacy_virtual_key(legacy_spec(), old_key)

    payload = client.request.call_args.args[2]
    assert payload["duration"] == "30d"
    assert payload["allowed_routes"] == ["llm_api_routes", "/models", "/v1/models"]
    assert payload["metadata"]["existing"] is True
    assert "key" not in payload


def test_existing_legacy_key_with_valid_expiry_is_never_extended():
    client = LiteLLMAdminClient("http://litellm.test", "server-master-key")
    old_key = "sk-old-client-key"
    client._get_single_key = Mock(
        return_value={
            "token": _hash_token(old_key),
            "expires": (datetime.now(timezone.utc) + timedelta(days=20)).isoformat(),
            "metadata": {},
        }
    )
    client.request = Mock(return_value={})

    client.ensure_legacy_virtual_key(legacy_spec(), old_key)

    assert "duration" not in client.request.call_args.args[2]


@pytest.mark.parametrize(
    ("expiry", "message"),
    [
        (timedelta(minutes=-1), "already expired"),
        (timedelta(days=31), "exceeds the 30-day"),
    ],
)
def test_existing_legacy_key_cannot_be_renewed_beyond_the_window(expiry, message):
    client = LiteLLMAdminClient("http://litellm.test", "server-master-key")
    old_key = "sk-old-client-key"
    client._get_single_key = Mock(
        return_value={
            "token": _hash_token(old_key),
            "expires": (datetime.now(timezone.utc) + expiry).isoformat(),
        }
    )

    with pytest.raises(RuntimeError, match=message):
        client.ensure_legacy_virtual_key(legacy_spec(), old_key)


def test_existing_legacy_alias_must_match_the_old_plaintext_key():
    client = LiteLLMAdminClient("http://litellm.test", "server-master-key")
    client._get_single_key = Mock(
        return_value={
            "token": _hash_token("sk-another-client-key"),
            "expires": (datetime.now(timezone.utc) + timedelta(days=20)).isoformat(),
        }
    )

    with pytest.raises(RuntimeError, match="different token"):
        client.ensure_legacy_virtual_key(legacy_spec(), "sk-old-client-key")


def test_legacy_virtual_key_cannot_be_ambiguous_with_a_jwt():
    client = LiteLLMAdminClient("http://litellm.test", "server-master-key")

    with pytest.raises(ValueError, match="must not have JWT shape"):
        client.ensure_legacy_virtual_key(legacy_spec(), "sk-old.payload.signature")
