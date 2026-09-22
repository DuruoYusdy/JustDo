"""Request-local JWT/native dispatch for the pinned LiteLLM 1.99.1 auth pipeline.

The upstream optional-auth slot supports None = continue native authentication;
the OSS custom_auth-only branch does not. Install once before serving requests.
No per-request global changes, recursive authentication, or exception fallback.
"""
import importlib
import re
from importlib.metadata import version

JWT_SHAPE = re.compile(r'^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')


def has_jwt_credentials(request, api_key=''):
    if 'x-justdo-jwt' in request.headers:
        return True
    # Header presence always selects JWT, even if empty/malformed. Bearer JWTs
    # are recognized by shape; native UI tokens are encrypted blobs.
    authorization = request.headers.get('authorization', '')
    value = authorization or api_key or ''
    parts = value.strip().split(None, 1)
    token = parts[1] if len(parts) == 2 and parts[0].lower() == 'bearer' else value
    return bool(JWT_SHAPE.fullmatch(token)) or token == 'justdo-jwt-auth'


async def dispatch(request, api_key, user_custom_auth):
    if not has_jwt_credentials(request, api_key):
        return None
    if user_custom_auth is None:
        raise RuntimeError('JWT authentication hook is not configured')
    from litellm.proxy._types import UserAPIKeyAuth
    result = await user_custom_auth(request=request, api_key=api_key)
    if not isinstance(result, UserAPIKeyAuth):
        raise RuntimeError('JWT authentication did not return an authenticated identity')
    return result


def install():
    if version('litellm') != '1.99.1':
        raise RuntimeError('Authentication adapter requires LiteLLM 1.99.1; validate before upgrading')
    module = importlib.import_module('litellm.proxy.auth.user_api_key_auth')
    # This is the upstream pre-native-auth callback slot. It is available in the
    # OSS module too; no enterprise package or license is required.
    module.enterprise_custom_auth = dispatch
