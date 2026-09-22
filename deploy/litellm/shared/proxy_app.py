"""Stable ASGI entry point shared by all registered extensions."""

import os

from proxy_hooks.registry import build_app


def create_app():
    import yaml
    # An ASGI launch skips CLI migration setup. Never allow implicit db push to
    # delete the activity extension column on a shared database.
    with open(os.environ['CONFIG_FILE_PATH'], encoding='utf-8') as config_file:
        config = yaml.safe_load(config_file)
    if config.get('general_settings', {}).get('disable_prisma_schema_update') is not True:
        raise ValueError('Disable automatic Prisma schema updates')
    settings = config.get('general_settings', {})
    if (settings.get('custom_auth') != 'custom_auth.user_api_key_auth'
            or settings.get('custom_auth_run_common_checks') is not True):
        raise ValueError('Configure the JWT hook and common authorization checks')
    os.environ['DISABLE_SCHEMA_UPDATE'] = 'true'
    from litellm.proxy.proxy_server import app
    from auth_dispatch import install
    install()

    return build_app(app, os.environ)
