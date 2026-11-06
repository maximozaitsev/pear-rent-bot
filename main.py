import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")

sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

# Ensure SQLite file is writable in container volume if used
db_url = os.environ.get("DATABASE_URL", "sqlite:///./pear_rent.db")
if db_url.startswith("sqlite:///./"):
    # relative to backend working dir
    pass

subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=False)

import uvicorn
from app.main import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
