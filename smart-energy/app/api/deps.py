import sqlite3
from typing import Generator
from app.core.database import get_db_connection


def get_db() -> Generator[sqlite3.Connection, None, None]:
    """FastAPI Dependency providing a managed SQLite database connection.
    
    Yields connection for the duration of the request and cleanly closes it afterwards.
    """
    connection = get_db_connection()
    try:
        yield connection
    finally:
        connection.close()
