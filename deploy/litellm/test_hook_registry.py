import unittest
from unittest.mock import AsyncMock

from shared.proxy_hooks.registry import build_app


class RegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_order_and_response_unwind(self):
        calls = []

        def factory(name):
            def wrap(app, environ):
                async def middleware(scope, receive, send):
                    calls.append(name + ':in')
                    await app(scope, receive, send)
                    calls.append(name + ':out')
                return middleware
            return wrap

        app = AsyncMock()
        wrapped = build_app(
            app,
            {'LITELLM_HOOKS': 'auth, activity'},
            {'auth': factory('auth'), 'activity': factory('activity')},
        )

        for kind in ('http', 'websocket', 'lifespan'):
            calls.clear()
            scope = {'type': kind}
            receive, send = AsyncMock(), AsyncMock()
            await wrapped(scope, receive, send)
            app.assert_awaited_with(scope, receive, send)
            self.assertEqual(calls, [
                'auth:in', 'activity:in', 'activity:out', 'auth:out',
            ])

    def test_unknown_or_duplicate_hook_fails_before_building(self):
        for value in ('missing', 'activity,activity'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                build_app(AsyncMock(), {'LITELLM_HOOKS': value})

    def test_explicit_empty_list_disables_hooks_without_activity_secrets(self):
        app = AsyncMock()
        self.assertIs(build_app(app, {'LITELLM_HOOKS': ''}), app)

    def test_default_activity_requires_configuration(self):
        with self.assertRaises(KeyError):
            build_app(AsyncMock(), {})

    async def test_auth_hook_can_reject_without_reaching_inner_app(self):
        app = AsyncMock()
        rejected = AsyncMock()
        wrapped = build_app(
            app,
            {'LITELLM_HOOKS': 'auth'},
            {'auth': lambda downstream, environ: rejected},
        )
        await wrapped({'type': 'http'}, AsyncMock(), AsyncMock())
        rejected.assert_awaited_once()
        app.assert_not_awaited()
