"""Explicit, administrator-run migration. Never invoked by request workers."""
import asyncio
import os
from pathlib import Path


async def add_activity_column():
    import asyncpg
    from proxy_hooks.activity import validate_database_url

    connection = await asyncpg.connect(validate_database_url(os.environ['LITELLM_ACTIVITY_DATABASE_URL']))
    try:
        await connection.execute(Path(__file__).with_name('schema.sql').read_text())
    finally:
        await connection.close()


def main():
    from litellm.proxy.db.prisma_client import PrismaManager

    # Versioned migrations preserve extension columns; never use db push or
    # the old diff-and-force resolver against an existing database.
    if not PrismaManager.setup_database(use_migrate=True, use_v2_resolver=True):
        raise SystemExit('LiteLLM database migration failed')
    asyncio.run(add_activity_column())


if __name__ == '__main__':
    main()
