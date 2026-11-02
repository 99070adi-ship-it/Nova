from app.config import Settings, _asyncpg_query


def test_neon_style_url_is_translated_for_asyncpg():
    url = "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db?sslmode=require&channel_binding=require"
    assert Settings(database_url=url).database_url == "postgresql+asyncpg://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db?ssl=require"


def test_postgres_scheme_and_plain_urls_are_unchanged_apart_from_the_driver():
    assert Settings(database_url="postgres://u:p@h/db").database_url == "postgresql+asyncpg://u:p@h/db"
    assert _asyncpg_query("postgresql+asyncpg://u:p@h/db") == "postgresql+asyncpg://u:p@h/db"


def test_other_query_options_survive():
    assert _asyncpg_query("postgresql+asyncpg://h/db?sslmode=verify-full&application_name=nova") == "postgresql+asyncpg://h/db?ssl=verify-full&application_name=nova"
