import importlib
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

from fastapi import Request
import pytest

import auth_dispatch


def request(token='sk-native', jwt_header=None):
    headers = [(b'authorization', ('Bearer ' + token).encode())]
    if jwt_header is not None:
        headers.append((b'x-justdo-jwt', jwt_header.encode()))
    return Request({'type': 'http', 'method': 'GET', 'path': '/v1/models',
                    'headers': headers, 'query_string': b''},
                   receive=AsyncMock(return_value={'type': 'http.request', 'body': b''}))


@pytest.mark.asyncio
@pytest.mark.parametrize('token,header', [('a.b.c', None), ('sk-native', 'bad'),
                                        ('sk-native', ''), ('justdo-jwt-auth', None)])
async def test_jwt_rejection_never_falls_back_to_native(token, header):
    hook = AsyncMock(side_effect=ValueError('rejected'))
    with pytest.raises(ValueError):
        await auth_dispatch.dispatch(request(token, header), token, hook)
    hook.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize('token', ['sk-native', 'sk.key-with-punctuation', 'encrypted-ui-blob'])
async def test_keys_use_native_auth_without_calling_jwt_hook(token):
    hook = AsyncMock()
    assert await auth_dispatch.dispatch(request(token), token, hook) is None
    hook.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('result', [None, 'sk-native'])
async def test_invalid_hook_result_cannot_turn_jwt_into_native_fallback(result):
    with pytest.raises(RuntimeError):
        await auth_dispatch.dispatch(request('a.b.c'), 'a.b.c', AsyncMock(return_value=result))


@pytest.fixture
def pipeline(monkeypatch):
    import litellm.proxy.proxy_server as server
    module = importlib.import_module('litellm.proxy.auth.user_api_key_auth')
    monkeypatch.setattr(module, 'enterprise_custom_auth', auth_dispatch.dispatch)
    monkeypatch.setattr(server, 'user_custom_auth', AsyncMock())
    monkeypatch.setattr(server, 'master_key', 'sk-native')
    monkeypatch.setattr(server, 'general_settings', {'custom_auth_run_common_checks': True})
    monkeypatch.setattr(module.IdentityStore, 'resolve', AsyncMock(return_value=None))
    monkeypatch.setattr(module.ExperimentalUIJWTToken, 'get_key_object_from_ui_hash_key', lambda _: None)
    return module, server


async def build(module, req):
    return await module._user_api_key_auth_builder(
        request=req, api_key=req.headers['authorization'], azure_api_key_header=None,
        anthropic_api_key_header=None, google_ai_studio_api_key_header=None,
        azure_apim_header=None, request_data={})


@pytest.mark.asyncio
async def test_real_native_pipeline_still_accepts_master_key(pipeline):
    from litellm.proxy._types import LitellmUserRoles
    module, server = pipeline
    result = await build(module, request())
    assert result.user_role == LitellmUserRoles.PROXY_ADMIN
    server.user_custom_auth.assert_not_awaited()


@pytest.mark.asyncio
async def test_bad_jwt_header_rejects_even_with_a_valid_master_key(pipeline, monkeypatch):
    import custom_auth
    from litellm.proxy._types import ProxyException
    module, server = pipeline
    monkeypatch.setattr(server, 'user_custom_auth', custom_auth.user_api_key_auth)
    with pytest.raises(ProxyException):
        await build(module, request('sk-native', jwt_header='malformed'))


@pytest.mark.asyncio
async def test_real_native_pipeline_rejects_expired_cached_key(pipeline, monkeypatch):
    from litellm.proxy._types import LitellmUserRoles, UserAPIKeyAuth, ProxyException
    module, server = pipeline
    expired = UserAPIKeyAuth(user_role=LitellmUserRoles.PROXY_ADMIN,
                            expires=datetime.now(timezone.utc) - timedelta(seconds=1))
    monkeypatch.setattr(module.IdentityStore, 'key_from_principal', lambda _: expired)
    with pytest.raises(ProxyException):
        await build(module, request('sk-expired'))
    server.user_custom_auth.assert_not_awaited()


@pytest.mark.asyncio
async def test_mixed_concurrent_auth_does_not_disable_jwt_hook(pipeline):
    import asyncio
    from litellm.proxy._types import UserAPIKeyAuth
    module, server = pipeline
    server.user_custom_auth.return_value = UserAPIKeyAuth(user_id='alice', team_id='managed')
    results = await asyncio.gather(build(module, request()), build(module, request('a.b.c')))
    assert results[1].user_id == 'alice'
    assert results[0].user_id != 'alice'
    server.user_custom_auth.assert_awaited_once()


def test_adapter_rejects_unreviewed_litellm_version(monkeypatch):
    monkeypatch.setattr(auth_dispatch, 'version', lambda _: '2.0.0')
    with pytest.raises(RuntimeError):
        auth_dispatch.install()


@pytest.mark.asyncio
@pytest.mark.parametrize('token', ['sk-native', 'a.b.c'])
async def test_public_auth_pipeline_applies_authorization_after_both_auth_types(pipeline, monkeypatch, token):
    from litellm.proxy._types import UserAPIKeyAuth
    module, server = pipeline
    server.user_custom_auth.return_value = UserAPIKeyAuth(user_id='alice', team_id='managed')
    gate = AsyncMock(return_value=None)
    monkeypatch.setattr(module, '_authorize_authenticated_request', gate)
    req = request(token)
    await module.user_api_key_auth(
        request=req, api_key=req.headers['authorization'], azure_api_key_header=None,
        anthropic_api_key_header=None, google_ai_studio_api_key_header=None,
        azure_apim_header=None, custom_litellm_key_header=None)
    gate.assert_awaited_once()


def test_installer_connects_the_callback_used_by_the_native_pipeline(monkeypatch):
    module = importlib.import_module('litellm.proxy.auth.user_api_key_auth')
    monkeypatch.setattr(module, 'enterprise_custom_auth', None)
    auth_dispatch.install()
    assert module.enterprise_custom_auth is auth_dispatch.dispatch
