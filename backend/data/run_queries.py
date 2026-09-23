"""
Allium Explorer API Query Runner
================================
Runs SQL queries from data/queries/*.sql via the Allium Explorer API,
bypassing the Explorer UI's 10K row limit and CSV download restriction.

API limit: 250,000 rows per query (vs 10K in the UI).

Usage:
    # Run all queries (01-06):
    python data/run_queries.py

    # Run a specific query:
    python data/run_queries.py 01

    # Run multiple specific queries:
    python data/run_queries.py 01 03 06

Requires: ALLIUM_API_KEY in .env
Output:  CSV files in data/raw/
"""

import os
import sys
import time
import json
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load environment
DATA_DIR = Path(__file__).resolve().parent
BACKEND_DIR = DATA_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

API_KEY = os.getenv("ALLIUM_API_KEY")
BASE_URL = "https://api.allium.so/api/v1/explorer"
QUERIES_DIR = DATA_DIR / "queries"
RAW_DIR = DATA_DIR / "raw"

# Query files in execution order
QUERY_FILES = {
    "01": ("01_arbitrum_borrower_labels.sql", "01_arbitrum_borrower_labels.csv"),
    "02": ("02_arbitrum_activity_features.sql", "02_arbitrum_activity_features.csv"),
    "03": ("03_arbitrum_lending_features.sql", "03_arbitrum_lending_features.csv"),
    "04": ("04_arbitrum_defi_features.sql", "04_arbitrum_defi_features.csv"),
    "05": ("05_arbitrum_financial_features.sql", "05_arbitrum_financial_features.csv"),
    "06": ("06_crosschain_activity_features.sql", "06_crosschain_activity_features.csv"),
}

HEADERS = {
    "X-API-KEY": API_KEY,
    "Content-Type": "application/json",
}

MAX_ROWS = 250_000  # API maximum
POLL_INTERVAL = 5   # seconds between status checks
MAX_POLL_TIME = 1800  # 30 minutes max wait per query


def create_query(title: str, sql: str) -> str:
    """Create a saved query in Allium Explorer. Returns query_id."""
    resp = requests.post(
        f"{BASE_URL}/queries",
        headers=HEADERS,
        json={
            "title": title,
            "config": {
                "sql": sql,
                "limit": MAX_ROWS,
            },
        },
    )
    resp.raise_for_status()
    data = resp.json()
    query_id = data.get("query_id") or data.get("id")
    if not query_id:
        # Try to extract from response
        print(f"  Create response: {json.dumps(data, indent=2)}")
        raise ValueError("Could not extract query_id from create response")
    return query_id


def run_query(query_id: str) -> str:
    """Start an async query run. Returns run_id."""
    resp = requests.post(
        f"{BASE_URL}/queries/{query_id}/run-async",
        headers=HEADERS,
        json={
            "parameters": {},
            "run_config": {"limit": MAX_ROWS},
        },
    )
    resp.raise_for_status()
    data = resp.json()
    run_id = data.get("run_id") or data.get("id")
    if not run_id:
        print(f"  Run response: {json.dumps(data, indent=2)}")
        raise ValueError("Could not extract run_id from run response")
    return run_id


def poll_for_completion(run_id: str) -> bool:
    """Poll until the query run completes. Returns True if successful."""
    start = time.time()
    while time.time() - start < MAX_POLL_TIME:
        try:
            resp = requests.get(
                f"{BASE_URL}/query-runs/{run_id}/results",
                headers={"X-API-KEY": API_KEY},
                params={"f": "json"},
            )
            if resp.status_code == 200:
                raw = resp.text
                # API returns literal "null" while query is still running
                if raw and raw.strip() != "null" and len(raw) > 10:
                    data = resp.json()
                    if data and isinstance(data, dict):
                        if data.get("data") is not None:
                            return True
                        status = data.get("status", "")
                        if status == "failed":
                            print(f"\n  Query failed: {data.get('error', 'unknown error')}")
                            return False
            elif resp.status_code not in (202, 400):
                print(f"\n  Poll status {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"\n  Poll error: {e}")

        elapsed = int(time.time() - start)
        print(f"  Waiting... ({elapsed}s elapsed)", end="\r", flush=True)
        time.sleep(POLL_INTERVAL)

    print(f"\n  Timed out after {MAX_POLL_TIME}s")
    return False


def download_csv(run_id: str, output_path: Path) -> int:
    """Download query results as CSV. Returns row count."""
    resp = requests.get(
        f"{BASE_URL}/query-runs/{run_id}/results",
        headers={"X-API-KEY": API_KEY},
        params={"f": "csv"},
        stream=True,
    )
    resp.raise_for_status()

    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    # Count rows (subtract 1 for header)
    with open(output_path, "r") as f:
        row_count = sum(1 for _ in f) - 1

    return row_count


def download_json_as_csv(run_id: str, output_path: Path) -> int:
    """Fallback: download as JSON, convert to CSV."""
    import csv

    resp = requests.get(
        f"{BASE_URL}/query-runs/{run_id}/results",
        headers={"X-API-KEY": API_KEY},
        params={"f": "json"},
    )
    resp.raise_for_status()
    data = resp.json()

    rows = data.get("data", [])
    if not rows:
        print("  No data rows returned")
        return 0

    # Write CSV
    columns = list(rows[0].keys())
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)

    return len(rows)


def run_single_query(query_num: str) -> bool:
    """Run a single query end-to-end. Returns True if successful."""
    if query_num not in QUERY_FILES:
        print(f"Unknown query number: {query_num}")
        return False

    sql_file, csv_file = QUERY_FILES[query_num]
    sql_path = QUERIES_DIR / sql_file
    csv_path = RAW_DIR / csv_file

    print(f"\n{'='*60}")
    print(f"Query {query_num}: {sql_file}")
    print(f"{'='*60}")

    # Read SQL
    sql = sql_path.read_text()
    # Strip comments for cleaner API submission (keep the SQL)
    print(f"  SQL file: {sql_path}")
    print(f"  Output:   {csv_path}")

    # Step 1: Create saved query
    print("  [1/4] Creating saved query...")
    try:
        title = f"arbora_{query_num}_{int(time.time())}"
        query_id = create_query(title, sql)
        print(f"  Query ID: {query_id}")
    except Exception as e:
        print(f"  ERROR creating query: {e}")
        return False

    # Step 2: Run query async
    print("  [2/4] Starting query run...")
    try:
        run_id = run_query(query_id)
        print(f"  Run ID: {run_id}")
    except Exception as e:
        print(f"  ERROR starting run: {e}")
        return False

    # Step 3: Poll for completion
    print("  [3/4] Waiting for completion...")
    if not poll_for_completion(run_id):
        print("  FAILED: Query did not complete successfully")
        return False
    print("  Query completed!                    ")  # extra spaces to overwrite \r line

    # Step 4: Download results
    print("  [4/4] Downloading results...")
    try:
        row_count = download_csv(run_id, csv_path)
        print(f"  Saved {row_count} rows to {csv_path}")
    except Exception as e:
        print(f"  CSV download failed ({e}), trying JSON fallback...")
        try:
            row_count = download_json_as_csv(run_id, csv_path)
            print(f"  Saved {row_count} rows to {csv_path} (via JSON)")
        except Exception as e2:
            print(f"  ERROR downloading results: {e2}")
            return False

    return True


def main():
    if not API_KEY:
        print("ERROR: ALLIUM_API_KEY not set in .env")
        print("Copy .env.example to .env and add your API key.")
        sys.exit(1)

    # Ensure output directory exists
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    # Determine which queries to run
    if len(sys.argv) > 1:
        query_nums = sys.argv[1:]
    else:
        query_nums = sorted(QUERY_FILES.keys())

    print(f"Allium Explorer API Query Runner")
    print(f"Queries to run: {', '.join(query_nums)}")
    print(f"API row limit: {MAX_ROWS:,}")

    results = {}
    for qnum in query_nums:
        success = run_single_query(qnum)
        results[qnum] = "OK" if success else "FAILED"

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for qnum, status in results.items():
        sql_file = QUERY_FILES[qnum][0]
        print(f"  Query {qnum} ({sql_file}): {status}")

    if any(s == "FAILED" for s in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
