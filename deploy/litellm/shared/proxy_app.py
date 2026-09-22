"""Stable ASGI entry point shared by all registered extensions."""

import os

from proxy_hooks.registry import build_app


def create_app():
    from litellm.proxy.proxy_server import app

    return build_app(app, os.environ)
