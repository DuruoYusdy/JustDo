import json
import unittest
from unittest.mock import AsyncMock

from hooks.activity.middleware import ActivityHook
from hooks.activity.events import validate_event

TOKEN = 'test-only-token-with-at-least-32-characters'
EVENT = {
    'event_id': '822f78cc-bd26-4e13-a42a-b45060a330da',
    'user_id': 'alice', 'event_type': 'startup',
    'metadata': {'productName': 'Example', 'loginTime': '2026-09-22T09:00:00Z'},
}


class HookTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, body=None, token=TOKEN, path='/customer/activity', method='POST'):
        self.store = AsyncMock()
        self.downstream = AsyncMock()
        self.hook = ActivityHook(self.downstream, self.store, TOKEN, legacy_expires_at=4102444800)
        scope = {'type': 'http', 'path': path, 'method': method,
                 'headers': [(b'authorization', ('Bearer ' + token).encode())]}
        receive = AsyncMock(return_value={'type': 'http.request',
                                         'body': body if body is not None else json.dumps(EVENT).encode()})
        send = AsyncMock()
        await self.hook(scope, receive, send)
        return send

    async def test_valid_event_persisted_before_success(self):
        send = await self.request()
        self.store.record.assert_awaited_once_with(validate_event(EVENT))
        self.assertEqual(send.call_args_list[0].args[0]['status'], 200)
        self.downstream.assert_not_awaited()

    async def test_bad_auth_cannot_write(self):
        send = await self.request(token='wrong')
        self.assertEqual(send.call_args_list[0].args[0]['status'], 401)
        self.store.record.assert_not_awaited()

    async def test_other_routes_pass_through(self):
        await self.request(path='/customer/info')
        self.downstream.assert_awaited_once()
        self.store.record.assert_not_awaited()

    async def test_body_limit(self):
        send = await self.request(body=b'x' * 8193)
        self.assertEqual(send.call_args_list[0].args[0]['status'], 413)
        self.store.record.assert_not_awaited()

    async def test_invalid_json(self):
        send = await self.request(body=b'{')
        self.assertEqual(send.call_args_list[0].args[0]['status'], 400)

    async def test_database_failure_returns_retryable_error(self):
        store = AsyncMock()
        store.record.side_effect = RuntimeError('sensitive database details')
        hook = ActivityHook(AsyncMock(), store, TOKEN, legacy_expires_at=4102444800)
        send = AsyncMock()
        await hook({'type': 'http', 'path': '/customer/activity', 'method': 'POST',
                    'headers': [(b'authorization', ('Bearer ' + TOKEN).encode())]},
                   AsyncMock(return_value={'type': 'http.request', 'body': json.dumps(EVENT).encode()}), send)
        self.assertEqual(send.call_args_list[0].args[0]['status'], 503)
        self.assertNotIn('sensitive', str(send.call_args_list))

    async def test_shutdown_closes_store(self):
        store, app = AsyncMock(), AsyncMock()
        await ActivityHook(app, store, TOKEN)({'type': 'lifespan'}, AsyncMock(), AsyncMock())
        app.assert_awaited_once()
        store.close.assert_awaited_once()

    def test_rejects_credentials_in_metadata(self):
        with self.assertRaises(ValueError):
            validate_event({**EVENT, 'metadata': {'Cookie': 'secret'}})

    def test_rejects_invalid_event_type(self):
        with self.assertRaises(ValueError):
            validate_event({**EVENT, 'event_type': 'unknown'})


if __name__ == '__main__':
    unittest.main()
