import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")

sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

try:
    subprocess.run(["alembic", "upgrade", "head"], check=False)
except Exception as e:
    print("Migration warning:", e)

import uvicorn
from app.main import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
