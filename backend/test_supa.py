import asyncio, os
import database as db
from dotenv import load_dotenv

load_dotenv()

async def test():
    await db.init_db()
    res = db.get_client().table('users').select('*').limit(1).execute()
    print("limit(1):", res)
    try:
        res2 = db.get_client().table('users').select('*').eq('email', 'admin@freepress.in').maybe_single().execute()
        print("maybe_single():", res2)
    except Exception as e:
        print("Exception:", e)

if __name__ == '__main__':
    asyncio.run(test())
