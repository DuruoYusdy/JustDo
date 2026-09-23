"""Activity hook factory: configuration and dependency assembly only."""
from datetime import datetime
from pathlib import Path

from ..jwt_auth.identity import authenticate_jwt
from collections.abc import Mapping
from starlette.types import ASGIApp

Environment = Mapping[str, str]
from .middleware import ActivityHook
from .store import PostgresStore


async def initialize(connection, environ):
    await connection.execute(Path(__file__).with_name('schema.sql').read_text())


def wrap(app: ASGIApp, environ: Environment) -> ASGIApp:
    """Create this middleware without opening a database connection."""
    store = PostgresStore(environ['LITELLM_ACTIVITY_DATABASE_URL'])
    # Legacy activity uses the old digest only until an explicit absolute deadline.
    deadline = environ.get('LITELLM_ACTIVITY_LEGACY_EXPIRES_AT', '')
    token = environ.get('LITELLM_ACTIVITY_TOKEN', '')
    expires_at = 0
    if token:
        parsed = datetime.fromisoformat(deadline.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Legacy activity deadline requires a timezone')
        expires_at = parsed.timestamp()
    return ActivityHook(app, store, token, authenticate=authenticate_jwt, legacy_expires_at=expires_at)
