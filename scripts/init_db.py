"""初始化 SQLite schema（幂等）。"""
from db import init_schema

if __name__ == "__main__":
    init_schema()
