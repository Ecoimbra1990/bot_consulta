from functools import lru_cache

import firebase_admin
from firebase_admin import firestore


@lru_cache(maxsize=1)
def get_app():
    try:
        return firebase_admin.get_app()
    except ValueError:
        return firebase_admin.initialize_app()


def get_db():
    get_app()
    return firestore.client()
