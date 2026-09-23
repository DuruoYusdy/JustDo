"""Optional response-header example. Disabled by default; owns no endpoint."""
from collections.abc import Mapping
from starlette.types import ASGIApp

Environment = Mapping[str, str]


def wrap(app: ASGIApp, environ: Environment) -> ASGIApp:
    async def middleware(scope, receive, send):
        if scope['type'] != 'http':
            await app(scope, receive, send)
            return

        async def send_response(message):
            if message['type'] == 'http.response.start':
                message = {**message, 'headers': [
                    *message.get('headers', []), (b'x-extension-example', b'enabled')]}
            await send(message)

        await app(scope, receive, send_response)

    return middleware
