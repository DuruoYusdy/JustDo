"""One-time registration of the old client key; no Team or member management."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

_CLIENT_ROUTES = ["llm_api_routes", "/models", "/v1/models"]
_ALL_TEAM_MODELS = ["all-team-models"]
_LEGACY_KEY_DURATION = "30d"
_LEGACY_KEY_MAX_AGE = timedelta(days=30, minutes=5)
_MAX_VIRTUAL_KEY_LENGTH = 8_192
_JWT_SHAPE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class LegacyClientSpec:
    team_id: str
    key_alias: str = "legacy-client"


class LiteLLMApiError(RuntimeError):
    def __init__(self, path: str, status: int):
        super().__init__(f"LiteLLM request failed: path={path} status={status}")
        self.path = path
        self.status = status


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the server master key to a redirect destination.
        return None


class LiteLLMAdminClient:
    def __init__(self, base_url: str, master_key: str):
        self.base_url = base_url.rstrip("/")
        self.master_key = master_key
        self._opener = urllib.request.build_opener(_NoRedirectHandler())

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        allow_not_found: bool = False,
    ) -> dict[str, Any] | None:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.master_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with self._opener.open(request, timeout=15) as response:
                raw_body = response.read()
        except urllib.error.HTTPError as error:
            if allow_not_found and error.code == 404:
                return None
            raise LiteLLMApiError(path.split("?", 1)[0], error.code) from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"LiteLLM is unavailable at {self.base_url}.") from error
        if not raw_body:
            return {}
        decoded = json.loads(raw_body)
        return decoded if isinstance(decoded, dict) else {}

    def get_team(self, team_id: str) -> dict[str, Any] | None:
        encoded = urllib.parse.urlencode({"team_id": team_id})
        return self.request("GET", f"/team/info?{encoded}", allow_not_found=True)

    def _get_single_key(
        self,
        *,
        key_alias: str | None = None,
        key_hash: str | None = None,
    ) -> dict[str, Any] | None:
        query: dict[str, str] = {"return_full_object": "true", "size": "100"}
        if key_alias is not None:
            query["key_alias"] = key_alias
        if key_hash is not None:
            query["key_hash"] = key_hash
        response = (
            self.request("GET", f"/key/list?{urllib.parse.urlencode(query)}") or {}
        )
        keys = response.get("keys", [])
        if not isinstance(keys, list):
            raise RuntimeError("LiteLLM returned an invalid /key/list response.")
        objects = [item for item in keys if isinstance(item, dict)]
        if len(objects) > 1:
            identifier = key_alias if key_alias is not None else key_hash
            raise RuntimeError(f"More than one LiteLLM key matched {identifier}.")
        return objects[0] if objects else None

    def ensure_legacy_virtual_key(
        self,
        legacy: LegacyClientSpec,
        virtual_key: str,
    ) -> None:
        _validate_legacy_virtual_key(virtual_key)
        if virtual_key == self.master_key:
            raise ValueError("Legacy key must not equal the server master key")
        expected_hash = _hash_token(virtual_key)
        existing_key = self._get_single_key(key_alias=legacy.key_alias)
        metadata = {
            "jwt_managed": True,
            "legacy_clients": True,
            "legacy_expires_after": _LEGACY_KEY_DURATION,
        }

        if existing_key is not None:
            if existing_key.get("token") != expected_hash:
                raise RuntimeError(
                    f"Legacy key alias {legacy.key_alias} already belongs to a different token."
                )
            expires = _parse_optional_datetime(existing_key.get("expires"))
            if expires is not None and expires <= datetime.now(timezone.utc):
                raise RuntimeError(
                    "The legacy Virtual Key is already expired and will not be renewed. "
                    "Delete it after completing the migration."
                )
            if (
                expires is not None
                and expires > datetime.now(timezone.utc) + _LEGACY_KEY_MAX_AGE
            ):
                raise RuntimeError(
                    "The legacy Virtual Key expiry exceeds the 30-day migration window."
                )
            payload: dict[str, Any] = {
                "key_alias": legacy.key_alias,
                "team_id": legacy.team_id,
                "models": _ALL_TEAM_MODELS,
                "allowed_routes": _CLIENT_ROUTES,
                "metadata": {**_mapping_field(existing_key, "metadata"), **metadata},
            }
            if expires is None:
                payload["duration"] = _LEGACY_KEY_DURATION
            self.request("POST", "/key/update", payload)
            print(
                "updated legacy-client Virtual Key without extending its existing expiry"
            )
            return

        key_with_same_token = self._get_single_key(key_hash=expected_hash)
        if key_with_same_token is not None:
            raise RuntimeError(
                "The legacy token already exists under a different LiteLLM key alias."
            )
        self.request(
            "POST",
            "/key/generate",
            {
                "key": virtual_key,
                "key_alias": legacy.key_alias,
                "team_id": legacy.team_id,
                "models": _ALL_TEAM_MODELS,
                "allowed_routes": _CLIENT_ROUTES,
                "duration": _LEGACY_KEY_DURATION,
                "metadata": metadata,
            },
        )
        print("created legacy-client Virtual Key with a 30-day expiry")


def _mapping_field(value: Any, field_name: str) -> dict[str, Any]:
    raw_value = value.get(field_name, {}) if isinstance(value, dict) else {}
    if isinstance(raw_value, str):
        try:
            raw_value = json.loads(raw_value)
        except json.JSONDecodeError:
            return {}
    return raw_value if isinstance(raw_value, dict) else {}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _parse_optional_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise RuntimeError("LiteLLM returned an invalid legacy key expiry.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError("LiteLLM returned an invalid legacy key expiry.") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _validate_legacy_virtual_key(value: Any) -> str:
    if not isinstance(value, str) or not value.startswith("sk-"):
        raise ValueError(
            "Legacy Virtual Key must be a non-empty value beginning with sk-."
        )
    if len(value) < 4 or len(value) > _MAX_VIRTUAL_KEY_LENGTH:
        raise ValueError("Legacy Virtual Key has an invalid length.")
    if _JWT_SHAPE.fullmatch(value) or value == 'access-jwt-auth':
        raise ValueError(
            "Legacy Virtual Key must not have JWT shape or use the JWT placeholder."
        )
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Legacy Virtual Key contains unsafe control characters.")
    return value



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--team-id', required=True, help='Existing legacy Team created in the UI')
    parser.add_argument('--base-url', default='http://127.0.0.1:9108')
    args = parser.parse_args()
    master = os.getenv('LITELLM_MASTER_KEY', '')
    old_key = os.getenv('LITELLM_LEGACY_KEY', '')
    try:
        if not master or not old_key:
            raise ValueError('Set LITELLM_MASTER_KEY and LITELLM_LEGACY_KEY')
        if master == old_key:
            raise ValueError('Legacy key must not equal the server master key')
        parsed = urllib.parse.urlsplit(args.base_url)
        if (parsed.username or parsed.password or parsed.query or parsed.fragment
                or not parsed.hostname
                or (parsed.scheme != 'https' and not (
                    parsed.scheme == 'http' and parsed.hostname in {'localhost', '127.0.0.1', '::1'}))):
            raise ValueError('Use HTTPS or a loopback HTTP address')
        client = LiteLLMAdminClient(args.base_url, master)
        response = client.get_team(args.team_id)
        team = response.get('team_info', response) if response else {}
        if (_mapping_field(team, 'metadata').get('legacy_clients') is not True
                or not team.get('models') or team.get('blocked')):
            raise ValueError('Select an enabled legacy Team with an explicit model list')
        client.ensure_legacy_virtual_key(LegacyClientSpec(args.team_id), old_key)
    except (OSError, ValueError, RuntimeError):
        print('Legacy key registration failed; check credentials, Team and existing key expiry.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
