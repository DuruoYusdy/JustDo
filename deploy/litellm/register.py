"""Explicit hook registration; listed order is incoming request order."""

from importlib import import_module
from dataclasses import dataclass
from typing import Literal

from collections.abc import Callable, Mapping
from starlette.types import ASGIApp

Environment = Mapping[str, str]
HookFactory = Callable[[ASGIApp, Environment], ASGIApp]


@dataclass(frozen=True)
class Hook:
    module: str
    required: bool = False
    enabled_by_default: bool = False
    kind: Literal['middleware', 'auth'] = 'middleware'


HOOKS = {
    'jwt_auth': Hook('hooks.jwt_auth', required=True, kind='auth'),
    'model_headers': Hook('hooks.model_headers', required=True),
    'activity': Hook('hooks.activity', enabled_by_default=True),
    'example': Hook('hooks.example'),
}


def configure_auth(settings, environ):
    for name in configured_hooks(environ):
        hook = HOOKS[name]
        if hook.kind == 'auth':
            configure = getattr(import_module(hook.module), 'configure', None)
            if not callable(configure):
                raise ValueError(f'Hook {name} must export configure(settings)')

            configure(settings)


async def initialize_hooks(connection, environ):
    names = configured_hooks(environ)

    for name in names:
        initializer = getattr(import_module(HOOKS[name].module), 'initialize', None)
        if initializer is not None:
            await initializer(connection, environ)


def configured_hooks(environ, catalog=None):
    catalog = HOOKS if catalog is None else catalog
    defaults = ','.join(name for name, hook in catalog.items() if hook.enabled_by_default)
    names = [name.strip() for name in environ.get('LITELLM_HOOKS', defaults).split(',') if name.strip()]
    if len(names) != len(set(names)):
        raise ValueError('LITELLM_HOOKS contains duplicate hooks')

    unknown = set(names) - catalog.keys()
    if unknown:
        raise ValueError('Unknown hooks: ' + ', '.join(sorted(unknown)))

    required = [name for name, hook in catalog.items() if hook.required]
    return required + [name for name in names if name not in required]


def build_app(app: ASGIApp, environ: Environment,
              factories: dict[str, HookFactory] | None = None) -> ASGIApp:
    catalog = HOOKS if factories is None else {name: Hook(name) for name in factories}
    names = configured_hooks(environ, catalog)

    # Only explicitly registered and enabled modules are imported.
    selected = {}
    for name in names:
        if catalog[name].kind == 'auth':
            continue

        factory = (getattr(import_module(catalog[name].module), 'wrap', None)
                   if factories is None else factories[name])
        if not callable(factory):
            raise ValueError(f'Hook {name} must export a callable wrap(app, environ)')

        selected[name] = factory

    # First configured hook is outermost; responses unwind in reverse order.
    for name in reversed(selected):
        app = selected[name](app, environ)
        if not callable(app):
            raise ValueError(f'Hook {name} must return an ASGI application')

    return app
