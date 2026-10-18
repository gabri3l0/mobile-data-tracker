from fastapi import FastAPI

app = FastAPI(title="Mobile Data Tracker")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
