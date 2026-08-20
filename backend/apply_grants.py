import asyncio, asyncpg, os
from dotenv import load_dotenv

load_dotenv()

async def run():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    try:
        await conn.execute('''
            GRANT ALL ON TABLE users TO anon, authenticated;
            GRANT ALL ON TABLE posts TO anon, authenticated;
            GRANT ALL ON TABLE follows TO anon, authenticated;
            GRANT ALL ON TABLE bookmarks TO anon, authenticated;
            GRANT ALL ON TABLE reads TO anon, authenticated;
            GRANT ALL ON TABLE supports TO anon, authenticated;
            GRANT ALL ON TABLE notifications TO anon, authenticated;
            GRANT ALL ON TABLE media TO anon, authenticated;
            GRANT ALL ON TABLE live_sessions TO anon, authenticated;
            GRANT ALL ON TABLE moderation TO anon, authenticated;
            GRANT ALL ON TABLE webhook_events TO anon, authenticated;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
            GRANT EXECUTE ON FUNCTION read_counts_since(TIMESTAMPTZ) TO anon, authenticated;
            GRANT EXECUTE ON FUNCTION support_counts_since(TIMESTAMPTZ) TO anon, authenticated;
            GRANT EXECUTE ON FUNCTION support_totals(UUID[]) TO anon, authenticated;
            GRANT EXECUTE ON FUNCTION follower_counts(UUID[]) TO anon, authenticated;
            GRANT EXECUTE ON FUNCTION top_supporters(UUID, INTEGER) TO anon, authenticated;
        ''')
        print('Grants applied successfully!')
    except Exception as e:
        print('Error:', e)
    finally:
        await conn.close()

if __name__ == '__main__':
    asyncio.run(run())
