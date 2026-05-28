"""Leslie-stock 数据层。

DB 路径：data/leslie.db
Schema：db/schema.sql
"""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "data" / "leslie.db"
SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def connect(readonly: bool = False) -> sqlite3.Connection:
    """打开 DB 连接。"""
    if readonly:
        uri = f"file:{DB_PATH}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
    else:
        conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema() -> None:
    """初始化 schema（幂等）。"""
    DB_PATH.parent.mkdir(exist_ok=True)
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with connect() as conn:
        conn.executescript(sql)
    print(f"✅ Schema initialized at {DB_PATH}")
