"""Common error envelope, correlation ID and credential-free diagnostics."""

import json
import logging
from dataclasses import dataclass, field
from uuid import uuid4

LOG = logging.getLogger('litellm.validation')


@dataclass
class ErrorResponse:
    code: str
    reason: str
    message: str
    status: int
    error_type: str = 'invalid_request_error'
    request_id: str = field(default_factory=lambda: uuid4().hex, init=False)

    def __post_init__(self):
        LOG.warning('Request rejected code=%s reason=%s request_id=%s',
                    self.code, self.reason, self.request_id)

    def to_dict(self):
        return {'type': self.error_type, 'message': self.message,
                'code': self.code, 'request_id': self.request_id}

    @property
    def headers(self):
        return {'cache-control': 'no-store', 'x-request-id': self.request_id}

    async def send(self, scope, send):
        if scope['type'] == 'websocket':
            await send({'type': 'websocket.close', 'code': 1008,
                        'reason': f'{self.code}:{self.request_id}'})
            return

        body = json.dumps({'error': self.to_dict()}).encode()
        await send({'type': 'http.response.start', 'status': self.status, 'headers': [
            (b'content-type', b'application/json'),
            *((key.encode(), value.encode()) for key, value in self.headers.items())]})
        await send({'type': 'http.response.body', 'body': body})
