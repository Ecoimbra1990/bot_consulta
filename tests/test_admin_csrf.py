import re

from app.admin.routes import admin_bp
from flask import Flask


def _client():
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(admin_bp)
    return app.test_client()


def test_login_page_exposes_csrf_token():
    response = _client().get("/admin/login")
    assert response.status_code == 200
    assert re.search(rb'name="csrf_token"', response.data)


def test_post_without_csrf_is_rejected():
    response = _client().post("/admin/login", data={"email": "admin@example.com", "password": "x"})
    assert response.status_code == 400
