"""Mounted ASGI extension. No monkey patches or LiteLLM database migrations."""

import asyncio
import hmac
import json
import logging
from datetime import timezone
from uuid import UUID
from urllib.parse import parse_qs, urlsplit

LOG = logging.getLogger('litellm.activity')
PATH = '/customer/activity'


def validate_database_url(dsn):
    """Reject Prisma-only options without ever including credentials in errors."""
    try:
        parsed = urlsplit(dsn)
        valid = parsed.scheme in ('postgres', 'postgresql') and bool(parsed.hostname)
        query = parse_qs(parsed.query, keep_blank_values=True)
        prisma_options = {
            'schema', 'connection_limit', 'pool_timeout', 'connect_timeout',
            'socket_timeout', 'pgbouncer', 'statement_cache_size',
            'sslaccept', 'sslidentity', 'sslpassword',
        }
        valid = valid and not (query.keys() & prisma_options)
    except (TypeError, ValueError):
        valid = False

    if not valid:
        raise ValueError(
            'LITELLM_ACTIVITY_DATABASE_URL must be a PostgreSQL URI without '
            'Prisma-specific options; configure schema using PostgreSQL search_path'
        )
    return dsn


def merge_activity(metadata, event, now):
    event_id, _, event_type, supplied = event
    metadata = dict(metadata or {})
    activity = dict(metadata.get('customer_activity') or {})
    seen = list(activity.get('recent_event_ids') or [])
    duplicate = str(event_id) in seen

    timestamp = now.isoformat()
    day = timestamp[:10]
    days = dict(activity.get('days') or {})
    today = dict(days.get(day) or {'first_seen_at': timestamp, 'start_count': 0})
    today['last_seen_at'] = timestamp

    # Retries still prove current activity, but must not count another start/login.
    if event_type == 'startup' and not duplicate:
        today['start_count'] += 1
        activity['last_started_at'] = timestamp
    if event_type == 'login' and not duplicate:
        activity['last_login_reported_at'] = timestamp
    days[day] = today
    activity.update(
        last_seen_at=timestamp,
        metadata=json.loads(supplied),
        days={k: days[k] for k in sorted(days)[-90:]},
        recent_event_ids=(seen if duplicate else seen + [str(event_id)])[-256:],
    )
    metadata['customer_activity'] = activity
    return metadata


def validate_event(value):
    if not isinstance(value, dict):
        raise ValueError('Expected an object')

    event_id = UUID(value['event_id'])
    user_id = value['user_id']
    if not isinstance(user_id, str) or not user_id.strip() or len(user_id) > 512:
        raise ValueError('Invalid user_id')

    event_type = value['event_type']
    if event_type not in ('startup', 'heartbeat', 'login'):
        raise ValueError('Invalid event_type')

    metadata = value.get('metadata', {})
    if not isinstance(metadata, dict):
        raise ValueError('Invalid metadata')
    allowed = {'userName', 'loginTime', 'productName', 'version', 'clientTime'}
    if set(metadata) - allowed:
        raise ValueError('Unsupported metadata fields')
    if any(not isinstance(v, str) or len(v) > 512 for v in metadata.values()):
        raise ValueError('Invalid metadata value')
    return event_id, user_id.strip(), event_type, json.dumps(metadata)


class ActivityHook:
    def __init__(self, app, store, token='', authenticate=None, legacy_expires_at=0):
        if token and (len(token) < 32 or not token.isascii()):
            raise ValueError('LITELLM_ACTIVITY_TOKEN must contain at least 32 ASCII characters')
        self.app = app
        self.store = store
        self.authorization = ('Bearer ' + token).encode('ascii')
        self.authenticate = authenticate
        self.legacy_expires_at = legacy_expires_at

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'lifespan':
            try:
                await self.app(scope, receive, send)
            finally:
                await self.store.close()
            return

        if scope['type'] != 'http' or scope['path'] != PATH:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get('headers', []))
        identity = None
        from auth_dispatch import has_jwt_credentials
        from starlette.requests import Request
        if self.authenticate is not None and has_jwt_credentials(Request(scope)):
            try:
                identity = await self.authenticate(scope)
                if not isinstance(identity, str) or not identity.strip():
                    raise PermissionError('Missing authenticated identity')
            except Exception:
                await self.respond(send, 401, {'error': 'Unauthorized'})
                return
        else:
            import time
            if (time.time() >= self.legacy_expires_at
                    or not hmac.compare_digest(headers.get(b'authorization', b''), self.authorization)):
                await self.respond(send, 401, {'error': 'Unauthorized'})
                return

        if scope['method'] != 'POST':
            await self.respond(send, 405, {'error': 'POST required'})
            return

        body = bytearray()
        try:
            async with asyncio.timeout(5):
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return

                    body.extend(message.get('body', b''))
                    if len(body) > 8192:
                        await self.respond(send, 413, {'error': 'Body too large'})
                        return

                    if not message.get('more_body', False):
                        break
            event = validate_event(json.loads(body))
        except TimeoutError:
            await self.respond(send, 408, {'error': 'Request timeout'})
            return

        except (ValueError, KeyError, TypeError, AttributeError, UnicodeError):
            await self.respond(send, 400, {'error': 'Invalid activity event'})
            return

        try:
            async with asyncio.timeout(5):
                if identity is not None and event[1] != identity:
                    await self.respond(send, 403, {'error': 'User does not match authenticated identity'})
                    return
                if identity is not None:
                    await self.store.record(event, authenticated=True)
                else:
                    await self.store.record(event)
        except PermissionError:
            await self.respond(send, 403, {'error': 'Customer is blocked'})
            return
        except LookupError:
            await self.respond(send, 404, {'error': 'Customer does not exist'})
            return

        except Exception:
            # Never log database URLs, credentials, or user payloads.
            LOG.warning('Activity persistence unavailable')
            await self.respond(send, 503, {'error': 'Activity storage unavailable'})
            return

        await self.respond(send, 200, {'ok': True})

    @staticmethod
    async def respond(send, status, value):
        body = json.dumps(value).encode()
        await send({
            'type': 'http.response.start',
            'status': status,
            'headers': [
                (b'content-type', b'application/json'),
                (b'cache-control', b'no-store'),
            ],
        })
        await send({'type': 'http.response.body', 'body': body})


class PostgresStore:
    def __init__(self, dsn):
        self.dsn = validate_database_url(dsn)
        self.pool = None
        self.lock = asyncio.Lock()

    async def record(self, event, authenticated=False):
        if self.pool is None:
            async with self.lock:
                if self.pool is None:
                    import asyncpg

                    self.pool = await asyncpg.create_pool(
                        self.dsn,
                        min_size=0,
                        max_size=4,
                        timeout=3,
                        command_timeout=3,
                    )
        async with self.pool.acquire(timeout=3) as connection:
            async with connection.transaction():
                if authenticated:
                    await connection.execute(
                        'INSERT INTO "LiteLLM_EndUserTable" (user_id, blocked, spend) '
                        'VALUES ($1, false, 0) ON CONFLICT (user_id) DO NOTHING', event[1])
                row = await connection.fetchrow(
                    'SELECT metadata, blocked FROM "LiteLLM_EndUserTable" '
                    'WHERE user_id=$1 FOR UPDATE',
                    event[1],
                )
                if row is None:
                    raise LookupError('Customer does not exist')
                if row['blocked']:
                    raise PermissionError('Customer is blocked')
                previous = json.loads(row['metadata']) if row['metadata'] else {}
                now = await connection.fetchval('SELECT clock_timestamp()')
                merged = merge_activity(previous, event, now.astimezone(timezone.utc))
                await connection.execute(
                    'UPDATE "LiteLLM_EndUserTable" SET metadata=$2::jsonb WHERE user_id=$1',
                    event[1],
                    json.dumps(merged),
                )
                supplied = json.loads(event[3])
                if authenticated and supplied.get('productName') and supplied.get('version'):
                    await connection.execute(
                        'UPDATE "LiteLLM_EndUserTable" SET alias=$2 WHERE user_id=$1',
                        event[1], supplied['productName'] + ' ' + supplied['version'])

    async def close(self):
        if self.pool is not None:
            try:
                async with asyncio.timeout(5):
                    await self.pool.close()
            except TimeoutError:
                self.pool.terminate()


def wrap(app, environ):
    """Create this middleware without opening a database connection."""
    store = PostgresStore(environ['LITELLM_ACTIVITY_DATABASE_URL'])
    # Legacy activity uses the old digest only until an explicit absolute deadline.
    from datetime import datetime
    deadline = environ.get('LITELLM_ACTIVITY_LEGACY_EXPIRES_AT', '')
    token = environ.get('LITELLM_ACTIVITY_TOKEN', '')
    expires_at = 0
    if token:
        parsed = datetime.fromisoformat(deadline.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Legacy activity deadline requires a timezone')
        expires_at = parsed.timestamp()
    return ActivityHook(app, store, token, authenticate=authenticate_jwt, legacy_expires_at=expires_at)


async def authenticate_jwt(scope):
    from fastapi import Request
    from custom_auth import user_api_key_auth

    request = Request(scope)
    auth = await user_api_key_auth(request, request.headers.get('authorization', ''))
    if auth.team_blocked:
        raise PermissionError('Team is blocked')
    return auth.user_id
