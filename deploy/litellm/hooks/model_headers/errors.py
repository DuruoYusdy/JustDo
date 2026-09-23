"""Public diagnostic codes and private validation reasons for this hook."""
from enum import Enum
from hooks.errors import ErrorResponse

PUBLIC_MESSAGE = 'Request validation failed'


class Failure(Enum):
    ACCOUNT_MISSING = ('REQ-1042', 'account_missing')
    ACCOUNT_DUPLICATE = ('REQ-1042', 'account_duplicate')
    ACCOUNT_INVALID = ('REQ-1042', 'account_invalid')
    COOKIE_MISSING = ('REQ-2071', 'cookie_missing')
    COOKIE_DUPLICATE = ('REQ-2071', 'cookie_duplicate')
    COOKIE_INVALID = ('REQ-2071', 'cookie_invalid')

    @property
    def code(self):
        return self.value[0]

    @property
    def reason(self):
        return self.value[1]


async def reject(scope, send, failure):
    await ErrorResponse(failure.code, failure.reason, PUBLIC_MESSAGE, 400).send(scope, send)
