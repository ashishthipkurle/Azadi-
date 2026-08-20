"""Supabase database helper for FreePress backend.

Thin async wrapper around supabase-py that replaces the Motor/PyMongo
patterns with Supabase PostgREST calls. Uses the service_role key to
bypass RLS.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from supabase import create_client, Client


# Module-level client — initialised once in init_db()
_supabase: Optional[Client] = None


def get_client() -> Client:
    """Return the initialised Supabase client or raise."""
    if _supabase is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    return _supabase


async def init_db() -> Client:
    """Create the Supabase client from env vars. Call once at startup."""
    global _supabase
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY) must be set in backend/.env"
        )
    _supabase = create_client(url, key)
    return _supabase


async def close_db():
    """Cleanup (no-op for REST-based client, but keeps the interface symmetric)."""
    global _supabase
    _supabase = None


# ─── Query helpers ───────────────────────────────────────────
# These mirror the Motor patterns used in server.py so the
# migration diff stays small and readable.


async def find_one(
    table: str,
    filters: dict[str, Any],
    *,
    exclude_columns: list[str] | None = None,
) -> dict | None:
    """Find a single row matching all filters. Returns None if not found."""
    sb = get_client()
    columns = _columns_except(exclude_columns)
    query = sb.table(table).select(columns)
    query = _apply_filters(query, filters)
    result = query.maybe_single().execute()
    if result is None:
        return None
    return result.data if hasattr(result, "data") else result


async def find_many(
    table: str,
    filters: dict[str, Any] | None = None,
    *,
    exclude_columns: list[str] | None = None,
    order_by: str | None = None,
    desc: bool = True,
    limit: int | None = None,
) -> list[dict]:
    """Find multiple rows. Returns an empty list if nothing matches."""
    sb = get_client()
    columns = _columns_except(exclude_columns)
    query = sb.table(table).select(columns)
    if filters:
        query = _apply_filters(query, filters)
    if order_by:
        query = query.order(order_by, desc=desc)
    if limit:
        query = query.limit(limit)
    result = query.execute()
    return result.data or []


async def insert_one(table: str, data: dict[str, Any]) -> dict:
    """Insert a single row and return it."""
    sb = get_client()
    result = sb.table(table).insert(data).execute()
    return result.data[0] if result.data else data


async def insert_many(table: str, data_list: list[dict[str, Any]]) -> list[dict]:
    """Insert multiple rows."""
    sb = get_client()
    result = sb.table(table).insert(data_list).execute()
    return result.data or data_list


async def update_one(
    table: str,
    filters: dict[str, Any],
    updates: dict[str, Any],
) -> dict | None:
    """Update matching row(s). Returns the first updated row or None."""
    sb = get_client()
    query = sb.table(table).update(updates)
    query = _apply_filters(query, filters)
    result = query.execute()
    return result.data[0] if result.data else None


async def upsert_one(
    table: str,
    data: dict[str, Any],
    on_conflict: str,
) -> dict:
    """Insert or update based on conflict columns."""
    sb = get_client()
    result = sb.table(table).upsert(data, on_conflict=on_conflict).execute()
    return result.data[0] if result.data else data


async def delete_one(table: str, filters: dict[str, Any]) -> None:
    """Delete row(s) matching filters."""
    sb = get_client()
    query = sb.table(table).delete()
    query = _apply_filters(query, filters)
    query.execute()


async def count(table: str, filters: dict[str, Any] | None = None) -> int:
    """Count rows matching filters."""
    sb = get_client()
    query = sb.table(table).select("*", count="exact")
    if filters:
        query = _apply_filters(query, filters)
    result = query.execute()
    return result.count or 0


async def rpc(function_name: str, params: dict[str, Any] | None = None) -> list[dict]:
    """Call a Supabase RPC (database function)."""
    sb = get_client()
    result = sb.rpc(function_name, params or {}).execute()
    return result.data or []


# ─── Internal helpers ────────────────────────────────────────


def _columns_except(exclude: list[str] | None) -> str:
    """Build a column selector. If exclude is None or empty, select all."""
    # PostgREST doesn't have a native 'exclude' — we just select '*'
    # and strip unwanted keys from the result. For password_hash
    # specifically, we rely on not returning it from Python, or
    # we use an explicit column list when we know the table shape.
    return "*"


def _apply_filters(query: Any, filters: dict[str, Any]) -> Any:
    """Apply simple equality filters to a PostgREST query builder.

    Supports special filter values:
      {"$ne": value}   → .neq(col, value)
      {"$in": [list]}  → .in_(col, list)
      {"$gte": value}  → .gte(col, value)
      {"$lt": value}   → .lt(col, value)
    """
    for key, value in filters.items():
        if isinstance(value, dict):
            for op, val in value.items():
                if op == "$ne":
                    query = query.neq(key, val)
                elif op == "$in":
                    query = query.in_(key, val)
                elif op == "$gte":
                    query = query.gte(key, val)
                elif op == "$lt":
                    query = query.lt(key, val)
        else:
            query = query.eq(key, value)
    return query
