"""Shared JWT identity validation for protected extension endpoints."""
async def authenticate_jwt(scope):
    from fastapi import Request
    from .handler import user_api_key_auth
    from .errors import JwtAuthError, JwtFailure

    request = Request(scope)
    auth = await user_api_key_auth(request, request.headers.get('authorization', ''))
    if auth.team_blocked:
        raise JwtAuthError(JwtFailure.BLOCKED)
    return auth.user_id
