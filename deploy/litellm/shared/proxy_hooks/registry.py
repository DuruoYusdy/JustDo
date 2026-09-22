"""Explicit hook registration; listed order is incoming request order."""

from . import activity

HOOK_FACTORIES = {
    'activity': activity.wrap,
}


def build_app(app, environ, factories=None):
    factories = HOOK_FACTORIES if factories is None else factories
    configured = environ.get('LITELLM_HOOKS', 'activity')
    names = [name.strip() for name in configured.split(',') if name.strip()]

    if len(names) != len(set(names)):
        raise ValueError('LITELLM_HOOKS contains duplicate hooks')

    unknown = set(names) - factories.keys()
    if unknown:
        raise ValueError('Unknown hooks: ' + ', '.join(sorted(unknown)))

    # First configured hook is outermost, so authentication can precede routes.
    for name in reversed(names):
        app = factories[name](app, environ)

    return app
