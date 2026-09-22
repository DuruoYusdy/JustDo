"""Exercise signature/claim rejection before any user provisioning is reachable."""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Request
from litellm.proxy._types import ProxyException

import custom_auth


@pytest.fixture(scope="module")
def keys():
    return [rsa.generate_private_key(public_exponent=65537, key_size=2048) for _ in range(2)]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [
    "signature", "issuer", "audience", "expired", "future", "lifetime",
    "missing-jti", "missing-kid", "account", "symmetric",
])
async def test_invalid_identity_never_reaches_enrollment(monkeypatch, keys, failure):
    now = int(time.time())
    claims = {"iss": "https://issuer.test", "aud": "litellm", "sub": "new-user",
              "iat": now, "exp": now + 300, "jti": "test-token"}
    headers = {"kid": "test-key"}
    if failure == "issuer":
        claims["iss"] = "https://untrusted.test"
    elif failure == "audience":
        claims["aud"] = "another-service"
    elif failure == "expired":
        claims.update(iat=now - 400, exp=now - 100)
    elif failure == "future":
        claims.update(iat=now + 60, exp=now + 300)
    elif failure == "lifetime":
        claims["exp"] = now + 301
    elif failure == "missing-jti":
        del claims["jti"]
    elif failure == "missing-kid":
        headers = {}
    token = jwt.encode(claims,
                       "test-symmetric-key-which-is-not-trusted" if failure == "symmetric"
                       else keys[1 if failure == "signature" else 0],
                       algorithm="HS256" if failure == "symmetric" else "RS256", headers=headers)
    monkeypatch.setattr(custom_auth, "load_settings", lambda: custom_auth.JwtSettings(
        issuer="https://issuer.test", audience="litellm", jwks_url="https://issuer.test/jwks",
        algorithms=("RS256",), max_lifetime_seconds=300, clock_skew_seconds=30,
    ))
    monkeypatch.setattr(custom_auth, "_get_jwks_client", lambda: SimpleNamespace(
        get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=keys[0].public_key())))
    resolve = AsyncMock()
    monkeypatch.setattr(custom_auth, "resolve_managed_access", resolve)
    request = Request({"type": "http", "method": "GET", "path": "/v1/models", "headers": [
        (b"x-justdo-jwt", token.encode()),
        (b"x-user-account", b"other-user" if failure == "account" else b"new-user"),
    ]})
    with pytest.raises(ProxyException):
        await custom_auth.user_api_key_auth(request, "Bearer justdo-jwt-auth")
    resolve.assert_not_awaited()
