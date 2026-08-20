import asyncio, asyncpg, os
from dotenv import load_dotenv

load_dotenv()

async def run():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    try:
        tables = [
            'users', 'posts', 'follows', 'bookmarks', 'reads',
            'supports', 'notifications', 'media', 'live_sessions',
            'moderation', 'webhook_events'
        ]
        for table in tables:
            await conn.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
            print(f"Disabled RLS on {table}")
    except Exception as e:
        print('Error:', e)
    finally:
        await conn.close()

if __name__ == '__main__':
    asyncio.run(run())
