import unittest
from unittest.mock import AsyncMock, Mock, patch, call

from register import HOOKS, build_app, configure_auth, configured_hooks


class RegistryTests(unittest.IsolatedAsyncioTestCase):
    def test_registry_lists_every_hook_and_its_enablement_policy(self):
        self.assertEqual(set(HOOKS), {'jwt_auth', 'model_headers', 'activity', 'example'})
        self.assertTrue(HOOKS['jwt_auth'].required)
        self.assertTrue(HOOKS['model_headers'].required)
        self.assertEqual(HOOKS['jwt_auth'].kind, 'auth')
        self.assertTrue(HOOKS['activity'].enabled_by_default)
        self.assertFalse(HOOKS['example'].enabled_by_default)
        self.assertEqual(configured_hooks({}), ['jwt_auth', 'model_headers', 'activity'])

    def test_required_auth_survives_every_optional_selection_without_duplicates(self):
        for value, expected in (
            ('', ['jwt_auth', 'model_headers']),
            ('example', ['jwt_auth', 'model_headers', 'example']),
            ('jwt_auth', ['jwt_auth', 'model_headers']),
            ('example,jwt_auth,activity', ['jwt_auth', 'model_headers', 'example', 'activity']),
        ):
            with self.subTest(value=value):
                self.assertEqual(configured_hooks({'LITELLM_HOOKS': value}), expected)
        with self.assertRaises(ValueError):
            configured_hooks({'LITELLM_HOOKS': 'jwt_auth,jwt_auth'})

    def test_empty_optional_list_still_configures_authentication(self):
        module = Mock()
        settings = {'custom_auth_run_common_checks': True}
        with patch('register.import_module', return_value=module) as loader:
            configure_auth(settings, {'LITELLM_HOOKS': ''})
        loader.assert_called_once_with('hooks.jwt_auth')
        module.configure.assert_called_once_with(settings)

    def test_missing_auth_entrypoint_fails_closed(self):
        with patch('register.import_module', return_value=object()):
            with self.assertRaises(ValueError):
                configure_auth({}, {'LITELLM_HOOKS': ''})

    async def test_explicit_required_hook_initializes_only_once(self):
        module = Mock(initialize=AsyncMock())
        from register import initialize_hooks
        connection = AsyncMock()
        environ = {'LITELLM_HOOKS': 'jwt_auth'}
        with patch('register.import_module', side_effect=lambda name: module if name == 'hooks.jwt_auth' else object()) as loader:
            await initialize_hooks(connection, environ)
        self.assertEqual(loader.call_args_list, [call('hooks.jwt_auth'), call('hooks.model_headers')])
        module.initialize.assert_awaited_once_with(connection, environ)

    def test_disabled_modules_are_not_imported(self):
        app = AsyncMock()
        with patch('register.import_module', return_value=Mock(wrap=lambda app, environ: app)) as loader:
            self.assertIs(build_app(app, {'LITELLM_HOOKS': ''}), app)
        loader.assert_called_once_with('hooks.model_headers')

    def test_only_registered_enabled_module_is_imported(self):
        factory = Mock(return_value=AsyncMock())
        with patch('register.import_module',
                   return_value=Mock(wrap=factory)) as loader:
            build_app(AsyncMock(), {'LITELLM_HOOKS': 'example'})
        self.assertEqual(loader.call_args_list, [call('hooks.model_headers'), call('hooks.example')])
        self.assertEqual(factory.call_count, 2)

    def test_invalid_factory_and_application_are_rejected(self):
        for factory in (None, lambda app, environ: None):
            with self.subTest(factory=factory), self.assertRaises(ValueError):
                build_app(AsyncMock(), {'LITELLM_HOOKS': 'invalid'}, {'invalid': factory})

    def test_invalid_configuration_does_not_import_modules(self):
        with patch('register.import_module') as loader:
            for names in ('activity,missing', 'activity,activity'):
                with self.assertRaises(ValueError):
                    build_app(AsyncMock(), {'LITELLM_HOOKS': names})
        loader.assert_not_called()

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
        self.assertIs(build_app(app, {'LITELLM_HOOKS': ''}).app, app)

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
