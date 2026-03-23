import threading
import time
import webbrowser

import uvicorn

from backend.app import app


def _open_browser() -> None:
    time.sleep(1)
    webbrowser.open("http://127.0.0.1:8000", new=1)


if __name__ == "__main__":
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000)
