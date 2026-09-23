import json
from unittest.mock import AsyncMock

import pytest

from hooks.activity import wrap
from hooks.activity.middleware import ActivityHook
from hooks.activity.events import validate_event
from hooks.jwt_auth.identity import authenticate_jwt


EVENT = {'event_id': '822f78cc-bd26-4e13-a42a-b45060a330da',
         'user_id': 'alice', 'event_type': 'startup'}


async def request(hook, event=EVENT, token='a.b.c', jwt_header=None):
    send = AsyncMock()
    headers = [(b'authorization', ('Bearer ' + token).encode())]
    if jwt_header is not None:
        headers.append((b'x-access-jwt', jwt_header.encode()))
    await hook({'type': 'http', 'path': '/customer/activity', 'method': 'POST',
                'headers': headers},
               AsyncMock(return_value={'type': 'http.request', 'body': json.dumps(event).encode()}), send)
    return send.call_args_list[0].args[0]['status']


@pytest.mark.asyncio
async def test_authenticated_subject_registers_only_own_customer():
    store = AsyncMock()
    hook = ActivityHook(AsyncMock(), store, authenticate=AsyncMock(return_value='alice'))
    assert await request(hook) == 200
    store.record.assert_awaited_once_with(validate_event(EVENT), authenticated=True)
    store.record.reset_mock()
    assert await request(hook, {**EVENT, 'user_id': 'bob'}) == 403
    store.record.assert_not_awaited()


@pytest.mark.asyncio
async def test_invalid_jwt_never_falls_back_to_legacy_activity_token():
    token = 'old-shared-token-with-at-least-32-characters'
    store = AsyncMock()
    hook = ActivityHook(AsyncMock(), store, token, authenticate=AsyncMock(side_effect=ValueError()),
                        legacy_expires_at=4102444800)
    assert await request(hook, token=token, jwt_header='invalid') == 401
    store.record.assert_not_awaited()


@pytest.mark.asyncio
async def test_legacy_activity_stops_at_absolute_deadline(monkeypatch):
    store = AsyncMock()
    hook = ActivityHook(AsyncMock(), store, 'old-shared-token-with-at-least-32-characters',
                        legacy_expires_at=100)
    monkeypatch.setattr('time.time', lambda: 100)
    assert await request(hook, token='old-shared-token-with-at-least-32-characters') == 401
    store.record.assert_not_awaited()


@pytest.mark.asyncio
async def test_blocked_customer_cannot_report():
    store = AsyncMock()
    store.record.side_effect = PermissionError()
    hook = ActivityHook(AsyncMock(), store, authenticate=AsyncMock(return_value='alice'))
    assert await request(hook) == 403


@pytest.mark.asyncio
async def test_missing_authenticated_subject_never_becomes_a_legacy_write():
    store = AsyncMock()
    hook = ActivityHook(AsyncMock(), store, authenticate=AsyncMock(return_value=None))
    assert await request(hook) == 401
    store.record.assert_not_awaited()


@pytest.mark.asyncio
async def test_activity_uses_the_same_jwt_and_team_validator(monkeypatch):
    from types import SimpleNamespace
    from hooks.jwt_auth import handler as custom_auth

    validator = AsyncMock(return_value=SimpleNamespace(user_id='alice', team_blocked=False))
    monkeypatch.setattr(custom_auth, 'user_api_key_auth', validator)
    scope = {'type': 'http', 'path': '/customer/activity', 'method': 'POST', 'headers': [
        (b'x-access-jwt', b'token'), (b'x-user-account', b'alice'),
        (b'authorization', b'Bearer access-jwt-auth')]}
    assert await authenticate_jwt(scope) == 'alice'
    assert validator.call_args.args[0].headers['x-access-jwt'] == 'token'
    validator.return_value.team_blocked = True
    from hooks.jwt_auth.errors import JwtAuthError
    with pytest.raises(JwtAuthError, match='Team is blocked'):
        await authenticate_jwt(scope)


def test_jwt_plane_needs_no_shared_activity_secret():
    hook = wrap(AsyncMock(), {'LITELLM_ACTIVITY_DATABASE_URL': 'postgresql://localhost/db'})
    assert hook.authenticate is authenticate_jwt


def test_legacy_activity_token_requires_timezone_deadline():
    with pytest.raises(ValueError):
        wrap(AsyncMock(), {'LITELLM_ACTIVITY_DATABASE_URL': 'postgresql://localhost/db',
                          'LITELLM_ACTIVITY_TOKEN': 'old-shared-token-with-at-least-32-characters'})


@pytest.mark.asyncio
async def test_single_activity_endpoint_accepts_unexpired_legacy_without_jwt_enrollment():
    store, authenticate = AsyncMock(), AsyncMock()
    token = 'old-shared-token-with-at-least-32-characters'
    hook = ActivityHook(AsyncMock(), store, token, authenticate=authenticate,
                        legacy_expires_at=4102444800)
    assert await request(hook, token=token) == 200
    authenticate.assert_not_awaited()
    store.record.assert_awaited_once_with(validate_event(EVENT))
