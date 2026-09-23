from unittest.mock import AsyncMock

import pytest

from register import build_app


@pytest.mark.asyncio
async def test_registered_example_preserves_streaming_messages_and_original_headers():
    messages = [
        {'type': 'http.response.start', 'status': 200,
         'headers': [(b'content-type', b'text/event-stream')]},
        {'type': 'http.response.body', 'body': b'first', 'more_body': True},
        {'type': 'http.response.body', 'body': b'last', 'more_body': False},
    ]
    delivered = []

    async def downstream(scope, receive, send):
        for message in messages:
            await send(message)
            assert len(delivered) == messages.index(message) + 1

    async def send(message):
        delivered.append(message)

    app = build_app(downstream, {'LITELLM_HOOKS': 'example'})
    await app({'type': 'http'}, AsyncMock(), send)
    assert delivered[0]['headers'] == [
        (b'content-type', b'text/event-stream'), (b'x-extension-example', b'enabled')]
    assert messages[0]['headers'] == [(b'content-type', b'text/event-stream')]
    assert delivered[1:] == messages[1:]


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['websocket', 'lifespan'])
async def test_example_forwards_non_http_unchanged(kind):
    downstream, receive, send = AsyncMock(), AsyncMock(), AsyncMock()
    app = build_app(downstream, {'LITELLM_HOOKS': 'example'})
    scope = {'type': kind}
    await app(scope, receive, send)
    downstream.assert_awaited_once_with(scope, receive, send)


@pytest.mark.asyncio
async def test_example_preserves_downstream_errors():
    downstream = AsyncMock(side_effect=RuntimeError('unavailable'))
    app = build_app(downstream, {'LITELLM_HOOKS': 'example'})
    with pytest.raises(RuntimeError, match='unavailable'):
        await app({'type': 'http'}, AsyncMock(), AsyncMock())
