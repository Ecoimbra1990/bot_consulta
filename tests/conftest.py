import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "functions"))

os.environ.setdefault("APP_ENV", "dev")
os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "bot-consulta-test")
os.environ.setdefault("GCLOUD_PROJECT", "bot-consulta-test")

import firebase_admin
import google.cloud.firestore
from firebase_admin import firestore as firebase_firestore
from google.auth.credentials import AnonymousCredentials

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={"projectId": os.environ["GOOGLE_CLOUD_PROJECT"]})


def _emulator_client(_service, database_id=None):
    return google.cloud.firestore.Client(
        project=os.environ["GOOGLE_CLOUD_PROJECT"],
        credentials=AnonymousCredentials(),
        database=database_id or "(default)",
    )


firebase_firestore._FirestoreService.get_client = _emulator_client
