import os
import tempfile
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS

# Import helpers from your strict optimizer module (same folder)
from auction_lineup_optimizer_strict import (
    load_table,
    apply_excludes,
    solve_top_k_strict,
    normalize_name,
    simplify_key,
)

app = Flask(__name__)
CORS(app)  # allow localhost frontend during dev


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/parse-sheet")
def parse_sheet():
    """
    Accepts multipart/form-data with:
      - file: CSV/XLSX
      - sheet (optional): Excel sheet name
    Returns normalized player rows for the frontend to edit:
      Name, Pos, Price, Projection
    """
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded under 'file'"}), 400

    f = request.files["file"]
    sheet = request.form.get("sheet") or None

    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(f.read())
        tmp_path = tmp.name

    try:
        df = load_table(tmp_path, sheet)  # your function normalizes & infers columns
        rows = df[["Name", "Pos", "Price", "Projection"]].to_dict(orient="records")
        return jsonify({"rows": rows})
    except SystemExit as e:
        # your module uses SystemExit for user-facing errors (e.g. PuLP missing)
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


@app.post("/optimize")
def optimize():
    """
    Accepts JSON:
    {
      "players": [{Name, Pos, Price, Projection, include?, anchor?, exclude?}, ...],
      "budget": 180,
      "k": 5
    }

    - exclude=true  => remove from pool
    - anchor=true   => MUST appear (matched via NameKeySimpl)
    - include       => UI hint only (not enforced here)
    """
    data = request.get_json(silent=True) or {}
    players = data.get("players", [])
    budget = int(data.get("budget", 180))
    k = int(data.get("k", 5))

    if not isinstance(players, list) or not players:
        return jsonify({"error": "No players provided"}), 400

    df = pd.DataFrame(players)

    # Validate required columns from FE
    required = ["Name", "Pos", "Price", "Projection"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        return jsonify({"error": f"Missing column(s): {', '.join(missing)}"}), 400

    # Clean numerics
    df["Price"] = pd.to_numeric(df["Price"], errors="coerce")
    df["Projection"] = pd.to_numeric(df["Projection"], errors="coerce")
    df = df.dropna(subset=["Price", "Projection", "Pos", "Name"]).copy()
    df["Price"] = df["Price"].astype(int)

    # Build the keys expected by anchor matching in your solver
    # (When data comes from FE rather than load_table)
    if "NameKey" not in df.columns:
        df["NameKey"] = df["Name"].apply(normalize_name)
    if "NameKeySimpl" not in df.columns:
        df["NameKeySimpl"] = df["NameKey"].apply(simplify_key)

    # Derive excludes / anchors from row flags
    excludes = df.loc[df.get("exclude", pd.Series(False, index=df.index)).fillna(False), "Name"].astype(str).tolist()
    anchors  = df.loc[df.get("anchor",  pd.Series(False, index=df.index)).fillna(False),  "Name"].astype(str).tolist()


    # Apply excludes, then solve strict Top-K
    df2 = apply_excludes(df, excludes)

    try:
        cols = ["Name", "NameKey", "NameKeySimpl", "Pos", "Price", "Projection"]
        sols = solve_top_k_strict(df2[cols], budget=budget, k=k, anchors=anchors)

        resp = []
        for s in sols:
            resp.append({
                "rank": s["rank"],
                "total_cost": s["total_cost"],
                "total_points": round(s["total_points"], 2),
                "table": s["table"].to_dict(orient="records"),
            })

        return jsonify({"solutions": resp, "anchors": anchors, "excludes": excludes})

    except SystemExit as e:
        # e.g., anchors not found, infeasible, PuLP/solver missing, etc.
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # Local dev server
    app.run(host="127.0.0.1", port=5001, debug=True)
