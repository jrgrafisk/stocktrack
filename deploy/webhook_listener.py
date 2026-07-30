import hashlib
import hmac
import http.server
import json
import os
import subprocess

SECRET = os.environ["DEPLOY_WEBHOOK_SECRET"].encode()
DEPLOY_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "deploy.sh")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/webhook":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        expected = hmac.new(SECRET, body, hashlib.sha256).hexdigest()

        github_sig = self.headers.get("X-Hub-Signature-256", "")
        gitea_sig = self.headers.get("X-Gitea-Signature") or self.headers.get("X-Forgejo-Signature") or ""

        valid = hmac.compare_digest(github_sig, "sha256=" + expected) or hmac.compare_digest(gitea_sig, expected)
        if not valid:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"invalid signature")
            return

        try:
            payload = json.loads(body)
        except ValueError:
            payload = {}
        ref = payload.get("ref", "")
        if ref and ref != "refs/heads/main":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ignored (not main)")
            return

        subprocess.Popen([DEPLOY_SCRIPT])
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"deploying")

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = http.server.HTTPServer(("127.0.0.1", 9001), Handler)
    server.serve_forever()
