import json
import logging
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from hooks.model_headers import validate_headers, wrap
from hooks.model_headers.errors import Failure, PUBLIC_MESSAGE, reject

ACCOUNT = (b'x-user-account', b'h00658810')
COOKIE = (b'x-cookie', b'sid=private-cookie-value')


@pytest.mark.parametrize('headers,failure', [
    ([COOKIE], Failure.ACCOUNT_MISSING),
    ([ACCOUNT, ACCOUNT, COOKIE], Failure.ACCOUNT_DUPLICATE),
    ([(b'x-user-account', b'private-invalid-account'), COOKIE], Failure.ACCOUNT_INVALID),
    ([ACCOUNT], Failure.COOKIE_MISSING),
    ([ACCOUNT, COOKIE, COOKIE], Failure.COOKIE_DUPLICATE),
    ([ACCOUNT, (b'x-cookie', b'private-invalid-cookie')], Failure.COOKIE_INVALID),
])
@pytest.mark.asyncio
async def test_public_codes_are_generic_and_private_reasons_correlate_in_logs(headers, failure, caplog):
    assert validate_headers(headers) is failure
    downstream, receive, send = AsyncMock(), AsyncMock(), AsyncMock()
    caplog.set_level(logging.WARNING, logger='litellm.validation')
    await wrap(downstream, {})({
        'type': 'http', 'path': '/v1/chat/completions', 'method': 'POST',
        'headers': [*headers, (b'x-request-id', b'untrusted-caller-id')],
    }, receive, send)
    downstream.assert_not_awaited()
    receive.assert_not_awaited()
    start = send.call_args_list[0].args[0]
    raw = send.call_args_list[1].args[0]['body'].decode()
    error = json.loads(raw)['error']
    assert error == {'type': 'invalid_request_error', 'message': PUBLIC_MESSAGE,
                     'code': failure.code, 'request_id': error['request_id']}
    assert UUID(error['request_id']).version == 4
    assert start['status'] == 400
    assert dict(start['headers'])[b'x-request-id'].decode() == error['request_id']
    assert 'X-User-Account' not in raw and 'X-Cookie' not in raw
    assert failure.reason not in raw
    records = [r for r in caplog.records if r.name == 'litellm.validation']
    assert len(records) == 1
    log = records[0].getMessage()
    assert log == (f'Request rejected code={failure.code} reason={failure.reason} '
                   f'request_id={error["request_id"]}')
    for secret in ('h00658810', 'private-cookie-value', 'private-invalid-account',
                   'private-invalid-cookie', 'untrusted-caller-id'):
        assert secret not in raw and secret not in log


def test_stable_codes_group_failures_without_exposing_specific_cause():
    assert {f.code for f in Failure if f.name.startswith('ACCOUNT_')} == {'REQ-1042'}
    assert {f.code for f in Failure if f.name.startswith('COOKIE_')} == {'REQ-2071'}
    assert validate_headers([]) is Failure.ACCOUNT_MISSING


@pytest.mark.asyncio
async def test_request_ids_are_unique_and_websocket_reason_is_opaque(caplog):
    caplog.set_level(logging.WARNING, logger='litellm.validation')
    ids = []
    for _ in range(2):
        send = AsyncMock()
        await reject({'type': 'websocket'}, send, Failure.COOKIE_INVALID)
        message = send.call_args.args[0]
        assert message['type'] == 'websocket.close' and message['code'] == 1008
        code, request_id = message['reason'].split(':')
        assert code == 'REQ-2071' and UUID(request_id).version == 4
        assert len(message['reason'].encode()) <= 123
        assert request_id in caplog.text
        ids.append(request_id)
    assert ids[0] != ids[1]
