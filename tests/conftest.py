import pytest
import os
import sys

# Ensure root package path is on pythonpath
sys.path.insert(0, "/home/anon/Documents/corp")

from server.database import init_db, Base, engine

@pytest.fixture(scope="function", autouse=True)
def clean_db():
    """Drops and recreates all database tables in SQLite for test isolation."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    init_db()
    yield
    Base.metadata.drop_all(bind=engine)
